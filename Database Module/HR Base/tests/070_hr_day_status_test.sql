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

-- ── edit requests and approval ──
set role authenticated;
select public.as_user('0a');
select public.ok('admin set applies at once', (public.hr_attendance_set(public.ds('f1'), '2026-10-14', 'WFH', '09:00', '18:00', 'home') ->> 'warning') is null);
select public.ok('the admin edit shows as WFH with times', public.ds_status('f1', '2026-10-14') = 'WFH');
reset role;
select public.ok('the admin edit is audited', (select count(*) >= 1 from public.hr_audit_log where action like 'attendance.%' and new_values ->> 'work_date' = '2026-10-14'));
set role authenticated;
select public.as_user('0b');
select public.must_fail('an HR list member cannot set directly', $s$select public.hr_attendance_set(public.ds('f1'), '2026-10-15', 'Absent', null, null, null)$s$, 'administrator');
select public.as_user('f6');
select public.must_fail('a manager cannot set directly', $s$select public.hr_attendance_set(public.ds('f1'), '2026-10-15', 'Absent', null, null, null)$s$, 'administrator');
select public.must_fail('a blank reason is refused', $s$select public.hr_attendance_request(public.ds('f1'), '2026-10-15', 'WFH', null, null, null, '  ')$s$, 'reason');
select public.must_fail('a request is validated like a set', $s$select public.hr_attendance_request(public.ds('f1'), '2999-01-01', 'WFH', null, null, null, 'x')$s$, 'future');
select public.as_user('f1');
select public.as_user('f6');
create temp table t_edit as select public.hr_attendance_request(public.ds('f1'), '2026-10-15', 'WFH', null, null, 'note', 'worked from home') as id;
select public.ok('the cell keeps its old value while pending', public.ds_status('f1', '2026-10-15') = 'Absent', public.ds_status('f1', '2026-10-15'));
select public.as_user('0a');
select public.ok('the range shows the pending edit', (select pending_edit_id = (select id from t_edit) from public.hr_attendance_range('2026-10-15', '2026-10-15') where employee_id = public.ds('f1')));
select public.ok('the pending count is 1', public.hr_attendance_edits_pending() = 1);
select public.as_user('f6');
create temp table t_edit2 as select public.hr_attendance_request(public.ds('f1'), '2026-10-15', 'Leave', null, null, null, 'correction') as id;
select public.as_user('0a');
select public.ok('a newer request supersedes the older', (select state = 'superseded' from public.hr_attendance_edits where id = (select id from t_edit)));
select public.ok('only one is pending', public.hr_attendance_edits_pending() = 1);
select public.as_user('0b');
select public.as_user('f6');
select public.must_fail('a manager cannot decide', $s$select public.hr_attendance_decide((select id from t_edit2), true, null)$s$, 'Only HR');
select public.as_user('0a');
select public.must_fail('a rejection needs a note', $s$select public.hr_attendance_decide((select id from t_edit2), false, ' ')$s$, 'note');
select public.hr_attendance_decide((select id from t_edit2), false, 'not right') is null;
select public.ok('a rejection leaves the cell alone', public.ds_status('f1', '2026-10-15') = 'Absent');
select public.must_fail('a decided edit cannot be decided again', $s$select public.hr_attendance_decide((select id from t_edit2), true, null)$s$, 'pending');
select public.as_user('f6');
create temp table t_edit3 as select public.hr_attendance_request(public.ds('f1'), '2026-10-15', 'WFH', '09:00', null, null, 'right this time') as id;
select public.as_user('0a');
select public.hr_attendance_decide((select id from t_edit3), true, null) is null;
select public.ok('approval applies the edit', public.ds_status('f1', '2026-10-15') = 'WFH');
select public.ok('an approved edit is manual', (select source = 'manual' from public.hr_attendance_range('2026-10-15', '2026-10-15') where employee_id = public.ds('f1')));
select public.ok('the edit records who decided', (select state = 'approved' and decided_by = '00000000-0000-0000-0000-00000000000a' from public.hr_attendance_edits where id = (select id from t_edit3)));
reset role;
select public.ok('approval is audited', (select count(*) = 1 from public.hr_audit_log where action = 'attendance.edit_approved' and target = 'hr_attendance_edits:' || (select id from t_edit3)));

-- A sync between the request and the decision: approval still wins, and later syncs leave the day alone.
select public.hr_biometric_ingest('[{"emp_code":"DS-1","punch_at":"2026-10-21T09:00:00"}]') is null;
set role authenticated;
select public.as_user('f6');
create temp table t_edit4 as select public.hr_attendance_request(public.ds('f1'), '2026-10-21', 'Absent', null, null, null, 'punch was a mistake') as id;
reset role;
select public.hr_biometric_ingest('[{"emp_code":"DS-1","punch_at":"2026-10-21T18:00:00"}]') is null;
set role authenticated;
select public.as_user('0a');
select public.hr_attendance_decide((select id from t_edit4), true, null) is null;
select public.ok('approval wins over a sync that came after the request', public.ds_status('f1', '2026-10-21') = 'Absent');
reset role;
select public.ok('a later sync leaves the approved day alone', (select (public.hr_biometric_ingest('[{"emp_code":"DS-1","punch_at":"2026-10-21T19:00:00"}]') #>> '{days,manual}')::int = 1));

-- An approved payroll month: the edit saves, warns, and the run does not change.
insert into public.hr_pay_runs (id, period_month) values ('42000000-0000-0000-0000-000000000001', '2026-09-01');
insert into public.hr_pay_lines (run_id, employee_id, net) values ('42000000-0000-0000-0000-000000000001', public.ds('f1'), 100);
update public.hr_pay_runs set status = 'approved', approved_by = '00000000-0000-0000-0000-00000000000a', approved_at = now() where id = '42000000-0000-0000-0000-000000000001';
set role authenticated;
select public.as_user('f6');
create temp table t_edit5 as select public.hr_attendance_request(public.ds('f1'), '2026-09-15', 'WFH', null, null, null, 'locked month') as id;
select public.as_user('0a');
select public.ok('approving in a locked month warns', (public.hr_attendance_decide((select id from t_edit5), true, null) ->> 'warning') ilike '%locked%');
select public.ok('the locked month edit is saved', public.ds_status('f1', '2026-09-15') = 'WFH');
select public.ok('the approved run does not change', (select net = 100 from public.hr_pay_lines where run_id = '42000000-0000-0000-0000-000000000001'));
select public.ok('the edits table cannot be written directly', not has_table_privilege('authenticated', 'public.hr_attendance_edits', 'insert'));
reset role;

reset role;
-- ── pay ──
update public.hr_settings set pay_day_divisor_mode = 'calendar_days', pay_unpaid_wage_base = 'total' where id = 1;
update public.hr_leave_types set carry_forward = true where name = 'DS Paid';
insert into public.hr_leave_types (name, paid) values ('Unpaid', false) on conflict (name) do update set paid = false;
insert into public.hr_employees (id, employee_code, full_name, join_date, status) values
  ('4b000000-0000-0000-0000-000000000001', 'PY-1', 'Pay One', '2026-01-01', 'Active'),
  ('4b000000-0000-0000-0000-000000000002', 'PY-2', 'Pay Two', '2026-01-01', 'Active'),
  ('4b000000-0000-0000-0000-000000000003', 'PY-3', 'Pay Three', '2026-01-01', 'Active'),
  ('4b000000-0000-0000-0000-000000000004', 'PY-4', 'Pay Four', '2026-01-01', 'Active'),
  ('4b000000-0000-0000-0000-000000000005', 'PY-5', 'Pay Late Joiner', '2027-06-01', 'Active');
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) select id, '2026-01-01', 1000, 'AE070331234567890123456' from public.hr_employees where employee_code like 'PY-%';
create or replace function public.py(p int) returns uuid language sql as $$ select ('4b000000-0000-0000-0000-00000000000' || p)::uuid $$;
grant execute on function public.py(int) to authenticated;
create or replace function public.net(p_month date, p_e int) returns numeric language sql security definer as $$
  select public.hr_pay_sum(c -> 'earnings') - public.hr_pay_sum(c -> 'deductions') from (select public.hr_pay_compute(p_month, public.py(p_e)) c) x
$$;
-- Every Monday to Saturday of a month Present, so a test's own removals are the only unpaid days.
create or replace function public.py_fill(p_e int, p_from date, p_to date) returns void language sql as $$
  insert into public.hr_attendance (employee_id, work_date, status)
  select public.py(p_e), g::date, 'Present' from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g where extract(dow from g) <> 0
$$;
select public.py_fill(1, '2026-09-01', '2026-10-31');

select public.ok('a full month pays the full salary', public.net('2026-09-01', 1) = 1000, public.net('2026-09-01', 1)::text);
delete from public.hr_attendance where employee_id = public.py(1) and work_date = '2026-09-08';
select public.ok('one Absent in a 30-day month deducts 33.33', public.net('2026-09-01', 1) = 966.67, public.net('2026-09-01', 1)::text);
update public.hr_attendance set time_in = '10:00', time_out = '20:00' where employee_id = public.py(1) and work_date = '2026-09-09';
select public.ok('late and overtime do not change pay', public.net('2026-09-01', 1) = 966.67, public.net('2026-09-01', 1)::text);
delete from public.hr_attendance where employee_id = public.py(1) and work_date = '2026-09-26';
select public.ok('a WFH Saturday is paid', public.net('2026-09-01', 1) = 966.67, public.net('2026-09-01', 1)::text);
delete from public.hr_attendance where employee_id = public.py(1) and work_date = '2026-09-10';
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values (public.py(1), '41000000-0000-0000-0000-000000000001', '2026-09-10', '2026-09-10', 1, 'approved');
select public.ok('a paid leave day is paid', public.net('2026-09-01', 1) = 966.67, public.net('2026-09-01', 1)::text);
delete from public.hr_attendance where employee_id = public.py(1) and work_date in ('2026-10-06', '2026-10-07');
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values (public.py(1), '41000000-0000-0000-0000-000000000002', '2026-10-06', '2026-10-07', 2, 'approved');
select public.ok('two unpaid leave days in a 31-day month deduct 64.52', public.net('2026-10-01', 1) = 935.48, public.net('2026-10-01', 1)::text);
select public.ok('every working day Absent still pays Sundays and the WFH Saturday, and is not negative', public.net('2026-08-01', 2) = 193.55, public.net('2026-08-01', 2)::text);

-- ── leave days ──
select public.ok('a WFH Saturday counts as a leave day, a Sunday does not', public.hr_leave_days('2026-09-26', '2026-09-28') = 2);
select public.ok('a holiday does not count as a leave day', public.hr_leave_days('2026-10-12', '2026-10-13') = 1);

-- ── annual balance ──
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values (public.py(3), '41000000-0000-0000-0000-000000000001', '2026-03-02', '2026-03-06', 5, 'approved');
set role authenticated;
select public.as_user('0a');
select public.ok('2026 balance is 30 less 5, nothing carried in', (select carried = 0 and remaining = 25 from public.hr_leave_balance(public.py(3), 2026) where leave_type = 'DS Paid'));
select public.ok('2027 carries 25 for a balance of 55', (select carried = 25 and remaining = 55 from public.hr_leave_balance(public.py(3), 2027) where leave_type = 'DS Paid'));
select public.ok('2028 keeps carrying with no cap', (select carried = 55 and remaining = 85 from public.hr_leave_balance(public.py(3), 2028) where leave_type = 'DS Paid'));
select public.ok('a type without carry forward carries nothing', (select carried = 0 from public.hr_leave_balance(public.py(3), 2027) where leave_type = 'DS Unpaid'));
select public.ok('a 2027 joiner carries nothing into 2027', (select carried = 0 and remaining = 30 from public.hr_leave_balance(public.py(5), 2027) where leave_type = 'DS Paid'));
select public.ok('a 2027 joiner carries 30 into 2028', (select carried = 30 and remaining = 60 from public.hr_leave_balance(public.py(5), 2028) where leave_type = 'DS Paid'));

-- ── beyond the balance ──
create temp table t_lv as select (public.hr_leave_request(public.py(4), '41000000-0000-0000-0000-000000000001', '2026-03-02', '2026-04-07', 'long') -> 'ids' ->> 0)::uuid as id;
create temp table t_lv_dec as select public.hr_leave_decide((select id from t_lv), true, null) as r;
select public.ok('the split warns', (select r ->> 'warning' ilike '%unpaid%' from t_lv_dec), (select r ->> 'warning' from t_lv_dec));
select public.ok('30 days stay on the annual type', (select days = 30 and to_date = '2026-04-04' from public.hr_leave_requests where id = (select id from t_lv)), (select to_date::text from public.hr_leave_requests where id = (select id from t_lv)));
select public.ok('2 days become unpaid', (select count(*) = 1 and sum(r.days) = 2 and min(r.from_date) = '2026-04-06' and max(r.to_date) = '2026-04-07' from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id where r.employee_id = public.py(4) and t.name = 'Unpaid' and r.status = 'approved'));
select public.ok('the balance ends at zero, not below', (select remaining = 0 from public.hr_leave_balance(public.py(4), 2026) where leave_type = 'DS Paid'));
create temp table t_lv2 as select (public.hr_leave_request(public.py(4), '41000000-0000-0000-0000-000000000001', '2026-05-04', '2026-05-05', null) -> 'ids' ->> 0)::uuid as id;
select public.hr_leave_decide((select id from t_lv2), true, null) is null;
select public.ok('with no balance left the whole request becomes unpaid', (select t.name = 'Unpaid' from public.hr_leave_requests r join public.hr_leave_types t on t.id = r.leave_type_id where r.id = (select id from t_lv2)));
reset role;
select public.ok('the split days are deducted', (select count(*) = 2 from public.hr_pay_unpaid_days(public.py(4), '2026-04-01', '2026-04-30', false) where why = 'Unpaid leave'));

-- A rule change that alters a deduction stops approval until the run is recalculated.
delete from public.hr_pay_lines where run_id in (select id from public.hr_pay_runs where period_month = '2026-07-01');
update public.hr_employees set status = 'Left', exit_date = '2026-06-30' where employee_code like 'PY-%' and employee_code <> 'PY-2';
update public.hr_employees set status = 'Left', exit_date = '2026-06-30' where employee_code like 'DS-%';
set role authenticated;
select public.as_user('0b');
create temp table t_run as select public.hr_payrun_create('2026-07-01') as id;
reset role;
insert into public.hr_wfh_saturday_rules (effective_from, effective_to, pattern) values ('2026-07-01', '2026-07-31', 'second_and_last');
set role authenticated;
select public.as_user('0a');
select public.must_fail('a WFH rule change stops approval', $s$select public.hr_payrun_approve((select id from t_run))$s$, 'Recalculate');
reset role;

-- ── nothing before tracking starts counts as Absent ──
update public.hr_settings set attendance_tracked_from = '2026-08-10' where id = 1;
select public.ok('a day before tracking starts is not Absent, whatever the join date', (select count(*) = 0 from public.hr_attendance_days('2026-01-01', '2026-08-09', public.py(2)) where status = 'Absent'));
select public.ok('a day after tracking starts is Absent', (select count(*) = 1 from public.hr_attendance_days('2026-08-10', '2026-08-10', public.py(2)) where status = 'Absent'));
select public.ok('no pay is lost before tracking starts', (select count(*) = 0 from public.hr_pay_unpaid_days(public.py(2), '2026-01-01', '2026-08-09', false)));
select public.ok('tracking does not invent days for someone with no dates', (select count(*) = 0 from public.hr_attendance_days('2026-08-10', '2026-08-20', public.ds('f2'))));
update public.hr_settings set attendance_tracked_from = null where id = 1;

-- ── the live seed, rolled back ──
begin;
\ir ../seed_ab_capital.sql
select count(*) as seed_rows from public.hr_pay_details where effective_from = '2026-01-01' and basic = 1000 and iban is null \gset
\ir ../seed_ab_capital.sql
select count(*) as seed_rows_again from public.hr_pay_details where effective_from = '2026-01-01' and basic = 1000 and iban is null \gset
select count(*) as seed_rules from public.hr_wfh_saturday_rules where pattern = 'second_and_last' and effective_from = '2027-01-01' \gset
select (annual_days = 30 and paid and carry_forward) as seed_annual from public.hr_leave_types where name = 'Annual' \gset
select (absent_from_blank_days and weekend_days = '{0}' and pay_day_divisor_mode = 'calendar_days' and pay_unpaid_wage_base = 'total') as seed_settings from public.hr_settings where id = 1 \gset
rollback;
select public.ok('the seed adds salaries once', :seed_rows = :seed_rows_again, :'seed_rows' || ' then ' || :'seed_rows_again');
select public.ok('the seed adds rules once', :seed_rules <= 2, :'seed_rules');
select public.ok('the seed sets the annual type', :'seed_annual'::boolean);
select public.ok('the seed sets the settings', :'seed_settings'::boolean);

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
