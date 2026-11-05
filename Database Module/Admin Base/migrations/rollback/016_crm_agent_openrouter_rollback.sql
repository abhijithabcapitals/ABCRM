-- Undoes 016_crm_agent_openrouter.sql. Keeps a hand-edited role. Deploy the fixed-answer crm-agent (git 5e98076) with this.
update public.agents
set role = 'Reads the current status of a Business Development lead from its exact lead number, such as LD-2026-000002.',
    provider = 'anthropic',
    model = 'claude-opus-5-5',
    runtime = 'own_code'
where id = 'AGT-14-CRM'
  and role = 'Answers questions from the CRM data the person asking may see: leads, tasks, clients, banking, HR, attendance, accounting and knowledge. Read-only.';
