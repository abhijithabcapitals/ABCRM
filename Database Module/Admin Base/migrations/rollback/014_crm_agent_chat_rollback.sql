-- Undoes 014_crm_agent_chat.sql. The agent keeps a hand-edited role, and gets the 013 text back only while the 014 text is still there.
-- Call log rows written by the function stay (crm_agent_tool_calls belongs to 011).

begin;

drop function if exists public.crm_agent_lead_status_for_me(text);

update public.agents
set role = 'Reads and changes CRM data for the person asking, within their own access: leads, tasks, clients, banking, HR, accounting and knowledge.',
    runtime = 'gateway'
where id = 'AGT-14-CRM'
  and role = 'Reads the current status of a Business Development lead from its exact lead number, such as LD-2026-000002.';

notify pgrst, 'reload schema';

commit;
