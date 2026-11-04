-- Undoes 011_crm_agent_subscription.sql. This deletes the stored MCP token hash, the plan and the whole call log.
-- audit_trail_attach_all keeps its extra exclusion, which does no harm.

begin;

drop function if exists public.crm_agent_check_mcp_token(text);
drop function if exists public.crm_agent_log_call(text, text, boolean, text, integer);
drop function if exists public.crm_agent_admin_overview();
drop function if exists public.crm_agent_set_mcp_token_hash(text);
drop function if exists public.crm_agent_set_plan(text, date);
drop table if exists public.crm_agent_tool_calls;
alter table public.crm_agent_access
  drop column if exists mcp_token_sha256,
  drop column if exists mcp_token_changed_at,
  drop column if exists plan,
  drop column if exists plan_renews_on,
  drop column if exists plan_updated_at;

commit;
