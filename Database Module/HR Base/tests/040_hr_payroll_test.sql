-- LOCAL TEST ONLY: payroll runs, approval lock, access scope, gratuity. Runs after 010, 020, 030 on the same cluster (reuses helpers).
-- All settings values below are TEST FIXTURES chosen to make the arithmetic checkable. They are not company policy and not law:
-- PAYROLL_RULES.md marks P3, P5, P6, G3b and G5 as company policy decisions still to be made.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
-- Earlier test files' employees must not appear in these runs.
update public.hr_employees set status = 'Left', join_date = '1999-01-01', exit_date = '2000-01-01';
update public.hr_settings set weekend_days = '{0,6}', pay_days_basis = null;

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'Pay Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000c2', 'Pay Report', 'member'),
  ('00000000-0000-0000-0000-0000000000c3', 'Pay Other', 'member');
create function public.pe(p text) returns uuid language sql as $$ select ('40000000-0000-0000-0000-0000000000' || p)::uuid $$;
grant execute on function public.pe(text) to authenticated;
insert into public.hr_employees (id, employee_code, full_name, profile_id, manager_id, join_date, exit_date, status) values
  (public.pe('c1'), 'P-1', 'Pay Manager', '00000000-0000-0000-0000-0000000000c1', null, '2020-01-01', null, 'Active'),
  (public.pe('c2'), 'P-2', 'Pay Report', '00000000-0000-0000-0000-0000000000c2', public.pe('c1'), '2020-01-01', null, 'Active'),
  (public.pe('c3'), 'P-3', 'Pay Other', '00000000-0000-0000-0000-0000000000c3', null, '2020-01-01', null, 'Active'),
  (public.pe('c4'), 'P-4', 'Pay Joiner', null, null, '2025-06-16', null, 'Active'),
  (public.pe('c5'), 'P-5', 'Pay Leaver', null, null, '2020-01-01', '2025-06-10', 'Left'),
  (public.pe('c6'), 'P-6', 'Pay No Details', null, null, '2020-01-01', null, 'Active'),
  (public.pe('c7'), 'P-7', 'Pay No Iban', null, null, '2020-01-01', null, 'Active'),
  (public.pe('c8'), 'P-8', 'Pay July Joiner', null, null, '2025-07-21', null, 'Active'),
  (public.pe('c9'), 'P-9', 'Pay Left No Date', null, null, '2020-01-01', null, 'Left'),
  (public.pe('ca'), 'P-A', 'Pay Gone Before', null, null, '2020-01-01', '2025-05-31', 'Left'),
  -- gratuity people: exit_date 2024 keeps them out of the 2025 runs; hr_gratuity takes the exit date as a parameter
  (public.pe('d1'), 'G-1', 'Grat Three Years', null, null, '2020-01-01', '2024-12-31', 'Left'),
  (public.pe('d2'), 'G-2', 'Grat Eight Years', null, null, '2015-01-01', '2024-12-31', 'Left'),
  (public.pe('d3'), 'G-3', 'Grat Thirty Years', null, null, '1990-01-01', '2024-12-31', 'Left'),
  (public.pe('d4'), 'G-4', 'Grat One Year', null, null, '2024-01-01', '2024-12-31', 'Left'),
  (public.pe('d5'), 'G-5', 'Grat Part Year', null, null, '2020-01-01', '2024-12-31', 'Left'),
  (public.pe('d6'), 'G-6', 'Grat Absences', null, null, '2020-01-01', '2024-12-31', 'Left'),
  (public.pe('d7'), 'G-7', 'Grat Absent Boundary', null, null, '2024-01-01', '2024-12-31', 'Left'),
  (public.pe('d8'), 'G-8', 'Grat No Details', null, null, '2020-01-01', '2024-12-31', 'Left');
insert into public.hr_leave_types (name, paid, half_pay_note) values ('PX Paid', true, false), ('PX Unpaid', false, false), ('PX Tiered', true, true);
-- Report: unpaid leave Mon-Tue 9-10 June 2025 (written as owner, as an already-decided request would be)
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values
  (public.pe('c2'), public.ltype('PX Unpaid'), '2025-06-09', '2025-06-10', 2, 'approved'),
  (public.pe('c2'), public.ltype('PX Unpaid'), '2025-06-16', '2025-06-16', 1, 'pending'),
  (public.pe('c3'), public.ltype('PX Tiered'), '2025-06-20', '2025-06-20', 1, 'approved'),
  (public.pe('c3'), public.ltype('PX Paid'), '2025-06-23', '2025-06-23', 1, 'approved');

create function public.rid(p_month date) returns uuid language sql as $$ select id from public.hr_pay_runs where period_month = p_month $$;
create function public.ln(p_month date, p_emp text) returns public.hr_pay_lines language sql as $$
  select l.* from public.hr_pay_lines l join public.hr_pay_runs r on r.id = l.run_id where r.period_month = p_month and l.employee_id = public.pe(p_emp)
$$;
create function public.amt(p_items jsonb, p_label text) returns numeric language sql as $$
  select sum((x ->> 'amount')::numeric) from jsonb_array_elements(p_items) x where x ->> 'label' = p_label
$$;
create function public.gr(p_emp text, p_exit date) returns jsonb language sql as $$ select public.hr_gratuity(public.pe(p_emp), p_exit) $$;
grant execute on function public.rid(date), public.ln(date, text), public.amt(jsonb, text), public.gr(text, date) to authenticated;

set role authenticated;

-- ── settings: everything starts empty and a run names what is missing ──
select public.as_user('0b');
select public.ok('new settings are all null by default', (select pay_day_divisor_mode is null and pay_unpaid_wage_base is null and gratuity_fraction_method is null and gratuity_cap_base is null and gratuity_daily_divisor is null and gratuity_service_end_inclusive is null from public.hr_settings));
select public.must_fail('run needs the divisor mode', $$select public.hr_payrun_create('2025-06-01')$$, 'Pay day divisor mode');
update public.hr_settings set pay_day_divisor_mode = 'fixed';
select public.must_fail('fixed mode with a null pay_days_basis fails', $$select public.hr_payrun_create('2025-06-01')$$, 'Pay days basis');
update public.hr_settings set pay_days_basis = 30; -- fixture
select public.must_fail('run needs the unpaid wage base', $$select public.hr_payrun_create('2025-06-01')$$, 'Unpaid leave wage base');
select public.ok('a failed create leaves no run', (select count(*) = 0 from public.hr_pay_runs));
update public.hr_settings set pay_unpaid_wage_base = 'total'; -- fixture
select public.must_fail('settings reject an unknown mode', $$update public.hr_settings set pay_day_divisor_mode = 'lunar'$$, 'check');
select public.must_fail('a null month is refused', $$select 1 from public.hr_payrun_create(null)$$, 'month');

-- ── pay details: validation, audit, IBAN never in the audit log or error text ──
insert into public.hr_pay_details (employee_id, effective_from, basic, allowances, iban, bank_routing, wps_labour_card) values
  (public.pe('c1'), '2020-01-01', 10000, '{}', 'AE070331234567890123451', '033', 'LC1'),
  (public.pe('c2'), '2020-01-01', 9000, '{"Housing": 3000, "Transport": 1000}', 'AE070331234567890123452', '033', 'LC2'),
  (public.pe('c3'), '2020-01-01', 6000, '{}', 'ae07 0331 2345 6789 0123 453', '033', 'LC3'),
  (public.pe('c4'), '2025-06-16', 3000, '{"Housing": 1000}', 'AE070331234567890123454', '033', 'LC4'),
  (public.pe('c5'), '2020-01-01', 7000, '{"Phone": 100.10}', 'AE070331234567890123455', '033', 'LC5'),
  (public.pe('c7'), '2020-01-01', 5000, '{}', null, null, null),
  (public.pe('c8'), '2025-07-21', 1500, '{"Housing": 500}', 'AE070331234567890123458', '033', 'LC8'),
  (public.pe('c9'), '2020-01-01', 5000, '{}', 'AE070331234567890123459', '033', 'LC9'),
  (public.pe('d1'), '2020-01-01', 5000, '{}', null, null, null),
  (public.pe('d1'), '2023-06-01', 6000, '{}', null, null, null),
  (public.pe('d2'), '2015-01-01', 10000, '{}', null, null, null),
  (public.pe('d3'), '1990-01-01', 10000, '{"Housing": 2000}', null, null, null),
  (public.pe('d4'), '2024-01-01', 10000, '{}', null, null, null),
  (public.pe('d5'), '2020-01-01', 6000, '{}', null, null, null),
  (public.pe('d6'), '2020-01-01', 5000, '{}', null, null, null),
  (public.pe('d7'), '2024-01-01', 10000, '{}', null, null, null);
select public.ok('IBAN is normalised to upper case without spaces', (select iban = 'AE070331234567890123453' from public.hr_pay_details where employee_id = public.pe('c3')));
select public.must_fail('IBAN must start with AE', $$insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c6'), '2020-01-01', 1, 'GB070331234567890123451')$$, 'IBAN');
select public.must_fail('IBAN must be 23 characters', $$insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c6'), '2020-01-01', 1, 'AE0703312345')$$, '23 characters');
do $$
declare m text; d text;
begin
  begin
    insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c6'), '2020-01-01', 1, 'AE07033123');
  exception when others then
    get stacked diagnostics m = message_text, d = pg_exception_detail;
    perform public.ok('a rejected IBAN is not echoed in the error', position('AE07033123' in (m || coalesce(d, ''))) = 0, m || ' / ' || coalesce(d, ''));
  end;
  begin
    insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c6'), '2020-01-01', -1, 'AE070331234567890123456');
  exception when others then
    get stacked diagnostics m = message_text, d = pg_exception_detail;
    perform public.ok('a rejected basic does not echo the row IBAN', position('0123456' in (m || coalesce(d, ''))) = 0 and m ilike '%basic%', m || ' / ' || coalesce(d, ''));
  end;
end $$;
select public.must_fail('allowances must be an object', $$insert into public.hr_pay_details (employee_id, effective_from, basic, allowances) values (public.pe('c6'), '2020-01-01', 1, '[1]')$$, 'allowances');
select public.must_fail('allowance amounts must be numbers', $$insert into public.hr_pay_details (employee_id, effective_from, basic, allowances) values (public.pe('c6'), '2020-01-01', 1, '{"Housing": "lots"}')$$, 'Housing');
select public.must_fail('allowance amounts cannot be negative', $$insert into public.hr_pay_details (employee_id, effective_from, basic, allowances) values (public.pe('c6'), '2020-01-01', 1, '{"Housing": -1}')$$, 'Housing');
select public.ok('creating pay details is audited', (select count(*) = 16 from public.hr_audit_log where action = 'pay_details.created'));
update public.hr_pay_details set basic = 3000, iban = 'AE070331234567890123999' where employee_id = public.pe('c4');
update public.hr_pay_details set iban = 'AE070331234567890123454' where employee_id = public.pe('c4');
select public.ok('a pay-details change is audited with old and new basic', (select bool_or((old_values ->> 'basic')::numeric = 3000 and new_values ->> 'iban_changed' = 'true') from public.hr_audit_log where action = 'pay_details.updated'));
select public.ok('audit records iban changed, never the IBAN', (select count(*) = 0 from public.hr_audit_log where action like 'pay_details.%' and (coalesce(old_values::text, '') || coalesce(new_values::text, '')) ilike '%AE0703%'));
select public.ok('audit has no iban key', (select count(*) = 0 from public.hr_audit_log where action like 'pay_details.%' and (coalesce(old_values, '{}') ? 'iban' or coalesce(new_values, '{}') ? 'iban')));
select public.ok('the list masks IBAN to the last 4', (select bool_and(iban_masked = '****3452' and position('AE' in iban_masked) = 0) from public.hr_pay_details_list() where employee_id = public.pe('c2')));
select public.ok('the list result has no full IBAN', (select count(*) = 0 from public.hr_pay_details_list() x where to_jsonb(x)::text ilike '%AE0703%'));

-- ── run creation: who is in it, proration, unpaid days, rounding ──
select public.as_user('c2'); -- attendance is set by HR below; this proves the employee cannot create
select public.must_fail('employee cannot create a run', $$select public.hr_payrun_create('2025-06-01')$$, 'not allowed');
select public.as_user('c1');
select public.must_fail('manager cannot create a run', $$select public.hr_payrun_create('2025-06-01')$$, 'not allowed');
select public.as_user('0b');
select public.hr_attendance_set(public.pe('c2'), '2025-06-03', 'Absent', null, null, null);
select public.hr_attendance_set(public.pe('c2'), '2025-06-04', 'Present', '09:00', '18:00', null);
select public.hr_attendance_set(public.pe('c2'), '2025-06-10', 'Absent', null, null, 'also on unpaid leave: counted once');
select public.ok('create returns the run id', public.hr_payrun_create('2025-06-15') = public.rid('2025-06-01'));
select public.ok('run is a draft, prepared by the creator', (select status = 'draft' and prepared_by = '00000000-0000-0000-0000-00000000000b' from public.hr_pay_runs where id = public.rid('2025-06-01')));
select public.must_fail('second run for a month fails', $$select public.hr_payrun_create('2025-06-20')$$, 'already');
select public.ok('creation is audited', (select count(*) = 1 from public.hr_audit_log where action = 'payrun.created'));
select public.ok('run holds exactly the people employed in June', (select count(*) = 8 from public.hr_pay_lines where run_id = public.rid('2025-06-01')));
select public.ok('someone who left before the month is out', (public.ln('2025-06-01', 'ca')).id is null);
select public.ok('someone who joined after the month is out', (public.ln('2025-06-01', 'c8')).id is null);
select public.ok('full month basic', public.amt((public.ln('2025-06-01', 'c1')).earnings, 'Basic') = 10000);
select public.ok('full month net has no deduction', (public.ln('2025-06-01', 'c1')).net = 10000);
select public.ok('earnings list each allowance', public.amt((public.ln('2025-06-01', 'c2')).earnings, 'Housing') = 3000 and public.amt((public.ln('2025-06-01', 'c2')).earnings, 'Transport') = 1000);
-- Report: Absent 3 June, unpaid leave 9 and 10 June (10 June also Absent: once), pending leave ignored = 3 days x 13000 / 30
select public.ok('unpaid leave and absence reduce net; a double day counts once; pending ignored', public.amt((public.ln('2025-06-01', 'c2')).deductions, 'Unpaid days') = 1300.00 and (public.ln('2025-06-01', 'c2')).net = 11700.00, (public.ln('2025-06-01', 'c2')).deductions::text);
-- Joiner on 16 June: 15 days of 30
select public.ok('mid-month joiner is pro-rated', (public.ln('2025-06-01', 'c4')).net = 2000.00, (public.ln('2025-06-01', 'c4')).earnings::text);
-- Leaver on 10 June: 10 of 30. 7000/3 = 2333.33; 100.10/3 = 33.3666 -> 33.37; net 2366.70
select public.ok('mid-month leaver is pro-rated', (public.ln('2025-06-01', 'c5')).net = 2366.70, (public.ln('2025-06-01', 'c5')).earnings::text);
select public.ok('each money figure is rounded to 2 decimals', public.amt((public.ln('2025-06-01', 'c5')).earnings, 'Phone') = 33.37 and public.amt((public.ln('2025-06-01', 'c5')).earnings, 'Basic') = 2333.33);
select public.ok('notes trace the figures', (public.ln('2025-06-01', 'c2')).notes::text ilike '%2025-06-03%' and (public.ln('2025-06-01', 'c2')).notes::text ilike '%30%' and (public.ln('2025-06-01', 'c5')).notes::text ilike '%10%');
select public.ok('notes never carry the IBAN', (select count(*) = 0 from public.hr_pay_lines where notes::text || blockers::text || earnings::text ilike '%AE0703%'));
select public.ok('half-pay type: counted as fully paid', (public.ln('2025-06-01', 'c3')).net = 6000);
select public.ok('half-pay type: carries a review note', (public.ln('2025-06-01', 'c3')).notes::text ilike '%half-pay%review%', (public.ln('2025-06-01', 'c3')).notes::text);
select public.ok('other lines have no half-pay note', (public.ln('2025-06-01', 'c1')).notes::text not ilike '%half-pay%');

-- ── missing data blocks approval and lists the people ──
select public.ok('no pay details: flagged, zero net', (public.ln('2025-06-01', 'c6')).net = 0 and (public.ln('2025-06-01', 'c6')).blockers::text ilike '%pay details%');
select public.ok('no IBAN: flagged', (public.ln('2025-06-01', 'c7')).blockers::text ilike '%IBAN%');
select public.ok('Left with no exit date: flagged', (public.ln('2025-06-01', 'c9')).blockers::text ilike '%exit date%');
select public.as_user('0a');
select public.must_fail('approval lists a person with no pay details', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay No Details');
select public.must_fail('approval lists a person with no IBAN', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay No Iban');
select public.must_fail('approval lists a Left person with no exit date', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Left No Date');
select public.ok('blocked approval changed nothing', (select status = 'draft' and approved_by is null from public.hr_pay_runs where id = public.rid('2025-06-01')));
select public.as_user('0b');
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c6'), '2020-01-01', 4000, 'AE070331234567890123456');
update public.hr_pay_details set iban = 'AE070331234567890123457' where employee_id = public.pe('c7');
update public.hr_employees set exit_date = '2025-05-31' where id = public.pe('c9');
select public.as_user('0a');
select public.must_fail('fixing pay data after review needs a recalc: lists the person', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay No Details');
select public.must_fail('a person who left the scope is listed too', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Left No Date');
select public.as_user('0b');

-- ── adjustments ──
select public.hr_payrun_adjust((public.ln('2025-06-01', 'c2')).id, 'Bonus', 200.555);
select public.ok('adjustment is rounded and added to net', (public.ln('2025-06-01', 'c2')).net = 11900.56 and public.amt((public.ln('2025-06-01', 'c2')).adjustments, 'Bonus') = 200.56);
select public.ok('adjustment is audited', (select count(*) = 1 and bool_and(new_values::text ilike '%Bonus%') from public.hr_audit_log where action = 'payrun.adjusted'));
select public.must_fail('adjustment needs a label', $$select public.hr_payrun_adjust((public.ln('2025-06-01', 'c2')).id, ' ', 1)$$, 'label');
select public.must_fail('adjustment rejects NaN', $$select public.hr_payrun_adjust((public.ln('2025-06-01', 'c2')).id, 'x', 'NaN')$$, 'amount');
select public.must_fail('adjustment needs an amount', $$select public.hr_payrun_adjust((public.ln('2025-06-01', 'c2')).id, 'x', null)$$, 'amount');
select public.as_user('c1');
select public.must_fail('manager cannot adjust', $$select public.hr_payrun_adjust('50000000-0000-0000-0000-000000000000', 'x', 1)$$, 'not allowed');
select public.as_user('0a');
select public.hr_payrun_recalc(public.rid('2025-06-01'));
select public.ok('recalc keeps adjustments', (public.ln('2025-06-01', 'c2')).net = 11900.56);
select public.ok('recalc picks up the fix', (public.ln('2025-06-01', 'c6')).net = 4000 and (public.ln('2025-06-01', 'c6')).blockers = '[]'::jsonb);
select public.ok('recalc removes someone now out of scope', (public.ln('2025-06-01', 'c9')).id is null);
select public.ok('recalc sets prepared_by to who recalculated', (select prepared_by = '00000000-0000-0000-0000-00000000000a' from public.hr_pay_runs where id = public.rid('2025-06-01')));
select public.ok('recalc is audited', (select count(*) = 1 from public.hr_audit_log where action = 'payrun.recalculated'));

-- ── net below zero blocks approval ──
select public.as_user('0b');
select public.hr_payrun_recalc(public.rid('2025-06-01')); -- prepared by 0b again
select public.hr_payrun_adjust((public.ln('2025-06-01', 'c3')).id, 'Too much', -6000.01);
select public.ok('net can go below zero in a draft', (public.ln('2025-06-01', 'c3')).net = -0.01);
select public.as_user('0a');
select public.must_fail('net below zero blocks approval and lists the person', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Other');
select public.as_user('0b');
select public.hr_payrun_adjust((public.ln('2025-06-01', 'c3')).id, 'Correction', 6000.01);

-- ── input_hash: anything an input changes after review fails approval, listing the employee ──
select public.as_user('0b');
select public.hr_attendance_set(public.pe('c3'), '2025-06-05', 'Absent', null, null, null);
select public.as_user('0a');
select public.must_fail('attendance changed after review fails and names the employee', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Other');
select public.must_fail('the message says to recalculate and re-review', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'recalculate');
select public.as_user('0b');
select public.must_fail('only the changed person is listed', $q$do $x$ begin perform public.hr_payrun_approve(public.rid('2025-06-01'));
  exception when others then if sqlerrm ilike '%Pay Report%' then raise exception 'listed too many'; else raise exception 'only other'; end if; end $x$$q$, 'only other');
select public.hr_attendance_set(public.pe('c3'), '2025-06-05', 'Present', null, null, null);
select public.hr_payrun_recalc(public.rid('2025-06-01'));
update public.hr_pay_details set basic = 6001 where employee_id = public.pe('c3');
select public.as_user('0a');
select public.must_fail('pay details changed after review fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Other');
select public.as_user('0b');
update public.hr_pay_details set basic = 6000 where employee_id = public.pe('c3');
update public.hr_pay_details set iban = 'AE070331234567890123000' where employee_id = public.pe('c3');
select public.as_user('0a');
select public.must_fail('IBAN changed after review fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Other');
select public.as_user('0b');
update public.hr_pay_details set iban = 'AE070331234567890123453' where employee_id = public.pe('c3');
update public.hr_settings set pay_unpaid_wage_base = 'basic'; -- fixture
select public.as_user('0a');
select public.must_fail('settings changed after review fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Report');
select public.as_user('0b');
update public.hr_settings set pay_unpaid_wage_base = 'total'; -- fixture
reset role;
insert into public.hr_leave_requests (id, employee_id, leave_type_id, from_date, to_date, days, status) values ('60000000-0000-0000-0000-000000000001', public.pe('c1'), public.ltype('PX Unpaid'), '2025-06-11', '2025-06-11', 1, 'approved');
set role authenticated;
select public.as_user('0a');
select public.must_fail('leave approved after review fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Manager');
reset role;
delete from public.hr_leave_requests where id = '60000000-0000-0000-0000-000000000001';
update public.hr_employees set exit_date = '2025-06-29' where id = public.pe('c1');
set role authenticated;
select public.must_fail('exit date changed after review fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Manager');
reset role;
update public.hr_employees set exit_date = null where id = public.pe('c1');
insert into public.hr_employees (id, employee_code, full_name, join_date, status) values (public.pe('cb'), 'P-B', 'Pay Late Hire', '2025-06-20', 'Active');
set role authenticated;
select public.must_fail('a new person in scope with no line fails, by name', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'Pay Late Hire');
reset role;
delete from public.hr_employees where id = public.pe('cb');
set role authenticated;

-- ── access before approval ──
select public.as_user('c1');
select public.ok('manager reads 0 lines before approval', (select count(*) = 0 from public.hr_pay_lines));
select public.ok('manager reads 0 runs before approval', (select count(*) = 0 from public.hr_pay_runs));
select public.ok('manager reads 0 pay details', (select count(*) = 0 from public.hr_pay_details));
select public.must_fail('manager cannot list pay details', $$select * from public.hr_pay_details_list()$$, 'not allowed');
select public.must_fail('manager cannot approve', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'not allowed');
select public.must_fail('manager cannot get gratuity', $$select public.hr_gratuity(public.pe('c2'), '2025-01-01')$$, 'not allowed');
select public.must_fail('manager cannot write pay details', $$insert into public.hr_pay_details (employee_id, effective_from, basic) values (public.pe('c2'), '2030-01-01', 1)$$, 'row-level security');
select public.as_user('c2');
select public.ok('employee reads 0 of own lines before approval', (select count(*) = 0 from public.hr_pay_lines));
select public.ok('employee reads 0 pay details, own included', (select count(*) = 0 from public.hr_pay_details));
select public.must_fail('employee cannot approve', $$select public.hr_payrun_approve('50000000-0000-0000-0000-000000000000')$$, 'not allowed');
select public.must_fail('employee cannot recalc', $$select public.hr_payrun_recalc('50000000-0000-0000-0000-000000000000')$$, 'not allowed');
select public.must_fail('employee cannot delete a run', $$select public.hr_payrun_delete('50000000-0000-0000-0000-000000000000')$$, 'not allowed');
select public.must_fail('employee cannot get gratuity', $$select public.hr_gratuity(public.pe('c2'), '2025-01-01')$$, 'not allowed');
select public.must_fail('direct line insert denied', $$insert into public.hr_pay_lines (run_id, employee_id) values ('50000000-0000-0000-0000-000000000000', public.pe('c2'))$$, 'permission denied');
select public.must_fail('direct line update denied', $$update public.hr_pay_lines set net = 1$$, 'permission denied');
select public.must_fail('direct run update denied', $$update public.hr_pay_runs set status = 'approved'$$, 'permission denied');
select public.must_fail('internal compute is closed', $$select public.hr_pay_compute('2025-06-01', public.pe('c2'))$$, 'permission denied');
select public.must_fail('hr_audit stays closed', $$select public.hr_audit('x', 'y', null, null)$$, 'permission denied');
select public.as_user('99');
select public.ok('outsider reads nothing', (select count(*) = 0 from public.hr_pay_lines) and (select count(*) = 0 from public.hr_pay_details) and (select count(*) = 0 from public.hr_pay_runs));
select public.ok('pay functions are definer, fixed search_path, closed to anon and public', (select count(*) = 7 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute')) from pg_proc where proname in ('hr_payrun_create', 'hr_payrun_adjust', 'hr_payrun_recalc', 'hr_payrun_approve', 'hr_payrun_delete', 'hr_gratuity', 'hr_pay_details_list')));

select public.ok('internal pay helpers are closed to signed-in users', (select count(*) = 8 and bool_and(not has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute')) from pg_proc where proname in ('hr_pay_money', 'hr_pay_sum', 'hr_pay_unpaid_days', 'hr_pay_working_days', 'hr_pay_require_run_settings', 'hr_pay_compute', 'hr_pay_scope', 'hr_pay_fill')));

-- ── same-person approval ──
select public.as_user('0b');
select public.hr_payrun_recalc(public.rid('2025-06-01'));
select public.must_fail('same person without acknowledgement fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'))$$, 'same person');
select public.ok('still a draft', (select status = 'draft' from public.hr_pay_runs where id = public.rid('2025-06-01')));
select public.hr_payrun_approve(public.rid('2025-06-01'), true);
select public.ok('same person with acknowledgement approves', (select status = 'approved' and approved_by = '00000000-0000-0000-0000-00000000000b' and approved_at is not null and same_person_ack from public.hr_pay_runs where id = public.rid('2025-06-01')));
select public.ok('approval is audited with the acknowledgement', (select count(*) = 1 and bool_and(new_values ->> 'same_person_ack' = 'true' and new_values ->> 'status' = 'approved') from public.hr_audit_log where action = 'payrun.approved'));

-- ── approved is locked, for everyone including the table owner ──
select public.must_fail('recalc on approved fails', $$select public.hr_payrun_recalc(public.rid('2025-06-01'))$$, 'draft');
select public.must_fail('adjust on approved fails', $$select public.hr_payrun_adjust((public.ln('2025-06-01', 'c2')).id, 'x', 1)$$, 'draft');
select public.must_fail('approve twice fails', $$select public.hr_payrun_approve(public.rid('2025-06-01'), true)$$, 'draft');
select public.must_fail('delete function on approved fails', $$select public.hr_payrun_delete(public.rid('2025-06-01'))$$, 'draft');
reset role;
select public.must_fail('owner cannot update an approved run', $$update public.hr_pay_runs set status = 'draft' where period_month = '2025-06-01'$$, 'locked');
select public.must_fail('owner cannot delete an approved run', $$delete from public.hr_pay_runs where period_month = '2025-06-01'$$, 'locked');
select public.must_fail('owner cannot update an approved line', $$update public.hr_pay_lines set net = 1 where run_id = public.rid('2025-06-01')$$, 'locked');
select public.must_fail('owner cannot delete an approved line', $$delete from public.hr_pay_lines where run_id = public.rid('2025-06-01')$$, 'locked');
select public.must_fail('owner cannot add a line to an approved run', $$insert into public.hr_pay_lines (run_id, employee_id) values (public.rid('2025-06-01'), public.pe('c8'))$$, 'locked');
select public.must_fail('owner cannot truncate lines', $$truncate public.hr_pay_lines$$, 'locked');
select public.must_fail('owner cannot truncate runs', $$truncate public.hr_pay_runs cascade$$, 'locked');
select public.must_fail('deleting an employee with a pay line is refused', $$delete from public.hr_employees where id = public.pe('c3')$$, 'foreign key');
select public.must_fail('deleting pay details an approved line used is refused', $$delete from public.hr_pay_details where employee_id = public.pe('c3')$$, 'locked');
select public.ok('the approved figures stayed', (public.ln('2025-06-01', 'c2')).net = 11900.56);
set role authenticated;

-- ── access after approval ──
select public.as_user('c2');
select public.ok('employee reads exactly own approved line', (select count(*) = 1 and bool_and(employee_id = public.pe('c2')) from public.hr_pay_lines));
select public.ok('employee reads the approved run', (select count(*) = 1 from public.hr_pay_runs));
select public.ok('employee still reads 0 pay details', (select count(*) = 0 from public.hr_pay_details));
select public.as_user('c1');
select public.ok('manager reads no report line after approval (own line only)', (select count(*) = 1 and bool_and(employee_id = public.pe('c1')) from public.hr_pay_lines));
select public.ok('manager still reads 0 pay details', (select count(*) = 0 from public.hr_pay_details));
select public.as_user('99');
select public.ok('outsider still reads nothing', (select count(*) = 0 from public.hr_pay_lines) and (select count(*) = 0 from public.hr_pay_runs));

-- ── divisor modes on a draft July 2025: 31 days, 23 weekdays, one holiday on Mon 14 July = 22 working days ──
select public.as_user('0b');
insert into public.hr_holidays (holiday_date, name) values ('2025-07-14', 'Fixture holiday');
select public.hr_attendance_set(public.pe('c2'), '2025-07-07', 'Absent', null, null, null);
select public.hr_payrun_create('2025-07-01');
-- Each component rounds on its own: working mode 1500x9/22 = 613.64, 500x9/22 = 204.55, net 818.19. fixed 30, total: joiner 11 days of 30 x 2000; absent 13000/30
select public.ok('fixed: joiner', (public.ln('2025-07-01', 'c8')).net = 733.33, (public.ln('2025-07-01', 'c8')).earnings::text);
select public.ok('fixed: a whole 31-day month is the full wage', (public.ln('2025-07-01', 'c1')).net = 10000);
select public.ok('fixed, total base: one absent day', public.amt((public.ln('2025-07-01', 'c2')).deductions, 'Unpaid days') = 433.33);
update public.hr_settings set pay_unpaid_wage_base = 'basic'; -- fixture
select public.hr_payrun_recalc(public.rid('2025-07-01'));
select public.ok('fixed, basic base: one absent day', public.amt((public.ln('2025-07-01', 'c2')).deductions, 'Unpaid days') = 300.00);
update public.hr_settings set pay_unpaid_wage_base = 'total', pay_day_divisor_mode = 'calendar_days', pay_days_basis = null; -- fixture
select public.hr_payrun_recalc(public.rid('2025-07-01'));
select public.ok('calendar: joiner 11 of 31, needs no pay_days_basis', (public.ln('2025-07-01', 'c8')).net = 709.68, (public.ln('2025-07-01', 'c8')).earnings::text);
select public.ok('calendar: one absent day', public.amt((public.ln('2025-07-01', 'c2')).deductions, 'Unpaid days') = 419.35);
update public.hr_settings set pay_day_divisor_mode = 'working_days'; -- fixture
select public.hr_payrun_recalc(public.rid('2025-07-01'));
select public.ok('working: joiner 9 of 22', (public.ln('2025-07-01', 'c8')).net = 818.19, (public.ln('2025-07-01', 'c8')).earnings::text);
select public.ok('working: one absent day', public.amt((public.ln('2025-07-01', 'c2')).deductions, 'Unpaid days') = 590.91);
update public.hr_settings set pay_day_divisor_mode = 'fixed', pay_days_basis = 30; -- fixture
select public.hr_payrun_delete(public.rid('2025-07-01'));
select public.ok('HR deletes a draft and its lines', public.rid('2025-07-01') is null and (select count(*) = 7 from public.hr_pay_lines));
select public.ok('deletion is audited', (select count(*) = 1 from public.hr_audit_log where action = 'payrun.deleted'));

-- ── different approver needs no acknowledgement; pay change inside the month carries a note ──
insert into public.hr_pay_details (employee_id, effective_from, basic, iban) values (public.pe('c3'), '2025-08-15', 6500, 'AE070331234567890123453');
select public.hr_payrun_create('2025-08-01');
select public.ok('a pay change inside the month carries a review note', (public.ln('2025-08-01', 'c3')).notes::text ilike '%changed during%review%', (public.ln('2025-08-01', 'c3')).notes::text);
select public.ok('a joiner first row is not a pay change', (public.ln('2025-06-01', 'c4')).notes::text not ilike '%changed during%');
select public.as_user('0a');
select public.hr_payrun_approve(public.rid('2025-08-01'));
select public.ok('a different approver needs no ack, and ack is stored false', (select status = 'approved' and not same_person_ack and approved_by = '00000000-0000-0000-0000-00000000000a' from public.hr_pay_runs where id = public.rid('2025-08-01')));
select public.as_user('0b');

-- ── gratuity (PAYROLL_RULES.md section F; fixtures: divisor 30, cap base basic, end date exclusive, months/12) ──
select public.must_fail('gratuity needs the fraction method', $$select public.gr('d1', '2023-01-01')$$, 'Gratuity part-year method');
update public.hr_settings set gratuity_fraction_method = 'months_12'; -- fixture
select public.must_fail('gratuity needs the cap base', $$select public.gr('d1', '2023-01-01')$$, 'Gratuity cap base');
update public.hr_settings set gratuity_cap_base = 'basic'; -- fixture
select public.must_fail('gratuity needs the daily divisor', $$select public.gr('d1', '2023-01-01')$$, 'Gratuity daily divisor');
update public.hr_settings set gratuity_daily_divisor = 30; -- fixture
select public.must_fail('gratuity needs the service end rule', $$select public.gr('d1', '2023-01-01')$$, 'Gratuity service end');
update public.hr_settings set gratuity_service_end_inclusive = false; -- fixture
select public.ok('example 1: 3 years on 5,000 = 10,500', (public.gr('d1', '2023-01-01') ->> 'amount')::numeric = 10500.00, public.gr('d1', '2023-01-01')::text);
select public.ok('the breakdown can be checked', (select (g ->> 'years')::numeric = 3 and (g ->> 'days')::numeric = 63 and (g ->> 'daily_wage')::numeric = 166.67 and (g ->> 'uncapped')::numeric = 10500 and (g ->> 'cap')::numeric = 120000 from public.gr('d1', '2023-01-01') g));
select public.ok('basic is the one effective on the exit date', (public.gr('d1', '2023-07-01') ->> 'basic')::numeric = 6000 and (public.gr('d1', '2023-05-31') ->> 'basic')::numeric = 5000);
select public.ok('example 2: 8 years on 10,000 = 65,000', (select (g ->> 'days')::numeric = 195 and (g ->> 'amount')::numeric = 65000.00 from public.gr('d2', '2023-01-01') g));
select public.ok('example 3: 30 years is capped at 240,000', (select (g ->> 'uncapped')::numeric = 285000 and (g ->> 'cap')::numeric = 240000 and (g ->> 'amount')::numeric = 240000 from public.gr('d3', '2020-01-01') g));
update public.hr_settings set gratuity_cap_base = 'total'; -- fixture
select public.ok('cap on total wage uses basic plus allowances: not capped here', (select (g ->> 'cap')::numeric = 288000 and (g ->> 'amount')::numeric = 285000 from public.gr('d3', '2020-01-01') g));
update public.hr_settings set gratuity_cap_base = 'basic'; -- fixture
select public.ok('11 months 29 days = 0', (public.gr('d4', '2024-12-30') ->> 'amount')::numeric = 0);
select public.ok('exactly 1 year = 21 days', (select (g ->> 'days')::numeric = 21 and (g ->> 'amount')::numeric = 7000 from public.gr('d4', '2025-01-01') g));
update public.hr_settings set gratuity_service_end_inclusive = true; -- fixture
select public.ok('inclusive end: exit on 31 Dec is exactly 1 year', (public.gr('d4', '2024-12-31') ->> 'amount')::numeric = 7000);
select public.ok('inclusive end: 11 months 29 days = 0', (public.gr('d4', '2024-12-29') ->> 'amount')::numeric = 0);
update public.hr_settings set gratuity_service_end_inclusive = false; -- fixture
select public.ok('part year, months/12: 5.5 years = 120 days', (select (g ->> 'days')::numeric = 120 and (g ->> 'amount')::numeric = 24000 from public.gr('d5', '2025-07-01') g));
update public.hr_settings set gratuity_fraction_method = 'days_365'; -- fixture
select public.ok('part year, days/365: 5 years 181 days', (public.gr('d5', '2025-07-01') ->> 'amount')::numeric = 23975.34, public.gr('d5', '2025-07-01')::text);
update public.hr_settings set gratuity_fraction_method = 'months_12'; -- fixture
reset role;
insert into public.hr_attendance (employee_id, work_date, status) values (public.pe('d6'), '2021-03-02', 'Absent'), (public.pe('d6'), '2021-03-03', 'Absent'), (public.pe('d7'), '2024-03-04', 'Absent');
-- Mon 8 to Wed 10 March 2021 = 3 unpaid working days; a pending request does not count
insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status) values
  (public.pe('d6'), public.ltype('PX Unpaid'), '2021-03-08', '2021-03-10', 3, 'approved'),
  (public.pe('d6'), public.ltype('PX Unpaid'), '2021-04-05', '2021-04-05', 1, 'pending');
set role authenticated;
select public.ok('unpaid absence days are out of service: 3 years 5 days less 5 days = 3 years', (select (g ->> 'excluded_unpaid_days')::numeric = 5 and (g ->> 'years')::numeric = 3 and (g ->> 'amount')::numeric = 10500 from public.gr('d6', '2023-01-06') g), public.gr('d6', '2023-01-06')::text);
select public.ok('one absent day takes exactly 1 year below the one-year line', (public.gr('d7', '2025-01-01') ->> 'amount')::numeric = 0);
select public.must_fail('gratuity with no pay details fails', $$select public.gr('d8', '2023-01-01')$$, 'pay details');
select public.must_fail('gratuity with exit before join fails', $$select public.gr('d1', '2019-01-01')$$, 'before');
select public.ok('gratuity is not added to any pay line', (select count(*) = 0 from public.hr_pay_lines where (earnings || deductions || adjustments)::text ilike '%gratuity%'));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
