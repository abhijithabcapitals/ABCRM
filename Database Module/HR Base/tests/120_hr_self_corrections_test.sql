-- LOCAL TEST ONLY: employees correct their own days, HR validates, and both see the history. Runs after 110 on the same cluster (reuses its helpers).
-- Logins: ...0a admin, ...0b HR from 010, ...c5 Req Staff (RQ-1), ...c6 their manager (RQ-2), ...c8 another employee (RQ-4) from 100, ...c9 HR with an employee record (RQ-9) from 110.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
\ir ../migrations/016_hr_self_corrections.sql
reset role;
truncate public.t_result;
update public.hr_settings set absent_from_blank_days = true, attendance_tracked_from = '2026-01-01', leave_rules_from = '2026-09-01', weekend_days = '{0}' where id = 1;
delete from public.hr_attendance_edits;
delete from public.hr_holidays;
delete from public.hr_wfh_saturday_rules;
insert into public.hr_holidays (holiday_date, name) values ('2026-10-21', 'Test Holiday');
create or replace function public.sc_status(p int, d date) returns text language sql security definer as $$ select status from public.hr_attendance_days(d, d, public.rq(p)) $$;
grant execute on function public.sc_status(int, date) to authenticated;
create or replace function public.sc_late(p int, d date) returns int language sql security definer as $$ select late_minutes from public.hr_attendance_days(d, d, public.rq(p)) $$;
grant execute on function public.sc_late(int, date) to authenticated;
create or replace function public.sc_edit(p int, d date) returns uuid language sql security definer as $$ select id from public.hr_attendance_edits where employee_id = public.rq(p) and work_date = d and state = 'pending' $$;
grant execute on function public.sc_edit(int, date) to authenticated;
create or replace function public.sc_leave(p int, d date) returns bigint language sql security definer as $$ select count(*) from public.hr_leave_requests r where r.employee_id = public.rq(p) and r.status = 'approved' and d between r.from_date and r.to_date $$;
grant execute on function public.sc_leave(int, date) to authenticated;
create or replace function public.sc_ledger(col text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  execute format('select l.%I from public.hr_leave_ledger(public.rq(1), public.hr_leave_rules_type(), ''2026-10-31'', ''2026-10-31'') l where l.month = ''2026-10-01''', col) into v;
  return v;
end $$;
grant execute on function public.sc_ledger(text) to authenticated;
-- A month with an approved run, for the lock.
insert into public.hr_pay_runs (period_month) values ('2025-06-01') on conflict (period_month) do nothing;
update public.hr_pay_runs set status = 'approved', approved_by = '00000000-0000-0000-0000-00000000000a', approved_at = now() where period_month = '2025-06-01' and status = 'draft';

set role authenticated;

-- ── raising ──
select public.as_user('c5');
select public.must_fail('a reason is required', $$select public.hr_attendance_request(public.rq(1), '2026-10-05', 'WFH', null, null, null, ' ')$$, 'reason');
select public.must_fail('an Absent status is not a choice', $$select public.hr_attendance_request(public.rq(1), '2026-10-05', 'Absent', null, null, null, 'x')$$, 'Choose');
select public.must_fail('timing needs both punches', $$select public.hr_attendance_request(public.rq(1), '2026-10-05', 'Present', '09:30', null, null, 'x')$$, 'Choose');
select public.must_fail('leave must use Annual', $$select public.hr_attendance_request(public.rq(1), '2026-10-05', 'Leave', null, null, null, 'x')$$, 'Choose');
select public.must_fail('a weekly off cannot be changed', $$select public.hr_attendance_request(public.rq(1), '2026-10-04', 'WFH', null, null, null, 'x')$$, 'weekly off');
select public.must_fail('a holiday cannot be changed', $$select public.hr_attendance_request(public.rq(1), '2026-10-21', 'WFH', null, null, null, 'x')$$, 'holiday');
select public.must_fail('a future day cannot be changed', $$select public.hr_attendance_request(public.rq(1), '2999-01-04', 'WFH', null, null, null, 'x')$$, 'future');
select public.must_fail('a month with an approved run cannot be changed', $$select public.hr_attendance_request(public.rq(1), '2025-06-02', 'WFH', null, null, null, 'x')$$, 'Ask HR');
select public.must_fail('another person''s day is refused', $$select public.hr_attendance_request(public.rq(4), '2026-10-05', 'WFH', null, null, null, 'x')$$, 'not allowed');
select public.must_fail('an employee still cannot change a day directly', $$select public.hr_attendance_set(public.rq(1), '2026-10-05', 'WFH', null, null, null)$$, 'Only HR');
select public.must_fail('an employee cannot validate their own', $$select public.hr_attendance_decide(public.sc_edit(1, '2026-10-05'), true, null)$$, 'Only HR');

select public.ok('the day starts Absent', public.sc_status(1, '2026-10-05') = 'Absent', public.sc_status(1, '2026-10-05'));
select public.hr_attendance_request(public.rq(1), '2026-10-05', 'Leave', null, null, null, 'Was unwell', true);
select public.hr_attendance_request(public.rq(1), '2026-10-06', 'WFH', null, null, null, 'Worked from home');
select public.hr_attendance_request(public.rq(1), '2026-10-07', 'Present', '09:30', '18:30', null, 'Forgot to punch');
select public.hr_attendance_request(public.rq(1), '2026-10-08', 'WFH', null, null, null, 'Will be turned down');

-- ── pending changes nothing ──
select public.ok('pending Annual leaves the day Absent', public.sc_status(1, '2026-10-05') = 'Absent');
select public.ok('pending WFH leaves the day Absent', public.sc_status(1, '2026-10-06') = 'Absent');
select public.ok('pending Annual adds no leave', public.sc_leave(1, '2026-10-05') = 0);
select public.ok('every blank working day still counts', public.sc_ledger('absent_days') > 20, public.sc_ledger('absent_days')::text);
create temp table t_before as select public.sc_ledger('absent_days') as absent, public.sc_ledger('annual_days') as annual, public.sc_ledger('closing') as closing;
grant select on t_before to authenticated;

-- ── who validates ──
select public.as_user('c6');
select public.must_fail('a manager cannot validate', $$select public.hr_attendance_decide(public.sc_edit(1, '2026-10-05'), true, null)$$, 'Only HR');
select public.as_user('c9');
select public.ok('HR sees all four waiting', public.hr_attendance_edits_pending() = 4, public.hr_attendance_edits_pending()::text);
select public.must_fail('a rejection needs a note', $$select public.hr_attendance_decide(public.sc_edit(1, '2026-10-08'), false, ' ')$$, 'note');
select public.hr_attendance_decide(public.sc_edit(1, '2026-10-05'), true, null);
select public.ok('validated Annual shows Leave', public.sc_status(1, '2026-10-05') = 'Leave', public.sc_status(1, '2026-10-05'));
select public.ok('validated Annual adds the leave', public.sc_leave(1, '2026-10-05') = 1);
select public.ok('the day moves from Absent to Annual', public.sc_ledger('absent_days') = (select absent from t_before) - 1 and public.sc_ledger('annual_days') = (select annual from t_before) + 1, public.sc_ledger('absent_days')::text || ' ' || public.sc_ledger('annual_days')::text);
select public.ok('the balance is the same', public.sc_ledger('closing') = (select closing from t_before), public.sc_ledger('closing')::text);
select public.hr_attendance_decide(public.sc_edit(1, '2026-10-06'), true, 'OK');
select public.ok('validated WFH shows WFH', public.sc_status(1, '2026-10-06') = 'WFH');
select public.ok('WFH gives the Absent back', public.sc_ledger('absent_days') = (select absent from t_before) - 2, public.sc_ledger('absent_days')::text);
select public.hr_attendance_decide(public.sc_edit(1, '2026-10-07'), true, null);
select public.ok('validated timing shows Present', public.sc_status(1, '2026-10-07') = 'Present');
select public.ok('corrected timing is not late', public.sc_late(1, '2026-10-07') = 0);
select public.hr_attendance_decide(public.sc_edit(1, '2026-10-08'), false, 'No proof');
select public.ok('a rejected day keeps its value', public.sc_status(1, '2026-10-08') = 'Absent');

-- A second Annual on a day that has leave is refused.
select public.as_user('c5');
select public.must_fail('a day with leave cannot use Annual again', $$select public.hr_attendance_request(public.rq(1), '2026-10-05', 'Leave', null, null, null, 'x', true)$$, 'already');

-- ── HR's own day ──
select public.as_user('c9');
select public.must_fail('HR cannot set their own day directly', $$select public.hr_attendance_set(public.rq(9), '2026-10-12', 'WFH', null, null, null)$$, 'your own');
select public.must_fail('HR follows the same choices for their own day', $$select public.hr_attendance_request(public.rq(9), '2026-10-12', 'Absent', null, null, null, 'x')$$, 'Choose');
select public.hr_attendance_request(public.rq(9), '2026-10-12', 'WFH', null, null, null, 'Own day');
select public.must_fail('HR cannot validate their own day', $$select public.hr_attendance_decide(public.sc_edit(9, '2026-10-12'), true, null)$$, 'your own');
select public.as_user('0a');
select public.hr_attendance_decide(public.sc_edit(9, '2026-10-12'), true, null);
select public.ok('an admin validates HR''s own day', public.sc_status(9, '2026-10-12') = 'WFH');

-- ── history ──
select public.as_user('c5');
select public.ok('the employee sees their requests', (select count(*) = 4 from public.hr_attendance_history() where action = 'attendance.edit_requested' and work_date between '2026-10-05' and '2026-10-08' and new_values ->> 'reason' <> 'Was away'), (select count(*)::text from public.hr_attendance_history() where action = 'attendance.edit_requested' and work_date between '2026-10-05' and '2026-10-08' and new_values ->> 'reason' <> 'Was away'));
select public.ok('the employee sees the decisions', (select count(*) = 3 from public.hr_attendance_history() where action = 'attendance.edit_approved' and new_values ? 'use_annual') and (select count(*) = 1 from public.hr_attendance_history() where action = 'attendance.edit_rejected' and new_values ? 'use_annual'));
select public.ok('the employee sees only their own', (select bool_and(employee_id = public.rq(1)) from public.hr_attendance_history()));
select public.ok('the trail names who decided', (select bool_and(actor_name = 'Req HR') from public.hr_attendance_history() where action = 'attendance.edit_approved' and new_values ? 'use_annual'));
select public.ok('the trail keeps the reason and the note', (select new_values ->> 'reason' = 'Will be turned down' and new_values ->> 'note' = 'No proof' from public.hr_attendance_history() where action = 'attendance.edit_rejected' and new_values ? 'use_annual'));
select public.ok('the trail keeps the old value', (select old_values ->> 'status' = 'Absent' from public.hr_attendance_history() where action = 'attendance.edit_approved' and new_values ? 'use_annual' limit 1));
select public.as_user('c8');
select public.ok('another employee sees none of it', (select count(*) = 0 from public.hr_attendance_history() where employee_id = public.rq(1)));
select public.as_user('c6');
select public.ok('the manager sees their report', (select count(*) > 0 from public.hr_attendance_history() where employee_id = public.rq(1)));
select public.as_user('0b');
select public.ok('HR sees everyone', (select count(distinct employee_id) >= 2 from public.hr_attendance_history()));
reset role;

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
