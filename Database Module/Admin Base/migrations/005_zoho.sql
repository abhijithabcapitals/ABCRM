-- =====================================================================
-- Admin Base - Zoho Books link and document tables                 005
-- =====================================================================
-- zoho_contact_links: which Zoho contact stands for which CRM client.
-- zoho_documents: each draft estimate or invoice the CRM asked Zoho to create, and what Zoho reported back.
-- Only the zoho-books Edge Function (service role) reads and writes these. Browser users have no access;
-- read policies by department come with the draft work.
-- source_id has no foreign key, because the source tables differ (hub_documents, banking_quotations).
-- The audit trigger comes from the hourly job in 003, so none is added here.
-- Run after 004. Idempotent. Undo: rollback/005_rollback.sql
-- =====================================================================
create table if not exists public.zoho_contact_links (
  client_id text primary key references public.client_master (client_id),
  zoho_contact_id text not null,
  zoho_contact_name text not null,
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz not null default now()
);

create table if not exists public.zoho_documents (
  id uuid primary key default gen_random_uuid(),
  department text not null check (department in ('Business Setup', 'Banking')),
  source_table text not null check (source_table in ('hub_documents', 'banking_quotations')),
  source_id uuid not null,
  kind text not null check (kind in ('estimate', 'invoice')),
  reference text not null,
  state text not null check (state in ('creating', 'created', 'failed', 'unknown', 'gone')),
  zoho_id text,
  zoho_number text,
  zoho_status text,
  error text,
  total numeric(18,2),
  balance numeric(18,2),
  crm_total numeric(18,2),
  last_read_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists zoho_documents_one_per_source on public.zoho_documents (source_table, source_id, kind);

alter table public.zoho_contact_links enable row level security;
alter table public.zoho_documents enable row level security;
revoke all on public.zoho_contact_links, public.zoho_documents from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.zoho_contact_links, public.zoho_documents to service_role;
-- Earlier read policies are removed. With none, only the service role gets in.
drop policy if exists zoho_contact_links_read on public.zoho_contact_links;
drop policy if exists zoho_documents_read on public.zoho_documents;
