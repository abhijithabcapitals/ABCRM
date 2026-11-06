-- =====================================================================
-- Template Hub Base - Business Banking signing rules                  013
-- =====================================================================
-- 011 ends a live signature when a content column of the document row changes. Two Business Banking changes do not touch that row,
-- so this adds the rules in the database (the screen's doc_sign_supersede call stays as a second line, not the only one):
--   banking_generated_documents  a new generated file filed for a quotation (quotation_id), a letter (letter_id) or a receipt
--                                (payment_id, through banking_receipts.payment_id) ends that document's live signature: 'Generated again'.
--                                The file itself already moves the change stamp (011 doc_sign_stamp).
--   banking_quotation_items      an added, changed or removed line item moves its quotation's content_changed_at (so a signer holding
--                                the old stamp is refused) and ends its live signature: 'Document changed'.
-- Both call doc_sign_withdraw (011), the same internal step 011's own content trigger uses, not doc_sign_supersede: supersede checks
-- the caller (signed in, approver or changed stamp), and a trigger also runs for the service role and for staff who are not approvers.
-- Signing is optional: these rules never block filing or editing. Any error inside them is caught and raised as a WARNING only, and
-- the insert, update or delete goes on.
-- Banking Base migrations are not changed. Nothing in this file holds a name of a person, a price or a client.
-- Run after 011 (and Banking Base). Re-runnable. Undo with rollback/013_rollback.sql. Live migration name: template_hub_013_banking_signing.
-- =====================================================================

-- ── A new generated file ends the signature ──────────────────────────
create or replace function public.doc_sign_banking_filed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r uuid;
begin
  begin
    if new.kind = 'quote' and new.quotation_id is not null then
      perform doc_sign_withdraw('banking_quotations', new.quotation_id, 'Generated again');
    elsif new.kind = 'letter' and new.letter_id is not null then
      perform doc_sign_withdraw('banking_engagement_letters', new.letter_id, 'Generated again');
    elsif new.kind = 'receipt' and new.payment_id is not null then
      for r in select id from banking_receipts where payment_id = new.payment_id loop
        perform doc_sign_withdraw('banking_receipts', r, 'Generated again');
      end loop;
    end if;
  exception when others then
    raise warning 'Signature not withdrawn for generated file % (the file is kept): %', new.id, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.doc_sign_banking_filed() from public, anon, authenticated;
drop trigger if exists doc_sign_banking_filed on public.banking_generated_documents;
create trigger doc_sign_banking_filed after insert on public.banking_generated_documents
  for each row execute function public.doc_sign_banking_filed();

-- ── A line item change is a quotation content change ─────────────────
-- banking_quote_save deletes and re-inserts every line, one statement per line; the stamp moves once per transaction (now() is the
-- transaction's start), so the quotation row is updated only once.
create or replace function public.doc_sign_banking_items() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare q uuid := case when tg_op = 'DELETE' then old.quotation_id else new.quotation_id end;
begin
  begin
    if tg_op = 'UPDATE' and old.quotation_id is distinct from new.quotation_id then
      update banking_quotations set content_changed_at = now() where id = old.quotation_id and content_changed_at is distinct from now();
      perform doc_sign_withdraw('banking_quotations', old.quotation_id, 'Document changed');
    end if;
    -- Who and when columns (Banking's updated_at / updated_by stamps) are not content.
    if tg_op <> 'UPDATE' or (to_jsonb(old) - array['created_at', 'created_by', 'updated_at', 'updated_by'])
                            is distinct from (to_jsonb(new) - array['created_at', 'created_by', 'updated_at', 'updated_by']) then
      update banking_quotations set content_changed_at = now() where id = q and content_changed_at is distinct from now();
      perform doc_sign_withdraw('banking_quotations', q, 'Document changed');
    end if;
  exception when others then
    raise warning 'Signature not withdrawn for quotation % after a line item change: %', q, sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.doc_sign_banking_items() from public, anon, authenticated;
drop trigger if exists doc_sign_banking_items on public.banking_quotation_items;
create trigger doc_sign_banking_items after insert or update or delete on public.banking_quotation_items
  for each row execute function public.doc_sign_banking_items();
