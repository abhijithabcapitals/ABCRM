-- =====================================================================
-- Admin Base - Zoho finance snapshot                               009
-- =====================================================================
-- One row (id = 1) holding the latest Zoho financial figures for the Dashboard cards.
-- data: the figures as JSON. as_of: when they were read. status: ok, partial or failed (null until the first read).
-- error: what went wrong on the last read. calls_used: Zoho API calls the last read spent.
-- refreshing_since: set while a refresh runs, so two refreshes do not start together.
-- last_attempt_at: when a refresh last started, whether or not it worked. A failure keeps the old as_of, so this limits retries.
-- Admins read it through RLS. Only the service role (the Edge Function) updates it. Nobody inserts or deletes.
-- Left out of the audit trail: it is a rebuildable cache of Zoho figures and Zoho stays the record. Logging it would copy
-- the financial data into the permanent audit_trail on every refresh. So this file redefines audit_trail_attach_all (from 003,
-- the newest definition, only the exclusion list changed) and removes the trigger if the hourly job already attached it.
-- Prerequisites: 001 (admin_is) and 003 (audit_trail_capture, and the audit_trail_attach_all this replaces).
-- After applying, run: notify pgrst, 'reload schema';  so PostgREST can see the new table.
-- Applied live 2026-11-04 as admin_009_zoho_finance. Idempotent. Undo: rollback/009_zoho_finance_rollback.sql
-- =====================================================================

begin;

create table if not exists public.zoho_finance_snapshot (
  id int primary key default 1 check (id = 1),
  data jsonb,
  as_of timestamptz,
  status text check (status in ('ok', 'partial', 'failed')),
  error text,
  calls_used int,
  refreshing_since timestamptz,
  last_attempt_at timestamptz
);

insert into public.zoho_finance_snapshot (id) values (1) on conflict (id) do nothing;

alter table public.zoho_finance_snapshot enable row level security;
revoke all on public.zoho_finance_snapshot from public, anon, authenticated, service_role;
grant select on public.zoho_finance_snapshot to authenticated;
grant select, update on public.zoho_finance_snapshot to service_role;
drop policy if exists zoho_finance_snapshot_admin_read on public.zoho_finance_snapshot;
create policy zoho_finance_snapshot_admin_read on public.zoho_finance_snapshot for select to authenticated using ((select public.admin_is()));

-- Audit exclusion. Function body is 003's, with ('public', 'zoho_finance_snapshot') added to the exclusion list.
create or replace function public.audit_trail_attach_all() returns table (attached int, failed text[]) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  t record;
  pk text;
  done int := 0;
  bad text[] := '{}';
begin
  for t in
    select c.oid, n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname in ('public', 'acct', 'ceo', 'email_base', 'email_agent')
      and (n.nspname, c.relname) not in (('public', 'audit_trail'), ('public', 'admin_audit'), ('public', 'hr_audit_log'), ('public', 'banking_activity_logs'), ('public', 'bd_audit_logs'), ('public', 'ai_usage'), ('ceo', 'audit_logs'), ('public', 'zoho_finance_snapshot'))
      and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'audit_trail_row')
  loop
    select string_agg(quote_literal(a.attname), ', ' order by k.ord) into pk
    from pg_index i cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = t.oid and i.indisprimary;
    begin
      execute format('create trigger audit_trail_row after insert or update or delete on %I.%I for each row execute function public.audit_trail_capture(%s)', t.nspname, t.relname, coalesce(pk, ''));
      done := done + 1;
    exception when others then
      bad := bad || (t.nspname || '.' || t.relname || ': ' || sqlerrm);
    end;
  end loop;
  return query select done, bad;
end $$;

revoke all on function public.audit_trail_attach_all() from public, anon, authenticated;
drop trigger if exists audit_trail_row on public.zoho_finance_snapshot;

commit;
