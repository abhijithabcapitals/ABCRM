-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, right after rollback/015_018_rollback.sql. Compares with the snapshot taken at 014.
\set QUIET on
\pset tuples_only on
\pset format unaligned
do $$
declare bad text;
begin
  -- Functions: same set, same text, same grants. business_setup_case_docs is among them.
  select string_agg(coalesce(a.sig, b.sig), ', ') into bad
    from public.bs_pre015_fn a
    full join (select p.oid::regprocedure::text as sig, regexp_replace(pg_get_functiondef(p.oid), '\s+', ' ', 'g') as def, coalesce(p.proacl::text, '') as acl
                 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') b on a.sig = b.sig
   where a.sig is null or b.sig is null or a.def <> b.def or a.acl <> b.acl;
  if bad is not null then raise exception 'Functions differ from 014: %', bad; end if;
  -- Columns.
  select string_agg(coalesce(a.table_name, b.table_name) || '.' || coalesce(a.column_name, b.column_name), ', ') into bad
    from public.bs_pre015_col a
    full join (select table_name, column_name, data_type, is_nullable, coalesce(column_default, '') as dflt from information_schema.columns where table_schema = 'public' and table_name not like 'bs_pre%') b
      on a.table_name = b.table_name and a.column_name = b.column_name
   where a.column_name is null or b.column_name is null or a.data_type <> b.data_type or a.is_nullable <> b.is_nullable or a.dflt <> b.dflt;
  if bad is not null then raise exception 'Columns differ from 014: %', bad; end if;
  -- Triggers.
  select string_agg(coalesce(a.tgname, b.tgname), ', ') into bad
    from public.bs_pre015_trg a
    full join (select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid where not t.tgisinternal) b on a.relname = b.relname and a.tgname = b.tgname
   where a.tgname is null or b.tgname is null or a.def <> b.def;
  if bad is not null then raise exception 'Triggers differ from 014: %', bad; end if;
  -- Policies.
  select string_agg(coalesce(a.policyname, b.policyname), ', ') into bad
    from public.bs_pre015_pol a
    full join (select schemaname, tablename, policyname, cmd, coalesce(qual, '') as qual, coalesce(with_check, '') as with_check from pg_policies where schemaname in ('public', 'storage')) b
      on a.schemaname = b.schemaname and a.tablename = b.tablename and a.policyname = b.policyname
   where a.policyname is null or b.policyname is null or a.qual <> b.qual or a.with_check <> b.with_check or a.cmd <> b.cmd;
  if bad is not null then raise exception 'Policies differ from 014: %', bad; end if;
  -- Indexes.
  select string_agg(coalesce(a.indexname, b.indexname), ', ') into bad
    from public.bs_pre015_idx a
    full join (select tablename, indexname from pg_indexes where schemaname = 'public' and tablename not like 'bs_pre%') b on a.indexname = b.indexname
   where a.indexname is null or b.indexname is null;
  if bad is not null then raise exception 'Indexes differ from 014: %', bad; end if;
  -- Tables phase 2 added are gone; phase 1 rows stay.
  if to_regclass('public.business_setup_signed_quotes') is not null then raise exception 'business_setup_signed_quotes remains'; end if;
  if to_regclass('public.business_setup_cases') is null then raise exception 'business_setup_cases went'; end if;
  if (select count(*) from public.business_setup_cases where lead_name not like 'rollback-016%') <> (select cases from public.bs_pre015_kept) then raise exception 'cases lost rows'; end if;
  -- 016: the stages map back, and the old check is back.
  if (select stage from public.business_setup_cases where lead_name = 'rollback-015') <> 'Documentation' then raise exception 'a case with a quote did not return to Documentation'; end if;
  if (select stage from public.business_setup_cases where lead_name = 'rollback-016-onboarding') <> 'Services' then raise exception 'Onboarding with no quote did not return to Services'; end if;
  if (select stage from public.business_setup_cases where lead_name = 'rollback-016-pipeline') <> 'Assignment' then raise exception 'an unowned Pipeline case did not return to Assignment'; end if;
  if (select stage from public.business_setup_cases where lead_name = 'rollback-016-completion') <> 'Completed' then raise exception 'Completion did not return to Completed'; end if;
  begin
    insert into public.business_setup_cases (stage) values ('Onboarding');
    raise exception 'the old stage check is not back';
  exception when check_violation then null;
  end;
  if (select count(*) from public.hub_documents) <> (select docs from public.bs_pre015_kept) then raise exception 'hub_documents lost rows'; end if;
  if (select status from public.hub_documents where document_number = 'RB-015-Q') <> 'accepted' then raise exception 'an accepted quote changed'; end if;
  if (select count(*) from public.business_setup_fee_items where grp <> 'RB015') <> (select fees from public.bs_pre015_kept) then raise exception 'fee items lost rows'; end if;
  if (select default_amount from public.business_setup_fee_items where grp = 'RB015') <> 0 then raise exception 'an empty fee amount did not become 0'; end if;
  -- The header's statements about what a hand-recorded invoice and an advance become.
  if not exists (select 1 from public.business_setup_invoices where invoice_number = 'RB-015') then raise exception 'the invoice row went'; end if;
  if not exists (select 1 from public.business_setup_payments p join public.business_setup_cases c on c.id = p.case_id where p.note = 'rollback-015-advance' and p.quote_id is null) then raise exception 'the advance lost its case in this rollback'; end if;
  if public.business_setup_net_paid((select id from public.hub_documents where document_number = 'RB-015-Q')) <> 70 then raise exception 'net paid at 014 should still count the advance'; end if;
  raise notice 'rollback 015 check ok';
end $$;
