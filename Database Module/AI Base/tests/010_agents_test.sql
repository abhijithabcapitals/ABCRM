-- Access and behaviour tests for Settings > Agents. Each check raises on failure.
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

insert into profiles values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member');
insert into knowledge_categories (id, name) values ('20000000-0000-0000-0000-000000000001', 'Visas');
insert into agent_usage (agent_id, profile_id, cost_usd, created_at) values
  ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000b', 1.5, now()),
  ('AGT-03-TAX', '00000000-0000-0000-0000-00000000000b', 9, now() - interval '70 days');

select t.is_true('16 agents seeded', (select count(*) from agents) = 16);
select t.is_true('every agent starts disabled', not exists (select 1 from agents where enabled));
select t.is_true('nobody starts with access', not exists (select 1 from agent_user_access));
select t.is_true('no agent starts with table access', not exists (select 1 from agent_table_access));
select t.is_true('tax instructions come from CLAUDE.md', (select instructions like '%Tax Agent%' from agents where id = 'AGT-03-TAX'));
select t.is_true('approval rules are prefilled', (select approval_rules <> '' from agents where id = 'AGT-03-TAX'));

set role authenticated;

-- A member
set test.uid = '00000000-0000-0000-0000-00000000000b';
select t.is_true('member reads no agents', (select count(*) from agents) = 0);
select t.is_true('member reads no usage', (select count(*) from agent_usage) = 0);
select t.fails('member cannot save', $$select admin_agent_save('AGT-03-TAX', '{"name":"x","provider":"anthropic","model":"m"}', '{}', '[]', '{}')$$, 'Only a CRM admin');
select t.fails('member cannot set own credit', $$select admin_agent_credit_set('00000000-0000-0000-0000-00000000000b', 100)$$, 'Only a CRM admin');
select t.fails('member cannot list tables', $$select * from admin_agent_tables()$$, 'Only a CRM admin');
select t.fails('member cannot read usage summary', $$select * from admin_agent_usage_this_month()$$, 'Only a CRM admin');
select t.fails('member cannot write the table directly', $$update agents set enabled = true$$, 'permission denied');

-- An admin
set test.uid = '00000000-0000-0000-0000-00000000000a';
select t.is_true('admin reads all agents', (select count(*) from agents) = 16);
select t.is_true('admin sees ordinary tables', exists (select 1 from admin_agent_tables() where schema_name = 'public' and table_name = 'clients'));
select t.is_true('auth and vault are hidden', not exists (select 1 from admin_agent_tables() where schema_name in ('auth', 'vault')));
select t.is_true('tables with password columns are hidden', not exists (select 1 from admin_agent_tables() where table_name = 'portal_logins'));
select t.is_true('credential labels are hidden', not exists (select 1 from admin_agent_tables() where table_name = 'integration_credentials'));
select t.is_true('agent settings are hidden', not exists (select 1 from admin_agent_tables() where table_name like 'agent%'));

select admin_agent_save('AGT-03-TAX',
  '{"name":"Tax Helper","role":"r","instructions":"i","extra_content":"e","provider":"anthropic","model":"claude-haiku-5-5","enabled":true,"monthly_budget_usd":"25","approval_rules":"a","notes":"n"}',
  array['20000000-0000-0000-0000-000000000001']::uuid[],
  '[{"schema_name":"public","table_name":"clients","level":"read"}]',
  array['00000000-0000-0000-0000-00000000000b']::uuid[]);
select t.is_true('fields saved', (select name = 'Tax Helper' and enabled and monthly_budget_usd = 25 and model = 'claude-haiku-5-5' from agents where id = 'AGT-03-TAX'));
select t.is_true('knowledge saved', (select count(*) from agent_knowledge) = 1);
select t.is_true('table access saved', (select level from agent_table_access where table_name = 'clients') = 'read');
select t.is_true('user access saved with who gave it', (select granted_by from agent_user_access where agent_id = 'AGT-03-TAX') = '00000000-0000-0000-0000-00000000000a');

select admin_agent_save('AGT-03-TAX', '{"name":"Tax Helper","provider":"anthropic","model":"m","monthly_budget_usd":""}', '{}',
  '[{"schema_name":"public","table_name":"clients","level":"write"}]', '{}');
select t.is_true('blank budget means no cap', (select monthly_budget_usd is null from agents where id = 'AGT-03-TAX'));
select t.is_true('level can change', (select level from agent_table_access where table_name = 'clients') = 'write');
select t.is_true('removing a person takes away access', not exists (select 1 from agent_user_access));
select t.is_true('removing a category works', not exists (select 1 from agent_knowledge));

select t.fails('hidden table refused', $$select admin_agent_save('AGT-03-TAX', '{"name":"x","provider":"anthropic","model":"m"}', '{}', '[{"schema_name":"public","table_name":"portal_logins","level":"read"}]', '{}')$$, 'cannot be given access');
select t.fails('system schema refused', $$select admin_agent_save('AGT-03-TAX', '{"name":"x","provider":"anthropic","model":"m"}', '{}', '[{"schema_name":"vault","table_name":"secrets","level":"read"}]', '{}')$$, 'cannot be given access');
select t.fails('bad level refused', $$select admin_agent_save('AGT-03-TAX', '{"name":"x","provider":"anthropic","model":"m"}', '{}', '[{"schema_name":"public","table_name":"clients","level":"owner"}]', '{}')$$, 'read or write');
select t.fails('blank name refused', $$select admin_agent_save('AGT-03-TAX', '{"name":" ","provider":"anthropic","model":"m"}', '{}', '[]', '{}')$$, 'check');
select t.fails('unknown agent refused', $$select admin_agent_save('NOPE', '{"name":"x","provider":"anthropic","model":"m"}', '{}', '[]', '{}')$$, 'does not exist');

select admin_agent_credit_set('00000000-0000-0000-0000-00000000000b', 50);
select t.is_true('credit allocated', (select monthly_credit_usd from agent_user_credit) = 50);
select admin_agent_credit_set('00000000-0000-0000-0000-00000000000b', 30);
select t.is_true('credit decreased', (select monthly_credit_usd from agent_user_credit) = 30);
select t.fails('negative credit refused', $$select admin_agent_credit_set('00000000-0000-0000-0000-00000000000b', -1)$$, 'below zero');
select t.is_true('usage counts this month only', (select used_usd from admin_agent_usage_this_month()) = 1.5);

reset role;
select 'tests passed' as passed;
