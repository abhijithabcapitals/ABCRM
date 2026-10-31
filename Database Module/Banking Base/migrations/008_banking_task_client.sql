-- =====================================================================
-- Banking Base - tasks linked to a client                          008
-- =====================================================================
-- A task can belong to a client who has no banking case yet. Idempotent: safe to re-run.
-- =====================================================================
alter table public.banking_tasks add column if not exists client_id uuid references public.banking_clients(id);
create index if not exists banking_task_client_idx on public.banking_tasks (client_id);
update public.banking_tasks t set client_id = c.client_id from public.banking_cases c where t.case_id = c.id and t.client_id is null;
