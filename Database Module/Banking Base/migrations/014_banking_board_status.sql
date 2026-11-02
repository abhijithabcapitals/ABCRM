-- =====================================================================
-- Banking Base - old CRM board status as the target                014
-- =====================================================================
-- The old CRM dashboard counts Banking Sheet tasks by board status, which often disagrees with their
-- "Current Status" field. The user set the dashboard as the target on 02/11/2026, so board status now decides:
--   Rejected    -> Rejected
--   Done        -> Approved, unless Current Status says rejected, declined or refunded
--   In Progress -> Document Collection
--   Pending     -> no matching status: an existing case keeps its status, a new one is Document Collection
-- The board status itself is kept on the case, so counts can be compared with the dashboard exactly.
-- A case someone has worked on since the import is left alone. Idempotent: safe to re-run.
-- =====================================================================
alter table public.banking_cases add column if not exists legacy_board_status text;
create index if not exists banking_cases_board_idx on public.banking_cases (legacy_board_status) where legacy_board_status is not null;

create or replace function public.banking_legacy_board_target(p_board text, p_current text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case p_board
    when 'Rejected' then 'Rejected'
    when 'In Progress' then 'Document Collection'
    when 'Done' then case when upper(coalesce(p_current, '')) ~ 'REJECT|DECLINED|REFUND' then 'Rejected' else 'Approved' end
  end
$$;

create or replace function public.banking_legacy_sync_board(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rw banking_excel_import_rows; a banking_applications; v_commit jsonb; v_board text; v_target text; v_old int; v_stage int;
  n_released int; n_changed int := 0; n_skipped int := 0;
begin
  perform banking_require('imports.manage');
  perform set_config('banking.internal', '1', true);

  -- Board status settles rows that had no status or whose two folders disagreed. The Banking Sheet's fee is
  -- kept, as that is the sheet the dashboard counts. Unknown banks and possible repeats stay held.
  update banking_excel_import_rows r set
    decision = 'Pending', error = null, mapped = r.mapped - 'hold_reason',
    suggested_status = coalesce(banking_legacy_board_target(r.raw -> 'Banking Sheet' ->> 'Task Status', r.raw -> 'Banking Sheet' ->> 'Current Status'), r.suggested_status, 'Document Collection')
   where r.import_id = p_import and r.raw ? 'Banking Sheet' and r.decision in ('Pending', 'Skipped')
     and (r.reconcile_result = 'No Status'
          or (r.reconcile_result = 'Conflict' and r.mapped ? 'hold_reason' and r.error not like 'Changed in the CRM%'
              and not exists (select 1 from jsonb_array_elements(r.conflicts) e where e ->> 'field' not in ('review', 'status', 'fee', 'rm_fee'))));
  get diagnostics n_released = row_count;
  perform banking_legacy_reconcile(p_import);
  v_commit := banking_legacy_apply(p_import);
  perform set_config('banking.internal', '1', true);

  for rw in select * from banking_excel_import_rows where import_id = p_import and decision = 'Committed' and application_id is not null and raw ? 'Banking Sheet' loop
    v_board := rw.raw -> 'Banking Sheet' ->> 'Task Status';
    update banking_cases set legacy_board_status = v_board where id = rw.case_id and legacy_board_status is distinct from v_board;
    v_target := banking_legacy_board_target(v_board, rw.raw -> 'Banking Sheet' ->> 'Current Status');
    select * into a from banking_applications where id = rw.application_id for update;
    if v_target is null or a.status = v_target then continue; end if;
    if exists (select 1 from banking_application_status_history h where h.application_id = a.id and h.remarks not like 'Imported%' and h.remarks not like 'Old CRM%')
       or not (select is_historical from banking_cases where id = rw.case_id) then
      n_skipped := n_skipped + 1;
      continue;
    end if;
    update banking_applications set status = v_target, status_date = now(), is_active = v_target <> 'Rejected' where id = a.id;
    insert into banking_application_status_history (application_id, previous_status, new_status, remarks)
    values (a.id, a.status, v_target, 'Old CRM board status: ' || v_board);
    v_stage := case when v_target in ('Approved', 'Rejected') then 17 else 8 end;
    select current_stage into v_old from banking_cases where id = rw.case_id;
    update banking_cases set current_stage = v_stage, outcome = case v_target when 'Approved' then 'Approved' when 'Rejected' then 'Rejected' end where id = rw.case_id;
    if v_old is distinct from v_stage then
      insert into banking_case_stage_history (case_id, from_stage, to_stage, remarks) values (rw.case_id, v_old, v_stage, 'Old CRM board status: ' || v_board);
    end if;
    n_changed := n_changed + 1;
  end loop;
  perform set_config('banking.internal', '', true);
  return jsonb_build_object('released', n_released, 'apply', v_commit, 'status_changed', n_changed, 'left_alone', n_skipped);
end $$;
revoke all on function public.banking_legacy_sync_board(uuid) from public, anon, authenticated;
