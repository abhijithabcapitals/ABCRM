-- NOT part of the migration and never run by tests/run-local.sh.
-- Needs separate approval from the user before it runs on the live database (pg_cron must be enabled there).
-- Prunes microsoft_sync_log rows older than 90 days, daily at 03:00 UTC.
select cron.schedule('ms365-prune-logs', '0 3 * * *', $$select public.ms365_prune_logs()$$);
