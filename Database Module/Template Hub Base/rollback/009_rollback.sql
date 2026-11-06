-- Undoes migrations/009_proposals.sql. Proposal quotes and their letters stay as ordinary documents; authority sets and the proposal
-- defaults are lost. The Word, OneDrive and mail columns belong to 008 (Accounting proposals, live) and are kept: undo 008 for those.
drop trigger if exists hub_proposal_accept_guard on public.hub_documents;
drop function if exists public.hub_proposal_accept_guard();
drop trigger if exists hub_proposal_letter_guard on public.hub_documents;
drop function if exists public.hub_proposal_letter_guard();
drop function if exists public.hub_proposal_can_send();
drop function if exists public.hub_proposal_defaults_save(jsonb);
drop function if exists public.hub_proposal_authority_save(jsonb);
drop function if exists public.hub_proposal_letter_create(jsonb);
drop function if exists public.hub_proposal_choose(jsonb);
drop function if exists public.hub_proposal_ref(text);
drop function if exists public.hub_proposal_saved(uuid, text);
drop function if exists public.hub_proposal_attach(uuid, text, text);
drop function if exists public.hub_proposal_create(jsonb);
drop function if exists public.hub_proposal_total(jsonb);
drop function if exists public.hub_proposal_lines(jsonb);
drop function if exists public.hub_proposal_clean(jsonb);
drop function if exists public.hub_proposal_texts(jsonb, text);
drop table if exists public.hub_proposal_authorities;
delete from public.hub_settings where key = 'proposal_defaults';
