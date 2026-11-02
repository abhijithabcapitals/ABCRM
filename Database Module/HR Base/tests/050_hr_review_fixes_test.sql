-- LOCAL TEST ONLY: the final review fixes (migration 008). Runs after 010 to 040 on the same cluster (reuses helpers).
-- Settings values are TEST FIXTURES, not company policy and not law.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
-- Earlier files' people stay out of these runs.
update public.hr_employees set on_payroll = false;
update public.hr_settings set weekend_days = '{0,6}', pay_day_divisor_mode = 'fixed', pay_days_basis = 30, pay_unpaid_wage_base = 'total',
  gratuity_fraction_method = 'months_12', gratuity_cap_base = 'basic', gratuity_daily_divisor = 30, gratuity_service_end_inclusive = true;

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Rev Worker', 'member'),
  ('00000000-0000-0000-0000-0000000000e2', 'Rev Leave', 'member'),
  ('00000000-0000-0000-0000-0000000000e3', 'Rev HR Leaver', 'member'),
  ('00000000-0000-0000-0000-0000000000e4', 'Rev Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000e5', 'Rev Report', 'member'),
  ('00000000-0000-0000-0000-0000000000e6', 'Rev HR Linked', 'member'),
  ('00000000-0000-0000-0000-0000000000e7', 'Rev No Employee', 'member'),
  ('00000000-0000-0000-0000-0000000000e8', 'Rev Admin Leaver', 'admin');
insert into public.hr_employees (id, employee_code, full_name, profile_id, manager_id, join_date, status, on_payroll) values
  (public.pe('f1'), 'R-1', 'Rev Worker', '00000000-0000-0000-0000-0000000000e1', null, '2020-01-01', 'Active', true),
  (public.pe('f2'), 'R-2', 'Rev Leave', '00000000-0000-0000-0000-0000000000e2', null, '2020-01-01', 'Active', false),
  (public.pe('f3'), 'R-3', 'Rev HR Leaver', '00000000-0000-0000-0000-0000000000e3', null, '2020-01-01', 'Active', true),
  (public.pe('f4'), 'R-4', 'Rev Manager', '00000000-0000-0000-0000-0000000000e4', null, '2020-01-01', 'Active', false),
  (public.pe('f5'), 'R-5', 'Rev Report', '00000000-0000-0000-0000-0000000000e5', public.pe('f4'), '2020-01-01', 'Active', false),
  (public.pe('f6'), 'R-6', 'Rev HR Linked', '00000000-0000-0000-0000-0000000000e6', null, '2020-01-01', 'Active', false),
  (public.pe('f7'), 'R-7', 'Rev To Link', null, null, '2020-01-01', 'Active', false),
  (public.pe('f8'), 'R-8', 'Rev Admin Leaver', '00000000-0000-0000-0000-0000000000e8', null, '2020-01-01', 'Left', false);
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-0000000000e3'), ('00000000-0000-0000-0000-0000000000e6');
insert into public.hr_leave_types (name, paid, annual_days) values ('RV Paid', true, null), ('RV Unpaid', false, null), ('RV Capped', true, 1);
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values
  (public.pe('f1'), '2020-01-01', 8000, 'AE070331234567890123451'),
  (public.pe('f3'), '2020-01-01', 5000, 'AE070331234567890123452');
create function public.rlq(p_emp text, p_type text, p_from date, p_to date, p_status text) returns uuid language sql as $$
  insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status)
  values (public.pe(p_emp), public.ltype(p_type), p_from, p_to, greatest(p_to - p_from + 1, 1), p_status) returning id
$$;
create table public.t_req_rev (label text primary key, id uuid);
grant select on public.t_req_rev to authenticated;
create function public.rr(p text) returns uuid language sql stable as $$ select id from public.t_req_rev where label = p $$;
grant execute on function public.rr(text) to authenticated;
alter role service_role bypassrls; -- as on Supabase
grant usage on schema public to service_role;
grant select, update on public.hr_employees to service_role;

-- ── 1. link logins ──
set role authenticated;
select public.as_user('0b');
select public.must_fail('HR member cannot change someone''s profile_id', $$update public.hr_employees set profile_id = '00000000-0000-0000-0000-0000000000e7' where id = public.pe('f7')$$, 'administrator');
select public.must_fail('HR member cannot link through the function', $$select public.hr_employee_link(public.pe('f7'), '00000000-0000-0000-0000-0000000000e7')$$, 'administrator');
select public.must_fail('HR member cannot add an employee with a login', $$insert into public.hr_employees (employee_code, full_name, profile_id) values ('R-X', 'X', '00000000-0000-0000-0000-0000000000e7')$$, 'administrator');
select public.as_user('e6');
select public.must_fail('HR member cannot unlink themselves', $$update public.hr_employees set profile_id = null where id = public.pe('f6')$$, 'administrator');
select public.must_fail('HR member cannot move their own link', $$update public.hr_employees set profile_id = '00000000-0000-0000-0000-0000000000e7' where id = public.pe('f6')$$, 'administrator');
update public.hr_employees set department = 'Ops' where id = public.pe('f7');
select public.ok('HR member still edits other fields', (select department = 'Ops' from public.hr_employees where id = public.pe('f7')));
select public.as_user('0a');
select public.hr_employee_link(public.pe('f7'), '00000000-0000-0000-0000-0000000000e7');
select public.ok('admin links a login', (select profile_id = '00000000-0000-0000-0000-0000000000e7' from public.hr_employees where id = public.pe('f7')));
select public.ok('the link is audited with the admin as actor', (select count(*) = 1 from public.hr_audit_log where action = 'employee.updated' and target = 'hr_employees:' || public.pe('f7') and actor = '00000000-0000-0000-0000-00000000000a' and new_values ->> 'profile_id' = '00000000-0000-0000-0000-0000000000e7'));
select public.must_fail('a login already linked is refused, by employee', $$select public.hr_employee_link(public.pe('f2'), '00000000-0000-0000-0000-0000000000e7')$$, 'R-7');
select public.must_fail('an unknown login is refused', $$select public.hr_employee_link(public.pe('f2'), '00000000-0000-0000-0000-00000000ffff')$$, 'not found');
select public.hr_employee_link(public.pe('f7'), null);
select public.ok('admin unlinks', (select profile_id is null from public.hr_employees where id = public.pe('f7')));
update public.hr_employees set profile_id = '00000000-0000-0000-0000-0000000000e7' where id = public.pe('f7');
select public.ok('admin direct write (Settings > Employees) still works', (select profile_id is not null from public.hr_employees where id = public.pe('f7')));
update public.hr_employees set profile_id = null where id = public.pe('f7');
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role service_role;
update public.hr_employees set profile_id = '00000000-0000-0000-0000-0000000000e7' where id = public.pe('f7');
reset role;
select public.ok('service role onboarding still links', (select profile_id is not null from public.hr_employees where id = public.pe('f7')));
update public.hr_employees set profile_id = null where id = public.pe('f7');

-- ── 6. pay change acknowledgement (June 2026) ──
set role authenticated;
select public.as_user('0b');
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('f1'), '2026-06-15', 9000, 'AE070331234567890123451');
select public.hr_payrun_create('2026-06-01');
select public.ok('a mid-month change blocks', (public.ln('2026-06-01', 'f1')).blockers::text ilike '%Pay changed during the month%');
select public.must_fail('an acknowledgement needs a note', $$select public.hr_payrun_ack_pay_change((public.ln('2026-06-01', 'f1')).id, '  ')$$, 'note');
select public.must_fail('a line with no pay change has nothing to acknowledge', $$select public.hr_payrun_ack_pay_change((public.ln('2026-06-01', 'f3')).id, 'x')$$, 'no pay change');
select public.as_user('e2');
select public.must_fail('an employee cannot acknowledge', $$select public.hr_payrun_ack_pay_change('00000000-0000-0000-0000-000000000000', 'x')$$, 'not allowed');
select public.as_user('e6');
select public.hr_payrun_ack_pay_change((public.ln('2026-06-01', 'f1')).id, 'Checked with the contract');
select public.ok('acknowledging clears the blocker', (public.ln('2026-06-01', 'f1')).blockers = '[]'::jsonb);
select public.ok('it adds no adjustment and leaves net alone', (public.ln('2026-06-01', 'f1')).adjustments = '[]'::jsonb and (public.ln('2026-06-01', 'f1')).net = 9000);
select public.ok('it is stamped with the pay row in use', (public.ln('2026-06-01', 'f1')).pay_change_ack ->> 'pay_detail_id' = (public.ln('2026-06-01', 'f1')).pay_detail_id::text);
select public.ok('the note is not on the line', (public.ln('2026-06-01', 'f1'))::text not ilike '%Checked with the contract%');
select public.ok('it sets prepared_by', (select prepared_by = '00000000-0000-0000-0000-0000000000e6' from public.hr_pay_runs where id = public.rid('2026-06-01')));
select public.ok('it is audited with the note', (select count(*) = 1 from public.hr_audit_log where action = 'payrun.pay_change_acknowledged' and new_values ->> 'note' = 'Checked with the contract' and old_values ->> 'prepared_by' = '00000000-0000-0000-0000-00000000000b'));
select public.hr_payrun_recalc(public.rid('2026-06-01'));
select public.ok('recalculating keeps it while the pay row is the same', (public.ln('2026-06-01', 'f1')).blockers = '[]'::jsonb);
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('f1'), '2026-06-20', 9100, 'AE070331234567890123451');
select public.hr_payrun_recalc(public.rid('2026-06-01'));
select public.ok('a later pay change blocks again', (public.ln('2026-06-01', 'f1')).blockers::text ilike '%Pay changed during the month%');
select public.as_user('0a');
select public.must_fail('and approval is refused', $$select public.hr_payrun_approve(public.rid('2026-06-01'))$$, 'Rev Worker');
select public.as_user('e6');
select public.hr_payrun_ack_pay_change((public.ln('2026-06-01', 'f1')).id, 'Second change checked');
select public.as_user('0a');
select public.hr_payrun_approve(public.rid('2026-06-01'));
select public.ok('with the second acknowledgement it approves, no amount added', (select status = 'approved' from public.hr_pay_runs where id = public.rid('2026-06-01')) and (public.ln('2026-06-01', 'f1')).net = 9100);
select public.must_fail('an approved line cannot be acknowledged', $$select public.hr_payrun_ack_pay_change((public.ln('2026-06-01', 'f1')).id, 'x')$$, 'draft');

-- ── 2. stored Absent inside leave (August 2026) ──
reset role;
select public.rlq('f1', 'RV Paid', '2026-08-03', '2026-08-04', 'approved');
select public.rlq('f1', 'RV Unpaid', '2026-08-10', '2026-08-11', 'approved');
insert into public.hr_attendance (employee_id, work_date, status) values
  (public.pe('f1'), '2026-08-03', 'Absent'),  -- inside paid leave: costs nothing
  (public.pe('f1'), '2026-08-10', 'Absent'),  -- inside unpaid leave: counted once
  (public.pe('f1'), '2026-08-17', 'Absent');  -- plain absence
set role authenticated;
select public.as_user('0b');
select public.hr_payrun_create('2026-08-01');
select public.ok('scope is only on_payroll people', (select count(*) = 2 from public.hr_pay_lines where run_id = public.rid('2026-08-01')));
select public.ok('Absent inside paid leave does not reduce pay; unpaid leave has no double count', public.amt((public.ln('2026-08-01', 'f1')).deductions, 'Unpaid days') = 910.00 and ((public.ln('2026-08-01', 'f1')).deductions -> 0 ->> 'days')::int = 3 and (public.ln('2026-08-01', 'f1')).net = 8190, (public.ln('2026-08-01', 'f1')).deductions::text);
select public.ok('the line carries a review note naming the date', (public.ln('2026-08-01', 'f1')).notes::text ilike '%Absent is recorded inside approved paid leave on 2026-08-03%review%');
select public.ok('gratuity service loses only the 3 unpaid days', (public.hr_gratuity(public.pe('f1'), '2026-08-31') ->> 'excluded_unpaid_days')::int = 3);

-- ── 4. locked months ──
select public.hr_attendance_set(public.pe('f1'), '2026-08-19', 'Present', null, null, 'before approval');
select public.as_user('0a');
select public.hr_payrun_recalc(public.rid('2026-08-01'));
select public.as_user('0b');
select public.hr_payrun_approve(public.rid('2026-08-01'));
select public.ok('attendance in a month with no approved run has no warning', (public.hr_attendance_set(public.pe('f1'), '2026-09-02', 'Present', null, null, null)) ->> 'warning' is null);
select public.ok('attendance in a locked month succeeds and warns, by month', (public.hr_attendance_set(public.pe('f1'), '2026-08-20', 'Absent', null, null, null)) ->> 'warning' = 'August 2026 is locked: add an adjustment in a later run');
select public.ok('the day was stored', (select status = 'Absent' from public.hr_attendance where employee_id = public.pe('f1') and work_date = '2026-08-20'));
select public.ok('the approved line did not change', (public.ln('2026-08-01', 'f1')).net = 8190);
reset role;
insert into public.t_req_rev values ('locked', public.rlq('f1', 'RV Paid', '2026-08-24', '2026-08-25', 'pending'));
insert into public.t_req_rev values ('span', public.rlq('f1', 'RV Paid', '2026-08-31', '2026-09-01', 'pending'));
insert into public.t_req_rev values ('free', public.rlq('f1', 'RV Paid', '2026-09-07', '2026-09-08', 'pending'));
set role authenticated;
select public.ok('deciding leave in a locked month succeeds and warns', (public.hr_leave_decide(public.rr('locked'), true, null)) ->> 'warning' ilike '%August 2026 is locked%');
select public.ok('leave crossing into a locked month warns', (public.hr_leave_decide(public.rr('span'), true, null)) ->> 'warning' ilike '%August 2026 is locked%');
select public.ok('leave outside a locked month does not warn', (public.hr_leave_decide(public.rr('free'), true, null)) ->> 'warning' is null);
select public.ok('cancelling leave in a locked month succeeds and warns', (public.hr_leave_cancel(public.rr('locked'))) ->> 'warning' ilike '%August 2026 is locked%');
select public.ok('it is cancelled', (select status = 'cancelled' from public.hr_leave_requests where id = public.rr('locked')));
select public.ok('the approved line is still unchanged', (public.ln('2026-08-01', 'f1')).net = 8190 and (public.ln('2026-08-01', 'f1')).earnings = (select earnings from public.hr_pay_lines where id = (public.ln('2026-08-01', 'f1')).id));
select public.ok('the run panel lists the changes made after approval', (select count(*) from public.hr_payrun_changes_after(public.rid('2026-08-01'))) = 4 and (select count(*) from public.hr_payrun_changes_after(public.rid('2026-08-01')) c where c.employee_name = 'Rev Worker' and c.actor_name = 'HR Member') = 4, (select string_agg(action || ' ' || detail, ' | ') from public.hr_payrun_changes_after(public.rid('2026-08-01'))));
select public.ok('it leaves out entries from before approval and other months', (select count(*) from public.hr_payrun_changes_after(public.rid('2026-08-01')) c where c.detail ilike '2026-08-19%' or c.detail ilike '2026-09-%'  or c.detail ilike '%2026-09-07%') = 0);
select public.as_user('e2');
select public.must_fail('an employee cannot list them', $$select * from public.hr_payrun_changes_after(public.rid('2026-08-01'))$$, 'not allowed');
select public.must_fail('and users cannot call the internal helper', $$select public.hr_locked_month_warning('2026-08-01', '2026-08-02')$$, 'permission denied');
select public.as_user('0b');
select public.must_fail('a run for next month is refused', $$select public.hr_payrun_create(((date_trunc('month', public.dubai_today()) + interval '1 month')::date))$$, 'future month');
select public.ok('a run for the current month is allowed', public.hr_payrun_create(public.dubai_today()) is not null);
select public.hr_payrun_delete(public.rid(date_trunc('month', public.dubai_today())::date));

-- ── approving beyond a paid balance ──
reset role;
insert into public.t_req_rev values ('over', public.rlq('f2', 'RV Capped', '2026-03-02', '2026-03-03', 'pending'));
insert into public.t_req_rev values ('within', public.rlq('f2', 'RV Capped', '2025-03-03', '2025-03-03', 'pending'));
insert into public.t_req_rev values ('nolimit', public.rlq('f2', 'RV Paid', '2026-03-09', '2026-03-10', 'pending'));
set role authenticated;
select public.ok('approving beyond the balance warns', (public.hr_leave_decide(public.rr('over'), true, null)) ->> 'warning' ilike '%RV Capped 2026%1 beyond the balance%');
select public.ok('and still approves', (select status = 'approved' from public.hr_leave_requests where id = public.rr('over')));
select public.ok('approving within the balance does not warn', (public.hr_leave_decide(public.rr('within'), true, null)) ->> 'warning' is null);
select public.ok('a type with no limit does not warn', (public.hr_leave_decide(public.rr('nolimit'), true, null)) ->> 'warning' is null);

-- ── 3. cancelling own leave ──
reset role;
insert into public.t_req_rev values ('future', public.rlq('f2', 'RV Paid', public.dubai_today() + 1, public.dubai_today() + 1, 'approved'));
insert into public.t_req_rev values ('today', public.rlq('f2', 'RV Paid', public.dubai_today(), public.dubai_today(), 'approved'));
insert into public.t_req_rev values ('past', public.rlq('f2', 'RV Paid', public.dubai_today() - 40, public.dubai_today() - 40, 'approved'));
insert into public.t_req_rev values ('pending_past', public.rlq('f2', 'RV Paid', public.dubai_today() - 50, public.dubai_today() - 50, 'pending'));
set role authenticated;
select public.as_user('e2');
select public.hr_leave_cancel(public.rr('future'));
select public.ok('employee cancels approved leave that starts tomorrow', (select status = 'cancelled' from public.hr_leave_requests where id = public.rr('future')));
select public.must_fail('employee cannot cancel approved leave starting today', $$select public.hr_leave_cancel(public.rr('today'))$$, 'before it starts');
select public.must_fail('employee cannot cancel approved leave in the past', $$select public.hr_leave_cancel(public.rr('past'))$$, 'before it starts');
select public.hr_leave_cancel(public.rr('pending_past'));
select public.ok('employee can cancel pending leave any time', (select status = 'cancelled' from public.hr_leave_requests where id = public.rr('pending_past')));
select public.as_user('0b');
select public.hr_leave_cancel(public.rr('past'));
select public.ok('HR keeps the override', (select status = 'cancelled' from public.hr_leave_requests where id = public.rr('past')));

-- ── 5. Left removes power ──
select public.as_user('e3');
select public.ok('before leaving: HR power', public.hr_is_admin_or_hr() and public.hr_my_access() ->> 'role' = 'hr');
select public.as_user('e4');
select public.ok('before leaving: manages the report', public.hr_manages(public.pe('f5')) and public.hr_my_access() ->> 'role' = 'manager');
reset role;
update public.hr_employees set status = 'Left', exit_date = '2026-10-31' where id in (public.pe('f3'), public.pe('f4'));
set role authenticated;
select public.as_user('e3');
select public.ok('HR list + Left: no HR power', not public.hr_is_admin_or_hr());
select public.ok('their role drops to employee', public.hr_my_access() ->> 'role' = 'employee');
select public.ok('they read only their own employee row', (select count(*) = 1 from public.hr_employees));
select public.must_fail('they cannot run payroll', $$select public.hr_payrun_create('2026-05-15')$$, 'not allowed');
select public.ok('they read no pay details', (select count(*) = 0 from public.hr_pay_details));
select public.ok('they still read their own approved line', (select count(*) >= 1 from public.hr_pay_lines where employee_id = public.pe('f3')) and (select count(*) = 0 from public.hr_pay_lines where employee_id <> public.pe('f3')));
select public.as_user('e8');
select public.ok('admin by role + Left: keeps power', public.hr_is_admin_or_hr() and public.hr_my_access() ->> 'role' = 'hr');
select public.as_user('e4');
select public.ok('Left manager: no longer manages', not public.hr_manages(public.pe('f5')));
select public.ok('their role drops to employee', public.hr_my_access() ->> 'role' = 'employee');
select public.ok('they read only their own row, not the report', (select count(*) = 1 from public.hr_employees where id in (public.pe('f4'), public.pe('f5'))) and (select count(*) = 1 from public.hr_employees));
select public.as_user('e5');
select public.ok('the report keeps their own read', (select count(*) = 1 from public.hr_employees));

-- ── 7. on_payroll ──
select public.as_user('e6');
update public.hr_employees set on_payroll = false where id = public.pe('f1');
select public.ok('HR sets on_payroll', (select not on_payroll from public.hr_employees where id = public.pe('f1')));
select public.ok('the change is audited', (select count(*) >= 1 from public.hr_audit_log where action = 'employee.updated' and target = 'hr_employees:' || public.pe('f1') and new_values ->> 'on_payroll' = 'false'));
update public.hr_employees set on_payroll = true where id = public.pe('f2');
reset role;
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('f2'), '2020-01-01', 1000, 'AE070331234567890123453');
set role authenticated;
select public.hr_payrun_create('2026-01-01');
select public.ok('off payroll is left out of the run; on payroll is in', (select count(*) = 0 from public.hr_pay_lines where run_id = public.rid('2026-01-01') and employee_id = public.pe('f1')) and (select count(*) = 1 from public.hr_pay_lines where run_id = public.rid('2026-01-01') and employee_id = public.pe('f2')));
update public.hr_employees set on_payroll = false where id = public.pe('f2');
select public.hr_payrun_recalc(public.rid('2026-01-01'));
select public.ok('recalculating drops someone taken off payroll', (select count(*) = 0 from public.hr_pay_lines where run_id = public.rid('2026-01-01') and employee_id = public.pe('f2')));
select public.hr_payrun_delete(public.rid('2026-01-01'));

-- ── no hard delete ──
select public.must_fail('HR member cannot delete an employee', $$delete from public.hr_employees where id = public.pe('f7')$$, 'permission denied');
select public.must_fail('HR member cannot delete pay details', $$delete from public.hr_pay_details where employee_id = public.pe('f2')$$, 'permission denied');
select public.ok('the rows are still there', (select count(*) = 1 from public.hr_employees where id = public.pe('f7')) and (select count(*) = 1 from public.hr_pay_details where employee_id = public.pe('f2')));

-- ── audit: employee fields, HR list ──
update public.hr_employees set department = 'Audit Test' where id = public.pe('f5');
select public.ok('a field outside the list writes no audit entry', (select count(*) = 0 from public.hr_audit_log where target = 'hr_employees:' || public.pe('f5') and action = 'employee.updated' and new_values ? 'department'));
update public.hr_employees set join_date = '2021-02-03', manager_id = null where id = public.pe('f5');
select public.ok('join date and manager changes are audited, old and new', (select count(*) = 1 from public.hr_audit_log where action = 'employee.updated' and target = 'hr_employees:' || public.pe('f5') and old_values ->> 'join_date' = '2020-01-01' and new_values ->> 'join_date' = '2021-02-03' and old_values ->> 'manager_id' = public.pe('f4')::text and new_values -> 'manager_id' = 'null'::jsonb and actor = '00000000-0000-0000-0000-0000000000e6'));
update public.hr_employees set status = 'On Leave', exit_date = '2030-01-01' where id = public.pe('f5');
select public.ok('status and exit date changes are audited', (select count(*) = 1 from public.hr_audit_log where action = 'employee.updated' and target = 'hr_employees:' || public.pe('f5') and new_values ->> 'status' = 'On Leave' and new_values ->> 'exit_date' = '2030-01-01'));
select public.as_user('0a');
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-000000000099');
delete from public.hr_access where profile_id = '00000000-0000-0000-0000-000000000099';
select public.ok('HR list additions and removals are audited', (select count(*) = 1 from public.hr_audit_log where action = 'hr_access.added' and target = 'hr_access:00000000-0000-0000-0000-000000000099' and actor = '00000000-0000-0000-0000-00000000000a') and (select count(*) = 1 from public.hr_audit_log where action = 'hr_access.removed' and target = 'hr_access:00000000-0000-0000-0000-000000000099'));

-- ── expiry uses the Asia/Dubai date ──
select public.as_user('0b');
insert into public.hr_documents (employee_id, doc_type, expiry_date) values (public.pe('f2'), 'Rev Doc', public.dubai_today() + 5);
select public.ok('days left counts from the Dubai date', (select days_left = 5 from public.hr_documents_expiring() where doc_type = 'Rev Doc'));
reset role;
select public.ok('hr_documents_expiring no longer reads current_date', pg_get_functiondef('public.hr_documents_expiring()'::regprocedure) not ilike '%current_date%' and pg_get_functiondef('public.hr_documents_expiring()'::regprocedure) ilike '%Asia/Dubai%');

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
