-- Add a human-friendly lifecycle category to statuses, shown as a dropdown in
-- "Manage statuses": Auto / To Do / In Progress / Complete.
--
-- status_category holds the label (null = Auto = detect by name). The app keeps
-- the existing is_complete column in sync (Complete → true, To Do / In Progress
-- → false, Auto → null), so the dashboards' completion rate is unchanged.
--
-- Run in the Supabase SQL editor (idempotent).

alter table space_statuses add column if not exists status_category text;

-- (Optional) backfill labels from existing is_complete so old rows show a
-- sensible default in the dropdown. Auto stays Auto (null); explicit true/false
-- become Complete / In Progress. Safe to skip — the app derives the same
-- display when status_category is null.
update space_statuses
set status_category = case when is_complete = true then 'complete'
                           when is_complete = false then 'in_progress' end
where status_category is null and is_complete is not null;
