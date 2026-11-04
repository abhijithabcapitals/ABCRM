-- Undoes 013_crm_agent_claude.sql, including the log's action, table and person columns. Call counts stay (the table belongs to 011).
-- The agent keeps a hand-edited role, and gets its seeded name, role and runtime back only while the 013 text is still there.
begin;

drop function if exists public.crm_agent_table_info(text, text);
drop function if exists public.crm_agent_chat_log(uuid, text, text, text, boolean, text);

alter table public.crm_agent_tool_calls
  drop column if exists action,
  drop column if exists table_name,
  drop column if exists profile_id;

update public.agents
set name = 'CRM Manager',
    role = 'Manages the CRM by chat: settings, integrations, database, UI and code changes, each approved by an admin.',
    runtime = 'not_connected'
where id = 'AGT-14-CRM'
  and role = 'Reads and changes CRM data for the person asking, within their own access: leads, tasks, clients, banking, HR, accounting and knowledge.';

commit;
