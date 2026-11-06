-- =====================================================================
-- Template Hub Base - Accounting mail: which mailbox sent it          009
-- =====================================================================
-- The mailbox an Accounting quote or agreement was mailed from, written with the sent mark by accounting-proposal-mail-send.
-- Run after 008. Re-runnable. Undo with rollback/009_rollback.sql.
-- =====================================================================
alter table public.hub_documents add column if not exists mail_sent_from text;
