-- Notification Centre, Phase 1: step function, rule seed, rule functions and the daily scan.
-- Re-runnable. Rollback: rollback/001_004_rollback.sql.

-- Steps are a JSON array of {"days": int, "priority": text}. Sorted by days descending, the last step with
-- p_days_left <= days wins. Outside the largest step: no row. Negative days mean overdue.
create or replace function public.alert_step_for(p_steps jsonb, p_days_left int)
returns table (step int, priority text)
language sql immutable security definer set search_path = public, pg_temp as $$
  select (s->>'days')::int, s->>'priority'
  from jsonb_array_elements(coalesce(p_steps, '[]'::jsonb)) s
  where p_days_left <= (s->>'days')::int
  order by (s->>'days')::int asc
  limit 1
$$;

revoke execute on function public.alert_step_for(jsonb, int) from public, anon, authenticated;

-- Seed is insert-only, so steps edited later survive a reapply.
insert into public.alert_rules (code, category, department, title_template, action_template, steps) values
  ('licence_expiry', 'Licence', 'Business Setup', 'Licence expiry: {subject}', 'Confirm the licence date, then start the renewal.',
    '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":-1,"priority":"Critical"}]'),
  ('visa_expiry', 'Visa & Emirates ID', 'Business Setup', 'Visa expiry: {subject}', 'Confirm the visa date, then start the renewal or cancellation.',
    '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":15,"priority":"High"},{"days":7,"priority":"High"},{"days":-1,"priority":"Critical"}]'),
  ('job_due', 'Deadlines', 'Accounting', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('service_due', 'Deadlines', 'Business Setup', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('setup_task_due', 'Deadlines', 'Business Setup', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('banking_task_due', 'Deadlines', 'Business Banking', 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]'),
  ('crm_task_due', 'Deadlines', null, 'Due: {subject}', 'Complete this item or update its due date.',
    '[{"days":1,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"},{"days":-3,"priority":"Critical"}]')
on conflict (code) do nothing;

-- ── Candidates and rule functions ────────────────────────────────────
-- A rule function is read-only and returns every row it checked. A null due_date means missing data:
-- the scan counts it and raises nothing. alert_scan() turns candidates into alerts.
do $$ begin
  if not exists (select 1 from pg_type where typname = 'alert_candidate' and typnamespace = 'public'::regnamespace) then
    create type public.alert_candidate as (
      dedupe_key text, client_id text, subject text, department text, due_date date, assigned_to uuid, extra uuid[],
      source_table text, source_id text, service_id uuid, description text);
  end if;
end $$;

-- A text or timestamp column read as a date. Anything that is not a real calendar date is null, never an error.
create or replace function public.alert_safe_date(p text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or btrim(p) !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return left(btrim(p), 10)::date;
exception when others then
  return null;
end $$;

create or replace function public.alert_rule_licence_expiry() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'licence:' || k.client_id || ':' || coalesce(d.dt::text, ''), k.client_id, m.legal_name, null::text, d.dt,
         alert_owner(k.client_id, 'Business Setup'), null::uuid[], 'business_setup_kyc_profiles', k.client_id, null::uuid, null::text
  from business_setup_kyc_profiles k
  left join client_master m on m.client_id = k.client_id
  cross join lateral (select coalesce(k.licence_expiry, business_setup_parse_date(m.data->>'License Expiry Date')) as dt) d
  where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_visa_expiry() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'visa:' || v.id || ':' || coalesce(v.expiry_date::text, ''), v.client_id,
         concat_ws(' ', v.person_name, case when m.legal_name is not null then '(' || m.legal_name || ')' end),
         null::text, v.expiry_date, alert_owner(v.client_id, 'Business Setup'), null::uuid[], 'business_setup_visas', v.id::text, null::uuid,
         case when upper(btrim(v.status)) = 'X' then 'Pending follow-up' end
  from business_setup_visas v
  left join business_setup_kyc_profiles k on k.client_id = v.client_id
  left join client_master m on m.client_id = v.client_id
  where coalesce(v.status, '') !~* 'cancel|resign'
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_job_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'job:' || j.id || ':' || coalesce(j.due_date::text, ''), j.client_id,
         concat_ws(' - ', j.service_name, j.client_name), coalesce(j.service_department, 'Accounting'), j.due_date,
         coalesce(j.assignee_ids[1], alert_owner(j.client_id, coalesce(j.service_department, 'Accounting'))),
         case when cardinality(j.assignee_ids) > 1 then j.assignee_ids[2:] end,
         'accounting_job_list', j.id::text, null::uuid, null::text
  from accounting_job_list j
  where coalesce(j.work_status, '') not in ('Completed', 'Client Cancelled')
$$;

create or replace function public.alert_rule_service_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'service:' || s.id || ':' || coalesce(s.due_date::text, ''), s.client_id,
         concat_ws(' - ', s.name, m.legal_name), null::text, s.due_date,
         coalesce(s.owner_id, alert_owner(s.client_id, 'Business Setup')), null::uuid[], 'business_setup_services', s.id::text, s.id, null::text
  from business_setup_services s
  left join client_master m on m.client_id = s.client_id
  where not coalesce(s.historical, false)
    and coalesce(s.status, '') not in ('Completed', 'Cancelled')
    and s.name is distinct from 'Visa Registration'
$$;

create or replace function public.alert_rule_setup_task_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'setuptask:' || t.id || ':' || coalesce(t.due_date::text, ''), t.client_id,
         concat_ws(' - ', t.title, m.legal_name), null::text, t.due_date,
         coalesce(t.owner_id, alert_owner(t.client_id, 'Business Setup')), null::uuid[], 'business_setup_tasks', t.id::text, null::uuid, null::text
  from business_setup_tasks t
  left join client_master m on m.client_id = t.client_id
  where t.status = 'Open'
$$;

create or replace function public.alert_rule_banking_task_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'bankingtask:' || t.id || ':' || coalesce(t.due_date::text, ''), t.client_id,
         concat_ws(' - ', t.title, m.legal_name), null::text, t.due_date,
         coalesce(t.assigned_to, alert_owner(t.client_id, 'Business Banking')), null::uuid[], 'banking_tasks', t.id::text, null::uuid, null::text
  from banking_tasks t
  left join client_master m on m.client_id = t.client_id
  where t.status in ('Open', 'In Progress')
$$;

create or replace function public.alert_rule_crm_task_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'crmtask:' || t.id || ':' || coalesce(d.dt::text, ''), null::text, t.title, null::text, d.dt,
         t.assignee_id, null::uuid[], 'tasks', t.id::text, null::uuid, null::text
  from tasks t
  cross join lateral (select alert_safe_date(t.due_date::text) as dt) d
  where t.deleted_at is null and coalesce(t.status, '') <> 'Done'
$$;

-- ── The daily scan ───────────────────────────────────────────────────
-- One run at a time (advisory lock). Each enabled rule runs in its own block: an error is recorded for that
-- rule, its close step is skipped, and the others still run. A rule's candidates inside a step are raised; open
-- alerts of that rule whose key was not raised are closed by the system, so a human close is never undone.
create or replace function public.alert_scan() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_log bigint;
  v_counts jsonb := '{}'::jsonb;
  v_failed text[] := '{}';
  v_rule alert_rules%rowtype;
  v_c alert_candidate;
  v_step record;
  v_keys text[];
  v_checked int; v_data int; v_raised int; v_closed int;
  v_id uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('alert_scan', 0)) then
    insert into alert_scan_log (finished_at, status, rule_counts) values (now(), 'Skipped', '{}'::jsonb);
    return jsonb_build_object('status', 'Skipped');
  end if;
  insert into alert_scan_log (status) values ('Running') returning id into v_log;

  for v_rule in select * from alert_rules where enabled order by code loop
    v_checked := 0; v_data := 0; v_raised := 0; v_closed := 0; v_keys := '{}';
    begin
      for v_c in execute format('select * from public.%I()', 'alert_rule_' || v_rule.code) loop
        v_checked := v_checked + 1;
        continue when v_c.due_date is null;
        v_data := v_data + 1;
        select * into v_step from alert_step_for(v_rule.steps, v_c.due_date - v_today);
        continue when not found;
        v_keys := v_keys || v_c.dedupe_key;
        v_id := alert_raise(v_rule.code, v_c.dedupe_key, v_c.client_id, v_c.subject, v_c.department, v_c.due_date, v_step.step, v_step.priority,
                            coalesce(v_c.assigned_to, alert_owner(v_c.client_id, coalesce(v_c.department, v_rule.department))),
                            v_c.source_table, v_c.source_id, v_c.service_id, v_c.description, v_c.extra);
        if v_id is not null then v_raised := v_raised + 1; end if;
      end loop;

      with closing as (
        update alerts set status = 'Resolved', resolved_at = now(), resolved_by = null, resolved_by_system = true,
               resolution_note = 'Date changed or no longer applies', updated_at = now()
        where rule_code = v_rule.code and status in ('Open', 'In progress') and not (dedupe_key = any (v_keys))
        returning id
      ), ev as (
        insert into alert_events (alert_id, event, detail)
        select id, 'resolved', jsonb_build_object('by', 'system', 'note', 'Date changed or no longer applies') from closing
        returning 1
      )
      select count(*) into v_closed from closing;
      v_counts := v_counts || jsonb_build_object(v_rule.code, jsonb_build_object(
        'checked', v_checked, 'with_data', v_data, 'raised', v_raised, 'closed', v_closed, 'error', null));
    exception when others then
      v_failed := v_failed || v_rule.code;
      v_counts := v_counts || jsonb_build_object(v_rule.code, jsonb_build_object(
        'checked', v_checked, 'with_data', v_data, 'raised', 0, 'closed', 0, 'error', sqlerrm));
    end;
  end loop;

  -- Task 4 defines alert_escalate_due(). Late bound: it is only reached in Live, which no Task 3 test enters.
  if alert_mode() = 'Live' then
    begin
      perform alert_escalate_due();
    exception when others then
      v_failed := v_failed || 'escalation';
      v_counts := v_counts || jsonb_build_object('escalation', jsonb_build_object('error', sqlerrm));
    end;
  end if;

  update alert_scan_log set finished_at = now(), rule_counts = v_counts,
         status = case when cardinality(v_failed) = 0 then 'Ok' else 'Failed' end,
         error = case when cardinality(v_failed) = 0 then null else 'Failed: ' || array_to_string(v_failed, ', ') end
  where id = v_log;
  return jsonb_build_object('status', case when cardinality(v_failed) = 0 then 'Ok' else 'Failed' end, 'rule_counts', v_counts);
end $$;

-- Rule functions and the helper are internal. The scan runs as postgres (cron) or service_role.
revoke execute on function
  public.alert_safe_date(text), public.alert_rule_licence_expiry(), public.alert_rule_visa_expiry(), public.alert_rule_job_due(),
  public.alert_rule_service_due(), public.alert_rule_setup_task_due(), public.alert_rule_banking_task_due(), public.alert_rule_crm_task_due(),
  public.alert_scan()
  from public, anon, authenticated;
grant execute on function public.alert_scan() to service_role;

select cron.schedule('alert-scan', '0 2 * * *', 'select public.alert_scan()');
