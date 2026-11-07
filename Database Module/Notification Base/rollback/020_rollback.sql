-- Rollback for 020_changes_made.sql. Safe to run twice. Run before any older rollback.
-- Drops the CHANGES MADE log with everything it recorded; Client Master keeps its own history.
do $$
begin
  if to_regclass('public.client_master_history') is not null then drop trigger if exists changes_made_master on public.client_master_history; end if;
  if to_regclass('public.business_setup_kyc_profiles') is not null then drop trigger if exists changes_made_kyc on public.business_setup_kyc_profiles; end if;
  if to_regclass('public.business_setup_kyc_partners') is not null then drop trigger if exists changes_made_partner on public.business_setup_kyc_partners; end if;
  if to_regclass('public.banking_kyc_profiles') is not null then drop trigger if exists changes_made_kyc on public.banking_kyc_profiles; end if;
  if to_regclass('public.banking_kyc_shareholders') is not null then drop trigger if exists changes_made_partner on public.banking_kyc_shareholders; end if;
end $$;
drop function if exists public.changes_made_mark_seen();
drop function if exists public.changes_made_list(int, int);
drop function if exists public.changes_made_can_read();
drop function if exists public.changes_made_master_trg() cascade;
drop function if exists public.changes_made_trg() cascade;
drop function if exists public.changes_made_write(text, text, text, text, text, text, uuid, timestamptz);
drop function if exists public.changes_made_client(text, jsonb);
drop function if exists public.changes_made_show(text, text);
drop function if exists public.changes_made_label(text);
drop table if exists public.changes_made_seen;
drop table if exists public.changes_made_log;
drop function if exists public.changes_made_locked();
