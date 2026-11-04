-- CRM Agent through Claude (migration 013). Prints "ok ..." per check and stops at the first failure.
-- The agent text checks that depend on rollback and reapply run in run-local.sh.
\set ON_ERROR_STOP on
create schema t8;
grant usage on schema t8 to public;
create function t8.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t8.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema t8 to public;

create table public.crm_test_rows (id uuid primary key default gen_random_uuid(), status text, password_plain text, pin_hash text);

select t8.ok('table info lists the columns without sensitive ones', (select array_agg(c->>'name' order by c->>'name') from jsonb_array_elements(crm_agent_table_info('public', 'crm_test_rows')->'columns') c) = array['id', 'status']);
select t8.ok('table info gives column types', crm_agent_table_info('public', 'crm_test_rows')->'columns'->0->>'type' is not null);
select t8.ok('table info gives the primary key', crm_agent_table_info('public', 'crm_test_rows')->'primary_key' = '["id"]'::jsonb);
select t8.ok('table info refuses agents', crm_agent_table_info('public', 'agents') is null);
select t8.ok('table info refuses credentials', crm_agent_table_info('public', 'integration_credentials') is null);
select t8.ok('table info refuses the router schema', crm_agent_table_info('router', 'messages') is null);
select t8.ok('table info refuses a table that does not exist', crm_agent_table_info('public', 'no_such_table') is null);

insert into public.crm_agent_tool_calls (at, tool, ok) values (now() - interval '91 days', 'read_rows', true);
select crm_agent_chat_log('00000000-0000-0000-0000-00000000000a', 'read_rows', 'read', 'public.crm_test_rows', true, null);
select t8.ok('the log keeps tool, action, table and person', exists (select 1 from public.crm_agent_tool_calls where tool = 'read_rows' and action = 'read' and table_name = 'public.crm_test_rows' and profile_id = '00000000-0000-0000-0000-00000000000a' and ok));
select t8.ok('the log removes rows older than 90 days', not exists (select 1 from public.crm_agent_tool_calls where at < now() - interval '90 days'));
select crm_agent_chat_log('00000000-0000-0000-0000-00000000000a', 'read_rows', 'read', 'public.crm_test_rows', false, repeat('x', 200));
select t8.ok('the log cuts a long code', exists (select 1 from public.crm_agent_tool_calls where char_length(error_code) = 80));

set role authenticated;
select t8.fails('a person cannot read table info', $$select crm_agent_table_info('public', 'crm_test_rows')$$, 'permission denied');
select t8.fails('a person cannot write the log', $$select crm_agent_chat_log(null, 'x', 'x', 'x', true, null)$$, 'permission denied');
reset role;

select t8.ok('the agent is renamed', (select name = 'CRM Agent' from public.agents where id = 'AGT-14-CRM'));

drop table public.crm_test_rows;
drop schema t8 cascade;
