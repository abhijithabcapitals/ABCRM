-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, right after rollback/001_012_rollback.sql.
\set QUIET on
\pset tuples_only on
\pset format unaligned
do $$
declare bad text;
begin
  if exists (select 1 from pg_tables where schemaname = 'public' and tablename like 'business_setup_%') then raise exception 'Business Setup tables remain'; end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like '%business_setup%') then raise exception 'Business Setup functions remain'; end if;
  if to_regprocedure('public.client_master_can(text)') is not null then raise exception 'client_master_can remains'; end if;
  select string_agg(s.proname, ', ') into bad from bs_rollback.functions s join pg_proc p on p.oid::regprocedure::text = s.signature where pg_get_functiondef(p.oid) <> s.definition;
  if bad is not null then raise exception 'Functions differ from the snapshot: %', bad; end if;
  select string_agg(s.signature, ', ') into bad from bs_rollback.functions s where to_regprocedure(s.signature) is null;
  if bad is not null then raise exception 'Functions missing after rollback: %', bad; end if;
  select string_agg(column_name, ', ') into bad from information_schema.columns c where table_schema = 'public' and table_name = 'hub_documents' and not exists (select 1 from bs_rollback.columns s where s.table_name = 'hub_documents' and s.column_name = c.column_name);
  if bad is not null then raise exception 'hub_documents keeps added columns: %', bad; end if;
  if exists (select 1 from information_schema.columns where table_name = 'client_portal_documents' and column_name = 'form_id') then raise exception 'form_id remains'; end if;
  if (select count(*) from public.hub_documents) <> (select count(*) from bs_rollback.hub_documents) then raise exception 'hub_documents lost rows'; end if;
  if exists (select 1 from public.voucher_register where source = 'business_setup') then raise exception 'voucher rows remain'; end if;
  select string_agg(p.policyname, ', ') into bad from bs_rollback.policies s join pg_policies p on p.schemaname = 'public' and p.tablename = s.tablename and p.policyname = s.policyname where p.qual is distinct from s.qual;
  if bad is not null then raise exception 'Policies differ: %', bad; end if;
  if has_schema_privilege('authenticated', 'bs_rollback', 'usage') or has_schema_privilege('anon', 'bs_rollback', 'usage') then raise exception 'The snapshot schema is readable'; end if;
  raise notice 'rollback check ok';
end $$;
