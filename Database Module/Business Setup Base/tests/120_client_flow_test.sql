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


do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
