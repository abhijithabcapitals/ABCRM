-- =====================================================================
-- Admin Base - Zoho finance snapshot                               008
-- =====================================================================
-- One row (id = 1) holding the latest Zoho financial figures for the Dashboard cards.
-- data: the figures as JSON. as_of: when they were read. status: ok, partial or failed (null until the first read).
-- error: what went wrong on the last read. calls_used: Zoho API calls the last read spent.
-- refreshing_since: set while a refresh runs, so two refreshes do not start together.
-- Admins read it through RLS. Only the service role (the Edge Function) updates it. Nobody inserts or deletes.
-- Run after 005. NOT APPLIED to the live database. Idempotent. Undo: rollback/008_rollback.sql
-- =====================================================================
create table if not exists public.zoho_finance_snapshot (
  id int primary key default 1 check (id = 1),
  data jsonb,
  as_of timestamptz,
  status text check (status in ('ok', 'partial', 'failed')),
  error text,
  calls_used int,
  refreshing_since timestamptz
);

insert into public.zoho_finance_snapshot (id) values (1) on conflict (id) do nothing;

alter table public.zoho_finance_snapshot enable row level security;
revoke all on public.zoho_finance_snapshot from public, anon, authenticated, service_role;
grant select on public.zoho_finance_snapshot to authenticated;
grant select, update on public.zoho_finance_snapshot to service_role;
drop policy if exists zoho_finance_snapshot_admin_read on public.zoho_finance_snapshot;
create policy zoho_finance_snapshot_admin_read on public.zoho_finance_snapshot for select to authenticated using ((select public.admin_is()));
