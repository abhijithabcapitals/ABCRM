-- =====================================================================
-- HR Base - company leave and pay rules, salary payments           013
-- =====================================================================
-- Late: a day with the full hours between first and last punch (shift_end - shift_start, or saturday_end - shift_start on Saturday) is not late, whatever the arrival. No last punch means late.
-- Leave ledger, from hr_settings.leave_rules_from, for the one leave type with accrual_per_month set. The rules stay off until both are set, so a month before them is paid as before.
--   Each month: credit from hr_leave_balances (on the first month and each January) + accrual, less leave taken. Leave taken = approved days of that type + Absent days not inside approved leave + every 4th late day.
--   The balance pays for leave taken first. The rest is unpaid. The balance never goes below 0, and unused days carry forward.
--   Accrual: accrual_per_month at each monthly anniversary of joining after accrual_after_months, from leave_rules_from, to the exit date.
-- Pay: unpaid days = days in approved unpaid leave + the ledger's unpaid days, deducted through hr_pay_compute. Earlier months keep counting each Absent day as unpaid.
-- Gratuity leaves out only unpaid days, so an Absent day the balance paid for still counts as service.
-- hr_salary_payments: what was paid against an approved line. Written and read only through functions, by HR, admin and the Accounts team (banking permission accounts.review). Approved lines never change.
-- Requires 001 to 012. Idempotent.
-- =====================================================================
alter table public.hr_leave_types add column if not exists accrual_per_month numeric check (accrual_per_month > 0);
alter table public.hr_leave_types add column if not exists accrual_after_months int check (accrual_after_months >= 0);
create unique index if not exists hr_leave_types_one_accrual on public.hr_leave_types ((accrual_per_month is not null)) where accrual_per_month is not null;
alter table public.hr_settings add column if not exists leave_rules_from date;

-- ── late ──
create or replace function public.hr_attendance_days(p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, employee_status text, exit_date date, work_date date, status text, leave_kind text,
               time_in time, time_out time, late_minutes int, overtime_minutes int, source text, note text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from public.hr_settings where id = 1),
  first_last as (select p.emp_code, min(p.punch_at)::date as first_p, max(p.punch_at)::date as last_p from public.hr_biometric_punches p group by p.emp_code),
  people as (
    select e.id, e.employee_code, e.full_name, e.status, e.exit_date,
           case when coalesce(e.join_date, f.first_p) is not null
                then greatest(coalesce(e.join_date, f.first_p), (select s.attendance_tracked_from from public.hr_settings s where s.id = 1)) end as start_d,
           least((now() at time zone 'Asia/Dubai')::date, e.exit_date,
                 case when e.status = 'Left' and e.exit_date is null then coalesce(f.last_p, date '0001-01-01') end) as stop_d
    from public.hr_employees e
    left join first_last f on f.emp_code = coalesce(e.biometric_code, e.employee_code)
    where p_employee is null or e.id = p_employee
  ),
  days as (
    select p.*, g.d::date as d, a.id as row_id, a.status as row_status, a.source as row_source, a.time_in as t_in, a.time_out as t_out, a.note as row_note,
           lv.kind, h.id is not null as is_holiday
    from people p
    cross join generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
    left join public.hr_attendance a on a.employee_id = p.id and a.work_date = g.d::date
    left join public.hr_holidays h on h.holiday_date = g.d::date
    left join lateral (
      select case when t.paid then 'Annual' else 'Unpaid' end as kind
      from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
      where r.employee_id = p.id and r.status = 'approved' and g.d::date between r.from_date and r.to_date
      limit 1
    ) lv on true
    where a.source = 'manual' or lv.kind is not null or a.id is not null or g.d::date between p.start_d and p.stop_d
  ),
  decided as (
    select dy.*, s.shift_start, s.shift_end, s.saturday_end, extract(dow from dy.d)::int = any (s.weekend_days) as is_off,
           case
             when dy.row_source = 'manual' then dy.row_status
             when dy.kind is not null then 'Leave'
             when dy.is_holiday then 'Holiday'
             when dy.row_id is not null then dy.row_status
             when public.hr_is_wfh_saturday(dy.d) then 'WFH'
             when extract(dow from dy.d)::int = any (s.weekend_days) then 'Weekend'
             when s.absent_from_blank_days then 'Absent'
           end as st
    from days dy cross join s
  )
  select x.id, x.employee_code, x.full_name, x.status, x.exit_date, x.d, x.st,
         case when x.st = 'Leave' then x.kind end,
         x.t_in, x.t_out,
         case when x.st = 'Present' and not x.is_off and x.t_in > x.shift_start
                   and (x.t_out is null or x.t_out - x.t_in < (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end) - x.shift_start)
              then ceil(extract(epoch from x.t_in - x.shift_start) / 60)::int else 0 end,
         case when x.st = 'Present' and not x.is_off and x.t_out is not null
                   and x.t_out > (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)
              then ceil(extract(epoch from x.t_out - (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)) / 60)::int else 0 end,
         x.row_source, x.row_note
  from decided x
  order by x.employee_code, x.d
$$;

-- ── leave ledger ──
-- Internal. The accruing leave type, once the rules are switched on.
create or replace function public.hr_leave_rules_type() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id from public.hr_leave_types t where t.accrual_per_month is not null and (select s.leave_rules_from from public.hr_settings s where s.id = 1) is not null
$$;

-- Internal.
create or replace function public.hr_leave_on_unpaid(p_employee uuid, p_day date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and not t.paid and p_day between r.from_date and r.to_date)
$$;

-- Internal. One row a month up to p_through. Accrual stops at p_as_of, so a pay month is worked out as at its last day and a balance as at today.
create or replace function public.hr_leave_ledger(p_employee uuid, p_type uuid, p_through date, p_as_of date)
returns table (month date, credit numeric, accrued numeric, annual_days numeric, absent_days numeric, late_days int, late_leaves int, taken numeric, from_balance numeric, unpaid numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ty public.hr_leave_types%rowtype; e public.hr_employees%rowtype; rules_from date; m date; m_end date; first_m date; bal numeric := 0; k int; at date;
begin
  select * into ty from public.hr_leave_types where id = p_type;
  select * into e from public.hr_employees where id = p_employee;
  select s.leave_rules_from into rules_from from public.hr_settings s where s.id = 1;
  if rules_from is null or ty.accrual_per_month is null then return; end if;
  first_m := date_trunc('month', greatest(rules_from, coalesce(e.join_date, rules_from)))::date;
  m := first_m;
  while m <= p_through loop
    m_end := (m + interval '1 month - 1 day')::date;
    month := m;
    credit := 0;
    if m = first_m or extract(month from m) = 1 then
      select coalesce(sum(b.entitlement + b.adjustment), 0) into credit from public.hr_leave_balances b
      where b.employee_id = p_employee and b.leave_type_id = p_type and b.year = extract(year from m)::int;
    end if;
    accrued := 0;
    if e.join_date is not null then
      k := (extract(year from m)::int * 12 + extract(month from m)::int) - (extract(year from e.join_date)::int * 12 + extract(month from e.join_date)::int);
      at := (e.join_date + make_interval(months => k))::date;
      if k > coalesce(ty.accrual_after_months, 0) and at >= rules_from and at <= p_as_of and (e.exit_date is null or at <= e.exit_date) then
        accrued := ty.accrual_per_month;
      end if;
    end if;
    select coalesce(sum(public.hr_leave_days(greatest(r.from_date, m), least(r.to_date, m_end))), 0) into annual_days
    from public.hr_leave_requests r
    where r.employee_id = p_employee and r.leave_type_id = p_type and r.status = 'approved' and r.from_date <= m_end and r.to_date >= m;
    select count(*) filter (where d.status = 'Absent' and not exists (
             select 1 from public.hr_leave_requests r where r.employee_id = p_employee and r.status = 'approved' and d.work_date between r.from_date and r.to_date)),
           count(*) filter (where d.late_minutes > 0)
      into absent_days, late_days
    from public.hr_attendance_days(m, m_end, p_employee) d;
    late_leaves := late_days / 4;
    taken := annual_days + absent_days + late_leaves;
    bal := bal + credit + accrued;
    from_balance := least(taken, greatest(bal, 0));
    unpaid := taken - from_balance;
    bal := bal - from_balance;
    closing := bal;
    return next;
    m := (m + interval '1 month')::date;
  end loop;
end $$;

-- Internal. A year of the accruing type, as hr_leave_balance shows it. null before the rules start.
create or replace function public.hr_leave_year(p_employee uuid, p_type uuid, p_year int)
returns table (carried numeric, accrued numeric, used numeric, remaining numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Asia/Dubai')::date;
  rules_year int := (select extract(year from s.leave_rules_from)::int from public.hr_settings s where s.id = 1);
  y_end date := make_date(p_year, 12, 31);
begin
  if rules_year is null or p_year < rules_year then return; end if;
  select coalesce((select l.closing from public.hr_leave_ledger(p_employee, p_type, make_date(p_year - 1, 12, 31), least(today, make_date(p_year - 1, 12, 31))) l order by l.month desc limit 1), 0) into carried;
  select coalesce(sum(l.accrued) filter (where extract(year from l.month)::int = p_year), 0),
         coalesce(sum(l.from_balance) filter (where extract(year from l.month)::int = p_year), 0),
         coalesce((array_agg(l.closing order by l.month desc))[1], 0)
    into accrued, used, remaining
  from public.hr_leave_ledger(p_employee, p_type, y_end, least(today, y_end)) l;
  return next;
end $$;

-- As in 010, with the ledger for the accruing type once the rules have started. HR any; manager direct reports; employee own.
drop function if exists public.hr_leave_balance(uuid, int);
create function public.hr_leave_balance(p_employee uuid, p_year int)
returns table (leave_type_id uuid, leave_type text, paid boolean, year int, entitlement numeric, adjustment numeric, used numeric, pending numeric, remaining numeric, carried numeric, accrued numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.hr_is_admin_or_hr() or p_employee is not distinct from public.hr_my_employee_id() or public.hr_manages(p_employee)) then
    raise exception 'You are not allowed to see this balance';
  end if;
  return query
  select t.id, t.name, t.paid, p_year,
         case when ly.remaining is not null then coalesce(b.entitlement, 0) else coalesce(b.entitlement, t.annual_days) end,
         coalesce(b.adjustment, 0),
         case when ly.remaining is not null then ly.used else u.approved end,
         u.waiting,
         case when ly.remaining is not null then ly.remaining
              when t.paid and coalesce(b.entitlement, t.annual_days) is not null then
           coalesce(b.entitlement, t.annual_days) + coalesce(b.adjustment, 0) + public.hr_leave_carried(p_employee, t.id, p_year) - u.approved
         end,
         case when ly.remaining is not null then ly.carried else public.hr_leave_carried(p_employee, t.id, p_year) end,
         coalesce(ly.accrued, 0)
  from public.hr_leave_types t
  left join public.hr_leave_balances b on b.employee_id = p_employee and b.leave_type_id = t.id and b.year = p_year
  cross join lateral (
    select coalesce(sum(r.days) filter (where r.status = 'approved'), 0) as approved, coalesce(sum(r.days) filter (where r.status = 'pending'), 0) as waiting
    from public.hr_leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and extract(year from r.from_date) = p_year
  ) u
  left join lateral (
    select * from public.hr_leave_year(p_employee, t.id, p_year) where t.id = public.hr_leave_rules_type()
  ) ly on true
  order by t.name;
end $$;

-- ── pay ──
-- Internal. Calendar days not paid in a range, for gratuity: before the rules each Absent day, after them what the ledger left unpaid.
create or replace function public.hr_pay_unpaid_total(p_employee uuid, p_from date, p_to date) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ty uuid := public.hr_leave_rules_type();
  rules_from date := (select s.leave_rules_from from public.hr_settings s where s.id = 1);
  total numeric;
begin
  if ty is null then
    select count(*) into total from public.hr_pay_unpaid_days(p_employee, p_from, p_to, false);
    return total;
  end if;
  select count(*) into total from public.hr_pay_unpaid_days(p_employee, p_from, p_to, false) u
  where u.day < date_trunc('month', rules_from)::date or u.why <> 'Absent' or public.hr_leave_on_unpaid(p_employee, u.day);
  return total + coalesce((select sum(l.unpaid) from public.hr_leave_ledger(p_employee, ty, p_to, p_to) l where l.month >= date_trunc('month', p_from)::date), 0);
end $$;

create or replace function public.hr_pay_compute(p_month date, p_employee uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  first_day date := date_trunc('month', p_month)::date;
  last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  s public.hr_settings%rowtype;
  e public.hr_employees%rowtype;
  d public.hr_pay_details%rowtype;
  has_d boolean;
  from_d date; to_d date; working boolean;
  month_units numeric; employed_units numeric; not_employed numeric; earn_units numeric;
  unit_word text;
  earn jsonb := '[]'::jsonb; ded jsonb := '[]'::jsonb; notes jsonb := '[]'::jsonb; blockers jsonb := '[]'::jsonb;
  k text; v jsonb; x numeric; y numeric; total numeric; base numeric; earned_basic numeric; earned_total numeric; earned_base numeric; raw numeric; amount numeric;
  unpaid_n numeric; unpaid_txt text; rules boolean; explicit_n numeric; lg record; ledger jsonb; present_txt text; absent_paid_txt text; half text; paid_n numeric; zero_pay boolean;
  changed boolean := false; no_earlier boolean := false;
  inputs jsonb;
begin
  select * into s from public.hr_settings where id = 1;
  select * into e from public.hr_employees where id = p_employee;
  from_d := greatest(first_day, coalesce(e.join_date, first_day));
  to_d := least(last_day, coalesce(e.exit_date, last_day));
  working := s.pay_day_divisor_mode = 'working_days';

  if e.join_date is null then blockers := blockers || to_jsonb('Join date missing'::text); end if;
  if e.status = 'Left' and e.exit_date is null then blockers := blockers || to_jsonb('Marked as left but exit date missing'::text); end if;
  if e.exit_date < e.join_date then blockers := blockers || to_jsonb(format('Exit date %s is before join date %s', e.exit_date, e.join_date)); end if;

  select * into d from public.hr_pay_details p where p.employee_id = p_employee and p.effective_from <= greatest(to_d, from_d) order by p.effective_from desc limit 1;
  has_d := found;

  month_units := case s.pay_day_divisor_mode
    when 'fixed' then s.pay_days_basis
    when 'calendar_days' then (last_day - first_day + 1)::numeric
    when 'working_days' then public.hr_pay_working_days(first_day, last_day)
  end;
  if coalesce(month_units, 0) <= 0 then raise exception 'The pay day divisor for % is zero. Check the payroll settings and the working week', to_char(first_day, 'YYYY-MM'); end if;
  unit_word := case when working then 'working days' else 'calendar days' end;
  employed_units := case when from_d > to_d then 0 when working then public.hr_pay_working_days(from_d, to_d) else (to_d - from_d + 1)::numeric end;
  not_employed := case when working then month_units - employed_units else (last_day - first_day + 1)::numeric - employed_units end;
  earn_units := greatest(0, month_units - not_employed);

  rules := public.hr_leave_rules_type() is not null and first_day >= date_trunc('month', s.leave_rules_from)::date;
  if rules then
    select count(*), string_agg(u.day || ' Unpaid leave', ', ' order by u.day) into explicit_n, unpaid_txt
    from public.hr_pay_unpaid_days(p_employee, from_d, to_d, working) u where u.why <> 'Absent' or public.hr_leave_on_unpaid(p_employee, u.day);
    select * into lg from public.hr_leave_ledger(p_employee, public.hr_leave_rules_type(), last_day, last_day) l where l.month = first_day;
    unpaid_n := explicit_n + coalesce(lg.unpaid, 0);
    if coalesce(lg.taken, 0) > 0 then
      notes := notes || to_jsonb(format('Leave taken %s: Annual %s, Absent %s, from %s late days %s. Annual balance covered %s, leaving %s. Unpaid %s',
        lg.taken, lg.annual_days, lg.absent_days, lg.late_days, lg.late_leaves, lg.from_balance, lg.closing, lg.unpaid));
    end if;
    if coalesce(lg.unpaid, 0) > 0 then
      unpaid_txt := concat_ws(', ', unpaid_txt, format('%s beyond the Annual balance', lg.unpaid));
    end if;
    ledger := to_jsonb(lg);
  else
    select count(*), string_agg(u.day || ' ' || u.why, ', ' order by u.day) into unpaid_n, unpaid_txt from public.hr_pay_unpaid_days(p_employee, from_d, to_d, working) u;
  end if;
  zero_pay := employed_units = 0 or unpaid_n >= employed_units;

  if not has_d then
    blockers := blockers || to_jsonb('No pay details effective in this month'::text);
  else
    if d.iban is null then blockers := blockers || to_jsonb('IBAN missing'::text); end if;
    no_earlier := from_d <= to_d and not exists (select 1 from public.hr_pay_details p where p.employee_id = p_employee and p.effective_from <= from_d);
    if no_earlier then
      blockers := blockers || to_jsonb(format('No pay defined for %s to %s: the first pay details start on %s',
        from_d, (select min(p.effective_from) - 1 from public.hr_pay_details p where p.employee_id = p_employee), (select min(p.effective_from) from public.hr_pay_details p where p.employee_id = p_employee)));
    end if;
    changed := not no_earlier and d.effective_from > from_d;
    if changed then
      notes := notes || to_jsonb(format('Pay changed during the month on %s. The new pay is used for the whole month. Please review and adjust', d.effective_from));
    end if;

    if not_employed = 0 then
      notes := notes || to_jsonb('Employed the whole month: monthly wage earned in full'::text);
    else
      notes := notes || to_jsonb(format('Employed %s to %s, %s %s outside employment. Each amount is monthly x (%s - %s) / %s (%s)',
        from_d, to_d, not_employed, unit_word, month_units, not_employed, month_units, s.pay_day_divisor_mode));
    end if;
    if month_units - not_employed - unpaid_n <= 0 and not zero_pay then
      notes := notes || to_jsonb(format('Days outside employment and unpaid days use up the whole fixed basis of %s, so the paid fraction is 0 although some days were worked. Please review and adjust', month_units));
    end if;

    total := d.basic;
    earned_basic := case when zero_pay then 0 else round(d.basic * earn_units / month_units, 2) end;
    earned_total := earned_basic;
    earn := earn || jsonb_build_object('label', 'Basic', 'amount', earned_basic);
    for k, v in select * from jsonb_each(d.allowances) order by 1 loop
      x := (v #>> '{}')::numeric;
      y := case when zero_pay then 0 else round(x * earn_units / month_units, 2) end;
      total := total + x;
      earned_total := earned_total + y;
      earn := earn || jsonb_build_object('label', k, 'amount', y);
    end loop;
    notes := notes || to_jsonb(format('Monthly wage: basic %s, allowances %s, total %s (pay details from %s)', public.hr_pay_money(d.basic), public.hr_pay_money(total - d.basic), public.hr_pay_money(total), d.effective_from));

    if zero_pay then
      notes := notes || to_jsonb(format('Every employed day is unpaid or there is no employed day (%s of %s %s unpaid%s): pay is exactly 0, whichever wage base is set', unpaid_n, employed_units, unit_word, case when unpaid_txt is null then '' else ': ' || unpaid_txt end));
    elsif unpaid_n > 0 then
      base := case s.pay_unpaid_wage_base when 'basic' then d.basic else total end;
      earned_base := case s.pay_unpaid_wage_base when 'basic' then earned_basic else earned_total end;
      raw := round(base * unpaid_n / month_units, 2);
      amount := least(raw, earned_base);
      ded := ded || jsonb_build_object('label', 'Unpaid days', 'amount', amount, 'days', unpaid_n);
      notes := notes || to_jsonb(format('Unpaid days %s (%s): %s. Deducted %s x %s / %s = %s from the %s wage', unpaid_n, unit_word, unpaid_txt, public.hr_pay_money(base), unpaid_n, month_units, public.hr_pay_money(raw), s.pay_unpaid_wage_base));
      if amount < raw then
        notes := notes || to_jsonb(format('The deduction is held at %s, what was earned of the %s wage, so that part cannot go below 0', public.hr_pay_money(amount), s.pay_unpaid_wage_base));
      end if;
      if s.pay_unpaid_wage_base = 'basic' and total > d.basic then
        notes := notes || to_jsonb('Unpaid days reduce the basic wage only: allowances remain payable'::text);
      end if;
    end if;
  end if;

  select string_agg(a.work_date::text, ', ' order by a.work_date) into present_txt
  from public.hr_attendance a
  where a.employee_id = p_employee and a.status = 'Present' and a.work_date between from_d and to_d
    and exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id where r.employee_id = p_employee and r.status = 'approved' and not t.paid and a.work_date between r.from_date and r.to_date);
  if present_txt is not null then
    notes := notes || to_jsonb(format('Present is recorded inside approved unpaid leave on %s. Approved leave is counted. Please review', present_txt));
  end if;

  select string_agg(a.work_date::text, ', ' order by a.work_date) into absent_paid_txt
  from public.hr_attendance a
  where a.employee_id = p_employee and a.status = 'Absent' and a.work_date between from_d and to_d
    and exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id where r.employee_id = p_employee and r.status = 'approved' and t.paid and a.work_date between r.from_date and r.to_date);
  if absent_paid_txt is not null then
    notes := notes || to_jsonb(format('Absent is recorded inside approved paid leave on %s. Approved leave is counted, so pay is not reduced. Please review', absent_paid_txt));
  end if;

  if from_d <= to_d then
    select sum(public.hr_leave_days(greatest(r.from_date, from_d), least(r.to_date, to_d))) into paid_n
    from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and t.paid and r.from_date <= to_d and r.to_date >= from_d;
  end if;
  if coalesce(paid_n, 0) > 0 then notes := notes || to_jsonb(format('Paid leave %s working days: counted as fully paid', paid_n)); end if;

  select string_agg(distinct t.name, ', ') into half
  from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
  where r.employee_id = p_employee and r.status = 'approved' and t.half_pay_note and r.from_date <= to_d and r.to_date >= from_d;
  if half is not null then
    notes := notes || to_jsonb(format('Leave of a type that may have half-pay tiers (%s) is counted as fully paid here. Please review and adjust', half));
  end if;

  -- jsonb text has a fixed key order, so equal inputs give an equal hash
  inputs := jsonb_build_object(
    'month', first_day,
    'ledger', ledger,
    'employee', jsonb_build_object('join_date', e.join_date, 'exit_date', e.exit_date, 'status', e.status),
    'details', case when has_d then jsonb_build_object('id', d.id, 'effective_from', d.effective_from, 'basic', d.basic, 'allowances', d.allowances, 'iban', d.iban, 'bank_routing', d.bank_routing, 'wps_labour_card', d.wps_labour_card, 'changed', changed, 'no_earlier', no_earlier) end,
    'attendance', coalesce((select jsonb_agg(jsonb_build_array(a.work_date, a.status) order by a.work_date) from public.hr_attendance a where a.employee_id = p_employee and a.work_date between first_day and last_day), '[]'::jsonb),
    'leave', coalesce((select jsonb_agg(jsonb_build_array(r.from_date, r.to_date, r.leave_type_id, t.paid, t.half_pay_note) order by r.from_date, r.id) from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id where r.employee_id = p_employee and r.status = 'approved' and r.from_date <= last_day and r.to_date >= first_day), '[]'::jsonb),
    'settings', jsonb_build_object('mode', s.pay_day_divisor_mode, 'basis', s.pay_days_basis, 'wage_base', s.pay_unpaid_wage_base, 'weekend', s.weekend_days),
    'holidays', coalesce((select jsonb_agg(h.holiday_date order by h.holiday_date) from public.hr_holidays h where h.holiday_date between first_day and last_day), '[]'::jsonb)
  );
  return jsonb_build_object('earnings', earn, 'deductions', ded, 'notes', notes, 'blockers', blockers, 'pay_change', changed,
    'pay_detail_id', case when has_d then d.id end,
    'input_hash', encode(sha256(convert_to(inputs::text, 'UTF8')), 'hex'));
end $$;

create or replace function public.hr_gratuity(p_employee uuid, p_exit date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.hr_settings%rowtype; e public.hr_employees%rowtype; d public.hr_pay_details%rowtype;
  allowances_total numeric; excluded numeric; service_end date; age_v interval; whole int; months int; rem_days int;
  years numeric := 0; gdays numeric := 0; uncapped numeric := 0; cap numeric; amount numeric := 0;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to see gratuity'; end if;
  select * into s from public.hr_settings where id = 1;
  if s.gratuity_fraction_method is null then raise exception 'Payroll setting missing: Gratuity part-year method. Set it in HR Settings first'; end if;
  if s.gratuity_cap_base is null then raise exception 'Payroll setting missing: Gratuity cap base. Set it in HR Settings first'; end if;
  if s.gratuity_daily_divisor is null then raise exception 'Payroll setting missing: Gratuity daily divisor. Set it in HR Settings first'; end if;
  if s.gratuity_service_end_inclusive is null then raise exception 'Payroll setting missing: Gratuity service end date rule. Set it in HR Settings first'; end if;
  select * into e from public.hr_employees where id = p_employee;
  if not found then raise exception 'Employee not found'; end if;
  if p_exit is null then raise exception 'The exit date is required'; end if;
  if e.join_date is null then raise exception 'This employee has no join date'; end if;
  if p_exit < e.join_date then raise exception 'The exit date is before the join date'; end if;
  select * into d from public.hr_pay_details p where p.employee_id = p_employee and p.effective_from <= p_exit order by p.effective_from desc limit 1;
  if not found then raise exception 'This employee has no pay details effective on the exit date'; end if;
  select coalesce(sum((v #>> '{}')::numeric), 0) into allowances_total from jsonb_each(d.allowances) as t(k, v);

  excluded := public.hr_pay_unpaid_total(p_employee, e.join_date, p_exit); -- every calendar day
  service_end := p_exit + (case when s.gratuity_service_end_inclusive then 1 else 0 end) - ceil(excluded)::int; -- exclusive end of service
  if service_end > e.join_date then
    age_v := age(service_end, e.join_date);
    whole := extract(year from age_v)::int;
    months := extract(month from age_v)::int;
    rem_days := service_end - (e.join_date + make_interval(years => whole))::date;
    if whole >= 1 then -- G1: nothing under one year; G4: part years count once a year is completed
      years := whole + case s.gratuity_fraction_method when 'months_12' then months::numeric / 12 else rem_days::numeric / 365 end;
      gdays := 21 * least(years, 5) + 30 * greatest(years - 5, 0);
      uncapped := round(gdays * d.basic / s.gratuity_daily_divisor, 2);
    end if;
  end if;
  cap := round(24 * case s.gratuity_cap_base when 'basic' then d.basic else d.basic + allowances_total end, 2);
  amount := least(uncapped, cap);
  return jsonb_build_object(
    'join_date', e.join_date, 'exit_date', p_exit, 'excluded_unpaid_days', excluded,
    'whole_years', coalesce(whole, 0), 'years', round(years, 4), 'days', round(gdays, 4),
    'basic', d.basic, 'daily_wage', round(d.basic / s.gratuity_daily_divisor, 2),
    'uncapped', uncapped, 'cap', cap, 'capped', uncapped > cap, 'amount', amount,
    'settings', jsonb_build_object('daily_divisor', s.gratuity_daily_divisor, 'cap_base', s.gratuity_cap_base, 'part_year_method', s.gratuity_fraction_method, 'exit_date_counts', s.gratuity_service_end_inclusive),
    'note', 'Full-time foreign worker rules only. Not for UAE nationals, part-time staff, free-zone employers with their own law, or staff on the savings scheme. Check before relying on it.');
end $$;

-- ── salary payments ──
create table if not exists public.hr_salary_payments (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.hr_pay_lines(id) on delete restrict,
  amount numeric(18,2) not null check (amount > 0),
  paid_on date not null,
  reference text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists hr_salary_payments_line_idx on public.hr_salary_payments (line_id);
alter table public.hr_salary_payments enable row level security;
revoke all on public.hr_salary_payments from public, anon, authenticated;

-- HR, admin and the Accounts team. banking_can comes from Banking Base, which HR does not otherwise need.
create or replace function public.hr_salaries_allowed() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public.hr_is_admin_or_hr() then return true; end if;
  if to_regprocedure('public.banking_can(text)') is null then return false; end if;
  return public.banking_can('accounts.review');
end $$;

-- One row per approved run in a year: Payable, Paid, Outstanding.
create or replace function public.hr_salaries_overview(p_year int)
returns table (run_id uuid, period_month date, people int, payable numeric, paid numeric, outstanding numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to see salaries'; end if;
  return query
  select r.id, r.period_month, count(l.id)::int, coalesce(sum(l.net), 0)::numeric, coalesce(sum(pd.total), 0)::numeric, (coalesce(sum(l.net), 0) - coalesce(sum(pd.total), 0))::numeric
  from public.hr_pay_runs r
  left join public.hr_pay_lines l on l.run_id = r.id
  left join lateral (select coalesce(sum(p.amount), 0) as total from public.hr_salary_payments p where p.line_id = l.id) pd on true
  where r.status = 'approved' and extract(year from r.period_month)::int = p_year
  group by r.id, r.period_month
  order by r.period_month desc;
end $$;

-- A run's people, with what was paid and each payment.
create or replace function public.hr_salaries_month(p_run uuid)
returns table (line_id uuid, employee_code text, full_name text, iban text, net numeric, paid numeric, outstanding numeric, payments jsonb)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to see salaries'; end if;
  return query
  select l.id, e.employee_code, e.full_name, l.iban, l.net::numeric, pd.total, (l.net - pd.total)::numeric, pd.items
  from public.hr_pay_lines l
  join public.hr_pay_runs r on r.id = l.run_id and r.status = 'approved'
  join public.hr_employees e on e.id = l.employee_id
  cross join lateral (
    select coalesce(sum(p.amount), 0)::numeric as total,
           coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'amount', p.amount, 'paid_on', p.paid_on, 'reference', p.reference) order by p.paid_on, p.created_at), '[]'::jsonb) as items
    from public.hr_salary_payments p where p.line_id = l.id
  ) pd
  where l.run_id = p_run
  order by e.employee_code;
end $$;

-- p_amount null pays what is outstanding. Never more than that, and only on an approved line.
create or replace function public.hr_salary_pay(p_line uuid, p_amount numeric, p_paid_on date, p_reference text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.hr_pay_lines%rowtype; owed numeric; amt numeric; new_id uuid;
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to record salary payments'; end if;
  if p_paid_on is null then raise exception 'The payment date is required'; end if;
  if p_paid_on > (now() at time zone 'Asia/Dubai')::date then raise exception 'The payment date cannot be in the future'; end if;
  select * into l from public.hr_pay_lines where id = p_line for update;
  if not found then raise exception 'Salary line not found'; end if;
  if not public.hr_pay_run_approved(l.run_id) then raise exception 'Only an approved run can be paid'; end if;
  owed := l.net - coalesce((select sum(p.amount) from public.hr_salary_payments p where p.line_id = p_line), 0);
  amt := coalesce(p_amount, owed);
  if amt <= 0 then raise exception 'The amount must be more than 0'; end if;
  if amt > owed then raise exception 'The amount is more than the % outstanding', owed; end if;
  insert into public.hr_salary_payments (line_id, amount, paid_on, reference) values (p_line, amt, p_paid_on, nullif(btrim(coalesce(p_reference, '')), '')) returning id into new_id;
  perform public.hr_audit('salary.paid', 'hr_pay_lines:' || p_line, null, jsonb_build_object('amount', amt, 'paid_on', p_paid_on, 'reference', p_reference));
  return new_id;
end $$;

-- Pays everything outstanding in a run at once. Returns how many people were paid.
create or replace function public.hr_salary_pay_all(p_run uuid, p_paid_on date, p_reference text) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare x record; n int := 0;
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to record salary payments'; end if;
  for x in select m.line_id from public.hr_salaries_month(p_run) m where m.outstanding > 0 loop
    perform public.hr_salary_pay(x.line_id, null, p_paid_on, p_reference);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A mistake is removed, and the removal stays in the audit log.
create or replace function public.hr_salary_payment_remove(p_payment uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.hr_salary_payments%rowtype;
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to record salary payments'; end if;
  select * into p from public.hr_salary_payments where id = p_payment;
  if not found then raise exception 'Payment not found'; end if;
  delete from public.hr_salary_payments where id = p_payment;
  perform public.hr_audit('salary.payment_removed', 'hr_pay_lines:' || p.line_id, jsonb_build_object('amount', p.amount, 'paid_on', p.paid_on, 'reference', p.reference), null);
end $$;

-- ── grants ──
revoke all on function public.hr_leave_rules_type(), public.hr_leave_on_unpaid(uuid, date), public.hr_leave_ledger(uuid, uuid, date, date), public.hr_leave_year(uuid, uuid, int),
  public.hr_pay_unpaid_total(uuid, date, date), public.hr_salaries_allowed(), public.hr_salaries_overview(int), public.hr_salaries_month(uuid),
  public.hr_salary_pay(uuid, numeric, date, text), public.hr_salary_pay_all(uuid, date, text), public.hr_salary_payment_remove(uuid) from public, anon, authenticated;
revoke all on function public.hr_leave_balance(uuid, int) from public, anon, authenticated;
grant execute on function public.hr_leave_balance(uuid, int), public.hr_salaries_allowed(), public.hr_salaries_overview(int), public.hr_salaries_month(uuid),
  public.hr_salary_pay(uuid, numeric, date, text), public.hr_salary_pay_all(uuid, date, text), public.hr_salary_payment_remove(uuid) to authenticated;
