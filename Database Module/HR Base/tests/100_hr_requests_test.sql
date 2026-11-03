-- LOCAL TEST ONLY: staff requests and their effects, Finance Managers, expense claims, and the insurance, mobile and asset records. Runs after 090 on the same cluster (reuses its helpers).
-- Logins: ...c5 employee, ...c6 their manager, ...c7 Finance Manager, ...c8 another employee, ...0b HR from 010, ...d7 Accounts from 090. 090 re-applies 013, so 014 goes on again first.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
\ir ../migrations/014_hr_requests.sql
reset role;
truncate public.t_result;
update public.hr_employees set status = 'Left', exit_date = '2000-01-01', join_date = '1999-01-01', on_payroll = false;
delete from public.hr_holidays;
update public.hr_settings set absent_from_blank_days = false, attendance_tracked_from = '2026-01-01', weekend_days = '{0}', shift_start = '09:30', shift_end = '18:30', saturday_end = '14:00',
  pay_day_divisor_mode = 'calendar_days', pay_unpaid_wage_base = 'total', leave_rules_from = '2026-09-01' where id = 1;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c5', 'Req Staff', 'member'), ('00000000-0000-0000-0000-0000000000c6', 'Req Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000c7', 'Req Finance', 'member'), ('00000000-0000-0000-0000-0000000000c8', 'Req Other', 'member')
on conflict (id) do nothing;
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, status) values
  ('4d000000-0000-0000-0000-000000000002', 'RQ-2', 'Req Manager', '00000000-0000-0000-0000-0000000000c6', '2025-01-01', 'Active'),
  ('4d000000-0000-0000-0000-000000000003', 'RQ-3', 'Req Finance', '00000000-0000-0000-0000-0000000000c7', '2025-01-01', 'Active'),
  ('4d000000-0000-0000-0000-000000000004', 'RQ-4', 'Req Other', '00000000-0000-0000-0000-0000000000c8', '2025-01-01', 'Active');
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, status, manager_id) values
  ('4d000000-0000-0000-0000-000000000001', 'RQ-1', 'Req Staff', '00000000-0000-0000-0000-0000000000c5', '2025-01-01', 'Active', '4d000000-0000-0000-0000-000000000002');
create or replace function public.rq(p int) returns uuid language sql as $$ select ('4d000000-0000-0000-0000-00000000000' || p)::uuid $$;
grant execute on function public.rq(int) to authenticated;
insert into public.hr_pay_details (employee_id, effective_from, basic, allowances, iban) values (public.rq(1), '2025-01-01', 3000, '{}', 'AE070331234567890123461');
select set_config('hr_biometric.writing', 'on', false);
insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out) values
  (public.rq(1), '2026-09-01', 'Present', '10:00', '15:00'),
  (public.rq(1), '2026-09-02', 'Present', '10:00', '15:00'),
  (public.rq(1), '2026-09-03', 'Present', '10:00', '15:00');
select set_config('hr_biometric.writing', '', false);
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitlement, adjustment)
  select public.rq(1), t.id, 2026, 10, 0 from public.hr_leave_types t where t.accrual_per_month is not null;
create or replace function public.rq_day(p_d date, col text) returns text language plpgsql security definer as $$
declare v text;
begin
  execute format('select d.%I::text from public.hr_attendance_days($1, $1, public.rq(1)) d', col) into v using p_d;
  return v;
end $$;
grant execute on function public.rq_day(date, text) to authenticated;
create or replace function public.rq_closing() returns numeric language sql security definer as $$
  select l.closing from public.hr_leave_ledger(public.rq(1), public.hr_leave_rules_type(), '2026-09-30', '2026-09-30') l where l.month = '2026-09-01'
$$;
grant execute on function public.rq_closing() to authenticated;
create or replace function public.rq_earn(m date) returns jsonb language sql security definer as $$ select public.hr_pay_compute(m, public.rq(1)) -> 'earnings' $$;
grant execute on function public.rq_earn(date) to authenticated;
create or replace function public.rq_id(p_kind text, p_date date) returns uuid language sql security definer as $$ select id from public.hr_requests where employee_id = public.rq(1) and kind = p_kind and work_date is not distinct from p_date order by created_at desc limit 1 $$;
grant execute on function public.rq_id(text, date) to authenticated;
insert into public.hr_finance_managers (profile_id) values ('00000000-0000-0000-0000-0000000000c7');

set role authenticated;

-- ── raising ──
select public.as_user('c8');
select public.must_fail('someone else cannot raise for me', $$select public.hr_request_create(public.rq(1), 'wfh', '2026-09-05', null, null, null, null)$$, 'for yourself');
select public.as_user('c5');
select public.must_fail('a day request needs a date', $$select public.hr_request_create(public.rq(1), 'wfh', null, null, null, null, null)$$, 'date is required');
select public.must_fail('overtime needs hours', $$select public.hr_request_create(public.rq(1), 'overtime', '2026-09-02', null, null, null, null)$$, 'hours');
select public.must_fail('a claim needs an amount', $$select public.hr_request_create(public.rq(1), 'reimbursement', '2026-09-02', null, null, null, public.rq(1) || '/x.pdf')$$, 'amount');
select public.must_fail('a claim needs a document', $$select public.hr_request_create(public.rq(1), 'reimbursement', '2026-09-02', null, 50, null, null)$$, 'document');
select public.must_fail('a claim document must be in their folder', $$select public.hr_request_create(public.rq(1), 'reimbursement', '2026-09-02', null, 50, null, public.rq(4) || '/x.pdf')$$, 'folder');
select public.must_fail('other needs words', $$select public.hr_request_create(public.rq(1), 'other', null, null, null, '  ', null)$$, 'Say what');
select public.must_fail('a future late concession is refused', $$select public.hr_request_create(public.rq(1), 'late_concession', '2999-01-01', null, null, null, null)$$, 'future');
select public.must_fail('the table is closed to direct reads', $$select * from public.hr_requests$$, 'permission denied');
select public.hr_request_create(public.rq(1), 'late_concession', '2026-09-01', null, null, 'Traffic', null);
select public.hr_request_create(public.rq(1), 'half_day', '2026-09-02', null, null, null, null);
select public.hr_request_create(public.rq(1), 'wfh', '2026-09-03', null, null, null, null);
select public.hr_request_create(public.rq(1), 'overtime', '2026-09-03', 2, null, null, null);
select public.hr_request_create(public.rq(1), 'other', null, null, null, 'Salary certificate', null);
select public.hr_request_create(public.rq(1), 'reimbursement', '2026-09-03', null, 150, 'Taxi', public.rq(1) || '/taxi.pdf');
select public.must_fail('the same day twice is refused', $$select public.hr_request_create(public.rq(1), 'wfh', '2026-09-03', null, null, null, null)$$, 'already');
select public.ok('a pending request changes nothing', public.rq_day('2026-09-01', 'late_minutes') = '30' and public.rq_day('2026-09-03', 'status') = 'Present');
select public.must_fail('nobody decides their own', $$select public.hr_request_decide(public.rq_id('wfh', '2026-09-03'), true, null)$$, 'your own');

-- ── who sees what ──
select public.ok('the employee sees all 6', (select count(*) = 6 from public.hr_requests_list()));
select public.ok('nothing is marked for them to decide', (select count(*) = 0 from public.hr_requests_list() where can_decide));
select public.as_user('c6');
select public.ok('the manager sees all but the claim', (select count(*) = 5 from public.hr_requests_list() where full_name = 'Req Staff'));
select public.ok('the manager can decide day requests but not Other', (select count(*) = 4 from public.hr_requests_list() where can_decide));
select public.must_fail('a manager cannot decide Other', $$select public.hr_request_decide(public.rq_id('other', null), true, null)$$, 'not allowed');
select public.must_fail('a manager cannot decide a claim', $$select public.hr_request_decide(public.rq_id('reimbursement', '2026-09-03'), true, null)$$, 'not allowed');
select public.must_fail('a manager cannot set an overtime amount', $$select public.hr_request_decide(public.rq_id('overtime', '2026-09-03'), true, null, 100)$$, 'Only HR');
select public.as_user('c7');
select public.ok('a Finance Manager sees only the claim', (select count(*) = 1 and bool_and(kind = 'reimbursement') from public.hr_requests_list()));
select public.must_fail('a Finance Manager cannot decide leave-like requests', $$select public.hr_request_decide(public.rq_id('wfh', '2026-09-03'), true, null)$$, 'not allowed');
select public.as_user('c8');
select public.ok('another employee sees none', (select count(*) = 0 from public.hr_requests_list()));
select public.must_fail('another employee cannot decide', $$select public.hr_request_decide(public.rq_id('wfh', '2026-09-03'), true, null)$$, 'not allowed');
select public.must_fail('another employee cannot cancel', $$select public.hr_request_cancel(public.rq_id('wfh', '2026-09-03'))$$, 'not allowed');

-- ── effects ──
select public.as_user('c6');
select public.hr_request_decide(public.rq_id('late_concession', '2026-09-01'), true, null);
select public.ok('a late concession removes the lateness', public.rq_day('2026-09-01', 'late_minutes') = '0', public.rq_day('2026-09-01', 'late_minutes'));
select public.hr_request_decide(public.rq_id('half_day', '2026-09-02'), true, null);
select public.ok('a half day is not late', public.rq_day('2026-09-02', 'late_minutes') = '0');
select public.ok('a worked half day takes 0.5 from Annual', public.rq_closing() = 12, public.rq_closing()::text);
select public.hr_request_decide(public.rq_id('wfh', '2026-09-03'), true, null);
select public.ok('work from home shows WFH over punches', public.rq_day('2026-09-03', 'status') = 'WFH', public.rq_day('2026-09-03', 'status'));
select public.ok('WFH keeps the times', public.rq_day('2026-09-03', 'time_in') = '10:00:00');
select public.ok('WFH is not late', public.rq_day('2026-09-03', 'late_minutes') = '0');
select public.ok('a WFH half-hour short day is not charged', public.rq_closing() = 12, public.rq_closing()::text);

-- half day with no punches stays Absent: a full day, not 1.5
reset role;
insert into public.hr_attendance (employee_id, work_date, status) values (public.rq(1), '2026-09-04', 'Absent');
set role authenticated;
select public.as_user('c5');
select public.hr_request_create(public.rq(1), 'half_day', '2026-09-04', null, null, null, null);
select public.as_user('c6');
select public.hr_request_decide(public.rq_id('half_day', '2026-09-04'), true, null);
select public.ok('a half day with no punches charges one day', public.rq_closing() = 11, public.rq_closing()::text);

-- overtime: approved with no amount pays nothing, then HR enters it
select public.hr_request_decide(public.rq_id('overtime', '2026-09-03'), true, 'OK');
select public.ok('overtime with no amount is not paid', not exists (select 1 from jsonb_array_elements(public.rq_earn('2026-09-01')) x where x ->> 'label' = 'Overtime claims'));
select public.must_fail('a manager cannot enter the amount later', $$select public.hr_request_overtime_amount(public.rq_id('overtime', '2026-09-03'), 100)$$, 'Only HR');
select public.as_user('0b');
select public.hr_request_overtime_amount(public.rq_id('overtime', '2026-09-03'), 120);
select public.ok('overtime is added to pay', exists (select 1 from jsonb_array_elements(public.rq_earn('2026-09-01')) x where x ->> 'label' = 'Overtime claims' and (x ->> 'amount')::numeric = 120));
select public.ok('other months are untouched', not exists (select 1 from jsonb_array_elements(public.rq_earn('2026-10-01')) x where x ->> 'label' = 'Overtime claims'));
select public.must_fail('only approved overtime takes an amount', $$select public.hr_request_overtime_amount(public.rq_id('wfh', '2026-09-03'), 5)$$, 'Only an approved');

-- HR cancels: the effect goes away
select public.hr_request_cancel(public.rq_id('wfh', '2026-09-03'));
select public.ok('cancelling undoes work from home', public.rq_day('2026-09-03', 'status') = 'Present', public.rq_day('2026-09-03', 'status'));
select public.hr_request_decide(public.rq_id('other', null), false, 'Ask again in January');
select public.as_user('c5');
select public.ok('the employee sees the reason', (select decision_note = 'Ask again in January' and status = 'rejected' from public.hr_requests_list() where kind = 'other'));
select public.must_fail('a decided request cannot be cancelled by the employee', $$select public.hr_request_cancel(public.rq_id('other', null))$$, 'not allowed');

-- ── expense claim to Accounts ──
select public.as_user('d7');
select public.ok('Accounts does not see a claim before approval', (select count(*) = 0 from public.hr_expenses_list()));
select public.must_fail('a claim that is not approved cannot be paid', $$select public.hr_expense_pay(public.rq_id('reimbursement', '2026-09-03'), '2026-10-01', null)$$, 'approved');
select public.must_fail('Accounts cannot approve a claim', $$select public.hr_request_decide(public.rq_id('reimbursement', '2026-09-03'), true, null)$$, 'not allowed');
select public.as_user('0b');
select public.must_fail('HR cannot approve a claim', $$select public.hr_request_decide(public.rq_id('reimbursement', '2026-09-03'), true, null)$$, 'not allowed');
select public.as_user('c7');
select public.hr_request_decide(public.rq_id('reimbursement', '2026-09-03'), true, 'Receipt seen');
select public.must_fail('a Finance Manager cannot record the payment', $$select public.hr_expense_pay(public.rq_id('reimbursement', '2026-09-03'), '2026-10-01', null)$$, 'not allowed');
select public.as_user('c5');
select public.must_fail('an employee cannot see Accounts'' list', $$select * from public.hr_expenses_list()$$, 'not allowed');
select public.as_user('d7');
select public.ok('Accounts sees it once approved', (select amount = 150 and paid_on is null and storage_path like '%/taxi.pdf' from public.hr_expenses_list()));
select public.must_fail('a future payment date is refused', $$select public.hr_expense_pay(public.rq_id('reimbursement', '2026-09-03'), '2999-01-01', null)$$, 'future');
select public.hr_expense_pay(public.rq_id('reimbursement', '2026-09-03'), '2026-10-01', 'BANK-1');
select public.ok('the payment is recorded', (select paid_on = '2026-10-01' and paid_reference = 'BANK-1' from public.hr_expenses_list()));
select public.must_fail('a claim cannot be paid twice', $$select public.hr_expense_pay(public.rq_id('reimbursement', '2026-09-03'), '2026-10-01', null)$$, 'already paid');
select public.as_user('0b');
select public.must_fail('a paid claim cannot be cancelled', $$select public.hr_request_cancel(public.rq_id('reimbursement', '2026-09-03'))$$, 'has been paid');
select public.as_user('d7');
select public.hr_expense_unpay(public.rq_id('reimbursement', '2026-09-03'));
select public.ok('removing the payment reopens it', (select paid_on is null from public.hr_expenses_list()));

-- ── Finance list ──
select public.as_user('0b');
select public.must_fail('HR cannot change the Finance list', $$insert into public.hr_finance_managers (profile_id) values ('00000000-0000-0000-0000-0000000000c8')$$, 'row-level security');
select public.as_user('0a');
select public.ok('an admin counts as Finance', public.hr_is_finance());
insert into public.hr_finance_managers (profile_id) values ('00000000-0000-0000-0000-0000000000c8');
delete from public.hr_finance_managers where profile_id = '00000000-0000-0000-0000-0000000000c8';
select public.ok('an admin changes the list', (select count(*) = 1 from public.hr_finance_managers));
select public.as_user('c8');
select public.ok('others are not Finance', not public.hr_is_finance());

-- ── insurance, mobile, assets ──
select public.as_user('0b');
insert into public.hr_insurance (employee_id, company, plan_name, covered, start_date, tenure_months, end_date) values (public.rq(1), 'Test Insurer', 'Gold', 'Self and spouse', '2026-01-01', 12, '2026-12-31');
insert into public.hr_mobile_plans (employee_id, phone_number, provider, plan_name, recharge_date, next_recharge_date, amount) values (public.rq(1), '0500000000', 'Test Mobile', 'Monthly', '2026-11-01', '2026-12-01', 100);
insert into public.hr_assets (employee_id, asset_type, make_model, serial_number, issued_on) values (public.rq(1), 'Laptop', 'Test 14', 'SN1', '2026-01-05');
select public.must_fail('an end date before the start is refused', $$insert into public.hr_insurance (employee_id, company, start_date, end_date) values (public.rq(1), 'X', '2026-02-01', '2026-01-01')$$, 'check constraint');
select public.as_user('c5');
select public.ok('the employee reads their insurance', (select count(*) = 1 from public.hr_insurance));
select public.ok('the employee reads their mobile plan', (select count(*) = 1 from public.hr_mobile_plans));
select public.ok('the employee reads their assets', (select count(*) = 1 from public.hr_assets));
select public.must_fail('the employee cannot add an asset', $$insert into public.hr_assets (employee_id, asset_type) values (public.rq(1), 'Phone')$$, 'row-level security');
select public.as_user('c6');
select public.ok('a manager sees no insurance', (select count(*) = 0 from public.hr_insurance));
select public.ok('a manager sees no assets', (select count(*) = 0 from public.hr_assets));
select public.as_user('c8');
select public.ok('another employee sees no mobile plan', (select count(*) = 0 from public.hr_mobile_plans));
reset role;

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
