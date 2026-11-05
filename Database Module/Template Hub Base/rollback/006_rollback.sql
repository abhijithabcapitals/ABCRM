-- Undoes migrations/006_library_letter.sql. Letters already made stay as ordinary letters with their numbers.
drop function if exists public.hub_library_letter_create(jsonb);
