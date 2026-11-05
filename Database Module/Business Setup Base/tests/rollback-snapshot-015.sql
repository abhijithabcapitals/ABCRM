-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, at 014, before 015 and 018. What rollback/015_018_rollback.sql must put back.
create table public.bs_pre015_fn as
  select p.oid::regprocedure::text as sig, regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g') as def, coalesce(p.proacl::text, '') as acl
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f';
create table public.bs_pre015_col as
  select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as dflt from information_schema.columns where table_schema = 'public' and table_name not like 'bs_pre%';
create table public.bs_pre015_trg as
  select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal;
create table public.bs_pre015_pol as
  select schemaname, tablename, policyname, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check from pg_policies where schemaname in ('public', 'storage');
create table public.bs_pre015_idx as
  select tablename, indexname from pg_indexes where schemaname = 'public' and tablename not like 'bs_pre%';
-- Phase 1 data that must stay.
insert into public.client_master (client_id, legal_name, data) values ('CL990015', 'Rollback 015', '{}') on conflict do nothing;
insert into public.business_setup_cases (client_id, stage, lead_name) values ('CL990015', 'Documentation', 'rollback-015');
insert into public.hub_documents (doc_type, department, client_name, client_id, document_number, document_serial, case_id, status, total_amount)
  select 'quote', 'Business Setup', 'Rollback 015', 'CL990015', 'RB-015-Q', 1, id, 'accepted', 1000 from public.business_setup_cases where lead_name = 'rollback-015';
create table public.bs_pre015_kept as select
  (select count(*) from public.business_setup_cases) as cases, (select count(*) from public.hub_documents) as docs,
  (select count(*) from public.business_setup_fee_items) as fees;
