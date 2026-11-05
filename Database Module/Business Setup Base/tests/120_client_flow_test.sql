-- LOCAL TEST ONLY: client flow stages and the move to Onboarding (client flow Task 2). Run through tests/run-local.sh, after 110.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier tests re-run older migrations: put the real final state back, in order.
-- 013's backfill writes the old stage names (as on the live database): lift the new check for it and let 016 map them.
alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/016_client_flow.sql
\ir ../migrations/018_portal.sql
create temp table f120 (k text primary key, v text);
grant all on f120 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f120 where k = p_k $$;
create function pg_temp.cid(p_k text) returns uuid language sql as $$ select v::uuid from f120 where k = p_k $$;
create function pg_temp.stage(p_k text) returns text language sql security definer as $$ select stage from public.business_setup_cases where id = pg_temp.cid(p_k) $$;
create function pg_temp.docs(p_k text) returns jsonb language sql security definer as $$ select public.business_setup_case_docs(pg_temp.cid(p_k)) $$;
create function pg_temp.mkclient(p_client text) returns void language plpgsql as $$
begin insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing; end $$;
-- A case straight into the table, as the owner of the table.
create function pg_temp.mkcase(p_key text, p_client text, p_stage text, p_owner uuid default null) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into public.business_setup_cases (client_id, stage, lead_name, owner_id) values (p_client, p_stage, coalesce(p_client, p_key), p_owner) returning id into c;
  insert into f120 values (p_key, c::text);
  return c;
end $$;
create function pg_temp.mkquote(p_key text, p_num text, p_client text, p_case uuid, p_status text default 'issued', p_total numeric default 1000) returns uuid language plpgsql as $$
declare q uuid := gen_random_uuid();
begin
  insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  values (q, q, 'quote', 'Business Setup', coalesce(p_client, p_num), p_client, p_num, p_total, p_status, p_case);
  insert into f120 values (p_key, q::text);
  return q;
end $$;
create function pg_temp.mkservice(p_client text, p_quote text, p_status text) returns void language sql as $$
  insert into public.business_setup_services (client_id, quote_id, name, status) values (p_client, pg_temp.fx(p_quote)::uuid, 'svc ' || p_status, p_status)
$$;
select public.bs_as(null);

-- ── Mapping: old stages become the new ones, once ──
-- Put the old check back and make one case per old stage, the way the live database holds them before 016.
alter table public.business_setup_cases drop constraint business_setup_cases_stage_check;
alter table public.business_setup_cases add constraint business_setup_cases_stage_check
  check (stage in ('Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service', 'Completed', 'Cancelled', 'Lost')) not valid;   -- not valid: earlier tests left cases at the new stages
select pg_temp.mkcase('m_lead', null, 'Lead');
select pg_temp.mkcase('m_contact', null, 'Contact');
select pg_temp.mkcase('m_review', null, 'Review');
select pg_temp.mkcase('m_services', null, 'Services');
select pg_temp.mkcase('m_documentation', null, 'Documentation');
select pg_temp.mkcase('m_assignment', null, 'Assignment');
select pg_temp.mkcase('m_service', null, 'In service');
select pg_temp.mkcase('m_completed', null, 'Completed');
select pg_temp.mkcase('m_cancelled', null, 'Cancelled');
select pg_temp.mkcase('m_lost', null, 'Lost');
create temp table m120 as select id, updated_at, updated_by from public.business_setup_cases where id in (select v::uuid from f120 where k like 'm\_%');
\ir ../migrations/016_client_flow.sql
select public.bs_check('mapping: Contact to Lead', pg_temp.stage('m_lead') = 'Lead' and pg_temp.stage('m_contact') = 'Lead');
select public.bs_check('mapping: Review stays', pg_temp.stage('m_review') = 'Review');
select public.bs_check('mapping: Services and Documentation to Onboarding', pg_temp.stage('m_services') = 'Onboarding' and pg_temp.stage('m_documentation') = 'Onboarding');
select public.bs_check('mapping: Assignment and In service to Pipeline', pg_temp.stage('m_assignment') = 'Pipeline' and pg_temp.stage('m_service') = 'Pipeline');
select public.bs_check('mapping: Completed, Cancelled and Lost unchanged', pg_temp.stage('m_completed') = 'Completed' and pg_temp.stage('m_cancelled') = 'Cancelled' and pg_temp.stage('m_lost') = 'Lost');
select public.bs_check('mapping: only the stage changed, updated_at and updated_by are kept', (select bool_and(c.updated_at = m.updated_at and c.updated_by is not distinct from m.updated_by)
  from public.business_setup_cases c join m120 m on m.id = c.id));
select public.bs_check('mapping: each mapped case is audited with its old stage', public.bs_audit_count('case_stage_map', pg_temp.fx('m_documentation'), '{"stage":"Onboarding"}') = 1
  and exists (select 1 from public.business_setup_audit_log where action = 'case_stage_map' and row_id = pg_temp.fx('m_assignment') and old_data = '{"stage":"Assignment"}'::jsonb));
select public.bs_check('mapping: a case that did not change is not audited', public.bs_audit_count('case_stage_map', pg_temp.fx('m_review'), '{}') = 0);
select md5(string_agg(c::text, '|' order by id)) as snap from public.business_setup_cases c \gset
select count(*) as audits from public.business_setup_audit_log where action = 'case_stage_map' \gset
\ir ../migrations/016_client_flow.sql
select public.bs_check('map_twice: running 016 again changes no case', (select md5(string_agg(c::text, '|' order by id)) from public.business_setup_cases c) = :'snap');
select public.bs_check('map_twice: and writes no second audit entry', (select count(*) from public.business_setup_audit_log where action = 'case_stage_map') = :audits);
select public.bs_expect_error($$insert into public.business_setup_cases (stage) values ('Contact')$$, 'check');
select public.bs_expect_error($$insert into public.business_setup_cases (stage) values ('Documentation')$$, 'check');
select public.bs_check('the new stages are accepted', (select count(*) from (select pg_temp.mkcase('s_' || s, null, s) from unnest(array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost']) s) x) = 9);

-- ── The checklist: nine keys, balance is only a figure ──
select pg_temp.mkclient('CL972001');
select pg_temp.mkcase('items', 'CL972001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select public.bs_check('docs: the nine keys', (select array_agg(k order by k) from jsonb_object_keys(pg_temp.docs('items')) k)
  = array['balance', 'documents', 'fields', 'invoice', 'letter', 'letter_accepted', 'login', 'quote', 'quote_accepted']);
select public.bs_check('docs: a bare case has nothing met and no balance', pg_temp.docs('items') = '{"fields":false,"documents":false,"quote":false,"login":false,"quote_accepted":false,"letter":false,"letter_accepted":false,"invoice":false,"balance":0}'::jsonb);
select public.bs_check('docs of an unknown case are all false', public.business_setup_case_docs(gen_random_uuid()) = '{"fields":false,"documents":false,"quote":false,"login":false,"quote_accepted":false,"letter":false,"letter_accepted":false,"invoice":false,"balance":0}'::jsonb);

-- ── no_form_case: no form and no client at Onboarding lists, with fields open ──
select pg_temp.mkcase('nf', null, 'Onboarding');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('no_form_case: it lists in the onboarding view and does not error', exists (select 1 from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('nf')));
select public.bs_check('no_form_case: fields reads false and the client name is empty', (select (e -> 'docs' ->> 'fields')::boolean = false and e ->> 'client_name' is null and e ->> 'referred_by_name' is null
  from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('nf')));
select public.bs_as(null);
-- A form on the case, then Validated: fields and documents turn true. A client with KYC done and no form counts too.
select pg_temp.mkclient('CL972002');
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL972002', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select pg_temp.mkcase('kyc', 'CL972002', 'Onboarding');
select public.bs_check('fields: KYC done with no form is met, and so is documents', (pg_temp.docs('kyc') ->> 'fields')::boolean and (pg_temp.docs('kyc') ->> 'documents')::boolean);
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL972002', 'K', 'portal.k120', 'x');
select public.bs_check('login: true when the client has a portal account', (pg_temp.docs('kyc') ->> 'login')::boolean and not (pg_temp.docs('items') ->> 'login')::boolean);
select pg_temp.mkclient('CL972003');
select pg_temp.mkcase('frm', 'CL972003', 'Onboarding');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL972003', 'F', 'portal.f120', 'x');
select public.business_setup_form_create('CL972003', (select id from public.client_portal_accounts where username = 'portal.f120'));
update public.business_setup_kyc_profiles set kyc_state = 'Done' where client_id = 'CL972003';
update public.business_setup_onboarding_forms set case_id = pg_temp.cid('frm') where client_id = 'CL972003';
select public.bs_check('fields: a form that is not Validated is open even with KYC done', not (pg_temp.docs('frm') ->> 'fields')::boolean);
update public.business_setup_onboarding_forms set status = 'Submitted' where client_id = 'CL972003';
update public.business_setup_onboarding_forms set status = 'Validated' where client_id = 'CL972003';
select public.bs_check('fields: Validated meets fields and documents', (pg_temp.docs('frm') ->> 'fields')::boolean and (pg_temp.docs('frm') ->> 'documents')::boolean and pg_temp.stage('frm') = 'Onboarding');

-- ── to_pipeline: every item met moves the case, with zero payment ──
select pg_temp.mkcase('pipe', 'CL972002', 'Onboarding');
select pg_temp.mkquote('pipe_q', 'T120-PIPE', 'CL972002', pg_temp.cid('pipe'), 'issued', 1000);
select public.bs_check('to_pipeline: a quote alone does not move it', pg_temp.stage('pipe') = 'Onboarding' and (pg_temp.docs('pipe') ->> 'quote')::boolean);
update public.hub_documents set status = 'accepted' where id = pg_temp.fx('pipe_q')::uuid;
insert into public.hub_documents (parent_id, doc_type, department, client_name, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, 'T120-PIPE-L', case_id from public.hub_documents where id = pg_temp.fx('pipe_q')::uuid;
select public.bs_check('to_pipeline: quote, login, acceptance and letter wait for the invoice', pg_temp.stage('pipe') = 'Onboarding' and not (pg_temp.docs('pipe') ->> 'invoice')::boolean);
insert into public.business_setup_invoices (client_id, quote_id, case_id, invoice_number, source) values ('CL972002', pg_temp.fx('pipe_q')::uuid, pg_temp.cid('pipe'), 'T120-INV', 'Manual');
select public.bs_check('to_pipeline: with the invoice the case moves to Pipeline', pg_temp.stage('pipe') = 'Pipeline');
select public.bs_check('to_pipeline: no payment was made and the balance is the whole quote', public.business_setup_case_net_paid(pg_temp.cid('pipe')) = 0 and (pg_temp.docs('pipe') ->> 'balance')::numeric = 1000);
select public.bs_check('to_pipeline: the move is audited', public.bs_audit_count('case_stage', pg_temp.fx('pipe'), '{"stage":"Pipeline"}') = 1);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, case_id) values ('CL972002', pg_temp.fx('pipe_q')::uuid, current_date, 400, 'Payment', pg_temp.cid('pipe'));
select public.bs_check('balance: a part payment lowers it and moves nothing', (pg_temp.docs('pipe') ->> 'balance')::numeric = 600 and pg_temp.stage('pipe') = 'Pipeline');
-- An invoice override also meets the invoice item.
select pg_temp.mkcase('ovr', 'CL972002', 'Onboarding');
select pg_temp.mkquote('ovr_q', 'T120-OVR', 'CL972002', pg_temp.cid('ovr'), 'accepted', 500);
insert into public.hub_documents (parent_id, doc_type, department, client_name, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, 'T120-OVR-L', case_id from public.hub_documents where id = pg_temp.fx('ovr_q')::uuid;
update public.business_setup_cases set invoice_override_reason = 'Invoiced outside the CRM' where id = pg_temp.cid('ovr');
select public.business_setup_case_sync(pg_temp.cid('ovr'));
select public.bs_check('to_pipeline: the invoice override counts', pg_temp.stage('ovr') = 'Pipeline');
select public.bs_check('a letter on a quote that is not accepted does not count', (select not (public.business_setup_case_docs(c.id) ->> 'letter')::boolean from public.business_setup_cases c where c.id = pg_temp.cid('items')));

-- ── service_gate: a service on a case needs no payment, a service with no case still does ──
select pg_temp.mkquote('gate_nocase', 'T120-GATE1', 'CL972002', null, 'accepted', 1000);
select public.bs_check('service_gate: a quote of a case with no payment passes', public.business_setup_start_gate(pg_temp.fx('pipe_q')::uuid, null) is false
  and public.business_setup_start_gate(pg_temp.fx('ovr_q')::uuid, null) is false);
select public.bs_expect_error(format($$select public.business_setup_start_gate('%s', null)$$, pg_temp.fx('gate_nocase')), 'A payment is needed');

-- ── all_closed: services close the case ──
select pg_temp.mkcase('cl1', 'CL972002', 'Pipeline');
select pg_temp.mkquote('cl1_q', 'T120-CL1', 'CL972002', pg_temp.cid('cl1'), 'accepted');
select pg_temp.mkservice('CL972002', 'cl1_q', 'Completed');
select pg_temp.mkservice('CL972002', 'cl1_q', 'In progress');
select public.business_setup_case_sync(pg_temp.cid('cl1'));
select public.bs_check('all_closed: an open service keeps the case in Pipeline', pg_temp.stage('cl1') = 'Pipeline');
update public.business_setup_services set status = 'Cancelled' where quote_id = pg_temp.fx('cl1_q')::uuid and status = 'In progress';
select public.bs_check('all_closed: one Completed and the rest closed moves it to Completion', pg_temp.stage('cl1') = 'Completion');
select pg_temp.mkcase('cl2', 'CL972002', 'Pipeline');
select pg_temp.mkquote('cl2_q', 'T120-CL2', 'CL972002', pg_temp.cid('cl2'), 'accepted');
select pg_temp.mkservice('CL972002', 'cl2_q', 'Cancelled');
select public.business_setup_case_sync(pg_temp.cid('cl2'));
select public.bs_check('all_closed: all Cancelled moves it to Cancelled', pg_temp.stage('cl2') = 'Cancelled');
select pg_temp.mkcase('cl3', 'CL972002', 'Pipeline');
select public.business_setup_case_sync(pg_temp.cid('cl3'));
select public.bs_check('all_closed: no services leaves it in Pipeline', pg_temp.stage('cl3') = 'Pipeline');
select pg_temp.mkcase('cl4', 'CL972002', 'Pipeline');
select pg_temp.mkquote('cl4_q', 'T120-CL4', 'CL972002', pg_temp.cid('cl4'), 'accepted');
select pg_temp.mkservice('CL972002', 'cl4_q', 'Completed');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_case_take(pg_temp.cid('cl4'));
select public.bs_check('all_closed: taking a Pipeline case with every service closed completes it at once', pg_temp.stage('cl4') = 'Completion' and (select owner_id from public.business_setup_cases where id = pg_temp.cid('cl4')) = '00000000-0000-0000-0000-00000000000c');
select public.bs_as(null);

-- ── lost_after_pipeline ──
select pg_temp.mkcase('lp', 'CL972002', 'Pipeline');
select pg_temp.mkcase('lc', 'CL972002', 'Completion');
select pg_temp.mkcase('lw', 'CL972002', 'With Accounts');
select pg_temp.mkcase('lo', 'CL972002', 'Onboarding');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_lost('%s', 'Gone')$$, pg_temp.fx('lp')), 'Pipeline or later');
select public.bs_expect_error(format($$select public.business_setup_case_lost('%s', 'Gone')$$, pg_temp.fx('lc')), 'Pipeline or later');
select public.bs_expect_error(format($$select public.business_setup_case_lost('%s', 'Gone')$$, pg_temp.fx('lw')), 'Pipeline or later');
select public.bs_check('lost_after_pipeline: the cases stay where they were', pg_temp.stage('lp') = 'Pipeline' and pg_temp.stage('lc') = 'Completion' and pg_temp.stage('lw') = 'With Accounts');
select public.business_setup_case_lost(pg_temp.cid('lo'), 'Client went elsewhere');
select public.bs_check('lost: a case at Onboarding can still be lost', pg_temp.stage('lo') = 'Lost');
select public.bs_as(null);

-- ── Moving to Onboarding ──
select pg_temp.mkcase('mv_none', null, 'Lead');
select pg_temp.mkcase('mv_review', null, 'Review', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('mv_owned', null, 'Lead', '00000000-0000-0000-0000-00000000000c');
update public.business_setup_cases set lead_name = 'Move Owned Trading', email = 'move@owned.test' where id = pg_temp.cid('mv_owned');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, pg_temp.fx('mv_none')), 'Assign the lead before moving it.');
select public.bs_check('move_no_owner: the case stays a Lead', pg_temp.stage('mv_none') = 'Lead');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, pg_temp.fx('mv_owned')), 'Only the owner');
select public.bs_check('move_non_owner: refused, nothing linked', pg_temp.stage('mv_owned') = 'Lead' and (select client_id is null from public.business_setup_cases where id = pg_temp.cid('mv_owned')));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f120 values ('mv_client', public.business_setup_case_move_to_onboarding(pg_temp.cid('mv_owned')));
select public.bs_check('move: the owner moves it, the client is created and returned', pg_temp.stage('mv_owned') = 'Onboarding' and pg_temp.fx('mv_client') ~ '^CL[0-9]{6}$'
  and (select client_id from public.business_setup_cases where id = pg_temp.cid('mv_owned')) = pg_temp.fx('mv_client'));
select public.bs_check('move: the move is audited', public.bs_audit_count('case_stage', pg_temp.fx('mv_owned'), '{"stage":"Onboarding"}') = 1);
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, pg_temp.fx('mv_owned')), 'Only a lead or a case in review');
-- A manager (setup.cases.approve) may move a case they do not own.
select public.bs_as(null);
select pg_temp.mkcase('mv_mgr', null, 'Review', '00000000-0000-0000-0000-00000000000c');
update public.business_setup_cases set lead_name = 'Move Manager Trading' where id = pg_temp.cid('mv_mgr');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_case_move_to_onboarding(pg_temp.cid('mv_mgr'));
select public.bs_check('move_non_owner: a holder of setup.cases.approve may move it', pg_temp.stage('mv_mgr') = 'Onboarding');
-- A duplicate is refused until staff link the existing client or confirm.
select public.bs_as(null);
select pg_temp.mkcase('mv_dup', null, 'Lead', '00000000-0000-0000-0000-00000000000c');
update public.business_setup_cases set lead_name = 'Move Owned Trading', email = 'move@owned.test' where id = pg_temp.cid('mv_dup');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, pg_temp.fx('mv_dup')), 'already exists');
select public.bs_check('move_duplicate: refused, the case is unlinked and still a Lead', pg_temp.stage('mv_dup') = 'Lead' and (select client_id is null from public.business_setup_cases where id = pg_temp.cid('mv_dup')));
select public.bs_check('move_duplicate: staff can link the existing client', public.business_setup_case_move_to_onboarding(pg_temp.cid('mv_dup'), pg_temp.fx('mv_client')) = pg_temp.fx('mv_client') and pg_temp.stage('mv_dup') = 'Onboarding');
select public.bs_as(null);
select pg_temp.mkcase('mv_dup2', null, 'Lead', '00000000-0000-0000-0000-00000000000c');
update public.business_setup_cases set lead_name = 'Move Owned Trading', email = 'move@owned.test' where id = pg_temp.cid('mv_dup2');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('move_duplicate: or confirm it is a new client', public.business_setup_case_move_to_onboarding(pg_temp.cid('mv_dup2'), null, true) <> pg_temp.fx('mv_client') and pg_temp.stage('mv_dup2') = 'Onboarding');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, gen_random_uuid()), 'Case not found');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_onboarding('%s')$$, pg_temp.fx('mv_review')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_confirm('%s')$$, pg_temp.fx('mv_review')), 'nothing to confirm');
select public.bs_as(null);
select public.bs_check('only signed-in users can call the move', has_function_privilege('authenticated', 'public.business_setup_case_move_to_onboarding(uuid, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public.business_setup_case_move_to_onboarding(uuid, text, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_case_docs(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.business_setup_case_sync(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_start_gate(uuid, text)', 'execute'));

-- ── Views ──
select pg_temp.mkcase('v_mine', null, 'Lead', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('v_other', null, 'Lead', '00000000-0000-0000-0000-00000000000d');
select pg_temp.mkclient('CL972010');
select pg_temp.mkcase('v_input', 'CL972010', 'Review', '00000000-0000-0000-0000-00000000000c');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL972010', 'V', 'portal.v120', 'x');
select public.business_setup_form_create('CL972010', (select id from public.client_portal_accounts where username = 'portal.v120'));
update public.business_setup_onboarding_forms set case_id = pg_temp.cid('v_input'), status = 'Submitted' where client_id = 'CL972010';
create function pg_temp.view_stages(p_view text) returns text[] language sql security definer as $$
  select coalesce(array_agg(distinct e ->> 'stage'), '{}') from jsonb_array_elements(public.business_setup_case_list(p_view)) e $$;
create function pg_temp.view_has(p_view text, p_key text) returns boolean language sql security definer as $$
  select exists (select 1 from jsonb_array_elements(public.business_setup_case_list(p_view)) e where e ->> 'id' = pg_temp.fx(p_key)) $$;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('view leads: Lead and Review only', pg_temp.view_stages('leads') <@ array['Lead', 'Review'] and pg_temp.view_has('leads', 'v_mine') and pg_temp.view_has('leads', 'v_other') and not pg_temp.view_has('leads', 'lo'));
select public.bs_check('view assigned: only my own cases', pg_temp.view_has('assigned', 'v_mine') and not pg_temp.view_has('assigned', 'v_other') and pg_temp.view_stages('assigned') <@ array['Lead', 'Review']);
select public.bs_check('view inputs: only a case with a submitted form', pg_temp.view_has('inputs', 'v_input') and not pg_temp.view_has('inputs', 'v_mine'));
select public.bs_check('view onboarding, pipeline, completion, closed', pg_temp.view_stages('onboarding') = array['Onboarding'] and pg_temp.view_stages('pipeline') = array['Pipeline']
  and pg_temp.view_stages('completion') <@ array['Completion', 'With Accounts'] and pg_temp.view_has('completion', 'lw') and pg_temp.view_stages('closed') = array['Lost'] and pg_temp.view_has('closed', 'lo'));
select public.bs_check('every row keeps the old keys and adds referred_by_name', (select bool_and(e ?& array['id', 'case_number', 'stage', 'client_id', 'owner_id', 'source', 'lead_name', 'client_name', 'owner_name', 'docs', 'reassign', 'referred_by_name'])
  from jsonb_array_elements(public.business_setup_case_list('leads')) e));
select public.bs_expect_error($$select public.business_setup_case_list('bogus')$$, 'Unknown view');
select public.bs_as(null);

-- ── Other callers of the old stage names ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f120 values ('kyc_new', public.business_setup_case_new('{"lead_name":"Returning Client","client_id":"CL972002"}')::text);
select public.bs_check('a lead for a client whose KYC is done still starts at Lead: only the owner moves it', pg_temp.stage('kyc_new') = 'Lead');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('dashboard keeps every top-level key', (select array(select jsonb_object_keys(public.business_setup_dashboard()))) @> array['forms_waiting', 'open_quotes', 'accepted_without_letter', 'outstanding',
  'active_services', 'expiries', 'processes_pending', 'receivables', 'advances', 'cases_completed_month', 'cases_completed_total', 'pipeline', 'forms_to_review', 'pending_after_kyc']);
select public.bs_check('dashboard pipeline counts the six open stages', (select array(select jsonb_object_keys(public.business_setup_dashboard() -> 'pipeline')) @> array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts']));
select public.bs_check('dashboard pipeline counts are real', (public.business_setup_dashboard() -> 'pipeline' ->> 'Onboarding')::int >= 1 and (public.business_setup_dashboard() -> 'pipeline' ->> 'Pipeline')::int >= 1);
select public.bs_as(null);

-- ── A rejected quote is not a quote, and adds no balance ──
select pg_temp.mkcase('rej', 'CL972001', 'Onboarding');
select pg_temp.mkquote('rej_q', 'T120-REJ', 'CL972001', pg_temp.cid('rej'), 'rejected', 800);
select public.bs_check('rejected only: quote item open and no balance', not (pg_temp.docs('rej') ->> 'quote')::boolean and (pg_temp.docs('rej') ->> 'balance')::numeric = 0);
select pg_temp.mkcase('rej2', 'CL972001', 'Onboarding');
select pg_temp.mkquote('rej2_q', 'T120-REJ2', 'CL972001', pg_temp.cid('rej2'), 'rejected', 800);
select pg_temp.mkquote('rej2_q2', 'T120-REJ2B', 'CL972001', pg_temp.cid('rej2'), 'issued', 300);
select public.bs_check('a live quote beside a rejected one sets the balance', (pg_temp.docs('rej2') ->> 'quote')::boolean and (pg_temp.docs('rej2') ->> 'balance')::numeric = 300);

-- ── Handover to Accounts drives Completion, With Accounts and Completed ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select (public.business_setup_dashboard() ->> 'cases_completed_total')::numeric as ct0, (public.business_setup_dashboard() ->> 'cases_completed_month')::numeric as cm0 \gset
select public.bs_as(null);
select pg_temp.mkcase('ho', 'CL972002', 'Pipeline');
select pg_temp.mkquote('ho_q', 'T120-HO', 'CL972002', pg_temp.cid('ho'), 'accepted');
select pg_temp.mkservice('CL972002', 'ho_q', 'Completed');
select public.business_setup_case_sync(pg_temp.cid('ho'));
select public.bs_check('handover: all services closed puts the case at Completion', pg_temp.stage('ho') = 'Completion');
insert into public.business_setup_handovers (quote_id, status, sent_at) values (pg_temp.cid('ho_q'), 'With Accounts', now());
select public.bs_check('handover: send moves it to With Accounts', pg_temp.stage('ho') = 'With Accounts');
update public.business_setup_handovers set status = 'Reverted' where quote_id = pg_temp.cid('ho_q');
select public.bs_check('handover: revert returns it to Completion', pg_temp.stage('ho') = 'Completion');
update public.business_setup_handovers set status = 'With Accounts' where quote_id = pg_temp.cid('ho_q');
select public.bs_check('handover: sent again, With Accounts', pg_temp.stage('ho') = 'With Accounts');
update public.business_setup_handovers set status = 'Closed' where quote_id = pg_temp.cid('ho_q');
select public.bs_check('handover: close moves it to Completed', pg_temp.stage('ho') = 'Completed');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('handover: the dashboard counts the closed case', (public.business_setup_dashboard() ->> 'cases_completed_total')::numeric = :ct0 + 1 and (public.business_setup_dashboard() ->> 'cases_completed_month')::numeric = :cm0 + 1);
select public.bs_as(null);


-- ═════════════════════════════════════════════════════════════════════
-- Client flow Task 3: acceptance records, and the login issued with the quote
-- ═════════════════════════════════════════════════════════════════════
-- The earlier checks stand a record behind every letter put on a case by hand (the helper trigger of 010). Here the real record is tested, so it goes.
drop trigger if exists aaa_bs_letter on public.hub_documents;
create function pg_temp.mkdq(p_key text, p_client text, p_case text, p_valid date default null, p_revises text default null) returns void language plpgsql as $$
begin
  perform public.bs_as('00000000-0000-0000-0000-00000000000c');
  insert into f120 values (p_key, (public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', p_client || ' LLC', 'contact_name', 'C',
    'contact_email', 'c@x.ae', 'contact_phone', '1', 'client_id', p_client, 'case_id', pg_temp.fx(p_case), 'valid_until', p_valid, 'revises_id', p_revises,
    'lines', '[{"description":"Licence","amount":1000},{"description":"Visa","amount":500}]'::jsonb))).id::text);
  perform public.bs_as(null);
end $$;
create function pg_temp.mkletter(p_key text, p_quote text) returns void language plpgsql as $$
begin
  perform public.bs_as('00000000-0000-0000-0000-00000000000c');
  insert into f120 values (p_key, (public.hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx(p_quote)))).id::text);
  perform public.bs_as(null);
end $$;
create function pg_temp.decide(p_acc text, p_doc text, p_decision text, p_note text default null) returns void language plpgsql as $$
begin perform public.business_setup_portal_decide(pg_temp.fx(p_acc)::uuid, pg_temp.fx(p_doc)::uuid, p_decision, p_note); end $$;
create function pg_temp.acc_rows(p_doc text) returns bigint language plpgsql security definer as $$
begin return (select count(*) from public.business_setup_acceptances where document_id = pg_temp.fx(p_doc)::uuid); end $$;
create function pg_temp.svc_count(p_quote text, p_status text default null) returns bigint language sql security definer as $$
  select count(*) from public.business_setup_services where quote_id = pg_temp.fx(p_quote)::uuid and (p_status is null or status = p_status) $$;
select pg_temp.mkclient('CL973001');
select pg_temp.mkclient('CL973002');
update public.client_master set data = jsonb_build_object('General Email', 'cm973@x.ae') where client_id = 'CL973002';
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL973001', 'Done'), ('CL973002', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, email) values ('CL973001', 'A', 'portal.a973', 'x', 'a@x.ae'), ('CL973002', 'B', 'portal.b973', 'x', 'b@x.ae');
insert into f120 select 't3_acc_a', id::text from public.client_portal_accounts where username = 'portal.a973';
insert into f120 select 't3_acc_b', id::text from public.client_portal_accounts where username = 'portal.b973';

-- ── revoked: an account that is revoked is not a login ──
select pg_temp.mkcase('t3_rev', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select public.bs_check('revoked: an active account is a login', (pg_temp.docs('t3_rev') ->> 'login')::boolean);
update public.client_portal_accounts set status = 'revoked' where username = 'portal.a973';
select public.bs_check('revoked: a revoked account has login false', not (pg_temp.docs('t3_rev') ->> 'login')::boolean);
update public.client_portal_accounts set status = 'active' where username = 'portal.a973';
select public.bs_check('revoked: restoring it makes login true again', (pg_temp.docs('t3_rev') ->> 'login')::boolean);

-- ── who may call ──
select public.bs_check('decide, login_grant and login_mail are for the service role only',
  not has_function_privilege('anon', 'public.business_setup_portal_decide(uuid, uuid, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.business_setup_portal_decide(uuid, uuid, text, text)', 'execute')
  and has_function_privilege('service_role', 'public.business_setup_portal_decide(uuid, uuid, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_login_grant(text, text, text, text, uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_login_grant(text, text, text, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_login_mail(text, boolean, uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_login_mail(text, boolean, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.business_setup_issue_login_ok(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_issue_login_ok(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_quote_accept_body(uuid, boolean)', 'execute'));
select public.bs_check('the acceptance table is read-only through the API', not has_table_privilege('authenticated', 'public.business_setup_acceptances', 'insert') and not has_table_privilege('authenticated', 'public.business_setup_acceptances', 'update')
  and not has_table_privilege('authenticated', 'public.business_setup_acceptances', 'delete') and not has_table_privilege('anon', 'public.business_setup_acceptances', 'select'));

-- ── decide_quote: Accepted calls the accept logic, creates the services, stores the login and the revision ──
select pg_temp.mkcase('t3_a', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qa', 'CL973001', 't3_a');
select public.bs_expect_error(format($$select pg_temp.decide('t3_acc_b', 't3_qa', 'Accepted')$$), 'Document not found');
select public.bs_check('decide_own_only: nothing was recorded and the quote is still issued', pg_temp.acc_rows('t3_qa') = 0 and (select status = 'issued' from public.hub_documents where id = pg_temp.fx('t3_qa')::uuid));
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qa', 'Maybe')$$, 'Accept or Reject');
select pg_temp.decide('t3_acc_a', 't3_qa', 'Accepted');
select public.bs_check('decide_quote: the quote is accepted and its two services exist', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('t3_qa')::uuid) and pg_temp.svc_count('t3_qa') = 2);
select public.bs_check('decide_quote: the record holds the login, revision and source', (select count(*) = 1 and bool_and(kind = 'Quote' and decision = 'Accepted' and source = 'Portal' and username = 'portal.a973' and account_id = pg_temp.fx('t3_acc_a')::uuid and revision = 0 and signed_quote_id is null)
  from public.business_setup_acceptances where document_id = pg_temp.fx('t3_qa')::uuid));
select public.bs_check('decide_quote: the case reads quote accepted and moves nowhere yet', (pg_temp.docs('t3_a') ->> 'quote_accepted')::boolean and pg_temp.stage('t3_a') = 'Onboarding');
select public.bs_check('decide_quote: the decision is audited without a password', public.bs_audit_count('portal_decide', null, '{"decision":"Accepted","username":"portal.a973"}') = 1);
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qa', 'Accepted')$$, 'already been recorded');
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qa', 'Rejected', 'Changed my mind')$$, 'already been recorded');
select public.bs_check('decide_twice: still one record and two services', pg_temp.acc_rows('t3_qa') = 1 and pg_temp.svc_count('t3_qa') = 2);
select public.bs_expect_error($$update public.business_setup_acceptances set note = 'x'$$, 'cannot be changed');
select public.bs_expect_error($$delete from public.business_setup_acceptances$$, 'cannot be changed');

-- ── letter: needs the accepted quote, then the client decides on it; the last decision moves the case ──
select pg_temp.mkletter('t3_la', 't3_qa');
select public.bs_check('letter: it is issued but not accepted', (pg_temp.docs('t3_a') ->> 'letter')::boolean and not (pg_temp.docs('t3_a') ->> 'letter_accepted')::boolean);
update public.business_setup_cases set invoice_override_reason = 'Invoiced outside the CRM' where id = pg_temp.cid('t3_a');
select public.bs_check('letter: with everything but the letter decision the case waits at Onboarding', pg_temp.stage('t3_a') = 'Onboarding');
select pg_temp.decide('t3_acc_a', 't3_la', 'Accepted');
select public.bs_check('letter: the record is a Letter record with the quote''s revision', (select kind = 'Letter' and revision = 0 and source = 'Portal' from public.business_setup_acceptances where document_id = pg_temp.fx('t3_la')::uuid));
select public.bs_check('letter: the last decision moves the case to Pipeline by itself', (pg_temp.docs('t3_a') ->> 'letter_accepted')::boolean and pg_temp.stage('t3_a') = 'Pipeline');

-- ── letter_order: a letter decision is refused before the quote is accepted ──
select pg_temp.mkcase('t3_lo', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qlo', 'CL973001', 't3_lo');
insert into public.hub_documents (parent_id, doc_type, department, client_name, client_id, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, client_id, 'T3-LO-L', case_id from public.hub_documents where id = pg_temp.fx('t3_qlo')::uuid;
insert into f120 select 't3_llo', id::text from public.hub_documents where document_number = 'T3-LO-L';
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_llo', 'Accepted')$$, 'accept the quote');
select public.bs_check('letter_order: nothing was recorded for the letter', pg_temp.acc_rows('t3_llo') = 0);

-- ── decide_reject: needs a note, creates no service, leaves the quote open ──
select pg_temp.mkcase('t3_r', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qr', 'CL973001', 't3_r');
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qr', 'Rejected')$$, 'why');
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qr', 'Rejected', '   ')$$, 'why');
select public.bs_check('decide_reject: a refused attempt records nothing', pg_temp.acc_rows('t3_qr') = 0);
select pg_temp.decide('t3_acc_a', 't3_qr', 'Rejected', 'The fee is too high');
select public.bs_check('decide_reject: the note is kept, no service is made and the quote is not accepted', (select decision = 'Rejected' and note = 'The fee is too high' from public.business_setup_acceptances where document_id = pg_temp.fx('t3_qr')::uuid)
  and pg_temp.svc_count('t3_qr') = 0 and (select status = 'issued' from public.hub_documents where id = pg_temp.fx('t3_qr')::uuid) and not (pg_temp.docs('t3_r') ->> 'quote_accepted')::boolean);
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qr', 'Accepted')$$, 'already been recorded');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('decide_reject: staff can read the note', (select note = 'The fee is too high' from public.business_setup_acceptances where document_id = pg_temp.fx('t3_qr')::uuid));
select public.bs_as(null);

-- ── decide_expired ──
select pg_temp.mkcase('t3_x', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qx', 'CL973001', 't3_x');
update public.hub_documents set valid_until = current_date - 2 where id = pg_temp.fx('t3_qx')::uuid;
select public.bs_expect_error($$select pg_temp.decide('t3_acc_a', 't3_qx', 'Accepted')$$, 'expired');
select public.bs_check('decide_expired: nothing recorded and no service', pg_temp.acc_rows('t3_qx') = 0 and pg_temp.svc_count('t3_qx') = 0 and (select status = 'issued' from public.hub_documents where id = pg_temp.fx('t3_qx')::uuid));
select public.bs_check('decide_expired: the portal marks it expired and not open for a decision', (public.business_setup_portal_view(pg_temp.fx('t3_acc_a')::uuid) -> 'quotes') @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('t3_qx'), 'expired', true, 'can_decide', false)));

-- ── revise_clears: revising an accepted quote starts a fresh decision for the quote and its letter; the case stays at Onboarding ──
select pg_temp.mkcase('t3_v', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qv', 'CL973001', 't3_v');
select pg_temp.decide('t3_acc_a', 't3_qv', 'Accepted');
select pg_temp.mkletter('t3_lv', 't3_qv');
select pg_temp.decide('t3_acc_a', 't3_lv', 'Accepted');
select public.bs_check('revise_clears: before revising, the quote and letter are accepted', (pg_temp.docs('t3_v') ->> 'quote_accepted')::boolean and (pg_temp.docs('t3_v') ->> 'letter_accepted')::boolean and pg_temp.svc_count('t3_qv', 'Not started') = 2);
select pg_temp.mkdq('t3_qv2', 'CL973001', 't3_v', null, pg_temp.fx('t3_qv'));
select public.bs_check('revise_clears: the old quote is superseded and its unstarted services are cancelled, with history', (select status = 'superseded' from public.hub_documents where id = pg_temp.fx('t3_qv')::uuid)
  and pg_temp.svc_count('t3_qv', 'Cancelled') = 2 and pg_temp.svc_count('t3_qv', 'Not started') = 0
  and (select count(*) = 2 from public.business_setup_service_history h join public.business_setup_services s on s.id = h.service_id where s.quote_id = pg_temp.fx('t3_qv')::uuid and h.to_status = 'Cancelled'));
select public.bs_check('revise_clears: the case shows no accepted quote and no accepted letter, and stays at Onboarding', not (pg_temp.docs('t3_v') ->> 'quote_accepted')::boolean and not (pg_temp.docs('t3_v') ->> 'letter_accepted')::boolean
  and not (pg_temp.docs('t3_v') ->> 'letter')::boolean and (pg_temp.docs('t3_v') ->> 'quote')::boolean and pg_temp.stage('t3_v') = 'Onboarding');
select public.bs_check('revise_clears: the earlier records are kept and the new revision has none', pg_temp.acc_rows('t3_qv') = 1 and pg_temp.acc_rows('t3_lv') = 1 and pg_temp.acc_rows('t3_qv2') = 0);
select pg_temp.decide('t3_acc_a', 't3_qv2', 'Accepted');
select public.bs_check('revise_clears: the new revision is decided again, as revision 1, with services of its own', (select revision = 1 from public.business_setup_acceptances where document_id = pg_temp.fx('t3_qv2')::uuid) and pg_temp.svc_count('t3_qv2') = 2
  and (pg_temp.docs('t3_v') ->> 'quote_accepted')::boolean and not (pg_temp.docs('t3_v') ->> 'letter_accepted')::boolean);
select pg_temp.mkletter('t3_lv2', 't3_qv2');
select public.bs_check('revise_clears: the new letter needs its own acceptance', not (pg_temp.docs('t3_v') ->> 'letter_accepted')::boolean and pg_temp.acc_rows('t3_lv2') = 0);

-- ── revise_after_start: refused once a service has started ──
select pg_temp.mkcase('t3_s', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qs', 'CL973001', 't3_s');
select pg_temp.decide('t3_acc_a', 't3_qs', 'Accepted');
update public.business_setup_services set started_at = now() where id = (select id from public.business_setup_services where quote_id = pg_temp.fx('t3_qs')::uuid order by name limit 1);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', 'x', 'contact_name', 'C', 'contact_email', 'c@x.ae', 'contact_phone', '1',
  'client_id', 'CL973001', 'case_id', '%s', 'revises_id', '%s', 'lines', '[{"description":"Licence","amount":900}]'::jsonb))$$, pg_temp.fx('t3_s'), pg_temp.fx('t3_qs')), 'has started');
select public.bs_as(null);
select public.bs_check('revise_after_start: the quote stays accepted with its services', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('t3_qs')::uuid) and pg_temp.svc_count('t3_qs', 'Not started') = 2 and pg_temp.svc_count('t3_qs') = 2);
update public.business_setup_services set started_at = null where quote_id = pg_temp.fx('t3_qs')::uuid;
update public.business_setup_services set status = 'In progress' where id = (select id from public.business_setup_services where quote_id = pg_temp.fx('t3_qs')::uuid order by name limit 1);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', 'x', 'contact_name', 'C', 'contact_email', 'c@x.ae', 'contact_phone', '1',
  'client_id', 'CL973001', 'case_id', '%s', 'revises_id', '%s', 'lines', '[{"description":"Licence","amount":900}]'::jsonb))$$, pg_temp.fx('t3_s'), pg_temp.fx('t3_qs')), 'has started');
select public.bs_as(null);

-- ── staff_signed: a staff-uploaded signed copy, confirmed, writes a Staff record for a quote and for a letter ──
select pg_temp.mkcase('t3_g', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qg', 'CL973001', 't3_g');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f120 values ('t3_sg1', public.business_setup_signed_add(pg_temp.fx('t3_qg')::uuid, 'staff/CL973001/quote-g.pdf')::text);
select public.business_setup_signed_decide(pg_temp.fx('t3_sg1')::uuid, true, null);
select public.bs_as(null);
select public.bs_check('staff_signed: the quote is accepted and has one Staff record linked to the signed copy', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('t3_qg')::uuid)
  and (select count(*) = 1 and bool_and(kind = 'Quote' and source = 'Staff' and decision = 'Accepted' and signed_quote_id = pg_temp.fx('t3_sg1')::uuid and account_id is null) from public.business_setup_acceptances where document_id = pg_temp.fx('t3_qg')::uuid)
  and pg_temp.svc_count('t3_qg') = 2);
select pg_temp.mkletter('t3_lg', 't3_qg');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f120 values ('t3_sg2', public.business_setup_signed_add(pg_temp.fx('t3_lg')::uuid, 'staff/CL973001/letter-g.pdf')::text);
select public.bs_check('staff_signed: the letter''s copy is kept in the same table with kind Letter', (select kind = 'Letter' and source = 'Staff' and status = 'Uploaded' from public.business_setup_signed_quotes where id = pg_temp.fx('t3_sg2')::uuid));
select public.business_setup_signed_decide(pg_temp.fx('t3_sg2')::uuid, true, null);
select public.bs_as(null);
select public.bs_check('staff_signed: the letter has one Staff record and nothing else was accepted', (select count(*) = 1 and bool_and(kind = 'Letter' and source = 'Staff' and signed_quote_id = pg_temp.fx('t3_sg2')::uuid) from public.business_setup_acceptances where document_id = pg_temp.fx('t3_lg')::uuid)
  and (pg_temp.docs('t3_g') ->> 'letter_accepted')::boolean and pg_temp.svc_count('t3_qg') = 2);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_signed_add('%s', 'staff/CL973001/letter-g2.pdf')$$, pg_temp.fx('t3_lg')), 'already accepted');
select public.bs_as(null);
-- A letter of a quote that is not accepted takes no signed copy.
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_signed_add('%s', 'staff/CL973001/letter-lo.pdf')$$, pg_temp.fx('t3_llo')), 'must be accepted');
select public.bs_as(null);

-- ── sync: a case that waits only on its login, or only on KYC, moves when that changes ──
select pg_temp.mkclient('CL973003');
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL973003', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select pg_temp.mkcase('t3_y', 'CL973003', 'Onboarding');
select pg_temp.mkquote('t3_y_q', 'T3-Y-Q', 'CL973003', pg_temp.cid('t3_y'), 'accepted', 800);
insert into public.hub_documents (parent_id, doc_type, department, client_name, client_id, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, client_id, 'T3-Y-L', case_id from public.hub_documents where id = pg_temp.fx('t3_y_q')::uuid;
insert into f120 select 't3_y_l', id::text from public.hub_documents where document_number = 'T3-Y-L';
insert into public.business_setup_signed_quotes (quote_id, source, status, note, decided_at, kind) values (pg_temp.fx('t3_y_l')::uuid, 'Legacy', 'Confirmed', 'test', now(), 'Letter');
insert into public.business_setup_acceptances (document_id, kind, revision, decision, source, signed_quote_id)
  select pg_temp.fx('t3_y_l')::uuid, 'Letter', 0, 'Accepted', 'Staff', id from public.business_setup_signed_quotes where quote_id = pg_temp.fx('t3_y_l')::uuid;
update public.business_setup_cases set invoice_override_reason = 'Outside the CRM' where id = pg_temp.cid('t3_y');
select public.bs_check('sync_login: everything but the login is met and the case waits', pg_temp.stage('t3_y') = 'Onboarding' and not (pg_temp.docs('t3_y') ->> 'login')::boolean
  and (pg_temp.docs('t3_y') ->> 'quote_accepted')::boolean and (pg_temp.docs('t3_y') ->> 'letter_accepted')::boolean);
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL973003', 'Y', 'portal.y973', 'x');
select public.bs_check('sync_login: issuing the login moves the case to Pipeline without any other change', pg_temp.stage('t3_y') = 'Pipeline');
select pg_temp.mkclient('CL973004');
select pg_temp.mkcase('t3_k', 'CL973004', 'Onboarding');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL973004', 'K', 'portal.k973', 'x');
select pg_temp.mkquote('t3_k_q', 'T3-K-Q', 'CL973004', pg_temp.cid('t3_k'), 'accepted', 800);
insert into public.hub_documents (parent_id, doc_type, department, client_name, client_id, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, client_id, 'T3-K-L', case_id from public.hub_documents where id = pg_temp.fx('t3_k_q')::uuid;
insert into f120 select 't3_k_l', id::text from public.hub_documents where document_number = 'T3-K-L';
insert into public.business_setup_signed_quotes (quote_id, source, status, note, decided_at, kind) values (pg_temp.fx('t3_k_l')::uuid, 'Legacy', 'Confirmed', 'test', now(), 'Letter');
insert into public.business_setup_acceptances (document_id, kind, revision, decision, source, signed_quote_id)
  select pg_temp.fx('t3_k_l')::uuid, 'Letter', 0, 'Accepted', 'Staff', id from public.business_setup_signed_quotes where quote_id = pg_temp.fx('t3_k_l')::uuid;
update public.business_setup_cases set invoice_override_reason = 'Outside the CRM' where id = pg_temp.cid('t3_k');
select public.bs_check('sync_kyc: everything but KYC is met and the case waits', pg_temp.stage('t3_k') = 'Onboarding' and not (pg_temp.docs('t3_k') ->> 'fields')::boolean);
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL973004', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select public.bs_check('sync_kyc: KYC turning Done moves the case to Pipeline', pg_temp.stage('t3_k') = 'Pipeline');
-- A form with no case is left alone.
select pg_temp.mkclient('CL973005');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL973005', 'N', 'portal.n973', 'x');
select public.business_setup_form_create('CL973005', (select id from public.client_portal_accounts where username = 'portal.n973'));
update public.business_setup_onboarding_forms set status = 'Submitted' where client_id = 'CL973005';
select public.bs_check('a form with no case is left alone', (select case_id is null from public.business_setup_onboarding_forms where client_id = 'CL973005'));

-- ── issue_login_ok and the login grant ──
select pg_temp.mkcase('t3_n', 'CL973002', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3_n')), 'Issue the quote first');
select public.bs_as(null);
select pg_temp.mkdq('t3_qn', 'CL973002', 't3_n');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('login_ok: the keys are client_id, email and has_login, and the Client Master address is used, not the quote contact''s', (select array_agg(k order by k) = array['client_id', 'email', 'has_login'] from jsonb_object_keys(public.business_setup_issue_login_ok(pg_temp.cid('t3_n'))) k)
  and public.business_setup_issue_login_ok(pg_temp.cid('t3_n')) ->> 'email' = 'cm973@x.ae' and public.business_setup_issue_login_ok(pg_temp.cid('t3_n')) ->> 'client_id' = 'CL973002');
select public.bs_check('login_ok: an active login is reported', (public.business_setup_issue_login_ok(pg_temp.cid('t3_n')) ->> 'has_login')::boolean);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3_n')), 'permission');
select public.bs_as(null);
select public.t_anon_refused('login_perm: anon is refused', format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3_n')));
-- A client with no login: issue it, then issue again.
select pg_temp.mkclient('CL973006');
update public.client_master set data = jsonb_build_object('General Email', 'cm973@x.ae') where client_id = 'CL973006';
select pg_temp.mkcase('t3_i', 'CL973006', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3_qi', 'CL973006', 't3_i');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('login_ok: no login yet', not (public.business_setup_issue_login_ok(pg_temp.cid('t3_i')) ->> 'has_login')::boolean);
select public.bs_as(null);
select public.business_setup_login_grant('CL973006', 'Login.I973', 'Zx7mKq2WpR9tVn', 'i@x.ae', '00000000-0000-0000-0000-00000000000c') as g1 \gset
select public.bs_check('login_once: the first issue creates the login, lower-cased, with the email', (:'g1'::jsonb ->> 'created')::boolean and :'g1'::jsonb ->> 'username' = 'login.i973' and :'g1'::jsonb ->> 'email' = 'i@x.ae');
select public.bs_check('login_once: the result carries no password', :'g1'::jsonb::text !~* 'password|Zx7mKq2WpR9tVn');
select password_hash as h1 from public.client_portal_accounts where client_master_id = 'CL973006' \gset
select public.business_setup_login_grant('CL973006', 'another.name', 'Different-Pass-1', 'other@x.ae', null) as g2 \gset
select public.bs_check('login_once: the second issue makes no second account and changes nothing', not (:'g2'::jsonb ->> 'created')::boolean and (select count(*) = 1 from public.client_portal_accounts where client_master_id = 'CL973006')
  and (select password_hash = :'h1' and username = 'login.i973' and email = 'i@x.ae' from public.client_portal_accounts where client_master_id = 'CL973006'));
select public.bs_check('login_once: the vault copy is the password issued, and the case sees a login', exists (select 1 from vault.decrypted_secrets where name = 'client_portal_pw:' || (select id from public.client_portal_accounts where client_master_id = 'CL973006') and decrypted_secret = 'Zx7mKq2WpR9tVn')
  and (pg_temp.docs('t3_i') ->> 'login')::boolean);
select public.bs_check('login_once: the password is in no audit row', not exists (select 1 from public.business_setup_audit_log where new_data::text like '%Zx7mKq2WpR9tVn%' or old_data::text like '%Zx7mKq2WpR9tVn%')
  and not exists (select 1 from public.admin_audit where detail::text like '%Zx7mKq2WpR9tVn%') and public.bs_audit_count('login_issue', (select id::text from public.client_portal_accounts where client_master_id = 'CL973006'), '{"username":"login.i973"}') = 1);
select public.bs_expect_error($$select public.business_setup_login_grant('CL973006', 'ab', 'Zx7mKq2WpR9tVn', 'i@x.ae', null)$$, 'Username needs');
select public.bs_expect_error($$select public.business_setup_login_grant('CL973006', 'taken.name', 'short', 'i@x.ae', null)$$, 'at least 10');
-- A revoked login is not restored by issuing: the grant refuses it and nothing changes.
update public.client_portal_accounts set status = 'revoked' where client_master_id = 'CL973006';
select public.bs_expect_error($$select public.business_setup_login_grant('CL973006', 'login.i973', 'Nw8pLm3XcV5qTz', 'i@x.ae', null)$$, 'was revoked');
select public.bs_check('login_once: a revoked login stays as it was (hash, status), still one account', (select count(*) = 1 and bool_and(status = 'revoked' and password_hash = :'h1') from public.client_portal_accounts where client_master_id = 'CL973006'));
update public.client_portal_accounts set status = 'active' where client_master_id = 'CL973006';
-- login_mail: the username and name alone, or with the stored password for Resend.
select public.bs_check('login_mail: without the password it has none', not (public.business_setup_login_mail('CL973006', false, null) ? 'password') and public.business_setup_login_mail('CL973006', false, null) ->> 'username' = 'login.i973');
select public.bs_check('login_mail: with the password it returns the stored one', public.business_setup_login_mail('CL973006', true, null) ->> 'password' = 'Zx7mKq2WpR9tVn');
select public.bs_check('login_mail: the read is logged without the password', exists (select 1 from public.admin_audit where action = 'client_portal_password_emailed' and target = 'login.i973' and detail::text !~ 'Zx7mKq2WpR9tVn'));
select public.bs_check('login_mail: a client with no login gives nothing', public.business_setup_login_mail('CL973099', true, null) is null);


-- ═════════════════════════════════════════════════════════════════════
-- Task 3, fix round 1
-- ═════════════════════════════════════════════════════════════════════
insert into public.profiles (id, full_name, role) values ('00000000-0000-0000-0000-00000000000f', 'Sales Two', 'member') on conflict do nothing;
insert into public.business_setup_staff (user_id, role) values ('00000000-0000-0000-0000-00000000000f', 'SALES_EXECUTIVE') on conflict do nothing;

-- ── critical 1: a revoked login is not restored by issuing ──
select pg_temp.mkclient('CL973010');
update public.client_master set data = jsonb_build_object('General Email', 'cm973@x.ae') where client_id = 'CL973010';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, email, status) values ('CL973010', 'R', 'portal.r973', 'x', 'r@x.ae', 'revoked');
select pg_temp.mkcase('t3f_rv', 'CL973010', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qrv', 'CL973010', 't3f_rv');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3f_rv')), 'was revoked. Ask an administrator to restore it');
select public.bs_as(null);
select public.bs_expect_error($$select public.business_setup_login_grant('CL973010', 'portal.r973', 'Ab3dEf7hJk9mNp', 'evil@x.ae', null)$$, 'was revoked');
select public.bs_check('revoked: the account keeps its username, hash, email and status', (select username = 'portal.r973' and password_hash = 'x' and email = 'r@x.ae' and status = 'revoked' from public.client_portal_accounts where client_master_id = 'CL973010'));

-- ── important 1: reach, and the address comes from Client Master only ──
select pg_temp.mkclient('CL973011');
update public.client_master set data = jsonb_build_object('General Email', 'cm973@x.ae') where client_id = 'CL973011';
select pg_temp.mkcase('t3f_ow', 'CL973011', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qow', 'CL973011', 't3f_ow');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('reach: the owner passes, and the address is the Client Master one, not the quote''s contact_email (c@x.ae)', public.business_setup_issue_login_ok(pg_temp.cid('t3f_ow')) ->> 'email' = 'cm973@x.ae');
select public.bs_as('00000000-0000-0000-0000-00000000000f');
select public.bs_expect_error(format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3f_ow')), 'Only the owner');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('reach: a manager (setup.cases.approve) passes', public.business_setup_issue_login_ok(pg_temp.cid('t3f_ow')) ->> 'client_id' = 'CL973011');
select public.bs_as(null);
-- No email in Client Master: refused, even though the quote has a contact_email.
select pg_temp.mkclient('CL973012');
update public.client_master set data = '{}' where client_id = 'CL973012';
select pg_temp.mkcase('t3f_ne', 'CL973012', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qne', 'CL973012', 't3f_ne');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_issue_login_ok('%s')$$, pg_temp.fx('t3f_ne')), 'Add the client''s email in Client Master first.');
select public.bs_as(null);

-- ── minor 1: a Banking-linked client's new login is linked to its Banking record; minor 9: admin_audit ──
insert into public.banking_clients (display_name, client_master_id, link_status) values ('Banked 973', 'CL973012', 'Linked');
update public.client_master set data = jsonb_build_object('General Email', 'cm973@x.ae') where client_id = 'CL973012';
select public.business_setup_login_grant('CL973012', 'banked.973', 'Qw4rTy8uIo2pAs', 'cm973@x.ae', '00000000-0000-0000-0000-00000000000c') as gb \gset
select public.bs_check('banking_link: the new login also carries the Banking client id', (select banking_client_id = (select id from public.banking_clients where client_master_id = 'CL973012') and client_master_id = 'CL973012' from public.client_portal_accounts where username = 'banked.973'));
select public.bs_check('admin_audit: client_portal_create is written without the password', exists (select 1 from public.admin_audit where action = 'client_portal_create' and target = 'banked.973' and detail::text !~ 'Qw4rTy8uIo2pAs'));

-- ── minor 10: an active account wins over a revoked one for the same client ──
select pg_temp.mkclient('CL973013');
insert into public.banking_clients (display_name, client_master_id, link_status) values ('Banked 973b', 'CL973013', 'Linked');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL973013', 'X', 'portal.x973', 'x', 'revoked');
insert into public.client_portal_accounts (banking_client_id, display_name, username, password_hash) select id, 'Y', 'portal.y973b', 'x' from public.banking_clients where client_master_id = 'CL973013';
select public.bs_check('portal_account: the active account wins', (select username = 'portal.y973b' from public.client_portal_accounts where id = public.business_setup_portal_account('CL973013')));

-- ── minor 2: a payment on the old quote counts on the revised quote, and outstanding never goes below zero ──
select pg_temp.mkcase('t3f_p', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qp', 'CL973001', 't3f_p');
select pg_temp.decide('t3_acc_a', 't3f_qp', 'Accepted');
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, case_id) values ('CL973001', pg_temp.fx('t3f_qp')::uuid, current_date, 400, 'Payment', pg_temp.cid('t3f_p'));
select pg_temp.mkdq('t3f_qp2', 'CL973001', 't3f_p', null, pg_temp.fx('t3f_qp'));
select public.bs_check('revise_payment: a payment on the old quote counts on the revised one', public.business_setup_net_paid(pg_temp.fx('t3f_qp2')::uuid) = 400);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, case_id) values ('CL973001', pg_temp.fx('t3f_qp2')::uuid, current_date, 5000, 'Payment', pg_temp.cid('t3f_p'));
select public.bs_check('portal_outstanding: an overpaid quote shows zero outstanding, not a negative', (select (e ->> 'outstanding')::numeric = 0 from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx('t3_acc_a')::uuid) -> 'quotes') e where e ->> 'id' = pg_temp.fx('t3f_qp2')));

-- ── minor 3: the services are locked before the started check ──
select public.bs_check('revise_lock: hub_document_create locks the quote''s services before it looks at whether one started',
  position('from business_setup_services' in pg_get_functiondef('public.hub_document_create(jsonb)'::regprocedure)) > 0
  and regexp_replace(substr(pg_get_functiondef('public.hub_document_create(jsonb)'::regprocedure), 1, position('has started' in pg_get_functiondef('public.hub_document_create(jsonb)'::regprocedure))), '\s+', ' ', 'g') ~ 'from business_setup_services[^;]* for update;');

-- ── minor 4: an invoice meets the item only on the live quote; a revision clears the override ──
select pg_temp.mkcase('t3f_i', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qi', 'CL973001', 't3f_i');
select pg_temp.decide('t3_acc_a', 't3f_qi', 'Accepted');
insert into public.business_setup_invoices (client_id, quote_id, case_id, invoice_number, source) values ('CL973001', pg_temp.fx('t3f_qi')::uuid, pg_temp.cid('t3f_i'), 'T3F-INV', 'Manual');
update public.business_setup_cases set invoice_override_reason = 'waived' where id = pg_temp.cid('t3f_i');
select public.bs_check('invoice_revise: before revising, the invoice item is met', (pg_temp.docs('t3f_i') ->> 'invoice')::boolean);
select pg_temp.mkdq('t3f_qi2', 'CL973001', 't3f_i', null, pg_temp.fx('t3f_qi'));
select public.bs_check('invoice_revise: the old quote''s invoice no longer meets the item, and the override is cleared', not (pg_temp.docs('t3f_i') ->> 'invoice')::boolean
  and (select invoice_override_reason is null from public.business_setup_cases where id = pg_temp.cid('t3f_i')));
select pg_temp.decide('t3_acc_a', 't3f_qi2', 'Accepted');
insert into public.business_setup_invoices (client_id, quote_id, case_id, invoice_number, source) values ('CL973001', pg_temp.fx('t3f_qi2')::uuid, pg_temp.cid('t3f_i'), 'T3F-INV2', 'Manual');
select public.bs_check('invoice_revise: an invoice on the live quote meets it again', (pg_temp.docs('t3f_i') ->> 'invoice')::boolean);

-- ── minor 6: a rejected letter can be issued again ──
select pg_temp.mkcase('t3f_l', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_ql', 'CL973001', 't3f_l');
select pg_temp.decide('t3_acc_a', 't3f_ql', 'Accepted');
select pg_temp.mkletter('t3f_l1', 't3f_ql');
select pg_temp.decide('t3_acc_a', 't3f_l1', 'Rejected', 'Wrong scope');
select public.bs_check('letter_reject: a rejected letter does not count as the letter', not (pg_temp.docs('t3f_l') ->> 'letter')::boolean and not (pg_temp.docs('t3f_l') ->> 'letter_accepted')::boolean);
select pg_temp.mkletter('t3f_l2', 't3f_ql');
select public.bs_check('letter_reject: a new letter is issued, the old one is superseded, and the portal view still builds', (pg_temp.docs('t3f_l') ->> 'letter')::boolean
  and (select status = 'superseded' from public.hub_documents where id = pg_temp.fx('t3f_l1')::uuid)
  and (public.business_setup_portal_view(pg_temp.fx('t3_acc_a')::uuid) -> 'quotes') @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('t3f_ql'), 'letter', jsonb_build_object('id', pg_temp.fx('t3f_l2'), 'can_decide', true))));
select pg_temp.decide('t3_acc_a', 't3f_l2', 'Accepted');
select public.bs_check('letter_reject: the new letter is decided as its own revision', (select revision = 1 from public.business_setup_acceptances where document_id = pg_temp.fx('t3f_l2')::uuid) and (pg_temp.docs('t3f_l') ->> 'letter_accepted')::boolean);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select pg_temp.mkletter('t3f_l3', 't3f_ql')$$), 'already has its engagement letter');
select public.bs_as(null);

-- ── minor 7: a cancelled service does not block a revision ──
select pg_temp.mkcase('t3f_c', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qc', 'CL973001', 't3f_c');
select pg_temp.decide('t3_acc_a', 't3f_qc', 'Accepted');
update public.business_setup_services set status = 'Cancelled' where id = (select id from public.business_setup_services where quote_id = pg_temp.fx('t3f_qc')::uuid order by name limit 1);
select pg_temp.mkdq('t3f_qc2', 'CL973001', 't3f_c', null, pg_temp.fx('t3f_qc'));
select public.bs_check('revise_cancelled: a staff-cancelled service does not block the revision', (select status = 'superseded' from public.hub_documents where id = pg_temp.fx('t3f_qc')::uuid) and pg_temp.svc_count('t3f_qc', 'Cancelled') = 2);

-- ── minor 8: a letter copy is not confirmed on a closed case ──
select pg_temp.mkcase('t3f_x', 'CL973001', 'Onboarding', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t3f_qx', 'CL973001', 't3f_x');
select pg_temp.decide('t3_acc_a', 't3f_qx', 'Accepted');
select pg_temp.mkletter('t3f_lx', 't3f_qx');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f120 values ('t3f_sx', public.business_setup_signed_add(pg_temp.fx('t3f_lx')::uuid, 'staff/CL973001/letter-x.pdf')::text);
select public.bs_as(null);
update public.business_setup_cases set stage = 'Cancelled' where id = pg_temp.cid('t3f_x');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_signed_decide('%s', true, null)$$, pg_temp.fx('t3f_sx')), 'closed');
select public.bs_as(null);
select public.bs_check('letter_closed: no acceptance was written', pg_temp.acc_rows('t3f_lx') = 0);


-- ── Task 4: payment claims, confirmed by staff ──
select pg_temp.mkclient('CL974001');
select pg_temp.mkclient('CL974002');
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL974001', 'Done'), ('CL974002', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, email) values ('CL974001', 'A', 'portal.a974', 'x', 'a974@x.ae'), ('CL974002', 'B', 'portal.b974', 'x', 'b974@x.ae');
insert into f120 select 't4_acc_a', id::text from public.client_portal_accounts where username = 'portal.a974';
insert into f120 select 't4_acc_b', id::text from public.client_portal_accounts where username = 'portal.b974';
create function pg_temp.qtotal(p_q text) returns numeric language sql security definer as $$ select total_amount from public.hub_documents where id = pg_temp.fx(p_q)::uuid $$;
create function pg_temp.mkinv(p_key text, p_case text, p_amount numeric) returns void language plpgsql as $$
begin
  perform public.bs_as('00000000-0000-0000-0000-00000000000a');
  insert into f120 values (p_key, public.business_setup_invoice_record(jsonb_build_object('case_id', pg_temp.fx(p_case), 'invoice_number', p_key, 'amount', p_amount))::text);
  perform public.bs_as(null);
end $$;
create function pg_temp.claim(p_key text, p_acc text, p_inv text, p jsonb) returns void language plpgsql as $$
begin
  insert into f120 values (p_key, public.business_setup_portal_claim_add(pg_temp.fx(p_acc)::uuid, jsonb_build_object('invoice_id', pg_temp.fx(p_inv)) || p)::text);
end $$;
create function pg_temp.ydate() returns text language sql as $$ select ((now() at time zone 'Asia/Dubai')::date - 1)::text $$;
create function pg_temp.net(p_case text) returns numeric language sql security definer as $$ select public.business_setup_case_net_paid(pg_temp.cid(p_case)) $$;
create function pg_temp.pays(p_case text) returns bigint language sql security definer as $$ select count(*) from public.business_setup_payments where case_id = pg_temp.cid(p_case) $$;
create function pg_temp.vouchers(p_case text) returns bigint language sql security definer as $$
  select count(*) from public.voucher_register v where v.source = 'business_setup' and v.source_id in (select id from public.business_setup_payments where case_id = pg_temp.cid(p_case)) $$;
create function pg_temp.cstatus(p_key text) returns text language sql security definer as $$ select status from public.business_setup_payment_claims where id = pg_temp.fx(p_key)::uuid $$;
create function pg_temp.bal(p_case text) returns numeric language sql security definer as $$ select (public.business_setup_case_docs(pg_temp.cid(p_case)) ->> 'balance')::numeric $$;
create function pg_temp.pclaims(p_acc text) returns jsonb language plpgsql security definer as $$ begin return public.business_setup_portal_claims(pg_temp.fx(p_acc)::uuid); end $$;

select pg_temp.mkcase('t4_ca', 'CL974001', 'Pipeline', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t4_qa', 'CL974001', 't4_ca');
select pg_temp.decide('t4_acc_a', 't4_qa', 'Accepted');
select pg_temp.mkinv('t4_inv_a', 't4_ca', pg_temp.qtotal('t4_qa'));
select pg_temp.mkcase('t4_cb', 'CL974002', 'Pipeline', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t4_qb', 'CL974002', 't4_cb');
select pg_temp.decide('t4_acc_b', 't4_qb', 'Accepted');
select pg_temp.mkinv('t4_inv_b', 't4_cb', pg_temp.qtotal('t4_qb'));
select pg_temp.bal('t4_ca') as bal0 \gset

-- claim_no_balance
select pg_temp.claim('t4_c1', 't4_acc_a', 't4_inv_a', jsonb_build_object('amount', 400, 'paid_on', pg_temp.ydate(), 'reference', 'TT-1'));
select public.bs_check('claim_no_balance: a claim leaves net paid, balance and vouchers unchanged', pg_temp.net('t4_ca') = 0 and pg_temp.bal('t4_ca') = :bal0 and pg_temp.pays('t4_ca') = 0 and pg_temp.vouchers('t4_ca') = 0
  and pg_temp.cstatus('t4_c1') = 'Pending');
select public.bs_check('claim_no_balance: the claim belongs to the invoice and its case', (select case_id = pg_temp.cid('t4_ca') and invoice_id = pg_temp.fx('t4_inv_a')::uuid and account_id = pg_temp.fx('t4_acc_a')::uuid
  from public.business_setup_payment_claims where id = pg_temp.fx('t4_c1')::uuid));
-- rules of a claim
select public.bs_expect_error(format($$select pg_temp.claim('x1', 't4_acc_a', 't4_inv_a', '{"amount":10,"paid_on":"%s"}')$$, pg_temp.ydate()), 'already waiting');
select public.bs_expect_error(format($$select pg_temp.claim('x2', 't4_acc_b', 't4_inv_b', '{"amount":0,"paid_on":"%s"}')$$, pg_temp.ydate()), 'above zero');
select public.bs_expect_error(format($$select pg_temp.claim('x3', 't4_acc_b', 't4_inv_b', '{"amount":-5,"paid_on":"%s"}')$$, pg_temp.ydate()), 'above zero');
select public.bs_expect_error($$select pg_temp.claim('x4', 't4_acc_b', 't4_inv_b', '{"amount":10,"paid_on":"2999-01-01"}')$$, 'future');
select public.bs_expect_error($$select pg_temp.claim('x5', 't4_acc_b', 't4_inv_b', '{"amount":10}')$$, 'date');
select public.bs_expect_error(format($$select pg_temp.claim('x6', 't4_acc_b', 't4_inv_b', '{"amount":10,"paid_on":"%s","proof_path":"incoming/%s/x/p.pdf"}')$$, pg_temp.ydate(), pg_temp.fx('t4_acc_a')), 'proof');
select public.bs_expect_error(format($$select pg_temp.claim('x7', 't4_acc_b', 't4_inv_b', '{"amount":10,"paid_on":"%s","proof_path":"incoming/%s/../%s/x/p.pdf"}')$$, pg_temp.ydate(), pg_temp.fx('t4_acc_b'), pg_temp.fx('t4_acc_a')), 'proof');
select public.bs_expect_error(format($$select pg_temp.claim('x8', 't4_acc_b', 't4_inv_b', '{"amount":10,"paid_on":"%s","proof_path":"incoming/%s/nothing/p.pdf"}')$$, pg_temp.ydate(), pg_temp.fx('t4_acc_b')), 'proof');
select public.bs_check('claim_rules: refused claims wrote no row', (select count(*) from public.business_setup_payment_claims) = 1);
-- claim_other_client
select public.bs_expect_error(format($$select pg_temp.claim('x9', 't4_acc_a', 't4_inv_b', '{"amount":10,"paid_on":"%s"}')$$, pg_temp.ydate()), 'not found');
select public.bs_expect_error(format($$select public.business_setup_portal_claim_add('%s', '{"invoice_id":"not-an-id","amount":10}')$$, pg_temp.fx('t4_acc_a')), 'not found');
select public.bs_expect_error(format($$select public.business_setup_portal_claim_add(gen_random_uuid(), '{"invoice_id":"%s","amount":10,"paid_on":"%s"}')$$, pg_temp.fx('t4_inv_a'), pg_temp.ydate()), 'sign in');
update public.client_portal_accounts set status = 'revoked' where username = 'portal.b974';
select public.bs_expect_error(format($$select pg_temp.claim('x10', 't4_acc_b', 't4_inv_b', '{"amount":10,"paid_on":"%s"}')$$, pg_temp.ydate()), 'sign in');
update public.client_portal_accounts set status = 'active' where username = 'portal.b974';
-- proof from the account's own folder, an upload that finished
insert into public.client_portal_documents (account_id, doc_type, file_name, mime, storage_path, upload_complete)
  values (pg_temp.fx('t4_acc_b')::uuid, 'Payment proof', 'p.pdf', 'application/pdf', 'incoming/' || pg_temp.fx('t4_acc_b') || '/d1/p.pdf', true);
select pg_temp.claim('t4_c2', 't4_acc_b', 't4_inv_b', jsonb_build_object('amount', 100, 'paid_on', pg_temp.ydate(), 'proof_path', 'incoming/' || pg_temp.fx('t4_acc_b') || '/d1/p.pdf'));
select public.bs_check('claim_proof: a proof under the account folder is kept', (select proof_path = 'incoming/' || pg_temp.fx('t4_acc_b') || '/d1/p.pdf' from public.business_setup_payment_claims where id = pg_temp.fx('t4_c2')::uuid));

-- tables are read-only through the API; only the definer functions write
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$insert into public.business_setup_payment_claims (case_id, account_id, invoice_id, amount, paid_on) values ('%s', '%s', '%s', 5, current_date)$$,
  pg_temp.fx('t4_cb'), pg_temp.fx('t4_acc_b'), pg_temp.fx('t4_inv_b')), 'permission denied');
select public.bs_expect_error(format($$update public.business_setup_payment_claims set status = 'Confirmed' where id = '%s'$$, pg_temp.fx('t4_c1')), 'permission denied');
select public.bs_check('claim_read: staff can read the claims', (select count(*) from public.business_setup_payment_claims) = 2);
select public.bs_as(null);

-- claim_refuse
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', 'No')$$, pg_temp.fx('t4_c2')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', null)$$, pg_temp.fx('t4_c2')), 'why');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', '   ')$$, pg_temp.fx('t4_c2')), 'why');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', 'x')$$, gen_random_uuid()), 'not found');
select public.business_setup_claim_refuse(pg_temp.fx('t4_c2')::uuid, 'The transfer is not on our statement');
select public.bs_as(null);
select public.bs_check('claim_refuse: the claim is Refused with the note, decider and time', (select status = 'Refused' and note = 'The transfer is not on our statement' and decided_by = '00000000-0000-0000-0000-00000000000e'::uuid and decided_at is not null and payment_id is null
  from public.business_setup_payment_claims where id = pg_temp.fx('t4_c2')::uuid));
select public.bs_check('claim_refuse: the client sees the status and the note', (pg_temp.pclaims('t4_acc_b')) @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('t4_c2'), 'status', 'Refused', 'note', 'The transfer is not on our statement')));
select public.bs_check('claim_refuse: no staff name, id or file path reaches the client', pg_temp.pclaims('t4_acc_b')::text !~ '00000000-0000-0000-0000-00000000000e|decided_by|incoming/|Finance');
select public.bs_check('claim_refuse: another client sees nothing of it', not (pg_temp.pclaims('t4_acc_a')::text like '%' || pg_temp.fx('t4_c2') || '%'));
select public.bs_check('claim_refuse: it was audited', public.bs_audit_count('claim_refuse', pg_temp.fx('t4_c2'), '{"status":"Refused"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', 'again')$$, pg_temp.fx('t4_c2')), 'already');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_cb'), 'claim_id', pg_temp.fx('t4_c2'), 'amount', 100)), 'already');
select public.bs_as(null);
select public.bs_check('claim_refuse: a refused claim made no payment', pg_temp.pays('t4_cb') = 0);
-- a refused claim frees the invoice for a new one
select pg_temp.claim('t4_c3', 't4_acc_b', 't4_inv_b', jsonb_build_object('amount', 50, 'paid_on', pg_temp.ydate()));
select public.bs_check('claim_refuse: a new claim can follow a refused one', pg_temp.cstatus('t4_c3') = 'Pending' and pg_temp.cstatus('t4_c2') = 'Refused');
-- a decided claim cannot be edited or removed, even by the table owner
select public.bs_expect_error(format($$update public.business_setup_payment_claims set amount = 1 where id = '%s'$$, pg_temp.fx('t4_c2')), 'cannot be changed');
select public.bs_expect_error(format($$delete from public.business_setup_payment_claims where id = '%s'$$, pg_temp.fx('t4_c1')), 'cannot be');

-- claim_confirm
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', pg_temp.fx('t4_c3'), 'amount', 50)), 'another case');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', 'nonsense', 'amount', 50)), 'claim');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', gen_random_uuid(), 'amount', 50)), 'not found');
select public.bs_as(null);
select public.bs_check('claim_other_case: a refused confirm changed nothing', pg_temp.pays('t4_ca') = 0 and pg_temp.pays('t4_cb') = 0 and pg_temp.cstatus('t4_c3') = 'Pending' and pg_temp.cstatus('t4_c1') = 'Pending');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', pg_temp.fx('t4_c1'), 'amount', 400, 'paid_on', pg_temp.ydate(), 'method', 'Bank transfer', 'reference', 'TT-1'))::text as r1 \gset
select public.bs_as(null);
select public.bs_check('claim_confirm: one payment and one voucher, the claim is Confirmed with the payment', pg_temp.pays('t4_ca') = 1 and pg_temp.vouchers('t4_ca') = 1 and pg_temp.net('t4_ca') = 400
  and (select status = 'Confirmed' and payment_id = (:'r1'::jsonb ->> 'payment_id')::uuid and decided_by = '00000000-0000-0000-0000-00000000000e'::uuid and decided_at is not null and note is null
         from public.business_setup_payment_claims where id = pg_temp.fx('t4_c1')::uuid));
select public.bs_check('claim_confirm: the balance fell by the payment', pg_temp.bal('t4_ca') = :bal0 - 400);
select public.bs_check('claim_confirm: the client sees Confirmed and the receipt', pg_temp.pclaims('t4_acc_a') @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('t4_c1'), 'status', 'Confirmed', 'receipt_id', (select id from public.business_setup_receipts where payment_id = (:'r1'::jsonb ->> 'payment_id')::uuid))));
select public.bs_check('claim_confirm: audited', public.bs_audit_count('claim_confirm', pg_temp.fx('t4_c1'), '{"status":"Confirmed"}') = 1);
-- claim_confirm_twice
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', pg_temp.fx('t4_c1'), 'amount', 400)), 'already');
select public.bs_expect_error(format($$select public.business_setup_claim_refuse('%s', 'late')$$, pg_temp.fx('t4_c1')), 'already');
select public.bs_as(null);
select public.bs_check('claim_confirm_twice: still one payment and one voucher', pg_temp.pays('t4_ca') = 1 and pg_temp.vouchers('t4_ca') = 1 and pg_temp.net('t4_ca') = 400);
-- a payment that fails leaves the claim Pending (same transaction)
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_cb'), 'claim_id', pg_temp.fx('t4_c3'), 'amount', 0)), 'above zero');
select public.bs_as(null);
select public.bs_check('claim_confirm: a payment that fails leaves the claim Pending', pg_temp.cstatus('t4_c3') = 'Pending' and pg_temp.pays('t4_cb') = 0);
-- part_payment: two payments, the case moves to With Accounts between them
select pg_temp.claim('t4_c4', 't4_acc_a', 't4_inv_a', jsonb_build_object('amount', pg_temp.qtotal('t4_qa') - 400, 'paid_on', pg_temp.ydate(), 'reference', 'TT-2'));
update public.business_setup_cases set stage = 'With Accounts' where id = pg_temp.cid('t4_ca');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('t4_ca'), 'claim_id', pg_temp.fx('t4_c4'), 'amount', pg_temp.qtotal('t4_qa') - 400, 'paid_on', pg_temp.ydate())) as ignored \gset
select public.bs_as(null);
select public.bs_check('part_payment: two payments settle the invoice through With Accounts', pg_temp.pays('t4_ca') = 2 and pg_temp.vouchers('t4_ca') = 2 and pg_temp.net('t4_ca') = pg_temp.qtotal('t4_qa') and pg_temp.bal('t4_ca') = 0
  and pg_temp.cstatus('t4_c4') = 'Confirmed');
select public.bs_check('part_payment: the portal shows nothing left to pay', (public.business_setup_portal_view(pg_temp.fx('t4_acc_a')::uuid) -> 'quotes') @> jsonb_build_array(jsonb_build_object('id', pg_temp.fx('t4_qa'), 'outstanding', 0)));
-- claim_over: above the balance follows the override rule
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_claim_refuse(pg_temp.fx('t4_c3')::uuid, 'Please send the right amount');
select public.bs_as(null);
select pg_temp.claim('t4_c5', 't4_acc_b', 't4_inv_b', jsonb_build_object('amount', pg_temp.qtotal('t4_qb') + 500, 'paid_on', pg_temp.ydate()));
select public.bs_check('claim_over: the client may claim above the balance, and it moves nothing', pg_temp.cstatus('t4_c5') = 'Pending' and pg_temp.net('t4_cb') = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_cb'), 'claim_id', pg_temp.fx('t4_c5'), 'amount', pg_temp.qtotal('t4_qb') + 500)), 'above the balance');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('t4_cb'), 'claim_id', pg_temp.fx('t4_c5'), 'amount', pg_temp.qtotal('t4_qb') + 500)), 'reason');
select public.bs_as(null);
select public.bs_check('claim_over: refused without the override and without a reason, the claim stays Pending', pg_temp.cstatus('t4_c5') = 'Pending' and pg_temp.pays('t4_cb') = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('t4_cb'), 'claim_id', pg_temp.fx('t4_c5'), 'amount', pg_temp.qtotal('t4_qb') + 500, 'override_reason', 'Client paid ahead for the next service')) as ignored \gset
select public.bs_as(null);
select public.bs_check('claim_over: with the override right and a reason it confirms', pg_temp.cstatus('t4_c5') = 'Confirmed' and pg_temp.pays('t4_cb') = 1);
-- a closed (Lost) case takes no claim
select public.bs_as(null);
update public.business_setup_cases set stage = 'Lost' where id = pg_temp.cid('t4_cb');
select public.bs_expect_error(format($$select pg_temp.claim('x11', 't4_acc_b', 't4_inv_b', '{"amount":5,"paid_on":"%s"}')$$, pg_temp.ydate()), 'closed');
update public.business_setup_cases set stage = 'Pipeline' where id = pg_temp.cid('t4_cb');

-- who may call
select public.bs_check('claim_add and portal_claims are for the service role only', (select bool_and(has_function_privilege('service_role', f, 'execute') and not has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute'))
  from unnest(array['public.business_setup_portal_claim_add(uuid,jsonb)', 'public.business_setup_portal_claims(uuid)']) f));
select public.bs_check('claim_refuse is for signed-in users and never anon', has_function_privilege('authenticated', 'public.business_setup_claim_refuse(uuid,text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_claim_refuse(uuid,text)', 'execute'));

-- dashboard_keys: the old keys stay, the new ones count
select public.bs_as('00000000-0000-0000-0000-00000000000a');
create temp table d4 as select public.business_setup_dashboard() as d;
grant all on d4 to authenticated;
select public.bs_check('dashboard_keys: every old key is still there', (select bool_and(d ? k) from d4, unnest(array['forms_waiting', 'open_quotes', 'accepted_without_letter', 'outstanding', 'active_services', 'expiries', 'processes_pending', 'receivables',
  'advances', 'cases_completed_month', 'cases_completed_total', 'pipeline', 'forms_to_review', 'pending_after_kyc']) k));
select public.bs_check('dashboard_keys: the four new keys are there', (select d ?& array['client_inputs', 'awaiting_client', 'payment_claims', 'at_completion'] from d4));
select public.bs_as(null);
-- Counted from the records, against the same tables.
select count(*) as n_forms from public.business_setup_onboarding_forms where status = 'Submitted' \gset
select count(*) as n_claims from public.business_setup_payment_claims where status = 'Pending' \gset
select count(*) as n_comp from public.business_setup_cases where stage = 'Completion' \gset
select count(*) as n_wait from public.hub_documents d where d.department = 'Business Setup' and d.doc_type in ('quote', 'letter') and d.status = 'issued'
  and not exists (select 1 from public.business_setup_acceptances a where a.document_id = d.id) \gset
select public.bs_check('dashboard_keys: payment_claims counts Pending claims', (select (d ->> 'payment_claims')::int = :n_claims from d4));
select public.bs_check('dashboard_keys: client_inputs counts Submitted forms', (select (d ->> 'client_inputs')::int = :n_forms from d4));
select public.bs_check('dashboard_keys: awaiting_client counts issued quotes and letters with no decision', (select (d ->> 'awaiting_client')::int = :n_wait from d4));
select public.bs_check('dashboard_keys: at_completion counts the stage Completion', (select (d ->> 'at_completion')::int = :n_comp from d4));
-- the counts move with the records: two cases at Completion, an issued quote, a Submitted form, a Pending claim
select pg_temp.mkcase('t4_comp', 'CL974001', 'Completion', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcase('t4_comp2', 'CL974001', 'Completion', '00000000-0000-0000-0000-00000000000c');
select pg_temp.mkdq('t4_qw', 'CL974001', 't4_comp');
select pg_temp.claim('t4_c7', 't4_acc_b', 't4_inv_b', jsonb_build_object('amount', 7, 'paid_on', pg_temp.ydate()));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('dashboard_keys: Completion cases, an issued quote and a Pending claim each add to their figure',
  (public.business_setup_dashboard() ->> 'at_completion')::int = :n_comp + 2
  and (public.business_setup_dashboard() ->> 'awaiting_client')::int = :n_wait + 1
  and (public.business_setup_dashboard() ->> 'payment_claims')::int = :n_claims + 1);
select public.bs_as(null);
select pg_temp.decide('t4_acc_a', 't4_qw', 'Accepted');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('dashboard_keys: a decided quote leaves awaiting_client', (public.business_setup_dashboard() ->> 'awaiting_client')::int = :n_wait);
select public.bs_as(null);

select public.bs_check('form_list: each row names its case', pg_get_functiondef('public.business_setup_form_list(text)'::regprocedure) like '%''case_id'', f.case_id%'
  and not exists (select 1 from jsonb_array_elements(public.business_setup_form_list()) r where not (r ? 'case_id')));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
