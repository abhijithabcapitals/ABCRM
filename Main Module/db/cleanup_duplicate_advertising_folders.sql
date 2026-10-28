-- =====================================================================
-- One-off cleanup: consolidate duplicate "Advertising" folders / lists
-- =====================================================================
-- A bug in the lead-ingest Edge Function (ordering by a non-existent
-- folders.created_at column, then treating the errored lookup as
-- "not found") auto-created a new "Advertising" folder + list on every
-- request. This merges everything back into the original folder/lists.
--
-- PRE-REQ: deploy the fixed Edge Function FIRST, or new duplicates will
-- keep appearing while/after you run this.
--
-- Canonical ids (Marketing Leads space):
--   space   7bf8c6f0-4ffd-4cca-8806-53220166d00f
--   folder  73881dd6-3e83-4096-a128-bf4957d7e009  ("Advertising", the real one)
--
-- Run the SELECTs first to preview, then the DO block. Idempotent.
-- =====================================================================

-- ---- Preview (safe to run anytime) ----
-- Duplicate folders / lists / tasks that will be consolidated:
select 'dup folders' as what, count(*) from folders
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f' and name='Advertising'
    and id<>'73881dd6-3e83-4096-a128-bf4957d7e009' and deleted_at is null
union all
select 'dup lists', count(*) from lists
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id<>'73881dd6-3e83-4096-a128-bf4957d7e009' and deleted_at is null
union all
select 'tasks to move', count(*) from tasks
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id<>'73881dd6-3e83-4096-a128-bf4957d7e009' and deleted_at is null;

-- ---- Consolidation ----
do $$
declare
  s  uuid := '7bf8c6f0-4ffd-4cca-8806-53220166d00f';   -- Marketing Leads space
  f0 uuid := '73881dd6-3e83-4096-a128-bf4957d7e009';   -- canonical Advertising folder
begin
  -- 1. Move tasks from each duplicate list to the same-named canonical list
  --    that lives directly under the canonical folder.
  update tasks t
     set list_id = c.id, folder_id = f0, updated_at = now()
    from lists d
    join lists c on c.name = d.name and c.folder_id = f0 and c.deleted_at is null
   where t.list_id = d.id
     and d.space_id = s
     and d.folder_id <> f0
     and d.deleted_at is null;

  -- 2. Safety net: any remaining task still pointing at a duplicate folder
  --    (e.g. a list name with no canonical match) is re-parented to f0 so it
  --    is never orphaned by the folder soft-delete below.
  update tasks
     set folder_id = f0, updated_at = now()
   where space_id = s
     and folder_id in (select id from folders
                         where space_id = s and name = 'Advertising' and id <> f0);

  -- 3. Soft-delete the duplicate lists (everything not under the canonical folder).
  update lists
     set deleted_at = now()
   where space_id = s
     and folder_id <> f0
     and deleted_at is null;

  -- 4. Soft-delete the duplicate Advertising folders (keep the canonical one).
  update folders
     set deleted_at = now()
   where space_id = s
     and name = 'Advertising'
     and id <> f0
     and deleted_at is null;
end $$;

-- ---- Verify after running ----
-- Expect: 1 Advertising folder, 1 of each list name, all tasks under f0.
select 'advertising folders (expect 1)' as what, count(*) from folders
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f' and name='Advertising' and deleted_at is null
union all
select 'WA POP UP lists (expect 1)', count(*) from lists
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f' and name='WA POP UP' and deleted_at is null
union all
select 'tasks outside canonical folder (expect 0)', count(*) from tasks
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id<>'73881dd6-3e83-4096-a128-bf4957d7e009' and deleted_at is null;
