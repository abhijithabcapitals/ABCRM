-- Access and behaviour tests for Router Base. Each check raises on failure.
create schema t;
grant usage on schema t to public;
create function t.is_true(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema t to public;

-- A funded person, a person without a credit row, one who used up their credit, two more for chat tests.
insert into profiles values
  ('00000000-0000-0000-0000-00000000000a', 'member'), ('00000000-0000-0000-0000-00000000000b', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'member'), ('00000000-0000-0000-0000-00000000000d', 'member'),
  ('00000000-0000-0000-0000-00000000000e', 'member');
update agents set enabled = true where id in ('AGT-03-TAX', 'AGT-08-SUPPORT', 'AGT-11-CEO', 'AGT-13-EMAIL');
update agents set monthly_budget_usd = 10 where id = 'AGT-03-TAX';
update agents set monthly_budget_usd = 2 where id = 'AGT-08-SUPPORT';
-- A ticks TAX, SUPPORT (budget used up by B), CEO (no cap) and BIZDEV (disabled). EMAIL is enabled but not ticked.
insert into agent_user_access (agent_id, profile_id)
  select a, '00000000-0000-0000-0000-00000000000a' from unnest(array['AGT-03-TAX', 'AGT-08-SUPPORT', 'AGT-11-CEO', 'AGT-05-BIZDEV']) a;
insert into agent_user_access values ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000c'), ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000d');
insert into agent_user_credit (profile_id, monthly_credit_usd) values
  ('00000000-0000-0000-0000-00000000000a', 50), ('00000000-0000-0000-0000-00000000000b', 50), ('00000000-0000-0000-0000-00000000000d', 1);
insert into agent_usage (agent_id, profile_id, cost_usd, created_at) values
  ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000a', 1.5, now()),
  ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000a', 9, (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai') - interval '1 hour'),
  ('AGT-08-SUPPORT', '00000000-0000-0000-0000-00000000000b', 2, now()),
  ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000d', 1, now());

-- Direct table and service-only access
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select t.fails('router.messages unreadable', $$select * from router.messages$$, 'permission denied');
select t.fails('router.settings unreadable', $$select * from router.settings$$, 'permission denied');
select t.fails('router_context blocked', $$select router_context('00000000-0000-0000-0000-00000000000a')$$, 'permission denied');
select t.fails('router_save_message blocked', $$select router_save_message('00000000-0000-0000-0000-00000000000a', 'user', 'x', null)$$, 'permission denied');
select t.fails('router_set_ceo_thread blocked', $$select router_set_ceo_thread('00000000-0000-0000-0000-00000000000a', gen_random_uuid())$$, 'permission denied');
select t.fails('router_record_usage blocked', $$select router_record_usage('AGT-03-TAX', '00000000-0000-0000-0000-00000000000a', 1)$$, 'permission denied');

-- Agent name
select t.is_true('default name is Bruno', router_my_agent_name() = 'Bruno');
select t.is_true('name is trimmed', router_set_agent_name('  Rex  ') = 'Rex');
select t.is_true('name is saved', router_my_agent_name() = 'Rex');
select t.fails('blank name refused', $$select router_set_agent_name('   ')$$, 'name');
select t.fails('31-character name refused', $$select router_set_agent_name(repeat('a', 31))$$, 'name');
select t.is_true('30-character name accepted', length(router_set_agent_name(repeat('a', 30))) = 30);
select router_set_agent_name('Rex');
set test.uid = '00000000-0000-0000-0000-00000000000b';
select t.is_true('other person still has Bruno', router_my_agent_name() = 'Bruno');
set test.uid = '';
select t.fails('rename needs a signed-in person', $$select router_set_agent_name('Rex')$$, 'Sign in');

-- Chats are private
reset role;
set role service_role;
select router_save_message('00000000-0000-0000-0000-00000000000a', 'user', 'a-one', null);
select router_save_message('00000000-0000-0000-0000-00000000000b', 'user', 'b-one', null);
select router_save_message('00000000-0000-0000-0000-00000000000a', 'assistant', 'a-two', 'AGT-03-TAX');
reset role;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
select t.is_true('A sees only own messages, oldest first', (select array_agg(content) from router_history()) = array['a-one', 'a-two']);
select t.is_true('agent reply carries the agent name', (select from_name is not null from router_history() where content = 'a-two'));
select t.is_true('own message has no from_name', (select from_name is null from router_history() where content = 'a-one'));
select router_clear();
select t.is_true('clear empties A', (select count(*) from router_history()) = 0);
set test.uid = '00000000-0000-0000-0000-00000000000b';
select t.is_true('clear left B untouched', (select count(*) from router_history()) = 1);
set test.uid = '';
select t.fails('history needs a signed-in person', $$select * from router_history()$$, 'Sign in');
select t.fails('clear needs a signed-in person', $$select router_clear()$$, 'Sign in');

-- Trim and length. E gets 55 messages: odd ones are agent replies, even ones are the person's.
reset role;
set role service_role;
select router_save_message('00000000-0000-0000-0000-00000000000e', case when i % 2 = 0 then 'user' else 'assistant' end, 'm' || i, case when i % 2 = 0 then null else 'AGT-03-TAX' end)
  from generate_series(1, 55) i;
select router_save_message('00000000-0000-0000-0000-00000000000b', 'user', repeat('x', 9000), null);
reset role;
select t.is_true('55 saves leave 50', (select count(*) from router.messages where profile_id = '00000000-0000-0000-0000-00000000000e') = 50);
select t.is_true('the remaining 50 are the newest',
  (select array_agg(content order by id) from router.messages where profile_id = '00000000-0000-0000-0000-00000000000e')
  = (select array_agg('m' || i order by i) from generate_series(6, 55) i));
select t.is_true('9000 characters stored as 8000', (select max(length(content)) from router.messages where profile_id = '00000000-0000-0000-0000-00000000000b') = 8000);
select t.is_true('trimming one person leaves another', (select count(*) from router.messages where profile_id = '00000000-0000-0000-0000-00000000000b') = 2);

-- Context
set role service_role;
select t.is_true('funded person sees exactly TAX and CEO',
  (select array_agg(a->>'id' order by a->>'id') from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000a')->'agents') a) = array['AGT-03-TAX', 'AGT-11-CEO']);
select t.is_true('credit_left is credit minus this month', (router_context('00000000-0000-0000-0000-00000000000a')->>'credit_left')::numeric = 48.5);
select t.is_true('budget_left counts all people, this month only',
  (select (a->>'budget_left')::numeric = 7.5 from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000a')->'agents') a where a->>'id' = 'AGT-03-TAX'));
select t.is_true('uncapped agent has null budget_left',
  (select a->'budget_left' = 'null'::jsonb from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000a')->'agents') a where a->>'id' = 'AGT-11-CEO'));
select t.is_true('agent carries name and role',
  (select (a->>'name') is not null and (a ? 'role') from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000a')->'agents') a where a->>'id' = 'AGT-03-TAX'));
select t.is_true('disabled agent absent', not (router_context('00000000-0000-0000-0000-00000000000a')->'agents' @> '[{"id":"AGT-05-BIZDEV"}]'));
select t.is_true('unticked agent absent', not (router_context('00000000-0000-0000-0000-00000000000a')->'agents' @> '[{"id":"AGT-13-EMAIL"}]'));
select t.is_true('agent over its budget absent', not (router_context('00000000-0000-0000-0000-00000000000a')->'agents' @> '[{"id":"AGT-08-SUPPORT"}]'));
select t.is_true('no credit row means no agents', jsonb_array_length(router_context('00000000-0000-0000-0000-00000000000c')->'agents') = 0);
select t.is_true('used-up credit means no agents', jsonb_array_length(router_context('00000000-0000-0000-0000-00000000000d')->'agents') = 0);
select t.is_true('used-up credit shows zero left', (router_context('00000000-0000-0000-0000-00000000000d')->>'credit_left')::numeric = 0);
select t.is_true('saved name in context', router_context('00000000-0000-0000-0000-00000000000a')->>'agent_name' = 'Rex');
select t.is_true('default name in context', router_context('00000000-0000-0000-0000-00000000000b')->>'agent_name' = 'Bruno');

-- CEO thread
select t.is_true('no CEO thread yet', router_context('00000000-0000-0000-0000-00000000000b')->'ceo_thread_id' = 'null'::jsonb);
select router_set_ceo_thread('00000000-0000-0000-0000-00000000000b', '30000000-0000-0000-0000-000000000001');
select t.is_true('CEO thread remembered', router_context('00000000-0000-0000-0000-00000000000b')->>'ceo_thread_id' = '30000000-0000-0000-0000-000000000001');
select t.is_true('saving a thread keeps the name', router_context('00000000-0000-0000-0000-00000000000b')->>'agent_name' = 'Bruno');
select router_set_ceo_thread('00000000-0000-0000-0000-00000000000a', '30000000-0000-0000-0000-000000000002');
select t.is_true('saving a thread keeps a saved name', router_context('00000000-0000-0000-0000-00000000000a')->>'agent_name' = 'Rex');

-- Usage recorded through the function
select router_record_usage('AGT-03-TAX', '00000000-0000-0000-0000-00000000000a', 0.5);
select t.is_true('recorded usage lowers credit_left', (router_context('00000000-0000-0000-0000-00000000000a')->>'credit_left')::numeric = 48);

-- Recent messages: at most 6, oldest first, no fixed replies (assistant rows with no agent)
select router_save_message('00000000-0000-0000-0000-00000000000e', 'assistant', 'fixed reply', null);
select t.is_true('recent has 6 rows', jsonb_array_length(router_context('00000000-0000-0000-0000-00000000000e')->'recent') = 6);
select t.is_true('recent is the newest, oldest first, without the fixed reply',
  (select array_agg(r->>'content' order by o) from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000e')->'recent') with ordinality x(r, o))
  = array['m50', 'm51', 'm52', 'm53', 'm54', 'm55']);
select t.is_true('recent rows hold only role and content', (select count(*) from jsonb_array_elements(router_context('00000000-0000-0000-0000-00000000000e')->'recent') r where r ?& array['role', 'content']) = 6);
reset role;

-- Schema guard and AI Base
select t.is_true('router schema not offered to agents', not agent_table_allowed('router', 'messages'));
select t.is_true('public tables still offered', agent_table_allowed('public', 'clients'));
select t.is_true('BD saved gateway value kept', (select runtime = 'gateway' from agents where id = 'AGT-05-BIZDEV'));

select 'tests passed' as passed;
