-- The parts of Supabase and the CRM that Notification Base needs, for a throwaway local database.
-- Column names are the live ones. Later tasks extend the columns they need.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
alter role service_role bypassrls;
create schema auth; create schema cron;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, full_name text, email text, role text);
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
grant execute on function public.admin_is() to authenticated;

create table public.banking_user_roles (user_id uuid primary key, role text);
create table public.hr_employees (profile_id uuid primary key, status text, designation text);
create table public.tasks (id uuid primary key default gen_random_uuid(), title text, owner_id uuid);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  type text, title text not null, body text, link_scope jsonb,
  read boolean default false, created_at timestamptz default now());

create table public.client_master (client_id text primary key, client_name text);
create table public.service_departments (name text primary key, crm_tab text not null, sort_order int not null default 0);
insert into public.service_departments values ('Business Setup', 'Business Setup', 1), ('Accounting', 'Accounting', 2), ('Tax Compliance', 'Tax Compliance', 3), ('Business Banking', 'Business Banking', 4);
create table public.business_setup_kyc_profiles (id uuid primary key default gen_random_uuid(), client_id text not null unique references public.client_master (client_id), licence_expiry date);
create table public.business_setup_visas (id uuid primary key default gen_random_uuid(), kyc_id uuid not null references public.business_setup_kyc_profiles (id) on delete cascade, person_name text, visa_expiry date);
create table public.business_setup_services (id uuid primary key default gen_random_uuid(), client_id text not null references public.client_master (client_id), service_name text, status text, expiry_date date);
create table public.business_setup_tasks (id uuid primary key default gen_random_uuid(), client_id text not null references public.client_master (client_id), title text not null, owner_id uuid references public.profiles (id), due_date date, status text not null default 'Open');
create table public.banking_tasks (id uuid primary key default gen_random_uuid(), title text, assigned_to uuid references public.profiles (id), due_date date, status text not null default 'Open');
create table public.accounting_job_list (id uuid primary key default gen_random_uuid(), client_id text, job_name text, assignee_ids uuid[], status text, due_date date);

-- Copied from Database Module/Business Setup Base/migrations/008_workspace.sql:118
create or replace function public.business_setup_parse_date(p text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^\d{1,2}/\d{1,2}/\d{4}$' then return null; end if;
  return to_date(p, 'DD/MM/YYYY');
exception when others then
  return null;
end $$;

-- pg_cron: schedule upserts by name.
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;

-- Test helpers, shared by every test file.
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
