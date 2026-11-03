-- LOCAL TEST ONLY: HR changes attendance and decides approvals, but not their own. Runs after 100 on the same cluster (reuses its helpers).
-- Logins: ...0a admin, ...0b HR list member from 010, ...c5 Req Staff and ...c6 their manager from 100, ...c9 an HR member with an employee record, added here.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
\ir ../migrations/015_hr_attendance_hr_power.sql
reset role;
truncate public.t_result;
update public.hr_settings set absent_from_blank_days = false, attendance_tracked_from = '2026-01-01', leave_rules_from = null where id = 1;
delete from public.hr_attendance_edits;
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000c9', 'Req HR', 'member') on conflict (id) do nothing;
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, status) values ('4d000000-0000-0000-0000-000000000009', 'RQ-9', 'Req HR', '00000000-0000-0000-0000-0000000000c9', '2025-01-01', 'Active');
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-0000000000c9');
create or replace function public.ap_status(p int, d date) returns text language sql security definer as $$ select status from public.hr_attendance where employee_id = public.rq(p) and work_date = d $$;
grant execute on function public.ap_status(int, date) to authenticated;
create or replace function public.ap_edit(p int, d date) returns uuid language sql security definer as $$ select id from public.hr_attendance_edits where employee_id = public.rq(p) and work_date = d and state = 'pending' $$;
grant execute on function public.ap_edit(int, date) to authenticated;

set role authenticated;

-- direct changes
select public.as_user('c9');
select public.hr_attendance_set(public.rq(1), '2026-10-05', 'Absent', null, null, 'HR edit');
select public.ok('HR changes a day directly', public.ap_status(1, '2026-10-05') = 'Absent');
select public.must_fail('HR cannot change their own day directly', $$select public.hr_attendance_set(public.rq(9), '2026-10-05', 'Present', '09:30', '18:30', null)$$, 'your own');
select public.as_user('c6');
select public.must_fail('a manager still cannot change a day directly', $$select public.hr_attendance_set(public.rq(1), '2026-10-06', 'Absent', null, null, null)$$, 'Only HR');
select public.as_user('c5');
select public.must_fail('an employee cannot change a day', $$select public.hr_attendance_set(public.rq(1), '2026-10-06', 'Present', null, null, null)$$, 'Only HR');
select public.as_user('0a');
select public.hr_attendance_set(public.rq(9), '2026-10-05', 'Absent', null, null, 'Admin edit');
select public.ok('an admin changes anyone', public.ap_status(9, '2026-10-05') = 'Absent');

-- approvals
select public.as_user('c6');
select public.hr_attendance_request(public.rq(1), '2026-10-07', 'Absent', null, null, null, 'Was away');
select public.ok('the request waits', public.ap_status(1, '2026-10-07') is null);
select public.must_fail('a manager cannot decide', $$select public.hr_attendance_decide(public.ap_edit(1, '2026-10-07'), true, null)$$, 'Only HR');
select public.ok('a manager has nothing to decide', public.hr_attendance_edits_pending() = 0);
select public.as_user('c9');
select public.ok('HR sees it waiting', public.hr_attendance_edits_pending() = 1, public.hr_attendance_edits_pending()::text);
select public.hr_attendance_decide(public.ap_edit(1, '2026-10-07'), true, null);
select public.ok('HR approves it', public.ap_status(1, '2026-10-07') = 'Absent');

-- HR's own request waits for someone else
select public.hr_attendance_request(public.rq(9), '2026-10-08', 'Absent', null, null, null, 'Own day');
select public.must_fail('HR cannot approve their own day', $$select public.hr_attendance_decide(public.ap_edit(9, '2026-10-08'), true, null)$$, 'your own');
select public.must_fail('HR cannot reject their own day', $$select public.hr_attendance_decide(public.ap_edit(9, '2026-10-08'), false, 'no')$$, 'your own');
select public.ok('their own request is not in their count', public.hr_attendance_edits_pending() = 0, public.hr_attendance_edits_pending()::text);
select public.as_user('0b');
select public.ok('another HR member sees it', public.hr_attendance_edits_pending() = 1);
select public.hr_attendance_decide(public.ap_edit(9, '2026-10-08'), false, 'Not needed');
select public.ok('another HR member decides it', public.ap_status(9, '2026-10-08') is null and public.ap_edit(9, '2026-10-08') is null);
reset role;
select public.ok('edits stay manual', (select source = 'manual' from public.hr_attendance where employee_id = public.rq(1) and work_date = '2026-10-05'));
select public.ok('HR changes are audited', exists (select 1 from public.hr_audit_log where action = 'attendance.updated' or action = 'attendance.created') and exists (select 1 from public.hr_audit_log where action = 'attendance.edit_approved'));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
