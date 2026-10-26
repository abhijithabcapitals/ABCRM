-- Per-assignee task list + reassignment, for the Dashboard "Workload by
-- assignee" drill-in (e.g. moving a departing employee's tasks to someone else).
--
-- Both are SECURITY DEFINER so they work regardless of the caller's RLS scope:
-- listing shows ALL of a person's tasks, and reassigning can touch tasks the
-- caller isn't assigned to (RLS would otherwise block updating someone else's
-- tasks). This intentionally grants the action to every signed-in user for now;
-- to restrict to admins later, add a role check at the top of reassign_assignee.
--
-- Run in the Supabase SQL editor (idempotent).

-- Every non-deleted task assigned to p_name, with its location. Optionally
-- scoped to a single space, and/or a single folder (for the per-space and
-- per-folder Overview drill-in).
-- Drop the older (text, uuid) signature so adding p_folder doesn't leave an
-- ambiguous overload.
drop function if exists assignee_tasks(text, uuid);

create or replace function assignee_tasks(p_name text, p_space uuid default null, p_folder uuid default null)
returns table(id uuid, title text, status text, priority text, due_date date,
              space_id uuid, folder_id uuid, list_id uuid,
              space_name text, list_name text)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.status, t.priority, t.due_date,
         t.space_id, t.folder_id, t.list_id, s.name, l.name
  from tasks t
  left join spaces s on s.id = t.space_id
  left join lists  l on l.id = t.list_id
  where t.deleted_at is null
    and p_name = any(t.assignees)
    and (p_space is null or t.space_id = p_space)
    and (p_folder is null or t.folder_id = p_folder)
  order by (t.due_date is null), t.due_date;
$$;
grant execute on function assignee_tasks(text, uuid, uuid) to anon, authenticated;

-- Replace p_from with p_to on the given tasks (or ALL of p_from's tasks when
-- p_task_ids is null). An empty p_to just unassigns p_from. Returns the count
-- changed. The task_history trigger logs each assignee change (attributed to
-- p_actor via updated_by).
create or replace function reassign_assignee(
  p_from text,
  p_to text,
  p_task_ids uuid[] default null,
  p_actor text default 'System'
) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; new_as text[];
begin
  if coalesce(p_from, '') = '' then return 0; end if;
  for r in
    select id, assignees from tasks
    where deleted_at is null
      and p_from = any(assignees)
      and (p_task_ids is null or id = any(p_task_ids))
  loop
    if coalesce(p_to, '') = '' then
      new_as := array_remove(r.assignees, p_from);
    else
      -- replace then de-duplicate (so we don't double-add an existing member)
      select array_agg(distinct x) into new_as
      from unnest(array_replace(r.assignees, p_from, p_to)) x;
    end if;
    update tasks
      set assignees  = new_as,
          assignee   = coalesce(new_as[1], ''),
          updated_by = p_actor,
          updated_at = now()
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function reassign_assignee(text, text, uuid[], text) to anon, authenticated;
