-- =====================================================================
-- HR Base - attendance                                             006
-- =====================================================================
-- hr_attendance: one row per employee per day (status, optional in/out times, note). Written only by hr_attendance_set (direct
-- writes denied). Readable by HR (all), a manager (direct reports), and an employee (own rows).
-- hr_attendance_set: HR any employee; a manager direct reports. Nobody but HR sets their own day. A future day (Asia/Dubai date) fails.
-- A Left employee cannot be given a day after exit_date. Absent, Leave, Holiday and Weekend days carry no times. Every change is audited.
-- hr_attendance_month: one row per in-scope employee per day. A stored row wins, then approved leave (Leave), a holiday (Holiday),
-- a weekend day (Weekend), otherwise status is null. Only days from join_date to exit_date apply; Left employees who exited before
-- the month are left out.
-- hr_dashboard() is redefined (same keys and scope as 005): present_today is now real, counted on the Asia/Dubai date.
-- Requires 002 (access helpers, hr_audit), 003 (hr_touch), 004 (hr_documents_expiring), 005 (settings, holidays, leave). Idempotent.
-- =====================================================================
create table if not exists public.hr_attendance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  work_date date not null,
  status text not null check (status in ('Present', 'Absent', 'Leave', 'Holiday', 'Weekend')),
  time_in time,
  time_out time,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (employee_id, work_date),
  check (time_out is null or time_in is null or time_out >= time_in),
  check (status = 'Present' or (time_in is null and time_out is null))
);
create index if not exists hr_attendance_date_idx on public.hr_attendance (work_date);

drop trigger if exists hr_attendance_touch on public.hr_attendance;
create trigger hr_attendance_touch before update on public.hr_attendance for each row execute function public.hr_touch();

alter table public.hr_attendance enable row level security;
revoke all on public.hr_attendance from public, anon, authenticated;
grant select on public.hr_attendance to authenticated;
drop policy if exists hr_attendance_read on public.hr_attendance;
create policy hr_attendance_read on public.hr_attendance for select to authenticated
  using (public.hr_is_admin_or_hr() or employee_id = public.hr_my_employee_id() or public.hr_manages(employee_id));
-- no write policy and no write grant

-- ── functions ──
create or replace function public.hr_attendance_set(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text)
returns void
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
  if emp.status = 'Left' and emp.exit_date is not null and p_date > emp.exit_date then
    raise exception 'This employee left on %. Later days cannot be recorded', emp.exit_date;
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
end $$;

create or replace function public.hr_attendance_month(p_year int, p_month int)
returns table (employee_id uuid, employee_code text, full_name text, work_date date, status text, time_in time, time_out time, note text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare first_day date; last_day date; wk int[];
begin
  if p_year is null or p_month is null or p_month < 1 or p_month > 12 then raise exception 'Month must be 1 to 12'; end if;
  first_day := make_date(p_year, p_month, 1);
  last_day := (first_day + interval '1 month - 1 day')::date;
  select s.weekend_days into wk from public.hr_settings s where s.id = 1;
  wk := coalesce(wk, '{0,6}');
  return query
  select e.id, e.employee_code, e.full_name, g.d::date,
         case
           when a.id is not null then a.status
           when exists (select 1 from public.hr_leave_requests r where r.employee_id = e.id and r.status = 'approved' and g.d::date between r.from_date and r.to_date) then 'Leave'
           when exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date) then 'Holiday'
           when extract(dow from g.d)::int = any (wk) then 'Weekend'
         end,
         a.time_in, a.time_out, a.note
  from public.hr_employees e
  cross join generate_series(first_day, last_day, interval '1 day') g(d)
  left join public.hr_attendance a on a.employee_id = e.id and a.work_date = g.d::date
  where (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))
    and not (e.status = 'Left' and e.exit_date < first_day)
    and (e.join_date is null or g.d::date >= e.join_date)
    and (e.exit_date is null or g.d::date <= e.exit_date)
  order by e.employee_code, g.d;
end $$;

-- Dashboard: same keys and scoping as 005; present_today is now real (Asia/Dubai date).
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

revoke all on function public.hr_attendance_set(uuid, date, text, time, time, text), public.hr_attendance_month(int, int), public.hr_dashboard() from public, anon, authenticated;
grant execute on function public.hr_attendance_set(uuid, date, text, time, time, text), public.hr_attendance_month(int, int), public.hr_dashboard() to authenticated;
