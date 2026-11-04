-- NOT part of the migration and never run by tests/run-local.sh.
-- Needs separate approval from the user before it runs on the live database (pg_cron must be enabled there).
-- Removes chat messages older than 365 days, daily at 03:30 UTC.
select cron.schedule('messenger-prune-messages', '30 3 * * *', $$select public.messenger_prune_messages()$$);
