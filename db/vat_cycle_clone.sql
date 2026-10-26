-- VAT cycle: lineage link for the "clone on Return Filed" flow.
-- When a task is cloned (status -> To Do, due date +3 months/28th), the new
-- task records which task it came from in `cloned_from`. When that clone is
-- itself marked Return Filed and spawns the next clone, the app soft-deletes
-- the task referenced by its `cloned_from`, so only the latest Return Filed +
-- the next To Do remain. Run in the Supabase SQL editor (idempotent).

alter table tasks add column if not exists cloned_from uuid references tasks(id) on delete set null;

create index if not exists tasks_cloned_from_idx on tasks (cloned_from) where deleted_at is null;
