-- Notification Centre, Phase 1: alert core.
-- Tables, the manager rule, visibility and the one function that raises an alert.
-- Re-runnable. Rollback: rollback/001_004_rollback.sql.
-- No browser writes: every write goes through a SECURITY DEFINER function.

-- ── Settings ─────────────────────────────────────────────────────────
create table if not exists public.alert_settings (
  key text primary key,
  value jsonb not null
);
insert into public.alert_settings (key, value) values ('alert_mode', '"Preview"')
on conflict (key) do nothing;   -- a changed mode survives a reapply

-- ── Rules ────────────────────────────────────────────────────────────
create table if not exists public.alert_rules (
  code text primary key,
  category text not null,
  department text,
  title_template text not null,
  action_template text,
  steps jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  source_note text
);

-- ── Responsible employee per client and department ───────────────────
create table if not exists public.client_owners (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master (client_id),
  department text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  unique (client_id, department)
);

-- ── Alerts: one row per matter ───────────────────────────────────────
create sequence if not exists public.alert_number_seq;
create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  alert_number text not null unique default ('ALT-' || lpad(nextval('public.alert_number_seq')::text, 6, '0')),
  rule_code text references public.alert_rules (code),
  category text,
  title text not null,
  subject text,
  description text,
  action_required text,
  client_id text,                                   -- nullable: some accounting jobs have no client link
  service_id uuid,
  case_id uuid,
  source_table text,
  source_id text,
  assigned_to uuid references public.profiles (id) on delete set null,
  department text,
  priority text not null default 'Normal' check (priority in ('Critical', 'High', 'Medium', 'Normal')),
  trigger_date date,
  due_date date,
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved', 'Dismissed')),
  escalation_level int not null default 0,
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_by_system boolean not null default false,
  resolution_note text,
  dedupe_key text not null,
  current_step int,
  backlog boolean not null default false,
  fell_back boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists alerts_dedupe_key_uidx on public.alerts (dedupe_key);   -- across all statuses
create index if not exists alerts_status_idx on public.alerts (status, priority);
create index if not exists alerts_client_idx on public.alerts (client_id);

create table if not exists public.alert_recipients (
  alert_id uuid not null references public.alerts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  reason text not null check (reason in ('Assigned', 'Manager')),
  read_at timestamptz,
  primary key (alert_id, user_id)
);

-- Append-only history. No foreign keys, so nothing cascades into it.
create table if not exists public.alert_events (
  id bigint generated always as identity primary key,
  alert_id uuid not null,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists alert_events_alert_idx on public.alert_events (alert_id, created_at);
create or replace function public.alert_events_append_only() returns trigger
language plpgsql as $$ begin raise exception 'alert_events is append-only'; end $$;
drop trigger if exists alert_events_no_change on public.alert_events;
create trigger alert_events_no_change before update or delete on public.alert_events
  for each row execute function public.alert_events_append_only();

create table if not exists public.alert_scan_log (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text,
  rule_counts jsonb,
  error text
);

-- ── Helpers ──────────────────────────────────────────────────────────
-- Anything other than Triage or Live reads as Preview, so a bad value never sends a bell.
create or replace function public.alert_mode() returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select v from (select value #>> '{}' as v from alert_settings where key = 'alert_mode') s where v in ('Preview', 'Triage', 'Live')), 'Preview')
$$;

create or replace function public.alert_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(admin_is(), false)
$$;

-- The tag, read live: data role MANAGER, or an Active HR employee whose designation is Manager (the rule in hub_is_admin()).
-- No admin shortcut and no fallback.
create or replace function public.alert_is_manager() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    exists (select 1 from banking_user_roles where user_id = auth.uid() and role = 'MANAGER')
    or exists (select 1 from hr_employees where profile_id = auth.uid() and status = 'Active' and designation ilike 'manager'))
$$;

-- All manager lookups go through here. Nobody tagged returns the CRM admins and says so.
create or replace function public.alert_managers() returns table (user_id uuid, fell_back boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query
    select p.id, false
    from profiles p
    where exists (select 1 from banking_user_roles b where b.user_id = p.id and b.role = 'MANAGER')
       or exists (select 1 from hr_employees h where h.profile_id = p.id and h.status = 'Active' and h.designation ilike 'manager');
  if found then return; end if;
  return query select p.id, true from profiles p where p.role = 'admin';
end $$;

create or replace function public.alert_owner(p_client text, p_department text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select owner_id from client_owners where client_id = p_client and department = p_department
$$;

-- Admin always. In Preview nobody else. Otherwise a recipient or a tagged Manager.
create or replace function public.alert_can_see(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and (
    alert_is_admin()
    or (alert_mode() <> 'Preview' and (
      exists (select 1 from alert_recipients r where r.alert_id = p_id and r.user_id = auth.uid())
      or alert_is_manager())))
$$;

-- One bell row, only when the mode and the alert allow it:
-- never in Preview, never for a backlog row, in Triage only for reason Assigned.
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

create or replace function public.alert_add_recipient(p_id uuid, p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_user is null then return; end if;
  insert into alert_recipients (alert_id, user_id, reason) values (p_id, p_user, p_reason)
  on conflict (alert_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  if v_n = 1 then perform alert_bell(p_id, p_user, p_reason); end if;
end $$;

-- ── Raise ────────────────────────────────────────────────────────────
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
      update alerts set status = 'Open', resolved_at = null, resolved_by = null, resolved_by_system = false, updated_at = now() where id = v_a.id;
      insert into alert_events (alert_id, event, detail) values (v_a.id, 'reopened', jsonb_build_object('step', p_step));
      return v_a.id;
    end if;
    return null;   -- a person closed it: it stays closed
  end if;

  if v_a.current_step is not distinct from p_step then
    update alerts set subject = p_subject, due_date = p_due, updated_at = now() where id = v_a.id;   -- refresh only, no bell
    return v_a.id;
  end if;

  -- Step changed: priority only rises.
  update alerts set
    current_step = p_step,
    subject = p_subject,
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

-- ── Access ───────────────────────────────────────────────────────────
alter table public.alert_settings enable row level security;
alter table public.alert_rules enable row level security;
alter table public.client_owners enable row level security;
alter table public.alerts enable row level security;
alter table public.alert_recipients enable row level security;
alter table public.alert_events enable row level security;
alter table public.alert_scan_log enable row level security;

revoke all on public.alert_settings, public.alert_rules, public.client_owners, public.alerts, public.alert_recipients,
  public.alert_events, public.alert_scan_log from anon, authenticated;
revoke all on sequence public.alert_number_seq from anon, authenticated;

drop policy if exists alerts_select on public.alerts;
create policy alerts_select on public.alerts for select to authenticated using (public.alert_can_see(id));
grant select on public.alerts to authenticated;

drop policy if exists client_owners_select on public.client_owners;
create policy client_owners_select on public.client_owners for select to authenticated using (public.alert_is_admin() or public.alert_is_manager());
grant select on public.client_owners to authenticated;

revoke execute on function
  public.alert_mode(), public.alert_is_admin(), public.alert_is_manager(), public.alert_managers(), public.alert_owner(text, text),
  public.alert_can_see(uuid), public.alert_bell(uuid, uuid, text), public.alert_add_recipient(uuid, uuid, text),
  public.alert_raise(text, text, text, text, text, date, int, text, uuid, text, text, uuid, text, uuid[]), public.alert_events_append_only()
  from public, anon, authenticated;
-- Only what the browser needs to evaluate its own row policies.
grant execute on function public.alert_is_admin(), public.alert_is_manager(), public.alert_can_see(uuid) to authenticated;
