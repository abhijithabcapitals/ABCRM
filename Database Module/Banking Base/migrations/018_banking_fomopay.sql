-- =====================================================================
-- Banking Base - FOMOPAY in the bank master                        018
-- =====================================================================
-- Added at the user's request on 02/11/2026: an old CRM deal is held because its bank was not in the list.
-- banking_legacy_release_bank releases one such row once its bank exists. A deal still Pending on the old
-- board goes to In Pipeline, as in 017. Nothing already edited in the CRM is overwritten. Safe to re-run.
-- =====================================================================
insert into public.banking_partners (bank_code, bank_name, aliases, internal_remarks)
values ('FOMOPAY', 'FOMOPAY', array['FOMOPAY'], 'Added from the old CRM import. Requirements not recorded.')
on conflict (bank_code) do nothing;

create or replace function public.banking_legacy_release_bank(p_task text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare rw banking_excel_import_rows; v_bank text; v_board text;
begin
  perform banking_require('imports.manage');
  select * into rw from banking_excel_import_rows where legacy_task_id = p_task for update;
  if rw.id is null then raise exception 'Old CRM row not found'; end if;
  if rw.decision <> 'Skipped' or rw.case_id is not null or not rw.conflicts @> '[{"field":"bank"}]' then raise exception 'This row is not held for its bank'; end if;
  v_bank := banking_legacy_bank(rw.mapped ->> 'bank_raw');
  if v_bank is null then raise exception 'Bank % is still not in the bank list', rw.mapped ->> 'bank_raw'; end if;
  update banking_excel_import_rows set decision = 'Pending', error = null, mapped = mapped || jsonb_build_object('bank_resolved', v_bank) where id = rw.id;
  perform banking_legacy_reconcile(rw.import_id);
  perform banking_legacy_apply(rw.import_id);
  select * into rw from banking_excel_import_rows where id = rw.id;
  v_board := rw.raw -> 'Banking Sheet' ->> 'Task Status';
  if rw.case_id is not null then
    perform set_config('banking.internal', '1', true);
    update banking_cases set legacy_board_status = v_board where id = rw.case_id;
    if v_board = 'Pending' then
      insert into banking_lead_pipeline_017_backup (lead_id, status, converted_at, picked_up_by, picked_up_at, updated_at, updated_by)
      select l.id, l.status, l.converted_at, l.picked_up_by, l.picked_up_at, l.updated_at, l.updated_by from banking_leads l where l.id = rw.lead_id and l.status = 'Converted'
      on conflict (lead_id) do nothing;
      update banking_leads set status = 'Potential Client', converted_at = null, picked_up_at = coalesce(picked_up_at, now()) where id = rw.lead_id and status = 'Converted';
    end if;
    perform set_config('banking.internal', '', true);
  end if;
  return jsonb_build_object('decision', rw.decision, 'result', rw.reconcile_result, 'case_id', rw.case_id, 'lead_id', rw.lead_id);
end $$;
revoke all on function public.banking_legacy_release_bank(text) from public, anon, authenticated;
