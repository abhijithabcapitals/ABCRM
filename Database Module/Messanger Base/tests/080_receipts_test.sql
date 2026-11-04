-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set ann 00000000-0000-0000-0000-0000000000f1
\set bob 00000000-0000-0000-0000-0000000000f2
\set cat 00000000-0000-0000-0000-0000000000f3
drop schema if exists r cascade;
create schema r;
grant usage on schema r to public;
create function r.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function r.fails(sql text) returns boolean language plpgsql as $$
begin
  execute sql;
  return false;
exception when others then
  return true;
end $$;
grant execute on all functions in schema r to public;
create table r.v (name text primary key, val text);
grant all on r.v to public;

insert into public.profiles (id, role, full_name) values (:'ann', 'member', 'Ann R'), (:'bob', 'member', 'Bob R'), (:'cat', 'admin', 'Cat R');

set role authenticated;
select set_config('test.uid', :'ann', false);
insert into r.v select 'chat', public.messenger_start_direct(:'bob')::text;
insert into public.messenger_messages (conversation_id, sender_id, body) select val::uuid, :'ann', 'Hello' from r.v where name = 'chat';
insert into r.v select 'sent', max(created_at)::text from public.messenger_messages m join r.v on r.v.name = 'chat' and m.conversation_id = r.v.val::uuid;

select r.ok('a new message is neither delivered nor read', (select s.delivered_at < v.val::timestamptz and s.read_at < v.val::timestamptz
  from r.v c, r.v v, public.messenger_receipt_state(c.val::uuid) s where c.name = 'chat' and v.name = 'sent'));

select set_config('test.uid', :'bob', false);
select public.messenger_mark_delivered();
select set_config('test.uid', :'ann', false);
select r.ok('delivered moves when the other person''s app receives it, read does not', (select s.delivered_at >= v.val::timestamptz and s.read_at < v.val::timestamptz
  from r.v c, r.v v, public.messenger_receipt_state(c.val::uuid) s where c.name = 'chat' and v.name = 'sent'));
reset role;
insert into r.v select 'stamp', last_delivered_at::text from public.messenger_members where profile_id = :'bob';
set role authenticated;
select set_config('test.uid', :'bob', false);
select public.messenger_mark_delivered();
reset role;
select r.ok('nothing new writes nothing', (select last_delivered_at::text = (select val from r.v where name = 'stamp') from public.messenger_members where profile_id = :'bob'));

set role authenticated;
select set_config('test.uid', :'ann', false);
select public.messenger_mark_delivered();
reset role;
select r.ok('my own message does not mark me as having received something', (select last_delivered_at is null from public.messenger_members where profile_id = :'ann'));

set role authenticated;
select set_config('test.uid', :'cat', false);
select r.ok('someone outside the chat cannot read its receipts', r.fails(format('select * from public.messenger_receipt_state(%L)', (select val from r.v where name = 'chat'))));
select r.ok('or be allowed its signals', public.messenger_signal_allowed('msgr:' || (select val from r.v where name = 'chat')) = false);
select set_config('test.uid', :'bob', false);
select r.ok('a member is allowed its signals', public.messenger_signal_allowed('msgr:' || (select val from r.v where name = 'chat')));
select r.ok('another kind of topic is refused', public.messenger_signal_allowed('notifications:x') = false);
select r.ok('a malformed topic is refused, not an error', public.messenger_signal_allowed('msgr:not-a-uuid') = false);
select public.messenger_mark_read((select val::uuid from r.v where name = 'chat'));
select set_config('test.uid', :'ann', false);
select r.ok('read moves both', (select s.read_at >= v.val::timestamptz and s.delivered_at >= s.read_at
  from r.v c, r.v v, public.messenger_receipt_state(c.val::uuid) s where c.name = 'chat' and v.name = 'sent'));
reset role;

set role anon;
select r.ok('anon cannot mark delivered', r.fails('select public.messenger_mark_delivered()'));
select r.ok('anon cannot read receipts', r.fails('select * from public.messenger_receipt_state(gen_random_uuid())'));
reset role;

select r.ok('member rows reach Realtime', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'messenger_members'));
select r.ok('the signal rules exist for reading and sending', (select count(*) = 2 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'messenger_signal_%'));

-- The audit trail skips read and delivered times but still logs other member changes.
delete from public.audit_trail;
create trigger audit_trail_row after insert or update or delete on public.messenger_members for each row execute function public.audit_trail_capture('conversation_id', 'profile_id');
set role authenticated;
select set_config('test.uid', :'bob', false);
select public.messenger_mark_read((select val::uuid from r.v where name = 'chat'));
reset role;
select r.ok('read and delivered times are not audited', (select count(*) = 0 from public.audit_trail where table_name = 'messenger_members'));
update public.messenger_members set muted = true where profile_id = :'bob';
select r.ok('other member changes still are', (select count(*) = 1 from public.audit_trail where table_name = 'messenger_members'));
drop trigger audit_trail_row on public.messenger_members;

do $$ begin raise notice 'all receipt checks passed'; end $$;
drop schema r cascade;
