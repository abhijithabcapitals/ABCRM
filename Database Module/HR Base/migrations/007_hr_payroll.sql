-- =====================================================================
-- HR Base - payroll runs                                           007
-- =====================================================================
-- hr_pay_details: salary with effective dates, IBAN, routing code, labour card. HR only: employees and managers read nothing here.
--   The IBAN is never written to hr_audit_log and never echoed in an error; audit records only that it changed.
-- hr_pay_runs and hr_pay_lines: written only by functions. HR and admin read all; an employee reads their own line once the run is
--   approved, and nobody reads anybody else's. Approved runs and lines reject insert, update, delete and truncate for everyone,
--   the table owner included.
-- Figures: no rate, divisor or wage base is built in. PAYROLL_RULES.md marks P3, P5, P6, G3b, G5 and the service-count rule as
--   company policy decisions, so they are settings that start null, and a run or gratuity calculation names what is missing.
--   Divisor: pay_day_divisor_mode. fixed = pay_days_basis, calendar_days = days in the month, working_days = days neither weekend nor holiday.
--   The arithmetic, and how the unpaid wage base meets the paid fraction, is described above hr_pay_compute.
--   Paid leave counts as fully paid; half-pay tiers are not calculated (leave types marked half_pay_note put a review note on the line).
--   A pay change inside the month blocks approval until the line carries an adjustment made against the pay row now in use (the audited way HR records that it was dealt with).
-- Rounding: each money figure round(x, 2); net = earnings - deductions + adjustments from the rounded parts.
-- input_hash: sha-256 over everything a line was computed from. Approval recomputes each line; any difference stops approval.
-- Requires 002 (access helpers, hr_audit), 003 (hr_touch), 005 (settings, leave), 006 (attendance). Idempotent.
-- =====================================================================
alter table public.hr_settings add column if not exists pay_day_divisor_mode text check (pay_day_divisor_mode in ('fixed', 'calendar_days', 'working_days'));
alter table public.hr_settings add column if not exists pay_unpaid_wage_base text check (pay_unpaid_wage_base in ('basic', 'total'));
alter table public.hr_settings add column if not exists gratuity_fraction_method text check (gratuity_fraction_method in ('months_12', 'days_365'));
alter table public.hr_settings add column if not exists gratuity_cap_base text check (gratuity_cap_base in ('basic', 'total'));
alter table public.hr_settings add column if not exists gratuity_daily_divisor numeric check (gratuity_daily_divisor > 0);
alter table public.hr_settings add column if not exists gratuity_service_end_inclusive boolean;
alter table public.hr_leave_types add column if not exists half_pay_note boolean not null default false;

create table if not exists public.hr_pay_details (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  effective_from date not null,
  basic numeric(18,2) not null check (basic >= 0),
  allowances jsonb not null default '{}'::jsonb,
  iban text check (iban is null or iban ~ '^AE[0-9A-Z]{21}$'),
  bank_routing text,
  wps_labour_card text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (employee_id, effective_from)
);

-- prepared_by and approved_by carry no foreign key: a cascade from profiles must never touch an approved run.
create table if not exists public.hr_pay_runs (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique check (extract(day from period_month) = 1),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  prepared_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  same_person_ack boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table if not exists public.hr_pay_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.hr_pay_runs(id) on delete cascade,
  employee_id uuid not null references public.hr_employees(id) on delete restrict,
  pay_detail_id uuid references public.hr_pay_details(id) on delete set null,
  earnings jsonb not null default '[]'::jsonb,
  deductions jsonb not null default '[]'::jsonb,
  adjustments jsonb not null default '[]'::jsonb,
  net numeric(18,2) not null default 0,
  notes jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  input_hash text,
  -- bank details as approved. Set only by hr_payrun_approve; never written to hr_audit_log.
  iban text,
  bank_routing text,
  wps_labour_card text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (run_id, employee_id)
);
alter table public.hr_pay_lines add column if not exists iban text;
alter table public.hr_pay_lines add column if not exists bank_routing text;
alter table public.hr_pay_lines add column if not exists wps_labour_card text;
create index if not exists hr_pay_lines_employee_idx on public.hr_pay_lines (employee_id);
create index if not exists hr_pay_lines_detail_idx on public.hr_pay_lines (pay_detail_id);

-- ── pay details: validate in a trigger so no row (and no IBAN) reaches a constraint error's "failing row" detail ──
create or replace function public.hr_pay_details_check() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare k text; v jsonb;
begin
  if new.employee_id is null then raise exception 'Choose the employee'; end if;
  if tg_op = 'UPDATE' and new.employee_id <> old.employee_id then raise exception 'Pay details cannot move to another employee. Add a new row for that employee'; end if;
  if new.effective_from is null then raise exception 'The effective date is required'; end if;
  if new.basic is null or new.basic = 'NaN' or new.basic < 0 then raise exception 'The basic wage must be zero or more'; end if;
  new.iban := nullif(upper(regexp_replace(coalesce(new.iban, ''), '\s', '', 'g')), '');
  if new.iban is not null and new.iban !~ '^AE' then raise exception 'The IBAN must start with AE'; end if;
  if new.iban is not null and new.iban !~ '^AE[0-9A-Z]{21}$' then raise exception 'The IBAN must be AE followed by 21 letters or digits, 23 characters in all'; end if;
  new.allowances := coalesce(new.allowances, '{}'::jsonb);
  if jsonb_typeof(new.allowances) <> 'object' then raise exception 'The allowances must be a list of labels and amounts'; end if;
  for k, v in select * from jsonb_each(new.allowances) loop
    if btrim(k) = '' then raise exception 'Every allowance needs a label'; end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 then raise exception 'The allowance % must be a number, zero or more', k; end if;
  end loop;
  return new;
end $$;
drop trigger if exists hr_pay_details_check on public.hr_pay_details;
create trigger hr_pay_details_check before insert or update on public.hr_pay_details for each row execute function public.hr_pay_details_check();

-- Audit keeps old and new values except the IBAN: only whether it changed. Definer, because hr_audit is closed to users.
create or replace function public.hr_pay_details_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare o jsonb := null; n jsonb := null; t uuid;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old) - 'iban'; t := old.id; end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new) - 'iban'; t := new.id; end if;
  if tg_op = 'INSERT' then n := n || jsonb_build_object('iban_changed', new.iban is not null); end if;
  if tg_op = 'UPDATE' then n := n || jsonb_build_object('iban_changed', new.iban is distinct from old.iban); end if;
  if tg_op = 'DELETE' then o := o || jsonb_build_object('had_iban', old.iban is not null); end if;
  perform public.hr_audit('pay_details.' || case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end, 'hr_pay_details:' || t, o, n);
  return null;
end $$;
revoke all on function public.hr_pay_details_audit() from public, anon, authenticated;
drop trigger if exists hr_pay_details_audit on public.hr_pay_details;
create trigger hr_pay_details_audit after insert or update or delete on public.hr_pay_details for each row execute function public.hr_pay_details_audit();

drop trigger if exists hr_pay_details_touch on public.hr_pay_details;
create trigger hr_pay_details_touch before update on public.hr_pay_details for each row execute function public.hr_touch();
drop trigger if exists hr_pay_runs_touch on public.hr_pay_runs;
create trigger hr_pay_runs_touch before update on public.hr_pay_runs for each row execute function public.hr_touch();
drop trigger if exists hr_pay_lines_touch on public.hr_pay_lines;
create trigger hr_pay_lines_touch before update on public.hr_pay_lines for each row execute function public.hr_touch();

-- ── the lock: applies to every role, the owner included ──
create or replace function public.hr_pay_runs_lock() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'Payroll runs are locked: they cannot be truncated'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'Payroll runs are locked once approved, and a new run must start as a draft'; end if;
    return new;
  end if;
  if old.status = 'approved' then raise exception 'This payroll run is approved and locked. Correct it with an adjustment in a later run'; end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
drop trigger if exists hr_pay_runs_lock on public.hr_pay_runs;
create trigger hr_pay_runs_lock before insert or update or delete on public.hr_pay_runs for each row execute function public.hr_pay_runs_lock();
drop trigger if exists hr_pay_runs_no_truncate on public.hr_pay_runs;
create trigger hr_pay_runs_no_truncate before truncate on public.hr_pay_runs for each statement execute function public.hr_pay_runs_lock();

create or replace function public.hr_pay_lines_lock() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'Payroll lines are locked: they cannot be truncated'; end if;
  if tg_op <> 'INSERT' and exists (select 1 from public.hr_pay_runs r where r.id = old.run_id and r.status = 'approved') then
    raise exception 'This payroll line is in an approved run and locked. Correct it with an adjustment in a later run';
  end if;
  if tg_op <> 'DELETE' and exists (select 1 from public.hr_pay_runs r where r.id = new.run_id and r.status = 'approved') then
    raise exception 'This payroll run is approved and locked. Lines cannot be added to it';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
drop trigger if exists hr_pay_lines_lock on public.hr_pay_lines;
create trigger hr_pay_lines_lock before insert or update or delete on public.hr_pay_lines for each row execute function public.hr_pay_lines_lock();
drop trigger if exists hr_pay_lines_no_truncate on public.hr_pay_lines;
create trigger hr_pay_lines_no_truncate before truncate on public.hr_pay_lines for each statement execute function public.hr_pay_lines_lock();

-- ── RLS and grants ──
alter table public.hr_pay_details enable row level security;
alter table public.hr_pay_runs enable row level security;
alter table public.hr_pay_lines enable row level security;
revoke all on public.hr_pay_details, public.hr_pay_runs, public.hr_pay_lines from public, anon, authenticated;
grant select, insert, update, delete on public.hr_pay_details to authenticated;
grant select on public.hr_pay_runs, public.hr_pay_lines to authenticated;

-- Policies read through definer helpers so the two tables do not recurse into each other's policies.
create or replace function public.hr_pay_run_approved(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.hr_pay_runs r where r.id = p_run and r.status = 'approved')
$$;
create or replace function public.hr_pay_has_own_line(p_run uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.hr_pay_lines l where l.run_id = p_run and l.employee_id = public.hr_my_employee_id())
$$;
revoke all on function public.hr_pay_run_approved(uuid), public.hr_pay_has_own_line(uuid) from public, anon, authenticated;
grant execute on function public.hr_pay_run_approved(uuid), public.hr_pay_has_own_line(uuid) to authenticated;

drop policy if exists hr_pay_details_hr on public.hr_pay_details;
create policy hr_pay_details_hr on public.hr_pay_details for all to authenticated
  using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());
drop policy if exists hr_pay_runs_read on public.hr_pay_runs;
create policy hr_pay_runs_read on public.hr_pay_runs for select to authenticated
  using (public.hr_is_admin_or_hr() or (status = 'approved' and public.hr_pay_has_own_line(id)));
drop policy if exists hr_pay_lines_read on public.hr_pay_lines;
create policy hr_pay_lines_read on public.hr_pay_lines for select to authenticated
  using (public.hr_is_admin_or_hr() or (employee_id = public.hr_my_employee_id() and public.hr_pay_run_approved(run_id)));
-- no write policy and no write grant on runs and lines

-- ── internal calculation helpers: closed to users, they return salaries without checking the caller ──
create or replace function public.hr_pay_money(p numeric) returns text
language sql immutable set search_path = public, pg_temp as $$ select to_char(p, 'FM999,999,999,990.00') $$;

create or replace function public.hr_pay_sum(p_items jsonb) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select coalesce(sum((x ->> 'amount')::numeric), 0) from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) x
$$;

drop function if exists public.hr_pay_unpaid_days(uuid, date, date); -- the earlier 3-argument form
-- Dates in a range that are unpaid: every stored Absent day and every day inside approved unpaid leave, each date once.
-- p_working_only keeps only working days (working_days pay mode). Pay in the other modes and gratuity service count every calendar day.
create or replace function public.hr_pay_unpaid_days(p_employee uuid, p_from date, p_to date, p_working_only boolean)
returns table (day date, why text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.d::date, case when a.status = 'Absent' then 'Absent' else 'Unpaid leave' end
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  left join public.hr_attendance a on a.employee_id = p_employee and a.work_date = g.d::date
  where (a.status = 'Absent'
         or exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
                    where r.employee_id = p_employee and r.status = 'approved' and not t.paid and g.d::date between r.from_date and r.to_date))
    and (not p_working_only
         or (not (extract(dow from g.d)::int = any ((select s.weekend_days from public.hr_settings s where s.id = 1)::int[]))
             and not exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date)))
  order by 1
$$;

create or replace function public.hr_pay_working_days(p_from date, p_to date) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::numeric from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  where not (extract(dow from g.d)::int = any ((select s.weekend_days from public.hr_settings s where s.id = 1)::int[]))
    and not exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date)
$$;

create or replace function public.hr_pay_require_run_settings() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s public.hr_settings%rowtype;
begin
  select * into s from public.hr_settings where id = 1;
  if s.pay_day_divisor_mode is null then raise exception 'Payroll setting missing: Pay day divisor mode. Set it in HR Settings first'; end if;
  if s.pay_day_divisor_mode = 'fixed' and s.pay_days_basis is null then raise exception 'Payroll setting missing: Pay days basis (needed for the fixed divisor). Set it in HR Settings first'; end if;
  if s.pay_unpaid_wage_base is null then raise exception 'Payroll setting missing: Unpaid leave wage base. Set it in HR Settings first'; end if;
end $$;

-- One employee, one month: every figure, note and blocker, and the hash of what they came from. Writes nothing.
-- The month's unit, by mode: M = pay_days_basis (fixed; days counted are calendar days), days in the month (calendar_days), working days (working_days).
-- not_employed and unpaid are counted in that unit. Earnings = monthly x (M - not_employed) / M, each component rounded.
-- Unpaid days = deduction from the pay_unpaid_wage_base part only: base x unpaid / M, never more than that part as earned. With base total
-- this gives the paid fraction (M - not_employed - unpaid) / M, floored at 0; with base basic the allowances stay payable at the employment fraction.
-- If every employed day is unpaid, or there is no employed day, every earning is 0 and there is no deduction, so pay is exactly 0 whatever the base or basis.
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
  unpaid_n int; unpaid_txt text; present_txt text; half text; paid_n numeric; zero_pay boolean;
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

  select count(*), string_agg(u.day || ' ' || u.why, ', ' order by u.day) into unpaid_n, unpaid_txt from public.hr_pay_unpaid_days(p_employee, from_d, to_d, working) u;
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

-- Who belongs in a month: any day employed. A Left employee with no exit date stays in, flagged, until HR records the date.
create or replace function public.hr_pay_scope(p_month date) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.hr_employees e
  where (e.join_date is null or e.join_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
    and (e.exit_date is null or e.exit_date >= date_trunc('month', p_month)::date)
$$;

create or replace function public.hr_pay_change_blocker() returns text
language sql immutable set search_path = public, pg_temp as $$ select 'Pay changed during the month: record an adjustment on this line after reviewing it'::text $$;

-- Writes every line of a draft run from fresh figures. Adjustments on kept lines stay. Lines now out of scope go; adjustments lost that way are audited.
create or replace function public.hr_pay_fill(p_run uuid, p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare emp uuid; c jsonb; adj jsonb; bl jsonb; gone record;
begin
  for gone in delete from public.hr_pay_lines l where l.run_id = p_run and l.employee_id not in (select public.hr_pay_scope(p_month)) returning l.id, l.employee_id, l.adjustments loop
    if gone.adjustments <> '[]'::jsonb then
      perform public.hr_audit('payrun.line_removed', 'hr_pay_lines:' || gone.id, jsonb_build_object('employee_id', gone.employee_id, 'adjustments', gone.adjustments), null);
    end if;
  end loop;
  for emp in select public.hr_pay_scope(p_month) loop
    c := public.hr_pay_compute(p_month, emp);
    select l.adjustments into adj from public.hr_pay_lines l where l.run_id = p_run and l.employee_id = emp;
    adj := coalesce(adj, '[]'::jsonb);
    bl := c -> 'blockers';
    -- Only an adjustment made against the pay row now in use clears it: one from before the change does not.
    if (c ->> 'pay_change')::boolean and not exists (select 1 from jsonb_array_elements(adj) x where x ->> 'pay_detail_id' = c ->> 'pay_detail_id') then bl := bl || to_jsonb(public.hr_pay_change_blocker()); end if;
    insert into public.hr_pay_lines (run_id, employee_id, pay_detail_id, earnings, deductions, adjustments, net, notes, blockers, input_hash)
    values (p_run, emp, (c ->> 'pay_detail_id')::uuid, c -> 'earnings', c -> 'deductions', adj,
            public.hr_pay_sum(c -> 'earnings') - public.hr_pay_sum(c -> 'deductions') + public.hr_pay_sum(adj),
            c -> 'notes', bl, c ->> 'input_hash')
    on conflict (run_id, employee_id) do update set
      pay_detail_id = excluded.pay_detail_id, earnings = excluded.earnings, deductions = excluded.deductions, net = excluded.net,
      notes = excluded.notes, blockers = excluded.blockers, input_hash = excluded.input_hash;
  end loop;
end $$;

revoke all on function public.hr_pay_money(numeric), public.hr_pay_sum(jsonb), public.hr_pay_unpaid_days(uuid, date, date, boolean), public.hr_pay_working_days(date, date), public.hr_pay_change_blocker(),
  public.hr_pay_require_run_settings(), public.hr_pay_compute(date, uuid), public.hr_pay_scope(date), public.hr_pay_fill(uuid, date) from public, anon, authenticated;

-- ── run functions: HR and admin only ──
create or replace function public.hr_payrun_create(p_month date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare first_day date; rid uuid; n int;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  if p_month is null then raise exception 'The month is required'; end if;
  first_day := date_trunc('month', p_month)::date;
  perform public.hr_pay_require_run_settings();
  if exists (select 1 from public.hr_pay_runs where period_month = first_day) then
    raise exception 'A payroll run already exists for %', to_char(first_day, 'YYYY-MM');
  end if;
  insert into public.hr_pay_runs (period_month, prepared_by) values (first_day, auth.uid()) returning id into rid;
  perform public.hr_pay_fill(rid, first_day);
  select count(*) into n from public.hr_pay_lines where run_id = rid;
  perform public.hr_audit('payrun.created', 'hr_pay_runs:' || rid, null, jsonb_build_object('period_month', first_day, 'status', 'draft', 'headcount', n));
  return rid;
end $$;

create or replace function public.hr_payrun_recalc(p_run uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_pay_runs%rowtype; old_total numeric; new_total numeric;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select * into r from public.hr_pay_runs where id = p_run for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft run can be recalculated'; end if;
  perform public.hr_pay_require_run_settings();
  select coalesce(sum(net), 0) into old_total from public.hr_pay_lines where run_id = p_run;
  perform public.hr_pay_fill(p_run, r.period_month);
  select coalesce(sum(net), 0) into new_total from public.hr_pay_lines where run_id = p_run;
  update public.hr_pay_runs set prepared_by = auth.uid() where id = p_run;
  perform public.hr_audit('payrun.recalculated', 'hr_pay_runs:' || p_run, jsonb_build_object('prepared_by', r.prepared_by, 'total_net', old_total), jsonb_build_object('prepared_by', auth.uid(), 'total_net', new_total));
end $$;

create or replace function public.hr_payrun_adjust(p_line uuid, p_label text, p_amount numeric) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.hr_pay_lines%rowtype; r public.hr_pay_runs%rowtype; rid uuid; a numeric; adj jsonb; new_net numeric;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select run_id into rid from public.hr_pay_lines where id = p_line;
  if not found then raise exception 'Payroll line not found'; end if;
  select * into r from public.hr_pay_runs where id = rid for update; -- lock the run first, so the line read next cannot be stale
  if not found or r.status <> 'draft' then raise exception 'Only a draft run can be adjusted'; end if;
  select * into l from public.hr_pay_lines where id = p_line;
  if not found then raise exception 'Payroll line not found'; end if;
  if p_label is null or btrim(p_label) = '' then raise exception 'An adjustment needs a label'; end if;
  if p_amount is null or p_amount = 'NaN' then raise exception 'An adjustment needs an amount'; end if;
  a := round(p_amount, 2);
  if a = 0 then raise exception 'An adjustment amount cannot be zero'; end if;
  adj := l.adjustments || jsonb_build_object('label', btrim(p_label), 'amount', a, 'pay_detail_id', l.pay_detail_id);
  new_net := public.hr_pay_sum(l.earnings) - public.hr_pay_sum(l.deductions) + public.hr_pay_sum(adj);
  update public.hr_pay_lines set adjustments = adj, net = new_net, blockers = blockers - public.hr_pay_change_blocker() where id = p_line;
  update public.hr_pay_runs set prepared_by = auth.uid() where id = r.id; -- whoever adjusts has prepared what is approved
  perform public.hr_audit('payrun.adjusted', 'hr_pay_lines:' || p_line,
    jsonb_build_object('employee_id', l.employee_id, 'adjustments', l.adjustments, 'net', l.net, 'prepared_by', r.prepared_by),
    jsonb_build_object('employee_id', l.employee_id, 'adjustments', adj, 'net', new_net, 'prepared_by', auth.uid()));
end $$;

create or replace function public.hr_payrun_approve(p_run uuid, p_ack_same_person boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_pay_runs%rowtype; rec record; c jsonb; stale text[] := '{}'; msg text; same boolean; n int; total numeric;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select * into r from public.hr_pay_runs where id = p_run for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft run can be approved'; end if;
  perform public.hr_pay_require_run_settings();

  -- 1. Recompute everything against what was reviewed.
  for rec in
    select e.id, e.full_name, l.input_hash, l.earnings, l.deductions, s.id is not null as in_scope
    from public.hr_employees e
    left join public.hr_pay_lines l on l.run_id = p_run and l.employee_id = e.id
    left join (select public.hr_pay_scope(r.period_month) as id) s on s.id = e.id
    where l.id is not null or s.id is not null
    order by e.full_name
  loop
    if rec.input_hash is null or not rec.in_scope then
      stale := stale || rec.full_name;
    else
      c := public.hr_pay_compute(r.period_month, rec.id);
      if c ->> 'input_hash' <> rec.input_hash or c -> 'earnings' <> rec.earnings or c -> 'deductions' <> rec.deductions then
        stale := stale || rec.full_name;
      end if;
    end if;
  end loop;
  if cardinality(stale) > 0 then
    raise exception 'Pay data changed after this run was reviewed for: %. Recalculate the run and review it again', array_to_string(stale, ', ');
  end if;

  -- 2. Missing data.
  select string_agg(e.full_name || ' (' || (select string_agg(b, '; ') from jsonb_array_elements_text(l.blockers) b) || ')', ', ' order by e.full_name) into msg
  from public.hr_pay_lines l join public.hr_employees e on e.id = l.employee_id
  where l.run_id = p_run and l.blockers <> '[]'::jsonb;
  if msg is not null then raise exception 'Cannot approve, data is missing for: %', msg; end if;

  -- 3. Net below zero.
  select string_agg(e.full_name, ', ' order by e.full_name) into msg
  from public.hr_pay_lines l join public.hr_employees e on e.id = l.employee_id
  where l.run_id = p_run and l.net < 0;
  if msg is not null then raise exception 'Cannot approve, net pay is below zero for: %', msg; end if;

  select count(*), coalesce(sum(net), 0) into n, total from public.hr_pay_lines where run_id = p_run;
  if n = 0 then raise exception 'This run has no employees'; end if;

  -- 4. Same person.
  same := r.prepared_by is not distinct from auth.uid();
  if same and not coalesce(p_ack_same_person, false) then
    raise exception 'You prepared this run. The same person approving it must acknowledge that first';
  end if;

  update public.hr_pay_lines l set iban = p.iban, bank_routing = p.bank_routing, wps_labour_card = p.wps_labour_card
  from public.hr_pay_details p where l.run_id = p_run and p.id = l.pay_detail_id;

  update public.hr_pay_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), same_person_ack = same where id = p_run;
  perform public.hr_audit('payrun.approved', 'hr_pay_runs:' || p_run,
    jsonb_build_object('status', 'draft', 'prepared_by', r.prepared_by),
    jsonb_build_object('status', 'approved', 'approved_by', auth.uid(), 'same_person_ack', same, 'headcount', n, 'total_net', total));
end $$;

create or replace function public.hr_payrun_delete(p_run uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_pay_runs%rowtype; adj jsonb;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select * into r from public.hr_pay_runs where id = p_run for update;
  if not found then raise exception 'Payroll run not found'; end if;
  if r.status <> 'draft' then raise exception 'Only a draft run can be deleted'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('employee_id', l.employee_id, 'adjustments', l.adjustments)), '[]'::jsonb) into adj
  from public.hr_pay_lines l where l.run_id = p_run and l.adjustments <> '[]'::jsonb;
  delete from public.hr_pay_runs where id = p_run;
  perform public.hr_audit('payrun.deleted', 'hr_pay_runs:' || p_run, jsonb_build_object('period_month', r.period_month, 'status', r.status, 'adjustments', adj), null);
end $$;

-- Pay details for lists: IBAN masked to the last 4. The full value is read only from the table, by the HR edit form.
create or replace function public.hr_pay_details_list()
returns table (id uuid, employee_id uuid, employee_code text, full_name text, effective_from date, basic numeric, allowances jsonb, iban_masked text, bank_routing text, wps_labour_card text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to see pay details'; end if;
  return query
  select p.id, p.employee_id, e.employee_code, e.full_name, p.effective_from, p.basic, p.allowances,
         case when p.iban is null then null else '****' || right(p.iban, 4) end, p.bank_routing, p.wps_labour_card
  from public.hr_pay_details p join public.hr_employees e on e.id = p.employee_id
  order by e.full_name, p.effective_from desc;
end $$;

-- End-of-service gratuity for a full-time foreign worker (PAYROLL_RULES.md G1, G2, G3a, G4; Law Art. 51). Returns the breakdown for a
-- person to check; it is never added to a pay line. Daily divisor (P3), cap base (G3b), part-year method (G5) and whether the exit date
-- counts as a day of service come from settings. Unpaid absence days are out of service (Art. 51(4)).
create or replace function public.hr_gratuity(p_employee uuid, p_exit date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  s public.hr_settings%rowtype; e public.hr_employees%rowtype; d public.hr_pay_details%rowtype;
  allowances_total numeric; excluded int; service_end date; age_v interval; whole int; months int; rem_days int;
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

  select count(*) into excluded from public.hr_pay_unpaid_days(p_employee, e.join_date, p_exit, false); -- every calendar day
  service_end := p_exit + (case when s.gratuity_service_end_inclusive then 1 else 0 end) - excluded; -- exclusive end of service
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

revoke all on function public.hr_payrun_create(date), public.hr_payrun_recalc(uuid), public.hr_payrun_adjust(uuid, text, numeric), public.hr_payrun_approve(uuid, boolean),
  public.hr_payrun_delete(uuid), public.hr_pay_details_list(), public.hr_gratuity(uuid, date) from public, anon, authenticated;
grant execute on function public.hr_payrun_create(date), public.hr_payrun_recalc(uuid), public.hr_payrun_adjust(uuid, text, numeric), public.hr_payrun_approve(uuid, boolean),
  public.hr_payrun_delete(uuid), public.hr_pay_details_list(), public.hr_gratuity(uuid, date) to authenticated;
