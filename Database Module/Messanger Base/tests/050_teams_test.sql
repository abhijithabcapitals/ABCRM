-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set ann 00000000-0000-0000-0000-000000000061
\set ben 00000000-0000-0000-0000-000000000062
\set col 00000000-0000-0000-0000-000000000063
\set out 00000000-0000-0000-0000-000000000064
drop schema if exists q cascade;
create schema q;
grant usage on schema q to public;
create function q.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function q.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema q to public;
create table q.ids (name text primary key, id uuid);
grant select, insert, update on q.ids to public;
create function q.id(n text) returns uuid language sql stable as $$ select id from q.ids where name = n $$;
grant execute on function q.id(text) to public;

insert into public.profiles (id, role, full_name) values (:'ann', 'admin', 'Ann'), (:'ben', 'member', 'Ben'), (:'col', 'member', 'Col'), (:'out', 'member', 'Outsider');

set role authenticated;
select set_config('test.uid', :'ann', false);
insert into q.ids values ('team', public.messenger_create_team('Tax desk', 'Returns', array[:'ben']::uuid[]));
select q.ok('a new team has General, and I own it', (select count(*) = 1 and bool_and(is_general) and bool_and(team_role = 'owner') from public.messenger_team_list()));
insert into q.ids values ('general', (select channel_id from public.messenger_team_list() where is_general));
insert into q.ids values ('generalc', (select conversation_id from public.messenger_team_list() where is_general));
select q.ok('General holds the team', (select member_count = 2 from public.messenger_team_list()));
select q.fails('a name is needed', $$select public.messenger_create_team('   ')$$, '1 to 80');
select q.fails('team members must be staff', $$select public.messenger_create_team('X', null, array['00000000-0000-0000-0000-0000000000ff']::uuid[])$$, 'not a staff member');
select q.fails('team tables are closed', $$select * from public.messenger_teams$$, 'permission denied');
select q.fails('channel tables are closed', $$select * from public.messenger_channels$$, 'permission denied');
select q.fails('team member table is closed', $$insert into public.messenger_team_members (team_id, profile_id) values (q.id('team'), current_setting('test.uid')::uuid)$$, 'permission denied');
select q.fails('internal functions are closed', $$select public.messenger_make_channel(q.id('team'), 'x', 'standard', '{}', false)$$, 'permission denied');

-- Being an admin gives no way in
select set_config('test.uid', :'out', false);
select q.ok('outsiders see no teams', (select count(*) = 0 from public.messenger_team_list()));
select q.fails('outsiders cannot read the people', $$select * from public.messenger_team_people(q.id('team'))$$, 'not in this team');
select q.fails('outsiders cannot read posts', $$select * from public.messenger_channel_posts(q.id('generalc'))$$, 'not in this chat');
select q.fails('outsiders cannot manage', $$select public.messenger_add_team_members(q.id('team'), array[current_setting('test.uid')::uuid])$$, 'team owner');
select q.fails('outsiders cannot post', $$insert into public.messenger_messages (conversation_id, sender_id, body) values (q.id('generalc'), current_setting('test.uid')::uuid, 'x')$$, 'row-level security');

-- Members post, but only owners manage
select set_config('test.uid', :'ben', false);
select q.ok('a member sees the team', (select count(*) = 1 and bool_and(team_role = 'member') from public.messenger_team_list()));
select q.fails('members cannot add people', $$select public.messenger_add_team_members(q.id('team'), array['00000000-0000-0000-0000-000000000063']::uuid[])$$, 'team owner');
select q.fails('members cannot make channels', $$select public.messenger_create_channel(q.id('team'), 'x')$$, 'team owner');
select q.fails('members cannot delete the team', $$select public.messenger_delete_team(q.id('team'))$$, 'team owner');
insert into public.messenger_messages (id, conversation_id, sender_id, body) values ('00000000-0000-0000-0000-0000000000b1', (select q.id('generalc')), :'ben', 'First post about returns');

-- Threads
select set_config('test.uid', :'ann', false);
insert into public.messenger_messages (id, conversation_id, sender_id, body, parent_id) values ('00000000-0000-0000-0000-0000000000b2', (select q.id('generalc')), :'ann', 'A reply', '00000000-0000-0000-0000-0000000000b1');
select q.ok('posts leave replies out and count them', (select count(*) = 1 and bool_and((p ->> 'reply_count')::int = 1) from public.messenger_channel_posts(q.id('generalc')) p));
select public.messenger_delete_message('00000000-0000-0000-0000-0000000000b2');
select q.ok('a deleted reply is not counted', (select (p ->> 'reply_count')::int = 0 from public.messenger_channel_posts(q.id('generalc')) p));
select q.ok('search says where a channel result lives', (select bool_and(conversation_kind = 'channel' and conversation_title = 'General') from public.messenger_search('returns')));
select q.ok('channels stay out of the chat list', (select count(*) = 0 from public.messenger_chat_list() where kind = 'channel'));
select q.fails('rename_group refuses a channel', $$select public.messenger_rename_group(q.id('generalc'), 'x')$$, 'group owner');
select q.fails('the group leave refuses a channel', $$select public.messenger_leave(q.id('generalc'))$$, 'one-to-one');
select q.fails('leaving a standard channel is refused', $$select public.messenger_leave_channel(q.id('general'))$$, 'stays in a standard');

-- Standard and private channels
insert into q.ids values ('std', public.messenger_create_channel(q.id('team'), 'Filings'));
select q.fails('two channels cannot share a name', $$select public.messenger_create_channel(q.id('team'), 'FILINGS')$$, 'already has');
select public.messenger_add_team_members(q.id('team'), array[:'col']::uuid[]);
select q.ok('a new member joins standard channels', (select bool_and(member_count = 3) from public.messenger_team_list()));
select q.fails('a private channel needs team members', format($$select public.messenger_create_channel(q.id('team'), 'S', 'private', array[%L]::uuid[])$$, :'out'), 'must be in the team');
insert into q.ids values ('priv', public.messenger_create_channel(q.id('team'), 'Secret', 'private', array[:'ben']::uuid[]));
insert into q.ids values ('privc', (select conversation_id from public.messenger_team_list() where channel_id = q.id('priv')));
select set_config('test.uid', :'col', false);
select q.ok('a private channel is hidden from others in the team', (select count(*) = 0 from public.messenger_team_list() where channel_name = 'Secret'));
select q.fails('and its posts', $$select * from public.messenger_channel_posts(q.id('privc'))$$, 'not in this chat');
select set_config('test.uid', :'ann', false);
select public.messenger_add_channel_members(q.id('priv'), array[:'col']::uuid[]);
select public.messenger_remove_channel_member(q.id('priv'), :'col');
select q.fails('standard channels keep the whole team', format($$select public.messenger_remove_channel_member(q.id('std'), %L)$$, :'col'), 'stays in a standard');
select q.fails('General cannot be deleted', $$select public.messenger_delete_channel(q.id('general'))$$, 'General cannot');
select q.fails('General cannot be renamed', $$select public.messenger_rename_channel(q.id('general'), 'x')$$, 'General cannot');
select public.messenger_rename_channel(q.id('std'), 'Returns');
select q.ok('a rename reaches the channel', (select count(*) = 1 from public.messenger_team_list() where channel_name = 'Returns'));
select public.messenger_delete_channel(q.id('std'));
select q.ok('a deleted channel goes', (select count(*) = 0 from public.messenger_team_list() where channel_id = q.id('std')));

-- An owner who is not in a private channel cannot act on it
select public.messenger_set_team_role(q.id('team'), :'col', 'owner');
select set_config('test.uid', :'col', false);
select q.fails('an owner outside a private channel cannot delete it', $$select public.messenger_delete_channel(q.id('priv'))$$, 'team owner');
select public.messenger_set_team_role(q.id('team'), :'col', 'member');

-- Leaving
select set_config('test.uid', :'ben', false);
select public.messenger_leave_team(q.id('team'));
select q.ok('leaving a team leaves its channels', (select count(*) = 0 from public.messenger_team_list()));
select set_config('test.uid', :'ann', false);
select q.ok('the private channel keeps its other member', (select member_count = 1 from public.messenger_team_list() where channel_id = q.id('priv')));
select public.messenger_leave_channel(q.id('priv'));
select q.ok('the last person out takes a private channel', (select count(*) = 0 from public.messenger_team_list() where channel_id = q.id('priv')));
select q.fails('the last owner cannot step down', format($$select public.messenger_set_team_role(q.id('team'), %L, 'member')$$, :'ann'), 'at least one owner');
select public.messenger_leave_team(q.id('team'));
select set_config('test.uid', :'col', false);
select q.ok('the next member becomes owner', (select bool_and(team_role = 'owner') from public.messenger_team_list()));
select q.fails('the only person cannot leave', $$select public.messenger_leave_team(q.id('team'))$$, 'only person');

-- Deleting
select public.messenger_delete_team(q.id('team'));
select q.ok('a deleted team goes', (select count(*) = 0 from public.messenger_team_list()));
reset role;
select q.ok('its messages and conversations go too', (select count(*) = 0 from public.messenger_conversations where id = (select q.id('generalc'))));

-- Everyone out through a profile delete
insert into public.messenger_teams (id, name) values ('00000000-0000-0000-0000-0000000000c1', 'Lone');
insert into public.messenger_team_members (team_id, profile_id, role) values ('00000000-0000-0000-0000-0000000000c1', :'out', 'owner');
delete from public.profiles where id = :'out';
select q.ok('a team with nobody left goes', (select count(*) = 0 from public.messenger_teams where id = '00000000-0000-0000-0000-0000000000c1'));

-- The prune leaves channels alone
select set_config('test.uid', :'ann', false);
set role authenticated;
insert into q.ids values ('t2', public.messenger_create_team('Keep'));
insert into q.ids values ('t2c', (select conversation_id from public.messenger_team_list() where team_name = 'Keep'));
insert into q.ids values ('g2', public.messenger_create_group('Old', array[:'ben']::uuid[]));
reset role;
alter table public.messenger_messages disable trigger messenger_messages_stamp;
insert into public.messenger_messages (conversation_id, sender_id, body, created_at) values ((select q.id('t2c')), :'ann', 'old post', now() - interval '400 days'), ((select q.id('g2')), :'ann', 'old chat', now() - interval '400 days');
alter table public.messenger_messages enable trigger messenger_messages_stamp;
select public.messenger_prune_messages();
select q.ok('an old channel post stays', (select count(*) = 1 from public.messenger_messages where body = 'old post'));
select q.ok('an old chat message goes', (select count(*) = 0 from public.messenger_messages where body = 'old chat'));

set role anon;
select q.fails('anon cannot list teams', $$select * from public.messenger_team_list()$$, 'permission denied');
select q.fails('anon cannot create a team', $$select public.messenger_create_team('x')$$, 'permission denied');
reset role;
do $$ begin raise notice 'all team checks passed'; end $$;
drop schema q cascade;
