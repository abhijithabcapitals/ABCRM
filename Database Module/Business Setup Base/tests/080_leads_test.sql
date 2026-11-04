-- LOCAL TEST ONLY: leads, sharing the client link, lost cases and ownership (restructure Task 2). Run through tests/run-local.sh, after 010 and 070.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create temp table f80 (k text primary key, v text);
grant all on f80 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f80 where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql as $$ select v::uuid from f80 where k = p_k $$;
create function pg_temp.stage(p_k text) returns text language sql as $$ select stage from public.business_setup_cases where id = pg_temp.cid(p_k) $$;
create function pg_temp.owner(p_k text) returns uuid language sql as $$ select owner_id from public.business_setup_cases where id = pg_temp.cid(p_k) $$;
-- A client with a portal login (active unless told otherwise) and, when asked, KYC done.
create function pg_temp.mkclient(p_client text, p_login boolean default true, p_kyc_done boolean default false, p_active boolean default true) returns void language plpgsql as $$
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  if p_login then
    insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status)
    values (p_client, p_client, lower(p_client), 'x', case when p_active then 'active' else 'revoked' end) on conflict do nothing;
  end if;
  if p_kyc_done then
    insert into public.business_setup_kyc_profiles (client_id, kyc_state) values (p_client, 'Done') on conflict (client_id) do update set kyc_state = 'Done';
  end if;
end $$;
-- A case straight into the table, as the owner of the table.
create function pg_temp.mkcase(p_key text, p_client text, p_stage text, p_owner uuid default null) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into public.business_setup_cases (client_id, stage, lead_name, owner_id) values (p_client, p_stage, coalesce(p_client, p_key), p_owner) returning id into c;
  insert into f80 values (p_key, c::text);
  return c;
end $$;
create function pg_temp.mkquote(p_key text, p_num text, p_client text, p_case uuid, p_status text default 'issued') returns uuid language plpgsql as $$
declare q uuid := gen_random_uuid();
begin
  insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  values (q, q, 'quote', 'Business Setup', p_client, p_client, p_num, 1000, p_status, p_case);
  insert into f80 values (p_key, q::text);
  return q;
end $$;
create function pg_temp.login_status(p_client text) returns text language sql security definer as $$ select status from public.client_portal_accounts where client_master_id = p_client $$;
create function pg_temp.accounts(p_client text) returns bigint language sql security definer as $$ select count(*) from public.client_portal_accounts where client_master_id = p_client $$;
-- Portal documents are closed to staff by row access; the test reads them as the table owner.
create function pg_temp.pdocs() returns setof public.client_portal_documents language sql security definer as $$ select * from public.client_portal_documents $$;
create function pg_temp.acct(p_client text) returns uuid language sql security definer as $$ select id from public.client_portal_accounts where client_master_id = p_client $$;
create function pg_temp.forms(p_client text) returns bigint language sql as $$ select count(*) from public.business_setup_onboarding_forms where client_id = p_client $$;
create function pg_temp.hq(p_extra jsonb) returns public.hub_documents language sql as $$
  select public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'client_name', 'Case Quote LLC', 'contact_name', 'C', 'contact_email', 'c@x.ae', 'contact_phone', '1', 'client_address', 'Dubai',
    'lines', '[{"description":"Licence","amount":100}]'::jsonb) || p_extra)
$$;
select public.bs_as(null);

-- ── Privileges (the function grants are checked in 010, before its blanket grant) ──
select public.bs_check('reassign requests are readable, not writable', has_table_privilege('authenticated', 'public.business_setup_reassign_requests', 'select')
  and not has_table_privilege('authenticated', 'public.business_setup_reassign_requests', 'insert'));

-- ── case_needs_name, and a lead entered by the team ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select business_setup_case_new('{"lead_name":"   "}')$$, 'Enter the lead name');
select public.bs_expect_error($$select business_setup_case_new('{"phone":"050"}')$$, 'Enter the lead name');
select public.bs_expect_error($$select business_setup_case_new('{"lead_name":"X","client_id":"CL989999"}')$$, 'Unknown client');
insert into f80 values ('lead', public.business_setup_case_new('{"lead_name":"Alpha Trading","contact_person":"Ali","phone":"0501234567","email":"ali@alpha.test","source":"Walk-in","notes":"asked about a licence"}')::text);
select public.bs_check('a new lead starts at Lead with its details', (select stage = 'Lead' and lead_name = 'Alpha Trading' and contact_person = 'Ali' and phone = '0501234567'
  and email = 'ali@alpha.test' and source = 'Walk-in' and notes = 'asked about a licence' and client_id is null and owner_id is null from public.business_setup_cases where id = pg_temp.cid('lead')));
select public.bs_check('the new lead is audited', public.bs_audit_count('case_new', pg_temp.fx('lead'), '{}') = 1);

-- ── returning_client ──
select public.bs_as(null);
select pg_temp.mkclient('CL980001', false, true);
select pg_temp.mkclient('CL980002', false, false);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('ret', public.business_setup_case_new('{"lead_name":"Returning","client_id":"CL980001"}')::text);
insert into f80 values ('new_kyc', public.business_setup_case_new('{"lead_name":"Not yet","client_id":"CL980002"}')::text);
select public.bs_check('returning_client: KYC Done starts at Services', pg_temp.stage('ret') = 'Services' and (select client_id from public.business_setup_cases where id = pg_temp.cid('ret')) = 'CL980001');
select public.bs_check('a client with KYC not done starts at Lead', pg_temp.stage('new_kyc') = 'Lead');

-- ── take_race ──
select public.business_setup_case_take(pg_temp.cid('lead'));
select public.bs_check('taking sets the owner', pg_temp.owner('lead') = '00000000-0000-0000-0000-00000000000c');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_case_take('%s')$$, pg_temp.fx('lead')), 'Sales');
select public.bs_check('take_race: the first taker keeps the case', pg_temp.owner('lead') = '00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_case_take('%s')$$, gen_random_uuid()), 'not found');
select public.bs_as(null);
select pg_temp.mkcase('closed_c', null, 'Lost');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_case_take('%s')$$, pg_temp.fx('closed_c')), 'closed');

-- ── Taking a case at Assignment starts the service ──
select public.bs_as(null);
select pg_temp.mkcase('asg_take', null, 'Assignment');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.business_setup_case_take(pg_temp.cid('asg_take'));
select public.bs_check('taking at Assignment moves to In service', pg_temp.stage('asg_take') = 'In service' and pg_temp.owner('asg_take') = '00000000-0000-0000-0000-00000000000d');

-- ── link_client: creates, retries, duplicates, existing ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('link creates the client from the lead fields', (select public.business_setup_case_link_client(pg_temp.cid('lead'))) ~ '^CL[0-9]{6}$');
insert into f80 values ('lead_client', (select client_id from public.business_setup_cases where id = pg_temp.cid('lead')));
select public.bs_check('the new client holds the lead contact', (select client_master_plain(data ->> 'General Email') = 'ali@alpha.test' and client_master_plain(data ->> 'General Phone') = '0501234567'
  and legal_name = 'Alpha Trading' from public.client_master where client_id = pg_temp.fx('lead_client')));
select public.bs_check('link_retry: a second call returns the same client', public.business_setup_case_link_client(pg_temp.cid('lead')) = pg_temp.fx('lead_client')
  and (select count(*) from public.client_master where legal_name = 'Alpha Trading') = 1);
insert into f80 values ('dup', public.business_setup_case_new('{"lead_name":"Alpha Trading","email":"ali@alpha.test"}')::text);
select public.bs_expect_error(format($$select business_setup_case_link_client('%s')$$, pg_temp.fx('dup')), 'already exists');
select public.bs_expect_error(format($$select business_setup_case_link_client('%s')$$, pg_temp.fx('dup')), pg_temp.fx('lead_client'));
select public.bs_check('a refused duplicate leaves the case unlinked', (select client_id is null from public.business_setup_cases where id = pg_temp.cid('dup')));
select public.bs_check('an allowed duplicate makes a new client', public.business_setup_case_link_client(pg_temp.cid('dup'), null, true) <> pg_temp.fx('lead_client'));
select public.bs_expect_error(format($$select business_setup_case_link_client('%s', 'CL989999')$$, pg_temp.fx('lead')), 'already linked');
insert into f80 values ('lnk', public.business_setup_case_new('{"lead_name":"Link me"}')::text);
select public.bs_expect_error(format($$select business_setup_case_link_client('%s', 'CL989999')$$, pg_temp.fx('lnk')), 'Unknown client');
select public.bs_check('an existing client can be linked', public.business_setup_case_link_client(pg_temp.cid('lnk'), 'CL980002') = 'CL980002');
select public.bs_check('the link is stored on the case', (select client_id from public.business_setup_cases where id = pg_temp.cid('lnk')) = 'CL980002');

-- ── share_needs_login ──
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('lnk')), 'login');
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('new_kyc')), 'login');
insert into f80 values ('noclient', public.business_setup_case_new('{"lead_name":"No client yet"}')::text);
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('noclient')), 'client');
select public.bs_as(null);
select pg_temp.mkclient('CL980003', true, false, false);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('revoked', public.business_setup_case_new('{"lead_name":"Revoked login","client_id":"CL980003"}')::text);
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('revoked')), 'login');
select public.bs_check('a refused share leaves the stage', pg_temp.stage('revoked') = 'Lead' and pg_temp.forms('CL980003') = 0);

-- ── share_existing_login_reused ──
select public.bs_as(null);
select pg_temp.mkclient('CL980004', true, false);
select public.business_setup_form_create('CL980004', (select id from public.client_portal_accounts where client_master_id = 'CL980004'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('shared', public.business_setup_case_new('{"lead_name":"Shared","client_id":"CL980004"}')::text);
select public.business_setup_case_shared(pg_temp.cid('shared'));
select public.bs_check('share_existing_login_reused: the form is attached, not duplicated', pg_temp.forms('CL980004') = 1
  and pg_temp.accounts('CL980004') = 1
  and (select case_id from public.business_setup_onboarding_forms where client_id = 'CL980004') = pg_temp.cid('shared'));
select public.bs_check('sharing moves Lead to Contact', pg_temp.stage('shared') = 'Contact');
select public.business_setup_case_shared(pg_temp.cid('shared'));
select public.bs_check('sharing again changes nothing', pg_temp.stage('shared') = 'Contact' and pg_temp.forms('CL980004') = 1);
-- a login with no form yet gets one
select public.bs_as(null);
select pg_temp.mkclient('CL980005', true, false);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('shared2', public.business_setup_case_new('{"lead_name":"Shared two","client_id":"CL980005"}')::text);
select public.business_setup_case_shared(pg_temp.cid('shared2'));
select public.bs_check('a login with no form gets one, on the case', pg_temp.forms('CL980005') = 1
  and (select case_id from public.business_setup_onboarding_forms where client_id = 'CL980005') = pg_temp.cid('shared2') and pg_temp.stage('shared2') = 'Contact');
-- KYC done: no form, straight to Services
select public.bs_as(null);
select pg_temp.mkclient('CL980006', true, true);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('shared3', public.business_setup_case_new('{"lead_name":"Shared three"}')::text);
select public.business_setup_case_link_client(pg_temp.cid('shared3'), 'CL980006');
select public.business_setup_case_shared(pg_temp.cid('shared3'));
select public.bs_check('KYC done: shared goes to Services with no form', pg_temp.stage('shared3') = 'Services' and pg_temp.forms('CL980006') = 0);
-- a form already on another case
insert into f80 values ('shared4', public.business_setup_case_new('{"lead_name":"Second case","client_id":"CL980004"}')::text);
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('shared4')), 'open form');
-- a submitted form puts a new Lead straight into Review
select public.bs_as(null);
select pg_temp.mkclient('CL980007', true, false);
select public.business_setup_form_create('CL980007', (select id from public.client_portal_accounts where client_master_id = 'CL980007'));
update public.business_setup_onboarding_forms set status = 'Submitted' where client_id = 'CL980007';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('shared5', public.business_setup_case_new('{"lead_name":"Already submitted","client_id":"CL980007"}')::text);
select public.business_setup_case_shared(pg_temp.cid('shared5'));
select public.bs_check('an already submitted form puts the case in Review', pg_temp.stage('shared5') = 'Review');

-- ── lost: reason, paid, stage ──
select public.bs_as(null);
select pg_temp.mkclient('CL980010', true, false);
select pg_temp.mkcase('lost_paid', 'CL980010', 'Contact', '00000000-0000-0000-0000-00000000000c');
insert into public.business_setup_payments (client_id, paid_on, amount, type, case_id) values ('CL980010', current_date, 250, 'Payment', pg_temp.cid('lost_paid'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_case_lost('%s', 'Changed mind')$$, pg_temp.fx('lost_paid')), 'net payment');
select public.bs_expect_error(format($$select business_setup_case_lost('%s', '  ')$$, pg_temp.fx('lead')), 'reason');
select public.bs_check('lost_blocked_paid: the case stays open and the login active', pg_temp.stage('lost_paid') = 'Contact' and pg_temp.login_status('CL980010') = 'active');
select public.bs_as(null);
select pg_temp.mkcase('lost_svc_stage', null, 'In service');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_case_lost('%s', 'Too late')$$, pg_temp.fx('lost_svc_stage')), 'in service');
select public.bs_as(null);
-- a refunded payment no longer blocks
insert into public.business_setup_payments (client_id, paid_on, amount, type, reverses_id, case_id)
  select client_id, current_date, amount, 'Reversal', id, case_id from public.business_setup_payments where case_id = pg_temp.cid('lost_paid') and type = 'Payment';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_case_lost(pg_temp.cid('lost_paid'), 'Went elsewhere');
select public.bs_check('a refunded case can be lost', pg_temp.stage('lost_paid') = 'Lost' and (select lost_reason from public.business_setup_cases where id = pg_temp.cid('lost_paid')) = 'Went elsewhere');
select public.bs_check('lost_revokes: the login goes inactive', pg_temp.login_status('CL980010') = 'revoked');
select public.bs_check('the lost case is audited', public.bs_audit_count('case_stage', pg_temp.fx('lost_paid'), '{"stage":"Lost"}') = 1);
select public.bs_expect_error(format($$select business_setup_case_lost('%s', 'Again')$$, pg_temp.fx('lost_paid')), 'closed');

-- ── lost_keeps_login ──
select public.bs_as(null);
select pg_temp.mkclient('CL980011', true, false);
select pg_temp.mkcase('keep_a1', 'CL980011', 'Lead');
select pg_temp.mkcase('keep_a2', 'CL980011', 'Documentation');
select pg_temp.mkclient('CL980012', true, false);
select pg_temp.mkcase('keep_b', 'CL980012', 'Lead');
insert into public.business_setup_services (client_id, name, status) values ('CL980012', 'Imported work', 'In progress');
select pg_temp.mkclient('CL980013', true, false);
select pg_temp.mkcase('keep_c', 'CL980013', 'Lead');
insert into public.banking_clients (display_name, client_type, client_master_id) values ('Banking side', 'Company', 'CL980013');
insert into public.banking_cases (client_id) select id from public.banking_clients where client_master_id = 'CL980013';
select pg_temp.mkclient('CL980014', true, false);
select pg_temp.mkcase('keep_d', 'CL980014', 'Lead');
select pg_temp.mkcase('keep_d_done', 'CL980014', 'Completed');
insert into public.business_setup_services (client_id, name, status) values ('CL980014', 'Finished work', 'Completed');
insert into public.banking_clients (display_name, client_type, client_master_id) values ('Banking closed', 'Company', 'CL980014');
insert into public.banking_cases (client_id, outcome) select id, 'Closed' from public.banking_clients where client_master_id = 'CL980014';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_case_lost(pg_temp.cid('keep_a1'), 'Not now');
select public.bs_check('lost_keeps_login: another open case keeps it', pg_temp.login_status('CL980011') = 'active');
select public.business_setup_case_lost(pg_temp.cid('keep_b'), 'Not now');
select public.bs_check('lost_keeps_login: an active service keeps it', pg_temp.login_status('CL980012') = 'active');
select public.business_setup_case_lost(pg_temp.cid('keep_c'), 'Not now');
select public.bs_check('lost_keeps_login: a Banking case keeps it', pg_temp.login_status('CL980013') = 'active');
select public.business_setup_case_lost(pg_temp.cid('keep_d'), 'Not now');
select public.bs_check('finished cases, services and Banking cases do not keep it', pg_temp.login_status('CL980014') = 'revoked');

-- ── confirm ──
select public.bs_as(null);
select pg_temp.mkcase('conf', null, 'Assignment', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('conf2', null, 'Assignment', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('conf_none', null, 'Assignment');
select pg_temp.mkcase('conf_early', null, 'Documentation', '00000000-0000-0000-0000-00000000000c');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_case_confirm('%s')$$, pg_temp.fx('conf')), 'owner');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_case_confirm(pg_temp.cid('conf'));
select public.bs_check('the owner confirms: Assignment to In service', pg_temp.stage('conf') = 'In service');
select public.bs_expect_error(format($$select business_setup_case_confirm('%s')$$, pg_temp.fx('conf')), 'Assignment');
select public.bs_expect_error(format($$select business_setup_case_confirm('%s')$$, pg_temp.fx('conf_early')), 'Assignment');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_case_confirm(pg_temp.cid('conf2'));
select public.bs_check('an approver confirms for the owner', pg_temp.stage('conf2') = 'In service' and pg_temp.owner('conf2') = '00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_case_confirm('%s')$$, pg_temp.fx('conf_none')), 'owner');

-- ── reassign ──
select public.bs_as(null);
select pg_temp.mkcase('re', null, 'In service', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('re_mgr', null, 'In service', '00000000-0000-0000-0000-00000000000b');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-00000000000d', 'I want it')$$, pg_temp.fx('re')), 'owner');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-00000000000c', 'x')$$, pg_temp.fx('re')), 'already');
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-0000000000f0', 'x')$$, pg_temp.fx('re')), 'not found');
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-00000000000d', ' ')$$, pg_temp.fx('re')), 'reason');
insert into f80 values ('req', public.business_setup_reassign_request(pg_temp.cid('re'), '00000000-0000-0000-0000-00000000000d', 'Away next week')::text);
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-00000000000e', 'again')$$, pg_temp.fx('re')), 'waiting');
select public.bs_check('reassign: the request shows on the case list', (select (e -> 'reassign' ->> 'id') = pg_temp.fx('req') and e -> 'reassign' ->> 'to_name' = 'Docs'
  from jsonb_array_elements(public.business_setup_case_list('all')) e where e ->> 'id' = pg_temp.fx('re')));
select public.bs_expect_error(format($$select business_setup_reassign_respond('%s', true, null)$$, pg_temp.fx('req')), 'permission');
select public.bs_check('a request does not move the owner', pg_temp.owner('re') = '00000000-0000-0000-0000-00000000000c');
-- the owner cannot approve their own request, even as an approver
select public.bs_as('00000000-0000-0000-0000-00000000000b');
insert into f80 values ('req_mgr', public.business_setup_reassign_request(pg_temp.cid('re_mgr'), '00000000-0000-0000-0000-00000000000d', 'Handing over')::text);
select public.bs_expect_error(format($$select business_setup_reassign_respond('%s', true, null)$$, pg_temp.fx('req_mgr')), 'own request');
-- another approver decides
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_reassign_respond(pg_temp.cid('req_mgr'), true, 'Fine');
select public.bs_check('an approver approves: the owner changes', pg_temp.owner('re_mgr') = '00000000-0000-0000-0000-00000000000d'
  and (select status = 'Approved' and responded_by = '00000000-0000-0000-0000-00000000000a' and response_note = 'Fine' from public.business_setup_reassign_requests where id = pg_temp.cid('req_mgr')));
select public.bs_expect_error(format($$select business_setup_reassign_respond('%s', true, null)$$, pg_temp.fx('req_mgr')), 'no longer');
select public.business_setup_reassign_respond(pg_temp.cid('req'), false, 'Stay with Sales');
select public.bs_check('a refusal keeps the owner and frees the case for a new request', pg_temp.owner('re') = '00000000-0000-0000-0000-00000000000c'
  and (select status from public.business_setup_reassign_requests where id = pg_temp.cid('req')) = 'Refused');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('req2', public.business_setup_reassign_request(pg_temp.cid('re'), '00000000-0000-0000-0000-00000000000e', 'Try again')::text);
select public.bs_check('one pending request per case, by index', (select count(*) from public.business_setup_reassign_requests where case_id = pg_temp.cid('re') and status = 'Pending') = 1);
-- a request on a case that has since closed cannot be approved
select public.bs_as(null);
select pg_temp.mkcase('re_closed', null, 'In service', '00000000-0000-0000-0000-00000000000c');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('req_closed', public.business_setup_reassign_request(pg_temp.cid('re_closed'), '00000000-0000-0000-0000-00000000000d', 'Away')::text);
select public.bs_as(null);
update public.business_setup_cases set stage = 'Lost' where id = pg_temp.cid('re_closed');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select business_setup_reassign_respond('%s', true, null)$$, pg_temp.fx('req_closed')), 'closed');
select public.bs_check('the closed case keeps its owner', pg_temp.owner('re_closed') = '00000000-0000-0000-0000-00000000000c');
select public.bs_as(null);
select pg_temp.mkcase('re_done', null, 'In service', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('re_canc', null, 'In service', '00000000-0000-0000-0000-00000000000c');
insert into public.business_setup_reassign_requests (case_id, from_user, to_user, reason, created_by) values
  (pg_temp.cid('re_done'), '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', 'x', '00000000-0000-0000-0000-00000000000c'),
  (pg_temp.cid('re_canc'), '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d', 'x', '00000000-0000-0000-0000-00000000000c');
update public.business_setup_cases set stage = 'Completed' where id = pg_temp.cid('re_done');
update public.business_setup_cases set stage = 'Cancelled' where id = pg_temp.cid('re_canc');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select business_setup_reassign_respond((select id from business_setup_reassign_requests where case_id = '%s'), true, null)$$, pg_temp.fx('re_done')), 'closed');
select public.bs_expect_error(format($$select business_setup_reassign_respond((select id from business_setup_reassign_requests where case_id = '%s'), true, null)$$, pg_temp.fx('re_canc')), 'closed');
select public.bs_check('Completed and Cancelled cases keep their owner', pg_temp.owner('re_done') = '00000000-0000-0000-0000-00000000000c' and pg_temp.owner('re_canc') = '00000000-0000-0000-0000-00000000000c');
-- direct change by an approver
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_case_assign('%s', '00000000-0000-0000-0000-00000000000d', 'mine')$$, pg_temp.fx('re')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_case_assign('%s', '00000000-0000-0000-0000-0000000000f0', 'n')$$, pg_temp.fx('re')), 'not found');
select public.business_setup_case_assign(pg_temp.cid('re'), '00000000-0000-0000-0000-00000000000d', 'Cover while Sales is away');
select public.bs_check('reassign: an approver changes the owner directly', pg_temp.owner('re') = '00000000-0000-0000-0000-00000000000d');
select public.bs_check('the direct change is recorded', public.bs_audit_count('case_assign', pg_temp.fx('re'), '{"owner_id":"00000000-0000-0000-0000-00000000000d","note":"Cover while Sales is away"}') = 1);
select public.bs_check('a direct change closes the pending request', (select status from public.business_setup_reassign_requests where id = pg_temp.cid('req2')) = 'Cancelled');
select public.bs_as(null);
select pg_temp.mkcase('asg_unowned', null, 'Assignment');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_case_assign(pg_temp.cid('asg_unowned'), '00000000-0000-0000-0000-00000000000c', null);
select public.bs_check('assigning at Assignment sets the owner and leaves the stage for them to confirm', pg_temp.owner('asg_unowned') = '00000000-0000-0000-0000-00000000000c' and pg_temp.stage('asg_unowned') = 'Assignment');

-- ── staff_completes_form ──
select public.bs_as(null);
select pg_temp.mkclient('CL980020', true, false);
select public.business_setup_form_create('CL980020', (select id from public.client_portal_accounts where client_master_id = 'CL980020'));
update public.business_setup_onboarding_forms set status = 'In review', taken_by = '00000000-0000-0000-0000-00000000000d',
  answers = '{"client_name":"Zed Co","phone":"","email":"z@z.ae","services":["Company registration"],"company_status":"New","activity":"Trading","partners":[{"name":"Pat","nationality":"India"}]}'
 where client_id = 'CL980020';
insert into f80 select 'sform', id::text from public.business_setup_onboarding_forms where client_id = 'CL980020';
select public.bs_check('the form is missing phone and documents', public.business_setup_form_missing_items(pg_temp.cid('sform'), true) = array['Phone', 'Passport', 'Address proof']);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_form_staff_save('%s', '[1]')$$, pg_temp.fx('sform')), 'not valid');
select public.business_setup_form_staff_save(pg_temp.cid('sform'), '{"phone":"0509998888"}');
select public.bs_check('staff_completes_form: the answer is merged, the rest kept', (select answers ->> 'phone' = '0509998888' and answers ->> 'client_name' = 'Zed Co' and answers -> 'partners' -> 0 ->> 'name' = 'Pat'
  from public.business_setup_onboarding_forms where id = pg_temp.cid('sform')));
select public.bs_check('the change is audited with old and new', public.bs_audit_count('form_staff_save', pg_temp.fx('sform'), '{"answers":{"phone":"0509998888"}}') = 1);
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', '../etc/passwd')$$, pg_temp.fx('sform')), 'path');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', ' ', 'staff/a.pdf')$$, pg_temp.fx('sform')), 'kind');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'staff/CL980001/x.pdf')$$, pg_temp.fx('sform')), 'path');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'incoming/%s/x/y.pdf')$$, pg_temp.fx('sform'), gen_random_uuid()), 'path');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'staff/CL980020/../CL980001/x.pdf')$$, pg_temp.fx('sform')), 'path');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'elsewhere/CL980020/x.pdf')$$, pg_temp.fx('sform')), 'path');
select public.bs_check('a name with two dots is allowed', public.business_setup_form_doc_add(pg_temp.cid('sform'), 'Utility bill', 'staff/CL980020/a..b.pdf') is not null);
select public.bs_check('the client''s own incoming folder is allowed', public.business_setup_form_doc_add(pg_temp.cid('sform'), 'Utility bill', 'incoming/' || pg_temp.acct('CL980020') || '/d1/x.pdf') is not null);
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Utility bill', 'staff/CL980020/a..b.pdf')$$, pg_temp.fx('sform')), 'already stored');
insert into f80 values ('sdoc', public.business_setup_form_doc_add(pg_temp.cid('sform'), 'Passport', 'staff/CL980020/passport.pdf')::text);
select public.business_setup_form_doc_add(pg_temp.cid('sform'), 'Ejari', 'staff/CL980020/ejari.pdf');
select public.bs_check('the added documents belong to the client and the form', (select count(*) = 4 and bool_and(form_id = pg_temp.cid('sform') and account_id = (select account_id from public.business_setup_onboarding_forms where id = pg_temp.cid('sform')) and upload_complete)
  from pg_temp.pdocs() where form_id = pg_temp.cid('sform')));
select public.bs_check('a staff-added document says so', (select note ilike '%staff%' and reviewed_by = '00000000-0000-0000-0000-00000000000d' and file_name = 'passport.pdf' from pg_temp.pdocs() where id = pg_temp.cid('sdoc')));
select public.bs_check('staff_completes_form: validation now finds nothing missing', cardinality(public.business_setup_form_missing(pg_temp.cid('sform'))) = 0);
select public.bs_as(null);
update public.business_setup_onboarding_forms set status = 'Submitted' where id = pg_temp.cid('sform');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_form_staff_save('%s', '{"phone":"1"}')$$, pg_temp.fx('sform')), 'In review');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'staff/b.pdf')$$, pg_temp.fx('sform')), 'In review');

-- A client id holding an underscore: an exact prefix match, not a LIKE wildcard
select public.bs_as(null);
select pg_temp.mkclient('CL98_021', true, false);
select public.business_setup_form_create('CL98_021', (select id from public.client_portal_accounts where client_master_id = 'CL98_021'));
update public.business_setup_onboarding_forms set status = 'In review' where client_id = 'CL98_021';
insert into f80 select 'uform', id::text from public.business_setup_onboarding_forms where client_id = 'CL98_021';
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'staff/CL98X021/x.pdf')$$, pg_temp.fx('uform')), 'path');
select public.bs_check('the exact folder with the underscore is allowed', public.business_setup_form_doc_add(pg_temp.cid('uform'), 'Passport', 'staff/CL98_021/x.pdf') is not null);

-- ── no_permission ──
select public.bs_as('00000000-0000-0000-0000-0000000000c1');
select public.bs_expect_error($$select business_setup_case_new('{"lead_name":"Nope"}')$$, 'permission');
select public.bs_expect_error(format($$select business_setup_case_take('%s')$$, pg_temp.fx('conf_none')), 'permission');
select public.bs_expect_error(format($$select business_setup_case_link_client('%s')$$, pg_temp.fx('noclient')), 'permission');
select public.bs_expect_error(format($$select business_setup_case_shared('%s')$$, pg_temp.fx('shared4')), 'permission');
select public.bs_expect_error(format($$select business_setup_case_lost('%s', 'x')$$, pg_temp.fx('noclient')), 'permission');
select public.bs_expect_error(format($$select business_setup_case_confirm('%s')$$, pg_temp.fx('conf_none')), '');
select public.bs_expect_error(format($$select business_setup_case_assign('%s', '00000000-0000-0000-0000-00000000000c', null)$$, pg_temp.fx('conf_none')), 'permission');
select public.bs_expect_error(format($$select business_setup_reassign_request('%s', '00000000-0000-0000-0000-00000000000c', 'x')$$, pg_temp.fx('re')), 'permission');
select public.bs_expect_error(format($$select business_setup_reassign_respond('%s', true, null)$$, pg_temp.fx('req2')), 'permission');
select public.bs_expect_error(format($$select business_setup_form_staff_save('%s', '{}')$$, pg_temp.fx('sform')), 'permission');
select public.bs_expect_error(format($$select business_setup_form_doc_add('%s', 'Passport', 'staff/c.pdf')$$, pg_temp.fx('sform')), 'permission');
select public.bs_check('read-only staff can still list cases', jsonb_array_length(public.business_setup_case_list('all')) > 0);
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select business_setup_case_list('all')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error($$select business_setup_case_new('{"lead_name":"Finance"}')$$, 'permission');
select public.bs_expect_error(format($$select business_setup_case_take('%s')$$, pg_temp.fx('conf_none')), 'permission');
select public.bs_check('nothing changed under the refusals', pg_temp.stage('conf_none') = 'Assignment' and pg_temp.owner('conf_none') is null);

-- ── case_list ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select business_setup_case_list('bogus')$$, 'view');
select public.bs_check('leads view: Lead, Contact, Review and Lost only', (select bool_and(e ->> 'stage' in ('Lead', 'Contact', 'Review', 'Lost')) and count(*) > 3 from jsonb_array_elements(public.business_setup_case_list('leads')) e));
select public.bs_check('leads view holds the lead with its owner name and docs', (select e ->> 'owner_name' = 'Sales' and e ? 'docs' and e ->> 'lead_name' = 'Alpha Trading' and e ->> 'case_number' ~ '^BSC' and e ? 'reassign'
  from jsonb_array_elements(public.business_setup_case_list('leads')) e where e ->> 'id' = pg_temp.fx('lead')));
select public.bs_check('documentation view: Services and Documentation only', (select bool_and(e ->> 'stage' in ('Services', 'Documentation')) and count(*) >= 2 from jsonb_array_elements(public.business_setup_case_list('documentation')) e));
select public.bs_check('cases view: Assignment onward only', (select bool_and(e ->> 'stage' in ('Assignment', 'In service', 'Completed', 'Cancelled')) and count(*) >= 3 from jsonb_array_elements(public.business_setup_case_list('cases')) e));
select public.bs_check('all view holds every case', jsonb_array_length(public.business_setup_case_list('all')) = (select count(*) from public.business_setup_cases));
select public.bs_check('a case list row carries the document checklist', (select e -> 'docs' ? 'quote' and e -> 'docs' ? 'signed' from jsonb_array_elements(public.business_setup_case_list('cases')) e limit 1));

-- ── Services closing a case ──
select public.bs_as(null);
select pg_temp.mkclient('CL980030', false);
select pg_temp.mkcase('svc_done', 'CL980030', 'In service');
select pg_temp.mkquote('svc_done_q', 'T80-SVC1', 'CL980030', pg_temp.cid('svc_done'), 'accepted');
insert into public.business_setup_services (id, client_id, quote_id, name, status) values ('00000000-0000-0000-0000-0000000000a1', 'CL980030', pg_temp.cid('svc_done_q'), 's1', 'In progress'),
  ('00000000-0000-0000-0000-0000000000a2', 'CL980030', pg_temp.cid('svc_done_q'), 's2', 'In progress');
update public.business_setup_services set status = 'Completed' where id = '00000000-0000-0000-0000-0000000000a1';
select public.bs_check('one service open: the case stays In service', pg_temp.stage('svc_done') = 'In service');
update public.business_setup_services set status = 'Cancelled' where id = '00000000-0000-0000-0000-0000000000a2';
select public.bs_check('service trigger: one Completed, none open gives Completed', pg_temp.stage('svc_done') = 'Completed');
select pg_temp.mkclient('CL980031', false);
select pg_temp.mkcase('svc_can', 'CL980031', 'In service');
select pg_temp.mkquote('svc_can_q', 'T80-SVC2', 'CL980031', pg_temp.cid('svc_can'), 'accepted');
insert into public.business_setup_services (id, client_id, quote_id, name, status) values ('00000000-0000-0000-0000-0000000000b1', 'CL980031', pg_temp.cid('svc_can_q'), 's1', 'In progress');
update public.business_setup_services set status = 'Cancelled' where id = '00000000-0000-0000-0000-0000000000b1';
select public.bs_check('service trigger: every service Cancelled gives Cancelled', pg_temp.stage('svc_can') = 'Cancelled');
select pg_temp.mkcase('svc_asg', 'CL980031', 'Assignment');
select pg_temp.mkquote('svc_asg_q', 'T80-SVC3', 'CL980031', pg_temp.cid('svc_asg'), 'accepted');
insert into public.business_setup_services (id, client_id, quote_id, name, status) values ('00000000-0000-0000-0000-0000000000c1', 'CL980031', pg_temp.cid('svc_asg_q'), 's1', 'Not started');
update public.business_setup_services set status = 'Cancelled' where id = '00000000-0000-0000-0000-0000000000c1';
select public.bs_check('a case not yet In service is left alone', pg_temp.stage('svc_asg') = 'Assignment');
insert into public.business_setup_services (client_id, name, status) values ('CL980031', 'no quote', 'In progress');
update public.business_setup_services set status = 'Completed' where name = 'no quote';

-- ── Documents of a case: Business Setup only, and the client must match ──
select public.bs_as(null);
select pg_temp.mkclient('CL980040', false);
select pg_temp.mkclient('CL980041', false);
select pg_temp.mkcase('doc_case', 'CL980040', 'Services');
select pg_temp.mkcase('doc_case_open', null, 'Lead');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select pg_temp.hq('{"department":"Accounting","case_id":"%s"}')$$, pg_temp.fx('doc_case')), 'Business Setup');
select public.bs_expect_error(format($$select pg_temp.hq('{"department":"Business Setup","case_id":"%s","client_id":"CL980041"}')$$, pg_temp.fx('doc_case')), 'client');
select public.bs_check('a matching client keeps the case on the quote', (select case_id = pg_temp.cid('doc_case') from pg_temp.hq(format('{"department":"Business Setup","case_id":"%s","client_id":"CL980040"}', pg_temp.fx('doc_case'))::jsonb)));
select public.bs_check('a quote with no client of its own joins the case', (select case_id = pg_temp.cid('doc_case') from pg_temp.hq(format('{"department":"Business Setup","case_id":"%s"}', pg_temp.fx('doc_case'))::jsonb)));
select public.bs_check('a case with no client yet accepts a quote for any client', (select case_id = pg_temp.cid('doc_case_open') from pg_temp.hq(format('{"department":"Business Setup","case_id":"%s","client_id":"CL980041"}', pg_temp.fx('doc_case_open'))::jsonb)));
select public.bs_check('issuing a quote moved the case on', pg_temp.stage('doc_case') = 'Documentation');
select public.bs_check('Accounting with no case behaves as before', (select case_id is null and status = 'issued' from pg_temp.hq('{"department":"Accounting"}'::jsonb)));
select public.bs_check('Business Setup with no case behaves as before', (select case_id is null from pg_temp.hq('{"department":"Business Setup","client_id":"CL980040"}'::jsonb)));
select public.bs_expect_error($$select pg_temp.hq('{"department":"Business Setup","case_id":"00000000-0000-0000-0000-0000000000ff"}'::jsonb)$$, 'Unknown case');

-- ── Dashboard figures (restructure Task 3) ──
-- The database holds other test data, so every figure is checked as a change from a reading taken first.
create function pg_temp.dash() returns jsonb language sql as $$ select public.business_setup_dashboard() $$;
create function pg_temp.dd(p_base text, p_key text) returns numeric language sql as $$
  select (pg_temp.dash() ->> p_key)::numeric - (pg_temp.fx(p_base)::jsonb ->> p_key)::numeric $$;
create function pg_temp.dstage(p_base text, p_stage text) returns numeric language sql as $$
  select coalesce((pg_temp.dash() -> 'pipeline' ->> p_stage)::numeric, 0) - coalesce((pg_temp.fx(p_base)::jsonb -> 'pipeline' ->> p_stage)::numeric, 0) $$;
create function pg_temp.mkpay(p_client text, p_quote uuid, p_case uuid, p_amount numeric, p_type text default 'Payment') returns void language sql as $$
  insert into public.business_setup_payments (client_id, quote_id, case_id, paid_on, amount, type) values (p_client, p_quote, p_case, current_date, p_amount, p_type) $$;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('d0', pg_temp.dash()::text);
select public.bs_check('dash_keys: every old key is still present', pg_temp.dash() ?& array['forms_waiting', 'open_quotes', 'accepted_without_letter', 'outstanding', 'active_services', 'expiries', 'ready_for_accounts', 'reverted_by_accounts']);
select public.bs_check('dash_keys: the new keys are present', pg_temp.dash() ?& array['processes_pending', 'receivables', 'advances', 'cases_completed_month', 'cases_completed_total', 'pipeline', 'forms_to_review', 'pending_after_kyc']);
select public.bs_check('dash_pipeline: lists every open stage, even at zero', (select count(*) = 7 from jsonb_object_keys(pg_temp.dash() -> 'pipeline'))
  and not (pg_temp.dash() -> 'pipeline') ?| array['Completed', 'Cancelled', 'Lost']);
select public.bs_check('dash_keys: forms to review is the forms waiting', pg_temp.dash() ->> 'forms_to_review' = pg_temp.dash() ->> 'forms_waiting');

-- Money: an accepted quote with a part payment, an overpaid one, a quote only issued, and advances on a case with no accepted quote.
select public.bs_as(null);
select pg_temp.mkclient('CL980060', false);
select pg_temp.mkcase('d_rec', 'CL980060', 'Documentation');
select pg_temp.mkcase('d_over', 'CL980060', 'Documentation');
select pg_temp.mkcase('d_iss', 'CL980060', 'Documentation');
select pg_temp.mkcase('d_adv', 'CL980060', 'Documentation');
select pg_temp.mkquote('dq_rec', 'DQ-1', 'CL980060', pg_temp.cid('d_rec'));
select pg_temp.mkquote('dq_over', 'DQ-2', 'CL980060', pg_temp.cid('d_over'));
select pg_temp.mkquote('dq_iss', 'DQ-3', 'CL980060', pg_temp.cid('d_iss'));
select pg_temp.mkquote('dq_adv', 'DQ-4', 'CL980060', pg_temp.cid('d_adv'));
update public.hub_documents set total_amount = 1050, status = 'accepted' where id = pg_temp.cid('dq_rec');
update public.hub_documents set status = 'accepted' where id = pg_temp.cid('dq_over');
select pg_temp.mkpay('CL980060', pg_temp.cid('dq_rec'), pg_temp.cid('d_rec'), 400);
select pg_temp.mkpay('CL980060', pg_temp.cid('dq_over'), pg_temp.cid('d_over'), 1200);
select pg_temp.mkpay('CL980060', pg_temp.cid('dq_adv'), pg_temp.cid('d_adv'), 300);
select pg_temp.mkpay('CL980060', null, pg_temp.cid('d_adv'), 50, 'Refund');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('dash_receivables: accepted 1050, paid 400 gives 650; overpaid counts 0; issued-only counts 0', pg_temp.dd('d0', 'receivables') = 650);
select public.bs_check('dash_receivables: the old outstanding figure agrees', pg_temp.dd('d0', 'outstanding') = 650);
select public.bs_check('dash_advances: a payment on a case with no accepted quote appears in advances only (net of refunds)', pg_temp.dd('d0', 'advances') = 250);

-- Stages, completed cases, after KYC.
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('d1', pg_temp.dash()::text);
select public.bs_as(null);
select pg_temp.mkcase('s_lead', null, 'Lead');
select pg_temp.mkcase('s_svc1', 'CL980060', 'Services');
select pg_temp.mkcase('s_svc2', 'CL980060', 'Services');
select pg_temp.mkcase('s_doc', 'CL980060', 'Documentation');
select pg_temp.mkcase('s_asg', 'CL980060', 'Assignment');
select pg_temp.mkcase('s_done_new', 'CL980060', 'In service');
select pg_temp.mkcase('s_done_old', 'CL980060', 'In service');
select pg_temp.mkcase('s_canc', 'CL980060', 'Cancelled');
select pg_temp.mkcase('s_lost', null, 'Lost');
select public.business_setup_case_set_stage(pg_temp.cid('s_done_new'), 'Completed', 'test');
update public.business_setup_cases set stage = 'Completed' where id = pg_temp.cid('s_done_old');
insert into public.business_setup_audit_log (table_name, row_id, action, new_data, occurred_at) values ('business_setup_cases', pg_temp.fx('s_done_old'), 'case_stage', '{"stage":"Completed"}', now() - interval '70 days');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('dash_pipeline: counts per stage', pg_temp.dstage('d1', 'Lead') = 1 and pg_temp.dstage('d1', 'Services') = 2 and pg_temp.dstage('d1', 'Documentation') = 1
  and pg_temp.dstage('d1', 'Assignment') = 1 and pg_temp.dstage('d1', 'In service') = 0);
select public.bs_check('dash_pipeline: Completed, Cancelled and Lost are left out', not (pg_temp.dash() -> 'pipeline') ? 'Completed' and not (pg_temp.dash() -> 'pipeline') ? 'Cancelled' and not (pg_temp.dash() -> 'pipeline') ? 'Lost');
select public.bs_check('dash_after_kyc: cases at Services count, Documentation does not', pg_temp.dd('d1', 'pending_after_kyc') = 2);
select public.bs_check('dash_completed: two completed in total, one this month', pg_temp.dd('d1', 'cases_completed_total') = 2 and pg_temp.dd('d1', 'cases_completed_month') = 1);

-- Services: only those whose quote is in a case are processes.
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f80 values ('d2', pg_temp.dash()::text);
select public.bs_as(null);
insert into public.business_setup_services (client_id, quote_id, name, status) values ('CL980060', pg_temp.cid('dq_rec'), 'in a case', 'In progress');
insert into public.business_setup_services (client_id, quote_id, name, status) values ('CL980060', pg_temp.cid('dq_rec'), 'done in a case', 'Completed');
insert into public.business_setup_services (client_id, name, status) values ('CL980060', 'no case', 'In progress');
insert into public.business_setup_services (client_id, name, status, historical) values ('CL980060', 'old import', 'In progress', true);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('dash_history: a service with no case is left out of processes_pending', pg_temp.dd('d2', 'processes_pending') = 1);
select public.bs_check('dash_history: active_services keeps its old meaning', pg_temp.dd('d2', 'active_services') = 2);
select public.bs_as(null);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
