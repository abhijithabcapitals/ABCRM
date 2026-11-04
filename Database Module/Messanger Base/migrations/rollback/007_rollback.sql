-- Undoes 007_inbox_channels.sql. Deletes every connected account, its stored conversations and its Vault secrets.
-- It does not tell the platforms: remove the webhooks on Telegram and Meta by hand.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_inbox_messages') then
    alter publication supabase_realtime drop table public.messenger_inbox_messages;
  end if;
end $$;
delete from vault.secrets where name like 'inbox:%';
drop table if exists public.messenger_inbox_messages;
drop table if exists public.messenger_inbox_threads;
drop table if exists public.messenger_inbox_access;
drop table if exists public.messenger_inbox_accounts cascade;
drop function if exists public.messenger_inbox_can(uuid);
drop function if exists public.messenger_inbox_secret_set(uuid, text, text);
drop function if exists public.messenger_inbox_secret_get(uuid, text);
drop function if exists public.messenger_inbox_account_gone();
drop function if exists public.messenger_inbox_require_admin();
drop function if exists public.messenger_inbox_connect(text, text, text, text);
drop function if exists public.messenger_inbox_disconnect(uuid);
drop function if exists public.messenger_inbox_set_access(uuid, uuid[]);
drop function if exists public.messenger_inbox_admin_list();
drop function if exists public.messenger_inbox_set_status(uuid, text);
drop function if exists public.messenger_inbox_assign(uuid, uuid);
drop function if exists public.messenger_inbox_unread();
drop function if exists public.messenger_inbox_send_begin(uuid, text);
drop function if exists public.messenger_inbox_send_done(uuid, text, boolean);
drop function if exists public.messenger_inbox_store(uuid, text, text, text, text, timestamptz);
