-- Admin-only usage stats for the Settings ▸ Usage panel.
-- Exposes automation-email counts, Postgres database size, and Storage
-- (file bucket) size via a single SECURITY DEFINER RPC. The function is
-- admin-guarded, so members calling it get an error.
-- Run in the Supabase SQL editor (idempotent).

create or replace function admin_usage_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_db_size    bigint;
  v_store_size bigint;
begin
  -- Admin gate.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Not authorized';
  end if;

  select pg_database_size(current_database()) into v_db_size;

  -- Sum of stored object sizes across all buckets (bytes).
  begin
    select coalesce(sum((metadata->>'size')::bigint), 0)
      into v_store_size
      from storage.objects;
  exception when others then
    v_store_size := null;  -- storage schema not reachable
  end;

  select jsonb_build_object(
    'emails_sent_total',  (select count(*) from automation_email_queue where status = 'sent'),
    'emails_sent_30d',    (select count(*) from automation_email_queue where status = 'sent' and sent_at >= now() - interval '30 days'),
    'emails_pending',     (select count(*) from automation_email_queue where status = 'pending'),
    'emails_failed',      (select count(*) from automation_email_queue where status = 'error'),
    'emails_queued_total',(select count(*) from automation_email_queue),
    'last_email_sent_at', (select max(sent_at) from automation_email_queue where status = 'sent'),
    'db_size_bytes',      v_db_size,
    'storage_size_bytes', v_store_size,
    'generated_at',       now()
  ) into result;

  return result;
end;
$$;

grant execute on function admin_usage_stats() to authenticated;
