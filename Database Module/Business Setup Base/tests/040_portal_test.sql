-- LOCAL TEST ONLY: what a client sees of Business Setup through the portal. Run through tests/run-local.sh, after 010.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 010 grants every function to signed-in users for its own calls: run these migrations again to restore their real grants.
\ir ../migrations/009_onboarding.sql
\ir ../migrations/010_portal.sql
create temp table f40 (k text primary key, v text);
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f40 where k = p_k $$;
create function pg_temp.q(p_client text, p_num text, p_status text, p_path text default null) returns uuid language sql as $$
  insert into public.hub_documents (doc_type, department, client_name, client_id, document_number, total_amount, status, notes, storage_path)
  values ('quote', 'Business Setup', p_client, p_client, p_num, 1000, p_status, 'internal note text', p_path) returning id
$$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL900080', 'Client A LLC', '{"General Email":"master@a.test","General Phone":"+971501","Risk Level":"High","Risk Reason":"risk reason text"}'),
  ('CL900081', 'Client B LLC', '{}'),
  ('CL900082', 'Banking Linked LLC', '{}');
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL900080', 'A', 'portal.a', 'x'), ('CL900081', 'B', 'portal.b', 'x');
insert into public.client_portal_accounts (display_name, username, password_hash) values ('Nobody', 'portal.none', 'x');
insert into f40 select 'acc_a', id::text from public.client_portal_accounts where username = 'portal.a';
select public.business_setup_form_create('CL900080', pg_temp.fx('acc_a')::uuid);
insert into f40 select 'acc_b', id::text from public.client_portal_accounts where username = 'portal.b';
insert into f40 select 'acc_none', id::text from public.client_portal_accounts where username = 'portal.none';
-- An older account linked only through its Banking client.
insert into public.banking_clients (display_name, client_type, client_master_id) values ('Banking Linked', 'Company', 'CL900082');
insert into public.client_portal_accounts (banking_client_id, display_name, username, password_hash)
  select id, 'Linked', 'portal.linked', 'x' from public.banking_clients where client_master_id = 'CL900082';
insert into f40 select 'acc_banking', id::text from public.client_portal_accounts where username = 'portal.linked';

insert into f40 values ('quote_a', pg_temp.q('CL900080', 'BSQ-A', 'accepted', 'q/a.docx')::text), ('quote_old', pg_temp.q('CL900080', 'BSQ-OLD', 'superseded', 'q/old.docx')::text),
  ('quote_b', pg_temp.q('CL900081', 'BSQ-B', 'accepted', 'q/b.docx')::text), ('quote_nofile', pg_temp.q('CL900080', 'BSQ-NOFILE', 'issued')::text);
insert into public.business_setup_services (client_id, quote_id, name, action, status, notes, owner_id)
  values ('CL900080', pg_temp.fx('quote_a')::uuid, 'Trade licence', 'New', 'In progress', 'internal note text', null);
insert into public.business_setup_services (client_id, quote_id, name, status) values ('CL900081', pg_temp.fx('quote_b')::uuid, 'Secret B service', 'In progress');
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, reference, note) values ('CL900080', pg_temp.fx('quote_a')::uuid, current_date, 400, 'Payment', 'TT-A', 'internal note text');
insert into public.business_setup_receipts (payment_id, receipt_number, storage_path) select id, 'BSR-A', 'r/a.docx' from public.business_setup_payments where reference = 'TT-A';
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, reference) values ('CL900081', pg_temp.fx('quote_b')::uuid, current_date, 700, 'Payment', 'TT-B');
insert into public.business_setup_receipts (payment_id, receipt_number, storage_path) select id, 'BSR-B', 'r/b.docx' from public.business_setup_payments where reference = 'TT-B';
insert into public.business_setup_documents (client_id, kind, file_name, storage_path, is_output, client_visible) values
  ('CL900080', 'Licence', 'visible-output.pdf', 'o/v.pdf', true, true), ('CL900080', 'Licence', 'internal-output.pdf', 'o/i.pdf', true, false), ('CL900081', 'Licence', 'b-output.pdf', 'o/b.pdf', true, true);
insert into f40 select 'rcp_a', r.id::text from public.business_setup_receipts r where r.receipt_number = 'BSR-A';
insert into f40 select 'rcp_b', r.id::text from public.business_setup_receipts r where r.receipt_number = 'BSR-B';
insert into f40 select 'out_a', id::text from public.business_setup_documents where file_name = 'visible-output.pdf';
insert into f40 select 'out_hidden', id::text from public.business_setup_documents where file_name = 'internal-output.pdf';
insert into f40 select 'out_b', id::text from public.business_setup_documents where file_name = 'b-output.pdf';
insert into public.hub_documents (doc_type, department, client_name, parent_id, document_number, storage_path) values ('letter', 'Business Setup', 'B', pg_temp.fx('quote_b')::uuid, 'BSE-B', 'l/b.docx');
insert into f40 select 'let_b', id::text from public.hub_documents where document_number = 'BSE-B';
insert into public.hub_documents (doc_type, department, client_name, parent_id, document_number, storage_path) values ('letter', 'Business Setup', 'A', pg_temp.fx('quote_a')::uuid, 'BSE-A', 'l/a.docx');
insert into f40 select 'let_a', id::text from public.hub_documents where document_number = 'BSE-A';

create function pg_temp.v() returns jsonb language sql as $$ select public.business_setup_portal_view(pg_temp.fx('acc_a')::uuid) $$;

-- ── Only this client's records ──
select public.bs_check('own quote visible', pg_temp.v()::text ~ 'BSQ-A');
select public.bs_check('other client hidden', pg_temp.v()::text !~ 'BSQ-B|Secret B|BSR-B|TT-B|b-output|BSE-B');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','quote','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('quote_b')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','letter','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('let_b')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','receipt','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('rcp_b')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','output','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('out_b')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','output','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('out_hidden')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','quote','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('quote_old')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','quote','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('quote_nofile')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','anything','%s')$$, pg_temp.fx('acc_a'), pg_temp.fx('quote_a')), 'not found');
select public.bs_expect_error(format($$select business_setup_portal_file('%s','quote','%s')$$, pg_temp.fx('acc_none'), pg_temp.fx('quote_a')), 'not found');
select public.bs_check('own files resolve', public.business_setup_portal_file(pg_temp.fx('acc_a')::uuid, 'quote', pg_temp.fx('quote_a')::uuid) ->> 'path' = 'q/a.docx'
  and public.business_setup_portal_file(pg_temp.fx('acc_a')::uuid, 'letter', pg_temp.fx('let_a')::uuid) ->> 'path' = 'l/a.docx'
  and public.business_setup_portal_file(pg_temp.fx('acc_a')::uuid, 'receipt', pg_temp.fx('rcp_a')::uuid) ->> 'path' = 'r/a.docx'
  and public.business_setup_portal_file(pg_temp.fx('acc_a')::uuid, 'output', pg_temp.fx('out_a')::uuid) ->> 'bucket' = 'business-setup-documents');

-- Old CRM tasks stay internal: their names were written for staff.
insert into public.business_setup_services (client_id, name, status, historical) values ('CL900080', 'Old board task', 'Completed', true);
select public.bs_check('old CRM tasks are not shown', pg_temp.v()::text !~ 'Old board task');

-- ── Only named fields ──
-- The form definition legitimately says "beneficial owner", so it is checked separately.
select public.bs_check('the form holds no staff fields', (pg_temp.v() -> 'form') - 'definition' ?| array['taken_by', 'reviewed_by', 'client_id', 'account_id'] = false);
select public.bs_check('forbidden fields absent', (pg_temp.v() - 'form')::text !~* 'internal note text|commission|owner|risk|reviewed_by|taken_by|created_by|fee_item|default_amount|audit');
select public.bs_check('superseded hidden', pg_temp.v()::text !~ 'BSQ-OLD');
select public.bs_check('hidden output hidden', pg_temp.v()::text !~ 'internal-output.pdf');
select public.bs_check('visible output shown', pg_temp.v()::text ~ 'visible-output.pdf');
select public.bs_check('invoices empty array', pg_temp.v() -> 'invoices' = '[]'::jsonb);
-- Zoho invoices: Admin Base 010 adds the unique index.
\ir '../../Admin Base/migrations/010_zoho_invoices.sql'
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, issued_on, amount, source, zoho_id) values
  ('CL900080', pg_temp.fx('quote_a')::uuid, 'INV-A', current_date, 500, 'zoho', 'z-a'),
  ('CL900081', pg_temp.fx('quote_b')::uuid, 'INV-B', current_date, 700, 'zoho', 'z-b');
select public.bs_check('the portal shows only this client''s invoices', pg_temp.v() -> 'invoices' @> '[{"number": "INV-A"}]'::jsonb and pg_temp.v()::text !~ 'INV-B' and jsonb_array_length(pg_temp.v() -> 'invoices') = 1);
select public.bs_check('an invoice row with no file says has_file false', (select (e ->> 'has_file')::boolean = false from jsonb_array_elements(pg_temp.v() -> 'invoices') e where e ->> 'number' = 'INV-A'));
select public.bs_check('invoice fields', (select (e ->> 'amount')::numeric = 500 and e ->> 'date' = current_date::text from jsonb_array_elements(pg_temp.v() -> 'invoices') e where e ->> 'number' = 'INV-A'));
select public.bs_expect_error($$insert into public.business_setup_invoices (client_id, invoice_number, zoho_id) values ('CL900080', 'INV-DUP', 'z-a')$$, 'duplicate key');
insert into public.business_setup_invoices (client_id, invoice_number) values ('CL900080', 'OLD-1'), ('CL900080', 'OLD-2');
select public.bs_check('rows with no Zoho id are not limited', (select count(*) = 2 from public.business_setup_invoices where invoice_number like 'OLD-%'));
\ir '../../Admin Base/migrations/rollback/010_rollback.sql'
select public.bs_check('rollback drops the index', to_regclass('public.business_setup_invoices_zoho_uq') is null);
\ir '../../Admin Base/migrations/010_zoho_invoices.sql'
select public.bs_check('the index is back after reapplying', to_regclass('public.business_setup_invoices_zoho_uq') is not null);
select public.bs_check('the service role can write invoices', has_table_privilege('service_role', 'public.business_setup_invoices', 'insert') and has_table_privilege('service_role', 'public.business_setup_invoices', 'delete') and has_table_privilege('service_role', 'public.business_setup_invoices', 'update'));
delete from public.business_setup_invoices where client_id in ('CL900080', 'CL900081');
select public.bs_check('service fields', (select e ->> 'name' = 'Trade licence' and e ->> 'action' = 'New' and e ->> 'status' = 'In progress' from jsonb_array_elements(pg_temp.v() -> 'services') e));
select public.bs_check('payment fields and receipt', (select e ->> 'reference' = 'TT-A' and e ->> 'receipt_number' = 'BSR-A' and (e ->> 'amount')::numeric = 400 from jsonb_array_elements(pg_temp.v() -> 'payments') e));
select public.bs_check('balance per quote', (select (e ->> 'net_paid')::numeric = 400 and (e ->> 'outstanding')::numeric = 600 from jsonb_array_elements(pg_temp.v() -> 'quotes') e where e ->> 'number' = 'BSQ-A'));
select public.bs_check('a quote says if it has a file', (select (e ->> 'has_file')::boolean = false from jsonb_array_elements(pg_temp.v() -> 'quotes') e where e ->> 'number' = 'BSQ-NOFILE'));
select public.bs_check('the view includes the form', pg_temp.v() -> 'form' ->> 'status' = 'Draft');
select public.bs_check('details come from Client Master', pg_temp.v() -> 'details' ->> 'company_email' = 'master@a.test');

-- ── Older and unlinked accounts ──
select public.bs_check('banking-linked account resolves', public.business_setup_portal_client(pg_temp.fx('acc_banking')::uuid) = 'CL900082');
select public.bs_check('unlinked account gets empty view', public.business_setup_portal_view(pg_temp.fx('acc_none')::uuid) -> 'services' = '[]'::jsonb and public.business_setup_portal_view(pg_temp.fx('acc_none')::uuid) -> 'quotes' = '[]'::jsonb);
select public.bs_check('unlinked account has no form', public.business_setup_portal_view(pg_temp.fx('acc_none')::uuid) -> 'form' = 'null'::jsonb or public.business_setup_portal_view(pg_temp.fx('acc_none')::uuid) -> 'form' is null);
select public.bs_check('contact from client master', public.client_portal_me(pg_temp.fx('acc_a')::uuid) -> 'record' ->> 'company_email' = 'master@a.test' and public.client_portal_me(pg_temp.fx('acc_a')::uuid) -> 'record' ->> 'company_phone' = '+971501');
select public.bs_check('a Banking client gets no form', public.business_setup_portal_view(pg_temp.fx('acc_banking')::uuid) -> 'form' = 'null'::jsonb and not exists (select 1 from public.business_setup_kyc_profiles where client_id = 'CL900082'));
select public.bs_check('a Banking-only client keeps the old portal', public.client_portal_me(pg_temp.fx('acc_none')::uuid) ? 'documents');

-- ── A revoked login ──
insert into public.client_portal_sessions (account_id, token_hash, expires_at) values (pg_temp.fx('acc_b')::uuid, encode(sha256('tok-b'::bytea), 'hex'), now() + interval '1 hour');
select public.bs_check('a live session finds its account', public.client_portal_session('tok-b') = pg_temp.fx('acc_b')::uuid);
update public.client_portal_accounts set status = 'revoked' where id = pg_temp.fx('acc_b')::uuid;
select public.bs_check('revoked login loses access', public.client_portal_session('tok-b') is null);

-- ── Who may call ──
select public.bs_check('portal functions for the service role only',
  not has_function_privilege('authenticated', 'public.business_setup_portal_view(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_portal_view(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_portal_file(uuid, text, uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_portal_file(uuid, text, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_portal_client(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.business_setup_portal_view(uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_portal_file(uuid, text, uuid)', 'execute'));

-- ── Client login managed from the module ──
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900083', 'Login Client LLC', '{}');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select business_setup_portal_login_save('CL900083','login.client','longenough123')$$, 'permission');
select public.bs_expect_error($$select business_setup_portal_login_state('CL900083')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('no login at first', public.business_setup_portal_login_state('CL900083') is null);
select public.bs_expect_error($$select business_setup_portal_login_save('CL900083','bad name','longenough123')$$, 'Username');
select public.bs_expect_error($$select business_setup_portal_login_save('CL900083','login.client','short')$$, 'Password');
select public.bs_expect_error($$select business_setup_portal_login_save('CL900083','portal.a','longenough123')$$, 'taken');
select public.business_setup_portal_login_save('CL900083', 'login.client', 'longenough123') as ignored \gset
select public.bs_check('login issued', public.business_setup_portal_login_state('CL900083') ->> 'username' = 'login.client' and public.business_setup_portal_login_state('CL900083') ->> 'status' = 'active');
select public.bs_as(null);
select public.bs_check('the password is hashed', (select password_hash not like '%longenough123%' and length(password_hash) > 40 from public.client_portal_accounts where username = 'login.client'));
select public.bs_check('issuing a login creates the form', exists (select 1 from public.business_setup_onboarding_forms where client_id = 'CL900083' and status = 'Draft'));
select public.bs_check('the password never reaches the audit log', not exists (select 1 from public.business_setup_audit_log where new_data::text ~ 'longenough123'));
insert into public.client_portal_sessions (account_id, token_hash, expires_at) select id, encode(sha256('tok-l'::bytea), 'hex'), now() + interval '1 hour' from public.client_portal_accounts where username = 'login.client';
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_portal_login_status('CL900083', false);
select public.bs_as(null);
select public.bs_check('revoking ends the session', public.client_portal_session('tok-l') is null and (select status = 'revoked' from public.client_portal_accounts where username = 'login.client'));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_portal_login_status('CL900083', true);
select public.bs_check('restored', public.business_setup_portal_login_state('CL900083') ->> 'status' = 'active');
select public.bs_expect_error($$select business_setup_portal_login_status('CL900081x', true)$$, 'no login');
select public.bs_as(null);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
