-- Performance: replace the sidebar's ~60 per-scope COUNT round-trips with a
-- single RPC, and add the indexes those counts (and task fetches) rely on.
--
-- SECURITY INVOKER (default) so RLS still applies — members' counts reflect only
-- the tasks they can see, exactly like the per-query version did.
--
-- Run in the Supabase SQL editor (idempotent).

-- One call returns list / folder-direct / space-direct task counts.
create or replace function task_counts()
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'lists', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', list_id, 'folder_id', folder_id, 'space_id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select list_id, folder_id, space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is not null
        group by list_id, folder_id, space_id
      ) x),
    'folders', (
      select coalesce(jsonb_agg(jsonb_build_object('id', folder_id, 'space_id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select folder_id, space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is null and folder_id is not null
        group by folder_id, space_id
      ) y),
    'spaces', (
      select coalesce(jsonb_agg(jsonb_build_object('id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is null and folder_id is null and space_id is not null
        group by space_id
      ) z)
  );
$$;
grant execute on function task_counts() to anon, authenticated;

-- Indexes for the scope filters used by counts and task fetches.
create index if not exists idx_tasks_active_list   on tasks(list_id)   where deleted_at is null;
create index if not exists idx_tasks_active_folder on tasks(folder_id) where deleted_at is null;
create index if not exists idx_tasks_active_space  on tasks(space_id)  where deleted_at is null;
