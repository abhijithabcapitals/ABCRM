-- =====================================================================
-- HR Base - day status, period counts                              010
-- =====================================================================
-- Late, Overtime, WFH and Absent are worked out when read, never stored, so a later rule change needs no rewriting.
-- hr_attendance_days is the one answer, used by every screen and by payroll. For one person and date, the first match wins:
--   a manual row, approved leave, a holiday, a biometric row, a WFH Saturday, a weekend day, otherwise Absent.
-- A person's range starts at join_date, else their first punch, and ends at the earlier of today (Asia/Dubai) and exit_date. A Left
-- person with no exit date ends at their last punch. Outside it a day has no row, except a manual row or approved leave, which always show.
-- absent_from_blank_days starts false, so a blank working day stays blank until seed_ab_capital.sql turns it on.
-- Company values (hours, WFH rules, leave types, salaries) are in seed_ab_capital.sql, not here.
-- Requires 001 to 009. Idempotent.
-- =====================================================================
alter table public.hr_settings add column if not exists shift_start time not null default '09:30';
alter table public.hr_settings add column if not exists shift_end time not null default '18:30';
alter table public.hr_settings add column if not exists saturday_end time not null default '14:00';
alter table public.hr_settings add column if not exists absent_from_blank_days boolean not null default false;

create table if not exists public.hr_wfh_saturday_rules (
  id uuid primary key default gen_random_uuid(),
  effective_from date,
  effective_to date,
  pattern text not null check (pattern in ('last', 'second_and_last')),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
drop trigger if exists hr_wfh_saturday_rules_touch on public.hr_wfh_saturday_rules;
create trigger hr_wfh_saturday_rules_touch before update on public.hr_wfh_saturday_rules for each row execute function public.hr_touch();
alter table public.hr_wfh_saturday_rules enable row level security;
revoke all on public.hr_wfh_saturday_rules from public, anon, authenticated;
grant select, insert, update, delete on public.hr_wfh_saturday_rules to authenticated;
drop policy if exists hr_wfh_saturday_rules_read on public.hr_wfh_saturday_rules;
create policy hr_wfh_saturday_rules_read on public.hr_wfh_saturday_rules for select to authenticated using (public.hr_is_admin_or_hr() or public.hr_my_employee_id() is not null);
drop policy if exists hr_wfh_saturday_rules_hr on public.hr_wfh_saturday_rules;
create policy hr_wfh_saturday_rules_hr on public.hr_wfh_saturday_rules for all to authenticated using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());

-- WFH joins the statuses and may carry times. The two checks have generated names, so find them by what they say.
do $do$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.hr_attendance'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.hr_attendance drop constraint %I', c.conname);
  end loop;
end $do$;
alter table public.hr_attendance add constraint hr_attendance_status_values check (status in ('Present', 'Absent', 'WFH', 'Leave', 'Holiday', 'Weekend'));
alter table public.hr_attendance add constraint hr_attendance_status_times check (status in ('Present', 'WFH') or (time_in is null and time_out is null));

-- Internal. True for a Saturday that a rule makes work from home. "last": the next Saturday is in another month. "second": day 8 to 14.
create or replace function public.hr_is_wfh_saturday(p_date date) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select extract(dow from p_date) = 6 and exists (
    select 1 from public.hr_wfh_saturday_rules r
    where (r.effective_from is null or p_date >= r.effective_from)
      and (r.effective_to is null or p_date <= r.effective_to)
      and (extract(month from p_date + 7) <> extract(month from p_date)
           or (r.pattern = 'second_and_last' and extract(day from p_date) between 8 and 14)))
$$;

-- Internal: no check of the caller, because payroll reads it for anyone. p_employee null means everyone.
create or replace function public.hr_attendance_days(p_from date, p_to date, p_employee uuid default null)
returns table (employee_id uuid, employee_code text, full_name text, employee_status text, exit_date date, work_date date, status text, leave_kind text,
               time_in time, time_out time, late_minutes int, overtime_minutes int, source text, note text)
language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select * from public.hr_settings where id = 1),
  first_last as (select p.emp_code, min(p.punch_at)::date as first_p, max(p.punch_at)::date as last_p from public.hr_biometric_punches p group by p.emp_code),
  people as (
    select e.id, e.employee_code, e.full_name, e.status, e.exit_date,
           coalesce(e.join_date, f.first_p) as start_d,
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
         case when x.st = 'Present' and not x.is_off and x.t_in > x.shift_start then ceil(extract(epoch from x.t_in - x.shift_start) / 60)::int else 0 end,
         case when x.st = 'Present' and not x.is_off and x.t_out is not null
                   and x.t_out > (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)
              then ceil(extract(epoch from x.t_out - (case when extract(dow from x.d) = 6 then x.saturday_end else x.shift_end end)) / 60)::int else 0 end,
         x.row_source, x.row_note
  from decided x
  order by x.employee_code, x.d
$$;

-- Internal. Who the caller may see: null means everyone.
create or replace function public.hr_visible_employees() returns uuid[]
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.hr_is_admin_or_hr() then null else coalesce((
    select array_agg(e.id) from public.hr_employees e
    where e.profile_id = auth.uid()
       or e.manager_id in (select m.id from public.hr_employees m where m.profile_id = auth.uid() and m.status <> 'Left')), '{}') end
$$;

-- ── manual edits ──
-- Only an admin changes a day directly, and only an admin decides a request. Anyone else who may edit raises a request, and the cell keeps
-- its value until it is approved. An approved edit is written like an admin's, so it is manual and audited, and a later sync leaves it alone.
create table if not exists public.hr_attendance_edits (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  work_date date not null,
  status text not null,
  time_in time,
  time_out time,
  note text,
  old_values jsonb,
  reason text not null,
  requested_by uuid default auth.uid(),
  requested_at timestamptz not null default now(),
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'superseded')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text
);
create unique index if not exists hr_attendance_edits_one_pending on public.hr_attendance_edits (employee_id, work_date) where state = 'pending';
create index if not exists hr_attendance_edits_state_idx on public.hr_attendance_edits (state, requested_at);
alter table public.hr_attendance_edits enable row level security;
revoke all on public.hr_attendance_edits from public, anon, authenticated;
grant select on public.hr_attendance_edits to authenticated;
drop policy if exists hr_attendance_edits_read on public.hr_attendance_edits;
create policy hr_attendance_edits_read on public.hr_attendance_edits for select to authenticated
  using (public.hr_is_admin_or_hr() or public.hr_manages(employee_id) or requested_by = auth.uid());
-- no write policy and no write grant

-- Internal. Refuses a day or a value that cannot be recorded, whoever is asking.
create or replace function public.hr_attendance_validate(p_employee uuid, p_date date, p_status text, p_in time, p_out time) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare emp public.hr_employees%rowtype; today date := (now() at time zone 'Asia/Dubai')::date;
begin
  select * into emp from public.hr_employees where id = p_employee;
  if not found then raise exception 'Employee not found'; end if;
  if p_date is null then raise exception 'The date is required'; end if;
  if p_status is null or p_status not in ('Present', 'Absent', 'WFH', 'Leave', 'Holiday', 'Weekend') then
    raise exception 'Status must be Present, Absent, WFH, Leave, Holiday or Weekend';
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
  if p_status not in ('Present', 'WFH') and (p_in is not null or p_out is not null) then
    raise exception 'Absent, Leave, Holiday and Weekend days cannot carry times';
  end if;
  if p_in is not null and p_out is not null and p_out < p_in then
    raise exception 'Time out is before time in';
  end if;
end $$;

-- Internal. Writes and audits a manual day. Returns {warning}: a locked month.
create or replace function public.hr_attendance_write(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare old public.hr_attendance%rowtype;
begin
  perform public.hr_attendance_validate(p_employee, p_date, p_status, p_in, p_out);
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

create or replace function public.hr_attendance_set(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_is() then raise exception 'Only an administrator can change attendance directly. Send it for approval'; end if;
  return public.hr_attendance_write(p_employee, p_date, p_status, p_in, p_out, p_note);
end $$;

-- HR list: anyone. A manager: direct reports. Nobody but HR asks for themselves. A newer request replaces a pending one for that day.
create or replace function public.hr_attendance_request(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb; new_id uuid;
begin
  if p_employee is not distinct from public.hr_my_employee_id() and not public.hr_is_admin_or_hr() then
    raise exception 'You cannot change your own attendance. Ask HR';
  end if;
  if not (public.hr_is_admin_or_hr() or public.hr_manages(p_employee)) then raise exception 'You are not allowed to change this attendance'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A change needs a reason'; end if;
  perform public.hr_attendance_validate(p_employee, p_date, p_status, p_in, p_out);
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text || p_date::text, 0));
  update public.hr_attendance_edits set state = 'superseded', decided_at = now() where employee_id = p_employee and work_date = p_date and state = 'pending';
  select jsonb_build_object('status', d.status, 'time_in', d.time_in, 'time_out', d.time_out) into old from public.hr_attendance_days(p_date, p_date, p_employee) d;
  insert into public.hr_attendance_edits (employee_id, work_date, status, time_in, time_out, note, old_values, reason)
  values (p_employee, p_date, p_status, p_in, p_out, p_note, old, btrim(p_reason)) returning id into new_id;
  perform public.hr_audit('attendance.edit_requested', 'hr_attendance_edits:' || new_id, old,
    jsonb_build_object('employee_id', p_employee, 'work_date', p_date, 'status', p_status, 'time_in', p_in, 'time_out', p_out, 'reason', btrim(p_reason)));
  return new_id;
end $$;

-- Returns {warning}: a locked month, when approving. A rejection needs a note.
create or replace function public.hr_attendance_decide(p_edit uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.hr_attendance_edits%rowtype; r jsonb := jsonb_build_object('warning', null);
begin
  if not public.admin_is() then raise exception 'Only an administrator can approve attendance changes'; end if;
  select * into e from public.hr_attendance_edits where id = p_edit for update;
  if not found then raise exception 'Change request not found'; end if;
  if e.state <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', e.state; end if;
  if not coalesce(p_approve, false) and (p_note is null or btrim(p_note) = '') then raise exception 'A rejection needs a note'; end if;
  if p_approve then r := public.hr_attendance_write(e.employee_id, e.work_date, e.status, e.time_in, e.time_out, e.note); end if;
  update public.hr_attendance_edits set state = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_edit;
  perform public.hr_audit(case when p_approve then 'attendance.edit_approved' else 'attendance.edit_rejected' end, 'hr_attendance_edits:' || p_edit,
    e.old_values, jsonb_build_object('employee_id', e.employee_id, 'work_date', e.work_date, 'status', e.status, 'note', p_note));
  return r;
end $$;

-- For the Approvals tab label. Only an admin has anything to decide.
create or replace function public.hr_attendance_edits_pending() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.admin_is() then (select count(*)::int from public.hr_attendance_edits where state = 'pending') else 0 end
$$;

-- For the screens. HR everyone, a manager self and direct reports, an employee self. At most 366 days at a time.
create or replace function public.hr_attendance_range(p_from date, p_to date)
returns table (employee_id uuid, employee_code text, full_name text, employee_status text, exit_date date, work_date date, status text, leave_kind text,
               time_in time, time_out time, late_minutes int, overtime_minutes int, source text, note text, pending_edit_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare vis uuid[] := public.hr_visible_employees();
begin
  if p_from is null or p_to is null then raise exception 'Both dates are required'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  if p_to - p_from > 366 then raise exception 'Show at most a year at a time'; end if;
  return query
  select d.*, ed.id from public.hr_attendance_days(p_from, p_to) d
  left join public.hr_attendance_edits ed on ed.employee_id = d.employee_id and ed.work_date = d.work_date and ed.state = 'pending'
  where vis is null or d.employee_id = any (vis);
end $$;

-- Cards, the people behind them and a day-by-day series. p_period: day, week (Monday to Sunday), month, year. Days after today count nothing.
-- Longer periods count person-days. Active is the headcount at the period's end, or today if that is earlier.
create or replace function public.hr_dashboard_period(p_period text, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  today date := (now() at time zone 'Asia/Dubai')::date;
  vis uuid[] := public.hr_visible_employees();
  d_from date; d_to date; last_d date; active int; cnt jsonb; ppl jsonb; ser jsonb;
  zero_counts jsonb := '{"present":0,"absent":0,"late":0,"overtime":0,"wfh":0,"leave_annual":0,"leave_unpaid":0}';
  zero_people jsonb := '{"present":[],"absent":[],"late":[],"overtime":[],"wfh":[],"leave_annual":[],"leave_unpaid":[]}';
begin
  if p_date is null then raise exception 'The date is required'; end if;
  case p_period
    when 'day' then d_from := p_date; d_to := p_date;
    when 'week' then d_from := date_trunc('week', p_date)::date; d_to := d_from + 6;
    when 'month' then d_from := date_trunc('month', p_date)::date; d_to := (d_from + interval '1 month - 1 day')::date;
    when 'year' then d_from := date_trunc('year', p_date)::date; d_to := (d_from + interval '1 year - 1 day')::date;
    else raise exception 'Unknown period %. Use day, week, month or year', p_period;
  end case;
  last_d := least(d_to, today);

  select count(*) into active from public.hr_employees e
  where (vis is null or e.id = any (vis))
    and (e.join_date is null or e.join_date <= last_d)
    and (e.exit_date is null or e.exit_date >= last_d)
    and (e.status <> 'Left' or e.exit_date is not null);

  with r as (
    select * from public.hr_attendance_days(d_from, d_to) x where x.work_date <= today and (vis is null or x.employee_id = any (vis))
  ), keyed as (
    select r.employee_id, r.full_name, r.work_date, k
    from r cross join lateral unnest(array_remove(array[
      case when r.status = 'Present' then 'present' end,
      case when r.status = 'Absent' then 'absent' end,
      case when r.late_minutes > 0 then 'late' end,
      case when r.overtime_minutes > 0 then 'overtime' end,
      case when r.status = 'WFH' then 'wfh' end,
      case when r.status = 'Leave' and r.leave_kind is distinct from 'Unpaid' then 'leave_annual' end,
      case when r.status = 'Leave' and r.leave_kind = 'Unpaid' then 'leave_unpaid' end], null)) k
  ), per_person as (
    select k, jsonb_agg(jsonb_build_object('employee_id', employee_id, 'full_name', full_name, 'days', n) order by full_name) as people, sum(n) as total
    from (select k, employee_id, full_name, count(*) as n from keyed group by 1, 2, 3) p group by k
  ), per_day as (
    select g.d::date as d,
           count(*) filter (where ky.k = 'present') as present, count(*) filter (where ky.k = 'absent') as absent, count(*) filter (where ky.k = 'late') as late
    from generate_series(d_from::timestamp, d_to::timestamp, interval '1 day') g(d)
    left join keyed ky on ky.work_date = g.d::date
    group by 1
  )
  select zero_counts || coalesce((select jsonb_object_agg(k, total) from per_person), '{}'),
         zero_people || coalesce((select jsonb_object_agg(k, people) from per_person), '{}'),
         (select jsonb_agg(jsonb_build_object('date', d, 'present', present, 'absent', absent, 'late', late) order by d) from per_day)
    into cnt, ppl, ser;

  return jsonb_build_object('from', d_from, 'to', d_to, 'active', active, 'counts', cnt, 'people', ppl, 'series', ser);
end $$;

revoke all on function public.hr_is_wfh_saturday(date), public.hr_attendance_days(date, date, uuid), public.hr_visible_employees(),
  public.hr_attendance_range(date, date), public.hr_dashboard_period(text, date),
  public.hr_attendance_validate(uuid, date, text, time, time), public.hr_attendance_write(uuid, date, text, time, time, text),
  public.hr_attendance_set(uuid, date, text, time, time, text), public.hr_attendance_request(uuid, date, text, time, time, text, text),
  public.hr_attendance_decide(uuid, boolean, text), public.hr_attendance_edits_pending() from public, anon, authenticated;
grant execute on function public.hr_attendance_range(date, date), public.hr_dashboard_period(text, date),
  public.hr_attendance_set(uuid, date, text, time, time, text), public.hr_attendance_request(uuid, date, text, time, time, text, text),
  public.hr_attendance_decide(uuid, boolean, text), public.hr_attendance_edits_pending() to authenticated;

-- ── pay and leave ──
alter table public.hr_leave_types add column if not exists carry_forward boolean not null default false;
alter table public.hr_settings add column if not exists leave_carry_start_year int not null default 2026;

-- Dates in a range that are unpaid: every day inside approved unpaid leave, and every Absent day not inside approved paid leave, each date once.
-- Absent comes from hr_attendance_days, so a blank working day counts once absent_from_blank_days is on. Leave is checked first because pay has
-- always counted approved leave over a stored day; the line's review note says so. p_working_only keeps only working days.
create or replace function public.hr_pay_unpaid_days(p_employee uuid, p_from date, p_to date, p_working_only boolean)
returns table (day date, why text)
language sql stable security definer set search_path = public, pg_temp as $$
  select g.d::date, case when coalesce(a.status, '') = 'Absent' then 'Absent' else 'Unpaid leave' end
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  left join public.hr_attendance_days(p_from, p_to, p_employee) a on a.work_date = g.d::date
  left join lateral (
    select bool_or(t.paid) as has_paid, bool_or(not t.paid) as has_unpaid
    from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id
    where r.employee_id = p_employee and r.status = 'approved' and g.d::date between r.from_date and r.to_date
  ) lv on true
  where (coalesce(lv.has_unpaid, false) or (coalesce(a.status, '') = 'Absent' and not coalesce(lv.has_paid, false)))
    and (not p_working_only
         or (not (extract(dow from g.d)::int = any ((select s.weekend_days from public.hr_settings s where s.id = 1)::int[]))
             and not exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date)))
  order by 1
$$;

-- Internal. Days carried into p_year: each earlier year's remainder from the start year or the join year, never below 0.
create or replace function public.hr_leave_carried(p_employee uuid, p_type uuid, p_year int) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  ty public.hr_leave_types%rowtype; e public.hr_employees%rowtype; start_y int; y int; carry numeric := 0; ent numeric; adj numeric; used numeric;
begin
  select * into ty from public.hr_leave_types where id = p_type;
  if not coalesce(ty.carry_forward, false) then return 0; end if;
  select * into e from public.hr_employees where id = p_employee;
  start_y := greatest((select leave_carry_start_year from public.hr_settings where id = 1), coalesce(extract(year from e.join_date)::int, 0));
  for y in start_y .. p_year - 1 loop
    select coalesce(b.entitlement, ty.annual_days, 0), coalesce(b.adjustment, 0) into ent, adj
    from (select 1) one left join public.hr_leave_balances b on b.employee_id = p_employee and b.leave_type_id = p_type and b.year = y;
    select coalesce(sum(r.days), 0) into used from public.hr_leave_requests r
    where r.employee_id = p_employee and r.leave_type_id = p_type and r.status = 'approved' and extract(year from r.from_date) = y;
    carry := greatest(carry + ent + adj - used, 0);
  end loop;
  return carry;
end $$;

-- As in 005, with what was carried in. HR any; manager direct reports; employee own.
drop function if exists public.hr_leave_balance(uuid, int);
create function public.hr_leave_balance(p_employee uuid, p_year int)
returns table (leave_type_id uuid, leave_type text, paid boolean, year int, entitlement numeric, adjustment numeric, used numeric, pending numeric, remaining numeric, carried numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.hr_is_admin_or_hr() or p_employee is not distinct from public.hr_my_employee_id() or public.hr_manages(p_employee)) then
    raise exception 'You are not allowed to see this balance';
  end if;
  return query
  select t.id, t.name, t.paid, p_year,
         coalesce(b.entitlement, t.annual_days),
         coalesce(b.adjustment, 0),
         u.approved,
         u.waiting,
         case when t.paid and coalesce(b.entitlement, t.annual_days) is not null then
           coalesce(b.entitlement, t.annual_days) + coalesce(b.adjustment, 0) + public.hr_leave_carried(p_employee, t.id, p_year) - u.approved
         end,
         public.hr_leave_carried(p_employee, t.id, p_year)
  from public.hr_leave_types t
  left join public.hr_leave_balances b on b.employee_id = p_employee and b.leave_type_id = t.id and b.year = p_year
  cross join lateral (
    select coalesce(sum(r.days) filter (where r.status = 'approved'), 0) as approved, coalesce(sum(r.days) filter (where r.status = 'pending'), 0) as waiting
    from public.hr_leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and extract(year from r.from_date) = p_year
  ) u
  order by t.name;
end $$;

-- Approve or reject a pending request. HR any; a manager for direct reports. Nobody decides their own.
-- A carry-forward type beyond its balance is split: the balance stays on the type and the rest moves to the type named Unpaid.
-- Returns {warning}: approval beyond a balance, and any locked month. Neither stops the decision.
create or replace function public.hr_leave_decide(p_request uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.hr_leave_requests%rowtype; new_status text; ty public.hr_leave_types%rowtype; rem numeric; warns text[] := '{}'; locked text; yr int;
  unpaid_id uuid; keep numeric; split_at date; d date; counted numeric := 0;
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
  select * into ty from public.hr_leave_types where id = r.leave_type_id;
  yr := extract(year from r.from_date)::int;

  if p_approve and ty.paid and ty.carry_forward then
    select b.remaining into rem from public.hr_leave_balance(r.employee_id, yr) b where b.leave_type_id = r.leave_type_id;
    if rem < r.days then
      select id into unpaid_id from public.hr_leave_types where name = 'Unpaid' and not paid;
      if unpaid_id is null then raise exception 'Add an Unpaid leave type first'; end if;
      keep := greatest(floor(rem), 0);
      if keep = 0 then
        update public.hr_leave_requests set leave_type_id = unpaid_id where id = p_request;
        warns := warns || format('%s %s: no balance left, so all %s day(s) are unpaid', ty.name, yr, r.days);
      else
        d := r.from_date;
        loop
          counted := counted + public.hr_leave_days(d, d);
          exit when counted >= keep;
          d := d + 1;
        end loop;
        split_at := d;
        update public.hr_leave_requests set to_date = split_at, days = keep where id = p_request;
        insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, note, approver, decided_at, decision_note, created_by)
        select r.employee_id, unpaid_id, g.first_d, r.to_date, r.days - keep, 'approved', r.note, auth.uid(), now(), p_note, r.created_by
        from (select min(x.d)::date as first_d from generate_series((split_at + 1)::timestamp, r.to_date::timestamp, interval '1 day') x(d) where public.hr_leave_days(x.d::date, x.d::date) > 0) g;
        warns := warns || format('%s %s: %s day(s) from the balance, %s day(s) unpaid', ty.name, yr, keep, r.days - keep);
      end if;
    end if;
  end if;

  update public.hr_leave_requests set status = new_status, approver = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
  perform public.hr_audit('leave.' || new_status, 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', new_status, 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days, 'note', p_note));
  if p_approve and ty.paid and not coalesce(ty.carry_forward, false) then
    select b.remaining into rem from public.hr_leave_balance(r.employee_id, yr) b where b.leave_type_id = r.leave_type_id;
    if rem < 0 then warns := warns || format('%s %s: approved %s day(s), which is %s beyond the balance', ty.name, yr, r.days, -rem); end if;
  end if;
  locked := public.hr_locked_month_warning(r.from_date, r.to_date);
  if locked is not null then warns := warns || locked; end if;
  return jsonb_build_object('warning', case when cardinality(warns) > 0 then array_to_string(warns, '; ') end);
end $$;

revoke all on function public.hr_pay_unpaid_days(uuid, date, date, boolean), public.hr_leave_carried(uuid, uuid, int),
  public.hr_leave_balance(uuid, int), public.hr_leave_decide(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.hr_leave_balance(uuid, int), public.hr_leave_decide(uuid, boolean, text) to authenticated;
