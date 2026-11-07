-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set ann 00000000-0000-0000-0000-0000000000a1
\set bob 00000000-0000-0000-0000-0000000000a2
\set cat 00000000-0000-0000-0000-0000000000a3
\set dee 00000000-0000-0000-0000-0000000000a4
drop schema if exists z cascade;
create schema z;
grant usage on schema z to public;
create function z.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function z.fails(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema z to public;
create table z.v (name text primary key, val text);
grant all on z.v to public;

-- Cat is an admin but not in the group: admins get no exception.
insert into public.profiles (id, role, full_name) values (:'ann', 'member', 'Ann Z'), (:'bob', 'member', 'Bob Z'), (:'cat', 'admin', 'Cat Z'), (:'dee', 'member', 'Dee Z');

set role authenticated;
select set_config('test.uid', :'ann', false);
insert into z.v select 'grp', public.messenger_create_group('Lead LD-1 · Co', array[:'bob']::uuid[])::text;
insert into public.messenger_messages (conversation_id, sender_id, body) select val::uuid, :'ann', 'Lead LD-1' from z.v where name = 'grp';

-- Archive is per person and can be undone.
select set_config('test.uid', :'bob', false);
select public.messenger_set_archived((select val::uuid from z.v where name = 'grp'), true);
select z.ok('Bob sees the group as archived', (select archived from public.messenger_chat_list() where id = (select val::uuid from z.v where name = 'grp')));
select set_config('test.uid', :'ann', false);
select z.ok('Ann still sees it as not archived', not (select archived from public.messenger_chat_list() where id = (select val::uuid from z.v where name = 'grp')));
select set_config('test.uid', :'bob', false);
select public.messenger_set_archived((select val::uuid from z.v where name = 'grp'), false);
select z.ok('Bob can restore it', not (select archived from public.messenger_chat_list() where id = (select val::uuid from z.v where name = 'grp')));
select set_config('test.uid', :'dee', false);
select z.ok('someone not in the chat cannot archive it', z.fails(format('select public.messenger_set_archived(%L, true)', (select val from z.v where name = 'grp'))));

-- The owner may rename and add people; a member and an outside admin may not delete.
select set_config('test.uid', :'ann', false);
select public.messenger_rename_group((select val::uuid from z.v where name = 'grp'), 'Lead LD-1 · New name');
select public.messenger_add_members((select val::uuid from z.v where name = 'grp'), array[:'dee']::uuid[]);
select z.ok('the owner renamed the group and added Dee', (select title = 'Lead LD-1 · New name' and member_count = 3 from public.messenger_chat_list() where id = (select val::uuid from z.v where name = 'grp')));
select set_config('test.uid', :'bob', false);
select z.ok('a member cannot delete the group', z.fails(format('select public.messenger_delete_group(%L)', (select val from z.v where name = 'grp'))));
select set_config('test.uid', :'cat', false);
select z.ok('an admin outside the group cannot delete it', z.fails(format('select public.messenger_delete_group(%L)', (select val from z.v where name = 'grp'))));

-- A direct chat cannot be deleted through this function.
select set_config('test.uid', :'ann', false);
insert into z.v select 'dm', public.messenger_start_direct(:'bob')::text;
select z.ok('a direct chat cannot be deleted', z.fails(format('select public.messenger_delete_group(%L)', (select val from z.v where name = 'dm'))));

select public.messenger_delete_group((select val::uuid from z.v where name = 'grp'));
reset role;
select z.ok('the owner deleted the group with its members and messages',
  not exists (select 1 from public.messenger_conversations where id = (select val::uuid from z.v where name = 'grp'))
  and not exists (select 1 from public.messenger_members where conversation_id = (select val::uuid from z.v where name = 'grp'))
  and not exists (select 1 from public.messenger_messages where conversation_id = (select val::uuid from z.v where name = 'grp')));

set role anon;
select z.ok('anon cannot archive', z.fails('select public.messenger_set_archived(gen_random_uuid(), true)'));
select z.ok('anon cannot delete', z.fails('select public.messenger_delete_group(gen_random_uuid())'));
reset role;

do $$ begin raise notice 'all archive and delete checks passed'; end $$;
drop schema z cascade;
