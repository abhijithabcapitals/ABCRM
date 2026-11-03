-- LOCAL TEST ONLY: loading the department's old records. Invented rows. Run through tests/run-local.sh, after 010.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create temp table f60 (k text primary key, v text);
grant all on f60 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f60 where k = p_k $$;
create function pg_temp.r(p_key text) returns public.business_setup_import_rows language sql as $$ select * from public.business_setup_import_rows where source_key = p_key $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL900100', 'Exact Match LLC', jsonb_build_object('Client Legal Name', 'Exact Match LLC', 'General Email', 'staff@a.test', 'General Phone', '+9711', 'Trade License Number', 'KEEP-ME')),
  ('CL900101', 'Near Match Trading LLC', jsonb_build_object('Client Legal Name', 'Near Match Trading LLC'));
insert into public.business_setup_kyc_profiles (client_id, licence_number) values ('CL900100', 'STAFF-LIC');
insert into f60 values ('imp', '00000000-0000-0000-0000-00000000aaaa');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_import_stage('%s','[]')$$, pg_temp.fx('imp')), 'permission');
select public.bs_expect_error(format($$select business_setup_import_apply('%s')$$, pg_temp.fx('imp')), 'permission');
select public.bs_expect_error(format($$select business_setup_import_report('%s')$$, pg_temp.fx('imp')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_import_stage('%s','[]')$$, pg_temp.fx('imp')), 'permission');

select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_import_stage(pg_temp.fx('imp')::uuid, $json$[
  {"source":"company","source_key":"company:exact","name":"Exact Match L.L.C","payload":{"licence_number":"L-OLD","licence_expiry":"2026-12-01","licence_date":"2025-12-01","jurisdiction":"IFZA","client_status":"Active","kyc_form":"Done","shareholder":"Person S"}},
  {"source":"company","source_key":"company:near","name":"Near Match LLC","payload":{"licence_number":"L-N"}},
  {"source":"company","source_key":"company:new","name":"Brand New FZE","payload":{"licence_number":"L-NEW","licence_expiry":"2027-01-15","licence_date":"2026-01-15","jurisdiction":"RAKEZ","client_status":"Client Not Responding","kyc_form":"Done"}},
  {"source":"company","source_key":"company:baddate","name":"Odd Date LLC","payload":{"licence_number":"L-B","bad_dates":["licence_date"]}},
  {"source":"visa","source_key":"visa:1","name":"Person One","company":"Exact Match LLC","payload":{"occupation":"PARTNER","issue_date":"2025-01-01","expiry_date":"2027-01-01","status":"Active"}},
  {"source":"visa","source_key":"visa:2","name":"Person Two","company":"Brand New FZE","payload":{"occupation":"INVESTOR","expiry_date":"2027-02-01"}},
  {"source":"visa","source_key":"visa:3","name":"Person Three","company":"Nobody Known LLC","payload":{"occupation":"INVESTOR"}},
  {"source":"ejari","source_key":"ejari:1","name":"Exact Match LLC","company":"Exact Match LLC","payload":{"provider":"Start Up Group"}},
  {"source":"service","source_key":"svc:1","name":"Exact Match LLC","company":"Exact Match LLC","payload":{"old_status":"Done","assignee":"Someone","zone":"IFZA","payment_status":"Fully Paid"}},
  {"source":"service","source_key":"svc:2","name":"RENEW A THING","company":"RENEW A THING","payload":{"old_status":"Done"}},
  {"source":"quotation","source_key":"q:1","name":"A Prospect","payload":{"zone":"IFZA"}}
]$json$::jsonb) as ignored \gset

select public.bs_check('exact match links', (pg_temp.r('company:exact')).match_client = 'CL900100' and (pg_temp.r('company:exact')).decision = 'matched');
select public.bs_check('near match held', (pg_temp.r('company:near')).decision = 'held' and (pg_temp.r('company:near')).reason ~ 'CL900101');
select public.bs_check('an unknown company is new', (pg_temp.r('company:new')).decision = 'new');
select public.bs_check('a bad date is held', (pg_temp.r('company:baddate')).decision = 'held' and (pg_temp.r('company:baddate')).reason ~ 'licence_date');
select public.bs_check('a visa of a company in this import can load', (pg_temp.r('visa:2')).decision = 'matched');
select public.bs_check('a visa of an unknown company is held', (pg_temp.r('visa:3')).decision = 'held');
select public.bs_check('a task with no company name is held', (pg_temp.r('svc:2')).decision = 'held');
select public.bs_check('quotations are report only', (pg_temp.r('q:1')).decision = 'report');
select public.bs_check('report counts per source', (public.business_setup_import_report(pg_temp.fx('imp')::uuid) -> 'sources' -> 'company' ->> 'new')::int = 1
  and (public.business_setup_import_report(pg_temp.fx('imp')::uuid) -> 'sources' -> 'company' ->> 'held')::int = 2 and (public.business_setup_import_report(pg_temp.fx('imp')::uuid) -> 'sources' -> 'company' ->> 'matched')::int = 1
  and (public.business_setup_import_report(pg_temp.fx('imp')::uuid) -> 'sources' -> 'company' ->> 'missing_email')::int = 1 and (public.business_setup_import_report(pg_temp.fx('imp')::uuid) -> 'sources' -> 'company' ->> 'missing_phone')::int = 1);
select public.bs_check('nothing is loaded before apply', not exists (select 1 from public.client_master where legal_name = 'Brand New FZE'));

-- ── Apply ──
insert into f60 select 'apply1', public.business_setup_import_apply(pg_temp.fx('imp')::uuid)::text;
select public.bs_check('held does not block', (pg_temp.fx('apply1')::jsonb ->> 'applied')::int = 6 and (pg_temp.fx('apply1')::jsonb ->> 'held')::int = 4);
select public.bs_as(null);
select public.bs_check('new client created with its licence', (select data ->> 'Trade License Number' = 'L-NEW' and data ->> 'License Expiry Date' = '15/01/2027' and data ->> 'License Issue Date' = '15/01/2026' from public.client_master where legal_name = 'Brand New FZE'));
insert into f60 select 'cl_new', client_id from public.client_master where legal_name = 'Brand New FZE';
select public.bs_check('new client KYC', (select kyc_state = 'Done' and company_status = 'Existing' and jurisdiction = 'RAKEZ' and client_status = 'Client Not Responding' and licence_expiry = '2027-01-15' from public.business_setup_kyc_profiles where client_id = pg_temp.fx('cl_new')));
select public.bs_check('no login issued', not exists (select 1 from public.client_portal_accounts where client_master_id = pg_temp.fx('cl_new')));
select public.bs_check('staff value survives', (select data ->> 'General Email' = 'staff@a.test' and data ->> 'Trade License Number' = 'KEEP-ME' from public.client_master where client_id = 'CL900100'));
select public.bs_check('staff KYC value survives, blanks are filled', (select licence_number = 'STAFF-LIC' and licence_expiry = '2026-12-01' and ejari_provider = 'Start Up Group' and client_status = 'Active' from public.business_setup_kyc_profiles where client_id = 'CL900100'));
select public.bs_check('old details kept in extras', (select licence_extras ->> 'shareholder' = 'Person S' from public.business_setup_kyc_profiles where client_id = 'CL900100'));
select public.bs_check('visa loaded', (select expiry_date = '2027-01-01' and occupation = 'PARTNER' and source = 'import' from public.business_setup_visas where source_key = 'visa:1' and client_id = 'CL900100'));
select public.bs_check('a visa finds the company created in the same run', exists (select 1 from public.business_setup_visas where source_key = 'visa:2' and client_id = pg_temp.fx('cl_new')));
select public.bs_check('history is historical', (select historical and status = 'Completed' and notes ~ 'Fully Paid' from public.business_setup_services where source_key = 'svc:1'));
select public.bs_check('payment label only', not exists (select 1 from public.business_setup_payments where client_id = 'CL900100'));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('difference reported', public.business_setup_import_report(pg_temp.fx('imp')::uuid)::text ~ 'differences' and (pg_temp.r('company:exact')).reason ~ 'Trade License Number');
select public.bs_as(null);
select public.bs_check('applied rows are marked', (pg_temp.r('visa:1')).decision = 'applied' and (pg_temp.r('visa:1')).applied_at is not null);
select public.bs_check('historical work is not active', (select count(*) from public.business_setup_services where client_id = 'CL900100' and status not in ('Completed', 'Cancelled') and not historical) = 0);

-- ── Run again after a staff edit ──
update public.client_master set data = data || '{"General Email":"edited@a.test"}' where client_id = 'CL900100';
update public.business_setup_visas set occupation = 'EDITED' where source_key = 'visa:1';
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_import_stage(pg_temp.fx('imp')::uuid, $json$[
  {"source":"company","source_key":"company:exact","name":"Exact Match LLC","payload":{"licence_number":"L-CHANGED"}},
  {"source":"visa","source_key":"visa:1","name":"Person One","company":"Exact Match LLC","payload":{"occupation":"OVERWRITE"}}
]$json$::jsonb) as ignored \gset
insert into f60 select 'apply2', public.business_setup_import_apply(pg_temp.fx('imp')::uuid)::text;
select public.bs_as(null);
select public.bs_check('an applied row is skipped', (pg_temp.fx('apply2')::jsonb ->> 'applied')::int = 0 and (pg_temp.r('visa:1')).payload ->> 'occupation' = 'PARTNER');
select public.bs_check('staff value survives a re-run', (select data ->> 'General Email' = 'edited@a.test' from public.client_master where client_id = 'CL900100'));
select public.bs_check('no duplicates on re-run', (select count(*) from public.business_setup_visas where client_id = 'CL900100') = 1 and (select occupation = 'EDITED' from public.business_setup_visas where source_key = 'visa:1'));

-- ── A person decides a held row ──
insert into f60 select 'near_id', id::text from public.business_setup_import_rows where source_key = 'company:near';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_import_decide('%s','CL900101','matched')$$, pg_temp.fx('near_id')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select business_setup_import_decide('%s','CL999999','matched')$$, (pg_temp.r('company:near')).id), 'not found');
select public.bs_expect_error(format($$select business_setup_import_decide('%s',null,'other')$$, (pg_temp.r('company:near')).id), 'Unknown');
select public.business_setup_import_decide((pg_temp.r('company:near')).id, 'CL900101', 'matched');
select public.business_setup_import_decide((pg_temp.r('svc:2')).id, null, 'skip');
insert into f60 select 'apply3', public.business_setup_import_apply(pg_temp.fx('imp')::uuid)::text;
select public.bs_as(null);
select public.bs_check('a decided row applies', (pg_temp.fx('apply3')::jsonb ->> 'applied')::int = 1 and (select licence_number = 'L-N' from public.business_setup_kyc_profiles where client_id = 'CL900101'));
select public.bs_check('a skipped row loads nothing', not exists (select 1 from public.business_setup_services where source_key = 'svc:2'));
select public.bs_check('apply is in the audit log', public.bs_audit_count('import_apply', pg_temp.fx('imp'), '{"applied":6}') = 1);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
