-- Removes the OneDrive folder map from 007_storage_folders.sql. No OneDrive folder or file is touched.
drop view if exists public.storage_document_links;
drop view if exists public.storage_owner_folders;
drop table if exists public.storage_folders;
drop table if exists public.storage_doc_folders;
drop table if exists public.storage_settings;
drop function if exists public.storage_doc_target(text, text, text, text);
drop function if exists public.storage_owner_folder(text, text, text);
drop function if exists public.storage_folder_decide(uuid, text, text);
drop function if exists public.storage_folders_sync(text, jsonb);
drop function if exists public.storage_folder_match(text, text, text);
drop function if exists public.storage_folder_can(text, boolean);
drop function if exists public.storage_name_score(text, text, boolean);
drop function if exists public.storage_name_tokens(text);
