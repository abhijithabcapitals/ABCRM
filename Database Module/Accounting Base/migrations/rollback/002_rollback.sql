-- Undoes 002_jobs.sql. Destroys every job, batch, file and event, so export them first. Later migrations (payments, follow-ups) must be rolled back first.
drop function if exists public.accounting_invoice_clear(uuid, text);
drop function if exists public.accounting_invoice_set(uuid, text, date, numeric);
drop function if exists public.accounting_batch_set_saved(uuid, boolean);
drop function if exists public.accounting_batch_add(jsonb);
drop function if exists public.accounting_job_link_client(uuid, text);
drop function if exists public.accounting_job_link_document(uuid, text, uuid, boolean);
drop function if exists public.accounting_job_set_fee(uuid, numeric);
drop function if exists public.accounting_job_set_status(uuid, text, text, timestamptz);
drop function if exists public.accounting_job_save(jsonb);
drop function if exists public.accounting_job_event(uuid, text, text, text, text);
drop table if exists public.accounting_job_events;
drop table if exists public.accounting_job_files;
drop table if exists public.accounting_job_batches;
drop table if exists public.accounting_jobs;
drop sequence if exists public.accounting_job_seq;
drop function if exists public.accounting_dubai_date(timestamptz);
