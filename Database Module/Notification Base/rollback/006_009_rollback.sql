-- Rollback for Notification Base migrations 006 to 009. Newest migration first. Safe to run twice.
-- Runs before rollback/005_rollback.sql and rollback/001_004_rollback.sql: it restores the functions 004 owns and drops what Phase 2 added.
-- Later tasks add their sections above the 006 section.

-- ── 009: calendar ──────────────────────────────────────────────────
drop function if exists public.alert_calendar(date, date);

-- ── 008: staff email ───────────────────────────────────────────────
drop function if exists public.alert_email_record(jsonb);
drop function if exists public.alert_email_build(text);
drop table if exists public.alert_deliveries;
do $$ begin
  if to_regclass('public.alert_settings') is not null then
    delete from public.alert_settings where key in ('email_enabled', 'email_sender');
  end if;
end $$;

-- ── 007: preferences ───────────────────────────────────────────────
-- 001's bell, restored first, as it reads the function dropped below.
create or replace function public.alert_bell(p_id uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mode text := alert_mode(); v_a alerts%rowtype;
begin
  if v_mode = 'Preview' then return; end if;
  if v_mode = 'Triage' and p_reason <> 'Assigned' then return; end if;
  select * into v_a from alerts where id = p_id;
  if not found or v_a.backlog then return; end if;
  insert into notifications (user_id, task_id, type, title, body, link_scope, read)
  values (p_user, null, 'alert_centre', v_a.title, v_a.action_required, jsonb_build_object('alert_id', p_id), false);
end $$;
drop function if exists public.alert_preferences_save(text, text, boolean);
drop function if exists public.alert_preferences_get();
drop function if exists public.alert_channel_on(uuid, text, text, text);
drop function if exists public.alert_categories();
drop table if exists public.alert_preferences;

-- ── 006: compliance register ─────────────────────────────────────────
-- Alerts of the compliance rules go first (alerts.rule_code references alert_rules), with their bell rows.
-- alert_events has no foreign key and is append-only, so the history rows stay; the 001 to 004 rollback drops that table.
do $$ begin
  if to_regclass('public.alerts') is not null then
    if to_regclass('public.notifications') is not null then
      delete from public.notifications where type = 'alert_centre'
        and (link_scope->>'alert_id')::uuid in (select id from public.alerts where rule_code like 'compliance\_%');
    end if;
    delete from public.alerts where rule_code like 'compliance\_%';
  end if;
  if to_regclass('public.alert_rules') is not null then
    delete from public.alert_rules where code like 'compliance\_%';
  end if;
end $$;

-- 004's bodies, restored. Same signatures, so grants stay.
-- Same open rows as the list, so a tile and its list filter agree. mode lets the page say a zero in Preview is not an all clear.
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
    'backlog',    count(*) filter (where a.backlog),
    'mode',       alert_mode())
  into v_out
  from alert_scope_rows(p_scope, p_department) a
  where a.status in ('Open', 'In progress');
  return v_out;
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

-- ── Access ───────────────────────────────────────────────────────────
create or replace function public.alert_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('is_admin', alert_is_admin(), 'is_manager', alert_is_manager(), 'mode', alert_mode())
$$;

drop function if exists public.alert_rule_compliance_establishment_card();
drop function if exists public.alert_rule_compliance_ejari();
drop function if exists public.alert_rule_compliance_office_lease();
drop function if exists public.alert_rule_compliance_immigration_file();
drop function if exists public.alert_rule_compliance_labour_establishment();
drop function if exists public.alert_rule_compliance_emirates_id();
drop function if exists public.alert_rule_compliance_passport();
drop function if exists public.alert_rule_compliance_dependent_visa();
drop function if exists public.alert_rule_compliance_work_permit();
drop function if exists public.alert_compliance_candidates(text);
drop function if exists public.client_compliance_import(jsonb);
drop function if exists public.client_compliance_list(text, text, text, int, int);
drop function if exists public.client_compliance_close(uuid, text);
drop function if exists public.client_compliance_save(jsonb);
drop table if exists public.client_compliance_items;
drop function if exists public.client_compliance_item_types();
drop function if exists public.client_compliance_can_write();
drop function if exists public.client_compliance_can_read();
