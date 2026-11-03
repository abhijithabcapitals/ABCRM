-- LOCAL TEST ONLY: client-proposed edits and staff validation (002_change_requests.sql) on a throwaway cluster.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh (each test file gets its own database copy).
\set QUIET on
\pset tuples_only on
\pset format unaligned

create table public.t_result (n serial, name text, ok boolean, detail text);
create function public.ok(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into public.t_result (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;
create function public.must_fail(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.ok(p_name, false, 'no error raised');
  exception when others then
    perform public.ok(p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
  end;
end $$;
-- the request id for an account and field (the open one unless a status is given); definer so the staff role can look it up in the middle of a call
create function public.rq(p_account uuid, p_field text, p_status text default null) returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select id from public.client_portal_change_requests where account_id = p_account and field_key = p_field
     and (status = p_status or (p_status is null and status in ('pending', 'in_review'))) order by created_at desc limit 1
$$;
create function public.me_change(p_account uuid, p_field text) returns jsonb language sql stable as $$
  select c from jsonb_array_elements(public.client_portal_me(p_account) -> 'changes') c where c ->> 'field_key' = p_field
$$;
create function public.who(p_uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_uid, false) $$;
grant all on public.t_result to authenticated, anon, service_role;
grant usage on sequence public.t_result_n_seq to authenticated, anon, service_role;
grant execute on function public.ok(text, boolean, text), public.must_fail(text, text, text), public.rq(uuid, text, text), public.me_change(uuid, text),
  public.who(text) to authenticated, anon, service_role;

-- ── seed ──
-- staff: admin, S1 and S2 with the Clients tab, S3 without it
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin Person', 'admin'),
  ('00000000-0000-0000-0000-000000000001', 'Staff One', 'member'),
  ('00000000-0000-0000-0000-000000000002', 'Staff Two', 'member'),
  ('00000000-0000-0000-0000-000000000003', 'Staff Three', 'member');
insert into public.member_tab_access (profile_id, tab_key) values
  ('00000000-0000-0000-0000-000000000001', 'clients'), ('00000000-0000-0000-0000-000000000002', 'clients'),
  ('00000000-0000-0000-0000-000000000003', 'dashboard');

-- Alpha: banking client + KYC + Client Master. Beta: banking client + KYC, no master. NoKyc: banking client, no KYC row, no master.
-- Gamma: Client Master only. Rate: banking client for the daily-limit check. Empty: linked to nothing.
insert into public.banking_clients (id, display_name, license_number, client_master_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'LIC-A', 'CL000901'),
  ('b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'LIC-B', null),
  ('c0000000-0000-0000-0000-00000000000c', 'NoKyc Co', 'LIC-N', null),
  ('d0000000-0000-0000-0000-00000000000d', 'Rate Co', 'LIC-R', null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL000901', 'Alpha Trading LLC', jsonb_build_object('Client Legal Name', 'Alpha Trading LLC', 'Trade Name', 'Alpha', 'CT Registration Number', '200000000000003',
     'Financial Year End', '31/12/2026', 'Risk Level', 'Low')),
  ('CL000902', 'Gamma Master Only', jsonb_build_object('Client Legal Name', 'Gamma Master Only', 'Trade License Number', 'LIC-G', 'Trade Name', 'Gamma', 'CT Registration Number', '300000000000003',
     'License Expiry Date', '01/06/2027'));
insert into public.banking_kyc_profiles (client_id, legal_name, trade_name, license_number, license_issue_date, license_expiry_date, office_address, company_email, company_phone, source_of_funds) values
  ('a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'Alpha', 'LIC-A', '2024-01-02', '2027-01-01', 'Office 1', 'a@alpha.test', '0501', 'SECRET-SOF'),
  ('b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'Beta', 'LIC-B', null, null, null, 'b@beta.test', null, 'B-SOF'),
  ('d0000000-0000-0000-0000-00000000000d', 'Rate Co', 'Rate', 'LIC-R', null, null, null, null, null, null);
insert into public.client_portal_accounts (id, banking_client_id, display_name, username, password_hash) values
  ('aa000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'alpha.user', 'x'),
  ('bb000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'beta.user', 'x'),
  ('cc000000-0000-0000-0000-0000000000cc', 'c0000000-0000-0000-0000-00000000000c', 'NoKyc Co', 'nokyc.user', 'x'),
  ('dd000000-0000-0000-0000-0000000000dd', null, 'Gamma Master Only', 'gamma.user', 'x'),
  ('ee000000-0000-0000-0000-0000000000ee', null, 'Empty Client', 'empty.user', 'x'),
  ('ff000000-0000-0000-0000-0000000000ff', 'd0000000-0000-0000-0000-00000000000d', 'Rate Co', 'rate.user', 'x');
update public.client_portal_accounts set client_master_id = 'CL000902' where id = 'dd000000-0000-0000-0000-0000000000dd';
-- the account ids as settings t.a .. t.r
select set_config('t.a', 'aa000000-0000-0000-0000-0000000000aa', false), set_config('t.b', 'bb000000-0000-0000-0000-0000000000bb', false),
       set_config('t.n', 'cc000000-0000-0000-0000-0000000000cc', false), set_config('t.g', 'dd000000-0000-0000-0000-0000000000dd', false),
       set_config('t.e', 'ee000000-0000-0000-0000-0000000000ee', false), set_config('t.r', 'ff000000-0000-0000-0000-0000000000ff', false) as _ \gset

-- ═══ submit: validation (service role function; run here as the owner) ═══
select public.must_fail('submit: unlisted key refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'annual_turnover', '5')$$, 'cannot be changed');
select public.must_fail('submit: source_of_funds refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'source_of_funds', 'x')$$, 'cannot be changed');
select public.must_fail('submit: value equal to the official one refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', 'Alpha')$$, 'current value');
select public.must_fail('submit: equal after trimming refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', '  Alpha  ')$$, 'current value');
select public.must_fail('submit: blank refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', '   ')$$, 'cannot be empty');
select public.must_fail('submit: null refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', null)$$, 'cannot be empty');
select public.must_fail('submit: 501 characters refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', repeat('x', 501))$$, 'too long');
select public.must_fail('submit: 31/02/2026 refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'license_expiry_date', '31/02/2026')$$, 'valid date');
select public.must_fail('submit: 2026-02-31 refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'license_expiry_date', '2026-02-31')$$, 'valid date');
select public.must_fail('submit: text in a date field refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'license_expiry_date', 'soon')$$, 'valid date');
select public.must_fail('submit: date equal to official in the other format refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'license_expiry_date', '01/01/2027')$$, 'current value');
select public.must_fail('submit: full IBAN in a text field refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'office_address', 'Pay to AE070331234567890123456 please')$$, 'IBAN');
select public.must_fail('submit: IBAN with spaces and lower case refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'website', 'ae07 0331 2345 6789 0123 456')$$, 'IBAN');
select public.must_fail('submit: IBAN refused on a masterOnly field too', $$select public.client_change_submit(current_setting('t.a')::uuid, 'ct_registration_number', 'AE070331234567890123456')$$, 'IBAN');
select public.must_fail('submit: bad email refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'company_email', 'not-an-email')$$, 'email');
select public.must_fail('submit: masterOnly field, client has no master row', $$select public.client_change_submit(current_setting('t.b')::uuid, 'ct_registration_number', '123')$$, 'not on file');
select public.must_fail('submit: masterOnly date field, client has no master row', $$select public.client_change_submit(current_setting('t.b')::uuid, 'financial_year_end', '2026-12-31')$$, 'not on file');
select public.must_fail('submit: client linked to nothing refused', $$select public.client_change_submit(current_setting('t.e')::uuid, 'trade_name', 'X')$$, 'not linked');
select public.must_fail('submit: unknown account refused', $$select public.client_change_submit(gen_random_uuid(), 'trade_name', 'X')$$, 'account');
select public.ok('submit: nothing was stored by the refused calls', (select count(*) = 0 from public.client_portal_change_requests));

select public.client_change_submit(current_setting('t.a')::uuid, 'license_expiry_date', '2027-01-31') as _ \gset
select public.ok('submit: ISO date accepted and stored as ISO, old value is the official one',
  (select new_value = '2027-01-31' and old_value = '2027-01-01' and status = 'pending' from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'license_expiry_date'));
select public.client_change_submit(current_setting('t.a')::uuid, 'license_issue_date', '15/03/2023') as _ \gset
select public.ok('submit: DD/MM/YYYY stored as ISO', (select new_value = '2023-03-15' and old_value = '2024-01-02' from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'license_issue_date'));
select public.client_change_submit(current_setting('t.b')::uuid, 'website', '  www.beta.test  ') as _ \gset
select public.ok('submit: value trimmed, old value null when nothing is held', (select new_value = 'www.beta.test' and old_value is null from public.client_portal_change_requests where account_id = current_setting('t.b')::uuid and field_key = 'website'));
select public.client_change_submit(current_setting('t.b')::uuid, 'office_address', repeat('x', 500)) as _ \gset
select public.ok('submit: exactly 500 characters accepted', (select length(new_value) = 500 from public.client_portal_change_requests where account_id = current_setting('t.b')::uuid and field_key = 'office_address'));
select public.client_change_submit(current_setting('t.a')::uuid, 'ct_registration_number', '200000000000009') as _ \gset
select public.ok('submit: masterOnly accepted when a master row exists', (select old_value = '200000000000003' and new_value = '200000000000009' from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'ct_registration_number'));
select public.client_change_submit(current_setting('t.a')::uuid, 'vat_trn', '100000000000003') as rid \gset
select public.ok('submit: returns the new request id', :'rid'::uuid = public.rq(current_setting('t.a')::uuid, 'vat_trn'));

-- submit twice on one field: first superseded, one pending remains
select public.client_change_submit(current_setting('t.a')::uuid, 'company_phone', '0502') as _ \gset
select public.client_change_submit(current_setting('t.a')::uuid, 'company_phone', '0503') as _ \gset
select public.ok('submit twice: first superseded, one pending with the second value',
  (select count(*) filter (where status = 'superseded' and new_value = '0502') = 1 and count(*) filter (where status = 'pending' and new_value = '0503') = 1 and count(*) = 2
     from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'company_phone'));

-- a client's request never reaches the record
select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', 'Alpha Renamed') as _ \gset
select public.ok('pending: KYC trade_name unchanged', (select trade_name = 'Alpha' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('pending: Client Master untouched (data, version, history)',
  (select data ->> 'CT Registration Number' = '200000000000003' and data ->> 'Trade Name' = 'Alpha' and version = 1 from public.client_master where client_id = 'CL000901')
  and not exists (select 1 from public.client_master_history));
select public.ok('pending: KYC dates and phone unchanged', (select license_expiry_date = '2027-01-01' and license_issue_date = '2024-01-02' and company_phone = '0501' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('pending: me.record still official, me.changes shows the request',
  (select public.client_portal_me(current_setting('t.a')::uuid) -> 'record' ->> 'trade_name' = 'Alpha')
  and (select public.me_change(current_setting('t.a')::uuid, 'trade_name') @> '{"new_value":"Alpha Renamed","status":"pending"}'));
set role authenticated;
select public.who('00000000-0000-0000-0000-00000000000a');
select public.ok('pending: admin list counts the open requests of Alpha and Beta',
  (select (r ->> 'pending_edits')::int = 6 from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'display_name' = 'Alpha Trading LLC')
  and (select (r ->> 'pending_edits')::int = 2 from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'display_name' = 'Beta Services LLC'),
  (select string_agg((r ->> 'display_name') || '=' || (r ->> 'pending_edits'), ', ') from jsonb_array_elements(public.client_portal_admin_clients()) r));
reset role;

-- daily limit: rows older than a day do not count; 100 in the last day block the next one
insert into public.client_portal_change_requests (account_id, field_key, new_value, status, created_at)
  select current_setting('t.r')::uuid, 'trade_name', 'old ' || g, 'superseded', now() - interval '2 days' from generate_series(1, 100) g;
select public.client_change_submit(current_setting('t.r')::uuid, 'trade_name', 'Rate New') as _ \gset
select public.ok('limit: 100 requests older than a day do not block', (select count(*) = 1 from public.client_portal_change_requests where account_id = current_setting('t.r')::uuid and status = 'pending'));
insert into public.client_portal_change_requests (account_id, field_key, new_value, status)
  select current_setting('t.r')::uuid, 'trade_name', 'today ' || g, 'superseded' from generate_series(1, 98) g;
-- the 100th request today
select public.client_change_submit(current_setting('t.r')::uuid, 'website', 'rate.test') as _ \gset
select public.must_fail('limit: the 101st request in a day refused', $$select public.client_change_submit(current_setting('t.r')::uuid, 'office_address', 'Somewhere')$$, 'too many');
select public.ok('limit: another client is not affected', (select public.client_change_submit(current_setting('t.b')::uuid, 'company_phone', '0509') is not null));

-- ═══ rights ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('rights: staff cannot call client_change_submit', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', 'Zed')$$, 'permission denied');
select public.must_fail('rights: staff cannot call client_change_official', $$select public.client_change_official(current_setting('t.a')::uuid, 'trade_name')$$, 'permission denied');
select public.must_fail('rights: staff cannot call client_change_apply', $$select public.client_change_apply(current_setting('t.a')::uuid, 'trade_name', 'Zed', '00000000-0000-0000-0000-000000000001')$$, 'permission denied');
select public.must_fail('rights: table unreadable by the browser role', $$select * from public.client_portal_change_requests$$, 'permission denied');
reset role;
set role anon;
select public.must_fail('rights: anon cannot list', $$select public.client_changes_list()$$, 'permission denied');
select public.must_fail('rights: anon cannot submit', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', 'Zed')$$, 'permission denied');
reset role;
set role service_role;
select public.ok('rights: service_role can submit and read the official value', (select public.client_change_official(current_setting('t.a')::uuid, 'trade_name') = 'Alpha'));
select public.must_fail('rights: service_role cannot call the staff list (no staff session)', $$select public.client_changes_list()$$, 'permission denied');
reset role;
select public.ok('rights: no browser role holds execute on the internal helpers',
  (select not bool_or(has_function_privilege(r, p.oid, 'execute')) from pg_proc p cross join unnest(array['authenticated', 'anon']) r
    where p.pronamespace = 'public'::regnamespace and p.proname in ('client_change_submit', 'client_change_official', 'client_change_apply', 'client_change_license_taken')));
select public.ok('rights: every client_changes_ function is open to authenticated and closed to anon',
  (select count(*) = 6 and bool_and(has_function_privilege('authenticated', p.oid, 'execute')) and not bool_or(has_function_privilege('anon', p.oid, 'execute'))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'client\_changes\_%'));

-- ═══ take ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000003');
select public.must_fail('take: user without the Clients tab refused', format($$select public.client_changes_take(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'access');
select public.must_fail('list: user without the Clients tab refused', $$select public.client_changes_list()$$, 'access');
select public.must_fail('assignees: user without the Clients tab refused', $$select public.client_changes_assignees()$$, 'access');
select public.who('');
select public.must_fail('take: signed-out refused', format($$select public.client_changes_take(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'access');
select public.who('00000000-0000-0000-0000-000000000001');
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'trade_name'));
reset role;
select public.ok('take: pending goes in_review with assigned_to and assigned_at',
  (select status = 'in_review' and assigned_to = '00000000-0000-0000-0000-000000000001' and assigned_at is not null from public.client_portal_change_requests
    where account_id = current_setting('t.a')::uuid and field_key = 'trade_name'));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000002');
select public.must_fail('take: second take refused', format($$select public.client_changes_take(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'already taken');
select public.must_fail('take: unknown request refused', $$select public.client_changes_take(gen_random_uuid())$$, 'already taken');
reset role;
select public.ok('take: the first holder keeps it', (select assigned_to = '00000000-0000-0000-0000-000000000001' from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'trade_name'));
select public.must_fail('submit while in_review refused', $$select public.client_change_submit(current_setting('t.a')::uuid, 'trade_name', 'Another')$$, 'reviewing');
select public.ok('submit while in_review changed nothing', (select count(*) = 1 and bool_and(new_value = 'Alpha Renamed') from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'trade_name'));
select public.ok('in_review: record still unchanged', (select trade_name = 'Alpha' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));

-- ═══ assign ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000002');
select public.must_fail('assign: someone else''s request refused', format($$select public.client_changes_assign(%L, '00000000-0000-0000-0000-000000000002')$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'cannot be handed');
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('assign: own request to a member without the tab refused', format($$select public.client_changes_assign(%L, '00000000-0000-0000-0000-000000000003')$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'Clients tab');
select public.must_fail('assign: to nobody refused', format($$select public.client_changes_assign(%L, gen_random_uuid())$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'Clients tab');
select public.must_fail('assign: without a target refused', format($$select public.client_changes_assign(%L, null)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'Clients tab');
select public.client_changes_assign(public.rq(current_setting('t.a')::uuid, 'trade_name'), '00000000-0000-0000-0000-000000000002');
reset role;
select public.ok('assign: own request handed to a member with the tab', (select status = 'in_review' and assigned_to = '00000000-0000-0000-0000-000000000002' from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'trade_name'));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
-- an unassigned (pending) request: ct_registration_number
select public.client_changes_assign(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'), '00000000-0000-0000-0000-000000000002');
reset role;
select public.ok('assign: unassigned request handed to a colleague goes in_review', (select status = 'in_review' and assigned_to = '00000000-0000-0000-0000-000000000002' and assigned_at is not null from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'ct_registration_number')));
set role authenticated;
select public.who('00000000-0000-0000-0000-00000000000a');
select public.client_changes_assign(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'), '00000000-0000-0000-0000-000000000001');
reset role;
select public.ok('assign: an admin may move anyone''s request, also to another admin', (select assigned_to = '00000000-0000-0000-0000-000000000001' from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'ct_registration_number')));
set role authenticated;
select public.client_changes_assign(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'), '00000000-0000-0000-0000-00000000000a');
reset role;
select public.ok('assign: an admin counts as a member with the tab', (select assigned_to = '00000000-0000-0000-0000-00000000000a' from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'ct_registration_number')));

-- ═══ release ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('release: other non-admin refused', format($$select public.client_changes_release(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'assigned to');
select public.who('00000000-0000-0000-0000-000000000003');
select public.must_fail('release: user without the tab refused', format($$select public.client_changes_release(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'access');
select public.who('00000000-0000-0000-0000-000000000002');
select public.client_changes_release(public.rq(current_setting('t.a')::uuid, 'trade_name'));
reset role;
select public.ok('release: the assignee returns it to pending, assignment cleared', (select status = 'pending' and assigned_to is null and assigned_at is null from public.client_portal_change_requests where account_id = current_setting('t.a')::uuid and field_key = 'trade_name'));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('release: a pending request cannot be released', format($$select public.client_changes_release(%L)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'assigned to');
select public.who('00000000-0000-0000-0000-00000000000a');
select public.client_changes_release(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'));
reset role;
select public.ok('release: an admin can release anyone''s', (select status = 'pending' and assigned_to is null from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'ct_registration_number')));

-- ═══ list and assignees ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.ok('list: every documented key on every row',
  (select jsonb_array_length(l) > 0 and (select bool_and(r ?& array['id', 'client', 'field_key', 'old_value', 'new_value', 'official_value', 'stale', 'status', 'assignee', 'assigned_to',
        'can_decide', 'created_at', 'reviewer', 'reviewed_at', 'review_note', 'license_conflict']) from jsonb_array_elements(l) r) from (select public.client_changes_list() l) x));
select public.ok('list: superseded requests are not listed', (select not exists (select 1 from jsonb_array_elements(public.client_changes_list()) r where r ->> 'status' = 'superseded')));
select public.ok('list: client name, official value, not stale',
  (select r ->> 'client' = 'Alpha Trading LLC' and r ->> 'official_value' = 'Alpha' and r ->> 'old_value' = 'Alpha' and (r ->> 'stale')::boolean = false and r ->> 'new_value' = 'Alpha Renamed'
     from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'trade_name' and r ->> 'client' = 'Alpha Trading LLC'));
select public.client_changes_take(public.rq(current_setting('t.b')::uuid, 'website'));
select public.ok('list: can_decide true for my own in_review request, assignee name shown, false for a pending one',
  (select (r ->> 'can_decide')::boolean and r ->> 'assignee' = 'Staff One' and r ->> 'assigned_to' = '00000000-0000-0000-0000-000000000001'
     from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'website' and r ->> 'client' = 'Beta Services LLC')
  and (select not (r ->> 'can_decide')::boolean from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'trade_name' and r ->> 'client' = 'Alpha Trading LLC'));
select public.who('00000000-0000-0000-0000-000000000002');
select public.ok('list: can_decide false for someone else''s in_review request',
  (select not (r ->> 'can_decide')::boolean from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'website' and r ->> 'client' = 'Beta Services LLC'));
select public.who('00000000-0000-0000-0000-00000000000a');
select public.ok('list: can_decide true for an admin on an in_review request',
  (select (r ->> 'can_decide')::boolean from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'website' and r ->> 'client' = 'Beta Services LLC'));
select public.ok('assignees: members with the tab and admins, not others, sorted by name',
  (select a = '[{"id":"00000000-0000-0000-0000-00000000000a","full_name":"Admin Person"},{"id":"00000000-0000-0000-0000-000000000001","full_name":"Staff One"},{"id":"00000000-0000-0000-0000-000000000002","full_name":"Staff Two"}]'::jsonb
     from (select public.client_changes_assignees() a) x), (select public.client_changes_assignees()::text));
reset role;

-- ═══ decide: refusals and rejection ═══
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000002');
select public.must_fail('decide: non-assignee non-admin refused', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.b')::uuid, 'website')), 'assigned to');
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('decide: a request nobody has taken refused', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.a')::uuid, 'trade_name')), 'Take');
select public.must_fail('decide: unknown decision refused', format($$select public.client_changes_decide(%L, 'maybe', null)$$, public.rq(current_setting('t.b')::uuid, 'website')), 'Unknown decision');
select public.must_fail('decide: rejection with a blank note refused', format($$select public.client_changes_decide(%L, 'rejected', '   ')$$, public.rq(current_setting('t.b')::uuid, 'website')), 'reason');
select public.must_fail('decide: rejection with no note refused', format($$select public.client_changes_decide(%L, 'rejected', null)$$, public.rq(current_setting('t.b')::uuid, 'website')), 'reason');
reset role;
select public.ok('decide: refused calls changed nothing', (select status = 'in_review' and reviewed_by is null from public.client_portal_change_requests where account_id = current_setting('t.b')::uuid and field_key = 'website'));
set role authenticated;
select public.client_changes_decide(public.rq(current_setting('t.b')::uuid, 'website'), 'rejected', '  Please send the licence  ');
reset role;
select public.ok('reject: status rejected, reviewer and time set, note trimmed',
  (select status = 'rejected' and reviewed_by = '00000000-0000-0000-0000-000000000001' and reviewed_at is not null and review_note = 'Please send the licence'
     from public.client_portal_change_requests where account_id = current_setting('t.b')::uuid and field_key = 'website'));
select public.ok('reject: record unchanged', (select website is null from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'));
select public.ok('reject: the note is visible in me.changes', (select public.me_change(current_setting('t.b')::uuid, 'website') @> '{"status":"rejected","review_note":"Please send the licence","new_value":"www.beta.test"}'));
select public.ok('reject: audit row written', (select count(*) = 1 from public.admin_audit where action = 'client_change_rejected' and actor = '00000000-0000-0000-0000-000000000001'));
select public.client_change_submit(current_setting('t.b')::uuid, 'website', 'www.beta2.test') as _ \gset
select public.ok('reject: the client can submit the field again', (select status = 'pending' from public.client_portal_change_requests where id = public.rq(current_setting('t.b')::uuid, 'website')));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('decide: an already rejected request refused', format($$select public.client_changes_decide(%L, 'validated', null)$$,
  public.rq(current_setting('t.b')::uuid, 'website', 'rejected')), 'already been decided');
select public.must_fail('decide: a superseded request refused', format($$select public.client_changes_decide(%L, 'rejected', 'x')$$,
  public.rq(current_setting('t.a')::uuid, 'company_phone', 'superseded')), 'already been decided');
reset role;

-- ═══ validate: KYC field ═══
-- Beta: legal_structure (KYC percent must rise), Alpha: trade_name was handed back to pending above
select public.client_change_submit(current_setting('t.b')::uuid, 'legal_structure', 'LLC') as _ \gset
select (select completion_percent from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b') as pct_before \gset
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.client_changes_take(public.rq(current_setting('t.b')::uuid, 'legal_structure'));
select public.client_changes_decide(public.rq(current_setting('t.b')::uuid, 'legal_structure'), 'validated', 'ok');
reset role;
select public.ok('validate KYC: value written', (select legal_structure = 'LLC' from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'));
select public.ok('validate KYC: status validated, reviewer, time and note set',
  (select status = 'validated' and reviewed_by = '00000000-0000-0000-0000-000000000001' and reviewed_at is not null and review_note = 'ok'
     from public.client_portal_change_requests where account_id = current_setting('t.b')::uuid and field_key = 'legal_structure'));
select public.ok('validate KYC: completion_percent recalculated', (select completion_percent > :pct_before from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'),
  (select completion_percent || ' vs ' || :pct_before from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'));
select public.ok('validate KYC: admin_audit row with the actor and the request id',
  (select count(*) = 1 from public.admin_audit a join public.client_portal_change_requests r on a.target = r.id::text
    where a.action = 'client_change_validated' and a.actor = '00000000-0000-0000-0000-000000000001' and r.field_key = 'legal_structure' and a.detail ->> 'field_key' = 'legal_structure'));
select public.ok('validate KYC: other KYC fields and other clients untouched',
  (select legal_name = 'Beta Services LLC' and source_of_funds = 'B-SOF' from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b')
  and (select legal_structure is null and trade_name = 'Alpha' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('validate KYC: me.record shows the new value', (select public.client_portal_me(current_setting('t.b')::uuid) -> 'record' ->> 'legal_structure' = 'LLC'));
select public.ok('validate KYC: the field is closed so a new request can be made', (select public.client_change_submit(current_setting('t.b')::uuid, 'legal_structure', 'Sole proprietorship') is not null));

-- date field into a date column
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'license_expiry_date'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'license_expiry_date'), 'validated', null);
reset role;
select public.ok('validate KYC date: stored as a date', (select license_expiry_date = date '2027-01-31' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('validate KYC date: Client Master of that client not touched', (select version = 1 and data ->> 'License Expiry Date' is null from public.client_master where client_id = 'CL000901'));

-- licence number: KYC and banking_clients
select public.client_change_submit(current_setting('t.a')::uuid, 'license_number', 'LIC-A-NEW') as _ \gset
set role authenticated;
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'license_number'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'license_number'), 'validated', null);
reset role;
select public.ok('validate license_number: banking_kyc_profiles updated', (select license_number = 'LIC-A-NEW' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('validate license_number: banking_clients updated', (select license_number = 'LIC-A-NEW' from public.banking_clients where id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('validate license_number: other clients keep theirs', (select license_number = 'LIC-B' from public.banking_clients where id = 'b0000000-0000-0000-0000-00000000000b'));

-- ═══ validate: Client Master field ═══
set role authenticated;
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'ct_registration_number'), 'validated', null);
reset role;
select public.ok('validate master: data updated', (select data ->> 'CT Registration Number' = '200000000000009' from public.client_master where client_id = 'CL000901'));
select public.ok('validate master: version + 1, other keys intact', (select version = 2 and data ->> 'Trade Name' = 'Alpha' and data ->> 'Risk Level' = 'Low' and legal_name = 'Alpha Trading LLC' from public.client_master where client_id = 'CL000901'));
select public.ok('validate master: history row with field, old value, new value and the actor',
  (select count(*) = 1 from public.client_master_history where client_id = 'CL000901' and action = 'Updated' and field = 'CT Registration Number'
      and old_value = '200000000000003' and new_value = '200000000000009' and changed_by = '00000000-0000-0000-0000-000000000001'));
select public.ok('validate master: KYC untouched by a masterOnly field', (select trade_name = 'Alpha' and completion_percent >= 0 from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
-- master date: format must be the one fmtUae writes and parseUaeDate reads (DD/MM/YYYY)
select public.client_change_submit(current_setting('t.a')::uuid, 'financial_year_end', '2027-12-31') as _ \gset
set role authenticated;
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'financial_year_end'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'financial_year_end'), 'validated', null);
reset role;
select public.ok('validate master date: written as DD/MM/YYYY', (select data ->> 'Financial Year End' = '31/12/2027' from public.client_master where client_id = 'CL000901'));
select public.ok('validate master date: reads back as a real date in that format (parseUaeDate shape)',
  (select v ~ '^\d{2}/\d{2}/\d{4}$' and to_char(to_date(v, 'DD/MM/YYYY'), 'DD/MM/YYYY') = v and to_date(v, 'DD/MM/YYYY') = date '2027-12-31'
     from (select data ->> 'Financial Year End' v from public.client_master where client_id = 'CL000901') x));
select public.ok('validate master date: history row has the old and new text', (select count(*) = 1 from public.client_master_history where field = 'Financial Year End' and old_value = '31/12/2026' and new_value = '31/12/2027'));
select public.ok('validate master date: the official value reads in ISO for comparison', (select public.client_change_official(current_setting('t.a')::uuid, 'financial_year_end') = '2027-12-31'));

-- ═══ master-only account ═══
select public.client_change_submit(current_setting('t.g')::uuid, 'legal_name', 'Gamma Renamed LLC') as _ \gset
select public.client_change_submit(current_setting('t.g')::uuid, 'trade_name', 'Gamma Two') as _ \gset
select public.client_change_submit(current_setting('t.g')::uuid, 'license_number', 'LIC-G2') as _ \gset
select public.client_change_submit(current_setting('t.g')::uuid, 'license_expiry_date', '20/09/2028') as _ \gset
select public.client_change_submit(current_setting('t.g')::uuid, 'ct_registration_number', '300000000000009') as _ \gset
select public.ok('master-only: official value read from the master (date as ISO)',
  (select public.client_change_official(current_setting('t.g')::uuid, 'license_expiry_date') = '2027-06-01' and public.client_change_official(current_setting('t.g')::uuid, 'trade_name') = 'Gamma'));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000002');
select public.client_changes_take(public.rq(current_setting('t.g')::uuid, 'legal_name'));
select public.client_changes_decide(public.rq(current_setting('t.g')::uuid, 'legal_name'), 'validated', null);
select public.client_changes_take(public.rq(current_setting('t.g')::uuid, 'trade_name'));
select public.client_changes_decide(public.rq(current_setting('t.g')::uuid, 'trade_name'), 'validated', null);
select public.client_changes_take(public.rq(current_setting('t.g')::uuid, 'license_number'));
select public.client_changes_decide(public.rq(current_setting('t.g')::uuid, 'license_number'), 'validated', null);
select public.client_changes_take(public.rq(current_setting('t.g')::uuid, 'license_expiry_date'));
select public.client_changes_decide(public.rq(current_setting('t.g')::uuid, 'license_expiry_date'), 'validated', null);
reset role;
select public.ok('master-only legal_name: data "Client Legal Name" and the legal_name column both written',
  (select data ->> 'Client Legal Name' = 'Gamma Renamed LLC' and legal_name = 'Gamma Renamed LLC' from public.client_master where client_id = 'CL000902'));
select public.ok('master-only: trade name and licence number go to their master keys', (select data ->> 'Trade Name' = 'Gamma Two' and data ->> 'Trade License Number' = 'LIC-G2' from public.client_master where client_id = 'CL000902'));
select public.ok('master-only: licence expiry written as DD/MM/YYYY', (select data ->> 'License Expiry Date' = '20/09/2028' from public.client_master where client_id = 'CL000902'));
select public.ok('master-only: version bumped once per change, one history row per change', (select version = 5 from public.client_master where client_id = 'CL000902')
  and (select count(*) = 4 from public.client_master_history where client_id = 'CL000902'));
select public.ok('master-only: legal_name history keeps the old value', (select old_value = 'Gamma Master Only' and new_value = 'Gamma Renamed LLC' from public.client_master_history where client_id = 'CL000902' and field = 'Client Legal Name'));
select public.ok('master-only: nothing created in KYC or banking_clients', (select count(*) = 3 from public.banking_kyc_profiles) and (select count(*) = 4 from public.banking_clients));
select public.ok('master-only: me.record shows the new legal name', (select public.client_portal_me(current_setting('t.g')::uuid) -> 'record' ->> 'legal_name' = 'Gamma Renamed LLC'));

-- ═══ linked client without a KYC row: one is inserted ═══
select public.client_change_submit(current_setting('t.n')::uuid, 'trade_name', 'NoKyc Trading') as _ \gset
select public.client_change_submit(current_setting('t.n')::uuid, 'license_number', 'LIC-N2') as _ \gset
select public.ok('no KYC row: nothing inserted before validation', (select count(*) = 0 from public.banking_kyc_profiles where client_id = 'c0000000-0000-0000-0000-00000000000c'));
select public.ok('no KYC row: licence number official value falls back to banking_clients', (select public.client_change_official(current_setting('t.n')::uuid, 'license_number') = 'LIC-N'));
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.client_changes_take(public.rq(current_setting('t.n')::uuid, 'trade_name'));
select public.client_changes_decide(public.rq(current_setting('t.n')::uuid, 'trade_name'), 'validated', null);
select public.client_changes_take(public.rq(current_setting('t.n')::uuid, 'license_number'));
select public.client_changes_decide(public.rq(current_setting('t.n')::uuid, 'license_number'), 'validated', null);
reset role;
select public.ok('no KYC row: a row is inserted with the value, the percent calculated',
  (select count(*) = 1 and bool_and(trade_name = 'NoKyc Trading' and license_number = 'LIC-N2' and completion_percent > 0) from public.banking_kyc_profiles where client_id = 'c0000000-0000-0000-0000-00000000000c'));
select public.ok('no KYC row: banking_clients licence updated too', (select license_number = 'LIC-N2' from public.banking_clients where id = 'c0000000-0000-0000-0000-00000000000c'));

-- ═══ stale ═══
select public.client_change_submit(current_setting('t.a')::uuid, 'office_address', 'Office 2') as _ \gset
update public.banking_kyc_profiles set office_address = 'Office 9' where client_id = 'a0000000-0000-0000-0000-00000000000a';
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.ok('stale: list flags it and shows the current official value ',
  (select (r ->> 'stale')::boolean and r ->> 'official_value' = 'Office 9' and r ->> 'old_value' = 'Office 1'
     from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'office_address' and r ->> 'client' = 'Alpha Trading LLC'));
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'office_address'));
select public.must_fail('stale: validation refused without force', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.a')::uuid, 'office_address')), 'changed since');
select public.must_fail('stale: validation refused with force false', format($$select public.client_changes_decide(%L, 'validated', null, false)$$, public.rq(current_setting('t.a')::uuid, 'office_address')), 'changed since');
reset role;
select public.ok('stale: refusal left record and request as they were', (select office_address = 'Office 9' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a')
  and (select status = 'in_review' from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'office_address')));
set role authenticated;
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'office_address'), 'validated', null, true);
reset role;
select public.ok('stale: with force the value is written', (select office_address = 'Office 2' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
select public.ok('stale: the audit row records that it was forced', (select count(*) = 1 from public.admin_audit where action = 'client_change_validated' and (detail ->> 'forced')::boolean));
-- a stale request can still be rejected without force
select public.client_change_submit(current_setting('t.a')::uuid, 'registered_address', 'Reg 2') as _ \gset
update public.banking_kyc_profiles set registered_address = 'Reg 9' where client_id = 'a0000000-0000-0000-0000-00000000000a';
set role authenticated;
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'registered_address'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'registered_address'), 'rejected', 'Not matching the licence');
reset role;
select public.ok('stale: rejection needs no force and leaves the newer value', (select registered_address = 'Reg 9' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a'));
-- a master field that changed too
select public.client_change_submit(current_setting('t.g')::uuid, 'website', 'gamma.test') as _ \gset
update public.client_master set data = data || '{"Website": "other.test"}' where client_id = 'CL000902';
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000002');
select public.client_changes_take(public.rq(current_setting('t.g')::uuid, 'website'));
select public.must_fail('stale: master value changed since, refused', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.g')::uuid, 'website')), 'changed since');
reset role;
-- an official value that was empty at submit and still is: not stale
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.ok('stale: empty at submit and still empty is not stale', (select not (r ->> 'stale')::boolean from jsonb_array_elements(public.client_changes_list()) r
   where r ->> 'field_key' = 'company_phone' and r ->> 'client' = 'Beta Services LLC'));
select public.client_changes_take(public.rq(current_setting('t.b')::uuid, 'company_phone'));
select public.client_changes_decide(public.rq(current_setting('t.b')::uuid, 'company_phone'), 'validated', null);
reset role;
select public.ok('stale: ... and validates without force', (select company_phone = '0509' from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'));

-- ═══ a closed case does not block a KYC change ═══
insert into public.banking_cases (id, case_ref, client_id, current_stage, outcome, is_historical, account_kind)
  values ('c2000000-0000-0000-0000-000000000001', 'T-CLOSED', 'b0000000-0000-0000-0000-00000000000b', 17, 'Approved', false, 'Business');
set banking.internal = '1';
update public.banking_cases set accounts_status = 'Closed' where id = 'c2000000-0000-0000-0000-000000000001';
reset banking.internal;
select public.must_fail('closed case: the case itself is locked (premise of the next check)', $$update public.banking_cases set is_historical = false where id = 'c2000000-0000-0000-0000-000000000001'$$, 'closed');
select public.client_change_submit(current_setting('t.b')::uuid, 'business_activity', 'Trading') as _ \gset
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.client_changes_take(public.rq(current_setting('t.b')::uuid, 'business_activity'));
select public.client_changes_decide(public.rq(current_setting('t.b')::uuid, 'business_activity'), 'validated', null);
reset role;
select public.ok('closed case: the KYC field was still validated', (select business_activity = 'Trading' from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b'));

-- ═══ decide on an already validated request ═══
set role authenticated;
select public.must_fail('decide: an already validated request refused', format($$select public.client_changes_decide(%L, 'validated', null)$$,
  public.rq(current_setting('t.b')::uuid, 'business_activity', 'validated')), 'already been decided');
select public.must_fail('decide: an already validated request cannot be rejected either', format($$select public.client_changes_decide(%L, 'rejected', 'late')$$,
  public.rq(current_setting('t.b')::uuid, 'business_activity', 'validated')), 'already been decided');
select public.must_fail('take: a decided request cannot be taken', format($$select public.client_changes_take(%L)$$,
  public.rq(current_setting('t.b')::uuid, 'business_activity', 'validated')), 'already taken');
reset role;
select public.ok('decide: the validated request is unchanged by those attempts', (select status = 'validated' and review_note is null and business_activity is not null
  from public.client_portal_change_requests r, public.banking_kyc_profiles k where r.account_id = current_setting('t.b')::uuid and r.field_key = 'business_activity' and k.client_id = 'b0000000-0000-0000-0000-00000000000b'));

-- ═══ one account cannot read or act on another's requests ═══
select public.client_change_submit(current_setting('t.a')::uuid, 'website', 'alpha-only.test') as _ \gset
select public.ok('isolation: the other account sees none of it in me.changes',
  (select not (public.client_portal_me(current_setting('t.b')::uuid) -> 'changes')::text like '%alpha-only%' and not (public.client_portal_me(current_setting('t.e')::uuid) -> 'changes')::text like '%alpha-only%'));
select public.ok('isolation: an account with no requests has an empty list', (select public.client_portal_me(current_setting('t.e')::uuid) -> 'changes' = '[]'::jsonb));
-- same field open on both accounts: acting on one never touches the other
select public.client_change_submit(current_setting('t.b')::uuid, 'website', 'beta-only.test') as _ \gset
select public.client_change_submit(current_setting('t.a')::uuid, 'website', 'alpha-two.test') as _ \gset
select public.ok('isolation: a new request from A superseded only A''s own earlier one',
  (select count(*) filter (where account_id = current_setting('t.a')::uuid and status = 'pending') = 1
      and count(*) filter (where account_id = current_setting('t.a')::uuid and status = 'superseded' and field_key = 'website' and new_value = 'alpha-only.test') = 1
      and count(*) filter (where account_id = current_setting('t.b')::uuid and status = 'pending' and field_key = 'website' and new_value = 'beta-only.test') = 1
     from public.client_portal_change_requests where field_key = 'website' and new_value in ('alpha-only.test', 'alpha-two.test', 'beta-only.test')));
select public.ok('isolation: the official value is read for the account asked about only',
  (select public.client_change_official(current_setting('t.a')::uuid, 'legal_name') = 'Alpha Trading LLC' and public.client_change_official(current_setting('t.b')::uuid, 'legal_name') = 'Beta Services LLC'
      and public.client_change_official(current_setting('t.e')::uuid, 'legal_name') is null));
select public.ok('isolation: submit never writes the record, only a request', (select count(*) = 0 from public.client_master_history where new_value in ('alpha-two.test', 'beta-only.test')));

-- ═══ IBAN backstop: a request that got past submit (seeded directly) is refused at decide, in KYC and master ═══
insert into public.client_portal_change_requests (account_id, field_key, old_value, new_value, status, assigned_to, assigned_at) values
  (current_setting('t.b')::uuid, 'registered_address', null, 'AE070331234567890123456', 'in_review', '00000000-0000-0000-0000-000000000001', now()),
  (current_setting('t.g')::uuid, 'office_address', null, 'AE070331234567890123456', 'in_review', '00000000-0000-0000-0000-000000000001', now());
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.must_fail('IBAN backstop: KYC value refused at decide', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.b')::uuid, 'registered_address')), 'IBAN');
select public.must_fail('IBAN backstop: master value refused at decide', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.g')::uuid, 'office_address')), 'IBAN');
reset role;
select public.ok('IBAN backstop: nothing written, requests still in_review',
  (select registered_address is null from public.banking_kyc_profiles where client_id = 'b0000000-0000-0000-0000-00000000000b')
  and (select not (data::text ~* 'AE[0-9]{21}') from public.client_master where client_id = 'CL000902')
  and (select count(*) = 2 from public.client_portal_change_requests where status = 'in_review' and new_value like 'AE07%'));

-- ═══ licence number held by another banking client ═══
select public.client_change_submit(current_setting('t.a')::uuid, 'license_number', ' lic-b ') as _ \gset
select (select count(*) from public.admin_audit where action = 'client_change_validated') as audit_before \gset
set role authenticated;
select public.who('00000000-0000-0000-0000-000000000001');
select public.ok('licence conflict: the list flags it, whatever the case or spaces',
  (select (r ->> 'license_conflict')::boolean from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'license_number' and r ->> 'client' = 'Alpha Trading LLC' and r ->> 'status' = 'pending'));
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'license_number'));
select public.must_fail('licence conflict: validation refused with a clear message', format($$select public.client_changes_decide(%L, 'validated', null)$$, public.rq(current_setting('t.a')::uuid, 'license_number')), 'already holds licence number lic-b');
select public.must_fail('licence conflict: force does not get past it', format($$select public.client_changes_decide(%L, 'validated', null, true)$$, public.rq(current_setting('t.a')::uuid, 'license_number')), 'already holds');
reset role;
select public.ok('licence conflict: nothing written, request still in_review, no audit row',
  (select license_number = 'LIC-A-NEW' from public.banking_kyc_profiles where client_id = 'a0000000-0000-0000-0000-00000000000a')
  and (select license_number = 'LIC-A-NEW' from public.banking_clients where id = 'a0000000-0000-0000-0000-00000000000a')
  and (select license_number = 'LIC-B' from public.banking_clients where id = 'b0000000-0000-0000-0000-00000000000b')
  and (select status = 'in_review' and reviewed_by is null from public.client_portal_change_requests where id = public.rq(current_setting('t.a')::uuid, 'license_number'))
  and (select count(*) = :audit_before from public.admin_audit where action = 'client_change_validated'));
set role authenticated;
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'license_number'), 'rejected', 'Held by another client');
reset role;
select public.client_change_submit(current_setting('t.a')::uuid, 'license_number', 'lic-a-new') as _ \gset
set role authenticated;
select public.ok('licence conflict: the client''s own number in another case is not a conflict',
  (select not (r ->> 'license_conflict')::boolean from jsonb_array_elements(public.client_changes_list()) r where r ->> 'field_key' = 'license_number' and r ->> 'client' = 'Alpha Trading LLC' and r ->> 'status' = 'pending'));
select public.client_changes_take(public.rq(current_setting('t.a')::uuid, 'license_number'));
select public.client_changes_decide(public.rq(current_setting('t.a')::uuid, 'license_number'), 'validated', null);
reset role;
select public.ok('licence conflict: ... and it validates', (select license_number = 'lic-a-new' from public.banking_clients where id = 'a0000000-0000-0000-0000-00000000000a'));
set role authenticated;
select public.ok('licence conflict: a decided request is not flagged, even though the number is still held',
  (select count(*) = 1 and bool_and(not (r ->> 'license_conflict')::boolean) from jsonb_array_elements(public.client_changes_list()) r
    where r ->> 'field_key' = 'license_number' and r ->> 'client' = 'Alpha Trading LLC' and r ->> 'status' = 'rejected'));
reset role;

-- ═══ audit trail: Admin Base 003 records what validation changes, with who did it ═══
select public.ok('audit trail: the change requests table has the audit trigger',
  (select exists (select 1 from pg_trigger where tgrelid = 'public.client_portal_change_requests'::regclass and tgname = 'audit_trail_row')));
select public.ok('audit trail: a validation is logged on the request and on the record, with the staff member',
  (select exists (select 1 from public.audit_trail where table_name = 'client_portal_change_requests' and action = 'UPDATE' and actor = '00000000-0000-0000-0000-000000000001' and new_values ->> 'status' = 'validated'))
  and (select exists (select 1 from public.audit_trail where table_name = 'banking_clients' and action = 'UPDATE' and actor = '00000000-0000-0000-0000-000000000001' and new_values ->> 'license_number' = 'lic-a-new')));
select public.ok('audit trail: a refused validation left no entry for the refused value',
  (select not exists (select 1 from public.audit_trail where table_name = 'banking_clients' and new_values ->> 'license_number' = 'lic-b')));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
