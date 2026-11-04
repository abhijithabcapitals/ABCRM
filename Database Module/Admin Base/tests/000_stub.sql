-- The parts of Supabase the triggers migration needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth; create schema cron; create schema net; create schema vault;
create table auth.sessions (id uuid primary key, user_id uuid, created_at timestamptz default now(), ip inet, user_agent text);
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, role text, full_name text, email text);
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
create table public.notifications (id serial primary key, read boolean, created_at timestamptz);
create table public.automation_calls (id serial primary key, at timestamptz default now());
create function public.run_date_based_automations() returns void language plpgsql as $$
begin
  if current_setting('test.automations_fail', true) = 'yes' then raise exception 'automations broke'; end if;
  insert into automation_calls default values;
end $$;

create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create function cron.alter_job(job_id bigint, active boolean) returns void language sql as $$ update cron.job j set active = $2 where j.jobid = $1 $$;

create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create sequence net.seq;
create table net.requests (id bigint primary key, url text, headers jsonb, body jsonb);
create table net._http_response (id bigint, status_code int, timed_out boolean, error_msg text, content text);
create function net.http_post(url text, body jsonb, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint language sql as $$
  insert into net.requests values (nextval('net.seq'), url, headers, body) returning id $$;

create table public.client_master (client_id text primary key);
alter role service_role bypassrls; -- as on Supabase
create table public.crm_agent_access (id boolean primary key default true check (id), read_token_sha256 text not null, updated_at timestamptz not null default now());
alter table public.crm_agent_access enable row level security;
revoke all on public.crm_agent_access from public, anon, authenticated;

-- Business Development pieces migration 013 reads (live bodies from Database Module/migrations/bd). Roles live in a stub table.
create table public.bd_pipeline_stages (id uuid primary key, stage_name text);
create table public.bd_leads (
  id uuid primary key default gen_random_uuid(), lead_number text unique, company_name text, prospect_name text,
  stage_id uuid references public.bd_pipeline_stages (id), status text, priority text, onboarding_status text,
  last_activity_at timestamptz, next_followup_at timestamptz, updated_at timestamptz,
  mobile_number text, email text, vat_trn text, estimated_budget numeric, internal_notes text,
  assigned_to_user_id uuid, acquired_by_user_id uuid, archived_at timestamptz
);
create table public.bd_stub_roles (user_id uuid primary key, role text);
create function public.bd_current_role(p_user_id uuid default auth.uid()) returns text language sql stable security definer set search_path = public, pg_temp as $$
  select r.role from public.bd_stub_roles r where r.user_id = p_user_id $$;
create function public.bd_can_view_lead(p_lead_id uuid) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (select 1 from public.bd_leads l where l.id = p_lead_id and (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'marketing_executive', 'onboarding_executive', 'management', 'read_only') or l.assigned_to_user_id = auth.uid() or l.acquired_by_user_id = auth.uid())) $$;
grant execute on function public.bd_can_view_lead(uuid), public.bd_current_role(uuid) to authenticated;

-- The seeded agent row migration 013 updates (Database Module/AI Base/migrations/003_agent_seed.sql).
create table public.agents (id text primary key, name text, role text);
insert into public.agents values ('AGT-14-CRM', 'CRM Manager', 'Manages the CRM by chat: settings, integrations, database, UI and code changes, each approved by an admin.');
