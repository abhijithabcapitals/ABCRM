-- Undoes 002_microsoft_connection.sql, including every stored refresh token (ms_rt:%) in Vault.
delete from vault.secrets where name like 'ms\_rt:%';
drop function if exists public.ms_token_set(uuid, text);
drop function if exists public.ms_token_get(uuid);
drop function if exists public.ms_token_delete(uuid);
drop table if exists public.microsoft_user_links;
drop function if exists public.ms_token_cleanup_on_link_delete();
drop function if exists public.ms365_prune_logs();
drop table if exists public.microsoft_sync_log;
drop table if exists public.microsoft_connection;
