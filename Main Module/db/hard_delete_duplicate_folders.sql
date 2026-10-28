-- =====================================================================
-- PERMANENT delete of the duplicate "Advertising" folders + lists
-- =====================================================================
-- Run in the Supabase SQL editor. THIS IS IRREVERSIBLE (hard delete).
-- Only run AFTER cleanup_duplicate_advertising_folders.sql has consolidated
-- tasks onto the canonical folder/lists.
--
-- Canonical (keep):
--   space   7bf8c6f0-4ffd-4cca-8806-53220166d00f  (Marketing Leads)
--   folder  73881dd6-3e83-4096-a128-bf4957d7e009  (Advertising)
-- Everything else in this space (other "Advertising" folders and every
-- list not under the canonical folder) is a duplicate and is deleted.
-- =====================================================================

-- ---- Pre-check (expect: 0 tasks; 635 dup lists; 635 dup folders) ----
select 'tasks referencing dup folder/list (MUST be 0)' as what, count(*) from tasks
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id <> '73881dd6-3e83-4096-a128-bf4957d7e009'
union all
select 'dup lists', count(*) from lists
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id <> '73881dd6-3e83-4096-a128-bf4957d7e009'
union all
select 'dup folders', count(*) from folders
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and name='Advertising' and id <> '73881dd6-3e83-4096-a128-bf4957d7e009';

-- ---- Delete (only proceed if the pre-check shows 0 tasks) ----
do $$
declare
  s  uuid := '7bf8c6f0-4ffd-4cca-8806-53220166d00f';
  f0 uuid := '73881dd6-3e83-4096-a128-bf4957d7e009';
  dup_lists uuid[];
  task_refs int;
begin
  -- Abort if any task still points at a duplicate folder (safety guard).
  select count(*) into task_refs from tasks where space_id = s and folder_id <> f0;
  if task_refs > 0 then
    raise exception 'Aborting: % task(s) still reference a duplicate folder. Run the consolidation script first.', task_refs;
  end if;

  select array_agg(id) into dup_lists from lists where space_id = s and folder_id <> f0;

  if dup_lists is not null then
    -- Remove any field/status defs that were attached to duplicate lists.
    delete from space_fields   where list_id = any(dup_lists);
    delete from space_statuses where list_id = any(dup_lists);
    -- Delete the duplicate lists.
    delete from lists where id = any(dup_lists);
  end if;

  -- Delete the duplicate Advertising folders (keep the canonical one).
  delete from folders where space_id = s and name = 'Advertising' and id <> f0;
end $$;

-- ---- Verify (expect: 1 folder, and 0 dup lists) ----
select 'advertising folders (expect 1)' as what, count(*) from folders
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f' and name='Advertising'
union all
select 'lists outside canonical folder (expect 0)', count(*) from lists
  where space_id='7bf8c6f0-4ffd-4cca-8806-53220166d00f'
    and folder_id <> '73881dd6-3e83-4096-a128-bf4957d7e009';
