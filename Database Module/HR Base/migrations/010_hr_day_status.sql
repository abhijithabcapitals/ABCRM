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
  select d.*, null::uuid from public.hr_attendance_days(p_from, p_to) d where vis is null or d.employee_id = any (vis);
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
  public.hr_attendance_range(date, date), public.hr_dashboard_period(text, date) from public, anon, authenticated;
grant execute on function public.hr_attendance_range(date, date), public.hr_dashboard_period(text, date) to authenticated;
