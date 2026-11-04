-- Zoho finance snapshot: one row, admin read only, service role writes. Runs on the throwaway cluster after 040.
\set ON_ERROR_STOP on
create schema t5;
grant usage on schema t5 to public;
create function t5.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t5.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok %', label;
    return;
  end;
  raise exception 'FAILED: % (it worked)', label;
end $$;
grant execute on all functions in schema t5 to public;

insert into public.profiles (id, role) values ('00000000-0000-0000-0000-0000000000a5', 'admin'), ('00000000-0000-0000-0000-0000000000b5', 'member') on conflict (id) do update set role = excluded.role;

select t5.ok('the migration seeds exactly one row with id 1', (select count(*) = 1 and min(id) = 1 from public.zoho_finance_snapshot));
select t5.fails('a second row (id 2) fails', $$insert into public.zoho_finance_snapshot (id) values (2)$$);
select t5.fails('a bad status fails', $$update public.zoho_finance_snapshot set status = 'weird'$$);
select t5.ok('authenticated holds only select', has_table_privilege('authenticated', 'public.zoho_finance_snapshot', 'select')
  and not has_table_privilege('authenticated', 'public.zoho_finance_snapshot', 'insert')
  and not has_table_privilege('authenticated', 'public.zoho_finance_snapshot', 'update')
  and not has_table_privilege('authenticated', 'public.zoho_finance_snapshot', 'delete'));
select t5.ok('anon holds no privilege', not exists (select 1 from unnest(array['select', 'insert', 'update', 'delete']) p where has_table_privilege('anon', 'public.zoho_finance_snapshot', p)));
select t5.ok('the service role holds select and update only', has_table_privilege('service_role', 'public.zoho_finance_snapshot', 'select')
  and has_table_privilege('service_role', 'public.zoho_finance_snapshot', 'update')
  and not has_table_privilege('service_role', 'public.zoho_finance_snapshot', 'insert')
  and not has_table_privilege('service_role', 'public.zoho_finance_snapshot', 'delete'));
select t5.ok('the table is under row level security', (select relrowsecurity from pg_class where oid = 'public.zoho_finance_snapshot'::regclass));

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a5', false);
select t5.ok('an admin reads one row', (select count(*) = 1 from public.zoho_finance_snapshot));
select t5.fails('an admin cannot update', $$update public.zoho_finance_snapshot set status = 'ok'$$);
select t5.fails('an admin cannot insert', $$insert into public.zoho_finance_snapshot (id) values (1)$$);
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b5', false);
select t5.ok('a non-admin reads zero rows', (select count(*) = 0 from public.zoho_finance_snapshot));
select t5.fails('a non-admin cannot update', $$update public.zoho_finance_snapshot set status = 'ok'$$);
select t5.fails('a non-admin cannot insert', $$insert into public.zoho_finance_snapshot (id) values (1)$$);
select t5.fails('a non-admin cannot delete', $$delete from public.zoho_finance_snapshot$$);
reset role;
select set_config('test.uid', '', false);
set role anon;
select t5.fails('anon cannot read', $$select count(*) from public.zoho_finance_snapshot$$);
reset role;
set role service_role;
update public.zoho_finance_snapshot set data = '{"a":1}', status = 'ok', calls_used = 3, as_of = now();
select t5.ok('the service role writes the snapshot', (select status = 'ok' and calls_used = 3 and data = '{"a":1}'::jsonb from public.zoho_finance_snapshot));
reset role;

-- The hourly audit job must skip this table and still work on others.
create table public.t5_other (id int primary key);
select public.audit_trail_attach_all();
select t5.ok('the audit job does not attach to the snapshot table', not exists (select 1 from pg_trigger where tgrelid = 'public.zoho_finance_snapshot'::regclass and tgname = 'audit_trail_row'));
select t5.ok('the audit job still attaches to other tables', exists (select 1 from pg_trigger where tgrelid = 'public.t5_other'::regclass and tgname = 'audit_trail_row'));
drop table public.t5_other;
-- Marker for the second-migration-pass data check in run-local.sh.
update public.zoho_finance_snapshot set calls_used = 77;
