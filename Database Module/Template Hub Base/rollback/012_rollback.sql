-- Undoes migrations/012_accounting_signing.sql. Run first, before 011_rollback.sql.
-- Accounting goes back to the 008 rules: an agreement is sent only once approved, an edit clears the approval, the client's signed copy of
-- an agreement needs the approval, approved files stay put, and hub_acct_approve is callable again. The 008 image policies come back.
-- Signing records (011) are kept: this does not touch document_signatures. Agreements sent unsigned under 012 stay sent; until
-- they are approved, they cannot be sent again.
-- The function bodies below are copied from 008 unchanged.

-- Editing clears the approval and keeps the files it replaces in field_values.file_history.
create or replace function public.hub_acct_agreement_update(p_id uuid, p_agreement jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents; a jsonb; v_hist jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into d from hub_documents where id = p_id and library_template = 'AB Capital/Accounting Agreement' for update;
  if d.id is null then raise exception 'The Accounting agreement was not found'; end if;
  if d.signed_at is not null then raise exception 'Agreement % is signed and cannot be edited', d.document_number; end if;
  a := hub_acct_agreement_clean(p_agreement, (d.field_values #>> '{agreement,accepted_option}')::int);
  v_hist := coalesce(d.field_values -> 'file_history', '[]'::jsonb);
  if d.storage_path is not null or d.word_path is not null then
    v_hist := v_hist || jsonb_build_array(jsonb_build_object('storage_path', d.storage_path, 'word_path', d.word_path,
      'approved_by', d.approved_by, 'approved_at', d.approved_at, 'archived_at', now(), 'archived_by', auth.uid(), 'reason', 'edited'));
  end if;
  update hub_documents set field_values = jsonb_set(jsonb_set(coalesce(field_values, '{}'::jsonb), '{agreement}', a), '{file_history}', v_hist),
         client_address = (select string_agg(x, E'\n') from jsonb_array_elements_text(a -> 'address') x),
         storage_path = null, word_path = null, approved_by = null, approved_at = null, agreement_changed_at = now()
   where id = d.id returning * into r;
  return r;
end $$;


create or replace function public.hub_acct_attach(p_id uuid, p_pdf text, p_word text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into d from hub_documents where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') for update;
  if d.id is null then raise exception 'The Accounting document was not found'; end if;
  if d.approved_at is not null then raise exception 'Approved files cannot be replaced. Edit the agreement first'; end if;
  update hub_documents set storage_path = nullif(btrim(coalesce(p_pdf, '')), ''), word_path = nullif(btrim(coalesce(p_word, '')), '') where id = d.id returning * into r;
  return r;
end $$;

create or replace function public.hub_acct_signed(p_id uuid, p_date date, p_path text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_date is null then raise exception 'Enter the date it was signed'; end if;
  if nullif(btrim(coalesce(p_path, '')), '') is null then raise exception 'Upload the signed copy'; end if;
  select * into d from hub_documents where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') for update;
  if d.id is null then raise exception 'The Accounting document was not found'; end if;
  if d.library_template = 'AB Capital/Accounting Agreement' and d.approved_at is null then
    raise exception 'Agreement % is not approved, so no signed copy can be recorded', d.document_number;
  end if;
  update hub_documents set signed_at = p_date, signed_path = btrim(p_path) where id = d.id returning * into r;
  return r;
end $$;

-- A quote can go once it has a PDF. An agreement needs the PDF and its approval.
create or replace function public.hub_acct_can_send(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select d.storage_path is not null and (d.library_template = 'AB Capital/Accounting Quote' or d.approved_at is not null)
                     from hub_documents d where d.id = p_id and d.library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement')), false)
$$;

-- ── Approved files stay put ──────────────────────────────────────────────
-- hub_document_attach (Template Hub 001) lets a creator set storage_path on their own row. Once an Accounting document is approved its PDF and
-- Word paths change only in the statement that clears the approval (an edit) or inside hub_acct_approve.
create or replace function public.hub_acct_file_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.library_template is null or old.library_template not in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') then return new; end if;
  if old.approved_at is null or new.approved_at is null then return new; end if;
  if new.storage_path is not distinct from old.storage_path and new.word_path is not distinct from old.word_path then return new; end if;
  if coalesce(current_setting('hub_acct.approving', true), '') = 'on' then return new; end if;
  raise exception 'Approved files cannot be replaced. Edit the agreement first';
end $$;
revoke all on function public.hub_acct_file_guard() from public, anon, authenticated;
drop trigger if exists hub_acct_file_guard on public.hub_documents;
create trigger hub_acct_file_guard before update of storage_path, word_path on public.hub_documents for each row execute function public.hub_acct_file_guard();

drop function if exists public.hub_acct_approval_current(timestamptz, timestamptz);

revoke all on function public.hub_acct_approve(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.hub_acct_approve(uuid, text, text, timestamptz) to authenticated;

-- ── The signature image ──────────────────────────────────────────────────
-- hub_docs_read lets any signed-in user read the whole hub-documents bucket. These restrictive policies keep the signature to approvers and
-- let only a CRM administrator add it. storage.objects is owned by supabase_storage_admin on live, so the release checks the policies exist.
do $do$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  drop policy if exists hub_docs_accounting_signature_read on storage.objects;
  create policy hub_docs_accounting_signature_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.hub_acct_can_approve());
  drop policy if exists hub_docs_accounting_signature_insert on storage.objects;
  create policy hub_docs_accounting_signature_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
  -- Without these a permissive policy could move a file into the prefix or delete the image.
  drop policy if exists hub_docs_accounting_signature_update on storage.objects;
  create policy hub_docs_accounting_signature_update on storage.objects as restrictive for update to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is())
    with check (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
  drop policy if exists hub_docs_accounting_signature_delete on storage.objects;
  create policy hub_docs_accounting_signature_delete on storage.objects as restrictive for delete to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'accounting-signature/%' or public.admin_is());
end $do$;
