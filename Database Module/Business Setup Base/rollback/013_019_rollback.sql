-- Undoes migrations 013 onward (the case restructure), newest first, in one transaction. Migrations 001 to 012 stay.
-- Run with psql (it uses \ir to re-run the file that last defined a replaced function). Each migration adds its section
-- at the top of the body, above the one before it, so the order here is the reverse of the order they were applied.
-- WARNING: cases and everything stored only on them are lost. Quotes, letters, payments and forms keep their rows.
begin;

-- ── 013_cases.sql ────────────────────────────────────────────────────
drop trigger if exists business_setup_case_form on public.business_setup_onboarding_forms;
drop trigger if exists business_setup_case_doc_ins on public.hub_documents;
drop trigger if exists business_setup_case_doc_status on public.hub_documents;
drop trigger if exists business_setup_case_payment on public.business_setup_payments;

-- Payments go back to fully append-only.
drop trigger if exists business_setup_payments_immutable on public.business_setup_payments;
create trigger business_setup_payments_immutable before update or delete on public.business_setup_payments
  for each row execute function public.business_setup_append_only();

drop function if exists public.business_setup_case_form_trg();
drop function if exists public.business_setup_case_sync_trg();
drop function if exists public.business_setup_payment_guard();
drop function if exists public.business_setup_case_sync(uuid);
drop function if exists public.business_setup_case_docs(uuid);
drop function if exists public.business_setup_case_set_stage(uuid, text, text);

alter table public.hub_documents drop column if exists case_id cascade;
alter table public.business_setup_payments drop column if exists case_id cascade;
alter table public.business_setup_onboarding_forms drop column if exists case_id cascade;
drop table if exists public.business_setup_cases cascade;
drop sequence if exists public.business_setup_case_seq;

delete from public.business_setup_role_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');
delete from public.business_setup_user_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');

-- The permission list, as Business Setup Base 001 defines it.
create or replace function public.business_setup_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage',
    'setup.payments.manage', 'setup.payments.override', 'setup.services.manage', 'setup.services.override',
    'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'setup.settings.manage',
    'kyc.view', 'kyc.manage']
$$;
-- hub_document_create, as Business Setup Base 004 defines it (no later file replaces it before 013).
\ir ../migrations/004_hub_extension.sql

commit;
