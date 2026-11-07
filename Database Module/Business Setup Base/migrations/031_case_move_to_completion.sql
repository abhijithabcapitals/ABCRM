-- =====================================================================
-- Business Setup Base - a manager moves a Pipeline case to Completion   031
-- =====================================================================
-- A case at Pipeline moves to Completion by itself when every service is closed (016's business_setup_case_sync).
-- This lets a manager move it there by hand before that (for example a case with no services), with a reason kept in the audit log.
-- Sending to Accounts from Completion keeps its own checks (011's handover state), so open services still block the handover.
-- Runs after 016. Re-runnable. Undo with rollback/031_rollback.sql.
-- =====================================================================

create or replace function public.business_setup_case_move_to_completion(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases;
begin
  perform business_setup_require('setup.cases.approve');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for moving this case to Completion'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage <> 'Pipeline' then raise exception 'Only a case at Pipeline can move to Completion'; end if;
  if c.client_id is null then raise exception 'Link the client to this case first'; end if;
  perform business_setup_case_set_stage(p_case, 'Completion', 'Moved to Completion by ' || business_setup_person_name(auth.uid()) || ': ' || btrim(p_reason));
  -- Completion's own rule runs as usual (a handover already with Accounts moves the case on).
  perform business_setup_case_sync(p_case);
end $$;
revoke all on function public.business_setup_case_move_to_completion(uuid, text) from public, anon;
grant execute on function public.business_setup_case_move_to_completion(uuid, text) to authenticated;
