-- =====================================================================
-- Wiki history: track attachment add/delete events
-- =====================================================================
-- Adds an `action` column to wiki_history so attachment events can be
-- logged alongside content versions. Content versions leave it NULL;
-- attachment events set 'attachment_added' / 'attachment_deleted' and
-- store the file name in the existing `title` column. Run once. Idempotent.
-- =====================================================================

alter table wiki_history add column if not exists action text;
