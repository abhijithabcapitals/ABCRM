-- Email Base: the organization's email database (Agent Project, tievldgmojlmhksdsibs).
--
-- Every mailbox and every conversation carries tags, so one store serves
-- several consumers: the CEO Agent tab reads mailboxes tagged 'ceo'. Email
-- Email bodies are never stored: messages keep headers only, threads keep the AI
-- summary, labels and tags. Written by the ceo-mail-sync Edge Function
-- (service role); signed-in owners read their mailboxes and change status/tags.
--
-- Expose the schema in Project Settings > Data API > Exposed schemas.

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists email_base;
revoke all on schema email_base from public, anon;
grant usage on schema email_base to authenticated, service_role;

create table email_base.mailboxes (
  id uuid primary key default gen_random_uuid(),
  address text not null unique check (address = lower(address)),
  owner_user_id uuid references auth.users(id) on delete set null,
  tags text[] not null default '{}',
  imap_host text not null,
  imap_port integer not null default 993,
  mailbox text not null default 'INBOX',
  excluded_senders text[] not null default '{}',
  enabled boolean not null default true,
  uidvalidity bigint,
  last_uid bigint not null default 0,
  status text not null default 'idle' check (status in ('idle', 'syncing', 'error')),
  sync_started_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table email_base.threads (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  thread_key text not null,
  subject text,
  participants text[] not null default '{}',
  first_message_at timestamptz,
  last_message_at timestamptz,
  message_count integer not null default 0,
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  category text check (category in ('client', 'internal', 'vendor', 'government', 'bank', 'newsletter', 'personal', 'other')),
  priority text check (priority in ('urgent', 'high', 'normal', 'low')),
  needs_reply boolean not null default false,
  summary text check (summary is null or char_length(summary) <= 4000),
  key_points jsonb not null default '[]'::jsonb,
  suggested_actions jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  summarized_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(summary, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, thread_key)
);
create index threads_inbox_idx on email_base.threads(mailbox_id, status, last_message_at desc);
create index threads_search_idx on email_base.threads using gin(search_vector);
create index threads_tags_idx on email_base.threads using gin(tags);

create table email_base.messages (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  thread_id uuid not null references email_base.threads(id) on delete cascade,
  uidvalidity bigint not null,
  uid bigint not null,
  message_id text,
  from_address text,
  from_name text,
  to_addresses text[] not null default '{}',
  subject text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (mailbox_id, uidvalidity, uid)
);
create index messages_message_id_idx on email_base.messages(mailbox_id, message_id);
create index messages_thread_idx on email_base.messages(thread_id, sent_at);

-- A signed-in user sees only the mailboxes they own.
create function email_base.owns_mailbox(p_mailbox uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from email_base.mailboxes m where m.id = p_mailbox and m.owner_user_id = (select auth.uid()));
$$;
revoke all on function email_base.owns_mailbox(uuid) from public, anon;
grant execute on function email_base.owns_mailbox(uuid) to authenticated;

alter table email_base.mailboxes enable row level security;
alter table email_base.threads enable row level security;
alter table email_base.messages enable row level security;

revoke all on email_base.mailboxes, email_base.threads, email_base.messages from anon, authenticated;
grant select on email_base.mailboxes, email_base.threads, email_base.messages to authenticated;
grant update (status, tags) on email_base.threads to authenticated;
grant all on email_base.mailboxes, email_base.threads, email_base.messages to service_role;

create policy mailboxes_select_own on email_base.mailboxes for select to authenticated
  using (owner_user_id = (select auth.uid()));
create policy threads_select_own on email_base.threads for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));
create policy threads_update_own on email_base.threads for update to authenticated
  using (email_base.owns_mailbox(mailbox_id)) with check (email_base.owns_mailbox(mailbox_id));
create policy messages_select_own on email_base.messages for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));

-- Shared secret for the scheduler's calls to ceo-mail-sync; only the service role can check it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'email_base_sync_secret', 'Header secret for the ceo-mail-sync cron call');

create function email_base.check_sync_secret(candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'email_base_sync_secret' and decrypted_secret = candidate);
$$;
revoke all on function email_base.check_sync_secret(text) from public, anon, authenticated;
grant execute on function email_base.check_sync_secret(text) to service_role;

-- The CEO's mailboxes. owner_user_id is set once the CEO login exists in this project.
insert into email_base.mailboxes (address, tags, imap_host) values
  ('bharat@ardentaxit.tax', '{ceo}', 'imap.hostinger.com'),
  ('info@abcapital.ae', '{ceo,org}', 'imap.hostinger.com')
on conflict (address) do nothing;

select cron.schedule(
  'email-base-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://tievldgmojlmhksdsibs.supabase.co/functions/v1/ceo-mail-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_base_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
