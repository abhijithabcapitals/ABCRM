-- LOCAL TEST ONLY: day status, period counts, edit approval, pay and leave rules. Runs after 060 on the same cluster (reuses its helpers).
-- Profile ...0a is the admin and ...0b the HR list member from 010. Earlier fixtures are retired so counts here are exact.
-- Dates after today cannot have a status, so the 2027 Saturdays are checked through hr_is_wfh_saturday.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
update public.hr_employees set status = 'Left', exit_date = '2000-01-01', join_date = '1999-01-01';
update public.hr_settings set absent_from_blank_days = true, weekend_days = '{0}', shift_start = '09:30', shift_end = '18:30', saturday_end = '14:00' where id = 1;
delete from public.hr_holidays;
insert into public.hr_wfh_saturday_rules (effective_from, effective_to, pattern) values (null, '2026-12-31', 'last'), ('2027-01-01', null, 'second_and_last');
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Day Staff', 'member'),
  ('00000000-0000-0000-0000-0000000000f2', 'Day Unlinked Login', 'member'),
  ('00000000-0000-0000-0000-0000000000f6', 'Day Manager', 'member')
on conflict (id) do nothing;
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, exit_date, status, manager_id) values
  ('4a000000-0000-0000-0000-0000000000f6', 'DS-6', 'Day Manager', '00000000-0000-0000-0000-0000000000f6', '2026-09-01', null, 'Active', null),
  ('4a000000-0000-0000-0000-0000000000f1', 'DS-1', 'Day Staff', '00000000-0000-0000-0000-0000000000f1', '2026-09-01', null, 'Active', '4a000000-0000-0000-0000-0000000000f6'),
  ('4a000000-0000-0000-0000-0000000000f2', 'DS-2', 'No Dates', null, null, null, 'Active', null),
  ('4a000000-0000-0000-0000-0000000000f3', 'DS-3', 'First Punch', null, null, null, 'Active', null),
  ('4a000000-0000-0000-0000-0000000000f4', 'DS-4', 'Has Exit', null, '2026-09-01', '2026-10-15', 'Left', null),
  ('4a000000-0000-0000-0000-0000000000f5', 'DS-5', 'Left No Exit', null, '2026-09-01', null, 'Active', null);
create or replace function public.ds(p text) returns uuid language sql as $$ select ('4a000000-0000-0000-0000-0000000000' || p)::uuid $$;
grant execute on function public.ds(text) to authenticated;
create or replace function public.ds_status(p_e text, p_d date) returns text language sql security definer as $$
  select status from public.hr_attendance_days(p_d, p_d, public.ds(p_e))
$$;
create or replace function public.ds_late(p_e text, p_d date) returns int language sql security definer as $$
  select late_minutes from public.hr_attendance_days(p_d, p_d, public.ds(p_e))
$$;
create or replace function public.ds_over(p_e text, p_d date) returns int language sql security definer as $$
  select overtime_minutes from public.hr_attendance_days(p_d, p_d, public.ds(p_e))
$$;
insert into public.hr_leave_types (id, name, paid, annual_days) values
  ('41000000-0000-0000-0000-000000000001', 'DS Paid', true, 30),
  ('41000000-0000-0000-0000-000000000002', 'DS Unpaid', false, null);

select public.hr_biometric_ingest('[
  {"emp_code":"DS-1","punch_at":"2026-10-05T09:30:00"}, {"emp_code":"DS-1","punch_at":"2026-10-05T18:30:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-06T09:31:00"}, {"emp_code":"DS-1","punch_at":"2026-10-06T18:45:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-03T09:00:00"}, {"emp_code":"DS-1","punch_at":"2026-10-03T14:10:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-07T09:00:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-04T10:00:00"}, {"emp_code":"DS-1","punch_at":"2026-10-04T20:00:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-08T09:00:00"}, {"emp_code":"DS-1","punch_at":"2026-10-09T09:00:00"}, {"emp_code":"DS-1","punch_at":"2026-10-12T09:00:00"},
  {"emp_code":"DS-1","punch_at":"2026-10-31T09:00:00"},
  {"emp_code":"DS-3","punch_at":"2026-10-01T09:00:00"},
  {"emp_code":"DS-5","punch_at":"2026-10-05T09:00:00"}]') is null;

update public.hr_employees set status = 'Left' where id = public.ds('f5');

-- Manual Absent over punches: DS-1 on 2026-10-08. Leave over punches: 2026-10-09. Holiday over punches: 2026-10-12.
insert into public.hr_holidays (holiday_date, name) values ('2026-10-12', 'DS Holiday');
update public.hr_attendance set status = 'Absent', time_in = null, time_out = null where employee_id = public.ds('f1') and work_date = '2026-10-08';
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values
  (public.ds('f1'), '41000000-0000-0000-0000-000000000001', '2026-10-09', '2026-10-09', 1, 'approved'),
  (public.ds('f1'), '41000000-0000-0000-0000-000000000002', '2026-10-13', '2026-10-13', 1, 'approved');

-- ── status order ──
select public.ok('manual day wins over punches', public.ds_status('f1', '2026-10-08') = 'Absent', public.ds_status('f1', '2026-10-08'));
select public.ok('leave wins over punches', public.ds_status('f1', '2026-10-09') = 'Leave', public.ds_status('f1', '2026-10-09'));
select public.ok('paid leave is Annual', (select leave_kind = 'Annual' from public.hr_attendance_days('2026-10-09', '2026-10-09', public.ds('f1'))));
select public.ok('unpaid leave is Unpaid', (select leave_kind = 'Unpaid' from public.hr_attendance_days('2026-10-13', '2026-10-13', public.ds('f1'))));
select public.ok('holiday wins over punches', public.ds_status('f1', '2026-10-12') = 'Holiday', public.ds_status('f1', '2026-10-12'));
select public.ok('punches win over a WFH Saturday', public.ds_status('f1', '2026-10-31') = 'Present', public.ds_status('f1', '2026-10-31'));
select public.ok('last Saturday with no punch is WFH', public.ds_status('f6', '2026-10-31') = 'WFH', public.ds_status('f6', '2026-10-31'));
select public.ok('second Saturday in 2026 with no punch is Absent', public.ds_status('f6', '2026-10-10') = 'Absent', public.ds_status('f6', '2026-10-10'));
select public.ok('Sunday with no punch is Weekend', public.ds_status('f6', '2026-10-11') = 'Weekend', public.ds_status('f6', '2026-10-11'));
select public.ok('working day with no punch is Absent', public.ds_status('f6', '2026-10-05') = 'Absent', public.ds_status('f6', '2026-10-05'));

-- ── WFH Saturday patterns ──
select public.ok('2026-11-28 is WFH', public.hr_is_wfh_saturday('2026-11-28'));
select public.ok('2026-11-14 is not WFH', not public.hr_is_wfh_saturday('2026-11-14'));
select public.ok('2026-12-26 is WFH', public.hr_is_wfh_saturday('2026-12-26'));
select public.ok('2027-01-09 is WFH', public.hr_is_wfh_saturday('2027-01-09'));
select public.ok('2027-01-30 is WFH', public.hr_is_wfh_saturday('2027-01-30'));
select public.ok('2027-01-16 is not WFH', not public.hr_is_wfh_saturday('2027-01-16'));
select public.ok('a weekday is never WFH', not public.hr_is_wfh_saturday('2027-01-11'));

-- ── late and overtime ──
select public.ok('in at exactly 09:30 is not late', public.ds_late('f1', '2026-10-05') = 0);
select public.ok('out at exactly 18:30 is not overtime', public.ds_over('f1', '2026-10-05') = 0);
select public.ok('in at 09:31 is 1 minute late', public.ds_late('f1', '2026-10-06') = 1);
select public.ok('out at 18:45 is 15 minutes overtime', public.ds_over('f1', '2026-10-06') = 15);
select public.ok('Saturday out at 14:10 is 10 minutes overtime', public.ds_over('f1', '2026-10-03') = 10);
select public.ok('one punch has no time out', (select time_out is null from public.hr_attendance_days('2026-10-07', '2026-10-07', public.ds('f1'))));
select public.ok('one punch has no overtime', public.ds_over('f1', '2026-10-07') = 0);
select public.ok('Sunday punch is Present', public.ds_status('f1', '2026-10-04') = 'Present');
select public.ok('Sunday punch has no late', public.ds_late('f1', '2026-10-04') = 0);
select public.ok('Sunday punch has no overtime', public.ds_over('f1', '2026-10-04') = 0);

-- ── range of a person ──
select public.ok('no join date and no punches means no Absent, ever', (select count(*) = 0 from public.hr_attendance_days('2025-01-01', '2026-11-01', public.ds('f2')) where status = 'Absent'));
select public.ok('no join date: nothing before the first punch', public.ds_status('f3', '2026-09-30') is null);
select public.ok('no join date: Absent after the first punch', public.ds_status('f3', '2026-10-02') = 'Absent');
select public.ok('blank after the exit date', public.ds_status('f4', '2026-10-16') is null);
select public.ok('Absent up to the exit date', public.ds_status('f4', '2026-10-15') = 'Absent');
select public.ok('Left with no exit date: blank after the last punch', public.ds_status('f5', '2026-10-06') is null);
select public.ok('a date after today is blank', public.ds_status('f6', (now() at time zone 'Asia/Dubai')::date + 2) is null);
select public.ok('today with no punch is Absent unless off', (select status in ('Absent', 'Weekend', 'WFH') from public.hr_attendance_days((now() at time zone 'Asia/Dubai')::date, (now() at time zone 'Asia/Dubai')::date, public.ds('f6'))));
update public.hr_settings set absent_from_blank_days = false where id = 1;
select public.ok('with the setting off a blank working day stays blank', public.ds_status('f6', '2026-10-05') is null);
update public.hr_settings set absent_from_blank_days = true where id = 1;

-- ── scope ──
set role authenticated;
select public.as_user('f1');
select public.ok('an employee sees only themselves', (select count(distinct employee_id) = 1 and bool_and(employee_id = public.ds('f1')) from public.hr_attendance_range('2026-10-05', '2026-10-05')));
select public.must_fail('an employee cannot read the internal function', $s$select * from public.hr_attendance_days('2026-10-05', '2026-10-05')$s$, 'permission denied');
select public.as_user('f6');
select public.ok('a manager sees self and reports', (select count(distinct employee_id) = 2 from public.hr_attendance_range('2026-10-05', '2026-10-05')));
select public.as_user('0b');
select public.ok('HR sees everyone in range', (select count(distinct employee_id) >= 4 from public.hr_attendance_range('2026-10-05', '2026-10-05')));
select public.as_user('f2');
select public.ok('an unlinked login sees nothing', (select count(*) = 0 from public.hr_attendance_range('2026-10-05', '2026-10-05')));
select public.as_user('0a');
select public.must_fail('a range over a year and a bit is refused', $s$select * from public.hr_attendance_range('2024-01-01', '2026-01-01')$s$, 'at most');
select public.must_fail('a backwards range is refused', $s$select * from public.hr_attendance_range('2026-10-05', '2026-10-01')$s$, 'before');

-- ── dashboard ──
select public.ok('day counts are exact', (select r -> 'counts' = '{"present":2,"absent":3,"late":0,"overtime":0,"wfh":0,"leave_annual":0,"leave_unpaid":0}'::jsonb from (select public.hr_dashboard_period('day', '2026-10-05') r) x), (select (public.hr_dashboard_period('day', '2026-10-05') -> 'counts')::text));
select public.ok('day card lists its people', (select jsonb_array_length(r #> '{people,present}') = 2 from (select public.hr_dashboard_period('day', '2026-10-05') r) x));
select public.ok('a late day counts as present and late', (select (r #>> '{counts,late}')::int = 1 and (r #>> '{counts,overtime}')::int = 1 from (select public.hr_dashboard_period('day', '2026-10-06') r) x));
select public.ok('leave kinds count apart', (select (r #>> '{counts,leave_annual}')::int = 1 from (select public.hr_dashboard_period('day', '2026-10-09') r) x));
select public.ok('a week runs Monday to Sunday', (select r ->> 'from' = '2026-10-05' and r ->> 'to' = '2026-10-11' from (select public.hr_dashboard_period('week', '2026-10-07') r) x));
select public.ok('a month covers the month', (select r ->> 'from' = '2026-10-01' and r ->> 'to' = '2026-10-31' from (select public.hr_dashboard_period('month', '2026-10-07') r) x));
select public.ok('a year covers the year', (select r ->> 'from' = '2026-01-01' and r ->> 'to' = '2026-12-31' from (select public.hr_dashboard_period('year', '2026-10-07') r) x));
select public.ok('active counts people employed at the end', (select (r ->> 'active')::int = 5 from (select public.hr_dashboard_period('day', '2026-10-05') r) x), (select public.hr_dashboard_period('day', '2026-10-05') ->> 'active'));
select public.ok('the series has one row per day', (select jsonb_array_length(r -> 'series') = 7 from (select public.hr_dashboard_period('week', '2026-10-07') r) x));
select public.must_fail('an unknown period is refused', $s$select public.hr_dashboard_period('bad', '2026-10-07')$s$, 'period');
select public.as_user('f1');
select public.ok('an employee''s dashboard counts only themselves', (select (r ->> 'active')::int = 1 from (select public.hr_dashboard_period('day', '2026-10-05') r) x));
select public.as_user('f2');
select public.ok('an unlinked login counts nothing', (select (r ->> 'active')::int = 0 from (select public.hr_dashboard_period('day', '2026-10-05') r) x));
reset role;
select public.ok('anon cannot read the dashboard', not has_function_privilege('anon', 'public.hr_dashboard_period(text, date)', 'execute'));
select public.ok('anon cannot read the range', not has_function_privilege('anon', 'public.hr_attendance_range(date, date)', 'execute'));

-- ── a year for 14 people stays quick ──
insert into public.hr_employees (employee_code, full_name, join_date, status) select 'PF-' || g, 'Perf ' || g, '2025-01-01', 'Active' from generate_series(1, 14) g;
set role authenticated;
select public.as_user('0a');
create temp table t_ms as select extract(epoch from clock_timestamp()) s;
select public.hr_dashboard_period('year', '2026-06-15') is null;
select public.ok('a year for 14 people takes under 2 seconds', (select extract(epoch from clock_timestamp()) - s < 2 from t_ms), (select (extract(epoch from clock_timestamp()) - s)::text from t_ms));
reset role;
update public.hr_employees set status = 'Left', exit_date = '2000-01-01', join_date = '1999-01-01' where employee_code like 'PF-%';

reset role;
\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
