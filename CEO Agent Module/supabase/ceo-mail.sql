-- Applied to the CRM Supabase project (pnnakrhfzyxudjaghoxx) on 29/10/2026 as
-- migrations "ceo_mail_summaries" and "ceo_mail_sync_schedule". Kept here as the
-- source of record for the ceo-mail-sync Edge Function.
--
-- Read-only mailbox summaries for the CEO Agent. Email bodies are never stored:
-- messages keep headers only, threads keep the AI summary and labels.

create table ceo.mail_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  address text not null,
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
  updated_at timestamptz not null default now(),
  unique (user_id, address),
  unique (user_id, id)
);

create table ceo.mail_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
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
  summary text,
  key_points jsonb not null default '[]'::jsonb,
  suggested_actions jsonb not null default '[]'::jsonb,
  summarized_at timestamptz,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(summary, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, thread_key),
  unique (user_id, id),
  foreign key (user_id, account_id) references ceo.mail_accounts(user_id, id) on delete cascade,
  check (summary is null or char_length(summary) <= 4000)
);
create index mail_threads_inbox_idx on ceo.mail_threads(user_id, status, last_message_at desc);
create index mail_threads_search_idx on ceo.mail_threads using gin(search_vector);

create table ceo.mail_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  thread_id uuid not null,
  uidvalidity bigint not null,
  uid bigint not null,
  message_id text,
  from_address text,
  from_name text,
  to_addresses text[] not null default '{}',
  subject text,
  sent_at timestamptz,
  excluded boolean not null default false,
  created_at timestamptz not null default now(),
  unique (account_id, uidvalidity, uid),
  foreign key (user_id, account_id) references ceo.mail_accounts(user_id, id) on delete cascade,
  foreign key (user_id, thread_id) references ceo.mail_threads(user_id, id) on delete cascade
);
create index mail_messages_message_id_idx on ceo.mail_messages(account_id, message_id);
create index mail_messages_thread_idx on ceo.mail_messages(thread_id, sent_at);

alter table ceo.mail_accounts enable row level security;
alter table ceo.mail_threads enable row level security;
alter table ceo.mail_messages enable row level security;

-- The browser may read its own rows and change a thread's status only.
-- All other writes come from the ceo-mail-sync worker (service role).
revoke all on ceo.mail_accounts, ceo.mail_threads, ceo.mail_messages from anon, authenticated;
grant select on ceo.mail_accounts, ceo.mail_threads, ceo.mail_messages to authenticated;
grant update (status) on ceo.mail_threads to authenticated;
grant all on ceo.mail_accounts, ceo.mail_threads, ceo.mail_messages to service_role;

create policy mail_accounts_select_own on ceo.mail_accounts for select to authenticated using (user_id = (select auth.uid()));
create policy mail_threads_select_own on ceo.mail_threads for select to authenticated using (user_id = (select auth.uid()));
create policy mail_threads_update_own on ceo.mail_threads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy mail_messages_select_own on ceo.mail_messages for select to authenticated using (user_id = (select auth.uid()));

-- Shared secret that lets the scheduler call ceo-mail-sync. Kept in Vault;
-- only the service role can check it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'ceo_mail_sync_secret', 'Header secret for the ceo-mail-sync cron call');

create function ceo.check_mail_sync_secret(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'ceo_mail_sync_secret' and decrypted_secret = candidate
  );
$$;
revoke all on function ceo.check_mail_sync_secret(text) from public, anon, authenticated;
grant execute on function ceo.check_mail_sync_secret(text) to service_role;

-- The mailbox the CEO asked to summarize, linked to the CEO owner profile.
insert into ceo.mail_accounts (user_id, address, imap_host)
select p.user_id, 'bharat@ardentaxit.tax', 'imap.hostinger.com'
from ceo.profiles p where p.role = 'owner'
order by p.created_at limit 1;

-- Run ceo-mail-sync every 15 minutes. The header secret is read from Vault at
-- call time, so it never appears in the job definition.
select cron.schedule(
  'ceo-mail-sync',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ceo-mail-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'ceo_mail_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);
