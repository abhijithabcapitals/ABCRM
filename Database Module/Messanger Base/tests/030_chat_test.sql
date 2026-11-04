-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
-- 31 = admin who is in no chat, 32 = Olive (creates chats), 33 = Bob, 34 = Cara, 35 = Dan (outsider), 36 = Eve (deleted later).
\set ON_ERROR_STOP on
\set adm 00000000-0000-0000-0000-000000000031
\set olive 00000000-0000-0000-0000-000000000032
\set bob 00000000-0000-0000-0000-000000000033
\set cara 00000000-0000-0000-0000-000000000034
\set dan 00000000-0000-0000-0000-000000000035
\set eve 00000000-0000-0000-0000-000000000036
\set frank 00000000-0000-0000-0000-000000000037
\set gina 00000000-0000-0000-0000-000000000038
\set hal 00000000-0000-0000-0000-000000000039
\set ivy 00000000-0000-0000-0000-000000000040
\set jon 00000000-0000-0000-0000-000000000041
drop schema if exists t cascade;
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
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

insert into profiles values (:'adm', 'admin', 'Ada Admin'), (:'olive', 'member', 'Olive Owner'), (:'bob', 'member', 'Bob'), (:'cara', 'member', 'Cara'), (:'dan', 'member', 'Dan Outsider'), (:'eve', 'member', 'Eve'), (:'frank', 'member', 'Frank'), (:'gina', 'member', 'Gina'), (:'hal', 'member', 'Hal'), (:'ivy', 'member', 'Ivy'), (:'jon', 'member', 'Jon');
select t.ok('chat tables have row security', (select count(*) from pg_class where relname in ('messenger_conversations', 'messenger_members', 'messenger_messages') and relrowsecurity) = 3);
select t.ok('messages are in the realtime publication', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_messages'));
select t.ok('internal functions are not executable by browser roles', not has_function_privilege('authenticated', 'public.messenger_touch_conversation()', 'execute') and not has_function_privilege('anon', 'public.messenger_touch_conversation()', 'execute') and not has_function_privilege('authenticated', 'public.messenger_require_owner(uuid, uuid)', 'execute') and not has_function_privilege('authenticated', 'public.messenger_after_member_delete()', 'execute') and not has_function_privilege('anon', 'public.messenger_after_member_delete()', 'execute'));
select t.fails('a group with no title is refused', $$insert into messenger_conversations (kind) values ('group')$$, 'violates check');
select t.fails('a direct chat with a title is refused', $$insert into messenger_conversations (kind, title, direct_key) values ('direct', 'T', 'k')$$, 'violates check');

-- Olive creates a direct chat with Bob and groups
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_start_direct(:'bob') as d1 \gset
select messenger_create_group('Team', array[:'bob', :'cara']::uuid[]) as g \gset
select messenger_create_group('  Padded  ', array[:'bob', :'bob', :'olive']::uuid[]) as gpad \gset
select messenger_create_group('Olive and Cara', array[:'cara']::uuid[]) as gc \gset
select t.ok('group title is trimmed, duplicate and self members collapse', (select title from messenger_chat_list() where id = :'gpad') = 'Padded' and (select member_count from messenger_chat_list() where id = :'gpad') = 2);
select t.fails('group needs a title', format($$select messenger_create_group('   ', array[%L]::uuid[])$$, :'bob'), 'Group name');
select t.fails('group title over 80 characters refused', format($$select messenger_create_group(%L, array[%L]::uuid[])$$, repeat('x', 81), :'bob'), 'Group name');
select t.fails('group needs another member', 'select messenger_create_group(''Solo'', array[]::uuid[])', 'at least one');
select t.fails('group of only myself refused', format($$select messenger_create_group('Solo', array[%L]::uuid[])$$, :'olive'), 'at least one');
select t.fails('group with an unknown member refused', $$select messenger_create_group('Ghost', array['00000000-0000-0000-0000-0000000000ff']::uuid[])$$, 'not a staff member');
select t.fails('chat with myself refused', format('select messenger_start_direct(%L)', :'olive'), 'yourself');
select t.fails('chat with an unknown person refused', $$select messenger_start_direct('00000000-0000-0000-0000-0000000000ff')$$, 'not a staff member');
insert into messenger_messages (conversation_id, sender_id, body) values (:'g', :'olive', 'hello group'), (:'d1', :'olive', 'hi bob');
select t.ok('owner reads own messages', t.n($$select * from messenger_messages$$) = 2);

-- Direct chat from both sides is one chat
reset role;
select set_config('test.uid', :'bob', false);
set role authenticated;
select messenger_start_direct(:'olive') as d1b \gset
select t.ok('start_direct from the other side gives the same chat', :'d1b' = :'d1');
select t.ok('only one direct chat exists', (select count(*) from messenger_conversations where kind = 'direct') = 1);
select t.ok('direct chat lists the other person for each side', (select other_name from messenger_chat_list() where id = :'d1') = 'Olive Owner');

-- Member inserts
insert into messenger_messages (conversation_id, sender_id, body) values (:'g', :'bob', 'hi all');
select t.ok('member sends a message', t.n($$select * from messenger_messages where body = 'hi all'$$) = 1);
select t.fails('member cannot send as someone else', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, %L, 'faked')$$, :'g', :'olive'), 'row-level security');
select t.fails('member cannot send with no sender', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, null, 'anon')$$, :'g'), 'row-level security');
select t.fails('member cannot send to a chat they are not in', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, %L, 'x')$$, :'gc', :'bob'), 'row-level security');
insert into messenger_messages (conversation_id, sender_id, body, created_at) values (:'g', :'bob', 'back dated', '2000-01-01') ;
reset role;
select t.ok('a supplied created_at is overwritten', (select created_at from messenger_messages where body = 'back dated') > now() - interval '1 minute');
set role authenticated;
select t.fails('same message id twice is refused', format($$insert into messenger_messages (id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000a1', %L, %L, 'once'), ('00000000-0000-0000-0000-0000000000a1', %L, %L, 'twice')$$, :'g', :'bob', :'g', :'bob'), 'duplicate key');
select t.fails('empty message refused', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, %L, '')$$, :'g', :'bob'), 'violates check');
select t.fails('message over 4000 characters refused', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, %L, repeat('x', 4001))$$, :'g', :'bob'), 'violates check');
select t.fails('web link not starting https refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'web', 'http://example.test', 'Site')$$, :'g', :'bob'), 'violates check');
select t.fails('web link with no scheme refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'web', 'javascript:alert(1)', 'Site')$$, :'g', :'bob'), 'violates check');
select t.fails('web link with no target refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'web', null, 'Site')$$, :'g', :'bob'), 'violates check');
select t.fails('client link with no target refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'client', null, 'Client')$$, :'g', :'bob'), 'violates check');
select t.fails('link target over 2000 characters refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'client', repeat('x', 2001), 'Client')$$, :'g', :'bob'), 'violates check');
select t.fails('link label over 300 characters refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'client', 'ABC', repeat('x', 301))$$, :'g', :'bob'), 'violates check');
select t.fails('link reference without a type refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_ref, link_label) values (%L, %L, 'see', 'https://example.test', 'Site')$$, :'g', :'bob'), 'violates check');
select t.fails('unknown link type refused', format($$insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (%L, %L, 'see', 'file', 'x', 'X')$$, :'g', :'bob'), 'violates check');
insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (:'g', :'bob', 'see', 'web', 'https://example.test', 'Site'), (:'g', :'bob', 'client', 'client', 'ABC-001', 'Client ABC-001: ABC Trading LLC');
select t.ok('https web link and client link accepted', t.n($$select * from messenger_messages where link_type is not null$$) = 2);

-- No direct writes, and no changes to messages
select t.fails('no direct insert into conversations', $$insert into messenger_conversations (kind, title) values ('group', 'X')$$, 'permission denied');
select t.fails('no direct insert into members', format($$insert into messenger_members (conversation_id, profile_id) values (%L, %L)$$, :'g', :'dan'), 'permission denied');
select t.fails('no direct update of conversations', $$update messenger_conversations set title = 'X'$$, 'permission denied');
select t.fails('no direct update of members', $$update messenger_members set role = 'owner'$$, 'permission denied');
select t.fails('no direct delete of conversations', 'delete from messenger_conversations', 'permission denied');
select t.fails('no direct delete of members', 'delete from messenger_members', 'permission denied');
select t.fails('no update of messages', $$update messenger_messages set body = 'edited'$$, 'permission denied');
select t.fails('no delete of messages', 'delete from messenger_messages', 'permission denied');

-- Non-owner cannot change a group
select t.fails('non-owner cannot add', format('select messenger_add_members(%L, array[%L]::uuid[])', :'g', :'dan'), 'owner');
select t.fails('non-owner cannot remove', format('select messenger_remove_member(%L, %L)', :'g', :'cara'), 'owner');
select t.fails('non-owner cannot rename', format($$select messenger_rename_group(%L, 'Mine')$$, :'g'), 'owner');
select t.fails('nobody can add members to a direct chat', format('select messenger_add_members(%L, array[%L]::uuid[])', :'d1', :'dan'), 'owner');
select t.fails('direct chat cannot be left', format('select messenger_leave(%L)', :'d1'), 'one-to-one');
select t.fails('read state refused for a chat I am not in', format('select messenger_read_state(%L)', :'gc'), 'not in this chat');
select t.fails('mark read refused for a chat I am not in', format('select messenger_mark_read(%L)', :'gc'), 'not in this chat');

-- Outsider and admin who are not members
reset role;
select set_config('test.uid', :'dan', false);
set role authenticated;
select t.ok('outsider reads no conversation', t.n('select * from messenger_conversations') = 0);
select t.ok('outsider reads no member', t.n('select * from messenger_members') = 0);
select t.ok('outsider reads no message', t.n('select * from messenger_messages') = 0);
select t.ok('outsider chat list is empty', t.n('select * from messenger_chat_list()') = 0);
select t.ok('outsider is not a member', not messenger_is_member(:'g'));
select t.fails('outsider cannot add themself', format('select messenger_add_members(%L, array[%L]::uuid[])', :'g', :'dan'), 'owner');
select t.fails('outsider cannot rename', format($$select messenger_rename_group(%L, 'Mine')$$, :'g'), 'owner');
select t.fails('outsider cannot leave', format('select messenger_leave(%L)', :'g'), 'not in this chat');
reset role;
select set_config('test.uid', :'adm', false);
set role authenticated;
select t.ok('admin outside the chat reads no conversation', t.n('select * from messenger_conversations') = 0);
select t.ok('admin outside the chat reads no member', t.n('select * from messenger_members') = 0);
select t.ok('admin outside the chat reads no message', t.n('select * from messenger_messages') = 0);
select t.ok('admin chat list omits the chat', t.n('select * from messenger_chat_list()') = 0);
select t.fails('admin cannot rename a chat they are not in', format($$select messenger_rename_group(%L, 'Mine')$$, :'g'), 'owner');
select t.fails('admin cannot remove a member of a chat they are not in', format('select messenger_remove_member(%L, %L)', :'g', :'bob'), 'owner');

-- Owner changes, and the removed member loses history
reset role;
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_add_members(:'g', array[:'dan', :'cara']::uuid[]);
select t.ok('owner added one new member, existing member ignored', (select member_count from messenger_chat_list() where id = :'g') = 4);
select messenger_rename_group(:'g', ' Team Two ');
select t.ok('owner renamed the group (trimmed)', (select title from messenger_chat_list() where id = :'g') = 'Team Two');
select t.fails('rename to empty refused', format($$select messenger_rename_group(%L, '')$$, :'g'), 'Group name');
select t.fails('add an unknown person refused', format($$select messenger_add_members(%L, array['00000000-0000-0000-0000-0000000000ff']::uuid[])$$, :'g'), 'not a staff member');
select t.fails('owner cannot remove themself', format('select messenger_remove_member(%L, %L)', :'g', :'olive'), 'leave');
select t.fails('remove someone who is not in the group refused', format('select messenger_remove_member(%L, %L)', :'g', :'eve'), 'not in this chat');
reset role;
select set_config('test.uid', :'dan', false);
set role authenticated;
select t.ok('added member reads earlier messages', t.n($$select * from messenger_messages$$) >= 5);
reset role;
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_remove_member(:'g', :'dan');
reset role;
select set_config('test.uid', :'dan', false);
set role authenticated;
select t.ok('removed member reads no earlier message', t.n('select * from messenger_messages') = 0);
select t.ok('removed member reads no conversation', t.n('select * from messenger_conversations') = 0);
select t.ok('removed member chat list is empty', t.n('select * from messenger_chat_list()') = 0);
reset role;

-- Unread counts and chat list shape
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_create_group('Unread', array[:'bob']::uuid[]) as g2 \gset
reset role;
select set_config('test.uid', :'bob', false);
set role authenticated;
insert into messenger_messages (conversation_id, sender_id, body) values (:'g2', :'bob', 'one');
insert into messenger_messages (conversation_id, sender_id, body, link_type, link_ref, link_label) values (:'g2', :'bob', 'two', 'lead', 'LD-9', 'Lead LD-9');
select t.ok('own messages do not count as unread', (select unread from messenger_chat_list() where id = :'g2') = 0);
reset role;
select set_config('test.uid', :'olive', false);
set role authenticated;
select t.ok('two new messages from another person give unread 2', (select unread from messenger_chat_list() where id = :'g2') = 2);
select t.ok('list shows the latest message, its label and sender', (select last_body || '|' || last_link_label || '|' || last_sender_name || '|' || (last_sender_id = :'bob'::uuid)::text from messenger_chat_list() where id = :'g2') = 'two|Lead LD-9|Bob|true');
select t.ok('group row has no other person and the right member count', (select other_name is null and other_id is null and member_count = 2 and kind = 'group' and title = 'Unread' from messenger_chat_list() where id = :'g2'));
select t.ok('direct row names the other person', (select other_name = 'Bob' and other_id = :'bob'::uuid and kind = 'direct' and title is null from messenger_chat_list() where id = :'d1'));
select t.ok('list is newest first', (select id from messenger_chat_list() limit 1) = :'g2');
insert into messenger_messages (conversation_id, sender_id, body) values (:'g2', :'olive', 'mine');
select t.ok('sending my own message does not add unread', (select unread from messenger_chat_list() where id = :'g2') = 2);
select messenger_mark_read(:'g2');
select t.ok('mark read gives unread 0', (select unread from messenger_chat_list() where id = :'g2') = 0);
select messenger_mark_read(:'g2');
select t.ok('mark read twice is harmless', (select unread from messenger_chat_list() where id = :'g2') = 0);
reset role;
update messenger_members set last_read_at = now() + interval '1 hour' where conversation_id = :'g2' and profile_id = :'olive';
set role authenticated;
select messenger_mark_read(:'g2');
reset role;
select t.ok('mark read never moves backwards', (select last_read_at from messenger_members where conversation_id = :'g2' and profile_id = :'olive') > now() + interval '30 minutes');

-- Read state: the earliest of the others
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_create_group('Ticks', array[:'bob', :'cara']::uuid[]) as g3 \gset
reset role;
update messenger_members set last_read_at = now() - interval '1 hour' where conversation_id = :'g3' and profile_id = :'bob';
update messenger_members set last_read_at = now() - interval '2 hours' where conversation_id = :'g3' and profile_id = :'cara';
set role authenticated;
select t.ok('read state is the earliest of the others', (select messenger_read_state(:'g3')) = (select last_read_at from messenger_members where conversation_id = :'g3' and profile_id = :'cara'));
reset role;
select set_config('test.uid', :'cara', false);
set role authenticated;
select t.ok('read state ignores my own time', (select messenger_read_state(:'g3')) = (select last_read_at from messenger_members where conversation_id = :'g3' and profile_id = :'bob'));
reset role;
select set_config('test.uid', :'olive', false);
set role authenticated;
select t.ok('read state in a direct chat is the other person''s time', (select messenger_read_state(:'d1')) = (select last_read_at from messenger_members where conversation_id = :'d1' and profile_id = :'bob'));

-- Profile delete keeps messages, and a direct chat survives the other person leaving
select messenger_start_direct(:'eve') as d2 \gset
select messenger_create_group('Eve group', array[:'eve']::uuid[]) as g4 \gset
reset role;
select set_config('test.uid', :'eve', false);
set role authenticated;
insert into messenger_messages (conversation_id, sender_id, body) values (:'g4', :'eve', 'from eve'), (:'d2', :'eve', 'dm from eve');
reset role;
delete from profiles where id = :'eve';
select t.ok('deleting a profile keeps their messages with sender null', (select count(*) from messenger_messages where body in ('from eve', 'dm from eve') and sender_id is null) = 2);
select t.ok('deleting a profile removes their memberships', (select count(*) from messenger_members where profile_id = :'eve') = 0);
select set_config('test.uid', :'olive', false);
set role authenticated;
select t.ok('group shows an unknown sender as null', (select last_sender_name is null and last_sender_id is null and last_body = 'from eve' from messenger_chat_list() where id = :'g4'));
select t.ok('direct chat with a deleted person still lists, other_name null', (select other_name is null and other_id is null and member_count = 1 and last_body = 'dm from eve' from messenger_chat_list() where id = :'d2'));
reset role;

-- Leaving: ownership passes to the earliest joined, last one out deletes the group
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_create_group('Leavers', array[:'bob', :'cara']::uuid[]) as g5 \gset
insert into messenger_messages (conversation_id, sender_id, body) values (:'g5', :'olive', 'before leaving');
reset role;
update messenger_members set joined_at = now() - interval '1 day' where conversation_id = :'g5' and profile_id = :'bob';
update messenger_members set joined_at = now() - interval '2 days' where conversation_id = :'g5' and profile_id = :'cara';
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_leave(:'g5');
reset role;
select t.ok('last owner leaving passes ownership to the earliest joined', (select role from messenger_members where conversation_id = :'g5' and profile_id = :'cara') = 'owner' and (select role from messenger_members where conversation_id = :'g5' and profile_id = :'bob') = 'member' and (select count(*) from messenger_members where conversation_id = :'g5') = 2);
select set_config('test.uid', :'bob', false);
set role authenticated;
select messenger_leave(:'g5');
reset role;
select t.ok('a member leaving keeps the owner', (select role from messenger_members where conversation_id = :'g5' and profile_id = :'cara') = 'owner' and (select count(*) from messenger_members where conversation_id = :'g5') = 1);
select set_config('test.uid', :'cara', false);
set role authenticated;
select messenger_leave(:'g5');
reset role;
select t.ok('last member leaving deletes the group', (select count(*) from messenger_conversations where id = :'g5') = 0);
select t.ok('last member leaving deletes its messages', (select count(*) from messenger_messages where conversation_id = :'g5') = 0);

-- Deleting a profile settles the chats it was in
select set_config('test.uid', :'frank', false);
set role authenticated;
select messenger_create_group('Frank group', array[:'gina', :'hal']::uuid[]) as g7 \gset
reset role;
insert into messenger_messages (conversation_id, sender_id, body) values (:'g7', :'gina', 'from gina');
update messenger_members set joined_at = now() - interval '2 days' where conversation_id = :'g7' and profile_id = :'hal';
update messenger_members set joined_at = now() - interval '1 day' where conversation_id = :'g7' and profile_id = :'gina';
delete from profiles where id = :'frank';
select t.ok('deleting the owner profile passes ownership to the earliest joined', (select role from messenger_members where conversation_id = :'g7' and profile_id = :'hal') = 'owner' and (select role from messenger_members where conversation_id = :'g7' and profile_id = :'gina') = 'member' and (select count(*) from messenger_members where conversation_id = :'g7') = 2);
delete from profiles where id = :'gina';
select t.ok('deleting a non-owner profile keeps the owner', (select role from messenger_members where conversation_id = :'g7' and profile_id = :'hal') = 'owner' and (select count(*) from messenger_conversations where id = :'g7') = 1);
delete from profiles where id = :'hal';
select t.ok('deleting every member profile deletes the group', (select count(*) from messenger_conversations where id = :'g7') = 0);
select t.ok('deleting every member profile deletes its messages', (select count(*) from messenger_messages where conversation_id = :'g7') = 0);
select set_config('test.uid', :'ivy', false);
set role authenticated;
select messenger_start_direct(:'jon') as d3 \gset
insert into messenger_messages (conversation_id, sender_id, body) values (:'d3', :'ivy', 'hello jon');
reset role;
delete from profiles where id = :'jon';
select t.ok('a direct chat keeps its surviving member and messages', (select count(*) from messenger_members where conversation_id = :'d3' and profile_id = :'ivy' and role = 'member') = 1 and (select count(*) from messenger_messages where conversation_id = :'d3') = 1);

-- anon reaches nothing
select set_config('test.uid', '', false);
set role anon;
select t.fails('anon reads no conversations', 'select * from messenger_conversations', 'permission denied');
select t.fails('anon reads no members', 'select * from messenger_members', 'permission denied');
select t.fails('anon reads no messages', 'select * from messenger_messages', 'permission denied');
select t.fails('anon cannot send', format($$insert into messenger_messages (conversation_id, sender_id, body) values (%L, %L, 'x')$$, :'g', :'olive'), 'permission denied');
select t.fails('anon cannot run is_member', format('select messenger_is_member(%L)', :'g'), 'permission denied');
select t.fails('anon cannot run start_direct', format('select messenger_start_direct(%L)', :'olive'), 'permission denied');
select t.fails('anon cannot run create_group', format('select messenger_create_group(''X'', array[%L]::uuid[])', :'olive'), 'permission denied');
select t.fails('anon cannot run add_members', format('select messenger_add_members(%L, array[%L]::uuid[])', :'g', :'olive'), 'permission denied');
select t.fails('anon cannot run remove_member', format('select messenger_remove_member(%L, %L)', :'g', :'bob'), 'permission denied');
select t.fails('anon cannot run rename_group', format($$select messenger_rename_group(%L, 'X')$$, :'g'), 'permission denied');
select t.fails('anon cannot run leave', format('select messenger_leave(%L)', :'g'), 'permission denied');
select t.fails('anon cannot run mark_read', format('select messenger_mark_read(%L)', :'g'), 'permission denied');
select t.fails('anon cannot run chat_list', 'select * from messenger_chat_list()', 'permission denied');
select t.fails('anon cannot run read_state', format('select messenger_read_state(%L)', :'g'), 'permission denied');
select t.fails('anon cannot run prune', 'select messenger_prune_messages()', 'permission denied');
reset role;
select set_config('test.uid', :'olive', false);
set role authenticated;
select t.fails('authenticated cannot run prune', 'select messenger_prune_messages()', 'permission denied');
reset role;

-- A call with no login (uid null) is refused even for authenticated
select set_config('test.uid', '', false);
set role authenticated;
select t.fails('start_direct with no login refused', format('select messenger_start_direct(%L)', :'olive'), 'Sign in');
select t.ok('chat list with no login is empty', t.n('select * from messenger_chat_list()') = 0);
reset role;

-- Prune keeps 364 days, removes 366
select set_config('test.uid', :'olive', false);
set role authenticated;
select messenger_create_group('Old', array[:'bob']::uuid[]) as g6 \gset
insert into messenger_messages (conversation_id, sender_id, body) values (:'g6', :'olive', 'age364'), (:'g6', :'olive', 'age366'), (:'g6', :'olive', 'fresh');
reset role;
update messenger_messages set created_at = now() - interval '364 days' where body = 'age364';
update messenger_messages set created_at = now() - interval '366 days' where body = 'age366';
set role service_role;
select messenger_prune_messages();
reset role;
select t.ok('prune keeps the 364-day message', (select count(*) from messenger_messages where body = 'age364') = 1);
select t.ok('prune removes the 366-day message', (select count(*) from messenger_messages where body = 'age366') = 0);
select t.ok('prune keeps fresh messages', (select count(*) from messenger_messages where body in ('fresh', 'hello group', 'mine')) = 3);
select t.ok('prune leaves conversations alone', (select count(*) from messenger_conversations where id = :'g6') = 1);

select t.ok('all chat checks passed', true);
