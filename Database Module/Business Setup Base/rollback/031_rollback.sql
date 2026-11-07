-- Undoes migrations/031_case_move_to_completion.sql. Cases already moved stay at Completion: their move is in the audit log.
begin;
drop function if exists public.business_setup_case_move_to_completion(uuid, text);
commit;
