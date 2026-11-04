-- Undoes 002_agents.sql and 003_agent_seed.sql, including all saved agent settings, grants, credit and usage.
-- Saved agent API keys stay in Vault; remove them first with admin_credential_delete if they are no longer wanted.
drop function if exists public.admin_agent_usage_this_month();
drop function if exists public.admin_agent_credit_set(uuid, numeric);
drop function if exists public.admin_agent_save(text, jsonb, uuid[], jsonb, uuid[]);
drop function if exists public.admin_agent_tables();
drop function if exists public.agent_table_allowed(text, text);
drop table if exists public.agent_usage;
drop table if exists public.agent_user_credit;
drop table if exists public.agent_user_access;
drop table if exists public.agent_table_access;
drop table if exists public.agent_knowledge;
drop table if exists public.agents;
