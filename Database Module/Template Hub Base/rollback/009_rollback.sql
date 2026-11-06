-- Undoes migrations/009_accounting_send_from.sql. Run before 008_rollback.sql. The record of which mailbox sent each mail is lost.
alter table public.hub_documents drop column if exists mail_sent_from;
