-- Apply after 004_business_development_drafts.sql in the CRM Supabase project.
--
-- Makes Email Base a complete copy of every connected mailbox instead of an
-- INBOX-only text index:
--   * every IMAP folder (Sent, Archive, custom folders) is synced, each with its
--     own UID cursor in email_base.mailbox_folders;
--   * each message keeps To/Cc/Bcc/Reply-To, threading ids, all headers, the HTML
--     body, IMAP flags and size, plus the original .eml file in Storage;
--   * attachments are stored in Storage and listed in email_base.attachments;
--   * a message above the import limit is stored with its headers and marked
--     body_complete = false instead of stopping the sync of the whole mailbox.
-- Summaries are now produced from stored rows (threads.needs_summary), so a
-- summarization failure never requires re-reading IMAP.
begin;

create table if not exists email_base.mailbox_folders (
  id uuid primary key default gen_random_uuid(),
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  name text not null,
  role text not null default 'other' check (role in ('inbox', 'sent', 'drafts', 'archive', 'junk', 'trash', 'other')),
  enabled boolean not null default true,
  uidvalidity bigint,
  last_uid bigint not null default 0,
  message_total integer,
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, name)
);

alter table email_base.messages
  add column if not exists folder text not null default 'INBOX',
  add column if not exists direction text not null default 'inbound' check (direction in ('inbound', 'outbound')),
  add column if not exists cc_addresses text[] not null default '{}',
  add column if not exists bcc_addresses text[] not null default '{}',
  add column if not exists reply_to text[] not null default '{}',
  add column if not exists in_reply_to text,
  add column if not exists reference_ids text[] not null default '{}',
  add column if not exists body_html text,
  add column if not exists headers jsonb not null default '[]'::jsonb,
  add column if not exists flags text[] not null default '{}',
  add column if not exists size_bytes integer,
  add column if not exists internal_date timestamptz,
  add column if not exists raw_path text,
  add column if not exists body_complete boolean not null default true,
  add column if not exists parse_error text,
  add column if not exists attachment_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default now();

-- The same UID can exist in several folders, so the folder is part of the key.
alter table email_base.messages drop constraint if exists messages_mailbox_id_uidvalidity_uid_key;
alter table email_base.messages drop constraint if exists messages_mailbox_folder_uid_key;
alter table email_base.messages
  add constraint messages_mailbox_folder_uid_key unique (mailbox_id, folder, uidvalidity, uid);
create index if not exists messages_mailbox_sent_idx on email_base.messages(mailbox_id, sent_at desc);

alter table email_base.threads
  add column if not exists folders text[] not null default '{}',
  add column if not exists needs_summary boolean not null default false;
create index if not exists threads_folders_idx on email_base.threads using gin(folders);
create index if not exists threads_needs_summary_idx on email_base.threads(mailbox_id, last_message_at desc) where needs_summary;

update email_base.threads set folders = '{INBOX}' where folders = '{}';
update email_base.threads set needs_summary = true where summary is null;

create table if not exists email_base.attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references email_base.messages(id) on delete cascade,
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  position integer not null,
  filename text,
  content_type text,
  disposition text,
  content_id text,
  size_bytes integer not null,
  sha256 text not null,
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (message_id, position)
);
create index if not exists attachments_message_idx on email_base.attachments(message_id);
create index if not exists attachments_sha_idx on email_base.attachments(mailbox_id, sha256);

alter table email_base.mailbox_folders enable row level security;
alter table email_base.attachments enable row level security;
revoke all on email_base.mailbox_folders, email_base.attachments from anon, authenticated;
grant select on email_base.mailbox_folders, email_base.attachments to authenticated;
grant all on email_base.mailbox_folders, email_base.attachments to service_role;

drop policy if exists mailbox_folders_select_own on email_base.mailbox_folders;
create policy mailbox_folders_select_own on email_base.mailbox_folders for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));
drop policy if exists attachments_select_own on email_base.attachments;
create policy attachments_select_own on email_base.attachments for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));

-- Private bucket for original .eml files and attachments, laid out as
-- <mailbox_id>/<folder>/<uidvalidity>/<uid>/message.eml and .../attachments/<n>-<name>.
insert into storage.buckets (id, name, public)
values ('email-base', 'email-base', false)
on conflict (id) do nothing;

drop policy if exists email_base_objects_select_own on storage.objects;
create policy email_base_objects_select_own on storage.objects for select to authenticated
  using (
    bucket_id = 'email-base'
    and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and email_base.owns_mailbox(((storage.foldername(name))[1])::uuid)
  );

-- Start every mailbox with its INBOX at UID 0 so the history is read again and
-- the existing rows gain recipients, headers, HTML, attachments and the .eml
-- file. Existing summaries are kept; only new messages are summarized.
-- The remaining folders are discovered by ceo-mail-sync on its next run.
insert into email_base.mailbox_folders (mailbox_id, name, role)
select id, mailbox, 'inbox' from email_base.mailboxes
on conflict (mailbox_id, name) do update set uidvalidity = null, last_uid = 0, updated_at = now();

commit;
