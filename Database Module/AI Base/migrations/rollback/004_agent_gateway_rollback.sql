-- Undoes 004_agent_gateway.sql. Redeploy the previous router-agent and crm-agent first.
-- Support, BD and Email go back to their own code. Other agents go back to not connected and off.
-- Table and knowledge lists stay, because they do nothing without the gateway.
update public.agents set name = 'CRM AI Orchestrator', enabled = false, runtime = 'not_connected', provider = 'anthropic', model = 'claude-sonnet-5-5' where id = 'AGT-00-ORCHESTRATOR';
update public.agents set runtime = 'own_code', provider = 'anthropic', model = 'claude-opus-5-5' where id = 'AGT-08-SUPPORT';
update public.agents set runtime = 'own_code', provider = 'anthropic', model = 'claude-sonnet-5-5' where id = 'AGT-05-BIZDEV';
update public.agents set runtime = 'own_code', enabled = false where id = 'AGT-13-EMAIL';
update public.agents set runtime = 'not_connected', enabled = false, provider = 'anthropic', model = 'claude-sonnet-5-5'
where id in ('AGT-01-CLIENT','AGT-02-ACCOUNTING','AGT-03-TAX','AGT-04-AUDIT','AGT-06-SOCIAL','AGT-07-DOCUMENT','AGT-09-SECURITY','AGT-10-HR','AGT-11-PERSONAL','AGT-12-IT');
delete from public.agent_user_access where agent_id in ('AGT-01-CLIENT','AGT-02-ACCOUNTING','AGT-03-TAX','AGT-04-AUDIT','AGT-06-SOCIAL','AGT-07-DOCUMENT','AGT-09-SECURITY','AGT-10-HR','AGT-11-PERSONAL','AGT-12-IT','AGT-13-EMAIL');
drop function if exists public.agent_budget_left(text);
