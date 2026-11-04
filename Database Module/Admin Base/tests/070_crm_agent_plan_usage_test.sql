-- Claude plan usage reading (migration 012). Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on
create schema t7;
grant usage on schema t7 to public;
create function t7.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t7.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on function t7.ok(text, boolean), t7.fails(text, text, text) to public;

insert into profiles values ('00000000-0000-0000-0000-0000000000a7', 'admin', 'Ada', 'ada7@example.com'), ('00000000-0000-0000-0000-0000000000b7', 'member', 'Bo', 'bo7@example.com') on conflict (id) do nothing;

-- Before the first reading
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a7', false);
select t7.ok('admin gets null before the first reading', public.crm_agent_plan_usage() is null);
reset role;

-- Reporting
select public.crm_agent_report_plan_usage('Pro', '[{"label":"5-hour limit","percent":21,"resets_at":"2026-11-04T17:40:00Z"},{"label":"Weekly · all models","percent":46.5,"resets_at":"2026-11-06T03:00:00Z"}]');
select t7.ok('one reading stored', (select count(*) from crm_agent.plan_usage) = 1);
select t7.ok('percent stored', (select windows -> 0 ->> 'percent' from crm_agent.plan_usage) = '21');
select public.crm_agent_report_plan_usage('Max', '[{"label":"Weekly","percent":100,"resets_at":null}]');
select t7.ok('a new reading replaces the old', (select count(*) from crm_agent.plan_usage) = 1 and (select plan from crm_agent.plan_usage) = 'Max' and (select jsonb_array_length(windows) from crm_agent.plan_usage) = 1);
select t7.ok('extra input keys are not stored', (select windows -> 0 from crm_agent.plan_usage) ? 'resets_at' and (select count(*) from jsonb_object_keys((select windows -> 0 from crm_agent.plan_usage))) = 3);

-- Bad readings leave the last good one
select t7.fails('percent over 100 refused', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":101}]')$q$, 'invalid usage reading');
select t7.fails('negative percent refused', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":-1}]')$q$, 'invalid usage reading');
select t7.fails('text percent refused', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":"5"}]')$q$, 'invalid usage reading');
select t7.fails('blank label refused', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":" ","percent":5}]')$q$, 'invalid usage reading');
select t7.fails('bad reset time refused', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":5,"resets_at":"soon"}]')$q$, 'invalid usage reading');
select t7.fails('empty list refused', $q$select public.crm_agent_report_plan_usage('Pro', '[]')$q$, 'invalid usage reading');
select t7.fails('non-array refused', $q$select public.crm_agent_report_plan_usage('Pro', '{}')$q$, 'invalid usage reading');
select t7.fails('null windows refused', $q$select public.crm_agent_report_plan_usage('Pro', null)$q$, 'invalid usage reading');
select t7.fails('blank plan refused', $q$select public.crm_agent_report_plan_usage(' ', '[{"label":"x","percent":5}]')$q$, 'invalid usage reading');
select t7.ok('last good reading kept', (select plan from crm_agent.plan_usage) = 'Max');

-- Access
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a7', false);
select t7.ok('admin reads the reading', public.crm_agent_plan_usage() ->> 'plan' = 'Max' and public.crm_agent_plan_usage() ? 'reported_at');
select t7.fails('admin cannot report', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":5}]')$q$, 'permission denied');
select t7.fails('admin cannot read the table', 'select * from crm_agent.plan_usage', 'permission denied');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b7', false);
select t7.fails('member refused', 'select public.crm_agent_plan_usage()', 'admin only');
reset role;
set role anon;
select t7.fails('anon cannot read', 'select public.crm_agent_plan_usage()', 'permission denied');
select t7.fails('anon cannot report', $q$select public.crm_agent_report_plan_usage('Pro', '[{"label":"x","percent":5}]')$q$, 'permission denied');
select t7.fails('anon cannot read the table', 'select * from crm_agent.plan_usage', 'permission denied');
reset role;

-- The hourly audit job leaves the reading alone
select public.audit_trail_attach_all();
select t7.ok('no audit trigger on the reading', not exists (select 1 from pg_trigger where tgrelid = 'crm_agent.plan_usage'::regclass and tgname = 'audit_trail_row'));

drop schema t7 cascade;
