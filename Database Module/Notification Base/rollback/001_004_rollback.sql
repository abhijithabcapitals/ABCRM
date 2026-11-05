-- Rollback for Notification Base migrations 001 to 004. Covers only what exists today; extended as migrations are added.
-- Safe to run twice. Deletes the alert_centre bell rows; other notifications stay.
do $$ begin
  if to_regclass('public.notifications') is not null then
    delete from public.notifications where type = 'alert_centre';
  end if;
end $$;

-- 001: tables first (their policies depend on the functions), then functions
drop table if exists public.alert_scan_log;
drop table if exists public.alert_events;
drop function if exists public.alert_events_append_only();
drop table if exists public.alert_recipients;
drop table if exists public.alerts;
drop sequence if exists public.alert_number_seq;
drop table if exists public.client_owners;
drop table if exists public.alert_rules;
drop table if exists public.alert_settings;
drop function if exists public.alert_raise(text, text, text, text, text, date, int, text, uuid, text, text, uuid, text, uuid[]);
drop function if exists public.alert_add_recipient(uuid, uuid, text);
drop function if exists public.alert_bell(uuid, uuid, text);
drop function if exists public.alert_can_see(uuid);
drop function if exists public.alert_owner(text, text);
drop function if exists public.alert_managers();
drop function if exists public.alert_is_manager();
drop function if exists public.alert_is_admin();
drop function if exists public.alert_mode();
