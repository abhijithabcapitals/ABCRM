-- LOCAL TEST ONLY: client form and validation. Run through tests/run-local.sh, after 010 (which creates the helpers and test users).
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 010 grants every function to signed-in users for its own calls: run this migration again to restore its real grants.
\ir ../migrations/009_onboarding.sql
create temp table f30 (k text primary key, v text);
grant all on f30 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f30 where k = p_k $$;
-- A form with answers and documents. status null leaves it as it was created.
create function pg_temp.mk(p_client text, p_key text, p_answers jsonb, p_status text default 'Submitted') returns uuid language plpgsql as $$
declare a uuid; f uuid;
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values (p_client, p_client, lower(p_client), 'x') returning id into a;
  select id into f from public.business_setup_onboarding_forms where account_id = a;
  update public.business_setup_onboarding_forms set answers = p_answers, status = p_status where id = f;
  insert into f30 values (p_key, f::text), (p_key || '_acc', a::text);
  return f;
end $$;
create function pg_temp.doc(p_form uuid, p_type text, p_status text default 'validated', p_complete boolean default true) returns void language sql as $$
  insert into public.client_portal_documents (account_id, form_id, doc_type, file_name, storage_path, upload_complete, status)
  select account_id, p_form, p_type, p_type || '.pdf', gen_random_uuid()::text, p_complete, p_status from public.business_setup_onboarding_forms where id = p_form;
$$;
-- complete answers for a new company
create function pg_temp.ans() returns jsonb language sql as $$
  select '{"client_name":"Asha Rao","phone":"+971500000001","email":"a@b.test","services":["Company registration"],"company_status":"New","activity":"Trading","zone":"IFZA","partners":[{"name":"Asha Rao","nationality":"Indian","share":100,"ubo":true}]}'::jsonb
$$;

select public.bs_as(null);
-- ── A login creates the form ──
insert into public.client_master (client_id, legal_name, data) values ('CL900050', 'Form Client LLC', '{}');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL900050', 'Form Client', 'form.client', 'x');
insert into f30 select 'acc', id::text from public.client_portal_accounts where username = 'form.client';
select public.bs_check('login creates form', exists (select 1 from public.business_setup_onboarding_forms where account_id = pg_temp.fx('acc')::uuid and status = 'Draft' and form_version = 1));
select public.bs_check('the client is listed under Business Setup', exists (select 1 from public.business_setup_kyc_profiles where client_id = 'CL900050'));
select public.bs_check('one open form', (select count(*) from public.business_setup_onboarding_forms where client_id = 'CL900050' and status <> 'Validated') = 1);
select public.bs_expect_error($$insert into business_setup_onboarding_forms (client_id, account_id, form_version) select 'CL900050', account_id, 1 from business_setup_onboarding_forms where client_id = 'CL900050'$$, 'duplicate');
-- A client already through KYC gets a login with no form to fill.
insert into public.client_master (client_id, legal_name, data) values ('CL900051', 'Imported LLC', '{}');
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL900051', 'Done');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL900051', 'Imported', 'imported.client', 'x');
select public.bs_check('a KYC done client gets no form', not exists (select 1 from public.business_setup_onboarding_forms where client_id = 'CL900051'));
select public.bs_check('form_get is empty for them', public.business_setup_form_get((select id from public.client_portal_accounts where username = 'imported.client')) is null);

-- ── The client fills it in ──
select public.bs_check('form_get returns the definition', public.business_setup_form_get(pg_temp.fx('acc')::uuid) -> 'definition' ->> 'version' = '1' and public.business_setup_form_get(pg_temp.fx('acc')::uuid) ->> 'status' = 'Draft');
select public.business_setup_form_save(pg_temp.fx('acc')::uuid, pg_temp.ans()) as ignored \gset
select public.bs_check('answers saved', public.business_setup_form_get(pg_temp.fx('acc')::uuid) -> 'answers' ->> 'email' = 'a@b.test');
select public.bs_expect_error(format($$select business_setup_form_submit('%s')$$, pg_temp.fx('acc')), 'Passport');
select public.bs_check('no contact before validation', (select data ->> 'General Email' from public.client_master where client_id = 'CL900050') is null);
select pg_temp.doc((select id from public.business_setup_onboarding_forms where client_id = 'CL900050'), 'Passport', 'pending');
select pg_temp.doc((select id from public.business_setup_onboarding_forms where client_id = 'CL900050'), 'Utility bill', 'pending');
select public.business_setup_form_submit(pg_temp.fx('acc')::uuid) as ignored \gset
select public.bs_check('submitted', public.business_setup_form_get(pg_temp.fx('acc')::uuid) ->> 'status' = 'Submitted');
select public.bs_expect_error(format($$select business_setup_form_save('%s','{}')$$, pg_temp.fx('acc')), 'submitted');
insert into f30 select 'f1', id::text from public.business_setup_onboarding_forms where client_id = 'CL900050';
select public.bs_check('dashboard counts it', public.business_setup_dash_forms() >= 1);

-- ── Who may call what ──
select public.bs_check('portal functions are for the service role only',
  not has_function_privilege('authenticated', 'public.business_setup_form_get(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_form_save(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_form_submit(uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_form_get(uuid)', 'execute'));
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_form_take('%s')$$, pg_temp.fx('f1')), 'permission');
select public.bs_expect_error($$select business_setup_form_list()$$, 'permission');
select public.bs_expect_error(format($$select business_setup_form_detail('%s')$$, pg_temp.fx('f1')), 'permission');
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',1)$$, pg_temp.fx('f1')), 'permission');

-- ── Staff review ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('document reviewers include Setup staff', public.client_inputs_can());
select public.bs_check('the form is in the waiting list', exists (select 1 from jsonb_array_elements(public.business_setup_form_list('Submitted')) e where e ->> 'id' = pg_temp.fx('f1')));
select public.business_setup_form_take(pg_temp.fx('f1')::uuid) as ignored \gset
select public.bs_check('in review', (select status = 'In review' from public.business_setup_onboarding_forms where id = pg_temp.fx('f1')::uuid));
select public.bs_expect_error(format($$select business_setup_form_take('%s')$$, pg_temp.fx('f1')), 'already taken');
select public.bs_expect_error(format($$select business_setup_form_return('%s','  ')$$, pg_temp.fx('f1')), 'note');
select public.business_setup_form_return(pg_temp.fx('f1')::uuid, 'Passport is blurred') as ignored \gset
select public.bs_as(null);
select public.bs_check('the client sees the note', public.business_setup_form_get(pg_temp.fx('acc')::uuid) ->> 'status' = 'Returned' and public.business_setup_form_get(pg_temp.fx('acc')::uuid) ->> 'return_note' = 'Passport is blurred');
select public.business_setup_form_save(pg_temp.fx('acc')::uuid, pg_temp.ans()) as ignored \gset
select public.business_setup_form_submit(pg_temp.fx('acc')::uuid) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_form_take(pg_temp.fx('f1')::uuid) as ignored \gset

-- Documents not yet validated block validation, by name.
select public.bs_check('unvalidated documents are missing', 'Passport' = any(public.business_setup_form_missing(pg_temp.fx('f1')::uuid)));
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',null)$$, pg_temp.fx('f1')), 'Passport');
select public.bs_as(null);
update public.client_portal_documents set status = 'validated' where form_id = pg_temp.fx('f1')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('nothing missing now', cardinality(public.business_setup_form_missing(pg_temp.fx('f1')::uuid)) = 0);
select public.bs_check('detail shows answers, documents and master version', public.business_setup_form_detail(pg_temp.fx('f1')::uuid) -> 'answers' ->> 'email' = 'a@b.test'
  and jsonb_array_length(public.business_setup_form_detail(pg_temp.fx('f1')::uuid) -> 'documents') = 2 and public.business_setup_form_detail(pg_temp.fx('f1')::uuid) ? 'master_version');

-- A stale Client Master version is refused.
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',99)$$, pg_temp.fx('f1')), 'changed');
select public.business_setup_form_validate(pg_temp.fx('f1')::uuid, '{}', null) as ignored \gset
select public.bs_check('contact on validation', (select data ->> 'General Email' = 'a@b.test' and data ->> 'General Phone' = '+971500000001' from public.client_master where client_id = 'CL900050'));
select public.bs_check('KYC done', (select kyc_state from public.business_setup_kyc_profiles where client_id = 'CL900050') = 'Done');
select public.bs_check('KYC profile written', (select company_status = 'New' and business_activity = 'Trading' and jurisdiction = 'IFZA' from public.business_setup_kyc_profiles where client_id = 'CL900050'));
select public.bs_as(null);
select public.bs_check('partner written', (select count(*) from public.business_setup_kyc_partners p join public.business_setup_kyc_profiles k on k.id = p.kyc_id where k.client_id = 'CL900050' and p.full_name = 'Asha Rao' and p.nationality = 'Indian' and p.is_ubo) = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('KYC status is complete', (public.business_setup_kyc_status('CL900050') ->> 'percent')::int = 100);
select public.bs_check('form validated', (select status = 'Validated' and reviewed_at is not null from public.business_setup_onboarding_forms where id = pg_temp.fx('f1')::uuid));
select public.bs_check('validation is in the audit log', public.bs_audit_count('form_validate', pg_temp.fx('f1'), '{"client_id":"CL900050"}') = 1);
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',null)$$, pg_temp.fx('f1')), 'already validated');
select public.bs_as(null);
select public.bs_expect_error(format($$select business_setup_form_save('%s','{}')$$, pg_temp.fx('acc')), 'submitted');

-- ── Which items are required ──
select pg_temp.mk('CL900052', 'f_partial', pg_temp.ans()) as ignored \gset
select pg_temp.doc(pg_temp.fx('f_partial')::uuid, 'Utility bill');
select pg_temp.doc(pg_temp.fx('f_partial')::uuid, 'Passport', 'validated', false);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('unfinished upload is missing', 'Passport' = any(public.business_setup_form_missing(pg_temp.fx('f_partial')::uuid)));
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',null)$$, pg_temp.fx('f_partial')), 'Passport');
select public.bs_as(null);
select public.bs_expect_error(format($$select business_setup_form_submit('%s')$$, (select account_id from public.business_setup_onboarding_forms where id = pg_temp.fx('f_partial')::uuid)), 'submitted');
update public.business_setup_onboarding_forms set status = 'Draft' where id = pg_temp.fx('f_partial')::uuid;
select public.bs_expect_error(format($$select business_setup_form_submit('%s')$$, pg_temp.fx('f_partial_acc')), 'Passport');
update public.business_setup_onboarding_forms set status = 'Submitted' where id = pg_temp.fx('f_partial')::uuid;
select public.bs_check('no contact before validation, again', (select data ->> 'General Email' from public.client_master where client_id = 'CL900052') is null);

select pg_temp.mk('CL900053', 'f_one_address', pg_temp.ans()) as ignored \gset
select pg_temp.doc(pg_temp.fx('f_one_address')::uuid, 'Passport');
select pg_temp.doc(pg_temp.fx('f_one_address')::uuid, 'Bank statement');
select pg_temp.mk('CL900054', 'f_no_address', pg_temp.ans()) as ignored \gset
select pg_temp.doc(pg_temp.fx('f_no_address')::uuid, 'Passport');
select pg_temp.mk('CL900055', 'f_rejected', pg_temp.ans()) as ignored \gset
select pg_temp.doc(pg_temp.fx('f_rejected')::uuid, 'Passport', 'rejected');
select pg_temp.doc(pg_temp.fx('f_rejected')::uuid, 'Ejari');
select pg_temp.mk('CL900056', 'f_existing', pg_temp.ans() || '{"company_status":"Existing"}') as ignored \gset
select pg_temp.mk('CL900057', 'f_new', pg_temp.ans()) as ignored \gset
select pg_temp.mk('CL900058', 'f_empty', '{}') as ignored \gset
select pg_temp.mk('CL900059', 'f_no_nat', pg_temp.ans() || '{"partners":[{"name":"No Nationality"}]}') as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('address proof needs only one', not 'Address proof' = any(public.business_setup_form_missing(pg_temp.fx('f_one_address')::uuid)));
select public.bs_check('address proof is required', 'Address proof' = any(public.business_setup_form_missing(pg_temp.fx('f_no_address')::uuid)));
select public.bs_check('a rejected document does not count', 'Passport' = any(public.business_setup_form_missing(pg_temp.fx('f_rejected')::uuid)));
select public.bs_check('existing company needs licence', public.business_setup_form_missing(pg_temp.fx('f_existing')::uuid) @> array['Licence number', 'Licence expiry', 'Issuing authority']);
select public.bs_check('new company needs no licence', not 'Licence number' = any(public.business_setup_form_missing(pg_temp.fx('f_new')::uuid)));
select public.bs_check('an empty form names every required field', public.business_setup_form_missing(pg_temp.fx('f_empty')::uuid) @> array['Client name', 'Phone', 'Email', 'Services wanted', 'Company status', 'Business activity', 'Partner', 'Passport', 'Address proof']);
select public.bs_check('a partner needs a nationality', 'Partner' = any(public.business_setup_form_missing(pg_temp.fx('f_no_nat')::uuid)));

-- ── A different value already in Client Master: staff choose ──
select public.bs_as(null);
select pg_temp.mk('CL900060', 'f_conflict', pg_temp.ans()) as ignored \gset
select pg_temp.doc(pg_temp.fx('f_conflict')::uuid, 'Passport');
select pg_temp.doc(pg_temp.fx('f_conflict')::uuid, 'Ejari');
update public.client_master set data = data || '{"General Email":"old@b.test"}', version = version where client_id = 'CL900060';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_form_validate('%s','{}',null)$$, pg_temp.fx('f_conflict')), 'email');
select public.bs_check('detail shows both values', public.business_setup_form_detail(pg_temp.fx('f_conflict')::uuid) ->> 'master_email' = 'old@b.test' and public.business_setup_form_detail(pg_temp.fx('f_conflict')::uuid) -> 'answers' ->> 'email' = 'a@b.test');
select public.business_setup_form_validate(pg_temp.fx('f_conflict')::uuid, '{"email":"old@b.test"}', null) as ignored \gset
select public.bs_check('staff choice is kept', (select data ->> 'General Email' = 'old@b.test' and data ->> 'General Phone' = '+971500000001' from public.client_master where client_id = 'CL900060'));
select public.bs_as(null);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
