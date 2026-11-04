-- Drops the Zoho finance snapshot table and its single row. The Dashboard cards then have no Zoho figures until 008 runs again.
drop table if exists public.zoho_finance_snapshot;
