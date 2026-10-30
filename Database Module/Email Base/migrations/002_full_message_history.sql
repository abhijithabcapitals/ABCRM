-- Apply after 001_email_base.sql in the CRM Supabase project.
-- Adds body retention, assigns the CEO owner, and points the recurring sync at CRM.
begin;

alter table email_base.messages
  add column if not exists body_text text not null default '';

-- Associate the shared mailboxes with the provisioned CRM CEO owner so the
-- existing owner-scoped policies allow the Inbox to read them.
update email_base.mailboxes
set owner_user_id = (
  select p.user_id from ceo.profiles p
  where p.role = 'owner'
  order by p.created_at
  limit 1
)
where owner_user_id is null
  and address in ('info@abcapital.ae', 'bharat@ardentaxit.tax');

-- Re-fetch existing messages so bodies are populated and all historical UIDs
-- are backfilled in ascending batches by ceo-mail-sync.
update email_base.mailboxes
set uidvalidity = null, last_uid = 0, updated_at = now()
where address in ('info@abcapital.ae', 'bharat@ardentaxit.tax');

select cron.unschedule(jobid)
from cron.job
where jobname = 'email-base-sync';

select cron.schedule(
  'email-base-sync',
  '*/15 * * * *',
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

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, acct, ceo, email_base';
notify pgrst, 'reload config';

commit;
