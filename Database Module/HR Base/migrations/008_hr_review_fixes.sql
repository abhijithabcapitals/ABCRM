-- =====================================================================
-- HR Base - final review fixes                                     008
-- =====================================================================
-- Run after 001 to 007, in order. Re-running 004, 005, 006 or 007 alone undoes what this file redefines, so re-run everything up to here.
-- Login link: hr_employee_link (admin only). A trigger refuses any other change of hr_employees.profile_id by a signed-in non-admin.
--   Admins, the service role (admin-users Edge Function) and definer functions pass.
-- Hard delete: authenticated users cannot delete hr_employees or hr_pay_details. Records are ended with status and exit date.
-- Audit: hr_employees (join_date, exit_date, status, manager_id, profile_id, on_payroll) and hr_access additions and removals.
-- Left: someone on the HR list whose linked employee is Left loses HR power, unless an admin by role. A Left manager stops managing.
--   Their own record, leave, attendance, documents and approved pay lines stay readable.
-- Paid leave: a stored Absent inside approved PAID leave costs no pay or gratuity service and puts a review note on the line.
-- Cancel: an employee cancels their own approved leave only before from_date (Asia/Dubai date). Pending any time. HR any time.
-- Locked months: hr_leave_decide, hr_leave_cancel and hr_attendance_set now return jsonb {warning: text|null}. Touching a date in a month
--   with an approved run succeeds, leaves that run unchanged and names the month in the warning. hr_payrun_changes_after lists such changes.
--   Their return type changes, so they are dropped first here and in 005 and 006; create or replace alone cannot change a return type.
-- Over balance: approving paid leave beyond the balance succeeds and returns a warning.
-- Pay change: hr_payrun_ack_pay_change clears the blocker for the pay row now in use. It adds no amount. The note is kept in the audit log only,
--   which employees cannot read; the line keeps the pay row, who and when in pay_change_ack, and the payslip prints none of it.
-- hr_employees.on_payroll: false leaves the person out of run scope.
-- hr_documents_expiring and hr_dashboard count from the Asia/Dubai date. A manager has the Documents tab for their own rows only;
--   hr_documents RLS already limits a manager to their own.
-- Requires 001 to 007. Idempotent.
-- =====================================================================
alter table public.hr_employees add column if not exists on_payroll boolean not null default true;
alter table public.hr_pay_lines add column if not exists pay_change_ack jsonb;

-- Records are never hard deleted through the API. No screen deletes these rows (Settings > Employees has no delete).
revoke delete on public.hr_employees, public.hr_pay_details from authenticated;

-- ── access helpers ──
create or replace function public.hr_is_admin_or_hr() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.admin_is() or (
    exists (select 1 from public.hr_access a where a.profile_id = auth.uid())
    and not exists (select 1 from public.hr_employees e where e.profile_id = auth.uid() and e.status = 'Left')
  )
$$;

create or replace function public.hr_manages(p_employee uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.hr_employees e
    join public.hr_employees m on m.id = e.manager_id
    where e.id = p_employee and m.profile_id = auth.uid() and m.status <> 'Left'
  )
$$;

create or replace function public.hr_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'role', case
      when public.hr_is_admin_or_hr() then 'hr'
      when exists (select 1 from public.hr_employees r join public.hr_employees m on m.id = r.manager_id where m.profile_id = auth.uid() and m.status <> 'Left') then 'manager'
      when public.hr_my_employee_id() is not null then 'employee'
      else 'none' end,
    'employee_id', public.hr_my_employee_id())
$$;

-- ── login link ──
-- Not a definer function: current_user tells a signed-in caller's direct write from the service role and from definer functions.
create or replace function public.hr_employees_profile_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (tg_op = 'INSERT' and new.profile_id is not null) or (tg_op = 'UPDATE' and new.profile_id is distinct from old.profile_id) then
    -- Two ifs: a single expression checks execute permission on admin_is for every role, and the service role may not have it.
    if current_user in ('authenticated', 'anon') then
      if not public.admin_is() then raise exception 'Only an administrator can change the login linked to an employee'; end if;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists hr_employees_profile_guard on public.hr_employees;
create trigger hr_employees_profile_guard before insert or update on public.hr_employees for each row execute function public.hr_employees_profile_guard();

-- Writes only the fields that changed. Definer, because hr_audit is closed to users. The actor is null for the service role.
create or replace function public.hr_employees_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare f text; o jsonb := '{}'::jsonb; n jsonb := '{}'::jsonb; oj jsonb; nj jsonb;
begin
  nj := to_jsonb(new);
  oj := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  foreach f in array array['join_date', 'exit_date', 'status', 'manager_id', 'profile_id', 'on_payroll'] loop
    if (tg_op = 'INSERT' and nj -> f <> 'null'::jsonb) or (tg_op = 'UPDATE' and oj -> f is distinct from nj -> f) then
      if tg_op = 'UPDATE' then o := o || jsonb_build_object(f, oj -> f); end if;
      n := n || jsonb_build_object(f, nj -> f);
    end if;
  end loop;
  if tg_op = 'INSERT' then
    perform public.hr_audit('employee.created', 'hr_employees:' || new.id, null, n);
  elsif n <> '{}'::jsonb then
    perform public.hr_audit('employee.updated', 'hr_employees:' || new.id, o, n);
  end if;
  return null;
end $$;
drop trigger if exists hr_employees_audit on public.hr_employees;
create trigger hr_employees_audit after insert or update on public.hr_employees for each row execute function public.hr_employees_audit();

-- Admin only. p_profile null unlinks. The audit entry comes from hr_employees_audit, with old and new profile_id.
create or replace function public.hr_employee_link(p_employee uuid, p_profile uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.hr_employees%rowtype; other text;
begin
  if not public.admin_is() then raise exception 'Only an administrator can change the login linked to an employee'; end if;
  select * into e from public.hr_employees where id = p_employee for update;
  if not found then raise exception 'Employee not found'; end if;
  if p_profile is not null then
    if not exists (select 1 from public.profiles p where p.id = p_profile) then raise exception 'That login was not found'; end if;
    select o.employee_code into other from public.hr_employees o where o.profile_id = p_profile and o.id <> p_employee;
    if other is not null then raise exception 'That login is already linked to employee %', other; end if;
  end if;
  update public.hr_employees set profile_id = p_profile, updated_at = now() where id = p_employee;
end $$;

-- ── HR access list audit ──
create or replace function public.hr_access_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    perform public.hr_audit('hr_access.added', 'hr_access:' || new.profile_id, null, jsonb_build_object('profile_id', new.profile_id));
  else
    perform public.hr_audit('hr_access.removed', 'hr_access:' || old.profile_id, jsonb_build_object('profile_id', old.profile_id), null);
  end if;
  return null;
end $$;
drop trigger if exists hr_access_audit on public.hr_access;
create trigger hr_access_audit after insert or delete on public.hr_access for each row execute function public.hr_access_audit();

-- ── locked months ──
-- Internal. One sentence per month in the range that has an approved run, or null.
create or replace function public.hr_locked_month_warning(p_from date, p_to date) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select string_agg(to_char(r.period_month, 'FMMonth YYYY') || ' is locked: add an adjustment in a later run', '; ' order by r.period_month)
  from public.hr_pay_runs r
  where r.status = 'approved' and r.period_month <= p_to and (r.period_month + interval '1 month - 1 day')::date >= p_from
$$;

drop function if exists public.hr_leave_decide(uuid, boolean, text);
-- Approve or reject a pending request. HR any; a manager for direct reports. Nobody decides their own.
-- Returns {warning}: approval beyond a paid balance, and any locked month. Neither stops the decision.
create or replace function public.hr_leave_decide(p_request uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_leave_requests%rowtype; new_status text; ty public.hr_leave_types%rowtype; rem numeric; warns text[] := '{}'; locked text; yr int;
begin
  select * into r from public.hr_leave_requests where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if r.employee_id is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot decide your own leave';
  end if;
  if not (public.hr_is_admin_or_hr() or public.hr_manages(r.employee_id)) then
    raise exception 'You are not allowed to decide this request';
  end if;
  if r.status <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', r.status; end if;
  new_status := case when p_approve then 'approved' else 'rejected' end;
  update public.hr_leave_requests set status = new_status, approver = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
  perform public.hr_audit('leave.' || new_status, 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', new_status, 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days, 'note', p_note));
  if p_approve then
    select * into ty from public.hr_leave_types where id = r.leave_type_id;
    if ty.paid then
      yr := extract(year from r.from_date)::int;
      select b.remaining into rem from public.hr_leave_balance(r.employee_id, yr) b where b.leave_type_id = r.leave_type_id;
      if rem < 0 then warns := warns || format('%s %s: approved %s day(s), which is %s beyond the balance', ty.name, yr, r.days, -rem); end if;
    end if;
  end if;
  locked := public.hr_locked_month_warning(r.from_date, r.to_date);
  if locked is not null then warns := warns || locked; end if;
  return jsonb_build_object('warning', case when cardinality(warns) > 0 then array_to_string(warns, '; ') end);
end $$;

drop function if exists public.hr_leave_cancel(uuid);
-- Cancel a pending or approved request. HR any time. The employee: pending any time, approved only before from_date (Asia/Dubai date).
-- Returns {warning}: any locked month.
create or replace function public.hr_leave_cancel(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_leave_requests%rowtype; is_hr boolean := public.hr_is_admin_or_hr();
begin
  select * into r from public.hr_leave_requests where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if not (is_hr or r.employee_id is not distinct from public.hr_my_employee_id()) then
    raise exception 'You are not allowed to cancel this request';
  end if;
  if r.status not in ('pending', 'approved') then raise exception 'A % request cannot be cancelled', r.status; end if;
  if not is_hr and r.status = 'approved' and r.from_date <= (now() at time zone 'Asia/Dubai')::date then
    raise exception 'Approved leave can be cancelled only before it starts. Ask HR';
  end if;
  update public.hr_leave_requests set status = 'cancelled' where id = p_request;
  perform public.hr_audit('leave.cancelled', 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', 'cancelled', 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days));
  return jsonb_build_object('warning', public.hr_locked_month_warning(r.from_date, r.to_date));
end $$;

drop function if exists public.hr_attendance_set(uuid, date, text, time, time, text);
-- As in 006. Returns {warning}: a locked month.
create or replace function public.hr_attendance_set(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare emp public.hr_employees%rowtype; old public.hr_attendance%rowtype; today date := (now() at time zone 'Asia/Dubai')::date;
begin
  select * into emp from public.hr_employees where id = p_employee;
  if not found then raise exception 'Employee not found'; end if;
  if p_employee is not distinct from public.hr_my_employee_id() and not public.hr_is_admin_or_hr() then
    raise exception 'You cannot set your own attendance. Ask HR';
  end if;
  if not (public.hr_is_admin_or_hr() or public.hr_manages(p_employee)) then
    raise exception 'You are not allowed to set this attendance';
  end if;
  if p_date is null then raise exception 'The date is required'; end if;
  if p_status is null or p_status not in ('Present', 'Absent', 'Leave', 'Holiday', 'Weekend') then
    raise exception 'Status must be Present, Absent, Leave, Holiday or Weekend';
  end if;
  if p_date > today then raise exception 'A future date cannot be recorded'; end if;
  if emp.status = 'Left' and emp.exit_date is null then
    raise exception 'This employee has left but has no exit date. Record the exit date first';
  end if;
  if emp.exit_date is not null and p_date > emp.exit_date then
    raise exception 'The exit date of this employee is %. Later days cannot be recorded', emp.exit_date;
  end if;
  if emp.join_date is not null and p_date < emp.join_date then
    raise exception 'This employee joined on %. Earlier days cannot be recorded', emp.join_date;
  end if;
  if p_status <> 'Present' and (p_in is not null or p_out is not null) then
    raise exception 'Absent, Leave, Holiday and Weekend days cannot carry times';
  end if;
  if p_in is not null and p_out is not null and p_out < p_in then
    raise exception 'Time out is before time in';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text || p_date::text, 0));
  select * into old from public.hr_attendance where employee_id = p_employee and work_date = p_date;
  if found then
    update public.hr_attendance set status = p_status, time_in = p_in, time_out = p_out, note = p_note where id = old.id;
    perform public.hr_audit('attendance.updated', 'hr_attendance:' || old.id,
      jsonb_build_object('employee_id', old.employee_id, 'work_date', old.work_date, 'status', old.status, 'time_in', old.time_in, 'time_out', old.time_out, 'note', old.note),
      jsonb_build_object('employee_id', p_employee, 'work_date', p_date, 'status', p_status, 'time_in', p_in, 'time_out', p_out, 'note', p_note));
  else
    insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out, note)
    values (p_employee, p_date, p_status, p_in, p_out, p_note) returning * into old;
    perform public.hr_audit('attendance.created', 'hr_attendance:' || old.id, null,
      jsonb_build_object('employee_id', p_employee, 'work_date', p_date, 'status', p_status, 'time_in', p_in, 'time_out', p_out, 'note', p_note));
  end if;
  return jsonb_build_object('warning', public.hr_locked_month_warning(p_date, p_date));
end $$;

-- ── pay rules ──
-- Dates in a range that are unpaid: every day inside approved unpaid leave, and every stored Absent day not inside approved paid leave, each date once.
-- p_working_only keeps only working days (working_days pay mode). Pay in the other modes and gratuity service count every calendar day.
create or replace function public.hr_pay_unpaid_days(p_employee uuid, p_from date, p_to date, p_working_only boolean)
returns table (day date, why text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.d::date, case when a.status = 'Absent' then 'Absent' else 'Unpaid leave' end
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  left join public.hr_attendance a on a.employee_id = p_employee and a.work_date = g.d::date
  where ((a.status = 'Absent'
          and not exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
                          where r.employee_id = p_employee and r.status = 'approved' and t.paid and g.d::date between r.from_date and r.to_date))
         or exists (select 1 from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
                    where r.employee_id = p_employee and r.status = 'approved' and not t.paid and g.d::date between r.from_date and r.to_date))
    and (not p_working_only
         or (not (extract(dow from g.d)::int = any ((select s.weekend_days from public.hr_settings s where s.id = 1)::int[]))
             and not exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date)))
  order by 1
$$;

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
  unpaid_n int; unpaid_txt text; present_txt text; absent_paid_txt text; half text; paid_n numeric; zero_pay boolean;
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

-- Who belongs in a month: any day employed and on payroll. A Left employee with no exit date stays in, flagged, until HR records the date.
create or replace function public.hr_pay_scope(p_month date) returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.hr_employees e
  where e.on_payroll
    and (e.join_date is null or e.join_date <= (date_trunc('month', p_month) + interval '1 month - 1 day')::date)
    and (e.exit_date is null or e.exit_date >= date_trunc('month', p_month)::date)
$$;

create or replace function public.hr_pay_change_blocker() returns text
language sql immutable set search_path = public, pg_temp as $$ select 'Pay changed during the month: review this line, then add an adjustment or acknowledge the change'::text $$;

-- Writes every line of a draft run from fresh figures. Adjustments and the acknowledgement on kept lines stay. Lines now out of scope go; adjustments lost that way are audited.
create or replace function public.hr_pay_fill(p_run uuid, p_month date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare emp uuid; c jsonb; adj jsonb; ack jsonb; bl jsonb; gone record;
begin
  for gone in delete from public.hr_pay_lines l where l.run_id = p_run and l.employee_id not in (select public.hr_pay_scope(p_month)) returning l.id, l.employee_id, l.adjustments loop
    if gone.adjustments <> '[]'::jsonb then
      perform public.hr_audit('payrun.line_removed', 'hr_pay_lines:' || gone.id, jsonb_build_object('employee_id', gone.employee_id, 'adjustments', gone.adjustments), null);
    end if;
  end loop;
  for emp in select public.hr_pay_scope(p_month) loop
    c := public.hr_pay_compute(p_month, emp);
    adj := null; ack := null;
    select l.adjustments, l.pay_change_ack into adj, ack from public.hr_pay_lines l where l.run_id = p_run and l.employee_id = emp;
    adj := coalesce(adj, '[]'::jsonb);
    bl := c -> 'blockers';
    -- Only an adjustment or acknowledgement made against the pay row now in use clears it: one from before the change does not.
    if (c ->> 'pay_change')::boolean
       and not exists (select 1 from jsonb_array_elements(adj) x where x ->> 'pay_detail_id' = c ->> 'pay_detail_id')
       and ack ->> 'pay_detail_id' is distinct from c ->> 'pay_detail_id' then
      bl := bl || to_jsonb(public.hr_pay_change_blocker());
    end if;
    insert into public.hr_pay_lines (run_id, employee_id, pay_detail_id, earnings, deductions, adjustments, net, notes, blockers, input_hash)
    values (p_run, emp, (c ->> 'pay_detail_id')::uuid, c -> 'earnings', c -> 'deductions', adj,
            public.hr_pay_sum(c -> 'earnings') - public.hr_pay_sum(c -> 'deductions') + public.hr_pay_sum(adj),
            c -> 'notes', bl, c ->> 'input_hash')
    on conflict (run_id, employee_id) do update set
      pay_detail_id = excluded.pay_detail_id, earnings = excluded.earnings, deductions = excluded.deductions, net = excluded.net,
      notes = excluded.notes, blockers = excluded.blockers, input_hash = excluded.input_hash;
  end loop;
end $$;

-- ── run functions ──
create or replace function public.hr_payrun_create(p_month date) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare first_day date; rid uuid; n int;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  if p_month is null then raise exception 'The month is required'; end if;
  first_day := date_trunc('month', p_month)::date;
  if first_day > date_trunc('month', (now() at time zone 'Asia/Dubai')::date)::date then
    raise exception 'A payroll run cannot be created for a future month (%). The current month is the latest allowed', to_char(first_day, 'YYYY-MM');
  end if;
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

-- Records that HR reviewed a mid-month pay change. Adds no amount and changes no figure. Whoever acknowledges has prepared what is approved.
create or replace function public.hr_payrun_ack_pay_change(p_line uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.hr_pay_lines%rowtype; r public.hr_pay_runs%rowtype; rid uuid;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select run_id into rid from public.hr_pay_lines where id = p_line;
  if not found then raise exception 'Payroll line not found'; end if;
  select * into r from public.hr_pay_runs where id = rid for update;
  if not found or r.status <> 'draft' then raise exception 'Only a line in a draft run can be acknowledged'; end if;
  select * into l from public.hr_pay_lines where id = p_line;
  if not found then raise exception 'Payroll line not found'; end if;
  if p_note is null or btrim(p_note) = '' then raise exception 'An acknowledgement needs a note'; end if;
  if not l.blockers ? public.hr_pay_change_blocker() then raise exception 'This line has no pay change waiting to be acknowledged'; end if;
  update public.hr_pay_lines
    set pay_change_ack = jsonb_build_object('pay_detail_id', l.pay_detail_id, 'by', auth.uid(), 'at', now()), blockers = blockers - public.hr_pay_change_blocker()
    where id = p_line;
  update public.hr_pay_runs set prepared_by = auth.uid() where id = r.id;
  perform public.hr_audit('payrun.pay_change_acknowledged', 'hr_pay_lines:' || p_line,
    jsonb_build_object('employee_id', l.employee_id, 'prepared_by', r.prepared_by),
    jsonb_build_object('employee_id', l.employee_id, 'pay_detail_id', l.pay_detail_id, 'note', btrim(p_note), 'prepared_by', auth.uid()));
end $$;

-- Audit entries about a run's month made after it was approved. They did not change the run; each may need an adjustment in a later run. HR only.
create or replace function public.hr_payrun_changes_after(p_run uuid)
returns table (at timestamptz, actor_name text, action text, employee_name text, detail text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.hr_pay_runs%rowtype; first_day date; last_day date;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'You are not allowed to run payroll'; end if;
  select * into r from public.hr_pay_runs p where p.id = p_run;
  if not found then raise exception 'Payroll run not found'; end if;
  if r.status <> 'approved' then return; end if;
  first_day := r.period_month;
  last_day := (r.period_month + interval '1 month - 1 day')::date;
  return query
  select a.at, p.full_name, a.action, e.full_name,
         case
           when a.action like 'attendance.%' then (a.new_values ->> 'work_date') || ': ' || coalesce(a.old_values ->> 'status', 'nothing recorded') || ' to ' || (a.new_values ->> 'status')
           when a.action like 'leave.%' then (a.new_values ->> 'from_date') || ' to ' || (a.new_values ->> 'to_date') || ', ' || (a.new_values ->> 'days') || ' day(s): ' || (a.old_values ->> 'status') || ' to ' || (a.new_values ->> 'status')
           when a.action like 'pay_details.%' then 'Pay details effective ' || coalesce(a.new_values ->> 'effective_from', a.old_values ->> 'effective_from')
           else 'Join date ' || coalesce(a.new_values ->> 'join_date', 'unchanged') || ', exit date ' || coalesce(a.new_values ->> 'exit_date', 'unchanged')
         end
  from public.hr_audit_log a
  left join public.profiles p on p.id = a.actor
  left join public.hr_employees e on e.id::text = coalesce(a.new_values ->> 'employee_id', a.old_values ->> 'employee_id', case when a.action like 'employee.%' then substr(a.target, 14) end)
  where a.at > r.approved_at
    and ((a.action like 'attendance.%' and (a.new_values ->> 'work_date')::date between first_day and last_day)
      or (a.action like 'leave.%' and (a.new_values ->> 'from_date')::date <= last_day and (a.new_values ->> 'to_date')::date >= first_day)
      or (a.action like 'pay_details.%' and coalesce(a.new_values ->> 'effective_from', a.old_values ->> 'effective_from')::date between first_day and last_day)
      or (a.action = 'employee.updated' and ((a.new_values ->> 'join_date')::date between first_day and last_day or (a.new_values ->> 'exit_date')::date between first_day and last_day
                                          or (a.old_values ->> 'join_date')::date between first_day and last_day or (a.old_values ->> 'exit_date')::date between first_day and last_day)))
  order by a.at desc;
end $$;

-- ── expiry and dashboard: Asia/Dubai date ──
create or replace function public.hr_documents_expiring()
returns table (id uuid, employee_id uuid, employee_code text, full_name text, doc_type text, doc_number text, expiry_date date, days_left integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.employee_id, e.employee_code, e.full_name, d.doc_type, d.doc_number, d.expiry_date, (d.expiry_date - (now() at time zone 'Asia/Dubai')::date)::integer
  from public.hr_documents d
  join public.hr_employees e on e.id = d.employee_id
  where d.expiry_date is not null
    and d.expiry_date <= (now() at time zone 'Asia/Dubai')::date + 90
    and e.status <> 'Left'
    and (public.hr_is_admin_or_hr() or d.employee_id = public.hr_my_employee_id())
  order by d.expiry_date, e.employee_code
$$;

create or replace function public.hr_dashboard() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'headcount', (select count(*) from public.hr_employees e
                  where e.status <> 'Left'
                    and (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))),
    'present_today', (select count(*) from public.hr_attendance a
                      where a.status = 'Present' and a.work_date = (now() at time zone 'Asia/Dubai')::date
                        and (public.hr_is_admin_or_hr() or a.employee_id = public.hr_my_employee_id() or public.hr_manages(a.employee_id))),
    'pending_leave', (select count(*) from public.hr_leave_requests r
                      where r.status = 'pending'
                        and (public.hr_is_admin_or_hr() or r.employee_id = public.hr_my_employee_id() or public.hr_manages(r.employee_id))),
    'expiring_documents', (select count(*) from public.hr_documents_expiring())
  )
$$;

-- ── grants ──
revoke all on function public.hr_is_admin_or_hr(), public.hr_manages(uuid), public.hr_my_access(), public.hr_employee_link(uuid, uuid),
  public.hr_leave_decide(uuid, boolean, text), public.hr_leave_cancel(uuid), public.hr_attendance_set(uuid, date, text, time, time, text),
  public.hr_payrun_create(date), public.hr_payrun_ack_pay_change(uuid, text), public.hr_payrun_changes_after(uuid), public.hr_documents_expiring(), public.hr_dashboard() from public, anon, authenticated;
grant execute on function public.hr_is_admin_or_hr(), public.hr_manages(uuid), public.hr_my_access(), public.hr_employee_link(uuid, uuid),
  public.hr_leave_decide(uuid, boolean, text), public.hr_leave_cancel(uuid), public.hr_attendance_set(uuid, date, text, time, time, text),
  public.hr_payrun_create(date), public.hr_payrun_ack_pay_change(uuid, text), public.hr_payrun_changes_after(uuid), public.hr_documents_expiring(), public.hr_dashboard() to authenticated;
-- Internal: closed to users.
revoke all on function public.hr_employees_audit(), public.hr_access_audit(), public.hr_locked_month_warning(date, date), public.hr_pay_unpaid_days(uuid, date, date, boolean),
  public.hr_pay_compute(date, uuid), public.hr_pay_scope(date), public.hr_pay_change_blocker(), public.hr_pay_fill(uuid, date) from public, anon, authenticated;
