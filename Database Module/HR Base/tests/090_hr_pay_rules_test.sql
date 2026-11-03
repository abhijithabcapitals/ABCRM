-- LOCAL TEST ONLY: the 9-hour late rule, leave accrual, the leave ledger in pay, and salary payments. Runs after 080 on the same cluster (reuses its helpers).
-- Profile ...0b is the HR list member from 010. ...f1 is Day Staff from 070. ...d7 is an Accounts login and ...d8 a plain employee, both added here.
-- Rules start 2026-09-01. Dates are fixed and in the past, like 070. 010_hr_test.sql re-applies older migrations, so 013 goes on again first.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
\ir ../migrations/013_hr_pay_rules.sql
reset role;
truncate public.t_result;
update public.hr_employees set status = 'Left', exit_date = '2000-01-01', join_date = '1999-01-01', on_payroll = false;
delete from public.hr_holidays;
delete from public.hr_wfh_saturday_rules;
update public.hr_settings set absent_from_blank_days = false, attendance_tracked_from = '2026-01-01', weekend_days = '{0}', shift_start = '09:30', shift_end = '18:30', saturday_end = '14:00',
  pay_day_divisor_mode = 'calendar_days', pay_unpaid_wage_base = 'total', leave_rules_from = null where id = 1;

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d7', 'Accounts Person', 'member'),
  ('00000000-0000-0000-0000-0000000000d8', 'Rule Staff', 'member')
on conflict (id) do nothing;
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, status) values
  ('4c000000-0000-0000-0000-000000000001', 'PR-1', 'Long Service', '00000000-0000-0000-0000-0000000000d8', '2025-01-15', 'Active'),
  ('4c000000-0000-0000-0000-000000000002', 'PR-2', 'New Joiner', null, '2026-08-10', 'Active'),
  ('4c000000-0000-0000-0000-000000000003', 'PR-3', 'Six Months In', null, '2026-02-10', 'Active'),
  ('4c000000-0000-0000-0000-000000000004', 'PR-4', 'Late Checker', null, '2026-01-01', 'Active');
create or replace function public.pr(p int) returns uuid language sql as $$ select ('4c000000-0000-0000-0000-00000000000' || p)::uuid $$;
grant execute on function public.pr(int) to authenticated;
insert into public.hr_pay_details (employee_id, effective_from, basic, allowances, iban) values
  (public.pr(1), '2025-01-01', 2000, '{"HRA": 1000}', 'AE070331234567890123451'),
  (public.pr(2), '2025-01-01', 3000, '{}', 'AE070331234567890123452'),
  (public.pr(3), '2025-01-01', 3000, '{}', 'AE070331234567890123453'),
  (public.pr(4), '2025-01-01', 3000, '{}', 'AE070331234567890123454');

-- Stand-in for Banking Base's permission check.
create table if not exists public.t_accounts (profile_id uuid primary key);
create or replace function public.banking_can(p text) returns boolean language sql stable security definer as $$
  select p = 'accounts.review' and exists (select 1 from public.t_accounts a where a.profile_id = auth.uid())
$$;
grant execute on function public.banking_can(text) to authenticated;
insert into public.t_accounts values ('00000000-0000-0000-0000-0000000000d7') on conflict do nothing;

create or replace function public.pr_late(p int, d date) returns int language sql security definer as $$ select late_minutes from public.hr_attendance_days(d, d, public.pr(p)) $$;
create or replace function public.pr_line(p int, m date) returns jsonb language sql security definer as $$ select public.hr_pay_compute(m, public.pr(p)) $$;
create or replace function public.pr_ded(p int, m date) returns numeric language sql security definer as $$
  select coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(public.hr_pay_compute(m, public.pr(p)) -> 'deductions') x), 0)
$$;
create or replace function public.pr_ledger(p int, m date, col text) returns numeric language plpgsql security definer as $$
declare v numeric;
begin
  execute format('select l.%I from public.hr_leave_ledger($1, public.hr_leave_rules_type(), $2, $2) l where l.month = date_trunc(''month'', $2)::date', col) into v using public.pr(p), (date_trunc('month', m) + interval '1 month - 1 day')::date;
  return v;
end $$;

-- ── late: 9 hours between punches ──
insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out) values
  (public.pr(4), '2026-08-03', 'Present', '10:00', '19:00'),
  (public.pr(4), '2026-08-04', 'Present', '10:00', '18:59'),
  (public.pr(4), '2026-08-05', 'Present', '10:00', null),
  (public.pr(4), '2026-08-06', 'Present', '09:30', '12:00'),
  (public.pr(4), '2026-08-08', 'Present', '10:00', '14:30'),
  (public.pr(4), '2026-08-15', 'Present', '10:00', '14:29');
select public.ok('9 hours is not late', public.pr_late(4, '2026-08-03') = 0, public.pr_late(4, '2026-08-03')::text);
select public.ok('a minute under 9 hours is late', public.pr_late(4, '2026-08-04') = 30, public.pr_late(4, '2026-08-04')::text);
select public.ok('no last punch is late', public.pr_late(4, '2026-08-05') = 30, public.pr_late(4, '2026-08-05')::text);
select public.ok('on time and short is not late', public.pr_late(4, '2026-08-06') = 0, public.pr_late(4, '2026-08-06')::text);
select public.ok('Saturday needs 4.5 hours: met', public.pr_late(4, '2026-08-08') = 0, public.pr_late(4, '2026-08-08')::text);
select public.ok('Saturday needs 4.5 hours: short', public.pr_late(4, '2026-08-15') = 30, public.pr_late(4, '2026-08-15')::text);

-- ── rules off: Absent is unpaid at once, as before ──
insert into public.hr_leave_types (id, name, paid, annual_days, carry_forward) values ('42000000-0000-0000-0000-000000000001', 'Rule Annual', true, 30, true), ('42000000-0000-0000-0000-000000000002', 'Rule Unpaid', false, null, false);
insert into public.hr_attendance (employee_id, work_date, status) values (public.pr(2), '2026-08-20', 'Absent');
select public.ok('before the rules an Absent day is deducted', public.pr_ded(2, '2026-08-01') > 0, public.pr_ded(2, '2026-08-01')::text);

-- ── rules on ──
update public.hr_leave_types set accrual_per_month = 2.5, accrual_after_months = 6 where id = '42000000-0000-0000-0000-000000000001';
update public.hr_settings set leave_rules_from = '2026-09-01' where id = 1;
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitlement, adjustment) values (public.pr(1), '42000000-0000-0000-0000-000000000001', 2026, 10, -2);

-- accrual
select public.ok('a long-serving person accrues in Sep', public.pr_ledger(1, '2026-09-01', 'accrued') = 2.5, public.pr_ledger(1, '2026-09-01', 'accrued')::text);
select public.ok('the opening row is credited once', public.pr_ledger(1, '2026-09-01', 'credit') = 8 and public.pr_ledger(1, '2026-10-01', 'credit') = 0);
select public.ok('nothing in the first 6 months', public.pr_ledger(2, '2026-10-01', 'accrued') = 0, public.pr_ledger(2, '2026-10-01', 'accrued')::text);
select public.ok('month 7 accrues: joined 10 Feb, Sep 10 counts', public.pr_ledger(3, '2026-09-01', 'accrued') = 2.5, public.pr_ledger(3, '2026-09-01', 'accrued')::text);
select public.ok('a year accrues 30', (select sum(l.accrued) = 30 from public.hr_leave_ledger(public.pr(1), public.hr_leave_rules_type(), '2027-08-31', '2027-08-31') l));

-- Sep: 3 Absent + 5 late days (1 leave) = 4, all from the balance of 10.5
insert into public.hr_attendance (employee_id, work_date, status) values (public.pr(1), '2026-09-01', 'Absent'), (public.pr(1), '2026-09-02', 'Absent'), (public.pr(1), '2026-09-03', 'Absent');
insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out)
  select public.pr(1), d::date, 'Present', '10:00', '18:30' from generate_series('2026-09-07'::timestamp, '2026-09-11'::timestamp, interval '1 day') d;
insert into public.hr_attendance (employee_id, work_date, status, time_in, time_out) values (public.pr(1), '2026-09-14', 'Present', '10:00', '19:00');
select public.ok('5 late days make 1 leave', public.pr_ledger(1, '2026-09-01', 'late_leaves') = 1, public.pr_ledger(1, '2026-09-01', 'late_leaves')::text);
select public.ok('a 9-hour late arrival does not count', public.pr_ledger(1, '2026-09-01', 'late_days') = 5, public.pr_ledger(1, '2026-09-01', 'late_days')::text);
select public.ok('leave within the balance costs no pay', public.pr_ded(1, '2026-09-01') = 0, public.pr_ded(1, '2026-09-01')::text);
select public.ok('the balance goes down by 4', public.pr_ledger(1, '2026-09-01', 'closing') = 6.5, public.pr_ledger(1, '2026-09-01', 'closing')::text);

-- Oct: 6.5 + 2.5 = 9. 12 Absent: 3 beyond. 3000 / 31 x 3 = 290.32
insert into public.hr_attendance (employee_id, work_date, status)
  select public.pr(1), d::date, 'Absent' from generate_series('2026-10-01'::timestamp, '2026-10-14'::timestamp, interval '1 day') d where extract(dow from d) <> 0;
select public.ok('12 Absent days in Oct', public.pr_ledger(1, '2026-10-01', 'absent_days') = 12, public.pr_ledger(1, '2026-10-01', 'absent_days')::text);
select public.ok('only days beyond the balance are unpaid', public.pr_ledger(1, '2026-10-01', 'unpaid') = 3, public.pr_ledger(1, '2026-10-01', 'unpaid')::text);
select public.ok('deduction is total salary / days in month x days', public.pr_ded(1, '2026-10-01') = 290.32, public.pr_ded(1, '2026-10-01')::text);
select public.ok('the balance stops at 0', public.pr_ledger(1, '2026-10-01', 'closing') = 0, public.pr_ledger(1, '2026-10-01', 'closing')::text);
select public.ok('the line explains it', public.pr_line(1, '2026-10-01') ->> 'notes' like '%beyond the Annual balance%');

-- A new joiner has no balance: Absent is unpaid. Approved unpaid leave is always unpaid.
insert into public.hr_attendance (employee_id, work_date, status) values (public.pr(2), '2026-09-01', 'Absent');
select public.ok('no balance: Absent deducts 3000 / 30', public.pr_ded(2, '2026-09-01') = 100, public.pr_ded(2, '2026-09-01')::text);
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values (public.pr(3), '42000000-0000-0000-0000-000000000002', '2026-09-15', '2026-09-16', 2, 'approved');
select public.ok('unpaid leave deducts even with a balance', public.pr_ded(3, '2026-09-01') = 200, public.pr_ded(3, '2026-09-01')::text);
select public.ok('unpaid leave does not use the balance', public.pr_ledger(3, '2026-09-01', 'closing') = 2.5, public.pr_ledger(3, '2026-09-01', 'closing')::text);

-- Approved Annual leave across a month end is split between the months. Absent inside it is not charged twice.
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values (public.pr(3), '42000000-0000-0000-0000-000000000001', '2026-09-29', '2026-10-01', 3, 'approved');
insert into public.hr_attendance (employee_id, work_date, status) values (public.pr(3), '2026-09-30', 'Absent');
select public.ok('Annual days in the month', public.pr_ledger(3, '2026-09-01', 'annual_days') = 2, public.pr_ledger(3, '2026-09-01', 'annual_days')::text);
select public.ok('Absent inside approved leave is not charged', public.pr_ledger(3, '2026-09-01', 'absent_days') = 0, public.pr_ledger(3, '2026-09-01', 'absent_days')::text);

-- The balance screen agrees with the ledger.
set role authenticated;
select public.as_user('0b');
select public.ok('balance shows the ledger', (select remaining = 0 and used = 13 + 0 + 0 from public.hr_leave_balance(public.pr(1), 2026) where leave_type = 'Rule Annual'), (select used::text || ' / ' || remaining::text from public.hr_leave_balance(public.pr(1), 2026) where leave_type = 'Rule Annual'));
select public.ok('entitlement stays what HR set, with accrual beside it', (select entitlement = 10 and adjustment = -2 and accrued > 0 from public.hr_leave_balance(public.pr(1), 2026) where leave_type = 'Rule Annual'));
select public.ok('carried into next year is the closing balance', (select carried = 0 from public.hr_leave_balance(public.pr(1), 2027) where leave_type = 'Rule Annual'));
select public.ok('other types still work', (select remaining is null from public.hr_leave_balance(public.pr(1), 2026) where leave_type = 'Rule Unpaid'));

-- Gratuity counts only the ledger's unpaid days
reset role;
select public.ok('gratuity leaves out only unpaid days', public.hr_pay_unpaid_total(public.pr(1), '2026-09-01', '2026-10-31') = 3, public.hr_pay_unpaid_total(public.pr(1), '2026-09-01', '2026-10-31')::text);

-- ── salary payments ──
set role authenticated;
select public.as_user('0b');
create temp table t_run as select public.hr_payrun_create('2025-12-01') as id;
grant select on t_run to authenticated;
select public.hr_payrun_approve((select id from t_run), true);
reset role;
create or replace function public.pr_pay_line(p int) returns uuid language sql security definer as $$ select l.id from public.hr_pay_lines l join public.hr_pay_runs r on r.id = l.run_id where l.employee_id = public.pr(p) and r.period_month = '2025-12-01' $$;
grant execute on function public.pr_pay_line(int) to authenticated;
set role authenticated;

select public.as_user('d8');
select public.must_fail('an employee cannot see salaries', $$select * from public.hr_salaries_overview(2026)$$, 'not allowed');
select public.must_fail('an employee cannot record a payment', $$select public.hr_salary_pay(public.pr_pay_line(1), 1, '2026-10-01', null)$$, 'not allowed');
select public.must_fail('the table is closed to direct reads', $$select * from public.hr_salary_payments$$, 'permission denied');
select public.as_user('d7');
select public.ok('Accounts sees Payable', (select payable = 3000 and paid = 0 and outstanding = payable from public.hr_salaries_overview(2025) where run_id = (select id from t_run)), (select payable::text from public.hr_salaries_overview(2025) where run_id = (select id from t_run)));
select public.must_fail('a future date is refused', $$select public.hr_salary_pay(public.pr_pay_line(1), 1, '2999-01-01', null)$$, 'future');
select public.must_fail('a date is required', $$select public.hr_salary_pay(public.pr_pay_line(1), 1, null, null)$$, 'date is required');
select public.must_fail('more than owed is refused', $$select public.hr_salary_pay(public.pr_pay_line(1), 3000.01, '2026-10-01', null)$$, 'more than');
select public.must_fail('zero is refused', $$select public.hr_salary_pay(public.pr_pay_line(1), 0, '2026-10-01', null)$$, 'more than 0');
select public.hr_salary_pay(public.pr_pay_line(1), 1000, '2026-10-01', 'WPS-1');
select public.ok('a part payment leaves the rest outstanding', (select paid = 1000 and outstanding = 2000 from public.hr_salaries_month((select id from t_run)) where full_name = 'Long Service'));
select public.hr_salary_pay_all((select id from t_run), '2026-10-02', 'WPS-2');
select public.ok('pay all clears the run', (select outstanding = 0 from public.hr_salaries_overview(2025) where run_id = (select id from t_run)), (select outstanding::text from public.hr_salaries_overview(2025) where run_id = (select id from t_run)));
select public.ok('each payment is listed', (select jsonb_array_length(payments) = 2 from public.hr_salaries_month((select id from t_run)) where full_name = 'Long Service'));
select public.must_fail('nothing more can be paid', $$select public.hr_salary_pay(public.pr_pay_line(1), null, '2026-10-01', null)$$, 'more than 0');
select public.hr_salary_payment_remove((select (payments -> 0 ->> 'id')::uuid from public.hr_salaries_month((select id from t_run)) where full_name = 'Long Service'));
select public.ok('removing a payment makes it owed again', (select outstanding = 1000 from public.hr_salaries_month((select id from t_run)) where full_name = 'Long Service'));
reset role;
select public.ok('the payment is in the audit log', exists (select 1 from public.hr_audit_log where action = 'salary.paid') and exists (select 1 from public.hr_audit_log where action = 'salary.payment_removed'));
select public.ok('only one type can accrue', (select count(*) = 1 from public.hr_leave_types where accrual_per_month is not null));
set role authenticated;
select public.as_user('0b');
select public.must_fail('a draft line cannot be paid', $$select public.hr_salary_pay((select l.id from public.hr_pay_lines l join public.hr_pay_runs r on r.id = l.run_id where r.status = 'draft' limit 1), 1, '2026-10-01', null)$$, 'approved run');
reset role;

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
