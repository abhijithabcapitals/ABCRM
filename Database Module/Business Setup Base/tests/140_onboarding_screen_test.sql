-- LOCAL TEST ONLY: what the Client Onboarding screen reads (client flow Task 7). Run through tests/run-local.sh, after 130.
--   documents in case_docs, the form on a case_list row, the claim list with its proof, staff opening a claim's proof, and the case's letter history.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier tests re-run older migrations: put the real final state back, in order.
alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/016_client_flow.sql
\ir ../migrations/018_portal.sql
create temp table f140 (k text primary key, v text);
grant all on f140 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f140 where k = p_k $$;
create function pg_temp.docs(p_k text) returns jsonb language sql security definer as $$ select public.business_setup_case_docs(pg_temp.fx(p_k)::uuid) $$;
create function pg_temp.mkcase(p_key text, p_client text, p_stage text) returns void language plpgsql as $$
declare c uuid;
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.business_setup_cases (client_id, stage, lead_name) values (p_client, p_stage, p_client) returning id into c;
  insert into f140 values (p_key, c::text);
end $$;
-- A portal login and a form on the case. status is set after the form exists, the way a client's form moves.
create function pg_temp.mkform(p_key text, p_case text, p_client text, p_status text) returns void language plpgsql as $$
declare a uuid; f uuid;
begin
  insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values (p_client, p_key, 'portal.' || p_key || '140', 'x', 'active') returning id into a;
  perform public.business_setup_form_create(p_client, a);
  select id into f from public.business_setup_onboarding_forms where client_id = p_client;
  update public.business_setup_onboarding_forms set case_id = pg_temp.fx(p_case)::uuid where id = f;
  if p_status <> 'Draft' then update public.business_setup_onboarding_forms set status = 'Submitted' where id = f; end if;
  if p_status not in ('Draft', 'Submitted') then update public.business_setup_onboarding_forms set status = p_status where id = f; end if;
  insert into f140 values (p_key || '_form', f::text), (p_key || '_acc', a::text);
end $$;
create function pg_temp.mkdoc(p_key text, p_form text, p_type text, p_status text, p_complete boolean default true) returns void language plpgsql as $$
declare a uuid;
begin
  select account_id into a from public.business_setup_onboarding_forms where id = pg_temp.fx(p_form)::uuid;
  insert into public.client_portal_documents (account_id, form_id, doc_type, file_name, storage_path, upload_complete, status)
  values (a, pg_temp.fx(p_form)::uuid, p_type, p_key || '.pdf', 'incoming/' || a || '/' || p_key || '/' || p_key || '.pdf', p_complete, p_status);
  insert into f140 select p_key, id::text from public.client_portal_documents where file_name = p_key || '.pdf';
end $$;
select public.bs_as(null);

-- ── documents: no attached document on the form is unvalidated ──
select pg_temp.mkcase('d1', 'CL976001', 'Onboarding');
select pg_temp.mkform('d1', 'd1', 'CL976001', 'Validated');
select pg_temp.mkdoc('d1_pass', 'd1_form', 'Passport', 'validated');
select public.bs_check('documents: a Validated form whose documents are all validated meets fields and documents', (pg_temp.docs('d1') ->> 'fields')::boolean and (pg_temp.docs('d1') ->> 'documents')::boolean);
select pg_temp.mkdoc('d1_ej', 'd1_form', 'Ejari', 'pending');
select public.bs_check('documents: fields stays true, documents turns false while a document waits', (pg_temp.docs('d1') ->> 'fields')::boolean and not (pg_temp.docs('d1') ->> 'documents')::boolean);
update public.client_portal_documents set status = 'in_review' where id = pg_temp.fx('d1_ej')::uuid;
select public.bs_check('documents: a document in review is not validated either', not (pg_temp.docs('d1') ->> 'documents')::boolean);
update public.client_portal_documents set status = 'validated' where id = pg_temp.fx('d1_ej')::uuid;
select public.bs_check('documents: validating it meets documents', (pg_temp.docs('d1') ->> 'documents')::boolean);
select pg_temp.mkdoc('d1_rej', 'd1_form', 'Utility bill', 'rejected');
select public.bs_check('documents: a rejected document is not validated, so it blocks', not (pg_temp.docs('d1') ->> 'documents')::boolean);
update public.client_portal_documents set status = 'validated' where id = pg_temp.fx('d1_rej')::uuid;
select public.bs_check('documents: once validated it no longer blocks', (pg_temp.docs('d1') ->> 'documents')::boolean);
select pg_temp.mkdoc('d1_part', 'd1_form', 'Other', 'pending', false);
select public.bs_check('documents: an upload that never finished is not a document', (pg_temp.docs('d1') ->> 'documents')::boolean);
-- A proof of payment has no form, so it never counts against the form.
insert into public.client_portal_documents (account_id, doc_type, file_name, storage_path, upload_complete, status)
  values (pg_temp.fx('d1_acc')::uuid, 'Payment proof', 'proof140.pdf', 'incoming/' || pg_temp.fx('d1_acc') || '/proof/proof140.pdf', true, 'pending');
select public.bs_check('documents: a payment proof is not a form document', (pg_temp.docs('d1') ->> 'documents')::boolean);
update public.client_portal_documents set form_id = pg_temp.fx('d1_form')::uuid where file_name = 'proof140.pdf';
select public.bs_check('documents: even attached to the form by mistake, a payment proof does not count', (pg_temp.docs('d1') ->> 'documents')::boolean);

select pg_temp.mkcase('d2', 'CL976002', 'Onboarding');
select pg_temp.mkform('d2', 'd2', 'CL976002', 'Submitted');
select pg_temp.mkdoc('d2_pass', 'd2_form', 'Passport', 'validated');
select public.bs_check('documents: validated documents on a form still under review meet documents, not fields', not (pg_temp.docs('d2') ->> 'fields')::boolean and (pg_temp.docs('d2') ->> 'documents')::boolean);
select pg_temp.mkcase('d5', 'CL976005', 'Onboarding');
select pg_temp.mkform('d5', 'd5', 'CL976005', 'Submitted');
select public.bs_check('documents: a form with no document is not met while it is not Validated', not (pg_temp.docs('d5') ->> 'documents')::boolean);
update public.business_setup_onboarding_forms set status = 'Validated' where id = pg_temp.fx('d5_form')::uuid;
select public.bs_check('documents: a Validated form with no document meets documents, like fields', (pg_temp.docs('d5') ->> 'documents')::boolean and (pg_temp.docs('d5') ->> 'fields')::boolean);
select pg_temp.mkcase('d3', 'CL976003', 'Onboarding');
select public.bs_check('documents: no form and no KYC leaves both open', not (pg_temp.docs('d3') ->> 'fields')::boolean and not (pg_temp.docs('d3') ->> 'documents')::boolean);
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL976003', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select public.bs_check('documents: no form with KYC done meets both', (pg_temp.docs('d3') ->> 'fields')::boolean and (pg_temp.docs('d3') ->> 'documents')::boolean);
select public.bs_check('documents: every other item is unchanged and balance stays', (pg_temp.docs('d1') ?& array['fields', 'documents', 'quote', 'login', 'quote_accepted', 'letter', 'letter_accepted', 'invoice', 'balance']));

-- ── case_list: the case's form ──
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('case_list: an Onboarding row names its form and the form state', (select e ->> 'form_id' = pg_temp.fx('d1_form') and e ->> 'form_status' = 'Validated'
  from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('d1')));
select public.bs_check('case_list: a Submitted form shows Submitted', (select e ->> 'form_status' = 'Submitted' from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('d2')));
select public.bs_check('case_list: a case with no form has null form_id and form_status', (select e -> 'form_id' = 'null'::jsonb and e -> 'form_status' = 'null'::jsonb
  from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('d3')));
select public.bs_as(null);
select pg_temp.mkcase('d4', 'CL976004', 'Onboarding');
select pg_temp.mkform('d4', 'd4', 'CL976004', 'Returned');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('case_list: a Returned form is reachable from its row', (select e ->> 'form_status' = 'Returned' and e ->> 'form_id' = pg_temp.fx('d4_form') from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('d4')));
select public.bs_as(null);

-- ── claims: the list and the proof ──
-- An accepted quote and an invoice on a case, then two claims: one with a proof of payment, one without.
select pg_temp.mkcase('c1', 'CL976010', 'Pipeline');
insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  select u, u, 'quote', 'Business Setup', 'CL976010 LLC', 'CL976010', 'T140-C1', 1000, 'accepted', pg_temp.fx('c1')::uuid from (select gen_random_uuid() as u) s;
insert into f140 select 'c1_q', id::text from public.hub_documents where document_number = 'T140-C1';
select pg_temp.mkform('c1', 'c1', 'CL976010', 'Validated');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
insert into f140 values ('c1_inv', public.business_setup_invoice_record(jsonb_build_object('case_id', pg_temp.fx('c1'), 'invoice_number', 'INV-140', 'amount', 1000))::text);
select public.bs_as(null);
insert into public.client_portal_documents (account_id, doc_type, file_name, storage_path, upload_complete, status)
  values (pg_temp.fx('c1_acc')::uuid, 'Payment proof', 'p140.pdf', 'incoming/' || pg_temp.fx('c1_acc') || '/d9/p140.pdf', true, 'pending');
insert into f140 select 'c1_proof', id::text from public.client_portal_documents where file_name = 'p140.pdf';
insert into f140 values ('c1_claim', public.business_setup_portal_claim_add(pg_temp.fx('c1_acc')::uuid, jsonb_build_object('invoice_id', pg_temp.fx('c1_inv'), 'amount', 400,
  'paid_on', ((now() at time zone 'Asia/Dubai')::date - 1)::text, 'reference', 'TT-140', 'proof_path', 'incoming/' || pg_temp.fx('c1_acc') || '/d9/p140.pdf'))::text);
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('claim_list: the claim shows its values, the invoice number and the document that holds the proof', (select e ->> 'status' = 'Pending' and (e ->> 'amount')::numeric = 400 and e ->> 'reference' = 'TT-140'
  and e ->> 'invoice_number' = 'INV-140' and e ->> 'proof_document_id' = pg_temp.fx('c1_proof') and e ->> 'proof_name' = 'p140.pdf'
  from jsonb_array_elements(public.business_setup_claim_list(pg_temp.fx('c1')::uuid)) e));
select public.bs_check('claim_list: it never shows the storage path', not (public.business_setup_claim_list(pg_temp.fx('c1')::uuid)::text ilike '%incoming/%'));
select public.bs_check('claim_list: a case with no claim gets an empty list', public.business_setup_claim_list(pg_temp.fx('d1')::uuid) = '[]'::jsonb);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('proof_open: staff who confirm payments can open the claim''s proof through the staff document link', (public.client_inputs_file(pg_temp.fx('c1_proof')::uuid) ->> 'file_name') = 'p140.pdf'
  and (public.client_inputs_file(pg_temp.fx('c1_proof')::uuid) ->> 'storage_path') like 'incoming/%');
select public.bs_expect_error(format($$select public.client_inputs_file('%s')$$, pg_temp.fx('d1_pass')), 'access to Client Inputs');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.client_inputs_file('%s')$$, pg_temp.fx('c1_proof')), 'access to Client Inputs');
select public.bs_as(null);
-- A proof the claim does not name is not opened by the payments right.
insert into public.client_portal_documents (account_id, doc_type, file_name, storage_path, upload_complete, status)
  values (pg_temp.fx('c1_acc')::uuid, 'Payment proof', 'other140.pdf', 'incoming/' || pg_temp.fx('c1_acc') || '/d8/other140.pdf', true, 'pending');
insert into f140 select 'c1_other', id::text from public.client_portal_documents where file_name = 'other140.pdf';
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.client_inputs_file('%s')$$, pg_temp.fx('c1_other')), 'access to Client Inputs');
select public.bs_as(null);

-- ── confirming a claim: the payment form's values go through payment_add with claim_id ──
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('claim_confirm: payment_add with claim_id confirms the claim', (public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('c1'), 'amount', 400, 'paid_on', ((now() at time zone 'Asia/Dubai')::date - 1)::text,
  'method', 'Bank transfer', 'reference', 'TT-140', 'claim_id', pg_temp.fx('c1_claim'))) ? 'receipt_id'));
select public.bs_check('claim_confirm: the list then shows it Confirmed', (select e ->> 'status' = 'Confirmed' from jsonb_array_elements(public.business_setup_claim_list(pg_temp.fx('c1')::uuid)) e));
select public.bs_as(null);

-- ── letter history ──
select pg_temp.mkcase('h1', 'CL976020', 'Onboarding');
insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  select u, u, 'quote', 'Business Setup', 'CL976020 LLC', 'CL976020', 'T140-H1', 1000, 'accepted', pg_temp.fx('h1')::uuid from (select gen_random_uuid() as u) s;
insert into f140 select 'h1_q', id::text from public.hub_documents where document_number = 'T140-H1';
insert into public.hub_documents (id, doc_type, department, client_name, client_id, document_number, status, case_id, parent_id, status_reason)
  values (gen_random_uuid(), 'letter', 'Business Setup', 'CL976020 LLC', 'CL976020', 'T140-L1', 'rejected', pg_temp.fx('h1')::uuid, pg_temp.fx('h1_q')::uuid, 'Rejected by the client');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('letter_history: case_documents carries the reason and what a letter replaced', (select e ? 'status_reason' and e ? 'revises_id' and e ->> 'status_reason' = 'Rejected by the client'
  from jsonb_array_elements(public.business_setup_case_documents(pg_temp.fx('h1')::uuid)) e where e ->> 'document_number' = 'T140-L1'));
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
