-- Apply after 005_full_capture.sql and Main Module/db/email_signatures.sql.
--
-- Replies to Email Base conversations, written in the CEO Inbox and sent through
-- the mailbox's own SMTP server by the ceo-mail-reply Edge Function. Same model as
-- the Business Development reply mailer: drafts are saved by the mailbox owner,
-- sending needs a one-time confirmation code, and only the server (service role)
-- can mark a draft sending, sent or failed.
begin;

alter table email_base.mailboxes
  add column if not exists display_name text,
  add column if not exists smtp_host text,
  add column if not exists smtp_port integer not null default 465;
update email_base.mailboxes set smtp_host = 'smtp.hostinger.com'
where smtp_host is null and imap_host = 'imap.hostinger.com';

create table if not exists email_base.reply_drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_base.threads(id) on delete cascade,
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  to_addresses text[] not null default '{}' check (cardinality(to_addresses) <= 20),
  cc_addresses text[] not null default '{}' check (cardinality(cc_addresses) <= 20),
  subject text not null default '' check (char_length(subject) <= 1000),
  body_text text not null default '' check (char_length(body_text) <= 10000),
  signature_id uuid references public.email_signatures(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sending', 'sent', 'failed', 'discarded')),
  drafted_by text not null default 'person' check (drafted_by in ('person', 'ceo_agent')),
  error text,
  sent_message_id text,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  updated_by uuid references auth.users(id) on delete set null,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists reply_drafts_thread_idx on email_base.reply_drafts (thread_id, created_at desc);

-- The thread and mailbox of a draft are fixed, must match, and a sent reply cannot change.
create or replace function email_base.reply_drafts_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from email_base.threads t where t.id = new.thread_id and t.mailbox_id = new.mailbox_id) then
      raise exception 'The conversation does not belong to this mailbox.';
    end if;
  else
    if old.status = 'sent' then raise exception 'A sent reply cannot be changed.'; end if;
    new.thread_id := old.thread_id;
    new.mailbox_id := old.mailbox_id;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end $$;
drop trigger if exists reply_drafts_guard on email_base.reply_drafts;
create trigger reply_drafts_guard before insert or update on email_base.reply_drafts
  for each row execute function email_base.reply_drafts_guard();

alter table email_base.reply_drafts enable row level security;
revoke all on email_base.reply_drafts from anon, public, authenticated;
grant select, insert on email_base.reply_drafts to authenticated;
grant update (to_addresses, cc_addresses, subject, body_text, signature_id, status, drafted_by) on email_base.reply_drafts to authenticated;
grant all on email_base.reply_drafts to service_role;

drop policy if exists reply_drafts_select_own on email_base.reply_drafts;
create policy reply_drafts_select_own on email_base.reply_drafts for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));
drop policy if exists reply_drafts_insert_own on email_base.reply_drafts;
create policy reply_drafts_insert_own on email_base.reply_drafts for insert to authenticated
  with check (email_base.owns_mailbox(mailbox_id) and status = 'draft' and created_by = auth.uid());
drop policy if exists reply_drafts_update_own on email_base.reply_drafts;
create policy reply_drafts_update_own on email_base.reply_drafts for update to authenticated
  using (email_base.owns_mailbox(mailbox_id) and status in ('draft', 'failed'))
  with check (email_base.owns_mailbox(mailbox_id) and status in ('draft', 'discarded'));

-- One-time send confirmations. Codes are hashed by ceo-mail-reply and never readable by users.
create table if not exists email_base.reply_send_confirmations (
  draft_id uuid primary key references email_base.reply_drafts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content_hash text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at timestamptz not null default now()
);
alter table email_base.reply_send_confirmations enable row level security;
revoke all on email_base.reply_send_confirmations from anon, authenticated, public;
grant all on email_base.reply_send_confirmations to service_role;

create or replace function email_base.increment_reply_send_attempt(p_draft_id uuid, p_user_id uuid)
returns integer language sql security definer set search_path = '' as $$
  update email_base.reply_send_confirmations
  set attempts = attempts + 1
  where draft_id = p_draft_id and user_id = p_user_id and expires_at > now() and attempts < 5
  returning attempts;
$$;
revoke all on function email_base.increment_reply_send_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function email_base.increment_reply_send_attempt(uuid, uuid) to service_role;

notify pgrst, 'reload schema';

commit;
