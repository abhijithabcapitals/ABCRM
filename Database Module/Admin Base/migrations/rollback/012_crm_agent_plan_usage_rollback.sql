-- Undoes 012_crm_agent_plan_usage.sql. This deletes the latest usage reading. Pause the scheduled task first, or its runs will fail.

begin;

drop function if exists public.crm_agent_report_plan_usage(text, jsonb);
drop function if exists public.crm_agent_plan_usage();
drop schema if exists crm_agent cascade;

notify pgrst, 'reload schema';

commit;
