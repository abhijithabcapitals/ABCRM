-- CRM Agent MCP: read-only lead status for the crm-agent Worker.
-- The Worker holds only the public Supabase key and a dedicated read token, never the
-- service role key. This function checks the token against a stored SHA-256 hash and
-- returns a fixed set of status fields. Contact details, licence and tax numbers,
-- budgets, notes and discussion summaries are never returned.
-- Lookup is by exact lead number or lead id; there is no search or listing.
-- Set the hash after applying (the access row is absent until then, so every call is refused):
--   insert into public.crm_agent_access (read_token_sha256) values ('<sha256 hex of token>')
--   on conflict (id) do update set read_token_sha256 = excluded.read_token_sha256, updated_at = now();
begin;

create table if not exists public.crm_agent_access (
  id boolean primary key default true check (id),
  read_token_sha256 text not null check (read_token_sha256 ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default now()
);

-- RLS on with no policies: only the function below and the service role can read it.
alter table public.crm_agent_access enable row level security;
revoke all on public.crm_agent_access from public, anon, authenticated;

create or replace function public.crm_agent_lead_status(p_token text, p_lead text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_lead text := upper(btrim(coalesce(p_lead, '')));
  v_result jsonb;
begin
  if p_token is null or not exists (
    select 1 from public.crm_agent_access a
    where a.read_token_sha256 = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  ) then
    return jsonb_build_object('error', 'unauthorized');
  end if;

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
  where l.archived_at is null
    and (l.lead_number = v_lead
         or (v_lead ~ '^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$' and l.id = v_lead::uuid));

  return coalesce(v_result, jsonb_build_object('error', 'not_found'));
end $$;

revoke all on function public.crm_agent_lead_status(text, text) from public, authenticated;
grant execute on function public.crm_agent_lead_status(text, text) to anon;

commit;
