-- Review fix I1: a register import or a newly enabled rule no longer floods bells.
-- Its first alerts are backlog: no bell, no escalation, no mail. A later step change clears backlog as before.
-- Also, importing a CSV twice reports duplicates per row instead of saving them again.
-- alert_raise is 001's, alert_scan is 002's, client_compliance_save and client_compliance_import are 006's, each with the changes marked.
-- Re-runnable. Rollback: rollback/015_018_rollback.sql.

alter table public.alert_rules add column if not exists baseline_pending boolean not null default false;
alter table public.client_compliance_items add column if not exists baseline_pending boolean not null default false;

create or replace function public.alert_raise(
  p_rule text, p_key text, p_client text, p_subject text, p_department text, p_due date, p_step int,
  p_priority text, p_assigned uuid, p_source_table text, p_source_id text,
  p_service uuid default null, p_description text default null, p_extra uuid[] default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_rule alert_rules%rowtype;
  v_a alerts%rowtype;
  v_id uuid;
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_prio text := coalesce(p_priority, 'Normal');
  v_fell boolean := false;
  v_u uuid;
  r record;
  v_backlog boolean;
begin
  select * into v_rule from alert_rules where code = p_rule;
  if not found then raise exception 'Alert rule % does not exist', p_rule; end if;

  -- 016: a new row is backlog in Preview, or while its rule or its register row is waiting for a first scan.
  v_backlog := alert_mode() = 'Preview' or v_rule.baseline_pending;
  if not v_backlog and p_source_table = 'client_compliance_items' then
    v_backlog := exists (select 1 from client_compliance_items i where i.id = p_source_id::uuid and i.baseline_pending);
  end if;

  for attempt in 1..2 loop
    select * into v_a from alerts where dedupe_key = p_key for update;
    if found then exit; end if;

    insert into alerts (rule_code, category, title, subject, description, action_required, client_id, service_id, source_table, source_id,
                        assigned_to, department, priority, trigger_date, due_date, current_step, backlog, dedupe_key)
    values (p_rule, v_rule.category, replace(v_rule.title_template, '{subject}', coalesce(p_subject, '')), p_subject, p_description,
            v_rule.action_template, p_client, p_service, p_source_table, p_source_id,
            p_assigned, coalesce(p_department, v_rule.department), v_prio, v_today, p_due, p_step, v_backlog, p_key)
    on conflict (dedupe_key) do nothing
    returning id into v_id;
    if v_id is not null then
      insert into alert_events (alert_id, event, detail) values (v_id, 'raised', jsonb_build_object('rule', p_rule, 'step', p_step, 'priority', v_prio));
      if p_assigned is not null then perform alert_add_recipient(v_id, p_assigned, 'Assigned'); end if;
      if p_extra is not null then
        foreach v_u in array p_extra loop perform alert_add_recipient(v_id, v_u, 'Assigned'); end loop;
      end if;
      if p_assigned is null then
        for r in select * from alert_managers() loop
          v_fell := v_fell or r.fell_back;
          perform alert_add_recipient(v_id, r.user_id, 'Manager');
        end loop;
        if v_fell then update alerts set fell_back = true where id = v_id; end if;
      end if;
      return v_id;
    end if;
  end loop;
  if v_a.id is null then raise exception 'Could not raise alert %', p_key; end if;

  if v_a.status in ('Resolved', 'Dismissed') then
    if v_a.resolved_by_system then
      update alerts set status = 'Open', subject = p_subject, description = p_description, due_date = p_due, current_step = p_step, priority = v_prio,
             resolution_note = null, resolved_at = null, resolved_by = null, resolved_by_system = false, updated_at = now()
      where id = v_a.id;
      insert into alert_events (alert_id, event, detail) values (v_a.id, 'reopened', jsonb_build_object('step', p_step));
      return v_a.id;
    end if;
    return null;   -- a person closed it: it stays closed
  end if;

  if v_a.current_step is not distinct from p_step then
    update alerts set subject = p_subject, description = p_description, due_date = p_due, updated_at = now() where id = v_a.id;   -- refresh only, no bell
    return v_a.id;
  end if;

  -- Step changed: priority only rises.
  update alerts set
    current_step = p_step,
    subject = p_subject,
    description = p_description,
    due_date = p_due,
    priority = case when array_position(array['Normal', 'Medium', 'High', 'Critical'], v_prio)
                        > array_position(array['Normal', 'Medium', 'High', 'Critical'], v_a.priority) then v_prio else v_a.priority end,
    backlog = case when alert_mode() = 'Preview' then v_a.backlog else false end,
    updated_at = now()
  where id = v_a.id;
  insert into alert_events (alert_id, event, detail) values (v_a.id, 'step changed', jsonb_build_object('from', v_a.current_step, 'to', p_step));
  for r in select user_id, reason from alert_recipients where alert_id = v_a.id loop
    perform alert_bell(v_a.id, r.user_id, r.reason);
  end loop;
  return v_a.id;
end $$;

-- ── The daily scan ───────────────────────────────────────────────────
-- 002's, plus: after a rule ran without error, its flag and the flags of the register rows it saw are cleared.
-- Those updates sit inside the rule's block, so a rule that fails keeps its flags.
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
  v_seen uuid[];
  v_checked int; v_data int; v_raised int; v_closed int;
  v_id uuid;
begin
  if not pg_try_advisory_xact_lock(hashtextextended('alert_scan', 0)) then
    insert into alert_scan_log (finished_at, status, rule_counts) values (now(), 'Skipped', '{}'::jsonb);
    return jsonb_build_object('status', 'Skipped');
  end if;
  insert into alert_scan_log (status) values ('Running') returning id into v_log;

  for v_rule in select * from alert_rules where enabled order by code loop
    v_checked := 0; v_data := 0; v_raised := 0; v_closed := 0; v_keys := '{}'; v_seen := '{}';
    begin
      for v_c in execute format('select * from public.%I()', 'alert_rule_' || v_rule.code) loop
        v_checked := v_checked + 1;
        if v_c.source_table = 'client_compliance_items' then v_seen := v_seen || v_c.source_id::uuid; end if;
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

      update alert_rules set baseline_pending = false where code = v_rule.code and baseline_pending;
      update client_compliance_items set baseline_pending = false where baseline_pending and id = any (v_seen);

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

-- alert_rule_save is 003's, plus: turning a rule on flags it.
create or replace function public.alert_rule_save(p_code text, p_enabled boolean, p_steps jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; v_enabled boolean; v_was boolean; v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  if not alert_is_admin() then raise exception 'You do not have permission to change alert rules.'; end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then raise exception 'Steps must be a list.'; end if;
  for s in select value from jsonb_array_elements(p_steps) loop
    if jsonb_typeof(s) <> 'object' or jsonb_typeof(s->'days') is distinct from 'number' or (s->>'days') !~ '^-?[0-9]+$' then
      raise exception 'Each step needs a whole number of days.';
    end if;
    if jsonb_typeof(s->'priority') is distinct from 'string' or (s->>'priority') not in ('Critical', 'High', 'Medium', 'Normal') then
      raise exception 'Step priority must be Critical, High, Medium or Normal.';
    end if;
  end loop;
  if (select count(*) <> count(distinct e->>'days') from jsonb_array_elements(p_steps) e) then
    raise exception 'Two steps cannot have the same days.';
  end if;
  select enabled, coalesce(p_enabled, enabled) into v_was, v_enabled from alert_rules where code = p_code;
  if not found then raise exception 'That alert rule does not exist.'; end if;
  if v_enabled and jsonb_array_length(p_steps) = 0 then raise exception 'An enabled rule needs at least one step.'; end if;
  update alert_rules set enabled = v_enabled, steps = p_steps,
         baseline_pending = baseline_pending or (v_enabled and not v_was)
  where code = p_code;

  with moved as (
    select a.id, a.current_step as old_step, n.step as new_step
    from alerts a
    cross join lateral alert_step_for(p_steps, a.due_date - v_today) n
    where a.rule_code = p_code and a.status in ('Open', 'In progress') and a.due_date is not null
      and a.current_step is distinct from n.step
  ), upd as (
    update alerts a set current_step = m.new_step, updated_at = now() from moved m where a.id = m.id
  )
  insert into alert_events (alert_id, event, detail)
  select m.id, 'step recomputed', jsonb_build_object('from', m.old_step, 'to', m.new_step, 'by', auth.uid()) from moved m;
end $$;

-- ── Import ───────────────────────────────────────────────────────────
-- 006's, plus: the rows it saves wait for their first scan.
create or replace function public.client_compliance_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_saved int := 0; v_errors jsonb := '[]'::jsonb; v_n int; i int; v_id uuid;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be a JSON array.'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 500 then raise exception 'An import takes at most 500 rows; nothing was saved.'; end if;
  for i in 0 .. v_n - 1 loop
    begin
      v_id := client_compliance_save(p_rows -> i);
      update client_compliance_items set baseline_pending = true where id = v_id;
      v_saved := v_saved + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', i + 1, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('saved', v_saved, 'errors', v_errors);
end $$;

-- ── Save ─────────────────────────────────────────────────────────────
-- 006's, plus: a second Active row with the same client, type, person and expiry is refused.
create or replace function public.client_compliance_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old public.client_compliance_items%rowtype;
  v_client text; v_type text; v_status text; v_person text;
  v_issue date; v_exp date; v_rev date;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'A register entry must be a JSON object.'; end if;

  begin
    v_id := nullif(btrim(p->>'id'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The register id is not valid.';
  end;
  if v_id is not null then
    select * into v_old from client_compliance_items where id = v_id for update;
    if not found then raise exception 'That register entry does not exist.'; end if;
  end if;

  v_client := case when p ? 'client_id' then nullif(btrim(p->>'client_id'), '') else v_old.client_id end;
  v_type := case when p ? 'item_type' then nullif(btrim(p->>'item_type'), '') else v_old.item_type end;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_type is null or not (v_type = any (client_compliance_item_types())) then raise exception 'Unknown item type.'; end if;

  begin
    v_issue := case when p ? 'issue_date' then nullif(btrim(p->>'issue_date'), '')::date else v_old.issue_date end;
    v_exp := case when p ? 'expiry_date' then nullif(btrim(p->>'expiry_date'), '')::date else v_old.expiry_date end;
    v_rev := case when p ? 'next_review_date' then nullif(btrim(p->>'next_review_date'), '')::date else v_old.next_review_date end;
  exception when invalid_datetime_format or datetime_field_overflow or invalid_text_representation then
    raise exception 'Dates must be real dates, written YYYY-MM-DD.';
  end;
  if v_issue is not null and v_exp is not null and v_exp < v_issue then raise exception 'The expiry date is before the issue date.'; end if;

  v_status := case when p ? 'status' then nullif(btrim(p->>'status'), '') else v_old.status end;
  v_status := coalesce(v_status, 'Active');
  if v_status not in ('Active', 'Closed') then raise exception 'Status must be Active or Closed.'; end if;
  if v_status = 'Closed' and v_old.status is distinct from 'Closed' then raise exception 'Use Close to close an entry: it needs a reason.'; end if;

  v_person := case when p ? 'person_name' then nullif(btrim(p->>'person_name'), '') else v_old.person_name end;
  if v_status = 'Active' and exists (
    select 1 from client_compliance_items i
    where i.status = 'Active' and i.client_id = v_client and i.item_type = v_type
      and lower(coalesce(btrim(i.person_name), '')) = lower(coalesce(v_person, ''))
      and i.expiry_date is not distinct from v_exp
      and i.id is distinct from v_id) then
    raise exception 'This entry is already on the register: same client, type, person and expiry date.';
  end if;

  if v_id is null then
    insert into client_compliance_items (client_id, item_type, person_name, reference, issue_date, expiry_date, next_review_date, status, source, notes, created_by, updated_by)
    values (v_client, v_type, nullif(btrim(p->>'person_name'), ''), nullif(btrim(p->>'reference'), ''), v_issue, v_exp, v_rev, v_status,
            nullif(btrim(p->>'source'), ''), nullif(btrim(p->>'notes'), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update client_compliance_items set
      client_id = v_client, item_type = v_type,
      person_name = case when p ? 'person_name' then nullif(btrim(p->>'person_name'), '') else person_name end,
      reference = case when p ? 'reference' then nullif(btrim(p->>'reference'), '') else reference end,
      issue_date = v_issue, expiry_date = v_exp, next_review_date = v_rev, status = v_status,
      source = case when p ? 'source' then nullif(btrim(p->>'source'), '') else source end,
      notes = case when p ? 'notes' then nullif(btrim(p->>'notes'), '') else notes end,
      updated_at = now(), updated_by = auth.uid()
    where id = v_id;
  end if;
  return v_id;
end $$;
