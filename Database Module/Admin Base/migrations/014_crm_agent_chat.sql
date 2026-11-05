-- =====================================================================
-- Admin Base - CRM Agent in Bruno chat, fixed answers             014
-- =====================================================================
-- crm_agent_lead_status_for_me(p_lead) lets a signed-in person read the status of one lead by exact lead number,
-- only if bd_can_view_lead allows it. It returns the same fixed fields as crm_agent_lead_status (Database Module/
-- migrations/bd/011): never contact details, tax numbers, budgets or notes. A missing, archived or not-viewable
-- lead all return {"error":"not_found"}. Each call adds a crm_agent_tool_calls row (tool, outcome, error code,
-- null duration); the lead number is never stored. Rows older than 90 days are deleted on each call.
-- Also sets AGT-14-CRM's description to what it can answer and marks it as running on its own code, only while its
-- role still has the 013 text, so a hand edit is kept. Migration 013's table info and log functions stay, unused, for
-- the Claude version (git be5c18b, docs/2026-11-04-crm-agent-claude-design.md).
-- Run after 013 and Database Module/migrations/bd (bd_leads, bd_can_view_lead). Idempotent.
-- Undo: rollback/014_crm_agent_chat_rollback.sql
-- =====================================================================
begin;

create or replace function public.crm_agent_lead_status_for_me(p_lead text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead text := upper(btrim(coalesce(p_lead, '')));
  v_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;

  select l.id into v_id from public.bd_leads l where l.archived_at is null and l.lead_number = v_lead;
  if v_id is not null and public.bd_can_view_lead(v_id) then
    select jsonb_build_object(
      'lead_id', l.id,
      'lead_number', l.lead_number,
      'name', coalesce(l.company_name, l.prospect_name),
      'stage', s.stage_name,
      'status', l.status,
      'priority', l.priority,
      'assigned_to', p.full_name,
      'onboarding_status', l.onboarding_status,
      'last_activity_at', l.last_activity_at,
      'next_followup_at', l.next_followup_at,
      'updated_at', l.updated_at
    ) into v_result
    from public.bd_leads l
    join public.bd_pipeline_stages s on s.id = l.stage_id
    left join public.profiles p on p.id = l.assigned_to_user_id
    where l.id = v_id;
  end if;

  insert into public.crm_agent_tool_calls (tool, ok, error_code, duration_ms)
  values ('get_crm_lead_status', v_result is not null, case when v_result is null then 'not_found' end, null);
  delete from public.crm_agent_tool_calls where at < now() - interval '90 days';

  return coalesce(v_result, jsonb_build_object('error', 'not_found'));
end $$;

revoke all on function public.crm_agent_lead_status_for_me(text) from public, anon, authenticated, service_role;
grant execute on function public.crm_agent_lead_status_for_me(text) to authenticated;

-- Bruno ranks agents by this text.
update public.agents
set role = 'Reads the current status of a Business Development lead from its exact lead number, such as LD-2026-000002.',
    runtime = 'own_code'
where id = 'AGT-14-CRM'
  and role = 'Reads and changes CRM data for the person asking, within their own access: leads, tasks, clients, banking, HR, accounting and knowledge.';

notify pgrst, 'reload schema';

commit;
