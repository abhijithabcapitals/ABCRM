-- =====================================================================
-- HR Base - biometric punches (e-timeoffice)                       009
-- =====================================================================
-- hr_biometric_punches: raw punches from the provider, one row per device code and minute/second. Kept as device local time.
-- hr_biometric_sync: one row, the last sync result, for the HR screen.
-- hr_employees.biometric_code: the provider's Empcode when it differs from employee_code. A punch matches biometric_code first, then
-- employee_code of an employee with no biometric_code. Exact text match, so 0001 and 1 are different codes.
-- hr_attendance.source: 'manual' or 'biometric'. Only the roll-up can write 'biometric' (hr_biometric.writing, set inside these functions);
-- any other write makes the day 'manual', and the roll-up never overwrites a manual day.
-- Roll-up: a day with punches becomes Present, first punch = time in, last punch = time out (null when there is only one distinct
-- punch). Calendar day only, overnight shifts are not supported. A day with no punches is never marked Absent: HR decides that.
-- A punch inside approved leave still writes Present; the grid shows it and payroll's existing review note flags unpaid leave.
-- Every written day is audited as attendance.*, so hr_payrun_changes_after reports it for an approved month.
-- hr_biometric_ingest and hr_biometric_sync_record: service role only (the hr-biometric-sync Edge Function).
-- hr_biometric_status and hr_biometric_link: HR only.
-- Requires 002 (access helpers, hr_audit), 006 (hr_attendance), 008. Idempotent.
-- =====================================================================
alter table public.hr_employees add column if not exists biometric_code text;
create unique index if not exists hr_employees_biometric_code_uq on public.hr_employees (biometric_code) where biometric_code is not null;

alter table public.hr_attendance add column if not exists source text not null default 'manual';
alter table public.hr_attendance drop constraint if exists hr_attendance_source_check;
alter table public.hr_attendance add constraint hr_attendance_source_check check (source in ('manual', 'biometric'));

create or replace function public.hr_attendance_source() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.source := case when current_setting('hr_biometric.writing', true) = 'on' then 'biometric' else 'manual' end;
  return new;
end $$;
drop trigger if exists hr_attendance_source on public.hr_attendance;
create trigger hr_attendance_source before insert or update on public.hr_attendance for each row execute function public.hr_attendance_source();

create table if not exists public.hr_biometric_punches (
  id uuid primary key default gen_random_uuid(),
  emp_code text not null,
  punch_at timestamp not null,
  machine_id text,
  device_name text,
  created_at timestamptz not null default now(),
  unique (emp_code, punch_at)
);
create index if not exists hr_biometric_punches_day_idx on public.hr_biometric_punches (emp_code, ((punch_at)::date));

create table if not exists public.hr_biometric_sync (
  id int primary key default 1 check (id = 1),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  last_stats jsonb
);
insert into public.hr_biometric_sync (id) values (1) on conflict (id) do nothing;

alter table public.hr_biometric_punches enable row level security;
alter table public.hr_biometric_sync enable row level security;
revoke all on public.hr_biometric_punches, public.hr_biometric_sync from public, anon, authenticated;
grant select on public.hr_biometric_punches, public.hr_biometric_sync to authenticated;
drop policy if exists hr_biometric_punches_read on public.hr_biometric_punches;
create policy hr_biometric_punches_read on public.hr_biometric_punches for select to authenticated using (public.hr_is_admin_or_hr());
drop policy if exists hr_biometric_sync_read on public.hr_biometric_sync;
create policy hr_biometric_sync_read on public.hr_biometric_sync for select to authenticated using (public.hr_is_admin_or_hr());
-- no write policy and no write grant

-- ── functions ──
create or replace function public.hr_biometric_employee(p_code text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select id from public.hr_employees where biometric_code = p_code),
    (select id from public.hr_employees where employee_code = p_code and biometric_code is null))
$$;

-- Returns what happened to the day: created, updated, same, manual, unmatched, out_of_range.
create or replace function public.hr_biometric_rollup(p_code text, p_date date) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  emp public.hr_employees%rowtype;
  old public.hr_attendance%rowtype;
  today date := (now() at time zone 'Asia/Dubai')::date;
  first_t time; last_t time; new_out time; existed boolean;
begin
  select * into emp from public.hr_employees where id = public.hr_biometric_employee(p_code);
  if not found then return 'unmatched'; end if;
  if p_date > today or (emp.status = 'Left' and emp.exit_date is null)
     or (emp.exit_date is not null and p_date > emp.exit_date)
     or (emp.join_date is not null and p_date < emp.join_date) then
    return 'out_of_range';
  end if;
  select min(punch_at)::time, max(punch_at)::time into first_t, last_t
  from public.hr_biometric_punches where emp_code = p_code and punch_at >= p_date and punch_at < p_date + 1;
  if first_t is null then return 'same'; end if;
  new_out := case when last_t > first_t then last_t end;

  perform pg_advisory_xact_lock(hashtextextended(emp.id::text || p_date::text, 0));
  select * into old from public.hr_attendance where employee_id = emp.id and work_date = p_date;
  existed := found;
  if existed and old.source = 'manual' then return 'manual'; end if;
  if existed and old.time_in is not distinct from first_t and old.time_out is not distinct from new_out then return 'same'; end if;

  perform set_config('hr_biometric.writing', 'on', true);
  if existed then
    update public.hr_attendance set status = 'Present', time_in = first_t, time_out = new_out where id = old.id;
    perform public.hr_audit('attendance.biometric_updated', 'hr_attendance:' || old.id,
      jsonb_build_object('employee_id', emp.id, 'work_date', p_date, 'status', old.status, 'time_in', old.time_in, 'time_out', old.time_out),
      jsonb_build_object('employee_id', emp.id, 'work_date', p_date, 'status', 'Present', 'time_in', first_t, 'time_out', new_out));
  else
    insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out)
    values (emp.id, p_date, 'Present', first_t, new_out) returning * into old;
    perform public.hr_audit('attendance.biometric_created', 'hr_attendance:' || old.id, null,
      jsonb_build_object('employee_id', emp.id, 'work_date', p_date, 'status', 'Present', 'time_in', first_t, 'time_out', new_out));
  end if;
  perform set_config('hr_biometric.writing', 'off', true);
  return case when existed then 'updated' else 'created' end;
end $$;

-- p_punches: [{emp_code, punch_at, machine_id, device_name}]. Safe to send the same punches again.
create or replace function public.hr_biometric_ingest(p_punches jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  added int;
  rec record;
  outcome text;
  days jsonb := '{"created":0,"updated":0,"same":0,"manual":0,"unmatched":0,"out_of_range":0}';
begin
  if p_punches is null or jsonb_typeof(p_punches) <> 'array' then raise exception 'Punches must be a list'; end if;
  with incoming as (
    select distinct on (x.emp_code, x.punch_at) x.emp_code, x.punch_at, x.machine_id, x.device_name
    from jsonb_to_recordset(p_punches) as x(emp_code text, punch_at timestamp, machine_id text, device_name text)
    where x.emp_code is not null and x.emp_code <> '' and x.punch_at is not null
  ), ins as (
    insert into public.hr_biometric_punches (emp_code, punch_at, machine_id, device_name)
    select emp_code, punch_at, machine_id, device_name from incoming
    on conflict (emp_code, punch_at) do nothing
    returning 1
  )
  select count(*) into added from ins;

  for rec in
    select distinct x.emp_code, x.punch_at::date as d
    from jsonb_to_recordset(p_punches) as x(emp_code text, punch_at timestamp)
    where x.emp_code is not null and x.emp_code <> '' and x.punch_at is not null
  loop
    outcome := public.hr_biometric_rollup(rec.emp_code, rec.d);
    days := jsonb_set(days, array[outcome], to_jsonb((days ->> outcome)::int + 1));
  end loop;
  return jsonb_build_object('received', jsonb_array_length(p_punches), 'new_punches', added, 'days', days);
end $$;

create or replace function public.hr_biometric_sync_record(p_ok boolean, p_error text, p_stats jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.hr_biometric_sync set
    last_attempt_at = now(),
    last_success_at = case when p_ok then now() else last_success_at end,
    last_error = case when p_ok then null else left(p_error, 500) end,
    last_stats = case when p_ok then p_stats else last_stats end
  where id = 1
$$;

create or replace function public.hr_biometric_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can see the biometric sync'; end if;
  return (select jsonb_build_object(
    'last_attempt_at', s.last_attempt_at, 'last_success_at', s.last_success_at, 'last_error', s.last_error, 'last_stats', s.last_stats,
    'unmatched', coalesce((
      select jsonb_agg(jsonb_build_object('emp_code', u.emp_code, 'device_name', u.device_name, 'punches', u.punches, 'last_punch', u.last_punch) order by u.emp_code)
      from (
        select p.emp_code, count(*) as punches, max(p.punch_at) as last_punch,
               (array_agg(p.device_name order by p.punch_at desc))[1] as device_name
        from public.hr_biometric_punches p
        where public.hr_biometric_employee(p.emp_code) is null
        group by p.emp_code
      ) u), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object('employee_id', e.id, 'employee_code', e.employee_code, 'full_name', e.full_name, 'biometric_code', e.biometric_code) order by e.biometric_code)
      from public.hr_employees e where e.biometric_code is not null), '[]'::jsonb))
    from public.hr_biometric_sync s where s.id = 1);
end $$;

-- Links an employee to a device code (null or blank unlinks). Biometric days that no longer have a punch under the new code are
-- removed and audited, then every day of the new code is rolled up. Manual days stay.
create or replace function public.hr_biometric_link(p_employee uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  code text := nullif(trim(p_code), '');
  emp public.hr_employees%rowtype;
  rec record;
  effective text;
  removed int := 0;
  rolled int := 0;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can link a biometric code'; end if;
  select * into emp from public.hr_employees where id = p_employee;
  if not found then raise exception 'Employee not found'; end if;
  if code is not null and exists (select 1 from public.hr_employees where biometric_code = code and id <> p_employee) then
    raise exception 'Biometric code % is already linked to another employee. Unlink it first', code;
  end if;
  if emp.biometric_code is not distinct from code then return jsonb_build_object('removed', 0, 'days', 0); end if;

  update public.hr_employees set biometric_code = code where id = p_employee;
  perform public.hr_audit('biometric.linked', 'hr_employees:' || p_employee,
    jsonb_build_object('biometric_code', emp.biometric_code), jsonb_build_object('biometric_code', code));
  effective := coalesce(code, emp.employee_code);

  for rec in
    select a.* from public.hr_attendance a
    where a.employee_id = p_employee and a.source = 'biometric'
      and not exists (select 1 from public.hr_biometric_punches p where p.emp_code = effective and p.punch_at >= a.work_date and p.punch_at < a.work_date + 1)
  loop
    delete from public.hr_attendance where id = rec.id;
    perform public.hr_audit('attendance.biometric_removed', 'hr_attendance:' || rec.id,
      jsonb_build_object('employee_id', p_employee, 'work_date', rec.work_date, 'status', rec.status, 'time_in', rec.time_in, 'time_out', rec.time_out),
      jsonb_build_object('employee_id', p_employee, 'work_date', rec.work_date, 'status', 'nothing recorded'));
    removed := removed + 1;
  end loop;

  for rec in select distinct punch_at::date as d from public.hr_biometric_punches where emp_code = effective loop
    perform public.hr_biometric_rollup(effective, rec.d);
    rolled := rolled + 1;
  end loop;
  return jsonb_build_object('removed', removed, 'days', rolled);
end $$;

revoke all on function public.hr_biometric_employee(text), public.hr_biometric_rollup(text, date), public.hr_biometric_ingest(jsonb),
  public.hr_biometric_sync_record(boolean, text, jsonb), public.hr_biometric_status(), public.hr_biometric_link(uuid, text),
  public.hr_attendance_source() from public, anon, authenticated;
grant execute on function public.hr_biometric_status(), public.hr_biometric_link(uuid, text) to authenticated;
grant execute on function public.hr_biometric_ingest(jsonb), public.hr_biometric_sync_record(boolean, text, jsonb) to service_role;
