-- The parts of Supabase and earlier modules the Messenger migration needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

-- Admin Base: profiles and admin_is() (live in HR Base 001)
create table public.profiles (id uuid primary key, role text);
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
grant execute on function public.admin_is() to authenticated;

-- Parent tables. Stub rule: the owner or an admin sees the row, so a person can be without access.
create table public.client_master (client_id text primary key, legal_name text, owner_id uuid);
create table public.bd_leads (id uuid primary key default gen_random_uuid(), lead_no text, owner_id uuid);
create table public.tasks (id uuid primary key default gen_random_uuid(), title text, owner_id uuid);
grant select on public.client_master, public.bd_leads, public.tasks to authenticated;
alter table public.client_master enable row level security;
alter table public.bd_leads enable row level security;
alter table public.tasks enable row level security;
create policy stub_read on public.client_master for select to authenticated using (owner_id = (select auth.uid()) or admin_is());
create policy stub_read on public.bd_leads for select to authenticated using (owner_id = (select auth.uid()) or admin_is());
create policy stub_read on public.tasks for select to authenticated using (owner_id = (select auth.uid()) or admin_is());

-- Supabase Vault and service_role, only what 002_microsoft_connection.sql calls. No grants to anon or authenticated, as on Supabase.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;
grant usage on schema public to service_role;
create schema vault;
create table vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, description text not null default '', secret text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null) returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name), description = coalesce(new_description, description), updated_at = now() where id = secret_id $$;
