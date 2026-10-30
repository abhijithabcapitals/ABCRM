-- Reply drafts for lead-platform conversations (Explee first).
-- Drafts live only in the CRM. They are written by a person or, when someone presses
-- "Draft with Email Agent", by the Email Agent (Agent Module/13_EMail_Agent). A draft is
-- sent only by the bd-lead-sources Edge Function after a two-step confirmation in the
-- mailbox popup; the send is recorded here (sent_by, sent_at, provider message id).

create table if not exists public.bd_reply_drafts (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.bd_platform_prospects(id) on delete cascade,
  provider text not null,
  body_text text not null default '' check (char_length(body_text) <= 10000),
  cc_emails text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed', 'discarded')),
  drafted_by text not null default 'person' check (drafted_by in ('person', 'email_agent')),
  agent_note text,
  error text,
  provider_message_id text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  updated_by uuid references public.profiles(id),
  sent_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists bd_reply_drafts_prospect_idx on public.bd_reply_drafts (prospect_id, created_at desc);

alter table public.bd_reply_drafts enable row level security;

-- Visible to everyone who works the prospect queue. People edit or discard drafts;
-- only the Edge Function (service role, after checking the caller) records sending / sent / failed.
drop policy if exists bd_reply_drafts_read on public.bd_reply_drafts;
create policy bd_reply_drafts_read on public.bd_reply_drafts for select to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'));
drop policy if exists bd_reply_drafts_insert on public.bd_reply_drafts;
create policy bd_reply_drafts_insert on public.bd_reply_drafts for insert to authenticated
  with check (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
              and status = 'draft' and created_by = auth.uid());
drop policy if exists bd_reply_drafts_update on public.bd_reply_drafts;
create policy bd_reply_drafts_update on public.bd_reply_drafts for update to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
         and status in ('draft', 'failed'))
  with check (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
              and status in ('draft', 'discarded'));

create or replace function public.bd_reply_drafts_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'sent' then raise exception 'A sent reply cannot be changed.'; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists bd_reply_drafts_touch on public.bd_reply_drafts;
create trigger bd_reply_drafts_touch before update on public.bd_reply_drafts
  for each row execute function public.bd_reply_drafts_touch();

revoke all on public.bd_reply_drafts from anon, public;
grant select, insert, update on public.bd_reply_drafts to authenticated;
grant all on public.bd_reply_drafts to service_role;
