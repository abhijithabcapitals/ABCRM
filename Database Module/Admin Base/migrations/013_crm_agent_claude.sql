-- =====================================================================
-- Admin Base - CRM Agent through Claude                            013
-- =====================================================================
-- crm-agent runs Claude with the person's own login. These functions serve it with the service role only:
-- crm_agent_table_info describes a table without its sensitive columns or any row data, and crm_agent_chat_log
-- records each tool call. The log holds the tool, action, table, person, outcome and a short code, never inputs
-- or results. Run after 011 and after Database Module/AI Base/migrations/002_agents.sql. Idempotent.
-- =====================================================================
begin;

alter table public.crm_agent_tool_calls
  add column if not exists action text,
  add column if not exists table_name text,
  add column if not exists profile_id uuid;

create or replace function public.crm_agent_table_info(p_schema text, p_table text)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_oid oid;
begin
  if not public.agent_table_allowed(p_schema, p_table) then return null; end if;
  select c.oid into v_oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = p_schema and c.relname = p_table;
  return jsonb_build_object(
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
      from pg_attribute a
      where a.attrelid = v_oid and a.attnum > 0 and not a.attisdropped
        and a.attname !~* '^(.*_)?(password|passwd|secret|token|credential|api_?key|private_key|otp)(_.*)?$'
        and a.attname !~* '_hash$'), '[]'::jsonb),
    'primary_key', coalesce((
      select jsonb_agg(a.attname order by k.ord)
      from pg_index i cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
      where i.indrelid = v_oid and i.indisprimary), '[]'::jsonb));
end $$;

create or replace function public.crm_agent_chat_log(p_profile uuid, p_tool text, p_action text, p_table text, p_ok boolean, p_error_code text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.crm_agent_tool_calls (tool, action, table_name, profile_id, ok, error_code)
  values (left(coalesce(p_tool, 'unknown'), 40), left(p_action, 20), left(p_table, 120), p_profile, coalesce(p_ok, false), left(p_error_code, 80));
  delete from public.crm_agent_tool_calls where at < now() - interval '90 days';
end $$;

revoke all on function public.crm_agent_table_info(text, text) from public, anon, authenticated;
revoke all on function public.crm_agent_chat_log(uuid, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_agent_table_info(text, text) to service_role;
grant execute on function public.crm_agent_chat_log(uuid, text, text, text, boolean, text) to service_role;

-- Bruno ranks agents by this text. A role someone has edited by hand is left alone.
update public.agents
set name = 'CRM Agent',
    role = 'Reads and changes CRM data for the person asking, within their own access: leads, tasks, clients, banking, HR, accounting and knowledge.',
    runtime = 'gateway'
where id = 'AGT-14-CRM'
  and role = 'Manages the CRM by chat: settings, integrations, database, UI and code changes, each approved by an admin.';

commit;
