-- Undoes migrations/008_proposals.sql. Proposal quotes and their letters stay as ordinary documents; authority sets, the proposal
-- defaults and the Word, OneDrive and mail-sent columns are lost.
drop trigger if exists hub_proposal_letter_guard on public.hub_documents;
drop function if exists public.hub_proposal_letter_guard();
drop function if exists public.hub_proposal_can_send();
drop function if exists public.hub_proposal_defaults_save(jsonb);
drop function if exists public.hub_proposal_authority_save(jsonb);
drop function if exists public.hub_proposal_letter_create(jsonb);
drop function if exists public.hub_proposal_saved(uuid, text);
drop function if exists public.hub_proposal_attach(uuid, text, text);
drop function if exists public.hub_proposal_create(jsonb);
drop function if exists public.hub_proposal_total(jsonb);
drop function if exists public.hub_proposal_lines(jsonb);
drop function if exists public.hub_proposal_clean(jsonb);
drop function if exists public.hub_proposal_texts(jsonb, text);
drop table if exists public.hub_proposal_authorities;
delete from public.hub_settings where key = 'proposal_defaults';
alter table public.hub_documents drop column if exists word_path, drop column if exists onedrive_path, drop column if exists onedrive_saved_at,
  drop column if exists mail_sent_at, drop column if exists mail_sent_by, drop column if exists mail_sent_to, drop column if exists mail_sending_at;
