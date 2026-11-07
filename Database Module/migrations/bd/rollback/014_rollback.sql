-- Undoes 014_bd_template_quotes.sql. bd_record_quote_sent goes back to requiring the engagement letter reference: re-run its
-- definition from 012_bd_lead_workflow.sql after this. Quotes and letters already numbered stay in hub_documents.
begin;
drop trigger if exists bd_hub_letter_guard on public.hub_documents;
drop function if exists public.bd_hub_letter_guard();
drop function if exists public.bd_portal_quotes(uuid);
drop function if exists public.bd_portal_decide(uuid, uuid, text, text);
drop function if exists public.bd_portal_file(uuid, uuid);
drop function if exists public.bd_quote_accept_signed(uuid, jsonb);
drop function if exists public.bd_quote_issue(uuid, jsonb);
drop function if exists public.bd_issue_login_ok(uuid);
drop function if exists public.bd_lead_portal_client(uuid);
drop policy if exists bd_signed_insert on storage.objects;
drop policy if exists bd_signed_read on storage.objects;
drop table if exists public.bd_quote_acceptances;
alter table public.bd_leads drop column if exists portal_client_id;
drop index if exists public.hub_documents_bd_lead_idx;
alter table public.hub_documents drop column if exists bd_lead_id;
commit;
