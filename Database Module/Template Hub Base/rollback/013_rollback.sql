-- Undoes migrations/013_banking_signing.sql. Run first, before 012_rollback.sql.
-- Business Banking goes back to 011 alone: a new generated file only moves the change stamp and the screen ends the signature; a
-- line item change no longer moves the quotation's stamp. Signing records and stamps already written are kept.
drop trigger if exists doc_sign_banking_filed on public.banking_generated_documents;
drop trigger if exists doc_sign_banking_items on public.banking_quotation_items;
drop function if exists public.doc_sign_banking_filed();
drop function if exists public.doc_sign_banking_items();
