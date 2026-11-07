-- The parts of Supabase and the live CRM that Client Base 007 (OneDrive folder map) needs, for a throwaway local database.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated, service_role;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;

-- ...0a admin, ...0b HR, ...0c Client Master user, ...0d nobody
create table public.profiles (id uuid primary key, role text);
insert into public.profiles values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'member'), ('00000000-0000-0000-0000-00000000000d', 'member');
create function public.admin_is() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') $$;
create function public.hub_is_admin() returns boolean language sql stable security definer set search_path = public, pg_temp as $$ select admin_is() $$;
create function public.hr_is_admin_or_hr() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select admin_is() or auth.uid() = '00000000-0000-0000-0000-00000000000b' $$;
create function public.client_master_can(p text) returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() = '00000000-0000-0000-0000-00000000000c' $$;
grant execute on function public.admin_is(), public.hub_is_admin(), public.hr_is_admin_or_hr(), public.client_master_can(text) to authenticated;

create table public.client_master (client_id text primary key, legal_name text not null, data jsonb not null default '{}');
insert into public.client_master (client_id, legal_name) values
  ('CL000075', 'Apex LLC'), ('CL000020', 'CURVEBALL EVENTS'), ('CL000122', 'EnergyOptimaa FZCO'),
  ('CL000225', 'Prime Gold Trading LLC'), ('CL000251', 'Sea Prime Capitals LLC'), ('CL000089', 'B&B International Holdings LLC'),
  ('CL000141', 'Golden Leap'), ('CL000304', 'GOLDEN LEAP COMMERCIAL BROKERS');
create table public.hr_employees (id uuid primary key default gen_random_uuid(), employee_code text, full_name text, status text);
insert into public.hr_employees values ('00000000-0000-0000-0000-0000000000e1', 'ABC-027', 'GEO', 'Active'),
  ('00000000-0000-0000-0000-0000000000e2', 'NEW-RISHU', 'RISHU', 'Left'), ('00000000-0000-0000-0000-0000000000e3', 'ABC-008', 'ABAIZ', 'Active');
create table public.bd_leads (id uuid primary key default gen_random_uuid(), lead_number text, company_name text, prospect_name text, archived_at timestamptz);
insert into public.bd_leads values ('00000000-0000-0000-0000-0000000000f1', 'LD-2026-000002', 'HMR Konsultan', null, null);

-- Document tables the view reads (only the columns it uses).
create table public.hub_documents (id uuid primary key default gen_random_uuid(), client_id text, department text, doc_type text, document_number text,
  storage_path text, onedrive_path text, signed_path text, created_at timestamptz default now());
create table public.business_setup_documents (id uuid primary key default gen_random_uuid(), client_id text, kind text, file_name text, storage_path text, created_at timestamptz default now());
create table public.business_setup_invoices (id uuid primary key default gen_random_uuid(), client_id text, invoice_number text, file_path text, created_at timestamptz default now());
create table public.business_setup_payments (id uuid primary key default gen_random_uuid(), client_id text);
create table public.business_setup_receipts (id uuid primary key default gen_random_uuid(), payment_id uuid, receipt_number text, storage_path text, local_path text, created_at timestamptz default now());
create table public.business_setup_signed_quotes (id uuid primary key default gen_random_uuid(), quote_id uuid, storage_path text, created_at timestamptz default now());
create table public.client_portal_accounts (id uuid primary key default gen_random_uuid(), client_master_id text);
create table public.client_portal_documents (id uuid primary key default gen_random_uuid(), account_id uuid, doc_type text, file_name text, storage_path text,
  filed_path text, local_path text, uploaded_at timestamptz default now());
create table public.banking_clients (id uuid primary key default gen_random_uuid(), client_master_id varchar);
create table public.banking_cases (id uuid primary key default gen_random_uuid(), client_id uuid);
create table public.banking_generated_documents (id uuid primary key default gen_random_uuid(), case_id uuid, kind text, document_number text, file_name text,
  storage_path text, local_path text, created_at timestamptz default now());
create table public.banking_documents (id uuid primary key default gen_random_uuid(), client_id uuid, title text, deleted_at timestamptz);
create table public.banking_document_versions (id uuid primary key default gen_random_uuid(), document_id uuid, file_name text, storage_path text, created_at timestamptz default now());
create table public.accounting_jobs (id uuid primary key default gen_random_uuid(), client_id text);
create table public.accounting_payments (id uuid primary key default gen_random_uuid(), job_id uuid);
create table public.accounting_receipts (id uuid primary key default gen_random_uuid(), payment_id uuid, receipt_number text, storage_path text, created_at timestamptz default now());
create table public.hr_documents (id uuid primary key default gen_random_uuid(), employee_id uuid, doc_type text, storage_path text, created_at timestamptz default now());
create table public.hr_requests (id uuid primary key default gen_random_uuid(), employee_id uuid, kind text, storage_path text, created_at timestamptz default now());
create table public.bd_lead_documents (id uuid primary key default gen_random_uuid(), lead_id uuid, file_name text, file_path text, created_at timestamptz default now());
grant select on all tables in schema public to authenticated;
