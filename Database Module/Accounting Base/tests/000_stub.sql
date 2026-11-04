-- The parts of Supabase and the live CRM that Accounting Base needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth;
alter role service_role bypassrls; -- as on Supabase
grant usage on schema public, auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

-- ...0a is the ACCOUNTS user, ...0b has no role
create table public.profiles (id uuid primary key, role text, full_name text);
create table public.client_master (client_id text primary key, legal_name text, data jsonb not null default '{}');
-- Copied from Client Base 002: drops the placeholder words the client form stores.
create function public.client_master_plain(v text) returns text
language sql immutable set search_path = pg_catalog as $$
  select nullif(btrim(case when v like '% (Provided – Verification Required)' then left(v, length(v) - length(' (Provided – Verification Required)')) else v end), '')
   where coalesce(v, '') not in ('Not Provided', 'N/A', 'None', 'Provided – Verification Required')
$$;
create table public.hub_documents (id uuid primary key default gen_random_uuid(), doc_type text not null check (doc_type in ('quote','letter','mail')), document_number text, total_amount numeric, vat_mode text, vat_rate numeric);
-- Banking tables only so the Zoho function's read grants in Admin Base 013 have something to grant on.
create table public.banking_clients (id uuid primary key default gen_random_uuid());
create table public.banking_cases (id uuid primary key default gen_random_uuid());
create table public.banking_quotations (id uuid primary key default gen_random_uuid());
create table public.hub_settings (key text primary key, value jsonb);
insert into public.hub_settings values ('document_numbering',
  '{"Accounting":{"quote":{"digits":3,"format":"ABC/{YYYY}/{MM}/ACQ{SERIAL}","restart":"never"}}}');

-- Live voucher register: today's columns and source check
create table public.voucher_register (
  id uuid primary key default gen_random_uuid(),
  voucher_type text not null check (voucher_type in ('Receipt','Quotation','Engagement Letter')),
  voucher_number text not null, version int not null default 1, serial int,
  company text not null default 'AB Capital', department text,
  source text not null check (source in ('banking','hub','template','business_setup')),
  source_id uuid not null, case_id uuid, client_name text, issued_on date, amount numeric(18,2), status text,
  storage_path text, local_path text, file_name text,
  created_at timestamptz not null default now(), created_by uuid,
  unique (source, voucher_type, source_id));   -- the conflict target the receipt trigger uses
alter table public.voucher_register enable row level security;   -- no policy of its own: each module adds the one for its rows
grant select on public.voucher_register to authenticated;
create function public.voucher_serial(p_number text) returns int language sql immutable as $$
  select substring(p_number from '([0-9]+)[^0-9]*$')::int $$;
-- Live Template Hub numbering: the counter table starts with the narrow kind check (migration 003 must widen it to receipt),
-- and hub_next_number reads hub_settings.document_numbering as the real one does.
create table public.hub_number_counters (
  department text not null, kind text not null check (kind in ('quote','letter')), period text not null default 'all',
  last_serial int not null default 0, primary key (department, kind, period));
create function public.banking_number_period(p_restart text, p_on date) returns text language sql immutable as $$
  select case p_restart when 'yearly' then to_char(p_on, 'YYYY') when 'monthly' then to_char(p_on, 'YYYY-MM') else 'all' end $$;
create function public.banking_number_format(p_format text, p_digits int, p_serial int, p_on date) returns text language sql immutable as $$
  select replace(replace(replace(p_format, '{YYYY}', to_char(p_on, 'YYYY')), '{MM}', to_char(p_on, 'MM')), '{SERIAL}', lpad(p_serial::text, greatest(p_digits, length(p_serial::text)), '0')) $$;
create function public.hub_next_number(p_department text, p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := (select value from hub_settings where key = 'document_numbering') -> p_department -> p_kind;
  v_on date := (now() at time zone 'Asia/Dubai')::date; v_period text; v_serial int; v_number text;
begin
  if cfg is null then raise exception 'No numbering set for % %', p_department, p_kind; end if;
  v_period := banking_number_period(cfg ->> 'restart', v_on);
  insert into hub_number_counters (department, kind, period) values (p_department, p_kind, v_period) on conflict do nothing;
  select last_serial into v_serial from hub_number_counters where department = p_department and kind = p_kind and period = v_period for update;
  loop
    v_serial := v_serial + 1;
    v_number := banking_number_format(cfg ->> 'format', (cfg ->> 'digits')::int, v_serial, v_on);
    exit when not exists (select 1 from voucher_register where voucher_number = v_number);
  end loop;
  update hub_number_counters set last_serial = v_serial where department = p_department and kind = p_kind and period = v_period;
  return v_number;
end $$;

-- ...0a holds accounts.review and payments.view, ...0c payments.view only (like FINANCE), ...0d accounts.review only,
-- ...0e the real ACCOUNTS list from 001, ...0b nothing. As in the real function, profiles.role = 'admin' passes everything.
create function public.banking_can(p text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select true from profiles where id = auth.uid() and role = 'admin'),
    case when auth.uid() = '00000000-0000-0000-0000-00000000000e'::uuid
           then p in ('app.access','accounts.review','cases.view','quotes.view','payments.view','apps.view','docs.view','agreements.view')
         when p = 'accounts.review' then auth.uid() in ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000d'::uuid)
         when p = 'payments.view' then auth.uid() in ('00000000-0000-0000-0000-00000000000a'::uuid, '00000000-0000-0000-0000-00000000000c'::uuid)
         else false end,
    false) $$;
create function public.banking_require(p text) returns void language plpgsql stable security definer as $$
begin if not banking_can(p) then raise exception 'You do not have permission to do this'; end if; end $$;
create function public.banking_append_only() returns trigger language plpgsql as $$
begin raise exception 'This record cannot be changed or deleted'; end $$;
grant execute on function public.banking_can(text), public.banking_require(text) to authenticated;

-- Live voucher_register_read policy (permissive), copied as it is
create policy voucher_register_read on public.voucher_register for select to authenticated using (
  source = 'hub' or (voucher_type = 'Receipt' and banking_can('payments.view'))
  or (voucher_type = 'Quotation' and banking_can('quotes.view')) or (voucher_type = 'Engagement Letter' and banking_can('agreements.view')));

-- Live storage: RLS on, and the permissive Template Hub read policy that limits by bucket only
create schema storage;
grant usage on schema storage to anon, authenticated;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select on storage.objects to authenticated;
create policy hub_docs_read on storage.objects for select to authenticated using (bucket_id = 'hub-documents');
