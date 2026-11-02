-- LOCAL TEST ONLY: leave rules, settings and approvals. Runs after 010 on the same cluster (reuses its helpers).
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

truncate public.t_result;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Leave Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000a2', 'Leave Report', 'member'),
  ('00000000-0000-0000-0000-0000000000a3', 'Leave Loner', 'member'),
  ('00000000-0000-0000-0000-0000000000a4', 'Leave HR Member', 'member'),
  ('00000000-0000-0000-0000-0000000000a5', 'Leave Admin', 'admin');
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-0000000000a4');
insert into public.hr_employees (id, employee_code, full_name, profile_id, manager_id) values
  ('20000000-0000-0000-0000-0000000000a1', 'L-M', 'Leave Manager', '00000000-0000-0000-0000-0000000000a1', null),
  ('20000000-0000-0000-0000-0000000000a2', 'L-R', 'Leave Report', '00000000-0000-0000-0000-0000000000a2', '20000000-0000-0000-0000-0000000000a1'),
  ('20000000-0000-0000-0000-0000000000a3', 'L-L', 'Leave Loner', '00000000-0000-0000-0000-0000000000a3', null),
  ('20000000-0000-0000-0000-0000000000a4', 'L-H', 'Leave HR Member', '00000000-0000-0000-0000-0000000000a4', null),
  ('20000000-0000-0000-0000-0000000000a5', 'L-A', 'Leave Admin', '00000000-0000-0000-0000-0000000000a5', null);

create table public.t_ids (label text primary key, id uuid);
grant all on public.t_ids to authenticated;
create function public.tid(p_label text) returns uuid language sql as $$ select id from public.t_ids where label = p_label $$;
create function public.ltype(p_name text) returns uuid language sql as $$ select id from public.hr_leave_types where name = p_name $$;
-- Files a request and remembers its row ids as label#1, label#2 ...; returns the function result.
create function public.t_req(p_label text, p_emp text, p_type text, p_from date, p_to date) returns jsonb language plpgsql as $$
declare r jsonb; i int := 0; x text;
begin
  r := public.hr_leave_request(('20000000-0000-0000-0000-0000000000' || p_emp)::uuid, public.ltype(p_type), p_from, p_to, null);
  for x in select jsonb_array_elements_text(r -> 'ids') loop
    i := i + 1;
    insert into public.t_ids values (p_label || '#' || i, x::uuid);
  end loop;
  return r;
end $$;
grant execute on function public.tid(text), public.ltype(text), public.t_req(text, text, text, date, date) to authenticated;

-- ── defaults: no statutory values, one settings row ──
select public.ok('leave types start empty', (select count(*) = 0 from public.hr_leave_types));
select public.ok('settings has one row, weekend 0 and 6, pay days basis null', (select count(*) = 1 and bool_and(weekend_days = '{0,6}' and pay_days_basis is null) from public.hr_settings));

set role authenticated;

-- ── HR configures ──
select public.as_user('0b');
insert into public.hr_leave_types (name, paid, annual_days) values ('Annual', true, 30), ('Unpaid', false, null), ('Short', true, 2);
insert into public.hr_holidays (holiday_date, name) values ('2026-11-04', 'Test holiday');
select public.ok('hr_leave_days skips weekends and holidays (Mon-Fri with Wed holiday)', public.hr_leave_days('2026-11-02', '2026-11-06') = 4);
select public.ok('hr_leave_days over a full week', public.hr_leave_days('2026-11-02', '2026-11-08') = 4);
select public.ok('weekend only is 0 days', public.hr_leave_days('2026-11-07', '2026-11-08') = 0);
select public.must_fail('reversed range fails', $$select public.hr_leave_days('2026-11-08', '2026-11-02')$$, 'before');
update public.hr_settings set weekend_days = '{5,6}';
select public.ok('configured weekend is used', public.hr_leave_days('2026-11-06', '2026-11-07') = 0 and public.hr_leave_days('2026-11-08', '2026-11-08') = 1);
update public.hr_settings set weekend_days = '{0,6}';
select public.must_fail('invalid weekend day rejected', $$update public.hr_settings set weekend_days = '{7}'$$, 'check');
select public.must_fail('second settings row rejected', $$insert into public.hr_settings (id) values (2)$$, 'permission denied');
select public.must_fail('settings row cannot be deleted', $$delete from public.hr_settings$$, 'permission denied');
select public.ok('HR can set pay days basis', (select true from (select 1) x where exists (select 1 from public.hr_settings)));
update public.hr_settings set pay_days_basis = 30;
update public.hr_settings set pay_days_basis = null;

-- ── non-HR cannot configure, but employees can read ──
select public.as_user('a2');
update public.hr_settings set pay_days_basis = 99;
select public.must_fail('employee cannot add a holiday', $$insert into public.hr_holidays (holiday_date, name) values ('2026-12-25', 'x')$$, 'row-level security');
select public.must_fail('employee cannot add a leave type', $$insert into public.hr_leave_types (name) values ('X')$$, 'row-level security');
select public.ok('employee reads leave types and holidays and settings', (select count(*) = 3 from public.hr_leave_types) and (select count(*) = 1 from public.hr_holidays) and (select count(*) = 1 from public.hr_settings));
select public.as_user('0b');
select public.ok('employee settings update changed nothing', (select pay_days_basis is null from public.hr_settings));
select public.as_user('99');
select public.ok('outsider reads no leave configuration', (select count(*) = 0 from public.hr_leave_types) and (select count(*) = 0 from public.hr_settings));

-- ── requests ──
select public.as_user('a2');
select public.must_fail('direct insert into requests denied', $$insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days) values ('20000000-0000-0000-0000-0000000000a2', public.ltype('Annual'), '2026-11-02', '2026-11-03', 2)$$, 'permission denied');
select public.ok('employee requests own leave, one row, no warning', (select jsonb_array_length(r -> 'ids') = 1 and (r ->> 'warning') is null from (select public.t_req('r1', 'a2', 'Annual', '2026-11-02', '2026-11-06') r) q));
select public.ok('request row holds 4 working days, pending', (select days = 4 and status = 'pending' from public.hr_leave_requests where id = public.tid('r1#1')));
select public.must_fail('employee cannot request for someone else', $$select public.t_req('x', 'a3', 'Annual', '2026-11-09', '2026-11-10')$$, 'yourself');
select public.must_fail('overlap with an open request fails', $$select public.t_req('x', 'a2', 'Annual', '2026-11-06', '2026-11-09')$$, 'overlap');
select public.must_fail('no working days fails', $$select public.t_req('x', 'a2', 'Annual', '2026-11-07', '2026-11-08')$$, 'no working days');
select public.must_fail('self-approval fails', format($$select public.hr_leave_decide(%L, true, null)$$, public.tid('r1#1')), 'own');

select public.as_user('a3');
select public.ok('loner requests', (select jsonb_array_length(public.t_req('l1', 'a3', 'Annual', '2026-11-09', '2026-11-10') -> 'ids') = 1));
select public.ok('loner sees only own request', (select count(*) = 1 from public.hr_leave_requests));

select public.as_user('a1');
select public.ok('manager sees report request only', (select count(*) = 1 and bool_and(employee_id = '20000000-0000-0000-0000-0000000000a2') from public.hr_leave_requests));
select public.must_fail('manager cannot approve another employee', format($$select public.hr_leave_decide(%L, true, null)$$, public.tid('l1#1')), 'not allowed');
select public.hr_leave_decide(public.tid('r1#1'), true, 'ok');
select public.ok('manager approved report', (select status = 'approved' and approver is not null and decided_at is not null from public.hr_leave_requests where id = public.tid('r1#1')));
select public.must_fail('deciding twice fails', format($$select public.hr_leave_decide(%L, false, null)$$, public.tid('r1#1')), 'pending');
select public.must_fail('manager cannot cancel', format($$select public.hr_leave_cancel(%L)$$, public.tid('r1#1')), 'not allowed');
select public.must_fail('manager cannot request for report', $$select public.t_req('x', 'a2', 'Annual', '2026-12-01', '2026-12-02')$$, 'yourself');
select public.ok('manager reads report balance', (select used = 4 and remaining = 26 from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026) where leave_type = 'Annual'));
select public.must_fail('manager cannot read non-report balance', $$select * from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a3', 2026)$$, 'not allowed');

select public.as_user('a3');
select public.must_fail('other employee cannot cancel', format($$select public.hr_leave_cancel(%L)$$, public.tid('r1#1')), 'not allowed');
select public.must_fail('employee cannot read another balance', $$select * from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026)$$, 'not allowed');

select public.as_user('0b'); -- approved leave already started: only HR can cancel it (008)
select public.hr_leave_cancel(public.tid('r1#1'));
select public.as_user('a2');
select public.ok('cancelling approved restores balance', (select used = 0 and remaining = 30 from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026) where leave_type = 'Annual'));
select public.must_fail('cancelling twice fails', format($$select public.hr_leave_cancel(%L)$$, public.tid('r1#1')), 'cannot be cancelled');
select public.ok('cancelled request no longer blocks overlap', (select jsonb_array_length(public.t_req('r2', 'a2', 'Annual', '2026-11-02', '2026-11-03') -> 'ids') = 1));

-- ── HR decisions and audit ──
select public.as_user('0b');
select public.hr_leave_decide(public.tid('l1#1'), true, null);
select public.ok('no-manager employee approved by HR', (select status = 'approved' from public.hr_leave_requests where id = public.tid('l1#1')));
select public.hr_leave_decide(public.tid('r2#1'), false, 'no');
select public.ok('rejection stored', (select status = 'rejected' and decision_note = 'no' from public.hr_leave_requests where id = public.tid('r2#1')));
select public.must_fail('rejected request cannot be cancelled', format($$select public.hr_leave_cancel(%L)$$, public.tid('r2#1')), 'cannot be cancelled');
select public.ok('decisions and cancel are audited', (select count(*) filter (where action = 'leave.approved') >= 2 and count(*) filter (where action = 'leave.rejected') = 1 and count(*) filter (where action = 'leave.cancelled') = 1 and bool_and(actor is not null) from public.hr_audit_log where action like 'leave.%'));

-- ── year-end split, warnings, unpaid ──
select public.ok('request across year end splits into one row per year', (select jsonb_array_length(public.t_req('y', 'a2', 'Annual', '2026-12-30', '2027-01-02') -> 'ids') = 2));
select public.ok('split rows hold each year working days', (select (select days from public.hr_leave_requests where id = public.tid('y#1')) = 2 and (select days from public.hr_leave_requests where id = public.tid('y#2')) = 1 and (select from_date from public.hr_leave_requests where id = public.tid('y#2')) = date '2027-01-01'));

select public.as_user('a2');
select public.ok('new pending requests for dashboard', (select jsonb_array_length(public.t_req('r3', 'a2', 'Annual', '2026-11-16', '2026-11-17') -> 'ids') = 1));
select public.as_user('a3');
select public.ok('loner second request', (select jsonb_array_length(public.t_req('l2', 'a3', 'Annual', '2026-11-23', '2026-11-23') -> 'ids') = 1));

-- pending now: r3, l2, y#1, y#2
select public.as_user('0b');
select public.ok('HR dashboard pending leave counts all', (public.hr_dashboard() ->> 'pending_leave')::int = 4);
select public.as_user('a1');
select public.ok('manager dashboard pending counts reports only', (public.hr_dashboard() ->> 'pending_leave')::int = 3);
select public.as_user('a2');
select public.ok('employee dashboard pending counts own', (public.hr_dashboard() ->> 'pending_leave')::int = 3);
select public.as_user('a3');
select public.ok('loner dashboard pending counts own', (public.hr_dashboard() ->> 'pending_leave')::int = 1);
select public.as_user('99');
select public.ok('outsider dashboard pending is 0', (public.hr_dashboard() ->> 'pending_leave')::int = 0);

select public.as_user('a2');
select public.ok('low paid balance warns and does not block', (select (r ->> 'warning') is not null and jsonb_array_length(r -> 'ids') = 1 from (select public.t_req('s', 'a2', 'Short', '2026-11-18', '2026-11-20') r) q));
select public.ok('unpaid has no balance limit and no warning', (select (r ->> 'warning') is null and jsonb_array_length(r -> 'ids') = 1 from (select public.t_req('u', 'a2', 'Unpaid', '2026-12-01', '2026-12-11') r) q));
select public.hr_leave_cancel(public.tid('r3#1'));
select public.ok('employee cancels own pending', (select status = 'cancelled' from public.hr_leave_requests where id = public.tid('r3#1')));

-- ── balances ──
select public.as_user('0b');
insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitlement, adjustment) values ('20000000-0000-0000-0000-0000000000a2', public.ltype('Annual'), 2027, 5, 1);
select public.ok('balance row overrides the type default', (select entitlement = 5 and adjustment = 1 and remaining = 6 from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2027) where leave_type = 'Annual'));
select public.ok('no balance row falls back to type annual days', (select entitlement = 2 from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026) where leave_type = 'Short'));
select public.ok('unpaid balance has no limit', (select remaining is null from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026) where leave_type = 'Unpaid'));
select public.as_user('a2');
select public.must_fail('employee cannot write balances', $$insert into public.hr_leave_balances (employee_id, leave_type_id, year, entitlement) values ('20000000-0000-0000-0000-0000000000a2', public.ltype('Annual'), 2028, 99)$$, 'row-level security');
select public.ok('employee reads own balances rows only', (select count(*) = 1 from public.hr_leave_balances));
select public.as_user('99');
select public.must_fail('outsider cannot request', $$select public.t_req('x', 'a2', 'Annual', '2027-03-01', '2027-03-02')$$, 'yourself');
select public.must_fail('outsider cannot read balance', $$select * from public.hr_leave_balance('20000000-0000-0000-0000-0000000000a2', 2026)$$, 'not allowed');

-- ── HR-list member and admin with linked employee rows cannot decide their own leave ──
select public.as_user('a4');
select public.ok('HR member with employee row files own leave', (select jsonb_array_length(public.t_req('h1', 'a4', 'Annual', '2027-03-01', '2027-03-02') -> 'ids') = 1));
select public.must_fail('HR member cannot approve own leave', format($$select public.hr_leave_decide(%L, true, null)$$, public.tid('h1#1')), 'own');
select public.must_fail('HR member cannot reject own leave', format($$select public.hr_leave_decide(%L, false, null)$$, public.tid('h1#1')), 'own');
select public.as_user('a5');
select public.ok('admin with employee row files own leave', (select jsonb_array_length(public.t_req('h2', 'a5', 'Annual', '2027-03-08', '2027-03-09') -> 'ids') = 1));
select public.must_fail('admin cannot approve own leave', format($$select public.hr_leave_decide(%L, true, null)$$, public.tid('h2#1')), 'own');
select public.as_user('0b');
select public.hr_leave_decide(public.tid('h1#1'), true, null);
select public.ok('another HR member can approve the HR member leave', (select status = 'approved' from public.hr_leave_requests where id = public.tid('h1#1')));
select public.as_user('a4');
select public.hr_leave_decide(public.tid('h2#1'), true, null);
select public.ok('HR member can approve the admin leave', (select status = 'approved' from public.hr_leave_requests where id = public.tid('h2#1')));

reset role;
select public.ok('leave tables have RLS on', (select bool_and(relrowsecurity) from pg_class where oid in ('public.hr_settings'::regclass, 'public.hr_holidays'::regclass, 'public.hr_leave_types'::regclass, 'public.hr_leave_balances'::regclass, 'public.hr_leave_requests'::regclass)));
select public.ok('leave functions are security definer, fixed search_path, closed to anon and public', (select count(*) = 6 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute')) from pg_proc where proname in ('hr_leave_days', 'hr_leave_request', 'hr_leave_decide', 'hr_leave_cancel', 'hr_leave_balance', 'hr_dashboard')));
select public.ok('requests table has no write grant for authenticated', not has_table_privilege('authenticated', 'public.hr_leave_requests', 'insert') and not has_table_privilege('authenticated', 'public.hr_leave_requests', 'update') and not has_table_privilege('authenticated', 'public.hr_leave_requests', 'delete'));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
