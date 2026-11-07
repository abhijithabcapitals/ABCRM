-- Archives every file in the `email-base` Storage bucket to a SharePoint document library
-- through Microsoft Graph, and frees Supabase Storage only after each copy is verified.
--
-- * email_base.archive_settings  one row. The job does nothing until `enabled` is true, and it
--                                deletes nothing until `delete_after_verify` is true.
-- * email_base.archive_items     one row per Storage object: its SharePoint driveItem id, web URL,
--                                size and quickXorHash once verified, and when it left Storage.
-- * email_base.archive_report    counts and bytes per mailbox and status (the copy report).
-- * cron job email-base-archive  calls the `email-archive` Edge Function every 3 minutes.
--
-- Removes nothing by itself. Rollback (before any deletion has run):
--   select cron.unschedule('email-base-archive');
--   drop view if exists email_base.archive_report;
--   drop function if exists email_base.archive_enqueue(), email_base.archive_claim(int),
--     email_base.archive_delete_candidates(int), email_base.archive_mark_deleted(text[]);
--   drop table if exists email_base.archive_items, email_base.archive_settings;
-- Files already copied stay in SharePoint; delete them there by hand if wanted.

begin;

create table if not exists email_base.archive_settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  -- SharePoint site, e.g. 'abcapital.sharepoint.com:/sites/MailArchive'. The job resolves
  -- site_id and drive_id from it on first run and stores them here.
  site_ref text,
  site_id text,
  drive_id text,
  root_folder text not null default 'Email Archive',
  batch_size integer not null default 30 check (batch_size between 1 and 500),
  concurrency integer not null default 3 check (concurrency between 1 and 16),
  -- Only objects older than this are copied, so a file still being written is never taken.
  min_age_hours integer not null default 1 check (min_age_hours >= 0),
  -- 'hash': compare a locally computed quickXorHash with SharePoint's. 'size': compare size only.
  verify_mode text not null default 'hash' check (verify_mode in ('hash', 'size')),
  max_attempts integer not null default 8 check (max_attempts between 1 and 50),
  -- Off until a person has read the copy report and approved the first deletion.
  delete_after_verify boolean not null default false,
  delete_batch_size integer not null default 200 check (delete_batch_size between 1 and 1000),
  last_run_at timestamptz,
  last_run_result jsonb,
  updated_at timestamptz not null default now()
);
insert into email_base.archive_settings (id) values (true) on conflict (id) do nothing;

create table if not exists email_base.archive_items (
  storage_path text primary key,
  mailbox_id uuid,
  size_bytes bigint not null,
  storage_etag text,
  storage_created_at timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'failed', 'verified', 'deleted')),
  attempts integer not null default 0,
  last_error text,
  claimed_until timestamptz,
  sharepoint_path text,
  drive_item_id text,
  web_url text,
  remote_size bigint,
  quickxor_hash text,
  verified_by text check (verified_by in ('hash', 'size')),
  verified_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists archive_items_work_idx
  on email_base.archive_items (storage_created_at) where status in ('pending', 'failed');
create index if not exists archive_items_verified_idx
  on email_base.archive_items (verified_at) where status = 'verified';
create index if not exists archive_items_mailbox_idx on email_base.archive_items (mailbox_id, status);

alter table email_base.archive_settings enable row level security;
alter table email_base.archive_items enable row level security;
revoke all on email_base.archive_settings, email_base.archive_items from public, anon, authenticated;
grant all on email_base.archive_settings, email_base.archive_items to service_role;
-- Mailbox owners may see where their own archived files are.
grant select on email_base.archive_items to authenticated;
drop policy if exists archive_items_select_own on email_base.archive_items;
create policy archive_items_select_own on email_base.archive_items for select to authenticated
  using (email_base.owns_mailbox(mailbox_id));

-- Adds a row for every bucket object old enough and not yet listed. Returns the number added.
create or replace function email_base.archive_enqueue()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_age integer;
  v_added integer;
begin
  select min_age_hours into v_age from email_base.archive_settings where id;
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
  return v_added;
end $$;

-- Hands out up to p_limit items to copy and holds them for 10 minutes, so two runs never take
-- the same file. Oldest first.
create or replace function email_base.archive_claim(p_limit integer)
returns setof email_base.archive_items language sql security definer set search_path = '' as $$
  update email_base.archive_items a
     set claimed_until = now() + interval '10 minutes', attempts = a.attempts + 1, updated_at = now()
   where a.storage_path in (
     select i.storage_path from email_base.archive_items i
      where i.status in ('pending', 'failed')
        and i.attempts < (select max_attempts from email_base.archive_settings where id)
        and (i.claimed_until is null or i.claimed_until < now())
      order by i.storage_created_at nulls last, i.storage_path
      limit greatest(p_limit, 0)
      for update skip locked)
  returning a.*;
$$;

-- Verified items that may leave Storage: the Storage object must still exist with the same size
-- that was copied, so a file replaced after its copy is never deleted.
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
   order by a.verified_at
   limit greatest(p_limit, 0);
$$;

-- Marks items deleted once Storage no longer has them. Paths still present are left verified.
create or replace function email_base.archive_mark_deleted(p_paths text[])
returns integer language plpgsql security definer set search_path = '' as $$
declare v integer;
begin
  update email_base.archive_items a
     set status = 'deleted', deleted_at = now(), updated_at = now()
   where a.storage_path = any(p_paths)
     and a.status = 'verified'
     and not exists (select 1 from storage.objects o where o.bucket_id = 'email-base' and o.name = a.storage_path);
  get diagnostics v = row_count;
  return v;
end $$;

revoke all on function email_base.archive_enqueue(), email_base.archive_claim(integer),
  email_base.archive_delete_candidates(integer), email_base.archive_mark_deleted(text[])
  from public, anon, authenticated;
grant execute on function email_base.archive_enqueue(), email_base.archive_claim(integer),
  email_base.archive_delete_candidates(integer), email_base.archive_mark_deleted(text[])
  to service_role;

-- The copy report. 'not_listed' counts bucket objects with no archive row yet (new or too young).
create or replace view email_base.archive_report with (security_invoker = true) as
  select coalesce(m.address, a.mailbox_id::text, '(unknown)') as mailbox,
         a.status,
         count(*) as files,
         round(sum(a.size_bytes) / 1e6, 1) as mb,
         count(*) filter (where a.verified_by = 'hash') as hash_checked,
         max(a.verified_at) as last_verified_at,
         max(a.deleted_at) as last_deleted_at
    from email_base.archive_items a
    left join email_base.mailboxes m on m.id = a.mailbox_id
   group by 1, 2
  union all
  select '(bucket)', 'not_listed', count(*), round(sum((o.metadata->>'size')::bigint) / 1e6, 1), 0, null, null
    from storage.objects o
   where o.bucket_id = 'email-base'
     and not exists (select 1 from email_base.archive_items a where a.storage_path = o.name);
revoke all on email_base.archive_report from public, anon, authenticated;
grant select on email_base.archive_report to service_role;

-- Every 3 minutes. The function returns at once while archive_settings.enabled is false.
-- Needs the vault secret `email_base_archive_secret`, also set as the Edge Function secret
-- ARCHIVE_SECRET.
select cron.unschedule('email-base-archive') where exists (select 1 from cron.job where jobname = 'email-base-archive');
select cron.schedule(
  'email-base-archive',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/email-archive',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-archive-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_base_archive_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

commit;
