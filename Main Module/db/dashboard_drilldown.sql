-- Drill-down for dashboard / overview KPIs: returns the tasks behind a metric,
-- so clicking a tile can list them (each links to its task). Optionally scoped
-- to one space (for the per-space Overview). SECURITY INVOKER (RLS applies).
--
-- Run in the Supabase SQL editor (idempotent). Requires _abcap_parse_date from
-- db/ceo_overview.sql.

-- Drop the older (text, uuid, int) signature so adding p_folder doesn't create
-- an ambiguous overload.
drop function if exists dashboard_drilldown(text, uuid, int);

create or replace function dashboard_drilldown(p_metric text, p_space uuid default null, p_folder uuid default null, p_limit int default 300)
returns jsonb language plpgsql stable set search_path = public as $$
declare res jsonb;
begin
  -- Renewal/expiry buckets (from expiry-type date fields).
  if p_metric in ('renewals_overdue', 'renewals_30', 'renewals_90') then
    select coalesce(jsonb_agg(x order by (x->>'due')), '[]'::jsonb) into res from (
      select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
               'space_id', t.space_id, 'folder_id', t.folder_id, 'list_id', t.list_id,
               'sub', sf.field_name, 'due', to_char(_abcap_parse_date(tfv.value), 'YYYY-MM-DD')) x
      from space_fields sf
      join task_field_values tfv on tfv.field_id = sf.id
      join tasks t on t.id = tfv.task_id and t.deleted_at is null
      where sf.field_type = 'date'
        and sf.field_name ~* 'expiry|expire|licen|visa|renew|tenancy|e-?jari|permit'
        and _abcap_parse_date(tfv.value) is not null
        and (p_space is null or t.space_id = p_space)
        and (p_folder is null or t.folder_id = p_folder)
        and case p_metric
              when 'renewals_overdue' then _abcap_parse_date(tfv.value) < current_date
              when 'renewals_30' then _abcap_parse_date(tfv.value) >= current_date and _abcap_parse_date(tfv.value) < current_date + 30
              when 'renewals_90' then _abcap_parse_date(tfv.value) >= current_date and _abcap_parse_date(tfv.value) < current_date + 90
            end
      order by _abcap_parse_date(tfv.value)
      limit p_limit
    ) s;
    return res;
  end if;

  -- Lead pipeline / converted (lead lists = lists with a created_time field).
  if p_metric in ('leads', 'converted') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
               'space_id', t.space_id, 'folder_id', t.folder_id, 'list_id', t.list_id,
               'due', to_char(t.due_date, 'YYYY-MM-DD')) x
      from tasks t
      where t.deleted_at is null
        and t.list_id in (select distinct list_id from space_fields where lower(field_name) = 'created_time' and list_id is not null)
        and (p_space is null or t.space_id = p_space)
        and (p_folder is null or t.folder_id = p_folder)
        and (p_metric <> 'converted' or lower(t.status) = 'converted')
      limit p_limit
    ) s;
    return res;
  end if;

  -- Tasks with a specific status (donut slice). p_metric = 'status:<name>'.
  if p_metric like 'status:%' then
    declare v_status text := substring(p_metric from 8);
    begin
      select coalesce(jsonb_agg(x order by (x->>'due')), '[]'::jsonb) into res from (
        select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
                 'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
                 'due', to_char(tk.due_date, 'YYYY-MM-DD')) x
        from tasks tk
        where tk.deleted_at is null and (p_space is null or tk.space_id = p_space)
          and (p_folder is null or tk.folder_id = p_folder)
          and (case when v_status = '(no status)' then coalesce(nullif(tk.status, ''), '(no status)') else tk.status end) = v_status
        order by tk.due_date nulls last
        limit p_limit
      ) s;
      return res;
    end;
  end if;

  -- Velocity: created / completed in the last 30 days.
  if p_metric in ('created_30d', 'completed_30d') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
               'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
               'due', to_char(tk.due_date, 'YYYY-MM-DD')) x
      from tasks tk
      where tk.deleted_at is null and (p_space is null or tk.space_id = p_space)
        and (p_folder is null or tk.folder_id = p_folder)
        and case p_metric
              when 'created_30d' then tk.created_at >= now() - interval '30 days'
              when 'completed_30d' then (tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}'
                                         and substring(tk.date_done::text, 1, 10)::date >= current_date - 30)
            end
      order by tk.created_at desc
      limit p_limit
    ) s;
    return res;
  end if;

  -- Generic task-status/date metrics.
  select coalesce(jsonb_agg(x order by due_date nulls last), '[]'::jsonb) into res from (
    select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
             'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
             'due', to_char(tk.due_date, 'YYYY-MM-DD')) x,
           tk.due_date
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null
      and (p_space is null or tk.space_id = p_space)
      and (p_folder is null or tk.folder_id = p_folder)
      and case p_metric
        when 'total' then true
        when 'done' then tk.status = 'Done'
        when 'completed' then coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed'))
        when 'closed' then not (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'in_progress' then tk.status = 'In Progress'
        when 'open' then (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'urgent' then tk.priority = 'High' and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'overdue' then tk.due_date < current_date and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'due_7d' then tk.due_date >= current_date and tk.due_date < current_date + 7 and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'due_30d' then tk.due_date >= current_date and tk.due_date < current_date + 30 and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        else false
      end
    order by tk.due_date nulls last
    limit p_limit
  ) s;
  return res;
end $$;
grant execute on function dashboard_drilldown(text, uuid, uuid, int) to authenticated;
