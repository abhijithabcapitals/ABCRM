-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set amy 00000000-0000-0000-0000-000000000071
\set bo 00000000-0000-0000-0000-000000000072
\set cy 00000000-0000-0000-0000-000000000073
\set out 00000000-0000-0000-0000-000000000074
drop schema if exists c cascade;
create schema c;
grant usage on schema c to public;
create function c.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function c.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema c to public;
create table c.ids (name text primary key, id uuid);
grant select, insert, update on c.ids to public;
create function c.id(n text) returns uuid language sql stable as $$ select id from c.ids where name = n $$;
grant execute on function c.id(text) to public;

insert into public.profiles (id, role, full_name) values (:'amy', 'admin', 'Amy'), (:'bo', 'member', 'Bo'), (:'cy', 'member', 'Cy'), (:'out', 'member', 'Outsider');

set role authenticated;
select set_config('test.uid', :'amy', false);
insert into c.ids values ('direct', public.messenger_start_direct(:'bo'));
insert into c.ids values ('group', public.messenger_create_group('Trio', array[:'bo', :'cy']::uuid[]));
insert into c.ids values ('team', public.messenger_create_team('T'));
insert into c.ids values ('channel', (select conversation_id from public.messenger_team_list() where team_name = 'T'));

select c.fails('tables are closed to writes', $$insert into public.messenger_calls (conversation_id) values (c.id('direct'))$$, 'permission denied');
select c.fails('participants are closed', $$select * from public.messenger_call_participants$$, 'permission denied');
select c.fails('internal finish is closed', $$select public.messenger_finish_call(gen_random_uuid(), 'ended')$$, 'permission denied');
select c.fails('webhook function is closed', $$select public.messenger_call_event('x', 'room_finished')$$, 'permission denied');
select c.fails('channels have no calls yet', $$select * from public.messenger_start_call(c.id('channel'))$$, 'start from a chat');
select c.fails('a bad call type is refused', $$select * from public.messenger_start_call(c.id('direct'), 'hologram')$$, 'Unknown call type');

-- Ringing and answering
insert into c.ids values ('call', (select call_id from public.messenger_start_call(c.id('direct'), 'video')));
select c.ok('the caller does not ring', (select count(*) = 0 from public.messenger_calls_ringing()));
select c.ok('the caller can get a token', (select count(*) = 1 from public.messenger_call_for_token(c.id('call'))));
select set_config('test.uid', :'bo', false);
select c.ok('the other person rings, with the caller named', (select count(*) = 1 and bool_and(caller_name = 'Amy' and media = 'video') from public.messenger_calls_ringing()));
select c.ok('they can read the call for live updates', (select count(*) = 1 from public.messenger_calls where id = (select c.id('call'))));
select set_config('test.uid', :'out', false);
select c.ok('an outsider sees nothing', (select count(*) = 0 from public.messenger_calls));
select c.ok('and does not ring', (select count(*) = 0 from public.messenger_calls_ringing()));
select c.fails('and gets no token', $$select * from public.messenger_call_for_token(c.id('call'))$$, 'not_allowed');
select c.fails('and cannot answer', $$select public.messenger_answer_call(c.id('call'))$$, 'not part of this call');
select c.fails('or start a call in that chat', $$select * from public.messenger_start_call(c.id('direct'))$$, 'not in this chat');
select set_config('test.uid', :'bo', false);
select c.ok('calling back while it rings joins the same call', (select joined_existing and call_id = (select c.id('call')) from public.messenger_start_call(c.id('direct'))));
select c.ok('and the call is now active', (select status = 'active' and answered_at is not null from public.messenger_calls where id = (select c.id('call'))));
select public.messenger_leave_call(c.id('call'));
select c.ok('one person leaving ends a one-to-one call', (select status = 'ended' and ended_at is not null from public.messenger_calls where id = (select c.id('call'))));
select c.fails('an ended call gives no token', $$select * from public.messenger_call_for_token(c.id('call'))$$, 'not_allowed');
select c.fails('an ended call cannot be answered', $$select public.messenger_answer_call(c.id('call'))$$, 'has ended');
select public.messenger_leave_call(c.id('call'));
select c.ok('leaving twice changes nothing', (select status = 'ended' from public.messenger_calls where id = (select c.id('call'))));

-- Declining and missing
select set_config('test.uid', :'amy', false);
insert into c.ids values ('c2', (select call_id from public.messenger_start_call(c.id('direct'))));
select set_config('test.uid', :'bo', false);
select public.messenger_decline_call(c.id('c2'));
select c.ok('declining a one-to-one call ends it', (select status = 'declined' from public.messenger_calls where id = (select c.id('c2'))));
select c.ok('a declined call is not a missed one', (select count(*) = 0 from public.messenger_activity_list() where kind = 'missed_call'));
select set_config('test.uid', :'amy', false);
insert into c.ids values ('c3', (select call_id from public.messenger_start_call(c.id('direct'))));
select public.messenger_ring_timeout(c.id('c3'));
select c.ok('a timeout asked too early changes nothing', (select status = 'ringing' from public.messenger_calls where id = (select c.id('c3'))));
select public.messenger_leave_call(c.id('c3'));
select c.ok('hanging up unanswered counts as missed', (select status = 'missed' from public.messenger_calls where id = (select c.id('c3'))));
select set_config('test.uid', :'bo', false);
select c.ok('and the other person is told', (select count(*) = 1 and bool_and(actor_name = 'Amy' and message_id is null) from public.messenger_activity_list() where kind = 'missed_call'));
select c.ok('history shows it from their side', (select count(*) = 1 and bool_and(not started_by_me and my_state = 'missed' and other_name = 'Amy') from public.messenger_call_history() where id = (select c.id('c3'))));

-- Group calls
select set_config('test.uid', :'amy', false);
insert into c.ids values ('g1', (select call_id from public.messenger_start_call(c.id('group'), 'audio')));
select set_config('test.uid', :'bo', false);
select public.messenger_decline_call(c.id('g1'));
select c.ok('one decline leaves a group call ringing', (select status = 'ringing' from public.messenger_calls where id = (select c.id('g1'))));
select set_config('test.uid', :'cy', false);
select public.messenger_answer_call(c.id('g1'));
select c.ok('it goes active when someone answers', (select status = 'active' from public.messenger_calls where id = (select c.id('g1'))));
select set_config('test.uid', :'amy', false);
select public.messenger_leave_call(c.id('g1'));
select c.ok('a group call survives one person leaving', (select status = 'active' from public.messenger_calls where id = (select c.id('g1'))));
select set_config('test.uid', :'cy', false);
select public.messenger_leave_call(c.id('g1'));
select c.ok('it ends when nobody is left', (select status = 'ended' from public.messenger_calls where id = (select c.id('g1'))));
select set_config('test.uid', :'amy', false);
insert into c.ids values ('g2', (select call_id from public.messenger_start_call(c.id('group'))));
select set_config('test.uid', :'bo', false);
select public.messenger_presence_beat('dnd');
select c.ok('do not disturb does not ring', (select count(*) = 0 from public.messenger_calls_ringing()));
select public.messenger_presence_beat('available');
select c.ok('otherwise it does', (select count(*) = 1 from public.messenger_calls_ringing()));

reset role;
-- Old rings and the webhook
update public.messenger_calls set started_at = now() - interval '2 minutes' where id = (select c.id('g2'));
set role authenticated;
select c.ok('a stale ring does not ring', (select count(*) = 0 from public.messenger_calls_ringing()));
reset role;
select public.messenger_close_stale_calls();
select c.ok('the job closes a stale ring as missed', (select status = 'missed' from public.messenger_calls where id = (select c.id('g2'))));
select public.messenger_call_event('no such room', 'room_finished');
select public.messenger_call_event((select room_name from public.messenger_calls where id = (select c.id('g2'))), 'participant_left', 'not-a-uuid');
set role authenticated;
select set_config('test.uid', :'amy', false);
insert into c.ids values ('w1', (select call_id from public.messenger_start_call(c.id('direct'))));
reset role;
select public.messenger_call_event((select room_name from public.messenger_calls where id = (select c.id('w1'))), 'room_finished');
select public.messenger_call_event((select room_name from public.messenger_calls where id = (select c.id('w1'))), 'room_finished');
select c.ok('the webhook closes a call, and a repeat changes nothing', (select status = 'ended' from public.messenger_calls where id = (select c.id('w1'))));
select c.ok('a call can be started again after that', (select count(*) = 0 from public.messenger_calls where conversation_id = (select c.id('direct')) and status in ('ringing', 'active')));

set role anon;
select c.fails('anon cannot start a call', $$select * from public.messenger_start_call('00000000-0000-0000-0000-000000000000')$$, 'permission denied');
select c.fails('anon cannot get a token', $$select * from public.messenger_call_for_token('00000000-0000-0000-0000-000000000000')$$, 'permission denied');
reset role;
do $$ begin raise notice 'all call checks passed'; end $$;
drop schema c cascade;
