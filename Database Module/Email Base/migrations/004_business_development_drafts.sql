-- Keep Business Development platform replies in the shared CRM Email Base.
-- Explee remains the message provider; this table stores only local drafts and send metadata.

begin;

create table if not exists email_base.bd_reply_drafts (
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
create index if not exists email_base_bd_reply_drafts_prospect_idx
  on email_base.bd_reply_drafts (prospect_id, created_at desc);

insert into email_base.bd_reply_drafts (
  id, prospect_id, provider, body_text, cc_emails, status, drafted_by, agent_note, error,
  provider_message_id, created_by, updated_by, sent_by, created_at, updated_at, sent_at
)
select
  id, prospect_id, provider, body_text, cc_emails, status, drafted_by, agent_note, error,
  provider_message_id, created_by, updated_by, sent_by, created_at, updated_at, sent_at
from public.bd_reply_drafts
on conflict (id) do nothing;

alter table email_base.bd_reply_drafts enable row level security;
revoke all on email_base.bd_reply_drafts from anon, public;
grant select, insert, update on email_base.bd_reply_drafts to authenticated;
grant all on email_base.bd_reply_drafts to service_role;

drop policy if exists bd_reply_drafts_read on email_base.bd_reply_drafts;
create policy bd_reply_drafts_read on email_base.bd_reply_drafts for select to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'));

drop policy if exists bd_reply_drafts_insert on email_base.bd_reply_drafts;
create policy bd_reply_drafts_insert on email_base.bd_reply_drafts for insert to authenticated
  with check (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
    and status = 'draft'
    and created_by = auth.uid()
  );

drop policy if exists bd_reply_drafts_update on email_base.bd_reply_drafts;
create policy bd_reply_drafts_update on email_base.bd_reply_drafts for update to authenticated
  using (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
    and status in ('draft', 'failed')
  )
  with check (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
    and status in ('draft', 'discarded')
  );

create or replace function email_base.bd_reply_drafts_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if old.status = 'sent' then raise exception 'A sent reply cannot be changed.'; end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
drop trigger if exists bd_reply_drafts_touch on email_base.bd_reply_drafts;
create trigger bd_reply_drafts_touch before update on email_base.bd_reply_drafts
  for each row execute function email_base.bd_reply_drafts_touch();

commit;
