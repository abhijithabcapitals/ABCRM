-- Removes 009_client_master_migration.sql. Every client shows on the Client Master tab again. History rows stay.
drop function if exists public.client_master_set_status(text[], text);
drop index if exists public.client_master_status_idx;
alter table public.client_master drop constraint if exists client_master_status_check;
alter table public.client_master drop column if exists status;
