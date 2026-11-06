-- Retention on top of the SharePoint archive (migration 009). Requires 009.
--
-- Rules, per mailbox:
-- * Every conversation keeps one row in email_base.messages: its newest email, like a notification.
--   Older emails of the conversation are moved to email_base.archived_messages (headers only, with
--   SharePoint links) and their rows are deleted, but only after all of their files are verified
--   in SharePoint.
-- * Files stay in Supabase Storage only for the newest email of the `keep_conversations` (50) most
--   recent conversations. Every other file is deleted from Storage after its verified copy.
-- * Both steps run only while archive_settings.delete_after_verify is true (off by default).
--
-- Rollback: drop function email_base.archive_prune(integer), email_base.archive_kept_paths();
--   restore the 009 versions of archive_enqueue and archive_delete_candidates;
--   alter table email_base.archive_settings drop column keep_conversations;
--   archived_messages can stay: it only holds copies of headers.

begin;

alter table email_base.archive_settings
  add column if not exists keep_conversations integer not null default 50 check (keep_conversations between 0 and 10000);

-- Header copy of each email whose row left email_base.messages. The files are in SharePoint.
create table if not exists email_base.archived_messages (
  id uuid primary key,                       -- the original email_base.messages.id
  mailbox_id uuid not null,
  thread_id uuid references email_base.threads(id) on delete set null,
  folder text,
  uidvalidity bigint,
  uid bigint,
  message_id text,
  direction text,
  from_address text,
  from_name text,
  to_addresses text[],
  cc_addresses text[],
  subject text,
  sent_at timestamptz,
  attachment_count integer,
  raw_path text,
  eml_drive_item_id text,
  eml_web_url text,
  -- [{ "filename", "content_type", "size_bytes", "storage_path", "drive_item_id", "web_url" }]
  attachments jsonb not null default '[]'::jsonb,
  archived_at timestamptz not null default now()
);
create unique index if not exists archived_messages_uid_idx
  on email_base.archived_messages (mailbox_id, folder, uidvalidity, uid);
create index if not exists archived_messages_thread_idx on email_base.archived_messages (thread_id, sent_at);
create index if not exists archived_messages_from_idx on email_base.archived_messages (lower(from_address), sent_at desc);
create index if not exists archived_messages_to_idx on email_base.archived_messages using gin (to_addresses);

alter table email_base.archived_messages enable row level security;
revoke all on email_base.archived_messages from public, anon, authenticated;
grant select on email_base.archived_messages to authenticated;
grant all on email_base.archived_messages to service_role;
drop policy if exists archived_messages_select_own on email_base.archived_messages;
create policy archived_messages_select_own on email_base.archived_messages for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));

-- Storage paths that stay in Supabase: the .eml and attachments of the newest email of each of the
-- keep_conversations most recent conversations per mailbox.
create or replace function email_base.archive_kept_paths()
returns table (storage_path text) language sql stable security definer set search_path = '' as $$
  with s as (select keep_conversations as n from email_base.archive_settings where id),
  recent as (
    select t.id
      from (select t.id, row_number() over (partition by t.mailbox_id
                     order by t.last_message_at desc nulls last, t.id) as rn
              from email_base.threads t) t
     where t.rn <= (select n from s)
  ),
  newest as (
    select distinct on (m.thread_id) m.id, m.raw_path
      from email_base.messages m
     where m.thread_id in (select id from recent)
     order by m.thread_id, coalesce(m.sent_at, m.internal_date, m.created_at) desc, m.id desc
  )
  select raw_path from newest where raw_path is not null
  union
  select a.storage_path from email_base.attachments a where a.message_id in (select id from newest);
$$;

-- 009 version plus: a verified file whose Storage object changed (re-uploaded by the sync) and a
-- deleted file that reappeared in Storage are copied again.
create or replace function email_base.archive_enqueue()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_age integer;
  v_added integer;
  v_reset integer;
begin
  select min_age_hours into v_age from email_base.archive_settings where id;

  update email_base.archive_items a
     set status = 'pending', attempts = 0, last_error = null, claimed_until = null,
         size_bytes = coalesce((o.metadata->>'size')::bigint, 0), storage_etag = o.metadata->>'eTag',
         storage_created_at = o.created_at, updated_at = now()
    from storage.objects o
   where o.bucket_id = 'email-base' and o.name = a.storage_path
     and o.created_at < now() - make_interval(hours => coalesce(v_age, 1))
     and (a.status = 'deleted'
          or (a.status = 'verified' and coalesce(o.metadata->>'eTag', '') <> coalesce(a.storage_etag, '')));
  get diagnostics v_reset = row_count;

  insert into email_base.archive_items (storage_path, mailbox_id, size_bytes, storage_etag, storage_created_at)
  select o.name,
         case when split_part(o.name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(o.name, '/', 1)::uuid end,
         coalesce((o.metadata->>'size')::bigint, 0),
         o.metadata->>'eTag',
         o.created_at
  from storage.objects o
  where o.bucket_id = 'email-base'
    and o.created_at < now() - make_interval(hours => coalesce(v_age, 1))
    and not exists (select 1 from email_base.archive_items a where a.storage_path = o.name)
  on conflict (storage_path) do nothing;
  get diagnostics v_added = row_count;
  return v_added + v_reset;
end $$;

-- 009 version plus: never the files kept for the most recent conversations.
create or replace function email_base.archive_delete_candidates(p_limit integer)
returns table (storage_path text) language sql security definer set search_path = '' as $$
  select a.storage_path
    from email_base.archive_items a
    join storage.objects o on o.bucket_id = 'email-base' and o.name = a.storage_path
   where a.status = 'verified'
     and a.drive_item_id is not null
     and a.remote_size = a.size_bytes
     and coalesce((o.metadata->>'size')::bigint, -1) = a.size_bytes
     and coalesce(o.metadata->>'eTag', '') = coalesce(a.storage_etag, '')
     and not exists (select 1 from email_base.archive_kept_paths() k where k.storage_path = a.storage_path)
   order by a.verified_at
   limit greatest(p_limit, 0);
$$;

-- Moves up to p_limit older emails of each conversation (not its newest) to archived_messages and
-- deletes their rows. An email is moved only when its .eml and every attachment are verified (or
-- already deleted after verification) in archive_items, and no Email Agent insight points at it.
-- Returns the number moved.
create or replace function email_base.archive_prune(p_limit integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  with newest as (
    select distinct on (m.thread_id) m.id
      from email_base.messages m
     order by m.thread_id, coalesce(m.sent_at, m.internal_date, m.created_at) desc, m.id desc
  ),
  ready as (
    select m.*
      from email_base.messages m
      left join email_base.archive_items e on e.storage_path = m.raw_path
     where m.thread_id is not null
       and m.id not in (select id from newest)
       and (m.raw_path is null or (e.status in ('verified', 'deleted') and e.drive_item_id is not null))
       and not exists (
         select 1 from email_base.attachments a
           left join email_base.archive_items f on f.storage_path = a.storage_path
          where a.message_id = m.id
            and (f.storage_path is null or f.status not in ('verified', 'deleted') or f.drive_item_id is null))
       and not exists (select 1 from email_agent.insights i where i.message_id = m.id)
     order by coalesce(m.sent_at, m.internal_date, m.created_at)
     limit greatest(p_limit, 0)
  ),
  copied as (
    insert into email_base.archived_messages (
      id, mailbox_id, thread_id, folder, uidvalidity, uid, message_id, direction, from_address, from_name,
      to_addresses, cc_addresses, subject, sent_at, attachment_count, raw_path, eml_drive_item_id, eml_web_url, attachments)
    select r.id, r.mailbox_id, r.thread_id, r.folder, r.uidvalidity, r.uid, r.message_id, r.direction, r.from_address,
           r.from_name, r.to_addresses, r.cc_addresses, r.subject, coalesce(r.sent_at, r.internal_date), r.attachment_count,
           r.raw_path, e.drive_item_id, e.web_url,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'filename', a.filename, 'content_type', a.content_type, 'size_bytes', a.size_bytes,
                       'storage_path', a.storage_path, 'drive_item_id', f.drive_item_id, 'web_url', f.web_url)
                     order by a.position)
                       from email_base.attachments a
                       left join email_base.archive_items f on f.storage_path = a.storage_path
                      where a.message_id = r.id), '[]'::jsonb)
      from ready r
      left join email_base.archive_items e on e.storage_path = r.raw_path
    on conflict do nothing
    returning id
  )
  delete from email_base.messages m using copied c where m.id = c.id;
  get diagnostics v = row_count;
  return v;
end $$;

revoke all on function email_base.archive_kept_paths(), email_base.archive_prune(integer) from public, anon, authenticated;
grant execute on function email_base.archive_kept_paths(), email_base.archive_prune(integer) to service_role;

commit;
