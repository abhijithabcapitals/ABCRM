-- LOCAL TEST ONLY: import from the old CRM (012). Runs after 010_workflow_test.sql on the same throwaway cluster.
\set QUIET on
\pset tuples_only on
\pset format unaligned
reset role;
truncate public.t_result;

select public.as_user('0a');
insert into public.banking_excel_imports (file_name, sheets) values ('Draft workbook.xlsx', '{Monthly}');
select public.keep('dimp', (select id from public.banking_excel_imports where file_name = 'Draft workbook.xlsx'));
insert into public.banking_excel_import_rows (import_id, source_sheet, source_row, raw, mapped, suggested_status, confidence, duplicate_key, payment_note, payment_review, decision) values
  (public.id('dimp'), 'Monthly', 1, '{}', '{"company":"Same Co LLC","bank_raw":"RAK","bank_resolved":"RAKBANK","fee":3000,"rm_fee":500,"status_raw":"Approved","rm":"Hasan","date":"2023-02-01","lead_date":"2023-02-01"}', 'Approved', 'High', 'SAMECO|RAKBANK|2023-02', null, 'Not Needed', 'Approved'),
  (public.id('dimp'), 'Monthly', 2, '{}', '{"company":"Waiting Co LLC","bank_raw":"ADCB","bank_resolved":"ADCB","fee":2000,"status_raw":"Approved","rm":"Bilal","lead_date":"2023-03-01","mobile":"0500000000"}', 'Approved', 'Medium', 'WAITINGCO|ADCB|2023-03', '1000 BT 01/03', 'Pending', 'Pending'),
  (public.id('dimp'), 'Monthly', 3, '{}', '{"company":"Differ Co FZE","bank_raw":"WIO","bank_resolved":"WIO","fee":2500,"status_raw":"Approved","rm":"Owais","lead_date":"2023-04-01"}', 'Approved', 'High', 'DIFFERCO|WIO|2023-04', null, 'Not Needed', 'Approved'),
  (public.id('dimp'), 'Monthly', 4, '{}', '{"company":"No Fee Co LLC","bank_raw":"FAB","bank_resolved":"FAB","status_raw":"WIP","rm":"Irfan","lead_date":"2023-05-01"}', 'Document Collection', 'High', 'NOFEECO|FAB|2023-05', null, 'Not Needed', 'Approved'),
  (public.id('dimp'), 'Monthly', 5, '{}', '{"company":"Blank Status Co","bank_raw":"SIB","bank_resolved":"SIB","fee":900,"lead_date":"2023-06-01"}', null, 'Low', 'BLANKSTATUSCO|SIB|2023-06', null, 'Not Needed', 'Pending'),
  (public.id('dimp'), 'Monthly', 6, '{}', '{"company":"Alias Co LLC","bank_raw":"Mashreq Bank","bank_resolved":null,"fee":800,"status_raw":"WIP","rm":"Asim","lead_date":"2023-07-01"}', 'Document Collection', 'Low', 'ALIASCO||2023-07', null, 'Not Needed', 'Pending'),
  (public.id('dimp'), 'Completed', 2, '{}', '{"company":"Waiting Co","bank_raw":"ADCB","bank_resolved":"ADCB","status_raw":"Approved","lead_date":"2023-03-31"}', 'Approved', 'Medium', 'WAITINGCO|ADCB|2023-03', null, 'Not Needed', 'Pending'),
  (public.id('dimp'), 'Monthly', 7, '{}', '{"company":"Touched Co","bank_raw":"DIB","bank_resolved":"DIB","fee":1000,"status_raw":"Approved","lead_date":"2023-08-01"}', 'Approved', 'High', 'TOUCHEDCO|DIB|2023-08', null, 'Not Needed', 'Approved');
select public.banking_import_commit(public.id('dimp'), 100) is not null;
select public.banking_application_set_status((select application_id from public.banking_excel_import_rows where import_id = public.id('dimp') and source_sheet = 'Monthly' and source_row = 7), 'On Hold', 'Worked on in the CRM') is null;
select public.keep('dsame', (select id from public.banking_excel_import_rows where import_id = public.id('dimp') and source_sheet = 'Monthly' and source_row = 1));
select public.keep('dwait', (select id from public.banking_excel_import_rows where import_id = public.id('dimp') and source_sheet = 'Monthly' and source_row = 2));
select public.keep('dtwin', (select id from public.banking_excel_import_rows where import_id = public.id('dimp') and source_sheet = 'Completed' and source_row = 2));
select public.keep('ddiff', (select id from public.banking_excel_import_rows where import_id = public.id('dimp') and source_sheet = 'Monthly' and source_row = 3));

create function public.legacy_rows() returns jsonb language sql as $$ select $j$[
 {"task_id":"t1","status":"Approved","payment_note":null,"issues":[],"raw":{"Signing Date":"2023-01-20","Opening Date":"2023-02-01"},
  "mapped":{"company":"SAME CO L.L.C","bank_raw":"RAK","contact":"Asha","nationality":"Indian","fee":3000,"rm_fee":500,"status_raw":"APPROVED","rm":"HASAN","signing_date":"2023-01-20","lead_date":"2023-01-20","opening_date":"2023-02-01"}},
 {"task_id":"t2","status":"Approved","payment_note":"AED1,000","issues":[],"raw":{"Signing Date":"2023-03-15"},
  "mapped":{"company":"Waiting Co LLC","bank_raw":"ADCB","contact":"Ben","fee":2000,"status_raw":"Approved","rm":"Bilal","signing_date":"2023-03-15","lead_date":"2023-03-15"}},
 {"task_id":"t3","status":"Document Collection","payment_note":null,"issues":[],"raw":{"Signing Date":"2023-04-02"},
  "mapped":{"company":"Differ Co FZE","bank_raw":"WIO","fee":4000,"status_raw":"WIP","rm":"Owais","signing_date":"2023-04-02","lead_date":"2023-04-02"}},
 {"task_id":"t4","status":"Document Collection","payment_note":null,"issues":[],"raw":{"Signing Date":"2026-06-17"},
  "mapped":{"company":"Brand New Co","bank_raw":"Mashreq Bank","contact":"Cara","fee":6000,"rm_fee":1500,"status_raw":"WIP","rm":"Manish","signing_date":"2026-06-17","lead_date":"2026-06-17"}},
 {"task_id":"t5","status":"Document Collection","payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"No Fee Co LLC","bank_raw":"FAB","fee":7000,"rm_fee":1500,"status_raw":"WIP","rm":"Irfan"}},
 {"task_id":"t6","status":null,"payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"No Status At All","bank_raw":"DIB"}},
 {"task_id":"t7","status":"Document Collection","payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"Alias Co","bank_raw":"MASHREQ","fee":800,"status_raw":"WIP","rm":"Asim"}},
 {"task_id":"t8","status":"Approved","payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"Held Co","bank_raw":"ADCB","status_raw":"Approved","hold_reason":"Fee differs between folders"}},
 {"task_id":"t9","status":"Approved","payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"Stripe Co","bank_raw":"STRIPE","status_raw":"Approved"}},
 {"task_id":"t10","status":"Document Collection","payment_note":null,"issues":[],"raw":{},
  "mapped":{"company":"Touched Co","bank_raw":"DIB","fee":1000,"status_raw":"WIP"}}
]$j$::jsonb $$;

select public.as_user('0c');
select public.must_fail('sales cannot stage old CRM rows', $$select public.banking_legacy_stage('x', 'y', '[]')$$, 'permission');
select public.as_user('0a');
select public.keep('limp', (public.banking_legacy_stage('Old.csv', 'sha1', public.legacy_rows()) ->> 'import_id'));
create function public.lr(t text) returns public.banking_excel_import_rows language sql as $$ select * from public.banking_excel_import_rows where legacy_task_id = t $$;

select public.ok('staging creates no case', (select count(*) from public.banking_cases c where c.lead_id in (select lead_id from public.banking_excel_import_rows where import_id = public.id('limp') and lead_id is not null)) = 0);
select public.ok('legal suffixes and bank alias still match', (public.lr('t1')).matched_row_id = public.id('dsame'));
select public.ok('matches committed', (public.lr('t1')).reconcile_result = 'Matches Committed');
select public.ok('matches draft', (public.lr('t2')).reconcile_result = 'Matches Draft' and (public.lr('t2')).matched_row_id = public.id('dwait'));
select public.ok('status and fee differences are recorded, not held', (public.lr('t3')).reconcile_result = 'Matches Committed' and jsonb_array_length((public.lr('t3')).conflicts) = 2);
select public.ok('new row', (public.lr('t4')).reconcile_result = 'New' and (public.lr('t4')).mapped ->> 'bank_resolved' = 'MASHREQ');
select public.ok('fee missing on a committed case is recorded, not held', (public.lr('t5')).reconcile_result = 'Matches Committed');
select public.ok('draft with an unresolved bank name still matches', (public.lr('t7')).reconcile_result = 'Matches Draft');
select public.ok('loader hold becomes a conflict', (public.lr('t8')).reconcile_result = 'Conflict');
select public.ok('unknown bank becomes a conflict', (public.lr('t9')).reconcile_result = 'Conflict');
select public.ok('no status waits for a person', (public.lr('t6')).reconcile_result = 'No Status');

select public.keep('stage2', (public.banking_legacy_stage('Old.csv', 'sha1', public.legacy_rows()) ->> 'import_id'));
select public.ok('staging again repeats nothing', public.id('stage2') = public.id('limp') and (select count(*) from public.banking_excel_import_rows where import_id = public.id('limp')) = 10);

select public.keep('cases_before', (select count(*) from public.banking_cases));
select public.banking_legacy_apply(public.id('limp')) is not null;

select public.ok('three new cases only', (select count(*) from public.banking_cases) = (select v::int + 3 from public.t_ids where k = 'cases_before'));
select public.ok('committed match links the existing case', (public.lr('t1')).case_id = (select case_id from public.banking_excel_import_rows where id = public.id('dsame')) and (public.lr('t1')).decision = 'Committed');
select public.ok('blank contact filled on the existing lead', (select contact_person from public.banking_leads where id = (public.lr('t1')).lead_id) = 'Asha');
select public.ok('signing and opening dates stored', (select signing_date = '2023-01-20' and opening_date = '2023-02-01' from public.banking_applications where id = (public.lr('t1')).application_id));
select public.ok('existing RM text kept', (select relationship_manager_text from public.banking_applications where id = (public.lr('t1')).application_id) = 'Hasan');
select public.ok('draft match commits the old CRM row', (public.lr('t2')).decision = 'Committed' and (public.lr('t2')).case_id is not null);
select public.ok('draft row stands down', (select decision = 'Skipped' and duplicate_of = (public.lr('t2')).id from public.banking_excel_import_rows where id = public.id('dwait')));
select public.ok('repeat in the other sheet stands down too', (select decision = 'Skipped' and duplicate_of = (public.lr('t2')).id from public.banking_excel_import_rows where id = public.id('dtwin')));
select public.ok('held rows create nothing', (public.lr('t8')).decision = 'Skipped' and (public.lr('t9')).decision = 'Skipped' and (public.lr('t8')).case_id is null and (public.lr('t9')).case_id is null);
select public.ok('draft-only values carried over', (public.lr('t2')).mapped ->> 'mobile' = '0500000000');
select public.ok('differing payment note kept for review', (public.lr('t2')).payment_review = 'Pending' and (public.lr('t2')).payment_note = 'AED1,000' and (public.lr('t2')).issues @> array['Draft payment note: 1000 BT 01/03']);
select public.ok('no payment is posted', (select count(*) from public.banking_payments where case_id = (public.lr('t2')).case_id) = 0);
select public.ok('old CRM status wins on a committed case', (select a.status = 'Document Collection' and a.is_active from public.banking_applications a where a.id = (public.lr('t3')).application_id));
select public.ok('status change is in the history', (select count(*) from public.banking_application_status_history h where h.application_id = (public.lr('t3')).application_id and h.previous_status = 'Approved' and h.new_status = 'Document Collection') = 1);
select public.ok('case follows the status', (select current_stage = 8 and outcome is null and legacy_status = 'WIP' from public.banking_cases where id = (public.lr('t3')).case_id));
select public.ok('old CRM fee wins and the total follows', (select total_amount from public.banking_quotations where case_id = (public.lr('t3')).case_id and is_imported) = 4000);
select public.ok('missing fee creates the quotation', (select total_amount from public.banking_quotations where case_id = (public.lr('t5')).case_id and is_imported and status = 'Accepted') = 7000);
select public.ok('RM fee added to a case without one', (select amount from public.banking_commissions where application_id = (public.lr('t5')).application_id) = 1500);
select public.ok('case worked on since the import is held', (public.lr('t10')).reconcile_result = 'Conflict' and (public.lr('t10')).decision = 'Skipped' and (public.lr('t10')).error like '%Changed in the CRM%');
select public.ok('held case keeps its status', (select status from public.banking_applications a join public.banking_excel_import_rows r on r.application_id = a.id where r.source_sheet = 'Monthly' and r.source_row = 7 and r.import_id = public.id('dimp')) = 'On Hold');
select public.ok('new row commits with commission', (public.lr('t4')).decision = 'Committed' and (select amount from public.banking_commissions where application_id = (public.lr('t4')).application_id) = 1500);
select public.ok('no status row left pending', (public.lr('t6')).decision = 'Pending' and (public.lr('t6')).case_id is null);

select public.keep('cases_after', (select count(*) from public.banking_cases));
select public.banking_legacy_stage('Old.csv', 'sha1', public.legacy_rows()) is not null;
select public.banking_legacy_apply(public.id('limp')) is not null;
select public.ok('applying again repeats nothing', (select count(*) from public.banking_cases) = (select v::int from public.t_ids where k = 'cases_after'));

\echo === 012 FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === 012 SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
