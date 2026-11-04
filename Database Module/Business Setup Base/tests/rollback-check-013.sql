-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, right after rollback/013_019_rollback.sql.
\set QUIET on
\pset tuples_only on
\pset format unaligned
do $$
declare bad text;
begin
  if to_regclass('public.business_setup_reassign_requests') is not null then raise exception 'business_setup_reassign_requests remains'; end if;
  if to_regclass('public.business_setup_cases') is not null then raise exception 'business_setup_cases remains'; end if;
  if to_regclass('public.business_setup_case_seq') is not null then raise exception 'the case number sequence remains'; end if;
  select string_agg(table_name || '.' || column_name, ', ') into bad from information_schema.columns
   where table_schema = 'public' and column_name = 'case_id' and table_name in ('hub_documents', 'business_setup_payments', 'business_setup_onboarding_forms');
  if bad is not null then raise exception 'case_id remains on: %', bad; end if;
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
     and (p.proname like 'business_setup_case%' or p.proname like 'business_setup_reassign%' or p.proname in ('business_setup_form_staff_save', 'business_setup_form_doc_add'));
  if bad is not null then raise exception 'case functions remain: %', bad; end if;
  select string_agg(t.tgname, ', ') into bad from pg_trigger t where not t.tgisinternal and t.tgname like 'business_setup_case%';
  if bad is not null then raise exception 'case triggers remain: %', bad; end if;
  select string_agg(s.proname, ', ') into bad from public.bs_pre013 s join pg_proc p on p.proname = s.proname and p.pronamespace = 'public'::regnamespace where regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g') <> regexp_replace(s.def, '\s+', ' ', 'g');   -- line endings differ between files
  if bad is not null then raise exception 'Functions differ from before 013: %', bad; end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'business_setup_staff_upload') then raise exception 'the staff upload policy remains'; end if;
  if to_regprocedure('public.business_setup_staff_upload_ok(text, text)') is not null then raise exception 'business_setup_staff_upload_ok remains'; end if;
  if exists (select 1 from public.business_setup_role_permissions where permission in ('setup.leads.manage', 'setup.cases.approve')) then raise exception 'new permissions remain'; end if;
  if business_setup_permissions() && array['setup.leads.manage', 'setup.cases.approve'] then raise exception 'permission list still has the new rights'; end if;
  if (select count(*) from public.hub_documents) <> (select n from public.bs_pre013_docs) then raise exception 'hub_documents lost rows'; end if;
  begin
    update public.business_setup_payments set amount = amount;
    if exists (select 1 from public.business_setup_payments) then raise exception 'payments are editable again'; end if;
  exception when others then
    if sqlerrm not ilike '%append-only%' then raise; end if;
  end;
  raise notice 'rollback 013 check ok';
end $$;
