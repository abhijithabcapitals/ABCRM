-- Apply after 006_reply_drafts.sql in the CRM Supabase project.
--
-- Keep the incremental UID high-water mark separate from the historical
-- backfill position so new mail can be imported immediately while older mail
-- continues to be captured in resumable batches.
begin;

alter table email_base.mailbox_folders
  add column if not exists backfill_uid bigint,
  add column if not exists backfill_floor_uid bigint not null default 0,
  add column if not exists backfill_resume_uid bigint,
  add column if not exists backfill_resume_floor_uid bigint;

select cron.unschedule(jobid)
from cron.job
where jobname = 'email-base-sync';

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
