-- =====================================================================
-- Banking Base - private document storage                          004
-- =====================================================================
-- Supabase Storage bucket for KYC documents, agreements, proofs and generated PDFs.
-- Private: files open only through short-lived signed URLs. Supabase encrypts storage at rest.
-- Path: <case id>/<area>/<uuid>-<file name>. Skipped on plain PostgreSQL (local tests).
-- =====================================================================
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: skipped';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('banking-documents', 'banking-documents', false, 26214400)
  on conflict (id) do update set public = false;

  drop policy if exists banking_docs_read on storage.objects;
  create policy banking_docs_read on storage.objects for select to authenticated
    using (bucket_id = 'banking-documents' and (public.banking_can('docs.view') or public.banking_can('agreements.view') or public.banking_can('payments.view') or public.banking_can('quotes.view')));
  drop policy if exists banking_docs_insert on storage.objects;
  create policy banking_docs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'banking-documents' and (public.banking_can('docs.manage') or public.banking_can('agreements.manage') or public.banking_can('payments.manage') or public.banking_can('apps.manage') or public.banking_can('comms.manage') or public.banking_can('quotes.manage')));
  -- no update or delete policy: stored versions are never replaced or removed from the app
end $do$;
