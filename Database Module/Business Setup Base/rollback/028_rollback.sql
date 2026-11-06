-- Undoes migrations/028_case_form_start.sql. Forms already started this way, and their files, are kept: they are ordinary forms.
begin;
drop function if exists public.business_setup_case_form_start(uuid);
commit;
