-- =====================================================================
-- Template Hub Base - Accounting on the shared signing                012
-- =====================================================================
-- Signing is optional: an unsigned Accounting quote or agreement can be sent, and nothing requires approval any more.
-- Approve becomes Sign through the shared step (011: doc_sign_record), on quotes and agreements, for AB Capital approvers only.
--   hub_acct_can_send       a PDF is enough; no approval.
--   hub_acct_agreement_update, hub_acct_attach
--                           end the live signature (doc_sign_supersede). They no longer write approved_by / approved_at:
--                           those columns stay as history of approvals made before this migration.
--   hub_acct_signed         the client's signed copy no longer needs an approval.
--   hub_acct_approve        kept for history; no signed-in user may call it.
--   hub_acct_file_guard     narrowed to what it still protects: the approved files of agreements approved before this
--                           migration. They change only through an edit (and the rebuild after it). New documents never get
--                           approved_at, so for them it is inert: their signed files live in document_signatures under
--                           Accounting/<id>/signed/, and a change of the row's unsigned files ends the signature (011 trigger).
--   accounting-signature/   the 008 hub_docs_accounting_signature_* policies are dropped. The 011 doc_sign_image_* policies cover
--                           that folder for ab_capital and also let CRM administrators read, replace and delete the image.
--                           The image and its path stay where they are.
-- Run after 011. Re-runnable. Undo with rollback/012_rollback.sql. Live migration name: template_hub_012_accounting_signing.
-- =====================================================================

-- An approval made before 012 still holds when nothing changed after it (hub_acct_approve required the approver to read the latest
-- agreement_changed_at, and an edit moves it past approved_at).
create or replace function public.hub_acct_approval_current(p_approved timestamptz, p_changed timestamptz) returns boolean
language sql immutable set search_path = public, pg_temp as $$
  select p_approved is not null and (p_changed is null or p_approved >= p_changed)
$$;
revoke all on function public.hub_acct_approval_current(timestamptz, timestamptz) from public, anon, authenticated;

-- ── Send ─────────────────────────────────────────────────────────────
-- A quote or an agreement can go once it has a PDF. Signed or not is the sender's choice (accounting-proposal-mail-send, signed flag).
create or replace function public.hub_acct_can_send(p_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select d.storage_path is not null
                     from hub_documents d where d.id = p_id and d.library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement')), false)
$$;

-- ── Edit ─────────────────────────────────────────────────────────────
-- Keeps the files it replaces in field_values.file_history and ends the live signature. approved_by / approved_at are left as they are.
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
  -- hub_acct_file_guard lets this statement through; the flag lasts only for this step.
  perform set_config('hub_acct.files', 'on', true);
  update hub_documents set field_values = jsonb_set(jsonb_set(coalesce(field_values, '{}'::jsonb), '{agreement}', a), '{file_history}', v_hist),
         client_address = (select string_agg(x, E'\n') from jsonb_array_elements_text(a -> 'address') x),
         storage_path = null, word_path = null, agreement_changed_at = now()
   where id = d.id returning * into r;
  perform set_config('hub_acct.files', 'off', true);
  -- The content trigger (011) has already ended a live signature, since agreement_changed_at moved; this states it for this path.
  perform doc_sign_supersede('hub_documents', d.id, 'Agreement edited');
  return r;
end $$;

-- ── Files ────────────────────────────────────────────────────────────
-- Records the unsigned PDF and Word files. New files end the live signature. The approved files of an agreement approved before 012
-- are not replaced: edit it first.
create or replace function public.hub_acct_attach(p_id uuid, p_pdf text, p_word text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into d from hub_documents where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') for update;
  if d.id is null then raise exception 'The Accounting document was not found'; end if;
  if d.storage_path is not null and hub_acct_approval_current(d.approved_at, d.agreement_changed_at) then
    raise exception 'Approved files cannot be replaced. Edit the agreement first';
  end if;
  perform set_config('hub_acct.files', 'on', true);
  update hub_documents set storage_path = nullif(btrim(coalesce(p_pdf, '')), ''), word_path = nullif(btrim(coalesce(p_word, '')), '') where id = d.id returning * into r;
  perform set_config('hub_acct.files', 'off', true);
  if r.storage_path is distinct from d.storage_path or r.word_path is distinct from d.word_path then
    perform doc_sign_supersede('hub_documents', d.id, 'Files rebuilt');
  end if;
  return r;
end $$;

-- ── The client's signed copy ─────────────────────────────────────────
-- Signing by AB Capital is optional, so the client's copy can be recorded on any agreement or quote with the date it was signed.
-- The caller must be able to read the row (011: doc_sign_readable, the rule of the Accounting screens). The copy must sit where the
-- screen uploads it (accountingApi.recordSigned): one file name directly under the document's own Accounting/<id>/ folder. So it is
-- never another document's folder, never Accounting/<id>/signed/ (AB Capital's signed copies, 011), and has no '..' or empty part.
create or replace function public.hub_acct_signed(p_id uuid, p_date date, p_path text) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare d hub_documents; r hub_documents; v_path text := btrim(coalesce(p_path, '')); v_name text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_date is null then raise exception 'Enter the date it was signed'; end if;
  if v_path = '' then raise exception 'Upload the signed copy'; end if;
  select * into d from hub_documents where id = p_id and library_template in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') for update;
  if d.id is null or not doc_sign_readable('hub_documents', d.id) then raise exception 'The Accounting document was not found'; end if;
  v_name := substr(v_path, length('Accounting/' || d.id::text || '/') + 1);
  if left(v_path, length('Accounting/' || d.id::text || '/')) <> 'Accounting/' || d.id::text || '/'
     or v_name = '' or v_name in ('.', '..') or position('/' in v_name) > 0 or position(chr(92) in v_name) > 0 then
    raise exception 'The signed copy must be stored under Accounting/%/', d.id;
  end if;
  update hub_documents set signed_at = p_date, signed_path = v_path where id = d.id returning * into r;
  return r;
end $$;

-- ── Approved files of agreements approved before 012 stay put ────────
-- hub_document_attach (Template Hub 001) lets a creator set storage_path on their own row. While an approval made before 012 still holds,
-- the PDF and Word paths change only inside hub_acct_agreement_update or hub_acct_attach (which itself refuses until an edit), or inside
-- the retired hub_acct_approve. Everything else is let through: a change of files on a signed document ends its signature (011).
create or replace function public.hub_acct_file_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.library_template is null or old.library_template not in ('AB Capital/Accounting Quote', 'AB Capital/Accounting Agreement') then return new; end if;
  if not hub_acct_approval_current(old.approved_at, old.agreement_changed_at) then return new; end if;
  if new.storage_path is not distinct from old.storage_path and new.word_path is not distinct from old.word_path then return new; end if;
  if coalesce(current_setting('hub_acct.files', true), '') = 'on' or coalesce(current_setting('hub_acct.approving', true), '') = 'on' then return new; end if;
  raise exception 'Approved files cannot be replaced. Edit the agreement first';
end $$;
revoke all on function public.hub_acct_file_guard() from public, anon, authenticated;
drop trigger if exists hub_acct_file_guard on public.hub_documents;
create trigger hub_acct_file_guard before update of storage_path, word_path on public.hub_documents for each row execute function public.hub_acct_file_guard();

-- ── Grants ───────────────────────────────────────────────────────────
revoke all on function public.hub_acct_approve(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.hub_acct_can_send(uuid), public.hub_acct_agreement_update(uuid, jsonb), public.hub_acct_attach(uuid, text, text),
  public.hub_acct_signed(uuid, date, text) from public, anon;
grant execute on function public.hub_acct_can_send(uuid), public.hub_acct_agreement_update(uuid, jsonb), public.hub_acct_attach(uuid, text, text),
  public.hub_acct_signed(uuid, date, text) to authenticated;

-- ── Accounting's image: the 011 policies only ────────────────────────
-- storage.objects is owned by supabase_storage_admin on live, so the release checks these are gone and the doc_sign_image_* ones exist.
do $do$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists hub_docs_accounting_signature_read on storage.objects;
  drop policy if exists hub_docs_accounting_signature_insert on storage.objects;
  drop policy if exists hub_docs_accounting_signature_update on storage.objects;
  drop policy if exists hub_docs_accounting_signature_delete on storage.objects;
end $do$;
