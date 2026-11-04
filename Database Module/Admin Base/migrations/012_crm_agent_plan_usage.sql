-- =====================================================================
-- Admin Base - Claude plan usage reading                           012
-- =====================================================================
-- Holds the latest plan and limit percentages read from the Claude desktop app, for Settings > Claude Subscription.
-- An hourly scheduled task in that app reports through crm_agent_report_plan_usage over the database connection, so
-- the function needs no token and no API role can call it. Only one reading is kept.
-- The table sits in its own schema because audit_trail_attach_all covers public hourly, and a reading each hour
-- does not belong in the permanent audit trail. This leaves that function and its exclusion list alone.
-- Run after 001 (admin_is). Idempotent.
-- Undo: rollback/012_crm_agent_plan_usage_rollback.sql
-- =====================================================================
begin;

create schema if not exists crm_agent;
revoke all on schema crm_agent from public, anon, authenticated;

create table if not exists crm_agent.plan_usage (
  id boolean primary key default true check (id),
  plan text,
  windows jsonb not null,
  reported_at timestamptz not null default now()
);
alter table crm_agent.plan_usage enable row level security;
revoke all on crm_agent.plan_usage from public, anon, authenticated;

-- p_windows: [{ "label": text, "percent": number from 0 to 100, "resets_at": timestamp or null }], one to ten items.
create or replace function public.crm_agent_report_plan_usage(p_plan text, p_windows jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb;
  v_windows jsonb := '[]'::jsonb;
begin
  if p_plan is not null and (btrim(p_plan) = '' or length(p_plan) > 40) then raise exception 'invalid usage reading'; end if;
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) not between 1 and 10 then
    raise exception 'invalid usage reading';
  end if;
  for e in select value from jsonb_array_elements(p_windows) loop
    if jsonb_typeof(e) <> 'object'
      or jsonb_typeof(e -> 'label') is distinct from 'string' or btrim(e ->> 'label') = '' or length(e ->> 'label') > 80
      or jsonb_typeof(e -> 'percent') is distinct from 'number' or (e ->> 'percent')::numeric not between 0 and 100
    then raise exception 'invalid usage reading'; end if;
    begin
      v_windows := v_windows || jsonb_build_object('label', e ->> 'label', 'percent', (e ->> 'percent')::numeric, 'resets_at', (e ->> 'resets_at')::timestamptz);
    exception when others then
      raise exception 'invalid usage reading';
    end;
  end loop;
  insert into crm_agent.plan_usage (id, plan, windows, reported_at) values (true, p_plan, v_windows, now())
  on conflict (id) do update set plan = excluded.plan, windows = excluded.windows, reported_at = excluded.reported_at;
end $$;

-- The latest reading for the tab, or null before the first one.
create or replace function public.crm_agent_plan_usage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_result jsonb;
begin
  if not admin_is() then raise exception 'admin only'; end if;
  select jsonb_build_object('plan', u.plan, 'windows', u.windows, 'reported_at', u.reported_at) into v_result from crm_agent.plan_usage u;
  return v_result;
end $$;

revoke all on function public.crm_agent_report_plan_usage(text, jsonb), public.crm_agent_plan_usage() from public, anon, authenticated, service_role;
grant execute on function public.crm_agent_plan_usage() to authenticated;

-- So PostgREST sees the new function.
notify pgrst, 'reload schema';

commit;
