-- =====================================================================
-- Phase 4 — schedule the automation-email sender (pg_cron + pg_net)
-- =====================================================================
-- Every minute, invoke the send-automation-emails Edge Function to drain
-- automation_email_queue. Run in the Supabase SQL editor AFTER the Edge
-- Function is deployed and its secrets are set.
--
-- Replace REPLACE_WITH_WEBHOOK_SECRET below with the same value you set as
-- the function's EMAIL_WEBHOOK_SECRET secret (a distinct name from the
-- lead-ingest function's WEBHOOK_SECRET). Idempotent (re-run to update).
-- =====================================================================

create extension if not exists pg_net;   -- outbound HTTP from Postgres

do $$
begin
  -- remove any previous schedule of this job
  perform cron.unschedule('abcap-send-automation-emails')
    from cron.job where jobname = 'abcap-send-automation-emails';

  perform cron.schedule(
    'abcap-send-automation-emails',
    '* * * * *',   -- every minute
    $cron$
      select net.http_post(
        url     := 'https://kokyhqbsdftyyjirzzvs.supabase.co/functions/v1/send-automation-emails',
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'x-webhook-secret', 'REPLACE_WITH_WEBHOOK_SECRET'
                   ),
        body    := '{}'::jsonb
      );
    $cron$
  );
end $$;

-- To pause email sending later:
--   select cron.unschedule('abcap-send-automation-emails');
-- To watch results:
--   select status, error, created_at, sent_at from automation_email_queue order by created_at desc limit 20;
