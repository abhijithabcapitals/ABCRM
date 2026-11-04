-- Undoes 001_router.sql: removes the router schema, so ALL saved agent names, CEO thread links and chats are deleted.
-- It leaves the stricter agent_table_allowed (which also refuses schema router) and the AGT-05-BIZDEV runtime in place.
drop function if exists public.router_record_usage(text, uuid, numeric);
drop function if exists public.router_set_ceo_thread(uuid, uuid);
drop function if exists public.router_save_message(uuid, text, text, text);
drop function if exists public.router_context(uuid);
drop function if exists public.router_clear();
drop function if exists public.router_history();
drop function if exists public.router_set_agent_name(text);
drop function if exists public.router_my_agent_name();
drop schema if exists router cascade;
