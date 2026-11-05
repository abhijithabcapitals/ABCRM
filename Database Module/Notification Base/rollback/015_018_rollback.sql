-- Removes the review fixes and restores each function body exactly as it stood before 015. Safe to run twice. Runs before rollback/014_rollback.sql.

-- ── 017: I2, I3, I4 ──
create or replace function public.regulatory_insert(p jsonb, p_source text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_title text := nullif(btrim(p->>'title'), '');
begin
  if v_title is null then raise exception 'A title is required.'; end if;
  insert into regulatory_updates (title, category, issuing_authority, document_number, publication_date, issue_date, effective_date, official_url, summary,
                                  legal_status, evidence_level, source, created_by)
  values (v_title, p->>'category', nullif(btrim(p->>'issuing_authority'), ''), nullif(btrim(p->>'document_number'), ''),
          nullif(p->>'publication_date', '')::date, nullif(p->>'issue_date', '')::date, nullif(p->>'effective_date', '')::date,
          nullif(btrim(p->>'official_url'), ''), nullif(btrim(p->>'summary'), ''),
          coalesce(nullif(p->>'legal_status', ''), 'UNVERIFIED'), coalesce(nullif(p->>'evidence_level', ''), 'E4'), p_source, auth.uid())
  returning id into v_id;
  perform alert_raise('regulatory_new', 'regulatory:new:' || v_id, null, v_title, null, nullif(p->>'effective_date', '')::date, 0, 'Medium', null, 'regulatory_updates', v_id::text);
  update alerts set regulatory_update_id = v_id where dedupe_key = 'regulatory:new:' || v_id;
  return v_id;
end $$;
create or replace function public.regulatory_update_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_status text;
begin
  perform regulatory_require_manage();
  if v_id is null then return regulatory_insert(p, 'Manual'); end if;
  select workflow_status into v_status from regulatory_updates where id = v_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_status in ('Verified', 'Tasks created', 'Closed') then raise exception 'A verified update cannot be changed.'; end if;
  update regulatory_updates set
    title = coalesce(nullif(btrim(p->>'title'), ''), title), category = coalesce(p->>'category', category),
    issuing_authority = case when p ? 'issuing_authority' then nullif(btrim(p->>'issuing_authority'), '') else issuing_authority end,
    document_number = case when p ? 'document_number' then nullif(btrim(p->>'document_number'), '') else document_number end,
    publication_date = case when p ? 'publication_date' then nullif(p->>'publication_date', '')::date else publication_date end,
    issue_date = case when p ? 'issue_date' then nullif(p->>'issue_date', '')::date else issue_date end,
    effective_date = case when p ? 'effective_date' then nullif(p->>'effective_date', '')::date else effective_date end,
    official_url = case when p ? 'official_url' then nullif(btrim(p->>'official_url'), '') else official_url end,
    summary = case when p ? 'summary' then nullif(btrim(p->>'summary'), '') else summary end,
    legal_status = coalesce(nullif(p->>'legal_status', ''), legal_status), evidence_level = coalesce(nullif(p->>'evidence_level', ''), evidence_level),
    applicability = case when p ? 'applicability' then p->'applicability' else applicability end,
    updated_at = now()
  where id = v_id;
  return v_id;
end $$;
create or replace function public.regulatory_propose_list(p_id uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype; v_a jsonb; v_all boolean; v_j jsonb; v_s jsonb; v_v jsonb; v_n int;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status not in ('Under review', 'List proposed') then raise exception 'Start the review first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  v_a := v_u.applicability; v_all := coalesce((v_a->>'all_clients')::boolean, false);
  v_j := nullif(v_a->'jurisdictions', '[]'::jsonb); v_s := nullif(v_a->'statuses', '[]'::jsonb); v_v := v_a->'has_visa';
  if not v_all and v_j is null and v_s is null and v_v is null then raise exception 'Set who this applies to first.'; end if;

  delete from regulatory_update_clients where update_id = p_id;
  insert into regulatory_update_clients (update_id, client_id, match_reason, decision)
  select p_id, c.client_id,
         case when c.incomplete then 'Profile incomplete: check by hand' when v_all then 'All clients' else 'Matches the applicability set' end,
         case when c.incomplete then 'Check' else 'Applies' end
  from (
    select m.client_id, k.client_status,
           (k.client_id is null or (v_j is not null and nullif(btrim(k.jurisdiction), '') is null)) as incomplete,
           (v_j is null or k.client_id is null or nullif(btrim(k.jurisdiction), '') is null or v_j ? k.jurisdiction) as j_ok,
           (v_s is null or k.client_id is null or v_s ? coalesce(k.client_status, '')) as s_ok,
           (v_v is null or v_v = 'null'::jsonb or k.client_id is null
              or (v_v::text::boolean = exists (select 1 from business_setup_visas x where x.client_id = m.client_id))) as v_ok
    from client_master m left join business_setup_kyc_profiles k on k.client_id = m.client_id
    where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
  ) c
  where c.j_ok and c.s_ok and c.v_ok;
  get diagnostics v_n = row_count;
  update regulatory_updates set workflow_status = 'List proposed', updated_at = now() where id = p_id;
  return v_n;
end $$;
create or replace function public.regulatory_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_u regulatory_updates%rowtype;
begin
  perform regulatory_require_manage();
  select * into v_u from regulatory_updates where id = p_id for update;
  if not found then raise exception 'That update does not exist.'; end if;
  if v_u.workflow_status <> 'List proposed' then raise exception 'Propose the client list first.'; end if;
  if v_u.effective_date is null then raise exception 'Confirm the effective date first.'; end if;
  if nullif(btrim(v_u.official_url), '') is null then raise exception 'Add the official source first.'; end if;
  if v_u.evidence_level = 'E4' then raise exception 'A third-party source stays information only. Find the official document first.'; end if;
  if v_u.legal_status in ('PROPOSED', 'UNDER CONSULTATION', 'UNVERIFIED') then raise exception 'This status is not yet law, so it stays information only.'; end if;
  if exists (select 1 from regulatory_update_clients where update_id = p_id and decision = 'Check') then raise exception 'Decide every client marked Check first.'; end if;
  update regulatory_updates set workflow_status = 'Verified', verified_by = auth.uid(), verified_at = now(), updated_at = now() where id = p_id;

  with closed as (
    update alerts set status = 'Resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'Update verified by a manager.', updated_at = now()
    where dedupe_key = 'regulatory:new:' || p_id and status in ('Open', 'In progress')
    returning id
  )
  insert into alert_events (alert_id, event, detail, created_by)
  select id, 'resolved', jsonb_build_object('note', 'Update verified by a manager.'), auth.uid() from closed;
end $$;

-- ── 016: I1 ──
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
begin
  select * into v_rule from alert_rules where code = p_rule;
  if not found then raise exception 'Alert rule % does not exist', p_rule; end if;

  for attempt in 1..2 loop
    select * into v_a from alerts where dedupe_key = p_key for update;
    if found then exit; end if;

    insert into alerts (rule_code, category, title, subject, description, action_required, client_id, service_id, source_table, source_id,
                        assigned_to, department, priority, trigger_date, due_date, current_step, backlog, dedupe_key)
    values (p_rule, v_rule.category, replace(v_rule.title_template, '{subject}', coalesce(p_subject, '')), p_subject, p_description,
            v_rule.action_template, p_client, p_service, p_source_table, p_source_id,
            p_assigned, coalesce(p_department, v_rule.department), v_prio, v_today, p_due, p_step, alert_mode() = 'Preview', p_key)
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
create or replace function public.alert_rule_save(p_code text, p_enabled boolean, p_steps jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s jsonb; v_enabled boolean; v_today date := (now() at time zone 'Asia/Dubai')::date;
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
  select coalesce(p_enabled, enabled) into v_enabled from alert_rules where code = p_code;
  if not found then raise exception 'That alert rule does not exist.'; end if;
  if v_enabled and jsonb_array_length(p_steps) = 0 then raise exception 'An enabled rule needs at least one step.'; end if;
  update alert_rules set enabled = v_enabled, steps = p_steps where code = p_code;

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
create or replace function public.client_compliance_import(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_saved int := 0; v_errors jsonb := '[]'::jsonb; v_n int; i int;
begin
  if not client_compliance_can_write() then raise exception 'You do not have permission to change the compliance register.'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'Import rows must be a JSON array.'; end if;
  v_n := jsonb_array_length(p_rows);
  if v_n > 500 then raise exception 'An import takes at most 500 rows; nothing was saved.'; end if;
  for i in 0 .. v_n - 1 loop
    begin
      perform client_compliance_save(p_rows -> i);
      v_saved := v_saved + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_object('row', i + 1, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('saved', v_saved, 'errors', v_errors);
end $$;
create or replace function public.client_compliance_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_old public.client_compliance_items%rowtype;
  v_client text; v_type text; v_status text;
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
alter table public.alert_rules drop column if exists baseline_pending;
alter table public.client_compliance_items drop column if exists baseline_pending;

-- ── 015: C1 ──
create or replace function public.client_contact_log(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_on date; v_follow date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a contact.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  begin
    v_on := coalesce(nullif(p->>'contacted_on', '')::date, (now() at time zone 'Asia/Dubai')::date);
    v_follow := nullif(p->>'follow_up_on', '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  if v_follow is not null and v_follow < v_on then raise exception 'The follow-up date is before the contact date.'; end if;
  insert into client_contacts (client_id, channel, note, contacted_on, follow_up_on, created_by)
  values (v_client, coalesce(nullif(p->>'channel', ''), 'Other'), nullif(btrim(p->>'note'), ''), v_on, v_follow, auth.uid())
  returning id into v_id;
  return v_id;
end $$;
create or replace function public.client_document_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_what text := nullif(btrim(p->>'what'), ''); v_due date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a request.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_what is null then raise exception 'Say which documents were requested.'; end if;
  begin
    v_due := coalesce(nullif(p->>'due_on', '')::date, (now() at time zone 'Asia/Dubai')::date + 7);
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  insert into client_document_requests (client_id, what, due_on, created_by) values (v_client, v_what, v_due, auth.uid()) returning id into v_id;
  return v_id;
end $$;
create or replace function public.client_document_answered(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to update a request.'; end if;
  update client_document_requests set status = 'Answered', answered_on = (now() at time zone 'Asia/Dubai')::date, note = nullif(btrim(p_note), '')
  where id = p_id and status = 'Open';
  if not found then raise exception 'That request is not open.'; end if;
end $$;
create or replace function public.client_work_list(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'contacts', coalesce((select jsonb_agg(x) from (select c.id, c.channel, c.note, c.contacted_on, c.follow_up_on, p.full_name as by_name from client_contacts c left join profiles p on p.id = c.created_by
                          where c.client_id = p_client order by c.contacted_on desc, c.created_at desc limit 20) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(x) from (select r.id, r.what, r.requested_on, r.due_on, r.status from client_document_requests r
                          where r.client_id = p_client and r.status = 'Open' order by r.due_on limit 20) x), '[]'::jsonb));
end $$;
create or replace function public.alert_manual_raise(p_type text, p_client text, p_detail text default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t jsonb; v_name text; v_dept text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log an item.'; end if;
  select e into v_t from jsonb_array_elements(alert_manual_types()) e where e->>'type' = p_type;
  if v_t is null then raise exception 'Unknown item type.'; end if;
  select legal_name into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Unknown client.'; end if;
  select department into v_dept from alert_rules where code = v_t->>'rule';
  v_id := alert_raise(v_t->>'rule', 'manual:' || gen_random_uuid(), p_client, p_type || ' - ' || v_name, v_dept,
                      coalesce(p_due, (now() at time zone 'Asia/Dubai')::date + 7), 0, v_t->>'priority',
                      coalesce(alert_owner(p_client, v_dept), auth.uid()), 'client_master', p_client, null, nullif(btrim(p_detail), ''));
  return v_id;
end $$;
drop function if exists public.client_work_can(text);
