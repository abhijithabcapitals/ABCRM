-- Undoes migrations 001 to 012, in one transaction, using the copy from 000_snapshot.sql.
-- WARNING: everything entered in Business Setup is lost: forms, quotes' status and client links, payments, receipts, services, visas, audit log.
-- Client Master rows created through the module stay, because other modules may use them.
-- Left in place on purpose: the empty bucket business-setup-documents, which storage rules protect, and any files in it.
begin;
do $$
begin
  if to_regnamespace('bs_rollback') is null then raise exception 'No bs_rollback snapshot: nothing to restore from'; end if;
end $$;

-- Forms and handovers point at these, so they go first.
alter table public.client_portal_documents drop column if exists form_id;
delete from public.voucher_register where source = 'business_setup';

drop policy if exists business_setup_docs_read on storage.objects;
drop policy if exists business_setup_docs_insert on storage.objects;
drop policy if exists voucher_register_read_business_setup on public.voucher_register;

-- Columns the migrations added to hub_documents, with their indexes and checks.
do $$
declare c text;
begin
  for c in select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'hub_documents'
              and column_name not in (select column_name from bs_rollback.columns where table_name = 'hub_documents') loop
    execute format('alter table public.hub_documents drop column %I cascade', c);
  end loop;
end $$;

-- The functions the migrations replaced, as they were. Only these: another module may have changed others since.
do $$
declare r record;
begin
  for r in select definition from bs_rollback.functions
            where proname in ('client_base_list', 'client_inputs_assign', 'client_inputs_file', 'client_inputs_release', 'client_lookup', 'client_master_save',
                              'hub_document_create', 'hub_next_number', 'hub_numbering_save', 'hub_numbering_status', 'voucher_set_local') loop
    execute r.definition;
  end loop;
end $$;

-- Client Master read rules, as they were.
do $$
declare r record;
begin
  for r in select * from bs_rollback.policies where tablename in ('client_master', 'client_master_history') and policyname in ('client_master_read', 'client_master_history_read') loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    execute format('create policy %I on public.%I for select to authenticated using (%s)', r.policyname, r.tablename, r.qual);
  end loop;
end $$;
drop function if exists public.client_master_can(text);

-- This module's tables and functions.
do $$
declare t text; f regprocedure;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'business_setup_%' loop
    execute format('drop table public.%I cascade', t);
  end loop;
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind = 'f' and p.proname like '%business_setup%' loop
    execute format('drop function %s cascade', f);
  end loop;
end $$;

-- Receipt numbering, and the checks it widened.
delete from public.hub_number_counters where kind = 'receipt';
do $$
declare r record;
begin
  for r in select * from bs_rollback.constraints where table_name in ('voucher_register', 'hub_number_counters') and conname in ('voucher_register_source_check', 'hub_number_counters_kind_check') loop
    execute format('alter table public.%I drop constraint if exists %I', r.table_name, r.conname);
    execute format('alter table public.%I add constraint %I %s', r.table_name, r.conname, r.definition);
  end loop;
end $$;
update public.hub_settings h set value = s.value from bs_rollback.hub_settings s where s.key = h.key and h.key = 'document_numbering';
insert into public.banking_role_permissions select * from bs_rollback.banking_role_permissions on conflict do nothing;
commit;
