-- The parts of Supabase and earlier modules the Knowledge migration needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

-- Admin Base: profiles, tab grants, admin_is() and my_tabs()
create table public.profiles (id uuid primary key, role text);
create table public.member_tab_access (profile_id uuid not null, tab_key text not null, primary key (profile_id, tab_key));
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
create function public.my_tabs() returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(tab_key), '{}') from member_tab_access where profile_id = auth.uid() $$;
grant execute on function public.admin_is(), public.my_tabs() to authenticated;

-- Banking Base: only the columns the Knowledge read touches. Like the real tables, closed to members.
create table public.banking_partners (id uuid primary key default gen_random_uuid(), bank_name text not null unique);
create table public.banking_schemes (id uuid primary key default gen_random_uuid(), bank_id uuid not null references public.banking_partners(id), scheme_name text not null, unique (bank_id, scheme_name));
create table public.banking_pricing (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  account_opening_fee numeric(18,2) not null default 0,
  initial_deposit numeric(18,2), minimum_balance numeric(18,2),
  other_bank_charges numeric(18,2) not null default 0,
  bank_fee_collected_by_ab boolean not null default true,
  service_fee numeric(18,2), service_fee_min numeric(18,2), service_fee_max numeric(18,2),
  effective_date date not null default current_date, expiry_date date,
  source text, remarks text
);

-- Services Base
create table public.service_categories (id uuid primary key default gen_random_uuid(), name text not null unique, department text not null);
create table public.service_items (id uuid primary key default gen_random_uuid(), category_id uuid not null references public.service_categories(id), name text not null, is_active boolean not null default true);
grant select on public.service_categories, public.service_items to authenticated;
