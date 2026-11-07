-- Undoes migrations/029_case_move_to_pipeline.sql. Cases already moved stay in Pipeline: their move is in the audit log.
begin;
drop function if exists public.business_setup_case_move_to_pipeline(uuid, text);
commit;
