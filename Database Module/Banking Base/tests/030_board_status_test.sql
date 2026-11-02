-- LOCAL TEST ONLY: board status sync (014). Runs after 020_legacy_crm_test.sql on the same throwaway cluster.
\set QUIET on
\pset tuples_only on
\pset format unaligned
reset role;
truncate public.t_result;
select public.as_user('0a');

insert into public.banking_excel_imports (file_name, sheets) values ('Board draft.xlsx', '{Monthly}');
select public.keep('bimp', (select id from public.banking_excel_imports where file_name = 'Board draft.xlsx'));
insert into public.banking_excel_import_rows (import_id, source_sheet, source_row, raw, mapped, suggested_status, confidence, duplicate_key, payment_review, decision)
select public.id('bimp'), 'Monthly', n, '{}', jsonb_build_object('company', c, 'bank_raw', 'ADCB', 'bank_resolved', 'ADCB', 'fee', 1000, 'status_raw', 'WIP', 'lead_date', '2024-01-01'),
       'Document Collection', 'High', public.banking_legacy_key(c) || '|ADCB|2024-01', 'Not Needed', 'Approved'
  from (values (1, 'Board Rejected Co'), (2, 'Board Done Co'), (3, 'Board Done Rej Co'), (4, 'Board Pending Co'), (5, 'Board Touched Co')) v(n, c);
select public.banking_import_commit(public.id('bimp'), 100) is not null;
select public.banking_application_set_status((select application_id from public.banking_excel_import_rows where import_id = public.id('bimp') and source_row = 5), 'On Hold', 'Worked on in the CRM') is null;

create function public.board_row(t text, c text, bank text, board text, cur text, st text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('task_id', t, 'status', st, 'payment_note', null, 'issues', '[]'::jsonb,
    'raw', jsonb_build_object('Banking Sheet', jsonb_build_object('Task Status', board, 'Current Status', cur)),
    'mapped', jsonb_build_object('company', c, 'bank_raw', bank, 'fee', 1000, 'status_raw', cur, 'lead_date', '2024-01-01', 'signing_date', '2024-01-01') || extra)
$$;
select public.keep('bstage', (public.banking_legacy_stage('Old.csv', 'sha2', jsonb_build_array(
  public.board_row('b1', 'Board Rejected Co', 'ADCB', 'Rejected', 'WIP', 'Document Collection'),
  public.board_row('b2', 'Board Done Co', 'ADCB', 'Done', 'WIP', 'Document Collection'),
  public.board_row('b3', 'Board Done Rej Co', 'ADCB', 'Done', 'REJECTED', 'Rejected'),
  public.board_row('b4', 'Board Pending Co', 'ADCB', 'Pending', 'WIP', 'Document Collection'),
  public.board_row('b5', 'Board Touched Co', 'ADCB', 'Rejected', 'WIP', 'Document Collection'),
  public.board_row('b6', 'Board Blank Co', 'FAB', 'Done', null, null),
  public.board_row('b7', 'Board Fee Co', 'FAB', 'In Progress', 'WIP', 'Document Collection', '{"hold_reason":"Fee differs between folders: Banking Sheet 1000, Monthly 900"}'),
  public.board_row('b8', 'Board Stripe Co', 'STRIPE', 'Done', 'Approved', 'Approved'),
  public.board_row('b9', 'Board Pending New Co', 'FAB', 'Pending', null, null)
)) ->> 'import_id'));
select public.banking_legacy_apply(public.id('bstage')) is not null;
create function public.lr2(t text) returns public.banking_excel_import_rows language sql as $$ select * from public.banking_excel_import_rows where legacy_task_id = t $$;
create function public.app_status(t text) returns text language sql as $$ select status from public.banking_applications where id = (public.lr2(t)).application_id $$;

select public.as_user('0c');
select public.must_fail('sales cannot sync board status', $$select public.banking_legacy_sync_board(public.id('bstage'))$$, 'permission');
select public.as_user('0a');
select public.ok('before sync, Rejected board still shows WIP', public.app_status('b1') = 'Document Collection');
select public.banking_legacy_sync_board(public.id('bstage')) is not null;

select public.ok('board Rejected becomes Rejected', public.app_status('b1') = 'Rejected' and (select not is_active from public.banking_applications where id = (public.lr2('b1')).application_id));
select public.ok('case follows the board', (select outcome = 'Rejected' and current_stage = 17 and legacy_board_status = 'Rejected' from public.banking_cases where id = (public.lr2('b1')).case_id));
select public.ok('change is in the history', (select count(*) from public.banking_application_status_history where application_id = (public.lr2('b1')).application_id and remarks = 'Old CRM board status: Rejected') = 1);
select public.ok('board Done becomes Approved', public.app_status('b2') = 'Approved');
select public.ok('Done with a rejected current status stays Rejected', public.app_status('b3') = 'Rejected' and (select legacy_board_status from public.banking_cases where id = (public.lr2('b3')).case_id) = 'Done');
select public.ok('board Pending keeps its status and records the board', public.app_status('b4') = 'Document Collection' and (select legacy_board_status from public.banking_cases where id = (public.lr2('b4')).case_id) = 'Pending');
select public.ok('case worked on since the import is left alone', (public.lr2('b5')).decision = 'Skipped' or public.app_status('b5') = 'On Hold');
select public.ok('no status row gets a case from the board', (public.lr2('b6')).decision = 'Committed' and public.app_status('b6') = 'Approved');
select public.ok('folder fee hold released with the Banking Sheet fee', (public.lr2('b7')).decision = 'Committed' and public.app_status('b7') = 'Document Collection' and not (public.lr2('b7')).mapped ? 'hold_reason');
select public.ok('unknown bank stays held', (public.lr2('b8')).decision = 'Skipped' and (public.lr2('b8')).case_id is null);
select public.ok('Pending with no status becomes Document Collection', public.app_status('b9') = 'Document Collection');

select public.keep('hist_before', (select count(*) from public.banking_application_status_history));
select public.keep('cases_before2', (select count(*) from public.banking_cases));
select public.banking_legacy_sync_board(public.id('bstage')) is not null;
select public.ok('syncing again changes nothing', (select count(*) from public.banking_application_status_history) = (select v::int from public.t_ids where k = 'hist_before') and (select count(*) from public.banking_cases) = (select v::int from public.t_ids where k = 'cases_before2'));

select public.as_user('0a');
select public.keep('list', (select count(*) from jsonb_array_elements(public.banking_case_list(null, 1000, 0, true) -> 'rows') e where e ->> 'legacy_board_status' = 'Rejected'));
select public.ok('case list carries the board status', (select v::int from public.t_ids where k = 'list') >= 1);
select public.ok('board counts ignore the search', (public.banking_case_list('no such client', 10, 0, true) -> 'board_counts' ->> 'Rejected')::int = (select count(*) from public.banking_cases where legacy_board_status = 'Rejected'));
select public.ok('rows without a case are counted by board status', (public.banking_case_list(null, 1, 0, true) -> 'board_held' ->> 'Done')::int >= 1);
select public.as_user('99');
select public.ok('no permission, no counts', public.banking_case_list(null, 10, 0, true) -> 'board_counts' = '{}'::jsonb and public.banking_case_list(null, 10, 0, true) -> 'board_held' = '{}'::jsonb);
select public.as_user('0a');

\echo === 014 FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === 014 SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
