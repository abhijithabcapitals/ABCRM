-- LOCAL TEST ONLY: Phase A review fixes. Run through tests/run-local.sh, after 140.
--   a case quote must hold a service, Send to Accounts is for managers, Company Templates quotes keep no VAT, a no-case quote and its letter through the portal.
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
create temp table f150 (k text primary key, v text);
grant all on f150 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f150 where k = p_k $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL990150', 'Fifteen LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL990150', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL990150', 'Fifteen', 'portal.fifteen150', 'x', 'active') on conflict do nothing;
insert into f150 select 'acc', id::text from public.client_portal_accounts where username = 'portal.fifteen150';
insert into public.business_setup_fee_items (grp, name, is_service, vat_rate) values ('T150', 'T150 government fee', false, 5) on conflict do nothing;
insert into f150 select 'cost', id::text from public.business_setup_fee_items where name = 'T150 government fee' limit 1;
insert into public.business_setup_cases (client_id, stage, lead_name) values ('CL990150', 'Onboarding', 'T150');
insert into f150 select 'case', id::text from public.business_setup_cases where lead_name = 'T150' order by created_at desc limit 1;

create function pg_temp.body(p_lines jsonb, p_case text default null, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_id', 'CL990150', 'client_name', 'Fifteen LLC', 'contact_name', 'F', 'contact_email', 'f@x.ae',
    'contact_phone', '050', 'client_address', 'Dubai', 'services', '["S"]'::jsonb, 'lines', p_lines) || case when p_case is null then '{}'::jsonb else jsonb_build_object('case_id', p_case) end || p_extra
$$;

-- ── A case quote must hold a service, or its case could never close ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.hub_document_create(%L::jsonb)$$,
  pg_temp.body(jsonb_build_array(jsonb_build_object('description', 'Fee', 'amount', 100, 'fee_item_id', pg_temp.fx('cost'))), pg_temp.fx('case'))), 'at least one service');
select public.bs_check('case_quote_service: a quote with a service line beside a cost line is allowed',
  (public.hub_document_create(pg_temp.body(jsonb_build_array(jsonb_build_object('description', 'Fee', 'amount', 100, 'fee_item_id', pg_temp.fx('cost')),
    jsonb_build_object('description', 'Typed service', 'amount', 200)), pg_temp.fx('case')))).total_amount = 315);

-- ── Send to Accounts is for a holder of setup.cases.approve ──
select public.bs_as(null);
insert into f150 select 'q', id::text from public.hub_documents where case_id = pg_temp.fx('case')::uuid and doc_type = 'quote';
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_signed_decide(public.business_setup_signed_add(pg_temp.fx('q')::uuid, 'staff/CL990150/signed.pdf'), true, 'ok');
select public.bs_as(null);
update public.business_setup_services set status = 'Completed' where quote_id = pg_temp.fx('q')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_send_to_accounts('%s')$$, pg_temp.fx('q')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_send_to_accounts('%s')$$, pg_temp.fx('q')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_send_to_accounts(pg_temp.fx('q')::uuid, 'Ready');
select public.bs_check('send_manager: a manager sends', public.business_setup_handover_state(pg_temp.fx('q')::uuid) ->> 'state' = 'With Accounts');

-- ── A quote that asks for no VAT (Company Templates, hub_library_create) keeps it: its printed document shows none ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
create temp table lib150 as select * from public.hub_document_create(pg_temp.body(jsonb_build_array(jsonb_build_object('description', 'Library fee', 'amount', 1000)), null, '{"vat_mode":"none"}'::jsonb));
select public.bs_check('library_quote: no VAT is added to the stored total', (select total_amount = 1000 and vat_mode = 'none' and coalesce(vat_amount, 0) = 0 from lib150));
select public.bs_check('library_quote: its lines carry no VAT rate', (select not (lines -> 0 ? 'vat_rate') from lib150));
create temp table case150 as select * from public.hub_document_create(pg_temp.body(jsonb_build_array(jsonb_build_object('description', 'Desk fee', 'amount', 1000))));
select public.bs_check('desk_quote: any other Business Setup quote has 5% on top', (select total_amount = 1050 and vat_mode = 'exclusive' from case150));

select public.bs_as(null);
do $$
declare v_fn text;
begin
  -- hub_library_create (Template Hub 005) is loaded by run-local.sh: it must still reach this path with vat_mode none.
  select pg_get_functiondef('public.hub_library_create(jsonb)'::regprocedure) into v_fn;
  perform public.bs_check('library_quote: hub_library_create sends vat_mode none', v_fn like '%''vat_mode'', ''none''%');
end $$;

-- ── A quote with no case, and its letter, through the portal ──
insert into f150 select 'nq', id::text from lib150;
insert into f150 select 'dq', id::text from case150;
grant select on case150 to service_role;
select public.bs_check('nocase_view: the quote can be decided', (select (e ->> 'can_decide')::boolean from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx('acc')::uuid) -> 'quotes') e where e ->> 'id' = pg_temp.fx('dq')));
insert into public.hub_documents (parent_id, doc_type, department, document_number, document_serial, client_id, client_name, vat_mode, total_amount)
  values (pg_temp.fx('dq')::uuid, 'letter', 'Business Setup', 'T150-L1', 915001, 'CL990150', 'Fifteen LLC', 'none', 1050);
insert into f150 select 'l', id::text from public.hub_documents where document_number = 'T150-L1';
select public.bs_check('nocase_letter: no decision while the quote is open', not exists (select 1 from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx('acc')::uuid) -> 'letters') e where e ->> 'id' = pg_temp.fx('l') and (e ->> 'can_decide')::boolean));
select public.bs_expect_error(format($$select public.business_setup_portal_decide('%s', '%s', 'Accepted')$$, pg_temp.fx('acc'), pg_temp.fx('l')), 'accept the quote');
select public.business_setup_portal_decide(pg_temp.fx('acc')::uuid, pg_temp.fx('dq')::uuid, 'Accepted');
select public.bs_check('nocase_accept: Accept with no case accepts the quote', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('dq')::uuid));
select public.bs_check('nocase_letter: the letter can be decided once the quote is accepted', exists (select 1 from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx('acc')::uuid) -> 'letters') e where e ->> 'id' = pg_temp.fx('l') and (e ->> 'can_decide')::boolean));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
