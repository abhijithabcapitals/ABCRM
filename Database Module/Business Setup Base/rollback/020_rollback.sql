-- Undoes migration 020 only. Client rows and their imported fields stay.
begin;
drop function if exists public.business_setup_client_main_save(text, jsonb);
drop function if exists public.business_setup_client_main_fields();
commit;
