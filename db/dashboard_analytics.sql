-- Dashboard + Space Overview analytics (executive layer).
-- SECURITY INVOKER RPCs (RLS applies to the caller) that aggregate in Postgres
-- so numbers are accurate at any scale. Beyond simple counts they add:
--   velocity (created vs completed, last 30d + prior 30d), overdue aging buckets,
--   average cycle time, on-time completion %, a deadline calendar (7/30/90d),
--   and an "attention required" set (worst overdue, stuck, unassigned high).
-- Run in the Supabase SQL editor (idempotent).

-- "Open" = not in a terminal state (done/complete/cancel/closed/reject).
create or replace function _abcap_status_open(s text)
returns boolean language sql immutable as $$
  select s is not null and lower(s) !~ 'done|complete|cancel|closed|reject';
$$;

-- Parse a completion date safely (date_done may be text 'YYYY-MM-DD' or null).
create or replace function _abcap_done_date(s text)
returns date language sql immutable as $$
  select case when s ~ '^\d{4}-\d{2}-\d{2}' then substring(s, 1, 10)::date else null end;
$$;

-- Per-space "completed statuses" config. is_complete on space_statuses:
--   true  = this status counts as complete
--   false = explicitly does NOT count
--   null  = auto (detect by name: done/complete/closed)
alter table space_statuses add column if not exists is_complete boolean;

-- Whether a task counts as completed for its space, honoring the config above.
-- Falls back to a name heuristic when the status isn't defined in the space.
create or replace function _abcap_task_complete(p_status text, p_space uuid)
returns boolean language sql stable as $$
  select coalesce(
    (select case when ss.is_complete is not null then ss.is_complete
                 else lower(ss.name) ~ 'done|complete|closed' end
       from space_statuses ss
      where ss.space_id = p_space and ss.name = p_status
      order by ss.is_complete desc nulls last
      limit 1),
    (p_status is not null and lower(p_status) ~ 'done|complete|closed')
  );
$$;

-- ── CRM-wide dashboard ──
-- Speeds the per-task completion lookup below.
create index if not exists idx_space_statuses_space_name on space_statuses(space_id, name);

create or replace function dashboard_overview()
returns jsonb language sql stable set search_path = public as $$
  -- Compute is_open / is_completed / done_dt ONCE per task here (single lateral
  -- to space_statuses), trimmed to needed columns. All aggregates below then
  -- read these columns instead of calling per-row functions thousands of times.
  with t as (
    select tk.id, tk.title, tk.status, tk.priority, tk.due_date, tk.created_at,
           tk.updated_at, tk.date_done, tk.list_id, tk.space_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null
  )
  select jsonb_build_object(
    'total',       (select count(*) from t),
    'done',        (select count(*) filter (where status = 'Done') from t),
    'completed',   (select count(*) filter (where is_completed) from t),
    'closed',      (select count(*) filter (where not is_open) from t),
    'in_progress', (select count(*) filter (where status = 'In Progress') from t),
    'open',        (select count(*) filter (where is_open) from t),
    'urgent',      (select count(*) filter (where priority = 'High' and is_open) from t),
    'overdue',     (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_7d',      (select count(*) filter (where due_date >= current_date and due_date < current_date + 7  and is_open) from t),
    'due_30d',     (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d',     (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'created_30d',      (select count(*) filter (where created_at >= now() - interval '30 days') from t),
    'created_prev_30d', (select count(*) filter (where created_at >= now() - interval '60 days' and created_at < now() - interval '30 days') from t),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'overdue_0_7',   (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30',  (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',   (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'oldest_overdue_days', (select coalesce(max(current_date - due_date), 0) from t where is_open and due_date < current_date),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else
                         round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'by_status',   (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                      from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_space',    (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                      select jsonb_build_object(
                        'space_id', sp.id, 'name', sp.name,
                        'total',   count(tt.id),
                        'open',    count(tt.id) filter (where tt.is_open),
                        'done',    count(tt.id) filter (where tt.status = 'Done'),
                        'completed', count(tt.id) filter (where tt.is_completed),
                        'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)
                      ) as row
                      from spaces sp left join t tt on tt.space_id = sp.id
                      where sp.deleted_at is null group by sp.id, sp.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name,
                        count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 12) y),
    'trend',       (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'created', cr, 'completed', cp) order by m), '[]'::jsonb) from (
                      select to_char(d, 'YYYY-MM') as m,
                        (select count(*) from t where to_char(created_at, 'YYYY-MM') = to_char(d, 'YYYY-MM')) as cr,
                        (select count(*) from t where done_dt is not null and to_char(done_dt, 'YYYY-MM') = to_char(d, 'YYYY-MM')) as cp
                      from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') d) z),
    'attention', jsonb_build_object(
      'top_overdue', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'list_id', list_id, 'space_id', space_id, 'days', current_date - due_date) order by due_date), '[]'::jsonb)
                        from (select id, title, due_date, list_id, space_id from t where is_open and due_date < current_date order by due_date limit 6) r),
      'stuck',       (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'list_id', list_id, 'space_id', space_id, 'days', (current_date - updated_at::date)) order by updated_at), '[]'::jsonb)
                        from (select id, title, status, list_id, space_id, updated_at from t where is_open and updated_at < now() - interval '30 days' order by updated_at limit 6) r),
      'unassigned_high', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'list_id', list_id, 'space_id', space_id) order by created_at), '[]'::jsonb)
                        from (select id, title, list_id, space_id, created_at from t where priority = 'High' and is_open and coalesce(cardinality(assignees), 0) = 0 order by created_at limit 6) r)
    )
  );
$$;

-- ── Per-space overview ──
create or replace function space_overview(p_space_id uuid)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select tk.id, tk.title, tk.status, tk.due_date, tk.created_at, tk.date_done,
           tk.list_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null and tk.space_id = p_space_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from t),
    'open',    (select count(*) filter (where is_open) from t),
    'done',    (select count(*) filter (where status = 'Done') from t),
    'completed', (select count(*) filter (where is_completed) from t),
    'overdue', (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_30d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'overdue_0_7',  (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30', (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',  (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                    from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_list', (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                  select jsonb_build_object('folder_id', f.id, 'folder', f.name, 'list_id', l.id, 'list', l.name,
                    'total', count(tt.id), 'done', count(tt.id) filter (where tt.status = 'Done'),
                    'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)) as row
                  from lists l join folders f on f.id = l.folder_id
                  left join t tt on tt.list_id = l.id
                  where l.space_id = p_space_id and l.deleted_at is null and f.deleted_at is null
                  group by f.id, f.name, l.id, l.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name, count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 10) y),
    'at_risk', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'status', status, 'list_id', list_id) order by due_date), '[]'::jsonb)
                  from (select id, title, due_date, status, list_id from t
                        where due_date is not null and due_date < current_date + 30 and is_open
                        order by due_date limit 40) r)
  );
$$;

-- ── Per-folder overview (same shape as space_overview, scoped to a folder) ──
create or replace function folder_overview(p_folder_id uuid)
returns jsonb language sql stable set search_path = public as $$
  with t as (
    select tk.id, tk.title, tk.status, tk.due_date, tk.created_at, tk.date_done,
           tk.list_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null and tk.folder_id = p_folder_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from t),
    'open',    (select count(*) filter (where is_open) from t),
    'done',    (select count(*) filter (where status = 'Done') from t),
    'completed', (select count(*) filter (where is_completed) from t),
    'overdue', (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_30d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'overdue_0_7',  (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30', (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',  (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                    from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_list', (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                  select jsonb_build_object('folder_id', f.id, 'folder', f.name, 'list_id', l.id, 'list', l.name,
                    'total', count(tt.id), 'done', count(tt.id) filter (where tt.status = 'Done'),
                    'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)) as row
                  from lists l join folders f on f.id = l.folder_id
                  left join t tt on tt.list_id = l.id
                  where l.folder_id = p_folder_id and l.deleted_at is null and f.deleted_at is null
                  group by f.id, f.name, l.id, l.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name, count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 10) y),
    'at_risk', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'status', status, 'list_id', list_id) order by due_date), '[]'::jsonb)
                  from (select id, title, due_date, status, list_id from t
                        where due_date is not null and due_date < current_date + 30 and is_open
                        order by due_date limit 40) r)
  );
$$;

grant execute on function dashboard_overview() to authenticated;
grant execute on function space_overview(uuid) to authenticated;
grant execute on function folder_overview(uuid) to authenticated;
