-- Notification Centre, Phase 1: browser actions, escalation, client owners, rule and mode settings.
-- Re-runnable. Rollback: rollback/001_004_rollback.sql.
-- No browser writes to a table: each action is a SECURITY DEFINER function that checks the caller itself.
-- A refusal is one plain sentence.

-- ── Internal helpers (not browser-callable) ──────────────────────────
-- May the caller act on this alert? Admin always. Otherwise the caller must see it (so nobody but admin in Preview)
-- and be a tagged Manager, or, when p_assignee_ok, be the assigned employee.
create or replace function public.alert_can_act(p_id uuid, p_assignee_ok boolean) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    alert_is_admin()
    or (alert_can_see(p_id) and (
      alert_is_manager()
      or (p_assignee_ok and exists (
        select 1 from alerts a
        where a.id = p_id and (a.assigned_to = auth.uid()
          or exists (select 1 from alert_recipients r where r.alert_id = a.id and r.user_id = auth.uid() and r.reason = 'Assigned')))))))
$$;

-- Add every manager as a recipient (reason Manager). A new recipient gets a bell. With p_fresh, a manager who is
-- already a recipient gets a fresh bell too. alert_bell itself drops the bell in Preview, for backlog rows, and
-- for reason Manager in Triage. Records fell_back when the managers came from the admin fallback.
create or replace function public.alert_notify_managers(p_id uuid, p_fresh boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_fell boolean := false; v_n int;
begin
  for r in select * from alert_managers() loop
    v_fell := v_fell or r.fell_back;
    insert into alert_recipients (alert_id, user_id, reason) values (p_id, r.user_id, 'Manager')
    on conflict (alert_id, user_id) do nothing;
    get diagnostics v_n = row_count;
    if v_n = 1 or p_fresh then perform alert_bell(p_id, r.user_id, 'Manager'); end if;
  end loop;
  if v_fell then update alerts set fell_back = true where id = p_id; end if;
end $$;

-- Make p_user the assigned employee: column, recipient (an existing Manager row becomes Assigned), bell, event.
-- A replaced assignee loses their Assigned recipient row (and so the right to act as the assignee); other recipients,
-- including job co-assignees and Manager rows, stay. A bell goes out whenever the assignee actually changes.
create or replace function public.alert_set_assignee(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old uuid;
begin
  select assigned_to into v_old from alerts where id = p_id;
  if v_old is not null and v_old <> p_user then
    delete from alert_recipients where alert_id = p_id and user_id = v_old and reason = 'Assigned';
  end if;
  update alerts set assigned_to = p_user, updated_at = now() where id = p_id;
  insert into alert_recipients (alert_id, user_id, reason) values (p_id, p_user, 'Assigned')
  on conflict (alert_id, user_id) do update set reason = 'Assigned' where alert_recipients.reason <> 'Assigned';
  if v_old is distinct from p_user then perform alert_bell(p_id, p_user, 'Assigned'); end if;
  insert into alert_events (alert_id, event, detail) values (p_id, 'assigned', jsonb_build_object('from', v_old, 'to', p_user));
end $$;

-- ── Alert actions ────────────────────────────────────────────────────
create or replace function public.alert_assign(p_id uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a alerts%rowtype;
begin
  if not alert_can_act(p_id, false) then raise exception 'You do not have permission to assign alerts.'; end if;
  select * into v_a from alerts where id = p_id for update;
  if not found then raise exception 'That alert does not exist.'; end if;
  if v_a.status in ('Resolved', 'Dismissed') then raise exception 'That alert is already closed.'; end if;
  if p_user is null or not exists (select 1 from profiles where id = p_user) then raise exception 'That employee does not exist.'; end if;
  perform alert_set_assignee(p_id, p_user);
end $$;

create or replace function public.alert_set_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a alerts%rowtype;
begin
  if not alert_can_act(p_id, true) then raise exception 'You do not have permission to change this alert.'; end if;
  if p_status is null or p_status not in ('Open', 'In progress') then raise exception 'Status must be Open or In progress.'; end if;
  select * into v_a from alerts where id = p_id for update;
  if not found then raise exception 'That alert does not exist.'; end if;
  if v_a.status in ('Resolved', 'Dismissed') then raise exception 'That alert is already closed.'; end if;
  update alerts set status = p_status, updated_at = now() where id = p_id;
  insert into alert_events (alert_id, event, detail) values (p_id, 'status changed', jsonb_build_object('from', v_a.status, 'to', p_status));
end $$;

create or replace function public.alert_resolve(p_id uuid, p_note text default null, p_dismiss boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a alerts%rowtype; v_note text := nullif(btrim(coalesce(p_note, ''), E' \t\r\n'), ''); v_to text := case when coalesce(p_dismiss, false) then 'Dismissed' else 'Resolved' end;
begin
  if not alert_can_act(p_id, true) then raise exception 'You do not have permission to close this alert.'; end if;
  select * into v_a from alerts where id = p_id for update;
  if not found then raise exception 'That alert does not exist.'; end if;
  if v_a.status in ('Resolved', 'Dismissed') then raise exception 'That alert is already closed.'; end if;
  if v_a.priority = 'Critical' and v_note is null then raise exception 'A Critical alert needs a resolution note.'; end if;
  update alerts set status = v_to, resolved_at = now(), resolved_by = auth.uid(), resolved_by_system = false,
         resolution_note = v_note, updated_at = now()
  where id = p_id;
  insert into alert_events (alert_id, event, detail)
  values (p_id, case when v_to = 'Dismissed' then 'dismissed' else 'resolved' end, jsonb_build_object('by', auth.uid(), 'note', v_note));
end $$;

create or replace function public.alert_escalate(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_a alerts%rowtype; v_reason text := nullif(btrim(coalesce(p_reason, ''), E' \t\r\n'), '');
begin
  if not alert_can_act(p_id, true) then raise exception 'You do not have permission to escalate this alert.'; end if;
  if v_reason is null then raise exception 'An escalation reason is required.'; end if;
  select * into v_a from alerts where id = p_id for update;
  if not found then raise exception 'That alert does not exist.'; end if;
  if v_a.status in ('Resolved', 'Dismissed') then raise exception 'That alert is already closed.'; end if;
  update alerts set escalation_level = escalation_level + 1, escalated_at = now(), updated_at = now() where id = p_id;
  perform alert_notify_managers(p_id, true);
  insert into alert_events (alert_id, event, detail)
  values (p_id, 'escalated', jsonb_build_object('level', v_a.escalation_level + 1, 'reason', v_reason, 'by', auth.uid()));
end $$;

-- Marks the caller's own recipient row read, and their bell for this alert.
create or replace function public.alert_mark_read(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not alert_can_see(p_id) then raise exception 'You do not have permission to read this alert.'; end if;
  update alert_recipients set read_at = now() where alert_id = p_id and user_id = auth.uid() and read_at is null;
  update notifications set read = true
  where user_id = auth.uid() and type = 'alert_centre' and link_scope->>'alert_id' = p_id::text and read is not true;
end $$;

-- ── Escalation, run by alert_scan in Live only ───────────────────────
-- Open and in-progress rows that are not backlog. Today is the Dubai date.
--   3 or more days overdue, level below 2: level 2, fresh bell to every manager.
--   Due date passed, level 0: managers added, level 1.
--   licence_expiry or visa_expiry at step -1, level 0: managers added, level 1.
--   No assigned employee and no Manager recipient yet: managers added.
-- The employee is never removed. A second run changes nothing. Returns the number of alerts changed; 0 outside Live.
create or replace function public.alert_escalate_due() returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := (now() at time zone 'Asia/Dubai')::date;
  a record;
  v_over int; v_level int; v_why text; v_changed boolean; v_n int := 0;
begin
  if alert_mode() <> 'Live' then return 0; end if;
  for a in select * from alerts where status in ('Open', 'In progress') and not backlog order by created_at, id loop
    v_changed := false;
    v_over := case when a.due_date is not null then v_today - a.due_date end;
    v_level := a.escalation_level;
    if v_over >= 3 and a.escalation_level < 2 then
      perform alert_notify_managers(a.id, true); v_level := 2; v_why := '3 or more days overdue';
    elsif v_over >= 1 and a.escalation_level = 0 then
      perform alert_notify_managers(a.id, false); v_level := 1; v_why := 'overdue';
    elsif a.rule_code in ('licence_expiry', 'visa_expiry') and a.current_step = -1 and a.escalation_level = 0 then
      perform alert_notify_managers(a.id, false); v_level := 1; v_why := 'critical expiry';
    end if;
    if v_level <> a.escalation_level then
      update alerts set escalation_level = v_level, escalated_at = now(), updated_at = now() where id = a.id;
      insert into alert_events (alert_id, event, detail)
      values (a.id, 'escalated', jsonb_build_object('level', v_level, 'reason', v_why, 'by', 'system'));
      v_changed := true;
    end if;
    if a.assigned_to is null and not exists (select 1 from alert_recipients r where r.alert_id = a.id and r.reason = 'Manager') then
      perform alert_notify_managers(a.id, false);
      insert into alert_events (alert_id, event, detail) values (a.id, 'managers added', jsonb_build_object('reason', 'unassigned', 'by', 'system'));
      v_changed := true;
    end if;
    if v_changed then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- ── Client owners ────────────────────────────────────────────────────
-- One row per client for the chosen department, ordered by client_id; owner null when none is set.
create or replace function public.client_owner_list(p_department text)
returns table (client_id text, legal_name text, client_status text, jurisdiction text, department text, owner_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not (alert_is_admin() or alert_is_manager()) then raise exception 'You do not have permission to see client owners.'; end if;
  if p_department is null then raise exception 'Choose a department.'; end if;
  if not exists (select 1 from service_departments where name = p_department) then raise exception 'That department does not exist.'; end if;
  return query
    select m.client_id, m.legal_name, k.client_status, k.jurisdiction, p_department, o.owner_id
    from client_master m
    left join business_setup_kyc_profiles k on k.client_id = m.client_id
    left join client_owners o on o.client_id = m.client_id and o.department = p_department
    order by m.client_id;
end $$;

-- Suggestions for a person to confirm. Reads only. Clients that already have an owner in the department are left out.
-- Accounting: the most frequent employee in accounting_job_list.assignee_ids (a tie goes to the lower id), otherwise
-- client_master.data->>'Accountant' matched exactly (trimmed, any case) to one profile's full_name. A name shared by
-- two profiles proposes nobody. Other departments have no proposal source yet.
create or replace function public.client_owner_proposals(p_department text)
returns table (client_id text, owner_id uuid, basis text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  if not (alert_is_admin() or alert_is_manager()) then raise exception 'You do not have permission to see client owners.'; end if;
  if p_department is distinct from 'Accounting' then return; end if;
  return query
    with jobs as (
      select j.client_id as cid, u.uid, count(*) as n
      from accounting_job_list j
      cross join lateral unnest(j.assignee_ids) as u(uid)
      join profiles p on p.id = u.uid
      where j.client_id is not null
      group by j.client_id, u.uid
    ), best as (
      select distinct on (cid) cid, uid from jobs order by cid, n desc, uid::text
    ), named as (
      select m.client_id as cid, (array_agg(p.id))[1] as uid
      from client_master m
      join profiles p on lower(btrim(p.full_name)) = lower(btrim(m.data->>'Accountant'))
      where btrim(coalesce(m.data->>'Accountant', '')) <> ''
      group by m.client_id
      having count(*) = 1
    )
    select m.client_id, coalesce(b.uid, n.uid),
           case when b.uid is not null then 'Most frequent job assignee' else 'Accountant text matched to a staff name' end
    from client_master m
    left join best b on b.cid = m.client_id
    left join named n on n.cid = m.client_id
    where coalesce(b.uid, n.uid) is not null
      and not exists (select 1 from client_owners o where o.client_id = m.client_id and o.department = p_department)
    order by m.client_id;
end $$;

-- Sets (or changes) the owner for the clients in one department. That department's open alerts for those clients
-- go to the new owner when they are unassigned or with the previous owner. Alerts with anyone else, closed alerts
-- and other departments stay as they are. Bells follow alert_set_assignee, so a backlog row stays silent.
-- Unknown client ids are ignored. Returns the number of clients set.
create or replace function public.client_owners_set(p_department text, p_clients text[], p_owner uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int; v_ids uuid[]; v_id uuid;
begin
  if not (alert_is_admin() or alert_is_manager()) then raise exception 'You do not have permission to set client owners.'; end if;
  if p_department is null or not exists (select 1 from service_departments where name = p_department) then raise exception 'That department does not exist.'; end if;
  if p_owner is null or not exists (select 1 from profiles where id = p_owner) then raise exception 'That owner does not exist.'; end if;
  -- Read before the owners change: this is the only moment the previous owner is known.
  select coalesce(array_agg(a.id order by a.created_at, a.id), '{}') into v_ids
  from alerts a
  left join client_owners o on o.client_id = a.client_id and o.department = a.department
  where a.client_id = any (coalesce(p_clients, '{}'::text[])) and a.department = p_department
    and a.status in ('Open', 'In progress')
    and (a.assigned_to is null or (a.assigned_to = o.owner_id and a.assigned_to <> p_owner));
  with ins as (
    insert into client_owners (client_id, department, owner_id, assigned_by)
    select distinct m.client_id, p_department, p_owner, auth.uid()
    from client_master m where m.client_id = any (coalesce(p_clients, '{}'::text[]))
    on conflict (client_id, department) do update
      set owner_id = excluded.owner_id, assigned_at = now(), assigned_by = excluded.assigned_by
    returning 1
  ) select count(*) into v_n from ins;
  foreach v_id in array v_ids loop
    perform alert_set_assignee(v_id, p_owner);
  end loop;
  return v_n;
end $$;

-- ── Settings, admin only ─────────────────────────────────────────────
-- Saving steps moves that rule's open alerts to the step their due date now falls in, without a bell and without
-- touching backlog, so the next scan sees no crossing. An alert outside the new steps keeps its step; the scan closes it.
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

create or replace function public.alert_set_mode(p_mode text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not alert_is_admin() then raise exception 'You do not have permission to change the alert mode.'; end if;
  if p_mode is null or p_mode not in ('Preview', 'Triage', 'Live') then raise exception 'Mode must be Preview, Triage or Live.'; end if;
  insert into alert_settings (key, value) values ('alert_mode', to_jsonb(p_mode))
  on conflict (key) do update set value = excluded.value;
end $$;

-- The Settings tab's "Run now". alert_scan is not granted to the browser; this wrapper runs it as its owner.
create or replace function public.alert_scan_now() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not alert_is_admin() then raise exception 'You do not have permission to run the alert scan.'; end if;
  return alert_scan();
end $$;

-- ── Access ───────────────────────────────────────────────────────────
revoke execute on function
  public.alert_can_act(uuid, boolean), public.alert_notify_managers(uuid, boolean), public.alert_set_assignee(uuid, uuid),
  public.alert_assign(uuid, uuid), public.alert_set_status(uuid, text), public.alert_resolve(uuid, text, boolean),
  public.alert_escalate(uuid, text), public.alert_mark_read(uuid), public.alert_escalate_due(),
  public.client_owner_list(text), public.client_owner_proposals(text), public.client_owners_set(text, text[], uuid),
  public.alert_rule_save(text, boolean, jsonb), public.alert_set_mode(text), public.alert_scan_now()
  from public, anon, authenticated;
-- Each of these checks the caller inside.
grant execute on function
  public.alert_assign(uuid, uuid), public.alert_set_status(uuid, text), public.alert_resolve(uuid, text, boolean),
  public.alert_escalate(uuid, text), public.alert_mark_read(uuid),
  public.client_owner_list(text), public.client_owner_proposals(text), public.client_owners_set(text, text[], uuid),
  public.alert_rule_save(text, boolean, jsonb), public.alert_set_mode(text), public.alert_scan_now()
  to authenticated;
-- The scan runs as postgres (cron) or service_role.
grant execute on function public.alert_escalate_due() to service_role;
