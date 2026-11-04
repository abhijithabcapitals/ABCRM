-- Undoes 004_chat_parity.sql. Removes reactions, mentions, reply links, activity, presence and file records.
-- A deleted message's text cannot be restored. Files in object storage are not touched by this script.
drop trigger if exists messenger_messages_activity on public.messenger_messages;
drop function if exists public.messenger_message_activity();
drop function if exists public.messenger_edit_message(uuid, text);
drop function if exists public.messenger_delete_message(uuid);
drop function if exists public.messenger_toggle_reaction(uuid, text);
drop function if exists public.messenger_set_chat_flags(uuid, boolean, boolean);
drop function if exists public.messenger_send_file(uuid, uuid, text, text, text, bigint, uuid);
drop function if exists public.messenger_file_for_download(uuid);
drop function if exists public.messenger_files(int);
drop function if exists public.messenger_search(text, int);
drop function if exists public.messenger_activity_list(int);
drop function if exists public.messenger_activity_read(uuid);
drop function if exists public.messenger_presence_beat(text);
drop function if exists public.messenger_presence_list();
drop table if exists public.messenger_attachments;
drop table if exists public.messenger_activity;
drop table if exists public.messenger_presence;

create or replace function public.messenger_stamp_message() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.created_at := now();
  return new;
end $$;

drop function if exists public.messenger_chat_list();
create function public.messenger_chat_list()
returns table (id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text,
               last_link_label text, last_sender_id uuid, last_sender_name text, last_message_at timestamptz, unread int)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, c.title, mc.n, o.full_name, o.profile_id, lm.body, lm.link_label, lm.sender_id, lm.sender_name,
         c.last_message_at, un.n
  from public.messenger_members me
  join public.messenger_conversations c on c.id = me.conversation_id
  cross join lateral (select count(*)::int as n from public.messenger_members x where x.conversation_id = c.id) mc
  left join lateral (
    select om.profile_id, p.full_name from public.messenger_members om
    left join public.profiles p on p.id = om.profile_id
    where c.kind = 'direct' and om.conversation_id = c.id and om.profile_id <> me.profile_id limit 1) o on true
  left join lateral (
    select m.body, m.link_label, m.sender_id, sp.full_name as sender_name from public.messenger_messages m
    left join public.profiles sp on sp.id = m.sender_id
    where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  cross join lateral (
    select count(*)::int as n from public.messenger_messages u
    where u.conversation_id = c.id and u.created_at > me.last_read_at and u.sender_id is distinct from me.profile_id) un
  where me.profile_id = (select auth.uid())
  order by c.last_message_at desc, c.id
$$;
revoke all on function public.messenger_chat_list() from public, anon, authenticated;
grant execute on function public.messenger_chat_list() to authenticated;

drop index if exists public.messenger_messages_parent_idx;
drop index if exists public.messenger_messages_search_idx;
alter table public.messenger_messages
  drop column if exists parent_id, drop column if exists mention_ids, drop column if exists reactions,
  drop column if exists attachment, drop column if exists edited_at, drop column if exists deleted_at;
alter table public.messenger_members drop column if exists muted, drop column if exists pinned;
