-- Undoes migrations/011_document_signing.sql. Run first, before 010_rollback.sql.
-- The AB Capital approvers and image path go back into accounting_proposal_defaults, and hub_acct_can_approve reads them there again (as in 008).
-- An image path outside accounting-signature/ is not put back: 008 protects only that folder.
-- Every signing record and every change stamp is lost, and images under signatures/ lose their protection. So this refuses while any
-- signature or image under signatures/ exists, unless
--   set doc_sign.rollback_force = 'yes'
do $$
declare v_sigs boolean := false; v_imgs boolean := false;
begin
  if to_regclass('public.document_signatures') is not null then execute 'select exists (select 1 from public.document_signatures)' into v_sigs; end if;
  if to_regclass('storage.objects') is not null then
    execute $q$select exists (select 1 from storage.objects where bucket_id = 'hub-documents' and name like 'signatures/%')$q$ into v_imgs;
  end if;
  if coalesce(current_setting('doc_sign.rollback_force', true), '') <> 'yes' and (v_sigs or v_imgs) then
    raise exception 'Signatures or signature images exist. Move the images out of signatures/ first, or set doc_sign.rollback_force to yes';
  end if;
end $$;

drop trigger if exists doc_sign_settings_sync on public.hub_settings;

-- The AB Capital approvers and image back into Accounting's setting.
update public.hub_settings a set value = a.value || jsonb_build_object(
    'approvers', coalesce(c -> 'approvers', '[]'::jsonb),
    'signature_path', case when left(coalesce(c ->> 'signature_path', ''), 21) = 'accounting-signature/' then c -> 'signature_path' end,
    'signature_uploaded_at', case when left(coalesce(c ->> 'signature_path', ''), 21) = 'accounting-signature/' then c -> 'uploaded_at' end,
    'signature_uploaded_by', case when left(coalesce(c ->> 'signature_path', ''), 21) = 'accounting-signature/' then c -> 'uploaded_by' end)
  from (select value #> '{companies,ab_capital}' as c from public.hub_settings where key = 'document_signing') s
 where a.key = 'accounting_proposal_defaults' and s.c is not null;

-- hub_acct_can_approve as in 008.
create or replace function public.hub_acct_can_approve() returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid[] := hub_acct_approvers(); u uuid := auth.uid();
begin
  if u is null then return false; end if;
  if cardinality(v) > 0 then return u = any(v); end if;
  return admin_is();
end $$;

do $do$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists doc_sign_image_read on storage.objects;
    drop policy if exists doc_sign_image_insert on storage.objects;
    drop policy if exists doc_sign_image_update on storage.objects;
    drop policy if exists doc_sign_image_delete on storage.objects;
    drop policy if exists doc_sign_image_admin_update on storage.objects;
    drop policy if exists doc_sign_image_admin_delete on storage.objects;
  end if;
end $do$;

drop trigger if exists doc_sign_content on public.hub_documents;
drop trigger if exists doc_sign_content on public.ardentax_documents;
drop trigger if exists doc_sign_content on public.banking_quotations;
drop trigger if exists doc_sign_content on public.banking_engagement_letters;
drop trigger if exists doc_sign_content on public.banking_receipts;

drop function if exists public.doc_sign_record(jsonb);
drop function if exists public.doc_sign_live(text, uuid);
drop function if exists public.doc_sign_supersede(text, uuid, text);
drop function if exists public.doc_sign_admin_save(jsonb);
drop function if exists public.doc_changed_at(text, uuid);
drop function if exists public.doc_sign_can(text);
drop function if exists public.doc_sign_settings_sync();
drop function if exists public.doc_sign_content_changed();
drop function if exists public.doc_sign_withdraw(text, uuid, text);
drop function if exists public.doc_sign_unsigned(text, uuid);
drop function if exists public.doc_sign_prefix(text, uuid);
drop function if exists public.doc_sign_stamp(text, uuid);
drop function if exists public.doc_sign_readable(text, uuid);
drop function if exists public.doc_company(text, uuid);
drop table if exists public.document_signatures;

alter table public.hub_documents drop column if exists content_changed_at;
alter table public.ardentax_documents drop column if exists content_changed_at;
alter table public.banking_quotations drop column if exists content_changed_at;
alter table public.banking_engagement_letters drop column if exists content_changed_at;
alter table public.banking_receipts drop column if exists content_changed_at;

delete from public.hub_settings where key = 'document_signing';
