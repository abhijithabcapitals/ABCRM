-- Undoes 009_zoho_finance.sql. Restores 003's audit_trail_attach_all, then drops the Zoho finance snapshot table and its single row.

begin;

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
      and (n.nspname, c.relname) not in (('public', 'audit_trail'), ('public', 'admin_audit'), ('public', 'hr_audit_log'), ('public', 'banking_activity_logs'), ('public', 'bd_audit_logs'), ('public', 'ai_usage'), ('ceo', 'audit_logs'))
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
-- Drops the Zoho finance snapshot table and its single row. The Dashboard cards then have no Zoho figures until 009 runs again.
drop table if exists public.zoho_finance_snapshot;

commit;
