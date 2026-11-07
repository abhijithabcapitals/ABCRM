-- Restores the Email Base inbox sync after the 2026-11-06 switch-off. NOT APPLIED; needs approval.
-- Run only after ceo-mail-sync is redeployed from this branch (it skips UIDs listed in
-- email_base.archived_messages, the SharePoint archive table from migration 009).
-- Deletes no mail. Pruning is done by the email-archive job (Email Base migrations 009-010).
--
-- 1. Saves each enabled folder's position, then resets it so the next runs re-read the last
--    15 days (ceo-mail-sync MAIL_WINDOW_DAYS) newest first.
-- 2. Schedules ceo-mail-sync every 2 minutes again (job email-base-sync).
--
-- Undo:
--   select cron.unschedule('email-base-sync');
--   update email_base.mailbox_folders f set last_uid = b.last_uid, backfill_uid = b.backfill_uid,
--     backfill_floor_uid = b.backfill_floor_uid, backfill_resume_uid = b.backfill_resume_uid,
--     backfill_resume_floor_uid = b.backfill_resume_floor_uid
--   from optimize_rollback.mail_cursor_20261106 b where f.id = b.id;

begin;

create schema if not exists optimize_rollback;
revoke all on schema optimize_rollback from public;

create table if not exists optimize_rollback.mail_cursor_20261106 as
  select id, last_uid, backfill_uid, backfill_floor_uid, backfill_resume_uid, backfill_resume_floor_uid
  from email_base.mailbox_folders
  where enabled;

update email_base.mailbox_folders
  set last_uid = 0, backfill_uid = null, backfill_floor_uid = 0,
      backfill_resume_uid = null, backfill_resume_floor_uid = null, last_error = null,
      updated_at = now()
  where enabled;

select cron.schedule(
  'email-base-sync',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ceo-mail-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_base_sync_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

commit;
