-- Undoes 009_chat_archive_delete.sql. Archive flags are lost; deleted groups stay deleted.
drop function if exists public.messenger_set_archived(uuid, boolean);
drop function if exists public.messenger_delete_group(uuid);
drop function if exists public.messenger_chat_list();
create function public.messenger_chat_list()
returns table (id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text,
               last_link_label text, last_sender_id uuid, last_sender_name text, last_message_at timestamptz, unread int, muted boolean, pinned boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, c.title, mc.n, o.full_name, o.profile_id, lm.body, lm.link_label, lm.sender_id, lm.sender_name,
         c.last_message_at, un.n, me.muted, me.pinned
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
    where u.conversation_id = c.id and u.created_at > me.last_read_at and u.sender_id is distinct from me.profile_id and u.deleted_at is null) un
  where me.profile_id = (select auth.uid()) and c.kind <> 'channel'
  order by c.last_message_at desc, c.id
$$;
revoke all on function public.messenger_chat_list() from public, anon, authenticated;
grant execute on function public.messenger_chat_list() to authenticated;
alter table public.messenger_members drop column if exists archived;
