-- =====================================================================
-- Admin Base - CRM Agent on OpenRouter, read-only                  016
-- =====================================================================
-- crm-agent now answers plain questions through OpenRouter, with the secret OPENROUTER_API_KEY, so this agent's
-- settings say so. Bruno ranks agents by the role text. Only changes the row while it still has the 014 text, so a
-- hand edit is kept. Run after 013 and 014 (crm-agent uses 013's table info and log functions). Idempotent.
-- Undo: rollback/016_crm_agent_openrouter_rollback.sql
-- =====================================================================
update public.agents
set role = 'Answers questions from the CRM data the person asking may see: leads, tasks, clients, banking, HR, attendance, accounting and knowledge. Read-only.',
    provider = 'openrouter',
    model = 'deepseek/deepseek-v4.1-flash',
    runtime = 'gateway'
where id = 'AGT-14-CRM'
  and role = 'Reads the current status of a Business Development lead from its exact lead number, such as LD-2026-000002.';
