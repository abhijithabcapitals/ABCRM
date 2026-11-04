-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set kim 00000000-0000-0000-0000-000000000051
\set lee 00000000-0000-0000-0000-000000000052
\set max 00000000-0000-0000-0000-000000000053
\set out 00000000-0000-0000-0000-000000000054
drop schema if exists p cascade;
create schema p;
grant usage on schema p to public;
create function p.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function p.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema p to public;
create table p.ids (name text primary key, id uuid);
grant select, insert, update on p.ids to public;

insert into public.profiles (id, role, full_name) values (:'kim', 'member', 'Kim'), (:'lee', 'member', 'Lee'), (:'max', 'member', 'Max'), (:'out', 'member', 'Outsider');

set role authenticated;
select set_config('test.uid', :'kim', false);
insert into p.ids values ('group', public.messenger_create_group('Team', array[:'lee', :'max']::uuid[]));
insert into p.ids values ('m1', '00000000-0000-0000-0000-0000000000a1'), ('m2', '00000000-0000-0000-0000-0000000000a2'), ('m3', '00000000-0000-0000-0000-0000000000a3');

-- Guards on a direct insert
insert into public.messenger_messages (id, conversation_id, sender_id, body, mention_ids, reactions, attachment, edited_at, deleted_at)
  values ('00000000-0000-0000-0000-0000000000a1', (select id from p.ids where name = 'group'), :'kim', 'Budget review with @Lee today', array[:'lee', :'out']::uuid[],
          '{"x": ["forged"]}', '{"id": "forged"}', now(), now());
select p.ok('insert cannot forge reactions, file, edited or deleted',
  (select reactions = '{}' and attachment is null and edited_at is null and deleted_at is null from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a1'));

-- Mentions and replies reach the activity feed
select set_config('test.uid', :'lee', false);
select p.ok('a mention reaches the person', (select count(*) = 1 from public.messenger_activity_list() where kind = 'mention' and actor_name = 'Kim'));
select set_config('test.uid', :'out', false);
select p.ok('a mention of a non-member creates nothing', (select count(*) = 0 from public.messenger_activity_list()));
select set_config('test.uid', :'lee', false);
insert into public.messenger_messages (id, conversation_id, sender_id, body, parent_id)
  values ('00000000-0000-0000-0000-0000000000a2', (select id from p.ids where name = 'group'), :'lee', 'On it', '00000000-0000-0000-0000-0000000000a1');
select set_config('test.uid', :'kim', false);
select p.ok('a reply reaches the person replied to', (select count(*) = 1 from public.messenger_activity_list() where kind = 'reply'));
select public.messenger_activity_read();
select p.ok('mark all read', (select count(*) = 0 from public.messenger_activity_list() where read_at is null));

-- A reply cannot point into another chat
select set_config('test.uid', :'out', false);
insert into p.ids values ('other', public.messenger_start_direct(:'max'));
select p.fails('reply into another chat refused', format($$insert into public.messenger_messages (conversation_id, sender_id, body, parent_id) values (%L, %L, 'x', '00000000-0000-0000-0000-0000000000a1')$$,
  (select id from p.ids where name = 'other'), :'out'), 'reply_other_chat');

-- No direct updates or deletes, no direct table reads
select set_config('test.uid', :'kim', false);
select p.fails('direct update refused', $$update public.messenger_messages set body = 'x'$$, 'permission denied');
select p.fails('direct delete refused', $$delete from public.messenger_messages$$, 'permission denied');
select p.fails('activity table closed', $$select * from public.messenger_activity$$, 'permission denied');
select p.fails('attachments table closed', $$select * from public.messenger_attachments$$, 'permission denied');
select p.fails('presence table closed', $$select * from public.messenger_presence$$, 'permission denied');

-- Edit
select set_config('test.uid', :'lee', false);
select p.fails('cannot edit someone else''s message', $$select public.messenger_edit_message('00000000-0000-0000-0000-0000000000a1', 'x')$$, 'not_allowed');
select set_config('test.uid', :'kim', false);
select p.fails('empty edit refused', $$select public.messenger_edit_message('00000000-0000-0000-0000-0000000000a1', '   ')$$, 'body_invalid');
select public.messenger_edit_message('00000000-0000-0000-0000-0000000000a1', 'Budget review tomorrow');
select p.ok('edit changes the text and marks it', (select body = 'Budget review tomorrow' and edited_at is not null from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a1'));

-- Reactions
select set_config('test.uid', :'out', false);
select p.fails('outsider cannot react', $$select public.messenger_toggle_reaction('00000000-0000-0000-0000-0000000000a1', 'x')$$, 'not_allowed');
select set_config('test.uid', :'lee', false);
select p.ok('first reaction adds the person', (select (public.messenger_toggle_reaction('00000000-0000-0000-0000-0000000000a1', 'ok') -> 'ok') ? (select current_setting('test.uid'))));
select p.ok('second reaction removes it and the emoji', (select public.messenger_toggle_reaction('00000000-0000-0000-0000-0000000000a1', 'ok') = '{}'::jsonb));
select set_config('test.uid', :'kim', false);
select p.ok('a reaction reaches the sender once per add', (select count(*) = 1 from public.messenger_activity_list() where kind = 'reaction' and detail = 'ok'));
select public.messenger_toggle_reaction('00000000-0000-0000-0000-0000000000a1', 'mine');
select p.ok('own reaction tells nobody', (select count(*) = 0 from public.messenger_activity_list() where detail = 'mine'));

-- Search
select p.ok('search matches a word prefix in my chat', (select count(*) = 1 from public.messenger_search('budg')));
select p.ok('search needs every word', (select count(*) = 0 from public.messenger_search('budget nothing')));
select p.ok('search survives quotes and backslashes', (select count(*) = 0 from public.messenger_search($$it's \ a:*$$)));
select p.ok('empty search returns nothing', (select count(*) = 0 from public.messenger_search('   ')));
select set_config('test.uid', :'out', false);
select p.ok('search never reaches chats I am not in', (select count(*) = 0 from public.messenger_search('budget')));

-- Files
select set_config('test.uid', :'out', false);
select p.fails('outsider cannot send a file to the chat', format($$select public.messenger_send_file(gen_random_uuid(), %L, %L, 'a.pdf', 'application/pdf', 10)$$,
  (select id from p.ids where name = 'group'), (select id from p.ids where name = 'group')::text || '/f1'), 'not_allowed');
select set_config('test.uid', :'kim', false);
select p.fails('a key from another chat is refused', format($$select public.messenger_send_file(gen_random_uuid(), %L, %L, 'a.pdf', 'application/pdf', 10)$$,
  (select id from p.ids where name = 'group'), (select id from p.ids where name = 'other')::text || '/f1'), 'key_invalid');
select p.fails('an oversized file is refused', format($$select public.messenger_send_file(gen_random_uuid(), %L, %L, 'a.pdf', 'application/pdf', 26214401)$$,
  (select id from p.ids where name = 'group'), (select id from p.ids where name = 'group')::text || '/big'), 'check constraint');
select public.messenger_send_file('00000000-0000-0000-0000-0000000000a3', (select id from p.ids where name = 'group'), (select id from p.ids where name = 'group')::text || '/f1', 'plan.pdf', 'application/pdf', 1000);
select public.messenger_send_file('00000000-0000-0000-0000-0000000000a3', (select id from p.ids where name = 'group'), (select id from p.ids where name = 'group')::text || '/f1', 'plan.pdf', 'application/pdf', 1000);
select p.ok('a retried file sends once, with its summary', (select count(*) = 1 and bool_and(attachment ->> 'name' = 'plan.pdf') from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a3'));
select p.fails('a file message cannot be edited', $$select public.messenger_edit_message('00000000-0000-0000-0000-0000000000a3', 'x')$$, 'not_editable');
select set_config('test.uid', :'lee', false);
select p.ok('members see the file', (select count(*) = 1 from public.messenger_files()));
insert into p.ids values ('file', (select id from public.messenger_files() limit 1));
select p.ok('members can fetch it', (select storage_key like '%/f1' from public.messenger_file_for_download((select id from p.ids where name = 'file'))));
select set_config('test.uid', :'out', false);
select p.ok('outsiders do not see the file', (select count(*) = 0 from public.messenger_files()));
select p.fails('outsiders cannot fetch it', format($$select * from public.messenger_file_for_download(%L)$$, (select id from p.ids where name = 'file')), 'not_allowed');

-- Delete
select set_config('test.uid', :'lee', false);
select p.fails('cannot delete someone else''s message', $$select public.messenger_delete_message('00000000-0000-0000-0000-0000000000a3')$$, 'not_allowed');
select set_config('test.uid', :'kim', false);
select public.messenger_delete_message('00000000-0000-0000-0000-0000000000a3');
select p.ok('delete clears the text and file summary', (select body = 'Message deleted' and attachment is null and deleted_at is not null from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a3'));
select p.fails('a deleted file no longer downloads', format($$select * from public.messenger_file_for_download(%L)$$, (select id from p.ids where name = 'file')), 'not_allowed');
select public.messenger_delete_message('00000000-0000-0000-0000-0000000000a1');
select p.ok('delete clears text, reactions and its activity', (select body = 'Message deleted' and reactions = '{}' from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a1'));
select p.ok('search skips deleted messages', (select count(*) = 0 from public.messenger_search('deleted')));
select p.ok('a reply keeps its place after the parent is deleted', (select parent_id = '00000000-0000-0000-0000-0000000000a1' from public.messenger_messages where id = '00000000-0000-0000-0000-0000000000a2'));
select p.fails('a deleted message takes no reactions', $$select public.messenger_toggle_reaction('00000000-0000-0000-0000-0000000000a1', 'ok')$$, 'message_deleted');
select p.fails('a deleted message cannot be edited', $$select public.messenger_edit_message('00000000-0000-0000-0000-0000000000a1', 'back')$$, 'not_editable');

-- Pin and mute are per person
select public.messenger_set_chat_flags((select id from p.ids where name = 'group'), true, true);
select p.ok('pin and mute apply to me', (select muted and pinned from public.messenger_chat_list() where id = (select id from p.ids where name = 'group')));
select public.messenger_set_chat_flags((select id from p.ids where name = 'group'), false);
select p.ok('a null flag stays as it was', (select not muted and pinned from public.messenger_chat_list() where id = (select id from p.ids where name = 'group')));
select set_config('test.uid', :'lee', false);
select p.ok('pin does not reach others', (select not pinned from public.messenger_chat_list() where id = (select id from p.ids where name = 'group')));
select set_config('test.uid', :'out', false);
select p.fails('flags need membership', format($$select public.messenger_set_chat_flags(%L, true)$$, (select id from p.ids where name = 'group')), 'not_allowed');

-- Presence
select set_config('test.uid', :'kim', false);
select public.messenger_presence_beat();
select public.messenger_presence_beat('busy');
select public.messenger_presence_beat();
select p.ok('a beat keeps the chosen status', (select status = 'busy' from public.messenger_presence_list() where profile_id = (select current_setting('test.uid'))::uuid));
select p.fails('an unknown status is refused', $$select public.messenger_presence_beat('hidden')$$, 'check constraint');
select set_config('test.uid', :'lee', false);
select p.ok('people sharing a chat see the status', (select count(*) = 1 from public.messenger_presence_list() where status = 'busy'));
select set_config('test.uid', :'out', false);
select p.ok('others do not', (select count(*) = 0 from public.messenger_presence_list() where status = 'busy'));

-- Closed to anyone not signed in
reset role;
set role anon;
select p.fails('anon cannot search', $$select * from public.messenger_search('x')$$, 'permission denied');
select p.fails('anon cannot read the list', $$select * from public.messenger_chat_list()$$, 'permission denied');
select p.fails('anon cannot beat', $$select public.messenger_presence_beat()$$, 'permission denied');
reset role;
select p.ok('the prune function stays closed to staff', not has_function_privilege('authenticated', 'public.messenger_prune_messages()', 'execute'));
do $$ begin raise notice 'all chat parity checks passed'; end $$;
drop schema p cascade;
