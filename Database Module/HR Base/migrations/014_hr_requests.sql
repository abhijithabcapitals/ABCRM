-- =====================================================================
-- HR Base - staff requests, Finance Managers, profile records      014
-- =====================================================================
-- hr_insurance, hr_mobile_plans, hr_assets: HR writes, the employee reads their own, managers nothing.
-- hr_finance_managers: who approves expense claims. Administrators manage the list and can approve too.
-- hr_requests: half day, work from home, late concession, overtime payment, expense reimbursement and other. Leave stays in hr_leave_requests.
--   Written and read only through functions. Nobody decides their own. Expense claims go to a Finance Manager, Other to HR, and the rest to HR or the direct manager.
--   A manager may approve overtime with no amount; HR enters it later. An approved claim with no amount pays nothing.
-- Effects once approved, all worked out when read, so cancelling undoes them:
--   work from home: the day is WFH unless edited by hand or on leave or a holiday. Late concession: the day is not late.
--   half day: the day is not late, and takes 0.5 from the Annual balance if it was worked. A day with no punches stays Absent.
--   overtime: added to the month's draft pay as Overtime claims. An approved run does not change.
--   expense claim: Accounts lists it and records the payment, which moves no money.
-- Requires 001 to 013. Idempotent.
-- =====================================================================
create table if not exists public.hr_insurance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  company text not null,
  plan_name text,
  covered text,
  start_date date,
  tenure_months int check (tenure_months > 0),
  end_date date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (end_date is null or start_date is null or end_date >= start_date)
);
create table if not exists public.hr_mobile_plans (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  phone_number text not null,
  provider text,
  plan_name text,
  recharge_date date,
  next_recharge_date date,
  amount numeric(18,2) check (amount >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.hr_assets (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  asset_type text not null,
  make_model text,
  serial_number text,
  issued_on date,
  returned_on date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (returned_on is null or issued_on is null or returned_on >= issued_on)
);
do $do$
declare t text;
begin
  foreach t in array array['hr_insurance', 'hr_mobile_plans', 'hr_assets'] loop
    execute format('create index if not exists %I on public.%I (employee_id)', t || '_employee_idx', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.hr_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_hr', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr())', t || '_hr', t);
    execute format('drop policy if exists %I on public.%I', t || '_self', t);
    execute format('create policy %I on public.%I for select to authenticated using (employee_id = public.hr_my_employee_id())', t || '_self', t);
  end loop;
end $do$;
alter table public.hr_insurance enable row level security;
alter table public.hr_mobile_plans enable row level security;
alter table public.hr_assets enable row level security;

-- ── Finance Managers ──
create table if not exists public.hr_finance_managers (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid default auth.uid()
);
alter table public.hr_finance_managers enable row level security;
revoke all on public.hr_finance_managers from public, anon, authenticated;
grant select, insert, delete on public.hr_finance_managers to authenticated;
drop policy if exists hr_finance_managers_admin on public.hr_finance_managers;
create policy hr_finance_managers_admin on public.hr_finance_managers for all to authenticated using (public.admin_is()) with check (public.admin_is());
drop policy if exists hr_finance_managers_read on public.hr_finance_managers;
create policy hr_finance_managers_read on public.hr_finance_managers for select to authenticated using (public.hr_is_admin_or_hr() or profile_id = auth.uid());

create or replace function public.hr_is_finance() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.admin_is() or exists (select 1 from public.hr_finance_managers f where f.profile_id = auth.uid())
$$;

-- ── requests ──
create table if not exists public.hr_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  kind text not null check (kind in ('half_day', 'wfh', 'late_concession', 'overtime', 'reimbursement', 'other')),
  work_date date,
  hours numeric check (hours > 0),
  amount numeric(18,2) check (amount >= 0),
  note text,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  paid_on date,
  paid_reference text,
  paid_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists hr_requests_employee_idx on public.hr_requests (employee_id, work_date);
alter table public.hr_requests enable row level security;
revoke all on public.hr_requests from public, anon, authenticated;

-- ── days, leave and pay ──
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
           lv.kind, h.id is not null as is_holiday,
           exists (select 1 from public.hr_requests q where q.employee_id = p.id and q.work_date = g.d::date and q.status = 'approved' and q.kind = 'wfh') as wfh_ok,
           exists (select 1 from public.hr_requests q where q.employee_id = p.id and q.work_date = g.d::date and q.status = 'approved' and q.kind in ('half_day', 'late_concession')) as excused
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
             when dy.wfh_ok then 'WFH'
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
         case when x.st = 'Present' and not x.is_off and not x.excused and x.t_in > x.shift_start
                   and (x.t_out is null or x.t_out - x.t_in < (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end) - x.shift_start)
              then ceil(extract(epoch from x.t_in - x.shift_start) / 60)::int else 0 end,
         case when x.st = 'Present' and not x.is_off and x.t_out is not null
                   and x.t_out > (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)
              then ceil(extract(epoch from x.t_out - (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)) / 60)::int else 0 end,
         x.row_source, x.row_note
  from decided x
  order by x.employee_code, x.d
$$;

create or replace function public.hr_leave_ledger(p_employee uuid, p_type uuid, p_through date, p_as_of date)
returns table (month date, credit numeric, accrued numeric, annual_days numeric, absent_days numeric, late_days int, late_leaves int, taken numeric, from_balance numeric, unpaid numeric, closing numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ty public.hr_leave_types%rowtype; e public.hr_employees%rowtype; rules_from date; m date; m_end date; first_m date; bal numeric := 0; k int; at date; half_n int;
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
    -- An approved half day on a day with no punches stays Absent, so only a day that was worked takes the half.
    select count(*) into half_n from public.hr_requests q
    cross join lateral public.hr_attendance_days(q.work_date, q.work_date, p_employee) d
    where q.employee_id = p_employee and q.kind = 'half_day' and q.status = 'approved' and q.work_date between m and m_end and d.status in ('Present', 'WFH');
    annual_days := annual_days + 0.5 * half_n;
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
  unpaid_n numeric; unpaid_txt text; rules boolean; overtime_amt numeric := 0; explicit_n numeric; lg record; ledger jsonb; present_txt text; absent_paid_txt text; half text; paid_n numeric; zero_pay boolean;
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

  select coalesce(sum(q.amount), 0) into overtime_amt from public.hr_requests q
  where q.employee_id = p_employee and q.kind = 'overtime' and q.status = 'approved' and q.work_date between first_day and last_day;
  if has_d and overtime_amt > 0 then
    earn := earn || jsonb_build_object('label', 'Overtime claims', 'amount', overtime_amt);
    notes := notes || to_jsonb(format('Approved overtime claims in this month: %s', public.hr_pay_money(overtime_amt)));
  end if;
  if exists (select 1 from public.hr_requests q where q.employee_id = p_employee and q.kind = 'overtime' and q.status = 'approved' and q.amount is null and q.work_date between first_day and last_day) then
    notes := notes || to_jsonb('An approved overtime claim is waiting for HR to enter its amount, so it is not in this pay'::text);
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
    'overtime', overtime_amt,
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

-- Internal. Who may decide this request. Nobody decides their own.
create or replace function public.hr_request_can_decide(p_kind text, p_employee uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_employee is distinct from public.hr_my_employee_id() and case p_kind
    when 'reimbursement' then public.hr_is_finance()
    when 'other' then public.hr_is_admin_or_hr()
    else public.hr_is_admin_or_hr() or public.hr_manages(p_employee)
  end
$$;

-- What the caller may see: HR everything, the employee their own, a manager direct reports except expense claims, a Finance Manager expense claims.
create or replace function public.hr_requests_list()
returns table (id uuid, employee_id uuid, employee_code text, full_name text, kind text, work_date date, hours numeric, amount numeric, note text, storage_path text, status text,
               decision_note text, decided_at timestamptz, paid_on date, paid_reference text, created_at timestamptz, can_decide boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select q.id, q.employee_id, e.employee_code, e.full_name, q.kind, q.work_date, q.hours, q.amount::numeric, q.note, q.storage_path, q.status, q.decision_note, q.decided_at, q.paid_on, q.paid_reference, q.created_at,
         q.status = 'pending' and public.hr_request_can_decide(q.kind, q.employee_id)
  from public.hr_requests q join public.hr_employees e on e.id = q.employee_id
  where public.hr_is_admin_or_hr() or q.employee_id = public.hr_my_employee_id()
     or (q.kind <> 'reimbursement' and public.hr_manages(q.employee_id))
     or (q.kind = 'reimbursement' and public.hr_is_finance())
  order by q.created_at desc
$$;

-- The employee for themselves; HR for anyone.
create or replace function public.hr_request_create(p_employee uuid, p_kind text, p_date date, p_hours numeric, p_amount numeric, p_note text, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Asia/Dubai')::date;
  new_id uuid; note_v text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not (public.hr_is_admin_or_hr() or p_employee is not distinct from public.hr_my_employee_id()) or p_employee is null then
    raise exception 'You can only raise a request for yourself';
  end if;
  if p_kind not in ('half_day', 'wfh', 'late_concession', 'overtime', 'reimbursement', 'other') then raise exception 'Unknown request type %', p_kind; end if;
  if p_kind <> 'other' and p_date is null then raise exception 'The date is required'; end if;
  if p_kind in ('late_concession', 'overtime', 'reimbursement') and p_date > today then raise exception 'The date cannot be in the future'; end if;
  if p_kind = 'overtime' and coalesce(p_hours, 0) <= 0 then raise exception 'Enter the overtime hours'; end if;
  if p_kind = 'reimbursement' then
    if coalesce(p_amount, 0) <= 0 then raise exception 'Enter the amount'; end if;
    if p_path is null then raise exception 'Attach the document'; end if;
    if split_part(p_path, '/', 1) <> p_employee::text then raise exception 'The document is not in this employee''s folder'; end if;
  end if;
  if p_kind = 'other' and note_v is null then raise exception 'Say what the request is'; end if;
  if p_kind in ('half_day', 'wfh', 'late_concession', 'overtime') and exists (
    select 1 from public.hr_requests q where q.employee_id = p_employee and q.kind = p_kind and q.work_date = p_date and q.status in ('pending', 'approved')) then
    raise exception 'There is already a request like this for that date';
  end if;
  insert into public.hr_requests (employee_id, kind, work_date, hours, amount, note, storage_path)
  values (p_employee, p_kind, p_date, case when p_kind = 'overtime' then p_hours end, case when p_kind = 'reimbursement' then p_amount end, note_v, case when p_kind = 'reimbursement' then p_path end)
  returning id into new_id;
  perform public.hr_audit('request.created', 'hr_requests:' || new_id, null, jsonb_build_object('employee_id', p_employee, 'kind', p_kind, 'work_date', p_date));
  return new_id;
end $$;

-- p_amount is for overtime, and only HR may set it. Returns {warning} when the date is in a locked month.
create or replace function public.hr_request_decide(p_request uuid, p_approve boolean, p_note text, p_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.hr_requests%rowtype; new_status text; locked text;
begin
  select * into q from public.hr_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if q.employee_id is not distinct from public.hr_my_employee_id() then raise exception 'You cannot decide your own request'; end if;
  if not public.hr_request_can_decide(q.kind, q.employee_id) then raise exception 'You are not allowed to decide this request'; end if;
  if q.status <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', q.status; end if;
  if p_amount is not null then
    if q.kind <> 'overtime' then raise exception 'Only overtime takes an amount here'; end if;
    if not public.hr_is_admin_or_hr() then raise exception 'Only HR can enter the overtime amount'; end if;
    if p_amount < 0 then raise exception 'The amount cannot be below 0'; end if;
  end if;
  new_status := case when p_approve then 'approved' else 'rejected' end;
  update public.hr_requests set status = new_status, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), ''),
    amount = case when p_approve and q.kind = 'overtime' then p_amount else amount end
  where id = p_request;
  perform public.hr_audit('request.' || new_status, 'hr_requests:' || p_request, jsonb_build_object('status', q.status), jsonb_build_object('status', new_status, 'amount', p_amount, 'note', p_note));
  if p_approve and q.kind in ('half_day', 'wfh', 'late_concession', 'overtime') then locked := public.hr_locked_month_warning(q.work_date, q.work_date); end if;
  return jsonb_build_object('warning', locked);
end $$;

-- HR, for overtime a manager approved without an amount, or to correct one.
create or replace function public.hr_request_overtime_amount(p_request uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.hr_requests%rowtype;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can enter the overtime amount'; end if;
  select * into q from public.hr_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if q.kind <> 'overtime' or q.status <> 'approved' then raise exception 'Only an approved overtime request takes an amount'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Enter an amount of 0 or more'; end if;
  update public.hr_requests set amount = p_amount where id = p_request;
  perform public.hr_audit('request.overtime_amount', 'hr_requests:' || p_request, jsonb_build_object('amount', q.amount), jsonb_build_object('amount', p_amount));
  return jsonb_build_object('warning', public.hr_locked_month_warning(q.work_date, q.work_date));
end $$;

-- The employee while it is pending. HR also once approved, unless it has been paid.
create or replace function public.hr_request_cancel(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.hr_requests%rowtype;
begin
  select * into q from public.hr_requests where id = p_request for update;
  if not found then raise exception 'Request not found'; end if;
  if not (public.hr_is_admin_or_hr() or (q.employee_id is not distinct from public.hr_my_employee_id() and q.status = 'pending')) then raise exception 'You are not allowed to cancel this request'; end if;
  if q.status not in ('pending', 'approved') then raise exception 'This request is already %', q.status; end if;
  if q.paid_on is not null then raise exception 'This claim has been paid. Accounts must remove the payment first'; end if;
  update public.hr_requests set status = 'cancelled', decided_by = auth.uid(), decided_at = now() where id = p_request;
  perform public.hr_audit('request.cancelled', 'hr_requests:' || p_request, jsonb_build_object('status', q.status), jsonb_build_object('status', 'cancelled'));
  return jsonb_build_object('warning', case when q.status = 'approved' and q.work_date is not null and q.kind <> 'reimbursement' then public.hr_locked_month_warning(q.work_date, q.work_date) end);
end $$;

-- ── expense claims in Accounts ──
create or replace function public.hr_expenses_list()
returns table (id uuid, employee_code text, full_name text, work_date date, amount numeric, note text, storage_path text, decided_at timestamptz, paid_on date, paid_reference text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.hr_salaries_allowed() or public.hr_is_finance()) then raise exception 'You are not allowed to see expense claims'; end if;
  return query
  select q.id, e.employee_code, e.full_name, q.work_date, q.amount::numeric, q.note, q.storage_path, q.decided_at, q.paid_on, q.paid_reference
  from public.hr_requests q join public.hr_employees e on e.id = q.employee_id
  where q.kind = 'reimbursement' and q.status = 'approved'
  order by q.paid_on is not null, q.decided_at desc;
end $$;

create or replace function public.hr_expense_pay(p_request uuid, p_paid_on date, p_reference text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.hr_requests%rowtype;
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to record this payment'; end if;
  if p_paid_on is null then raise exception 'The payment date is required'; end if;
  if p_paid_on > (now() at time zone 'Asia/Dubai')::date then raise exception 'The payment date cannot be in the future'; end if;
  select * into q from public.hr_requests where id = p_request for update;
  if not found or q.kind <> 'reimbursement' or q.status <> 'approved' then raise exception 'Only an approved expense claim can be paid'; end if;
  if q.paid_on is not null then raise exception 'This claim is already paid'; end if;
  update public.hr_requests set paid_on = p_paid_on, paid_reference = nullif(btrim(coalesce(p_reference, '')), ''), paid_by = auth.uid() where id = p_request;
  perform public.hr_audit('expense.paid', 'hr_requests:' || p_request, null, jsonb_build_object('amount', q.amount, 'paid_on', p_paid_on, 'reference', p_reference));
end $$;

create or replace function public.hr_expense_unpay(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.hr_requests%rowtype;
begin
  if not public.hr_salaries_allowed() then raise exception 'You are not allowed to change this payment'; end if;
  select * into q from public.hr_requests where id = p_request for update;
  if not found or q.paid_on is null then raise exception 'This claim is not paid'; end if;
  update public.hr_requests set paid_on = null, paid_reference = null, paid_by = null where id = p_request;
  perform public.hr_audit('expense.payment_removed', 'hr_requests:' || p_request, jsonb_build_object('amount', q.amount, 'paid_on', q.paid_on, 'reference', q.paid_reference), null);
end $$;

-- ── grants and files ──
revoke all on function public.hr_is_finance(), public.hr_request_can_decide(text, uuid), public.hr_requests_list(), public.hr_request_create(uuid, text, date, numeric, numeric, text, text),
  public.hr_request_decide(uuid, boolean, text, numeric), public.hr_request_overtime_amount(uuid, numeric), public.hr_request_cancel(uuid),
  public.hr_expenses_list(), public.hr_expense_pay(uuid, date, text), public.hr_expense_unpay(uuid) from public, anon, authenticated;
grant execute on function public.hr_is_finance(), public.hr_requests_list(), public.hr_request_create(uuid, text, date, numeric, numeric, text, text),
  public.hr_request_decide(uuid, boolean, text, numeric), public.hr_request_overtime_amount(uuid, numeric), public.hr_request_cancel(uuid),
  public.hr_expenses_list(), public.hr_expense_pay(uuid, date, text), public.hr_expense_unpay(uuid) to authenticated;

-- A Finance Manager or Accounts may open the document on an expense claim, and nothing else in the folder.
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: skipped';
    return;
  end if;
  drop policy if exists hr_docs_expense_read on storage.objects;
  create policy hr_docs_expense_read on storage.objects for select to authenticated
    using (bucket_id = 'hr-documents' and (public.hr_is_finance() or public.hr_salaries_allowed())
      and exists (select 1 from public.hr_requests q where q.storage_path = name and q.kind = 'reimbursement'));
end $do$;
