-- =====================================================================
-- Admin Base - CRM Agent subscription tab                          011
-- =====================================================================
-- Lets an admin set the MCP token hash and the Claude plan from CRM Settings, and shows how often the CRM
-- Agent's tools are called. The CRM Agent Worker checks incoming tokens through crm_agent_check_mcp_token and
-- reports each call through crm_agent_log_call. The log holds the tool name, outcome, a short error code and the
-- duration, never lead numbers, inputs or results. Rows older than 90 days are deleted on each new call.
-- Hashes are never returned by a function or written to admin_audit.
-- Run after 003, 009 and after Database Module/migrations/bd/011 (crm_agent_access). Idempotent.
-- Undo: rollback/011_crm_agent_subscription_rollback.sql
-- =====================================================================
begin;

alter table public.crm_agent_access
  add column if not exists mcp_token_sha256 text check (mcp_token_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists mcp_token_changed_at timestamptz,
  add column if not exists plan text check (plan in ('Pro', 'Max', 'Ultra')),
  add column if not exists plan_renews_on date,
  add column if not exists plan_updated_at timestamptz;

create table if not exists public.crm_agent_tool_calls (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  tool text not null,
  ok boolean not null,
  error_code text,
  duration_ms integer
);
create index if not exists crm_agent_tool_calls_at on public.crm_agent_tool_calls (at);
alter table public.crm_agent_tool_calls enable row level security;
revoke all on public.crm_agent_tool_calls from public, anon, authenticated;

-- The hourly job attaches audit triggers to new tables, so the call log is excluded in this same transaction.
-- Body is the newest definition, 009's (003 plus the zoho_finance_snapshot exclusion), with crm_agent_tool_calls added.
-- Re-running 003, 009 or rollback/009 restores a list without crm_agent_tool_calls, so re-apply 011 afterwards.
-- Puts the trigger on every table that lacks it. Runs hourly, so new tables are covered without anyone remembering.
-- Tables that are logs themselves or only count usage are left out.
create or replace function public.audit_trail_attach_all() returns table (attached int, failed text[]) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  t record;
  pk text;
  done int := 0;
  bad text[] := '{}';
begin
  for t in
    select c.oid, n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname in ('public', 'acct', 'ceo', 'email_base', 'email_agent')
      and (n.nspname, c.relname) not in (('public', 'audit_trail'), ('public', 'admin_audit'), ('public', 'hr_audit_log'), ('public', 'banking_activity_logs'), ('public', 'bd_audit_logs'), ('public', 'ai_usage'), ('ceo', 'audit_logs'), ('public', 'zoho_finance_snapshot'), ('public', 'crm_agent_tool_calls'))
      and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'audit_trail_row')
  loop
    select string_agg(quote_literal(a.attname), ', ' order by k.ord) into pk
    from pg_index i cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = t.oid and i.indisprimary;
    begin
      execute format('create trigger audit_trail_row after insert or update or delete on %I.%I for each row execute function public.audit_trail_capture(%s)', t.nspname, t.relname, coalesce(pk, ''));
      done := done + 1;
    exception when others then
      bad := bad || (t.nspname || '.' || t.relname || ': ' || sqlerrm);
    end;
  end loop;
  return query select done, bad;
end $$;

-- Re-running 003 after this would restore the old function and attach a trigger, so remove it here.
drop trigger if exists audit_trail_row on public.crm_agent_tool_calls;
drop trigger if exists audit_trail_row on public.zoho_finance_snapshot;

-- The Worker asks this for every incoming MCP request. unset means no hash is stored yet.
create or replace function public.crm_agent_check_mcp_token(p_token text) returns text
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_hash text;
begin
  select a.mcp_token_sha256 into v_hash from public.crm_agent_access a;
  if v_hash is null then return 'unset'; end if;
  if p_token is not null and v_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') then return 'valid'; end if;
  return 'invalid';
end $$;

-- Bad read tokens and unknown tools are ignored without an error, so the log cannot be filled from outside.
create or replace function public.crm_agent_log_call(p_read_token text, p_tool text, p_ok boolean, p_error_code text, p_duration_ms integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_read_token is null or not exists (
    select 1 from public.crm_agent_access a where a.read_token_sha256 = encode(sha256(convert_to(p_read_token, 'UTF8')), 'hex')
  ) then return; end if;
  if p_tool is null or p_tool not in ('get_crm_lead_status', 'update_crm_lead', 'trigger_agent_workflow') then return; end if;
  insert into public.crm_agent_tool_calls (tool, ok, error_code, duration_ms)
  values (p_tool, coalesce(p_ok, false), left(p_error_code, 80), p_duration_ms);
  delete from public.crm_agent_tool_calls where at < now() - interval '90 days';
end $$;

create or replace function public.crm_agent_admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  a public.crm_agent_access;
  v_daily jsonb;
  v_last timestamptz;
begin
  if not admin_is() then raise exception 'admin only'; end if;
  select * into a from public.crm_agent_access;
  select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'tool', d.tool, 'calls', d.calls, 'failures', d.failures) order by d.day, d.tool), '[]'::jsonb)
    into v_daily
    from (
      select (c.at at time zone 'Asia/Dubai')::date as day, c.tool, count(*) as calls, count(*) filter (where not c.ok) as failures
      from public.crm_agent_tool_calls c
      where c.at >= now() - interval '30 days'
      group by 1, 2
    ) d;
  select max(c.at) into v_last from public.crm_agent_tool_calls c;
  return jsonb_build_object(
    'plan', a.plan,
    'plan_renews_on', a.plan_renews_on,
    'plan_updated_at', a.plan_updated_at,
    'token_set', a.mcp_token_sha256 is not null,
    'mcp_token_changed_at', a.mcp_token_changed_at,
    'last_call_at', v_last,
    'daily', v_daily);
end $$;

create or replace function public.crm_agent_set_mcp_token_hash(p_hash text) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at timestamptz := now();
begin
  if not admin_is() then raise exception 'admin only'; end if;
  if p_hash is null or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid token hash'; end if;
  update public.crm_agent_access set mcp_token_sha256 = p_hash, mcp_token_changed_at = v_at where id;
  if not found then raise exception 'read token is not set'; end if;
  insert into public.admin_audit (action, target, detail) values ('set_mcp_token', null, null);
  return v_at;
end $$;

create or replace function public.crm_agent_set_plan(p_plan text, p_renews_on date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not admin_is() then raise exception 'admin only'; end if;
  if p_plan is not null and p_plan not in ('Pro', 'Max', 'Ultra') then raise exception 'invalid plan'; end if;
  if p_plan is null and p_renews_on is not null then raise exception 'renewal date needs a plan'; end if;
  update public.crm_agent_access set plan = p_plan, plan_renews_on = p_renews_on, plan_updated_at = now() where id;
  if not found then raise exception 'read token is not set'; end if;
  insert into public.admin_audit (action, target, detail) values ('set_claude_plan', null, jsonb_build_object('plan', p_plan, 'renews_on', p_renews_on));
end $$;

revoke all on function public.audit_trail_attach_all() from public, anon, authenticated;
revoke all on function public.crm_agent_check_mcp_token(text), public.crm_agent_log_call(text, text, boolean, text, integer),
  public.crm_agent_admin_overview(), public.crm_agent_set_mcp_token_hash(text), public.crm_agent_set_plan(text, date) from public, anon, authenticated;
grant execute on function public.crm_agent_check_mcp_token(text), public.crm_agent_log_call(text, text, boolean, text, integer) to anon;
grant execute on function public.crm_agent_admin_overview(), public.crm_agent_set_mcp_token_hash(text), public.crm_agent_set_plan(text, date) to authenticated;

-- So PostgREST sees the new functions. Without it crm_agent_check_mcp_token answers 404 and the Worker returns 503.
notify pgrst, 'reload schema';

commit;
