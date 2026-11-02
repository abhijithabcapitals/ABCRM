-- Releases old CRM rows held only because their bank was not in the bank list, after that bank is added.
-- Replace the admin id and import id, and set the bank code. Rows with any other hold stay held.
-- Run once per bank. Re-running does no harm: released rows are no longer held.
begin;
select set_config('request.jwt.claim.sub', '<admin id>', true);
update public.banking_excel_import_rows r set
  decision = 'Pending', error = null,
  mapped = r.mapped || jsonb_build_object('bank_resolved', public.banking_legacy_bank(r.mapped ->> 'bank_raw')),
  duplicate_key = public.banking_legacy_key(r.mapped ->> 'company') || '|' || public.banking_legacy_bank(r.mapped ->> 'bank_raw') || '|' || coalesce(left(r.mapped ->> 'lead_date', 7), '')
 where r.import_id = '<import id>' and r.decision = 'Skipped' and r.reconcile_result = 'Conflict'
   and public.banking_legacy_bank(r.mapped ->> 'bank_raw') = '<bank code>'
   and jsonb_array_length(r.conflicts) = 1 and r.conflicts @> '[{"field":"bank"}]';
select public.banking_legacy_reconcile('<import id>');
select public.banking_legacy_apply('<import id>');
commit;
