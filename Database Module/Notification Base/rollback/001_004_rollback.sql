-- Rollback for Notification Base migrations 001 to 004. Newest migration first.
-- Safe to run twice. Deletes the alert_centre bell rows; other notifications stay.
do $$ begin
  if to_regclass('public.notifications') is not null then
    delete from public.notifications where type = 'alert_centre';
  end if;
end $$;

-- 004: read functions (no tables of their own). Dropped first: alert_scope_rows returns the alerts row type.
drop function if exists public.alert_my_access();
drop function if exists public.alert_coverage();
drop function if exists public.alert_management_summary();
drop function if exists public.alert_detail(uuid);
drop function if exists public.alert_tiles(text, text);
drop function if exists public.alert_list(text, text, text, int, int);
drop function if exists public.alert_scope_rows(text, text);

-- 003: browser actions, escalation, owner functions, settings (no tables of their own)
drop function if exists public.alert_scan_now();
drop function if exists public.alert_set_mode(text);
drop function if exists public.alert_rule_save(text, boolean, jsonb);
drop function if exists public.client_owners_set(text, text[], uuid);
drop function if exists public.client_owner_proposals(text);
drop function if exists public.client_owner_list(text);
drop function if exists public.alert_escalate_due();
drop function if exists public.alert_mark_read(uuid);
drop function if exists public.alert_escalate(uuid, text);
drop function if exists public.alert_resolve(uuid, text, boolean);
drop function if exists public.alert_set_status(uuid, text);
drop function if exists public.alert_assign(uuid, uuid);
drop function if exists public.alert_set_assignee(uuid, uuid);
drop function if exists public.alert_notify_managers(uuid, boolean);
drop function if exists public.alert_can_act(uuid, boolean);

-- 002: unschedule the scan (safe when pg_cron or the job is absent), then scan, rule functions, helper, type, step function
do $$ begin
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'alert-scan';
  end if;
end $$;
drop function if exists public.alert_scan();
drop function if exists public.alert_rule_licence_expiry();
drop function if exists public.alert_rule_visa_expiry();
drop function if exists public.alert_rule_job_due();
drop function if exists public.alert_rule_service_due();
drop function if exists public.alert_rule_setup_task_due();
drop function if exists public.alert_rule_banking_task_due();
drop function if exists public.alert_rule_crm_task_due();
drop function if exists public.alert_safe_date(text);
drop type if exists public.alert_candidate;
drop function if exists public.alert_step_for(jsonb, int);

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
