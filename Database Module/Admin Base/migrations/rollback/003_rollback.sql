-- Removes the audit trail triggers and job. The table and its entries are kept: drop them only on purpose.
do $$
declare t record;
begin
  perform cron.unschedule('audit-trail-attach');
  for t in select c.oid::regclass as tbl from pg_trigger g join pg_class c on c.oid = g.tgrelid where g.tgname = 'audit_trail_row' loop
    execute format('drop trigger audit_trail_row on %s', t.tbl);
  end loop;
end $$;
drop function if exists public.audit_trail_attach_all();
drop function if exists public.audit_trail_capture();
drop function if exists public.audit_trail_clean(jsonb);
