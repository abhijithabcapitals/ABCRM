-- Lead-generation platform integrations (first: Explee).
-- Prospects pulled from a platform are staged in bd_platform_prospects. A person
-- reviews them and adds the good ones to the pipeline through the normal
-- bd_create_lead flow, so duplicate checks, ownership and follow-up rules apply.
-- Provider API keys live only in Supabase Edge Function secrets.

insert into public.bd_lead_sources (source_code, source_name, source_category, requires_campaign, requires_referrer, is_active, sort_order)
values ('EXPLEE', 'Explee', 'Other', false, false, true, 150)
on conflict (source_code) do update set source_name = excluded.source_name, is_active = true;

create table if not exists public.bd_platform_connections (
  provider text primary key check (provider ~ '^[a-z0-9_-]{2,40}$'),
  display_name text not null,
  settings jsonb not null default '{}'::jsonb,        -- e.g. {"project_id": 38083}
  last_synced_at timestamptz,
  last_hot_lead_at timestamptz,                        -- newest became_hot_at seen; next sync starts here
  last_result jsonb,
  last_error text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bd_platform_prospects (
  id uuid primary key default gen_random_uuid(),
  provider text not null references public.bd_platform_connections(provider) on delete cascade,
  external_id text not null,
  kind text not null default 'hot' check (kind in ('hot', 'contacted')),
  external_campaign_id text,
  campaign_name text,
  name text,
  email text,
  phone text,
  job_title text,
  company_name text,
  company_domain text,
  linkedin_url text,
  country text,
  why_hot text,
  note text,
  became_hot_at timestamptz,
  replied boolean,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
  lead_id uuid references public.bd_leads(id) on delete set null,
  handled_by uuid references public.profiles(id) on delete set null,
  handled_at timestamptz,
  fetched_at timestamptz not null default now(),
  unique (provider, external_id)
);
create index if not exists bd_platform_prospects_status_idx
  on public.bd_platform_prospects (provider, status, became_hot_at desc nulls last);

alter table public.bd_platform_connections enable row level security;
alter table public.bd_platform_prospects enable row level security;

-- Anyone who may create leads can see and work the prospect queue; only managers change connection settings.
drop policy if exists bd_platform_connections_read on public.bd_platform_connections;
create policy bd_platform_connections_read on public.bd_platform_connections for select to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'));
drop policy if exists bd_platform_connections_write on public.bd_platform_connections;
create policy bd_platform_connections_write on public.bd_platform_connections for all to authenticated
  using (public.bd_is_manager()) with check (public.bd_is_manager());

drop policy if exists bd_platform_prospects_read on public.bd_platform_prospects;
create policy bd_platform_prospects_read on public.bd_platform_prospects for select to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'));
drop policy if exists bd_platform_prospects_insert on public.bd_platform_prospects;
create policy bd_platform_prospects_insert on public.bd_platform_prospects for insert to authenticated
  with check (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive') and status = 'new');
drop policy if exists bd_platform_prospects_update on public.bd_platform_prospects;
create policy bd_platform_prospects_update on public.bd_platform_prospects for update to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'))
  with check (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'));

revoke all on public.bd_platform_connections, public.bd_platform_prospects from anon, public;
grant select, insert, update on public.bd_platform_connections to authenticated;
grant select, insert, update on public.bd_platform_prospects to authenticated;
grant all on public.bd_platform_connections, public.bd_platform_prospects to service_role;

insert into public.bd_platform_connections (provider, display_name, settings)
values ('explee', 'Explee', '{"project_id": 38083}'::jsonb)
on conflict (provider) do nothing;
