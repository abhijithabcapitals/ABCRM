-- LOCAL TEST ONLY. Never run on Supabase (it already has these).
-- The parts of Supabase and of other modules that Document Base 001 and 002 need, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth, public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated;

-- CRM tables and the admin check, as in HR Base 001 (public.admin_is) and the CEO Agent schema (ceo.profiles, role 'owner').
create table if not exists public.profiles (id uuid primary key, full_name text, role text);
create schema if not exists ceo;
create table if not exists ceo.profiles (user_id uuid primary key, role text);
create or replace function public.admin_is() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
$$;
grant execute on function public.admin_is() to authenticated;

create table if not exists public.client_master (client_id text primary key, legal_name text);
create table if not exists public.hr_employees (employee_code text, full_name text, status text);
alter table public.hr_employees add column if not exists exit_date date; -- HR Base 002
