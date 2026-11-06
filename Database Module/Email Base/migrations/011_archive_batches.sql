-- Batches for the SharePoint archive. Requires 010.
-- * archive_enqueue() adds at most 5,000 new files per call. The first call over the 123,980
--   existing files hit the service role's statement timeout; later runs pick up the rest.
-- * archive_delete_candidates() works out the kept files once per call instead of once per row.
-- Rollback: re-run the function definitions from 010.

begin;

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
  limit 5000
  on conflict (storage_path) do nothing;
  get diagnostics v_added = row_count;
  return v_added + v_reset;
end $$;

create or replace function email_base.archive_delete_candidates(p_limit integer)
returns table (storage_path text) language sql security definer set search_path = '' as $$
  with kept as materialized (select k.storage_path from email_base.archive_kept_paths() k)
  select a.storage_path
    from email_base.archive_items a
    join storage.objects o on o.bucket_id = 'email-base' and o.name = a.storage_path
   where a.status = 'verified'
     and a.drive_item_id is not null
     and a.remote_size = a.size_bytes
     and coalesce((o.metadata->>'size')::bigint, -1) = a.size_bytes
     and coalesce(o.metadata->>'eTag', '') = coalesce(a.storage_etag, '')
     and not exists (select 1 from kept where kept.storage_path = a.storage_path)
   order by a.verified_at
   limit greatest(p_limit, 0);
$$;

revoke all on function email_base.archive_enqueue(), email_base.archive_delete_candidates(integer) from public, anon, authenticated;
grant execute on function email_base.archive_enqueue(), email_base.archive_delete_candidates(integer) to service_role;

commit;
