-- Undoes 005_teams_channels.sql. Deletes every team and channel, with all channel messages, activity and file records.
-- Files in object storage are not touched by this script.
delete from public.messenger_conversations where kind = 'channel';
drop function if exists public.messenger_owned_channel(uuid);
drop table if exists public.messenger_channels;
drop table if exists public.messenger_team_members;
drop table if exists public.messenger_teams;
drop function if exists public.messenger_require_team_owner(uuid);
drop function if exists public.messenger_clean_name(text);
drop function if exists public.messenger_clean_people(uuid[]);
drop function if exists public.messenger_team_member_added();
drop function if exists public.messenger_team_member_removed();
drop function if exists public.messenger_make_channel(uuid, text, text, uuid[], boolean);
drop function if exists public.messenger_create_team(text, text, uuid[]);
drop function if exists public.messenger_update_team(uuid, text, text);
drop function if exists public.messenger_delete_team(uuid);
drop function if exists public.messenger_add_team_members(uuid, uuid[]);
drop function if exists public.messenger_remove_team_member(uuid, uuid);
drop function if exists public.messenger_leave_team(uuid);
drop function if exists public.messenger_set_team_role(uuid, uuid, text);
drop function if exists public.messenger_create_channel(uuid, text, text, uuid[]);
drop function if exists public.messenger_rename_channel(uuid, text);
drop function if exists public.messenger_delete_channel(uuid);
drop function if exists public.messenger_add_channel_members(uuid, uuid[]);
drop function if exists public.messenger_remove_channel_member(uuid, uuid);
drop function if exists public.messenger_leave_channel(uuid);
drop function if exists public.messenger_team_list();
drop function if exists public.messenger_team_people(uuid);
drop function if exists public.messenger_channel_posts(uuid, timestamptz, int);

alter table public.messenger_conversations drop constraint if exists messenger_conversations_kind_check;
alter table public.messenger_conversations add constraint messenger_conversations_kind_check check (kind in ('direct', 'group'));
alter table public.messenger_conversations drop constraint if exists messenger_conversations_check;
alter table public.messenger_conversations add constraint messenger_conversations_check check (
  (kind = 'group' and direct_key is null and title is not null and char_length(title) between 1 and 80)
  or (kind = 'direct' and direct_key is not null and title is null));

-- Back to the versions in 003 and 004.
create or replace function public.messenger_prune_messages() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.messenger_messages where created_at < now() - interval '365 days'
$$;
revoke all on function public.messenger_prune_messages() from public, anon, authenticated;
grant execute on function public.messenger_prune_messages() to service_role;

drop function if exists public.messenger_files(int);
create function public.messenger_files(p_limit int default 100)
returns table (id uuid, conversation_id uuid, file_name text, content_type text, size_bytes bigint, uploader_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.conversation_id, a.file_name, a.content_type, a.size_bytes, p.full_name, a.created_at
  from public.messenger_attachments a
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = (select auth.uid())
  left join public.profiles p on p.id = a.uploaded_by
  where a.deleted_at is null
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

drop function if exists public.messenger_search(text, int);
create function public.messenger_search(p_query text, p_limit int default 30)
returns table (message_id uuid, conversation_id uuid, body text, sender_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_text text; v_query tsquery;
begin
  select string_agg('''' || replace(replace(w, '\', '\\'), '''', '''''') || ''':*', ' & ') into v_text
    from regexp_split_to_table(btrim(coalesce(p_query, '')), '\s+') w where w <> '';
  if v_text is null then return; end if;
  v_query := to_tsquery('simple', v_text);
  return query
    select m.id, m.conversation_id, m.body, p.full_name, m.created_at
    from public.messenger_messages m
    join public.messenger_members me on me.conversation_id = m.conversation_id and me.profile_id = (select auth.uid())
    left join public.profiles p on p.id = m.sender_id
    where m.deleted_at is null and to_tsvector('simple'::regconfig, m.body) @@ v_query
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

drop function if exists public.messenger_activity_list(int);
create function public.messenger_activity_list(p_limit int default 50)
returns table (id uuid, kind text, actor_name text, conversation_id uuid, message_id uuid, preview text, detail text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.kind, p.full_name, a.conversation_id, a.message_id, left(m.body, 200), a.detail, a.read_at, a.created_at
  from public.messenger_activity a
  join public.messenger_messages m on m.id = a.message_id
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = a.profile_id
  left join public.profiles p on p.id = a.actor_id
  where a.profile_id = (select auth.uid())
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.messenger_files(int), public.messenger_search(text, int), public.messenger_activity_list(int) from public, anon, authenticated;
grant execute on function public.messenger_files(int), public.messenger_search(text, int), public.messenger_activity_list(int) to authenticated;
-- messenger_chat_list keeps the extra condition, which is harmless with no channels left; 004_rollback.sql replaces it.
