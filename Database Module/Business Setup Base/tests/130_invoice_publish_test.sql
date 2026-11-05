-- LOCAL TEST ONLY: Zoho invoice published to the client login and the unique invoice number per quote (client flow Task 5). Run through tests/run-local.sh, after 120.
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
create temp table f130 (k text primary key, v text);
grant all on f130 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f130 where k = p_k $$;
create function pg_temp.docs(p_k text) returns jsonb language sql security definer as $$ select public.business_setup_case_docs(pg_temp.fx(p_k)::uuid) $$;
create function pg_temp.stage(p_k text) returns text language sql security definer as $$ select stage from public.business_setup_cases where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.mk(p_key text, p_client text, p_stage text, p_status text default 'accepted') returns void language plpgsql as $$
declare c uuid; q uuid := gen_random_uuid();
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.business_setup_cases (client_id, stage, lead_name) values (p_client, p_stage, p_client) returning id into c;
  insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  values (q, q, 'quote', 'Business Setup', p_client, p_client, 'T130-' || p_key, 1000, p_status, c);
  insert into f130 values (p_key || '_case', c::text), (p_key || '_q', q::text);
end $$;
select public.bs_as(null);

select pg_temp.mk('a', 'CL975101', 'Onboarding');
select pg_temp.mk('draftq', 'CL975102', 'Onboarding', 'issued');
select pg_temp.mk('lost', 'CL975103', 'Lead');
select pg_temp.mk('b', 'CL975104', 'Onboarding');
update public.business_setup_cases set stage = 'Lost' where id = pg_temp.fx('lost_case')::uuid;

-- ── privileges: only the service role can call it ──
select public.bs_check('publish_priv: the service role may execute, signed-in users and anon may not',
  has_function_privilege('service_role', 'public.business_setup_invoice_publish(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_invoice_publish(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.business_setup_invoice_publish(jsonb)', 'execute')
  and not has_function_privilege('public', 'public.business_setup_invoice_publish(jsonb)', 'execute'));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_invoice_publish('{"quote_id":"%s","invoice_number":"X","amount":1,"zoho_id":"z1","file_path":"CL975101/invoice/zoho-z1.pdf"}')$$, pg_temp.fx('a_q')), 'permission denied');
select public.bs_as(null);

-- ── publish: a row, the file path, the figures, the case item ──
select (pg_temp.docs('a_case') ->> 'invoice')::boolean as before_inv \gset
select public.bs_check('publish: the Invoice item is open before', :'before_inv'::boolean = false);
set role service_role;
select public.business_setup_invoice_publish(jsonb_build_object('quote_id', pg_temp.fx('a_q'), 'invoice_number', ' INV-0001 ', 'invoice_date', '2026-11-03', 'amount', 1050.5,
  'file_path', 'CL975101/invoice/zoho-9001.pdf', 'zoho_id', '9001', 'published_by', '00000000-0000-0000-0000-00000000000b')) as pub1 \gset
select public.bs_as(null);
select public.bs_check('publish: one row from Zoho with its file, figures, quote, case and client',
  (select count(*) = 1 and bool_and(id = :'pub1'::uuid and source = 'zoho' and zoho_id = '9001' and invoice_number = 'INV-0001' and issued_on = date '2026-11-03' and amount = 1050.50
     and file_path = 'CL975101/invoice/zoho-9001.pdf' and quote_id = pg_temp.fx('a_q')::uuid and case_id = pg_temp.fx('a_case')::uuid and client_id = 'CL975101'
     and created_by = '00000000-0000-0000-0000-00000000000b'::uuid) from public.business_setup_invoices where zoho_id = '9001'));
select public.bs_check('publish_meets_invoice_item: the case Invoice item is now met', (pg_temp.docs('a_case') ->> 'invoice')::boolean);
select public.bs_check('publish: the publish is audited with who published it', public.bs_audit_count('invoice_publish', :'pub1', '{"zoho_id":"9001","published_by":"00000000-0000-0000-0000-00000000000b"}') = 1);

-- ── a repeat returns the same row and adds nothing ──
set role service_role;
select public.business_setup_invoice_publish(jsonb_build_object('quote_id', pg_temp.fx('a_q'), 'invoice_number', 'INV-0001', 'amount', 1050.5,
  'file_path', 'CL975101/invoice/zoho-9001.pdf', 'zoho_id', '9001')) as pub2 \gset
select public.bs_as(null);
select public.bs_check('publish_twice: the same zoho_id returns the same invoice and adds no row', :'pub2'::uuid = :'pub1'::uuid
  and (select count(*) from public.business_setup_invoices where zoho_id = '9001') = 1);

-- ── a row the Zoho read-back made without a file is completed, not duplicated ──
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source, zoho_id) values ('CL975104', pg_temp.fx('b_q')::uuid, 'INV-B1', 'zoho', '9100');
set role service_role;
select public.business_setup_invoice_publish(jsonb_build_object('quote_id', pg_temp.fx('b_q'), 'invoice_number', 'INV-B1', 'amount', 10,
  'file_path', 'CL975104/invoice/zoho-9100.pdf', 'zoho_id', '9100')) as pub3 \gset
select public.bs_as(null);
select public.bs_check('publish_adopts: the read-back row gets the file and stays one row',
  (select count(*) = 1 and bool_and(file_path = 'CL975104/invoice/zoho-9100.pdf' and id = :'pub3'::uuid and case_id = pg_temp.fx('b_case')::uuid) from public.business_setup_invoices where zoho_id = '9100'));

-- ── refusals: plain sentences, nothing written ──
create function pg_temp.pub(p jsonb) returns uuid language plpgsql as $$
begin
  return public.business_setup_invoice_publish(p);
end $$;
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N1","amount":1,"zoho_id":"z-d","file_path":"CL975102/invoice/zoho-z-d.pdf"}')$$, pg_temp.fx('draftq_q')), 'accepted Business Setup quote');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N1","amount":1,"zoho_id":"z-l","file_path":"CL975103/invoice/zoho-z-l.pdf"}')$$, pg_temp.fx('lost_q')), 'lost');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N2","amount":1,"zoho_id":"z-p","file_path":"CL999999/invoice/zoho-z-p.pdf"}')$$, pg_temp.fx('a_q')), 'file path must be under CL975101/invoice/');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N2","amount":1,"zoho_id":"z-p","file_path":"CL975101/invoice/../zoho-z-p.pdf"}')$$, pg_temp.fx('a_q')), 'file path');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"inv-0001","amount":1,"zoho_id":"z-n","file_path":"CL975101/invoice/zoho-z-n.pdf"}')$$, pg_temp.fx('a_q')), 'already recorded on this quote');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"INV-X","amount":1,"zoho_id":"9001","file_path":"CL975104/invoice/zoho-9001.pdf"}')$$, pg_temp.fx('b_q')), 'another quote');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"","amount":1,"zoho_id":"z-e","file_path":"CL975101/invoice/zoho-z-e.pdf"}')$$, pg_temp.fx('a_q')), 'invoice number');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N3","amount":-1,"zoho_id":"z-e","file_path":"CL975101/invoice/zoho-z-e.pdf"}')$$, pg_temp.fx('a_q')), 'amount');
select public.bs_as(null);
select public.bs_expect_error(format($$select pg_temp.pub('{"quote_id":"%s","invoice_number":"N3","amount":1,"zoho_id":"","file_path":"CL975101/invoice/zoho-z-e.pdf"}')$$, pg_temp.fx('a_q')), 'Zoho invoice');
select public.bs_as(null);
select public.bs_check('publish_refused: none of the refused calls wrote a row',
  (select count(*) from public.business_setup_invoices where zoho_id in ('z-d', 'z-l', 'z-p', 'z-n', 'z-e')) = 0);

-- ── the unique number per quote, in the table itself ──
select public.bs_expect_error(format($$insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', '%s', 'inv-0001', 'Manual')$$, pg_temp.fx('a_q')), 'duplicate key');
select public.bs_expect_error(format($$insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', '%s', '  INV-0001', 'Manual')$$, pg_temp.fx('a_q')), 'duplicate key');
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', pg_temp.fx('a_q')::uuid, 'INV-0002', 'Manual');
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', pg_temp.fx('a_q')::uuid, null, 'Manual'), ('CL975101', pg_temp.fx('a_q')::uuid, null, 'Manual');
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', null, 'INV-0001', 'Manual'), ('CL975101', null, 'INV-0001', 'Manual');
select public.bs_check('unique_number: another number, no number, and no quote are all allowed',
  (select count(*) from public.business_setup_invoices where client_id = 'CL975101') = 6);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_invoice_record('{"quote_id":"%s","invoice_number":"inv-0001","amount":5}')$$, pg_temp.fx('a_q')), 'already recorded');
select public.bs_as(null);

-- ── the migration reports duplicates in plain words and builds nothing; once they are fixed it builds the index ──
alter table public.business_setup_invoices disable trigger user;
drop index public.business_setup_invoices_quote_number_uq;
insert into public.business_setup_invoices (client_id, quote_id, invoice_number, source) values ('CL975101', pg_temp.fx('a_q')::uuid, 'inv-0001 ', 'Manual');
alter table public.business_setup_invoices enable trigger user;
select count(*) as dup_before from (select 1 from public.business_setup_invoices where quote_id is not null and invoice_number is not null group by quote_id, lower(btrim(invoice_number)) having count(*) > 1) d \gset
select public.bs_check('migration_dupes: the fixture holds one duplicate group', :dup_before = 1);
\echo (the next error line is expected: the migration refuses to build the index over duplicates)
\set ON_ERROR_STOP off
\ir ../migrations/016_client_flow.sql
\set ON_ERROR_STOP on
select public.bs_check('migration_dupes: with duplicates the index is not built', to_regclass('public.business_setup_invoices_quote_number_uq') is null);
select public.bs_check('migration_dupes: no row was changed or removed by the migration', (select count(*) from public.business_setup_invoices where client_id = 'CL975101') = 7);
delete from public.business_setup_invoices where invoice_number = 'inv-0001 ';
\ir ../migrations/016_client_flow.sql
select public.bs_check('migration_dupes: once the duplicate is gone the index is built', to_regclass('public.business_setup_invoices_quote_number_uq') is not null);
\ir ../migrations/016_client_flow.sql
select public.bs_check('migration_dupes: running the file again with the index in place is fine', to_regclass('public.business_setup_invoices_quote_number_uq') is not null);
