-- Undoes Improvements Base 001. Removes every improvement and its storage policies.
-- The "improvements" bucket and its files are left in place: empty it in the Supabase dashboard first, then delete it there.
drop policy if exists improvements_files_read on storage.objects;
drop policy if exists improvements_files_insert on storage.objects;
drop policy if exists improvements_files_delete on storage.objects;
drop table if exists public.improvement_requests;
drop function if exists public.improvement_requests_stamp();
