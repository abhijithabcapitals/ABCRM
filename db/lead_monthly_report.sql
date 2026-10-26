-- Monthly lead report: counts a list's tasks by month (of the created_time
-- custom field) × task status. Powers the "Monthly Lead Report" card on the
-- Marketing Leads space / Advertising folder Overview.
--
-- SECURITY DEFINER so the report counts ALL tasks in the list, not just the
-- caller's RLS-visible rows (matches the other dashboard_* RPCs). Tasks whose
-- created_time is empty/unparseable fall into the 'Undated' bucket so nothing
-- is silently dropped.
--
-- Run in the Supabase SQL editor (idempotent).

-- Indexes that keep the report fast on large lists (idempotent).
create index if not exists idx_tfv_field_id on task_field_values(field_id);
create index if not exists idx_tfv_task_id  on task_field_values(task_id);
create index if not exists idx_space_fields_list_id on space_fields(list_id);
create index if not exists idx_tasks_list_active on tasks(list_id) where deleted_at is null;

create or replace function lead_monthly_report(p_list_id uuid)
returns table(ym text, status text, cnt bigint)
language sql stable security definer set search_path = public as $$
  -- Compute ONE created_time month per task in a single pass (DISTINCT ON),
  -- then left-join. This replaces a per-task LATERAL that timed out on large
  -- lists, and still counts each task once regardless of duplicate value rows.
  with ct as (
    select distinct on (tfv.task_id)
           tfv.task_id,
           case
             -- ISO (yyyy-mm-dd / yyyy-mm-ddT..): take year-month directly.
             when tfv.value ~ '^\d{4}-\d{2}' then substr(tfv.value, 1, 7)
             -- Day-first dd[-/]mm[-/]yyyy (legacy raw sheet values): reorder to
             -- YYYY-MM so they bucket into the right month instead of Undated.
             when tfv.value ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
               then to_char(
                 to_date(regexp_replace(tfv.value, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', '\1-\2-\3'), 'DD-MM-YYYY'),
                 'YYYY-MM')
             else null
           end as ym
    from task_field_values tfv
    join space_fields sf on sf.id = tfv.field_id
    where sf.list_id = p_list_id and lower(sf.field_name) = 'created_time'
    order by tfv.task_id, tfv.value desc nulls last
  )
  select
    coalesce(ct.ym, 'Undated') as ym,
    coalesce(nullif(t.status, ''), 'No status') as status,
    count(*)::bigint
  from tasks t
  left join ct on ct.task_id = t.id
  where t.list_id = p_list_id and t.deleted_at is null
  group by 1, 2;
$$;

grant execute on function lead_monthly_report(uuid) to anon, authenticated;
