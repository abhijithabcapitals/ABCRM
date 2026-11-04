-- DRAFT FOR REVIEW. NOT APPLIED. Test while signed in as a member before any live use.
--
-- Today "Authenticated users full access" (FOR ALL, every table below) overrides the admin-only rules:
-- Postgres allows a row if ANY policy allows it, so any signed-in staff member can call the API directly
-- and delete spaces, folders, statuses, fields or tasks, whatever the screens show.
--
-- This keeps daily work as it is: staff still read everything they read today, and still create and
-- edit tasks. It takes away only structure changes and permanent deletes, which become admin-only.
--
-- Not changed here, because each is your decision:
--   1. Staff can still see all tasks. "Only my tasks" would hide team work.
--   2. space_access and folder_access are checked in the screens only. Both have 0 rows today.
--   3. Moving a task to Trash stays open to staff (it is an update, not a delete).
--   4. lists keeps "Allow all for authenticated"; the sidebar lets people add lists.
--   5. Attachments and checklists stay open; staff remove their own items in the task drawer.
--
-- Check first as a member: adding a custom field or status from a task list. If members need that,
-- leave space_fields and space_statuses out of part 1.

begin;

-- Part 1: structure. Admin and read policies already exist on these tables, so only the override goes.
drop policy "Authenticated users full access" on public.spaces;
drop policy "Authenticated users full access" on public.folders;
drop policy "Authenticated users full access" on public.space_fields;
drop policy "Authenticated users full access" on public.space_statuses;
drop policy "Authenticated users full access" on public.wiki_categories;
drop policy "Authenticated users full access" on public.wiki_articles;

-- Part 2: tasks. Staff keep read, create and edit; permanent delete uses the existing admin policy.
drop policy "Authenticated users full access" on public.tasks;
create policy "Staff can read tasks" on public.tasks for select to authenticated using (true);
create policy "Staff can create tasks" on public.tasks for insert to authenticated with check (true);
create policy "Staff can edit tasks" on public.tasks for update to authenticated using (true) with check (true);

drop policy "Authenticated users full access" on public.task_field_values;
create policy "Staff can read field values" on public.task_field_values for select to authenticated using (true);
create policy "Staff can create field values" on public.task_field_values for insert to authenticated with check (true);
create policy "Staff can edit field values" on public.task_field_values for update to authenticated using (true) with check (true);

-- Part 3: history cannot be rewritten by staff. Only admins remove it, with a permanent delete.
drop policy "Authenticated users full access" on public.task_history;
create policy "Staff can read task history" on public.task_history for select to authenticated using (true);
create policy "Staff can add task history" on public.task_history for insert to authenticated with check (true);
create policy "Admins can remove task history" on public.task_history for delete to authenticated
  using (exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

drop policy "Authenticated users full access" on public.wiki_history;
create policy "Staff can read wiki history" on public.wiki_history for select to authenticated using (true);
create policy "Staff can add wiki history" on public.wiki_history for insert to authenticated with check (true);

commit;

-- Undo: drop the policies created above, then on each table named here run:
--   create policy "Authenticated users full access" on public.<table> for all
--     using ((select auth.role()) = 'authenticated') with check ((select auth.role()) = 'authenticated');
