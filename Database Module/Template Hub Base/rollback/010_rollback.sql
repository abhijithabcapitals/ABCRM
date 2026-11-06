-- Undoes migrations/010_accounting_send_from.sql. Run first, before 009_rollback.sql and 008_rollback.sql. The record of which mailbox sent each mail is lost.
alter table public.hub_documents drop column if exists mail_sent_from;
