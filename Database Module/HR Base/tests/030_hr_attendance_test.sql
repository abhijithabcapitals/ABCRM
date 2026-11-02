-- LOCAL TEST ONLY: attendance rules and the month grid. Runs after 010 and 020 on the same cluster (reuses their helpers and data:
-- 020 leaves leave type 'Annual', holiday 2026-11-04, weekend {0,6} and the employee with profile ...a4 who is on the HR list).
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'Att Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000b2', 'Att Report', 'member'),
  ('00000000-0000-0000-0000-0000000000b3', 'Att Other', 'member'),
  ('00000000-0000-0000-0000-0000000000b4', 'Att Leaver', 'member'),
  ('00000000-0000-0000-0000-0000000000b5', 'Att Newcomer', 'member'),
  ('00000000-0000-0000-0000-0000000000b6', 'Att Past Exit', 'member'),
  ('00000000-0000-0000-0000-0000000000b7', 'Att Left No Date', 'member');
insert into public.hr_employees (id, employee_code, full_name, profile_id, manager_id, join_date, exit_date, status) values
  ('30000000-0000-0000-0000-0000000000b1', 'A-M', 'Att Manager', '00000000-0000-0000-0000-0000000000b1', null, '2024-01-01', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000b2', 'A-R', 'Att Report', '00000000-0000-0000-0000-0000000000b2', '30000000-0000-0000-0000-0000000000b1', '2024-01-01', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000b3', 'A-O', 'Att Other', '00000000-0000-0000-0000-0000000000b3', null, '2024-01-01', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000b4', 'A-L', 'Att Leaver', '00000000-0000-0000-0000-0000000000b4', '30000000-0000-0000-0000-0000000000b1', '2025-01-01', '2025-03-15', 'Left'),
  ('30000000-0000-0000-0000-0000000000b5', 'A-N', 'Att Newcomer', '00000000-0000-0000-0000-0000000000b5', '30000000-0000-0000-0000-0000000000b1', '2025-03-05', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000b6', 'A-P', 'Att Past Exit', '00000000-0000-0000-0000-0000000000b6', null, '2024-01-01', '2025-03-20', 'Active'),
  ('30000000-0000-0000-0000-0000000000b7', 'A-X', 'Att Left No Date', '00000000-0000-0000-0000-0000000000b7', null, '2024-01-01', null, 'Left');
-- a row that exists already for the Left employee with no exit date (written as owner, as legacy data would be)
insert into public.hr_attendance (employee_id, work_date, status) values ('30000000-0000-0000-0000-0000000000b7', '2025-03-10', 'Present');
create function public.eid(p text) returns uuid language sql as $$ select ('30000000-0000-0000-0000-0000000000' || p)::uuid $$;
grant execute on function public.eid(text) to authenticated;

set role authenticated;

-- ── HR sets; setting twice updates ──
select public.as_user('0b');
select public.hr_attendance_set(public.eid('b2'), '2025-03-03', 'Present', '09:00', '18:00', 'on time');
select public.ok('HR sets a report day', (select status = 'Present' and time_in = '09:00' and time_out = '18:00' and note = 'on time' from public.hr_attendance where employee_id = public.eid('b2') and work_date = '2025-03-03'));
select public.hr_attendance_set(public.eid('b2'), '2025-03-03', 'Present', '09:30', null, null);
select public.ok('setting a day twice updates it, one row', (select count(*) = 1 and bool_and(time_in = '09:30' and time_out is null and note is null) from public.hr_attendance where employee_id = public.eid('b2') and work_date = '2025-03-03'));
select public.ok('edits are audited', (select count(*) = 2 from public.hr_audit_log where action like 'attendance.%'));
select public.ok('audit keeps the old values', (select bool_or(old_values ->> 'time_in' = '09:00:00' and new_values ->> 'time_in' = '09:30:00') from public.hr_audit_log where action = 'attendance.updated'));

-- ── manager ──
select public.as_user('b1');
select public.hr_attendance_set(public.eid('b2'), '2025-03-04', 'Absent', null, null, 'sick');
select public.ok('manager sets a report day', (select status = 'Absent' from public.hr_attendance where employee_id = public.eid('b2') and work_date = '2025-03-04'));
select public.must_fail('manager cannot set an unrelated employee', $$select public.hr_attendance_set(public.eid('b3'), '2025-03-04', 'Present', null, null, null)$$, 'not allowed');
select public.must_fail('manager cannot set their own day', $$select public.hr_attendance_set(public.eid('b1'), '2025-03-04', 'Present', null, null, null)$$, 'own');
select public.ok('manager reads reports rows only', (select count(*) = 2 and bool_and(employee_id = public.eid('b2')) from public.hr_attendance));

-- ── employee ──
select public.as_user('b2');
select public.ok('employee reads own rows', (select count(*) = 2 from public.hr_attendance));
select public.must_fail('employee cannot set own day', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-05', 'Present', null, null, null)$$, 'own');
select public.must_fail('employee cannot set anyone else', $$select public.hr_attendance_set(public.eid('b3'), '2025-03-05', 'Present', null, null, null)$$, 'not allowed');
select public.must_fail('direct insert denied', $$insert into public.hr_attendance (employee_id, work_date, status) values (public.eid('b2'), '2025-03-06', 'Present')$$, 'permission denied');
select public.must_fail('direct update denied', $$update public.hr_attendance set status = 'Absent'$$, 'permission denied');
select public.must_fail('direct delete denied', $$delete from public.hr_attendance$$, 'permission denied');
select public.as_user('b3');
select public.ok('unrelated employee sees none of it', (select count(*) = 0 from public.hr_attendance));
select public.as_user('99');
select public.ok('outsider sees nothing', (select count(*) = 0 from public.hr_attendance));
select public.must_fail('outsider cannot set', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-05', 'Present', null, null, null)$$, 'not allowed');

-- ── HR may set their own day (employee row linked to an HR-list member) ──
select public.as_user('a4');
select public.hr_attendance_set('20000000-0000-0000-0000-0000000000a4', '2025-03-05', 'Present', null, null, null);
select public.ok('HR sets their own day', (select count(*) = 1 from public.hr_attendance where employee_id = '20000000-0000-0000-0000-0000000000a4'));

-- ── validation ──
select public.as_user('0b');
select public.must_fail('time_out before time_in fails', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Present', '18:00', '09:00', null)$$, 'before');
select public.must_fail('invalid status fails', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Late', null, null, null)$$, 'status');
select public.must_fail('missing status fails', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', null, null, null, null)$$, 'status');
select public.must_fail('Absent cannot carry times', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Absent', '09:00', null, null)$$, 'times');
select public.must_fail('Leave cannot carry times', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Leave', null, '17:00', null)$$, 'times');
select public.must_fail('Holiday cannot carry times', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Holiday', '09:00', '17:00', null)$$, 'times');
select public.must_fail('Weekend cannot carry times', $$select public.hr_attendance_set(public.eid('b2'), '2025-03-06', 'Weekend', '09:00', '17:00', null)$$, 'times');
select public.must_fail('future date fails', $$select public.hr_attendance_set(public.eid('b2'), '2999-01-01', 'Present', null, null, null)$$, 'future');
select public.must_fail('tomorrow (Dubai) fails', $$select public.hr_attendance_set(public.eid('b2'), ((now() at time zone 'Asia/Dubai')::date + 1), 'Present', null, null, null)$$, 'future');
select public.hr_attendance_set(public.eid('b2'), (now() at time zone 'Asia/Dubai')::date, 'Present', '08:00', null, null);
select public.ok('today (Dubai) is allowed', (select count(*) = 1 from public.hr_attendance where employee_id = public.eid('b2') and work_date = (now() at time zone 'Asia/Dubai')::date));
select public.must_fail('unknown employee fails', $$select public.hr_attendance_set('30000000-0000-0000-0000-0000000000ff', '2025-03-06', 'Present', null, null, null)$$, 'not found');
select public.must_fail('null date fails', $$select public.hr_attendance_set(public.eid('b2'), null, 'Present', null, null, null)$$, 'date');

-- ── Left employee ──
select public.hr_attendance_set(public.eid('b4'), '2025-03-14', 'Present', null, null, null);
select public.hr_attendance_set(public.eid('b4'), '2025-03-15', 'Present', null, null, null);
select public.ok('Left employee: days up to exit_date allowed', (select count(*) = 2 from public.hr_attendance where employee_id = public.eid('b4')));
select public.must_fail('Left employee: day after exit_date fails', $$select public.hr_attendance_set(public.eid('b4'), '2025-03-16', 'Present', null, null, null)$$, 'exit date');

-- ── join and exit bounds (set side) ──
select public.must_fail('non-Left employee: day after exit_date fails', $$select public.hr_attendance_set(public.eid('b6'), '2025-03-21', 'Present', null, null, null)$$, 'exit date');
select public.hr_attendance_set(public.eid('b6'), '2025-03-20', 'Absent', null, null, null);
select public.ok('non-Left employee: exit day itself succeeds', (select count(*) = 1 from public.hr_attendance where employee_id = public.eid('b6') and work_date = '2025-03-20'));
select public.must_fail('Left employee with null exit_date: set fails, asks for exit date first', $$select public.hr_attendance_set(public.eid('b7'), '2025-03-11', 'Present', null, null, null)$$, 'Record the exit date first');
select public.must_fail('date before join_date fails', $$select public.hr_attendance_set(public.eid('b5'), '2025-03-04', 'Present', null, null, null)$$, 'joined');
select public.hr_attendance_set(public.eid('b5'), '2025-03-05', 'Present', null, null, null);
select public.ok('join day itself succeeds', (select count(*) = 1 from public.hr_attendance where employee_id = public.eid('b5') and work_date = '2025-03-05'));
reset role;
update public.hr_employees set join_date = null where id = public.eid('b3');
set role authenticated;
select public.as_user('0b');
select public.hr_attendance_set(public.eid('b3'), '2000-01-03', 'Absent', null, null, null);
select public.ok('null join_date employee accepts an early date', (select count(*) = 1 from public.hr_attendance where employee_id = public.eid('b3') and work_date = '2000-01-03'));
reset role;
delete from public.hr_attendance where employee_id = public.eid('b3');
update public.hr_employees set join_date = '2024-01-01' where id = public.eid('b3');
set role authenticated;
select public.as_user('0b');

-- ── month grid ──
insert into public.hr_holidays (holiday_date, name) values ('2025-03-12', 'Grid holiday');
select public.hr_leave_decide((public.hr_leave_request(public.eid('b2'), public.ltype('Annual'), '2025-03-10', '2025-03-11', null) -> 'ids' ->> 0)::uuid, true, null);
select public.ok('grid: one row per employee per day (31 days)', (select count(*) = 31 from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b3')));
select public.ok('grid: stored row wins', (select status = 'Present' and time_in = '09:30' from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date = '2025-03-03'));
select public.ok('grid: approved leave shows as Leave', (select count(*) = 2 and bool_and(status = 'Leave') from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date in ('2025-03-10', '2025-03-11')));
select public.ok('grid: holiday shows as Holiday', (select status = 'Holiday' from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date = '2025-03-12'));
select public.ok('grid: weekend shows as Weekend', (select count(*) = 2 and bool_and(status = 'Weekend') from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date in ('2025-03-01', '2025-03-02')));
select public.ok('grid: unrecorded working day has null status', (select status is null from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date = '2025-03-13'));
select public.hr_attendance_set(public.eid('b2'), '2025-03-12', 'Present', null, null, null);
select public.ok('grid: stored row on a holiday wins', (select status = 'Present' from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b2') and work_date = '2025-03-12'));
select public.ok('grid: days before join_date do not apply', (select min(work_date) = '2025-03-05' and count(*) = 27 from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b5')));
select public.ok('grid: days after exit_date do not apply', (select max(work_date) = '2025-03-15' and count(*) = 15 from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b4')));
select public.ok('grid: Left employee whose exit is before the month is excluded', (select count(*) = 0 from public.hr_attendance_month(2025, 4) where employee_id = public.eid('b4')));
select public.ok('grid: Left employee with no exit date stays visible with the existing row', (select count(*) = 31 and bool_or(status = 'Present' and work_date = '2025-03-10') and bool_and(employee_status = 'Left' and exit_date is null) from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b7')));
select public.ok('grid: non-Left past exit shows days up to exit only', (select max(work_date) = '2025-03-20' from public.hr_attendance_month(2025, 3) where employee_id = public.eid('b6')));
select public.ok('grid: February length', (select count(*) = 28 from public.hr_attendance_month(2025, 2) where employee_id = public.eid('b3')));
select public.must_fail('grid: bad month fails', $$select * from public.hr_attendance_month(2025, 13)$$, 'month');
select public.as_user('b1');
select public.ok('grid: manager sees reports and self, not unrelated', (select count(distinct employee_id) = 4 and bool_and(employee_id <> public.eid('b3')) from public.hr_attendance_month(2025, 3)));
select public.as_user('b2');
select public.ok('grid: employee sees only self', (select count(distinct employee_id) = 1 and bool_and(employee_id = public.eid('b2')) from public.hr_attendance_month(2025, 3)));
select public.as_user('99');
select public.ok('grid: outsider sees nothing', (select count(*) = 0 from public.hr_attendance_month(2025, 3)));

-- ── dashboard present_today (Asia/Dubai date) ──
select public.as_user('0b');
select public.ok('dashboard: HR present_today counts today', (public.hr_dashboard() ->> 'present_today')::int = 1);
select public.as_user('b1');
select public.ok('dashboard: manager present_today counts reports', (public.hr_dashboard() ->> 'present_today')::int = 1);
select public.as_user('b2');
select public.ok('dashboard: employee present_today counts self', (public.hr_dashboard() ->> 'present_today')::int = 1);
select public.as_user('b3');
select public.ok('dashboard: unrelated employee present_today is 0', (public.hr_dashboard() ->> 'present_today')::int = 0);
select public.ok('dashboard keeps its other keys', (select bool_and(public.hr_dashboard() ? k) from unnest(array['headcount', 'pending_leave', 'expiring_documents']) k));

reset role;
select public.ok('attendance table has RLS on', (select relrowsecurity from pg_class where oid = 'public.hr_attendance'::regclass));
select public.ok('attendance table has no write grant for authenticated', not has_table_privilege('authenticated', 'public.hr_attendance', 'insert') and not has_table_privilege('authenticated', 'public.hr_attendance', 'update') and not has_table_privilege('authenticated', 'public.hr_attendance', 'delete'));
select public.ok('attendance functions are security definer, fixed search_path, closed to anon and public', (select count(*) = 3 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute')) from pg_proc where proname in ('hr_attendance_set', 'hr_attendance_month', 'hr_dashboard')));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
