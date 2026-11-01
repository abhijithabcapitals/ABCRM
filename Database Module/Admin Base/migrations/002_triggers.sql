-- =====================================================================
-- Admin Base - triggers                                            002
-- =====================================================================
-- Admin-made timers that run one task from a fixed catalogue. One pg_cron job, admin-trigger-dispatcher, checks every
-- minute for what is due, so a one-off date needs no cron entry and cron's UTC never reaches the admin: schedules are
-- stored and calculated in Dubai time. Tasks are a fixed list in this file; no caller can supply SQL or a URL.
-- Tables have no client access. Everything goes through the admin_trigger_* functions, which require a CRM admin.
-- Run after 001_admin_panel.sql. Idempotent.
-- =====================================================================
create table if not exists public.admin_triggers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  task_key text not null,
  kind text not null check (kind in ('once', 'interval', 'daily', 'weekly', 'monthly')),
  run_at timestamptz,
  every_minutes integer,
  at_time time,
  weekdays integer[],
  month_day integer,
  active boolean not null default true,
  next_run_at timestamptz,
  finished_at timestamptz,
  last_run_at timestamptz,
  last_status text,
  last_detail text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists admin_triggers_due on public.admin_triggers (next_run_at) where active;

create table if not exists public.admin_trigger_runs (
  id bigint generated always as identity primary key,
  trigger_id uuid not null references public.admin_triggers(id) on delete cascade,
  task_key text not null,
  source text not null check (source in ('schedule', 'manual')),
  started_by uuid,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  detail text,
  net_request_id bigint
);
create index if not exists admin_trigger_runs_trigger on public.admin_trigger_runs (trigger_id, started_at desc);
create index if not exists admin_trigger_runs_open on public.admin_trigger_runs (started_at) where status = 'running';

alter table public.admin_triggers enable row level security;
alter table public.admin_trigger_runs enable row level security;
revoke all on public.admin_triggers, public.admin_trigger_runs from public, anon, authenticated;

-- What can be scheduled. An entry with "unavailable" is shown to the admin with its reason and refused by the server.
create or replace function public.admin_trigger_catalogue() returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select $json$[
    {"key": "mail_sync", "label": "Sync mail", "group": "Email", "ai_spend": true,
     "description": "Fetches new mail for the connected mailboxes into Email Base and summarises new threads.",
     "warning": "Spends OpenRouter credit on summaries. The email-base-sync job already does this every 2 minutes, so an extra run mainly helps when that job is paused."},
    {"key": "email_agent", "label": "Run Email Agent", "group": "Email", "ai_spend": true,
     "description": "Checks stored mail for insights and digests.",
     "warning": "Spends OpenRouter credit. The email-agent-run job already does this every 10 minutes, so an extra run mainly helps when that job is paused."},
    {"key": "date_automations", "label": "Run date-based automations", "group": "Tasks", "ai_spend": false, "at_most_daily": true,
     "description": "Runs task automations that fire on a date or repeat every few days.",
     "warning": "A date-based rule fires again each time this runs on the same day, repeating its actions. The abcap-date-automations job already runs this daily at 10:00 AM, so pause that job first unless a repeat is intended."},
    {"key": "purge_notifications", "label": "Delete old read notifications", "group": "Housekeeping", "ai_spend": false,
     "description": "Deletes read notifications older than 30 days. Permanent. The purge-old-notifications job already does this daily at 7:00 AM."},
    {"key": "hr_sync", "label": "Sync HR data", "group": "HR",
     "unavailable": "No HR sync exists yet. The HR Module is still a design, and employees are added by hand or by Excel in the Employees tab."},
    {"key": "server_sync", "label": "Sync servers", "group": "Servers",
     "unavailable": "The CRM has no server sync. It needs a definition of which servers and what data before it can be built."},
    {"key": "automation_emails", "label": "Send automation emails", "group": "Tasks",
     "unavailable": "The send-automation-emails Edge Function is not deployed, and its job is not scheduled."},
    {"key": "bd_lead_sync", "label": "Sync BD leads", "group": "Business Development",
     "unavailable": "The bd-lead-sources function only accepts a signed-in member, so a timer cannot call it yet."},
    {"key": "documents_refresh", "label": "Refresh accounting documents", "group": "Accounting",
     "unavailable": "This reads a file list uploaded by the scanner on the office PC, so a timer here would only re-read the old list."}
  ]$json$::jsonb
$$;

create or replace function public.admin_trigger_task(p_key text) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select e from jsonb_array_elements(public.admin_trigger_catalogue()) e where e->>'key' = p_key
$$;

-- The first run after p_after. Local days and times are Dubai's; a month without p_month_day runs on its last day.
create or replace function public.admin_trigger_next(p_kind text, p_run_at timestamptz, p_every integer, p_time time, p_weekdays integer[], p_month_day integer, p_after timestamptz)
returns timestamptz language plpgsql stable set search_path = public, pg_temp as $$
declare
  d date := (p_after at time zone 'Asia/Dubai')::date;
  cand timestamptz;
begin
  if p_kind = 'once' then
    return case when p_run_at > p_after then p_run_at end;
  elsif p_kind = 'interval' then
    return to_timestamp((floor(extract(epoch from p_after) / (p_every * 60)) + 1) * (p_every * 60));
  end if;
  for i in 0..62 loop
    if p_kind = 'daily'
       or (p_kind = 'weekly' and extract(isodow from d + i)::int = any (p_weekdays))
       or (p_kind = 'monthly' and extract(day from d + i)::int = least(p_month_day, extract(day from date_trunc('month', (d + i)::timestamp) + interval '1 month - 1 day')::int)) then
      cand := ((d + i) + p_time) at time zone 'Asia/Dubai';
      if cand > p_after then return cand; end if;
    end if;
  end loop;
  return null;
end $$;

-- Calls an Edge Function the way the existing cron jobs do. The secret stays in Vault and is never stored on a run.
create or replace function public.admin_trigger_post(p_function text, p_header text, p_secret text, p_body jsonb) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare
  secret text;
  request bigint;
begin
  select decrypted_secret into secret from vault.decrypted_secrets where name = p_secret;
  if secret is null then raise exception 'The Vault secret % is missing', p_secret; end if;
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/' || p_function,
    headers := jsonb_build_object('Content-Type', 'application/json', p_header, secret),
    body := p_body,
    timeout_milliseconds := 150000
  ) into request;
  return request;
end $$;

-- Runs one trigger's task and records it. A failure is recorded here and never reaches the caller.
create or replace function public.admin_trigger_start(p_id uuid, p_source text, p_by uuid) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare
  t admin_triggers;
  run bigint;
  request bigint;
  purged bigint;
  outcome text := 'succeeded';
  note text;
begin
  select * into strict t from admin_triggers where id = p_id;
  insert into admin_trigger_runs (trigger_id, task_key, source, started_by) values (t.id, t.task_key, p_source, p_by) returning id into run;
  begin
    case t.task_key
      when 'mail_sync' then request := admin_trigger_post('ceo-mail-sync', 'x-sync-secret', 'email_base_sync_secret', '{}'::jsonb);
      when 'email_agent' then request := admin_trigger_post('email-agent', 'x-agent-secret', 'email_agent_secret', '{"action":"run"}'::jsonb);
      when 'date_automations' then perform run_date_based_automations();
      when 'purge_notifications' then
        delete from notifications where read = true and created_at < now() - interval '30 days';
        get diagnostics purged = row_count;
        note := format('Deleted %s notification(s)', purged);
      else raise exception 'This task cannot run: %', t.task_key;
    end case;
    if request is not null then outcome := 'running'; note := 'Waiting for the function to answer'; end if;
  exception when others then
    outcome := 'failed';
    note := left(sqlerrm, 500);
    request := null;
  end;
  update admin_trigger_runs set status = outcome, detail = note, net_request_id = request, finished_at = case when outcome = 'running' then null else now() end where id = run;
  update admin_triggers set last_run_at = now(), last_status = outcome, last_detail = note where id = t.id;
  return run;
end $$;

-- Edge Functions answer later, so their results are collected from pg_net afterwards.
create or replace function public.admin_trigger_reconcile() returns void
language plpgsql set search_path = public, pg_temp as $$
declare
  r record;
  outcome text;
  note text;
begin
  for r in
    select run.id, run.trigger_id, run.started_at, run.net_request_id, res.id as response_id, res.status_code, res.timed_out, res.error_msg, res.content
      from admin_trigger_runs run
      left join net._http_response res on res.id = run.net_request_id
     where run.status = 'running'
     for update of run skip locked
  loop
    if r.response_id is null then
      if r.started_at > now() - interval '10 minutes' then continue; end if;
      outcome := 'failed'; note := 'No answer recorded from the function within 10 minutes';
    elsif coalesce(r.timed_out, false) or r.status_code is null or r.status_code >= 400 then
      outcome := 'failed'; note := left(concat_ws(': ', 'HTTP ' || r.status_code, coalesce(r.error_msg, r.content)), 500);
    else
      outcome := 'succeeded'; note := 'HTTP ' || r.status_code;
    end if;
    update admin_trigger_runs set status = outcome, detail = note, finished_at = now() where id = r.id;
    update admin_triggers t set last_status = outcome, last_detail = note where t.id = r.trigger_id
       and not exists (select 1 from admin_trigger_runs later where later.trigger_id = t.id and later.id > r.id);
  end loop;
end $$;

-- Run by pg_cron every minute. A run missed while the database was down happens once, then the schedule moves on.
create or replace function public.admin_triggers_dispatch() returns void
language plpgsql set search_path = public, pg_temp as $$
declare t admin_triggers;
begin
  perform admin_trigger_reconcile();
  for t in select * from admin_triggers where active and next_run_at <= now() order by next_run_at limit 20 for update skip locked loop
    update admin_triggers set
      next_run_at = case when t.kind <> 'once' then admin_trigger_next(t.kind, t.run_at, t.every_minutes, t.at_time, t.weekdays, t.month_day, now()) end,
      active = t.kind <> 'once',
      finished_at = case when t.kind = 'once' then now() end
     where id = t.id;
    perform admin_trigger_start(t.id, 'schedule', null);
  end loop;
  delete from admin_trigger_runs where started_at < now() - interval '90 days';
  -- A job that runs every minute would otherwise add 1,440 rows a day to pg_cron's log, which nothing else clears.
  begin
    delete from cron.job_run_details where start_time < now() - interval '7 days'
       and jobid in (select jobid from cron.job where jobname = 'admin-trigger-dispatcher');
  exception when others then null;
  end;
end $$;

create or replace function public.admin_trigger_list() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  perform admin_trigger_reconcile();
  return jsonb_build_object(
    'now', now(),
    'catalogue', admin_trigger_catalogue(),
    'dispatcher_active', admin_try($q$select to_jsonb(j.active) from cron.job j where j.jobname = 'admin-trigger-dispatcher'$q$),
    'triggers', (select coalesce(jsonb_agg(to_jsonb(t) order by t.name), '[]'::jsonb) from admin_triggers t)
  );
end $$;

create or replace function public.admin_trigger_history(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  return (select coalesce(jsonb_agg(r order by r.started_at desc), '[]'::jsonb) from (
    select id, source, started_at, finished_at, status, detail from admin_trigger_runs where trigger_id = p_id order by started_at desc limit 20) r);
end $$;

-- Creates (p_id null) or changes a trigger. Fields the chosen kind does not use are cleared.
create or replace function public.admin_trigger_save(p_id uuid, p_name text, p_task text, p_kind text, p_run_at timestamptz default null, p_every integer default null, p_time time default null, p_weekdays integer[] default null, p_month_day integer default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  task jsonb := admin_trigger_task(p_task);
  name_clean text := btrim(coalesce(p_name, ''));
  days integer[];
  old admin_triggers;
  saved admin_triggers;
  next_run timestamptz;
begin
  perform admin_require();
  if name_clean = '' or length(name_clean) > 80 then raise exception 'Give the trigger a name of up to 80 characters'; end if;
  if task is null then raise exception 'That task is not in the catalogue'; end if;
  if task ? 'unavailable' then raise exception 'That task cannot run yet: %', task->>'unavailable'; end if;
  if p_kind is null or p_kind not in ('once', 'interval', 'daily', 'weekly', 'monthly') then raise exception 'Choose how often it should run'; end if;
  if p_kind = 'once' and (p_run_at is null or p_run_at <= now()) then raise exception 'Choose a date and time in the future'; end if;
  if p_kind = 'interval' then
    if p_every is null or p_every < 5 or p_every > 1440 then raise exception 'The interval must be between 5 minutes and 24 hours'; end if;
    if (task->>'at_most_daily')::boolean then raise exception '% can run at most once a day. Choose once, daily, weekly or monthly.', task->>'label'; end if;
  end if;
  if p_kind in ('daily', 'weekly', 'monthly') and p_time is null then raise exception 'Choose a time'; end if;
  if p_kind = 'weekly' then
    select array_agg(distinct w order by w) into days from unnest(p_weekdays) w;
    if days is null or days[1] < 1 or days[array_length(days, 1)] > 7 then raise exception 'Choose at least one day of the week'; end if;
  end if;
  if p_kind = 'monthly' and (p_month_day is null or p_month_day < 1 or p_month_day > 31) then raise exception 'Choose a day of the month from 1 to 31'; end if;

  next_run := admin_trigger_next(p_kind, p_run_at, p_every, p_time, days, p_month_day, now());
  if p_id is null then
    insert into admin_triggers (name, task_key, kind, run_at, every_minutes, at_time, weekdays, month_day, next_run_at)
    values (name_clean, p_task, p_kind, case when p_kind = 'once' then p_run_at end, case when p_kind = 'interval' then p_every end,
            case when p_kind in ('daily', 'weekly', 'monthly') then p_time end, days, case when p_kind = 'monthly' then p_month_day end, next_run)
    returning * into saved;
  else
    select * into old from admin_triggers where id = p_id for update;
    if not found then raise exception 'That trigger no longer exists'; end if;
    -- A finished one-off that gets a new schedule starts again; a paused trigger stays paused.
    update admin_triggers set name = name_clean, task_key = p_task, kind = p_kind,
      run_at = case when p_kind = 'once' then p_run_at end, every_minutes = case when p_kind = 'interval' then p_every end,
      at_time = case when p_kind in ('daily', 'weekly', 'monthly') then p_time end, weekdays = days, month_day = case when p_kind = 'monthly' then p_month_day end,
      active = old.active or old.finished_at is not null, finished_at = null,
      next_run_at = case when old.active or old.finished_at is not null then next_run end,
      updated_at = now(), updated_by = auth.uid()
     where id = p_id returning * into saved;
  end if;
  insert into admin_audit (action, target, detail) values (case when p_id is null then 'create_trigger' else 'edit_trigger' end, saved.id::text,
    jsonb_build_object('name', saved.name, 'task', saved.task_key, 'kind', saved.kind, 'next_run_at', saved.next_run_at));
  return to_jsonb(saved);
end $$;

create or replace function public.admin_trigger_set_active(p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t admin_triggers;
  next_run timestamptz;
begin
  perform admin_require();
  select * into t from admin_triggers where id = p_id for update;
  if not found then raise exception 'That trigger no longer exists'; end if;
  if p_active then
    if t.finished_at is not null then raise exception 'This one-off trigger has finished. Edit it to give it a new date.'; end if;
    next_run := admin_trigger_next(t.kind, t.run_at, t.every_minutes, t.at_time, t.weekdays, t.month_day, now());
    if next_run is null then raise exception 'Its date has passed. Edit it to give it a new date.'; end if;
  end if;
  update admin_triggers set active = p_active, next_run_at = next_run, updated_at = now(), updated_by = auth.uid() where id = p_id;
  insert into admin_audit (action, target, detail) values (case when p_active then 'resume_trigger' else 'pause_trigger' end, p_id::text, jsonb_build_object('name', t.name));
end $$;

create or replace function public.admin_trigger_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare t admin_triggers;
begin
  perform admin_require();
  delete from admin_triggers where id = p_id returning * into t;
  if not found then raise exception 'That trigger no longer exists'; end if;
  insert into admin_audit (action, target, detail) values ('delete_trigger', p_id::text, jsonb_build_object('name', t.name, 'task', t.task_key));
end $$;

-- Runs the task once now and leaves the schedule alone. A paused trigger can be run this way.
create or replace function public.admin_trigger_run_now(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t admin_triggers;
  run bigint;
begin
  perform admin_require();
  select * into t from admin_triggers where id = p_id for update;
  if not found then raise exception 'That trigger no longer exists'; end if;
  perform admin_trigger_reconcile();
  if exists (select 1 from admin_trigger_runs where trigger_id = p_id and status = 'running') then raise exception 'This trigger is still running. Wait for it to finish.'; end if;
  run := admin_trigger_start(p_id, 'manual', auth.uid());
  insert into admin_audit (action, target, detail) values ('run_trigger', p_id::text, jsonb_build_object('name', t.name, 'task', t.task_key, 'run', run));
  return (select to_jsonb(r) from (select id, status, detail from admin_trigger_runs where id = run) r);
end $$;

revoke all on function public.admin_trigger_catalogue(), public.admin_trigger_task(text), public.admin_trigger_next(text, timestamptz, integer, time, integer[], integer, timestamptz),
  public.admin_trigger_post(text, text, text, jsonb), public.admin_trigger_start(uuid, text, uuid), public.admin_trigger_reconcile(), public.admin_triggers_dispatch() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['admin_trigger_list()', 'admin_trigger_history(uuid)', 'admin_trigger_save(uuid, text, text, text, timestamptz, integer, time, integer[], integer)', 'admin_trigger_set_active(uuid, boolean)', 'admin_trigger_delete(uuid)', 'admin_trigger_run_now(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Left alone if it already exists, so re-running this file does not resume a paused dispatcher.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'admin-trigger-dispatcher') then
    perform cron.schedule('admin-trigger-dispatcher', '* * * * *', 'select public.admin_triggers_dispatch()');
  end if;
end $$;
