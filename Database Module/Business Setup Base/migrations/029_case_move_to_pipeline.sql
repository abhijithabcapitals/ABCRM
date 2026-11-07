-- =====================================================================
-- Business Setup Base - a manager moves an Onboarding case to Pipeline   029
-- =====================================================================
-- A case at Onboarding moves to Pipeline by itself when every onboarding item is met (016's business_setup_case_sync).
-- This lets a manager move it there by hand before that, with a reason that is kept in the audit log.
-- Runs after 016. Re-runnable. Undo with rollback/029_rollback.sql.
-- =====================================================================

create or replace function public.business_setup_case_move_to_pipeline(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases;
begin
  perform business_setup_require('setup.cases.approve');
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for moving this case to Pipeline'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage <> 'Onboarding' then raise exception 'Only a case at Client Onboarding can move to Pipeline'; end if;
  if c.client_id is null then raise exception 'Link the client to this case first'; end if;
  perform business_setup_case_set_stage(p_case, 'Pipeline', 'Moved to Pipeline by ' || business_setup_person_name(auth.uid()) || ': ' || btrim(p_reason));
  -- Pipeline's own rule runs as usual (every service closed moves the case on).
  perform business_setup_case_sync(p_case);
end $$;
revoke all on function public.business_setup_case_move_to_pipeline(uuid, text) from public, anon;
grant execute on function public.business_setup_case_move_to_pipeline(uuid, text) to authenticated;
