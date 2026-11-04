-- The parts of Supabase and earlier modules the agents migration needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema auth;
create schema vault;
create table vault.secrets (id int primary key, secret text);
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

create table public.profiles (id uuid primary key, role text);
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
grant execute on function public.admin_is() to authenticated;

create table public.knowledge_categories (id uuid primary key default gen_random_uuid(), name text not null unique);
create table public.clients (id int primary key, name text);
create table public.portal_logins (id int primary key, password_plain text);
create table public.integration_credentials (name text primary key);
