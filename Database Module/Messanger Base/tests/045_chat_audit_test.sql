-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
-- Uses the real capture function from 004b, on a small stand-in for the audit trail.
\set ON_ERROR_STOP on
\set zed 00000000-0000-0000-0000-000000000081
\set yan 00000000-0000-0000-0000-000000000082
drop schema if exists a cascade;
create schema a;
grant usage on schema a to public;
create function a.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
grant execute on all functions in schema a to public;
create table a.conv (id uuid);
grant select, insert on a.conv to public;

insert into public.profiles (id, role, full_name) values (:'zed', 'member', 'Zed'), (:'yan', 'member', 'Yan');
create table public.chat_audit_other (id uuid primary key default gen_random_uuid(), note text);
grant select, insert on public.chat_audit_other to authenticated;
create trigger audit_trail_row after insert or update or delete on public.messenger_messages for each row execute function public.audit_trail_capture('id');
create trigger audit_trail_row after insert or update or delete on public.messenger_conversations for each row execute function public.audit_trail_capture('id');
create trigger audit_trail_row after insert or update or delete on public.messenger_presence for each row execute function public.audit_trail_capture('profile_id');
create trigger audit_trail_row after insert or update or delete on public.messenger_activity for each row execute function public.audit_trail_capture('id');
create trigger audit_trail_row after insert or update or delete on public.chat_audit_other for each row execute function public.audit_trail_capture('id');

set role authenticated;
select set_config('test.uid', :'zed', false);
insert into a.conv select public.messenger_start_direct(:'yan');
insert into public.messenger_messages (id, conversation_id, sender_id, body, mention_ids)
  select '00000000-0000-0000-0000-0000000000d1', id, :'zed', 'Secret chat words', array[:'yan']::uuid[] from a.conv;
select public.messenger_edit_message('00000000-0000-0000-0000-0000000000d1', 'Other secret words');
select public.messenger_presence_beat('busy');
select public.messenger_presence_beat();
insert into public.chat_audit_other (note) values ('an ordinary change');
reset role;

select a.ok('a chat message is logged, with who and when', (select count(*) >= 2 and bool_and(actor = :'zed') from public.audit_trail where table_name = 'messenger_messages'));
select a.ok('its text is not', (select count(*) = 0 from public.audit_trail where table_name like 'messenger%' and (old_values is not null or new_values is not null)));
select a.ok('no words reach any column', (select count(*) = 0 from public.audit_trail t where t::text ilike '%secret%'));
select a.ok('an edit records which field changed', (select count(*) = 1 from public.audit_trail where table_name = 'messenger_messages' and action = 'UPDATE' and 'body' = any(changed) and 'edited_at' = any(changed)));
select a.ok('conversations follow the same rule', (select count(*) >= 1 and bool_and(new_values is null) from public.audit_trail where table_name = 'messenger_conversations'));
select a.ok('status beats are not logged', (select count(*) = 0 from public.audit_trail where table_name = 'messenger_presence'));
select a.ok('the activity feed is not logged', (select count(*) = 0 from public.audit_trail where table_name = 'messenger_activity'));
select a.ok('other tables keep their values', (select count(*) = 1 and bool_and(new_values ->> 'note' = 'an ordinary change') from public.audit_trail where table_name = 'chat_audit_other'));
select a.ok('staff cannot call the capture function', not has_function_privilege('authenticated', 'public.audit_trail_capture()', 'execute'));

drop trigger audit_trail_row on public.messenger_messages;
drop trigger audit_trail_row on public.messenger_conversations;
drop trigger audit_trail_row on public.messenger_presence;
drop trigger audit_trail_row on public.messenger_activity;
drop table public.chat_audit_other;
do $$ begin raise notice 'all chat audit checks passed'; end $$;
drop schema a cascade;
