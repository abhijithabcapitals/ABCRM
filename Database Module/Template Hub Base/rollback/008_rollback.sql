-- Undoes migrations/008_accounting_proposals.sql.
-- Quotes and letters made the old way (hub_document_create) are not touched. Accounting quotes and agreements made with the new functions stay as
-- documents, but lose their approval, Word, OneDrive and mail records with the columns. So this refuses while any exist, unless
--   set acct_proposal.rollback_force = 'yes'
-- Some of these columns (word_path, onedrive_*, mail_sent_*) may also be added by other proposal work: do not force this if that is live.
do $$
begin
  if coalesce(current_setting('acct_proposal.rollback_force', true), '') <> 'yes'
     and exists (select 1 from public.hub_documents where library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement')) then
    raise exception 'Accounting quotes or agreements made with migration 008 exist. Set acct_proposal.rollback_force to yes to remove the columns anyway';
  end if;
end $$;

do $do$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists hub_docs_accounting_signature_read on storage.objects;
    drop policy if exists hub_docs_accounting_signature_insert on storage.objects;
    drop policy if exists hub_docs_accounting_signature_update on storage.objects;
    drop policy if exists hub_docs_accounting_signature_delete on storage.objects;
  end if;
end $do$;

drop trigger if exists hub_acct_letter_guard on public.hub_documents;
drop function if exists public.hub_acct_letter_guard();
drop function if exists public.hub_acct_admin_save(jsonb);
drop function if exists public.hub_acct_defaults_save(jsonb);
drop function if exists public.hub_acct_package_save(jsonb);
drop function if exists public.hub_acct_can_send(uuid);
drop function if exists public.hub_acct_signed(uuid, date, text);
drop function if exists public.hub_acct_saved(uuid, text);
drop function if exists public.hub_acct_attach(uuid, text, text);
drop function if exists public.hub_acct_approve(uuid, text, text, timestamptz);
drop function if exists public.hub_acct_agreement_update(uuid, jsonb);
drop function if exists public.hub_acct_agreement_create(jsonb);
drop function if exists public.hub_acct_accept(uuid, int);
drop function if exists public.hub_acct_quote_create(jsonb);
drop function if exists public.hub_acct_can_approve();
drop function if exists public.hub_acct_approvers();
drop function if exists public.hub_acct_agreement_clean(jsonb, int);
drop function if exists public.hub_acct_mirror(jsonb, int);
drop function if exists public.hub_acct_quote_clean(jsonb);
drop function if exists public.hub_acct_texts(jsonb, text);
drop function if exists public.hub_acct_num(jsonb, text);

drop table if exists public.hub_accounting_packages;
delete from public.hub_settings where key = 'accounting_proposal_defaults';

alter table public.hub_documents drop column if exists agreement_changed_at;
alter table public.hub_documents drop column if exists approved_at;
alter table public.hub_documents drop column if exists approved_by;
alter table public.hub_documents drop column if exists mail_claimed_at;
alter table public.hub_documents drop column if exists mail_sent_to;
alter table public.hub_documents drop column if exists mail_sent_by;
alter table public.hub_documents drop column if exists mail_sent_at;
alter table public.hub_documents drop column if exists onedrive_saved_at;
alter table public.hub_documents drop column if exists onedrive_path;
alter table public.hub_documents drop column if exists word_path;
