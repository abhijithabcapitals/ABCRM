-- Run once, before the first apply of migrations 001 to 012 on a database. Copies what they change into a private
-- schema, so rollback/001_012_rollback.sql can restore it. No role but the owner can read this schema: it holds
-- client records and password hashes. Drop it when the module has settled: drop schema bs_rollback cascade.
-- Refuses to run twice, so a second run cannot replace the true "before" copy.
do $$
begin
  if to_regnamespace('bs_rollback') is not null then raise exception 'bs_rollback already exists: the snapshot was taken'; end if;
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'business_setup_%') then raise exception 'Business Setup tables already exist: too late to snapshot'; end if;
end $$;
create schema bs_rollback;
create table bs_rollback.functions as
  select p.oid::regprocedure::text as signature, p.proname, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f';
create table bs_rollback.policies as select * from pg_policies where schemaname = 'public' and tablename in ('client_master', 'client_master_history', 'voucher_register');
create table bs_rollback.constraints as
  select c.conrelid::regclass::text as table_name, c.conname, pg_get_constraintdef(c.oid) as definition
    from pg_constraint c where c.conrelid in ('public.voucher_register'::regclass, 'public.hub_number_counters'::regclass, 'public.hub_documents'::regclass) and c.contype = 'c';
create table bs_rollback.columns as
  select table_name, column_name from information_schema.columns where table_schema = 'public' and table_name in ('hub_documents', 'client_portal_documents');
create table bs_rollback.hub_documents as table public.hub_documents;
create table bs_rollback.hub_settings as table public.hub_settings;
create table bs_rollback.hub_number_counters as table public.hub_number_counters;
create table bs_rollback.voucher_register as table public.voucher_register;
create table bs_rollback.client_master as table public.client_master;
create table bs_rollback.client_portal_accounts as table public.client_portal_accounts;
create table bs_rollback.client_portal_documents as table public.client_portal_documents;
create table bs_rollback.banking_role_permissions as table public.banking_role_permissions;
revoke all on schema bs_rollback from public, anon, authenticated, service_role;
revoke all on all tables in schema bs_rollback from public, anon, authenticated, service_role;
create table bs_rollback.taken (taken_at timestamptz not null default now());
insert into bs_rollback.taken default values;
