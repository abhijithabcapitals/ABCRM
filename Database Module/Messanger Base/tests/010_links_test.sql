-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
-- Passes when the statement raises an error containing `expect`.
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
create function t.n(q text) returns bigint language plpgsql as $$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
grant execute on all functions in schema t to public;

-- Data, loaded as the database owner. a = admin, b owns client C1, c has no access, d owns client C2 only.
insert into profiles values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'member'), ('00000000-0000-0000-0000-00000000000d', 'member');
insert into client_master values ('C1', 'Test Client One', '00000000-0000-0000-0000-00000000000b');
insert into client_master values ('C2', 'Test Client Two', '00000000-0000-0000-0000-00000000000d');
insert into crm_communication_links (record_type, record_id, link_type, reference, label, created_by)
  values ('client', 'C1', 'chat', 'ref-1', 'Seed', '00000000-0000-0000-0000-00000000000b'),
         ('client', 'C1', 'channel', 'ref-5', 'Made by c', '00000000-0000-0000-0000-00000000000c');

-- Person with access
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t.ok('person with access sees the client link', t.n('select 1 from crm_communication_links where reference = ''ref-1''') = 1);
insert into crm_communication_links (record_type, record_id, link_type, reference) values ('client', 'C1', 'meeting', 'ref-2');
select t.ok('person with access can add a link, created_by defaults to them', t.n('select 1 from crm_communication_links where reference = ''ref-2'' and created_by = auth.uid()') = 1);
select t.fails('repeat of the same reference is refused', 'insert into crm_communication_links (record_type, record_id, link_type, reference) values (''client'', ''C1'', ''meeting'', ''ref-2'')', 'duplicate key');
select t.fails('person cannot insert with another created_by', 'insert into crm_communication_links (record_type, record_id, link_type, reference, created_by) values (''client'', ''C1'', ''channel'', ''ref-3'', ''00000000-0000-0000-0000-00000000000c'')', 'row-level security');
select t.fails('no update grant', 'update crm_communication_links set label = ''x''', 'permission denied');

-- Person who cannot see the client
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select t.ok('person without access sees none', t.n('select 1 from crm_communication_links') = 0);
select t.fails('person without access cannot insert', 'insert into crm_communication_links (record_type, record_id, link_type, reference) values (''client'', ''C1'', ''chat'', ''ref-4'')', 'row-level security');

-- b sees C1 but did not create ref-5 (c did): the delete policy alone must refuse
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
with d as (delete from crm_communication_links where reference = 'ref-5' returning 1)
  select t.ok('person who sees the parent cannot delete a row they did not create', (select count(*) from d) = 0);
select t.ok('that row is still there', t.n('select 1 from crm_communication_links where reference = ''ref-5''') = 1);

-- d cannot see C1 at all (hidden parent)
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000d', false);
set role authenticated;
with d as (delete from crm_communication_links where reference = 'ref-1' returning 1)
  select t.ok('person cannot delete another''s row', (select count(*) from d) = 0);

-- Admin
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
with d as (delete from crm_communication_links where reference = 'ref-1' returning 1)
  select t.ok('admin can delete another''s row', (select count(*) from d) = 1);

-- Own row
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
with d as (delete from crm_communication_links where reference = 'ref-2' returning 1)
  select t.ok('person can delete own row', (select count(*) from d) = 1);

-- anon
reset role;
select set_config('test.uid', '', false);
set role anon;
select t.fails('anon reads nothing', 'select * from crm_communication_links', 'permission denied');
reset role;
select t.ok('all link checks passed', true);
