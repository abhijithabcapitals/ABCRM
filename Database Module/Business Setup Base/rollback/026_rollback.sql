-- Undoes migrations/026_client_service_lines.sql. The client service lines are deleted; quotes issued from them are kept.
begin;
drop function if exists public.business_setup_service_line_quoted(uuid, uuid[]);
drop function if exists public.business_setup_service_line_delete(uuid);
drop function if exists public.business_setup_service_line_save(jsonb);
drop function if exists public.business_setup_service_line_list(text);
drop table if exists public.business_setup_client_service_lines;
commit;
