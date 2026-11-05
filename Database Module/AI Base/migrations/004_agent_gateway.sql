-- =====================================================================
-- AI Base - Agent chain: Bruno, sub agents, CRM Agent              004
-- =====================================================================
-- Every agent except CEO now runs from its row in Settings > Agents:
--   Bruno (AGT-00) routes, a sub agent answers through agent-gateway, and a sub agent gets data by asking the CRM Agent.
-- Provider and model change only on rows still on the Anthropic seed value. Table and knowledge lists are added only for
-- an agent with none, so anything an admin saved is kept.
-- Sub agents are switched on and ticked only for people already ticked for the CRM Agent.
-- Run before deploying agent-gateway, crm-agent and router-agent. Idempotent.
-- Undo: rollback/004_agent_gateway_rollback.sql
-- =====================================================================

-- Service role only: what is left of an agent's own monthly budget, null when it has none.
create or replace function public.agent_budget_left(p_agent text)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select case when a.monthly_budget_usd is null then null
    else a.monthly_budget_usd - coalesce((select sum(u.cost_usd) from public.agent_usage u
      where u.agent_id = a.id
        and u.created_at >= (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')), 0) end
  from public.agents a where a.id = p_agent
$$;
revoke all on function public.agent_budget_left(text) from public, anon, authenticated;
grant execute on function public.agent_budget_left(text) to service_role;

update public.agents set name = 'Bruno' where id = 'AGT-00-ORCHESTRATOR' and name = 'CRM AI Orchestrator';
update public.agents set
  role = 'Router. Reads each question, chooses the sub agents best placed to answer, and returns their reply.'
where id = 'AGT-00-ORCHESTRATOR' and role not like 'Router.%';
update public.agents set enabled = true where id = 'AGT-00-ORCHESTRATOR';

update public.agents set runtime = 'gateway'
where id in ('AGT-00-ORCHESTRATOR','AGT-01-CLIENT','AGT-02-ACCOUNTING','AGT-03-TAX','AGT-04-AUDIT','AGT-05-BIZDEV','AGT-06-SOCIAL',
             'AGT-07-DOCUMENT','AGT-08-SUPPORT','AGT-09-SECURITY','AGT-10-HR','AGT-11-PERSONAL','AGT-12-IT','AGT-13-EMAIL');

update public.agents set provider = 'openrouter', model = 'deepseek/deepseek-v4.1-flash'
where runtime = 'gateway' and id <> 'AGT-14-CRM' and provider = 'anthropic';

update public.agents set enabled = true
where id in ('AGT-01-CLIENT','AGT-02-ACCOUNTING','AGT-03-TAX','AGT-04-AUDIT','AGT-06-SOCIAL','AGT-07-DOCUMENT','AGT-09-SECURITY',
             'AGT-10-HR','AGT-11-PERSONAL','AGT-12-IT','AGT-13-EMAIL');

insert into public.agent_user_access (agent_id, profile_id)
select a.id, x.profile_id
from public.agents a cross join (select profile_id from public.agent_user_access where agent_id = 'AGT-14-CRM') x
where a.runtime = 'gateway' and a.id not in ('AGT-00-ORCHESTRATOR', 'AGT-14-CRM')
on conflict do nothing;

-- What each sub agent may ask the CRM Agent for. Only for an agent with no list yet. Editable in Settings > Agents.
with wanted(agent_id, schema_name, pattern) as (values
  ('AGT-01-CLIENT','public','client\_master%'), ('AGT-01-CLIENT','acct','client%'), ('AGT-01-CLIENT','public','banking\_clients'),
  ('AGT-01-CLIENT','public','banking\_cases'), ('AGT-01-CLIENT','public','business\_setup\_services'),
  ('AGT-02-ACCOUNTING','public','accounting\_%'), ('AGT-02-ACCOUNTING','public','voucher\_register'), ('AGT-02-ACCOUNTING','acct','%'),
  ('AGT-03-TAX','acct','tax\_%'), ('AGT-03-TAX','acct','clients'), ('AGT-03-TAX','acct','periods'), ('AGT-03-TAX','public','client\_master'),
  ('AGT-04-AUDIT','public','accounting\_%'), ('AGT-04-AUDIT','public','voucher\_register'), ('AGT-04-AUDIT','acct','%'),
  ('AGT-05-BIZDEV','public','bd\_%'), ('AGT-05-BIZDEV','public','client\_master'),
  ('AGT-06-SOCIAL','public','bd\_campaigns'), ('AGT-06-SOCIAL','public','crm\_news'),
  ('AGT-07-DOCUMENT','acct','doc%'), ('AGT-07-DOCUMENT','acct','company\_documents'), ('AGT-07-DOCUMENT','public','banking\_document%'),
  ('AGT-07-DOCUMENT','public','business\_setup\_documents'),
  ('AGT-08-SUPPORT','public','tasks'), ('AGT-08-SUPPORT','public','task\_%'), ('AGT-08-SUPPORT','public','spaces'), ('AGT-08-SUPPORT','public','lists'),
  ('AGT-08-SUPPORT','public','notifications'), ('AGT-08-SUPPORT','public','wiki\_%'), ('AGT-08-SUPPORT','public','knowledge\_%'),
  ('AGT-08-SUPPORT','public','client\_master'),
  ('AGT-09-SECURITY','public','profiles'),
  ('AGT-10-HR','public','hr\_%'), ('AGT-10-HR','public','profiles'),
  ('AGT-11-PERSONAL','public','tasks'), ('AGT-11-PERSONAL','public','notifications'), ('AGT-11-PERSONAL','public','crm\_news'),
  ('AGT-12-IT','public','profiles'), ('AGT-12-IT','public','notifications'),
  ('AGT-13-EMAIL','email_base','threads'), ('AGT-13-EMAIL','email_base','messages'), ('AGT-13-EMAIL','email_base','mailboxes'),
  ('AGT-13-EMAIL','email_agent','insights'), ('AGT-13-EMAIL','email_agent','digests')
)
insert into public.agent_table_access (agent_id, schema_name, table_name, level)
select distinct w.agent_id, n.nspname::text, c.relname::text, 'read'
from wanted w
join pg_namespace n on n.nspname = w.schema_name
join pg_class c on c.relnamespace = n.oid and c.relname like w.pattern and c.relkind in ('r', 'p') and not c.relispartition
where public.agent_table_allowed(n.nspname::text, c.relname::text)
  and not exists (select 1 from public.agent_table_access t where t.agent_id = w.agent_id)
on conflict do nothing;

with wanted(agent_id, category) as (values
  ('AGT-01-CLIENT','General'), ('AGT-01-CLIENT','Business Setup'), ('AGT-01-CLIENT','Banking'), ('AGT-02-ACCOUNTING','Accounting'),
  ('AGT-03-TAX','Tax'), ('AGT-04-AUDIT','Accounting'), ('AGT-05-BIZDEV','General'), ('AGT-05-BIZDEV','Business Setup'), ('AGT-05-BIZDEV','Banking'),
  ('AGT-08-SUPPORT','General'), ('AGT-10-HR','Visas')
)
insert into public.agent_knowledge (agent_id, category_id)
select w.agent_id, k.id from wanted w join public.knowledge_categories k on k.name = w.category
where not exists (select 1 from public.agent_knowledge a where a.agent_id = w.agent_id)
on conflict do nothing;
