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

create table public.banking_user_roles (user_id uuid primary key, role text not null);
create table public.hr_employees (id uuid primary key default gen_random_uuid(), profile_id uuid, status text not null, designation text);
create table public.member_tab_access (profile_id uuid not null, tab_key text not null, primary key (profile_id, tab_key));
create function public.hub_is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select admin_is()
    or exists (select 1 from banking_user_roles where user_id = auth.uid() and role = 'MANAGER')
    or exists (select 1 from hr_employees where profile_id = auth.uid() and status = 'Active' and designation ilike 'manager') $$;
-- As on live before migration 005.
create function public.my_tabs() returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct t), '{}') from (
    select tab_key as t from member_tab_access where profile_id = auth.uid()
    union all
    select unnest(array['quotations', 'ardentax']) where hub_is_admin()) x $$;
revoke all on function public.my_tabs() from public, anon;
grant execute on function public.my_tabs() to authenticated;
create table public.tasks (id uuid primary key default gen_random_uuid(), title text not null, status text, assignee_id uuid, due_date date, deleted_at timestamptz);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete cascade,
  type text, title text not null, body text, link_scope jsonb,
  read boolean default false, created_at timestamptz default now());

create table public.client_master (client_id text primary key, legal_name text not null, data jsonb not null);
create table public.service_departments (name text primary key, crm_tab text not null, sort_order int not null default 0);
insert into public.service_departments values ('Business Setup', 'Business Setup', 1), ('Accounting', 'Accounting', 2), ('Tax Compliance', 'Tax Compliance', 3), ('Business Banking', 'Business Banking', 4);
create table public.business_setup_kyc_profiles (client_id text primary key references public.client_master (client_id), client_status text, licence_expiry date, jurisdiction text, business_activity text, licence_extras jsonb,
  id uuid not null unique default gen_random_uuid(), licence_number text);
create table public.client_master_history (id bigint generated always as identity primary key, client_id text not null, action text not null, field text,
  old_value text, new_value text, changed_by uuid default auth.uid(), changed_at timestamptz not null default now());
create table public.business_setup_kyc_partners (id uuid primary key default gen_random_uuid(), kyc_id uuid not null references public.business_setup_kyc_profiles (id) on delete cascade,
  full_name text not null, nationality text, share_percent numeric(5,2), is_shareholder boolean not null default true, is_ubo boolean not null default false,
  passport_number text, passport_expiry date, emirates_id text, details jsonb not null default '{}', deleted_at timestamptz);
create table public.business_setup_visas (id uuid primary key default gen_random_uuid(), client_id text not null, person_name text not null, occupation text, expiry_date date, status text);
create table public.business_setup_services (id uuid primary key default gen_random_uuid(), client_id text not null, name text not null, status text not null, due_date date, owner_id uuid, historical boolean not null, expiry_date date);
create table public.business_setup_tasks (id uuid primary key default gen_random_uuid(), client_id text not null, title text, owner_id uuid, due_date date, status text);
create table public.banking_clients (id uuid primary key default gen_random_uuid(), client_master_id character varying, display_name text not null);
create table public.banking_kyc_profiles (id uuid primary key default gen_random_uuid(), client_id uuid not null unique references public.banking_clients (id),
  license_number text, license_issue_date date, license_expiry_date date, issuing_authority text);
create table public.banking_kyc_shareholders (id uuid primary key default gen_random_uuid(), kyc_profile_id uuid not null references public.banking_kyc_profiles (id),
  full_name text not null, nationality text, ownership_percent numeric(6,2), passport_number text, passport_expiry date, emirates_id text,
  shareholder_type text not null default 'Individual', is_ubo boolean not null default false, deleted_at timestamptz);
create table public.banking_cases (id uuid primary key default gen_random_uuid(), client_id uuid not null);
create table public.banking_tasks (id uuid primary key default gen_random_uuid(), client_id uuid, case_id uuid, task_type text not null, title text, assigned_to uuid, due_date date, status text);
create table public.accounting_job_list (id uuid primary key default gen_random_uuid(), client_id text, client_name text, service_name text, service_department text, due_date date, assignee_ids uuid[], work_status text, next_follow_up_on date, invoice_date date, balance numeric);
create table public.business_setup_invoices (id uuid primary key default gen_random_uuid(), client_id text, quote_id uuid, invoice_number text, issued_on date, amount numeric);
create table public.stub_net_paid (quote_id uuid primary key, amount numeric);
create function public.business_setup_net_paid(p_quote uuid) returns numeric language sql stable as $$ select coalesce((select amount from public.stub_net_paid where quote_id = p_quote), 0) $$;

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
create function cron.unschedule(j bigint) returns boolean language sql as $$ delete from cron.job where jobid = j returning true $$;

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
