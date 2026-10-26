-- Executive (CEO) dashboard data: lead conversion value + a renewals/expiry
-- risk radar, in one RPC. SECURITY DEFINER so it reflects the whole company
-- (the UI shows this band to admins only).
--
-- Run in the Supabase SQL editor (idempotent).

-- Parse a stored date value that may be ISO (yyyy-mm-dd / with time) OR day-first
-- (dd-mm-yyyy, dd/mm/yyyy). Returns null on anything unparseable.
create or replace function _abcap_parse_date(v text)
returns date language plpgsql immutable as $$
begin
  if v is null then return null; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return substr(v, 1, 10)::date;
  elsif v ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then
    return to_date(regexp_replace(v, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', '\1-\2-\3'), 'DD-MM-YYYY');
  end if;
  return null;
exception when others then return null;
end $$;

create or replace function ceo_overview()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  with
  -- Lead pipelines = lists that have a created_time field (same set as the
  -- Monthly Lead Report). A lead is "converted" when its status is Converted.
  lead_lists as (
    select distinct list_id from space_fields
    where lower(field_name) = 'created_time' and list_id is not null
  ),
  lt as (
    select t.id, t.status,
      (select _abcap_parse_date(tfv.value)
         from task_field_values tfv
         join space_fields sf on sf.id = tfv.field_id
        where tfv.task_id = t.id and sf.list_id = t.list_id and lower(sf.field_name) = 'created_time'
        order by tfv.id limit 1) as cdate
    from tasks t
    join lead_lists ll on ll.list_id = t.list_id
    where t.deleted_at is null
  ),
  leads_agg as (
    select count(*) total, count(*) filter (where lower(status) = 'converted') converted from lt
  ),
  by_month as (
    select to_char(date_trunc('month', cdate), 'YYYY-MM') ym,
           count(*) leads,
           count(*) filter (where lower(status) = 'converted') converted
    from lt
    where cdate is not null and cdate >= date_trunc('month', current_date) - interval '5 months'
    group by 1 order by 1
  ),
  -- Renewal/expiry risk: date fields whose NAME looks like a renewal date.
  exp_fields as (
    select sf.id as field_id, sf.field_name, l.name as list_name
    from space_fields sf
    join lists l on l.id = sf.list_id and l.deleted_at is null
    where sf.field_type = 'date'
      and sf.field_name ~* 'expiry|expire|licen|visa|renew|tenancy|e-?jari|permit'
  ),
  exp_clean as (
    select t.id as task_id, t.title, t.space_id, t.folder_id, t.list_id,
           ef.list_name, ef.field_name,
           _abcap_parse_date(tfv.value) as edate
    from exp_fields ef
    join task_field_values tfv on tfv.field_id = ef.field_id
    join tasks t on t.id = tfv.task_id and t.deleted_at is null
    where _abcap_parse_date(tfv.value) is not null
  )
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'total', (select total from leads_agg),
      'converted', (select converted from leads_agg),
      'by_month', coalesce((select jsonb_agg(jsonb_build_object('ym', ym, 'leads', leads, 'converted', converted)) from by_month), '[]'::jsonb)
    ),
    'renewals', jsonb_build_object(
      'overdue', (select count(*) from exp_clean where edate < current_date),
      'd30', (select count(*) from exp_clean where edate >= current_date and edate < current_date + 30),
      'd60', (select count(*) from exp_clean where edate >= current_date + 30 and edate < current_date + 60),
      'd90', (select count(*) from exp_clean where edate >= current_date + 60 and edate < current_date + 90),
      'soon', coalesce((select jsonb_agg(x order by (x->>'days_left')::int) from (
        select jsonb_build_object(
          'task_id', task_id, 'title', title, 'list', list_name, 'field', field_name,
          'space_id', space_id, 'folder_id', folder_id, 'list_id', list_id,
          'date', to_char(edate, 'YYYY-MM-DD'), 'days_left', (edate - current_date)
        ) x
        from exp_clean
        where edate >= current_date and edate < current_date + 90
        order by edate asc limit 30
      ) s), '[]'::jsonb)
    )
  ) into res;
  return res;
end $$;
grant execute on function ceo_overview() to anon, authenticated;
