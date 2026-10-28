-- =====================================================================
-- Make list statuses independent (materialize folder statuses per list)
-- =====================================================================
-- Older lists (e.g. Master List, VISA Master List) inherit their statuses
-- from the folder, so deleting a status would affect every inheriting list.
-- This gives each such list its OWN copy of the folder's statuses (same
-- name, color, and order), so statuses can be added/removed per list.
--
-- SAFE: task.status is stored as text, and we copy identical definitions,
-- so nothing changes visually and no task status is modified. Lists that
-- already have their own statuses (e.g. Ejari List) are skipped.
--
-- Scope: the "Business Setup" folder in the "Delivery" space. Run in the
-- Supabase SQL editor. Idempotent (won't duplicate on re-run).
-- =====================================================================

-- ---- Preview: lists that will receive copies (those with 0 of their own) ----
select l.name, count(x.id) as own_statuses
from lists l
left join space_statuses x on x.list_id = l.id
where l.folder_id = 'ae9993db-fe83-4c5e-8133-6346357b993d' and l.deleted_at is null
group by l.name
order by l.name;

-- ---- Seed list-scoped copies from the folder's statuses ----
insert into space_statuses (space_id, folder_id, list_id, name, color, status_order)
select ss.space_id, ss.folder_id, l.id, ss.name, ss.color, ss.status_order
from lists l
join space_statuses ss
  on ss.folder_id = l.folder_id and ss.list_id is null
where l.folder_id = 'ae9993db-fe83-4c5e-8133-6346357b993d'
  and l.deleted_at is null
  and not exists (select 1 from space_statuses x where x.list_id = l.id);

-- ---- Verify: every active list in the folder should now have its own set ----
select l.name, count(x.id) as own_statuses
from lists l
left join space_statuses x on x.list_id = l.id
where l.folder_id = 'ae9993db-fe83-4c5e-8133-6346357b993d' and l.deleted_at is null
group by l.name
order by l.name;

-- =====================================================================
-- OPTIONAL — generalize to EVERY folder/list in the workspace.
-- Uncomment to give every list that still inherits its own copy, so all
-- lists become independently editable. Same safety guarantees.
-- =====================================================================
-- insert into space_statuses (space_id, folder_id, list_id, name, color, status_order)
-- select ss.space_id, ss.folder_id, l.id, ss.name, ss.color, ss.status_order
-- from lists l
-- join space_statuses ss on ss.folder_id = l.folder_id and ss.list_id is null
-- where l.deleted_at is null
--   and not exists (select 1 from space_statuses x where x.list_id = l.id);
