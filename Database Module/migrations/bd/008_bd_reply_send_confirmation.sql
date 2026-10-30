-- One-time human confirmation challenges for lead-platform reply sends.
-- Codes are hashed by bd-lead-sources and are never readable by CRM users.

create table if not exists public.bd_reply_send_confirmations (
  draft_id uuid primary key references email_base.bd_reply_drafts(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body_hash text not null,
  recipient_email text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now()
);

alter table public.bd_reply_send_confirmations enable row level security;
revoke all on public.bd_reply_send_confirmations from anon, authenticated, public;
grant all on public.bd_reply_send_confirmations to service_role;

create or replace function public.bd_increment_reply_send_attempt(p_draft_id uuid, p_user_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.bd_reply_send_confirmations
  set attempts = attempts + 1
  where draft_id = p_draft_id
    and user_id = p_user_id
    and expires_at > now()
    and attempts < 5
  returning attempts;
$$;

revoke all on function public.bd_increment_reply_send_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bd_increment_reply_send_attempt(uuid, uuid) to service_role;
