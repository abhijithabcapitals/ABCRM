-- Notification Centre, Phase 1: read functions behind the page.
-- Every function runs SECURITY DEFINER and enforces its own scope. Re-runnable.
-- Rollback: rollback/001_004_rollback.sql.
-- "Open" means status Open or In progress. "Today" is the Asia/Dubai date.

-- ── Scope ────────────────────────────────────────────────────────────
-- The one place a scope turns into rows. Internal: not executable by any browser role.
--   My          assigned to the caller and visible to the caller (alert_can_see)
--   Department  a tagged Manager or an admin; a manager gets nothing in Preview, as in alert_can_see
--   Management  admin only, backlog rows included
create or replace function public.alert_scope_rows(p_scope text, p_department text default null) returns setof public.alerts
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'You do not have permission to view alerts.'; end if;
  if p_scope = 'My' then
    return query select a.* from alerts a where a.assigned_to = auth.uid() and alert_can_see(a.id);
  elsif p_scope = 'Department' then
    if not (alert_is_admin() or alert_is_manager()) then raise exception 'You do not have permission to view department alerts.'; end if;
    if alert_is_admin() or alert_mode() <> 'Preview' then
      return query select a.* from alerts a where p_department is null or a.department = p_department;
    end if;
  elsif p_scope = 'Management' then
    if not alert_is_admin() then raise exception 'You do not have permission to view management alerts.'; end if;
    return query select a.* from alerts a;
  else
    raise exception 'Scope must be My, Department or Management.';
  end if;
end $$;

-- ── List ─────────────────────────────────────────────────────────────
create or replace function public.alert_list(
  p_scope text, p_filter text default 'All', p_department text default null, p_limit int default 100, p_offset int default 0)
returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_filter text := coalesce(p_filter, 'All');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);   -- capped here, not in the browser
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows jsonb; v_total bigint;
begin
  if v_filter not in ('All', 'Urgent', 'Due Today', 'Client Pending', 'Government Pending', 'Backlog') then
    raise exception 'Filter must be All, Urgent, Due Today, Client Pending, Government Pending or Backlog.';
  end if;

  with s as (
    select a.* from alert_scope_rows(p_scope, p_department) a
    where a.status in ('Open', 'In progress')
      and case v_filter
            when 'All' then true
            when 'Urgent' then a.priority = 'Critical' or (a.priority = 'High' and a.due_date < v_today)
            when 'Due Today' then a.due_date = v_today
            when 'Client Pending' then a.category = 'Client Documents'
            when 'Government Pending' then a.category = 'Government Applications'
            else a.backlog end
  ), pg as (
    select (to_jsonb(a) - 'dedupe_key') || jsonb_build_object(
             'client_name', cm.legal_name,
             'assignee_name', p.full_name,
             'read', coalesce(r.read_at is not null, false)) as j,
           case a.priority when 'Critical' then 1 when 'High' then 2 when 'Medium' then 3 else 4 end as rk,
           a.due_date, a.created_at, a.alert_number
    from s a
    left join client_master cm on cm.client_id = a.client_id
    left join profiles p on p.id = a.assigned_to
    left join alert_recipients r on r.alert_id = a.id and r.user_id = auth.uid()
    order by rk, a.due_date nulls last, a.created_at, a.alert_number
    limit v_limit offset v_offset
  )
  select coalesce((select jsonb_agg(j order by rk, due_date nulls last, created_at, alert_number) from pg), '[]'::jsonb),
         (select count(*) from s)
  into v_rows, v_total;
  return jsonb_build_object('rows', v_rows, 'total', v_total);
end $$;

-- ── Tiles ────────────────────────────────────────────────────────────
-- Same open rows as the list, so a tile and its list filter agree.
create or replace function public.alert_tiles(p_scope text, p_department text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date; v_out jsonb;
begin
  select jsonb_build_object(
    'overdue',    count(*) filter (where a.due_date < v_today),
    'upcoming',   count(*) filter (where a.due_date between v_today and v_today + 7),
    'documents',  count(*) filter (where a.category = 'Client Documents'),
    'authority',  count(*) filter (where a.category = 'Government Applications'),
    'renewals',   count(*) filter (where a.rule_code in ('licence_expiry', 'visa_expiry') and a.current_step >= 0),
    'unassigned', count(*) filter (where a.assigned_to is null),
    'due_today',  count(*) filter (where a.due_date = v_today),
    'new_today',  count(*) filter (where (a.created_at at time zone 'Asia/Dubai')::date = v_today),
    'backlog',    count(*) filter (where a.backlog))
  into v_out
  from alert_scope_rows(p_scope, p_department) a
  where a.status in ('Open', 'In progress');
  return v_out;
end $$;

-- ── Detail ───────────────────────────────────────────────────────────
-- One refusal for a missing alert and a forbidden one, so an id cannot be probed.
create or replace function public.alert_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_alert jsonb; v_rec jsonb; v_ev jsonb;
begin
  if p_id is null or not exists (select 1 from alerts where id = p_id) or not alert_can_see(p_id) then
    raise exception 'You do not have access to that alert, or it does not exist.';
  end if;
  select (to_jsonb(a) - 'dedupe_key') || jsonb_build_object(
           'client_name', cm.legal_name,
           'assignee_name', p.full_name,
           'read', coalesce(r.read_at is not null, false))
  into v_alert
  from alerts a
  left join client_master cm on cm.client_id = a.client_id
  left join profiles p on p.id = a.assigned_to
  left join alert_recipients r on r.alert_id = a.id and r.user_id = auth.uid()
  where a.id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'name', pr.full_name, 'reason', r.reason, 'read_at', r.read_at)
                            order by r.reason, pr.full_name, r.user_id), '[]'::jsonb)
  into v_rec from alert_recipients r left join profiles pr on pr.id = r.user_id where r.alert_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'event', e.event, 'detail', e.detail, 'created_at', e.created_at,
                                               'created_by', e.created_by, 'by_name', pr.full_name) order by e.created_at, e.id), '[]'::jsonb)
  into v_ev from alert_events e left join profiles pr on pr.id = e.created_by where e.alert_id = p_id;
  return jsonb_build_object('alert', v_alert, 'recipients', v_rec, 'events', v_ev);
end $$;

-- ── Management summary ───────────────────────────────────────────────
-- performance: pending = open alerts assigned to the person; resolved = alerts the person closed as Resolved.
-- It is a count, not a judgement.
create or replace function public.alert_management_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date; v_out jsonb; v_perf jsonb; v_risk jsonb;
begin
  if not alert_is_admin() then raise exception 'You do not have permission to view the management summary.'; end if;
  select jsonb_build_object(
    'critical',           count(*) filter (where priority = 'Critical'),
    'today',              count(*) filter (where due_date = v_today),
    'client_pending',     count(*) filter (where category = 'Client Documents'),
    'government_pending', count(*) filter (where category = 'Government Applications'),
    'renewals',           count(*) filter (where rule_code in ('licence_expiry', 'visa_expiry') and current_step >= 0),
    'unassigned',         count(*) filter (where assigned_to is null),
    'delayed',            0)   -- Phase 3
  into v_out from alerts where status in ('Open', 'In progress');

  select coalesce(jsonb_agg(jsonb_build_object('user_id', q.uid, 'name', p.full_name, 'pending', q.pending, 'resolved', q.resolved)
                            order by q.pending desc, q.resolved desc, p.full_name, q.uid), '[]'::jsonb)
  into v_perf
  from (select uid, sum(pending)::int as pending, sum(resolved)::int as resolved from (
          select assigned_to as uid, 1 as pending, 0 as resolved from alerts where status in ('Open', 'In progress') and assigned_to is not null
          union all
          select resolved_by, 0, 1 from alerts where status = 'Resolved' and resolved_by is not null) u
        group by uid) q
  left join profiles p on p.id = q.uid;

  select coalesce(jsonb_agg(jsonb_build_object('client_id', c.client_id, 'client_name', cm.legal_name, 'critical', c.n)
                            order by c.n desc, c.client_id), '[]'::jsonb)
  into v_risk
  from (select client_id, count(*) as n from alerts
        where status in ('Open', 'In progress') and priority = 'Critical' and client_id is not null group by client_id) c
  left join client_master cm on cm.client_id = c.client_id;

  return v_out || jsonb_build_object('performance', v_perf, 'client_risk', v_risk);
end $$;

-- ── Coverage ─────────────────────────────────────────────────────────
-- Counts come from the latest scan that ran (Ok or Failed; a Skipped scan did nothing).
-- "raised" is the scan's own number: alerts in step, new or not. It is not a count of new alerts.
-- stale: no Ok scan in the last 26 hours. A rule absent from the log reports null counts, never zero.
create or replace function public.alert_coverage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_log alert_scan_log%rowtype; v_last_ok timestamptz; v_rules jsonb;
begin
  if not alert_is_admin() then raise exception 'You do not have permission to view coverage.'; end if;
  select * into v_log from alert_scan_log where status in ('Ok', 'Failed') order by id desc limit 1;
  select max(coalesce(finished_at, started_at)) into v_last_ok from alert_scan_log where status = 'Ok';

  select coalesce(jsonb_agg(jsonb_build_object(
      'rule', r.code, 'category', r.category, 'enabled', r.enabled,
      'checked', (v_log.rule_counts -> r.code ->> 'checked')::int,
      'with_data', (v_log.rule_counts -> r.code ->> 'with_data')::int,
      'missing_data', (v_log.rule_counts -> r.code ->> 'checked')::int - (v_log.rule_counts -> r.code ->> 'with_data')::int,
      'raised', (v_log.rule_counts -> r.code ->> 'raised')::int,
      'closed', (v_log.rule_counts -> r.code ->> 'closed')::int,
      'error', v_log.rule_counts -> r.code ->> 'error') order by r.code), '[]'::jsonb)
  into v_rules from alert_rules r;

  return jsonb_build_object(
    'rules', v_rules,
    'raised_means', 'alerts in step at that scan, new or already open; not new alerts',
    'escalation_error', v_log.rule_counts -> 'escalation' ->> 'error',
    'last_scan_id', v_log.id,
    'last_scan_at', coalesce(v_log.finished_at, v_log.started_at),
    'last_scan_status', v_log.status,
    'last_scan_error', v_log.error,
    'last_ok_at', v_last_ok,
    'stale', v_last_ok is null or v_last_ok < now() - interval '26 hours');
end $$;

-- ── Access ───────────────────────────────────────────────────────────
create or replace function public.alert_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('is_admin', alert_is_admin(), 'is_manager', alert_is_manager(), 'mode', alert_mode())
$$;

-- ── Settings reads ───────────────────────────────────────────────────
-- Rules for the Settings tab, admin only. Steps are returned as stored.
create or replace function public.alert_rule_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not alert_is_admin() then raise exception 'You do not have permission to view alert rules.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('code', r.code, 'category', r.category, 'department', r.department,
                                                      'enabled', r.enabled, 'steps', r.steps) order by r.code)
                   from alert_rules r), '[]'::jsonb);
end $$;

-- The tagged managers, read-only. fell_back is true when nobody is tagged and the CRM admins stand in.
create or replace function public.alert_manager_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_list jsonb; v_fell boolean;
begin
  if not (alert_is_admin() or alert_is_manager()) then raise exception 'You do not have permission to view the manager list.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('user_id', m.user_id, 'name', p.full_name) order by p.full_name, m.user_id), '[]'::jsonb),
         coalesce(bool_or(m.fell_back), false)
  into v_list, v_fell
  from alert_managers() m left join profiles p on p.id = m.user_id;
  return jsonb_build_object('managers', v_list, 'fell_back', v_fell);
end $$;

revoke execute on function
  public.alert_scope_rows(text, text), public.alert_list(text, text, text, int, int), public.alert_tiles(text, text),
  public.alert_detail(uuid), public.alert_management_summary(), public.alert_coverage(), public.alert_my_access(),
  public.alert_rule_list(), public.alert_manager_list()
  from public, anon, authenticated;
-- Each of these checks the caller inside.
grant execute on function
  public.alert_list(text, text, text, int, int), public.alert_tiles(text, text), public.alert_detail(uuid),
  public.alert_management_summary(), public.alert_coverage(), public.alert_my_access(),
  public.alert_rule_list(), public.alert_manager_list()
  to authenticated;
