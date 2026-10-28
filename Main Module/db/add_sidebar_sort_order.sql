-- =====================================================================
-- Sidebar reordering — add sort_order to spaces / folders / lists
-- =====================================================================
-- Enables drag-and-drop reordering of spaces, folders (within a space),
-- and lists (within a folder) in the sidebar. Run once in the Supabase
-- SQL editor. Idempotent.
-- =====================================================================

alter table spaces  add column if not exists sort_order double precision;
alter table folders add column if not exists sort_order double precision;
alter table lists   add column if not exists sort_order double precision;

-- Seed existing rows by their current created_at order, so nothing jumps
-- around on first load. Only fills rows that don't have a value yet.
update spaces s set sort_order = sub.rn
  from (select id, row_number() over (order by created_at) rn from spaces) sub
 where s.id = sub.id and s.sort_order is null;

-- folders has no created_at column — seed by name (alphabetical) instead.
update folders f set sort_order = sub.rn
  from (select id, row_number() over (partition by space_id order by name) rn from folders) sub
 where f.id = sub.id and f.sort_order is null;

update lists l set sort_order = sub.rn
  from (select id, row_number() over (partition by folder_id order by created_at) rn from lists) sub
 where l.id = sub.id and l.sort_order is null;
