-- =====================================================================
-- Banking Base - 18-step workflow                                  005
-- =====================================================================
-- Inserts "Lead Verification & Assignment" as step 2, so old steps 2-17 become 3-18.
-- Earlier stage history rows keep the numbers they were written with; a note row marks the change.
-- Runs its renumbering once.
-- =====================================================================
alter table public.banking_cases drop constraint if exists banking_cases_current_stage_check;
alter table public.banking_cases add constraint banking_cases_current_stage_check check (current_stage between 1 and 18);

do $$
begin
  if exists (select 1 from public.banking_settings where key = 'stages_18') then return; end if;
  perform set_config('banking.internal', '1', true);
  insert into public.banking_case_stage_history (case_id, from_stage, to_stage, remarks)
  select id, current_stage, current_stage + 1, 'Workflow renumbered to 18 steps' from public.banking_cases where current_stage >= 2;
  update public.banking_cases set current_stage = current_stage + 1 where current_stage >= 2;
  perform set_config('banking.internal', '', true);
  insert into public.banking_settings (key, value, description) values ('stages_18', 'true', 'Marks the 18-step renumbering as done.');
end $$;
