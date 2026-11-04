-- Undoes 005_job_fee_vat.sql: the amount due, payment and link functions go back to their 003 and 002 definitions.
-- It runs 003 and 002 again (both re-runnable) to put their older view and functions back.
-- Payments recorded against a fee plus VAT stay as they are.
drop function if exists public.accounting_quote_vat_mode(uuid);
-- The view and functions use accounting_fee_with_vat, so they are replaced from the older files first.
\ir ../003_payments_followups.sql
\ir ../002_jobs.sql
drop function if exists public.accounting_fee_with_vat(numeric, uuid);
