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
