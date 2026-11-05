-- Per-person lead status for the CRM Agent chat (migration 014). Prints "ok ..." per check and stops at the first failure.
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
grant execute on function t8.ok(text, boolean), t8.fails(text, text, text) to public;

insert into profiles values
  ('00000000-0000-0000-0000-0000000000a8', 'member', 'Asha', 'asha8@example.com'),
  ('00000000-0000-0000-0000-0000000000b8', 'member', 'Bilal', 'bilal8@example.com'),
  ('00000000-0000-0000-0000-0000000000c8', 'member', 'Chen', 'chen8@example.com'),
  ('00000000-0000-0000-0000-0000000000d8', 'member', 'Dana', 'dana8@example.com') on conflict (id) do nothing;
insert into bd_stub_roles values ('00000000-0000-0000-0000-0000000000d8', 'bd_manager');
insert into bd_pipeline_stages values ('00000000-0000-0000-0000-000000000518', 'Proposal');
insert into bd_leads (lead_number, company_name, stage_id, status, priority, onboarding_status, last_activity_at, next_followup_at, updated_at, mobile_number, email, vat_trn, estimated_budget, internal_notes, assigned_to_user_id, acquired_by_user_id, archived_at) values
  ('LD-2026-000002', 'Gulf Trading', '00000000-0000-0000-0000-000000000518', 'active', 'high', 'pending', now(), now(), now(), '+971509998877', 'secret8@gulf.example', '100123456700003', 987654321, 'confidential note 8', '00000000-0000-0000-0000-0000000000a8', null, null),
  ('LD-2026-000003', 'Palm Foods', '00000000-0000-0000-0000-000000000518', 'active', 'low', null, now(), null, now(), null, null, null, null, null, null, '00000000-0000-0000-0000-0000000000b8', null),
  ('LD-2026-000004', 'Old Co', '00000000-0000-0000-0000-000000000518', 'lost', 'low', null, now(), null, now(), null, null, null, null, null, '00000000-0000-0000-0000-0000000000a8', null, now());

-- Access
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a8', false);
select t8.ok('assigned person reads their lead', public.crm_agent_lead_status_for_me('LD-2026-000002') ->> 'lead_number' = 'LD-2026-000002' and public.crm_agent_lead_status_for_me('LD-2026-000002') ->> 'stage' = 'Proposal');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b8', false);
select t8.ok('acquiring person reads the lead', public.crm_agent_lead_status_for_me('LD-2026-000003') ->> 'name' = 'Palm Foods');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000d8', false);
select t8.ok('bd_manager reads a lead not theirs', public.crm_agent_lead_status_for_me('LD-2026-000002') ->> 'lead_number' = 'LD-2026-000002');
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c8', false);
select t8.ok('unconnected person gets not_found', public.crm_agent_lead_status_for_me('LD-2026-000002') = '{"error":"not_found"}'::jsonb);
select t8.ok('unknown number gives exactly the same value', public.crm_agent_lead_status_for_me('LD-2026-999999') = public.crm_agent_lead_status_for_me('LD-2026-000002'));
select t8.ok('null lead gives not_found', public.crm_agent_lead_status_for_me(null) = '{"error":"not_found"}'::jsonb);
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a8', false);
select t8.ok('archived lead gives not_found to the assigned person', public.crm_agent_lead_status_for_me('LD-2026-000004') = '{"error":"not_found"}'::jsonb);
select t8.ok('number is trimmed and uppercased', public.crm_agent_lead_status_for_me(' ld-2026-000002 ') ->> 'lead_number' = 'LD-2026-000002');
select t8.ok('returned keys are exactly the 11',
  (select array_agg(k order by k) from jsonb_object_keys(public.crm_agent_lead_status_for_me('LD-2026-000002')) k)
  = (select array_agg(k order by k) from unnest(array['lead_id','lead_number','name','stage','status','priority','assigned_to','onboarding_status','last_activity_at','next_followup_at','updated_at']) k));
select t8.ok('no contact, tax, budget or note values returned', public.crm_agent_lead_status_for_me('LD-2026-000002')::text !~* '(971509998877|secret8|100123456700003|987654321|confidential)');
reset role;

-- Roles without access
set role anon;
select t8.fails('anon refused', $q$select public.crm_agent_lead_status_for_me('LD-2026-000002')$q$, 'permission denied');
reset role;
set role service_role;
select t8.fails('service role refused', $q$select public.crm_agent_lead_status_for_me('LD-2026-000002')$q$, 'permission denied');
reset role;
set role authenticated;
select set_config('test.uid', '', false);
select t8.fails('no uid asks to sign in', $q$select public.crm_agent_lead_status_for_me('LD-2026-000002')$q$, 'sign in first');
reset role;

-- Call log
delete from crm_agent_tool_calls;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a8', false);
select public.crm_agent_lead_status_for_me('LD-2026-000002');
reset role;
select t8.ok('found call is logged', (select count(*) from crm_agent_tool_calls where tool = 'get_crm_lead_status' and ok and error_code is null and duration_ms is null) = 1);
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a8', false);
select public.crm_agent_lead_status_for_me('LD-2026-999999');
reset role;
select t8.ok('not-found call is logged', (select count(*) from crm_agent_tool_calls where tool = 'get_crm_lead_status' and not ok and error_code = 'not_found' and duration_ms is null) = 1);
select t8.ok('log rows hold no lead number', not exists (select 1 from crm_agent_tool_calls c where c::text ilike '%LD-2026%'));
insert into crm_agent_tool_calls (at, tool, ok) values (now() - interval '91 days', 'get_crm_lead_status', true);
select t8.ok('old row present before the call', (select count(*) from crm_agent_tool_calls where at < now() - interval '90 days') = 1);
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a8', false);
select public.crm_agent_lead_status_for_me('LD-2026-000002');
reset role;
select t8.ok('row older than 90 days deleted', (select count(*) from crm_agent_tool_calls where at < now() - interval '90 days') = 0);

-- Agent description
select t8.ok('agent renamed', (select name from agents where id = 'AGT-14-CRM') = 'CRM Agent');

drop schema t8 cascade;
