-- CRM Agent subscription tab (migration 011). Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on
create schema t6;
grant usage on schema t6 to public;
create function t6.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t6.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
create function t6.sha(x text) returns text language sql as $$ select encode(sha256(convert_to(x, 'UTF8')), 'hex') $$;

insert into profiles values ('00000000-0000-0000-0000-0000000000a1', 'admin', 'Ada', 'ada@example.com'), ('00000000-0000-0000-0000-0000000000b1', 'member', 'Bo', 'bo@example.com');
select public.audit_trail_attach_all();

-- No access row yet
set role anon;
select t6.ok('check on empty table is unset', public.crm_agent_check_mcp_token('x') = 'unset');
reset role;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select t6.fails('set hash without an access row', format('select public.crm_agent_set_mcp_token_hash(%L)', t6.sha('a')), 'read token is not set');
select t6.ok('overview on empty table: no token', (public.crm_agent_admin_overview() ->> 'token_set') = 'false');
reset role;

-- Access row with a read token but no MCP hash
insert into public.crm_agent_access (read_token_sha256) values (t6.sha('read-token'));
set role anon;
select t6.ok('check before any hash is unset', public.crm_agent_check_mcp_token('x') = 'unset');
select t6.ok('check null before any hash is unset', public.crm_agent_check_mcp_token(null) = 'unset');
reset role;

-- Who may call the admin functions
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', false);
select t6.fails('member: overview', 'select public.crm_agent_admin_overview()', 'admin only');
select t6.fails('member: set hash', format('select public.crm_agent_set_mcp_token_hash(%L)', t6.sha('a')), 'admin only');
select t6.fails('member: set plan', $$select public.crm_agent_set_plan('Pro', null)$$, 'admin only');
reset role;
set role anon;
select t6.fails('anon: overview', 'select public.crm_agent_admin_overview()', 'permission denied');
select t6.fails('anon: set hash', format('select public.crm_agent_set_mcp_token_hash(%L)', t6.sha('a')), 'permission denied');
select t6.fails('anon: set plan', $$select public.crm_agent_set_plan('Pro', null)$$, 'permission denied');
reset role;

-- Setting the hash
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select t6.ok('overview: no token yet', (public.crm_agent_admin_overview() ->> 'token_set') = 'false');
select t6.fails('uppercase hash', format('select public.crm_agent_set_mcp_token_hash(%L)', upper(t6.sha('a'))), 'invalid token hash');
select t6.fails('short hash', $$select public.crm_agent_set_mcp_token_hash('abc123')$$, 'invalid token hash');
select t6.fails('non-hex hash', format('select public.crm_agent_set_mcp_token_hash(%L)', repeat('g', 64)), 'invalid token hash');
select t6.fails('null hash', 'select public.crm_agent_set_mcp_token_hash(null)', 'invalid token hash');
select t6.ok('set hash A returns a time', public.crm_agent_set_mcp_token_hash(t6.sha('token-a')) is not null);
reset role;
set role anon;
select t6.ok('token A valid', public.crm_agent_check_mcp_token('token-a') = 'valid');
select t6.ok('wrong token invalid', public.crm_agent_check_mcp_token('nope') = 'invalid');
select t6.ok('null token invalid', public.crm_agent_check_mcp_token(null) = 'invalid');
reset role;
set role authenticated;
select public.crm_agent_set_mcp_token_hash(t6.sha('token-b'));
reset role;
set role anon;
select t6.ok('token A invalid after B', public.crm_agent_check_mcp_token('token-a') = 'invalid');
select t6.ok('token B valid', public.crm_agent_check_mcp_token('token-b') = 'valid');
reset role;
select t6.ok('two admin_audit rows', (select count(*) = 2 from admin_audit where action = 'set_mcp_token'));
select t6.ok('admin_audit detail holds no hash', not exists (select 1 from admin_audit where detail::text like '%' || t6.sha('token-a') || '%' or detail::text like '%' || t6.sha('token-b') || '%'));
select t6.ok('audit_trail holds no hash', not exists (select 1 from audit_trail where coalesce(old_values::text, '') || coalesce(new_values::text, '') like '%' || t6.sha('token-a') || '%' or coalesce(old_values::text, '') || coalesce(new_values::text, '') like '%' || t6.sha('token-b') || '%'));
set role authenticated;
select t6.ok('overview: token set', (public.crm_agent_admin_overview() ->> 'token_set') = 'true');
select t6.ok('overview: token change time set', (public.crm_agent_admin_overview() ->> 'mcp_token_changed_at') is not null);
select t6.ok('overview holds no 64-character hex value', public.crm_agent_admin_overview()::text !~ '[0-9a-f]{64}');
reset role;

-- Plan
set role authenticated;
select public.crm_agent_set_plan('Max', '2027-01-01');
select t6.ok('plan Max', (public.crm_agent_admin_overview() ->> 'plan') = 'Max');
select t6.ok('renewal date set', (public.crm_agent_admin_overview() ->> 'plan_renews_on') = '2027-01-01');
select t6.ok('plan_updated_at set', (public.crm_agent_admin_overview() ->> 'plan_updated_at') is not null);
select t6.fails('plan Free', $$select public.crm_agent_set_plan('Free', null)$$, 'invalid plan');
select t6.fails('renewal without plan', $$select public.crm_agent_set_plan(null, '2027-01-01')$$, 'renewal date needs a plan');
select t6.ok('plan audited with detail', (select detail = '{"plan": "Max", "renews_on": "2027-01-01"}'::jsonb from admin_audit where action = 'set_claude_plan'));
select public.crm_agent_set_plan(null, null);
select t6.ok('plan cleared', (public.crm_agent_admin_overview() -> 'plan') = 'null'::jsonb and (public.crm_agent_admin_overview() -> 'plan_renews_on') = 'null'::jsonb);
reset role;

-- Logging calls
set role anon;
select public.crm_agent_log_call(t6.sha('read-token'), 'get_crm_lead_status', true, null, 120);
reset role;
select t6.ok('the stored hash is not accepted as a read token', (select count(*) = 0 from public.crm_agent_tool_calls));
set role anon;
select public.crm_agent_log_call('read-token', 'get_crm_lead_status', true, null, 120);
reset role;
select t6.ok('log_call with right read token: one row', (select count(*) = 1 from public.crm_agent_tool_calls));
set role anon;
select public.crm_agent_log_call('wrong', 'get_crm_lead_status', true, null, 5);
reset role;
select t6.ok('log_call with wrong read token: no row, no error', (select count(*) = 1 from public.crm_agent_tool_calls));
set role anon;
select public.crm_agent_log_call('read-token', 'drop_everything', true, null, 5);
reset role;
select t6.ok('log_call with unknown tool: no row, no error', (select count(*) = 1 from public.crm_agent_tool_calls));
set role anon;
select public.crm_agent_log_call(null, 'get_crm_lead_status', true, null, 5);
reset role;
select t6.ok('log_call with null read token: no row, no error', (select count(*) = 1 from public.crm_agent_tool_calls));
set role anon;
select public.crm_agent_log_call('read-token', 'update_crm_lead', false, repeat('e', 500), 7);
reset role;
select t6.ok('error code stored at 80 characters', (select length(error_code) = 80 from public.crm_agent_tool_calls where tool = 'update_crm_lead'));
set role anon;
select public.crm_agent_log_call('read-token', 'trigger_agent_workflow', true, null, 9);
reset role;
select t6.ok('all three tools accepted', (select count(distinct tool) = 3 from public.crm_agent_tool_calls));

-- Retention
truncate public.crm_agent_tool_calls;
insert into public.crm_agent_tool_calls (at, tool, ok, duration_ms) values (now() - interval '91 days', 'get_crm_lead_status', true, 1), (now() - interval '89 days', 'get_crm_lead_status', true, 1);
set role anon;
select public.crm_agent_log_call('read-token', 'get_crm_lead_status', true, null, 1);
reset role;
select t6.ok('91 day row deleted', not exists (select 1 from public.crm_agent_tool_calls where at < now() - interval '90 days'));
select t6.ok('89 day row kept', exists (select 1 from public.crm_agent_tool_calls where at < now() - interval '88 days'));

-- Overview daily counts
truncate public.crm_agent_tool_calls;
insert into public.crm_agent_tool_calls (at, tool, ok, duration_ms) values
  (((current_date - 3) + time '21:00') at time zone 'UTC', 'get_crm_lead_status', true, 10),
  (((current_date - 3) + time '22:00') at time zone 'UTC', 'get_crm_lead_status', false, 10),
  (now() - interval '31 days', 'update_crm_lead', true, 10);
set role authenticated;
select t6.ok('21:00 UTC counted on the Dubai day', (select count(*) = 1 and sum((d ->> 'calls')::int) = 2 and min(d ->> 'day') = (current_date - 2)::text from jsonb_array_elements(public.crm_agent_admin_overview() -> 'daily') d));
select t6.ok('failures count rows where ok is false', (select (d ->> 'failures')::int = 1 from jsonb_array_elements(public.crm_agent_admin_overview() -> 'daily') d));
select t6.ok('31 day row absent from daily', not exists (select 1 from jsonb_array_elements(public.crm_agent_admin_overview() -> 'daily') d where d ->> 'tool' = 'update_crm_lead'));
reset role;

-- last_call_at is the newest row, failed or not
truncate public.crm_agent_tool_calls;
insert into public.crm_agent_tool_calls (at, tool, ok, duration_ms) values (now() - interval '2 hours', 'get_crm_lead_status', true, 1), (now() - interval '1 hour', 'get_crm_lead_status', false, 1);
set role authenticated;
select t6.ok('last_call_at is the newest, failed call', (public.crm_agent_admin_overview() ->> 'last_call_at')::timestamptz between now() - interval '61 minutes' and now() - interval '59 minutes');
reset role;

-- Table privileges and audit triggers
set role anon;
select t6.fails('anon select tool_calls', 'select * from public.crm_agent_tool_calls', 'permission denied');
select t6.fails('anon select access', 'select * from public.crm_agent_access', 'permission denied');
reset role;
set role authenticated;
select t6.fails('authenticated select tool_calls', 'select * from public.crm_agent_tool_calls', 'permission denied');
select t6.fails('authenticated select access', 'select * from public.crm_agent_access', 'permission denied');
reset role;
select public.audit_trail_attach_all();
select t6.ok('no audit trigger on the call log', not exists (select 1 from pg_trigger where tgrelid = 'public.crm_agent_tool_calls'::regclass and not tgisinternal));

-- 009 and 011 both ran: neither table gets the audit trigger, and the zoho snapshot stays excluded
select t6.ok('no audit trigger on zoho_finance_snapshot', not exists (select 1 from pg_trigger where tgrelid = 'public.zoho_finance_snapshot'::regclass and not tgisinternal));
select t6.ok('attach_all body excludes both tables', pg_get_functiondef('public.audit_trail_attach_all()'::regprocedure) like '%zoho_finance_snapshot%' and pg_get_functiondef('public.audit_trail_attach_all()'::regprocedure) like '%crm_agent_tool_calls%');
