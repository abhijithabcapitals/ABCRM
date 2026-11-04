-- Undoes 004_legacy_import.sql. Drops the apply function and the staging rows (which hold the old export's rows, so keep a copy if you need them).
-- Kept: the jobs already imported, with their legacy_key and legacy_raw, and their 'Imported' events. They may carry payments and follow-ups by now.
-- To remove imported jobs as well, do it by hand after checking nothing was recorded against them.
drop function if exists public.accounting_legacy_apply();
drop table if exists public.accounting_legacy_rows;
