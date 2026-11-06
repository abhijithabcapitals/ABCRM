-- =====================================================================
-- Messanger Base - archive and delete group chats    009
-- Needs 005_teams_channels.sql. Idempotent. No existing conversation or message changes.
-- Archive is per person: it hides a chat from that person's list until they restore it. Anyone in a chat may archive it.
-- Delete removes a group, its members and its messages for everyone. Only the group owner may delete, as for rename and add.
-- There is no admin exception, as elsewhere in Messenger: chats are private.
-- =====================================================================
alter table public.messenger_members add column if not exists archived boolean not null default false;

create or replace function public.messenger_set_archived(p_conversation uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_archived is null then raise exception 'Say whether to archive or restore'; end if;
  update public.messenger_members m set archived = p_archived
    from public.messenger_conversations c
    where c.id = m.conversation_id and c.kind in ('direct', 'group')
      and m.conversation_id = p_conversation and m.profile_id = (select auth.uid());
  if not found then raise exception 'You are not in this chat' using errcode = '42501'; end if;
end $$;

-- Members and messages go with the conversation (on delete cascade). Stored files stay until the storage prune removes them.
create or replace function public.messenger_delete_group(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_owner(p_conversation, (select auth.uid()));
  delete from public.messenger_conversations where id = p_conversation and kind = 'group';
end $$;

-- Same list as 005, plus each chat's archived flag for the caller. The return type changes, so it is dropped first.
drop function if exists public.messenger_chat_list();
create function public.messenger_chat_list()
returns table (id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text,
               last_link_label text, last_sender_id uuid, last_sender_name text, last_message_at timestamptz, unread int, muted boolean, pinned boolean,
               archived boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, c.title, mc.n, o.full_name, o.profile_id, lm.body, lm.link_label, lm.sender_id, lm.sender_name,
         c.last_message_at, un.n, me.muted, me.pinned, me.archived
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

revoke all on function public.messenger_set_archived(uuid, boolean), public.messenger_delete_group(uuid), public.messenger_chat_list() from public, anon, authenticated;
grant execute on function public.messenger_set_archived(uuid, boolean), public.messenger_delete_group(uuid), public.messenger_chat_list() to authenticated;
