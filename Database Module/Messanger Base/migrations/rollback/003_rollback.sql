-- Undoes 003_chat.sql, including every conversation, member and message.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_messages') then
    alter publication supabase_realtime drop table public.messenger_messages;
  end if;
end $$;
drop table if exists public.messenger_messages;
drop table if exists public.messenger_members;
drop table if exists public.messenger_conversations;
drop function if exists public.messenger_is_member(uuid);
drop function if exists public.messenger_start_direct(uuid);
drop function if exists public.messenger_create_group(text, uuid[]);
drop function if exists public.messenger_add_members(uuid, uuid[]);
drop function if exists public.messenger_remove_member(uuid, uuid);
drop function if exists public.messenger_rename_group(uuid, text);
drop function if exists public.messenger_leave(uuid);
drop function if exists public.messenger_mark_read(uuid);
drop function if exists public.messenger_chat_list();
drop function if exists public.messenger_read_state(uuid);
drop function if exists public.messenger_prune_messages();
drop function if exists public.messenger_require_owner(uuid, uuid);
drop function if exists public.messenger_stamp_message();
drop function if exists public.messenger_touch_conversation();
drop function if exists public.messenger_after_member_delete();
