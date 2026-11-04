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
