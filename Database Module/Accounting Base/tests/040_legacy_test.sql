-- Old CRM import: staging rows and accounting_legacy_apply. Reuses t.ok, t.fails from 010 in the same database.
-- Every name here is invented, except the Geo AB Capital alias and the GEO profile it maps to, which the importer matches on. Migration 004 must already be loaded by run-local.sh.
\set ON_ERROR_STOP on
reset role;

insert into profiles values
  ('00000000-0000-0000-0000-000000000101', 'accounts', 'GEO'),
  ('00000000-0000-0000-0000-000000000102', 'accounts', 'Tara Quill'),
  ('00000000-0000-0000-0000-000000000103', 'accounts', 'Twin Person'),
  ('00000000-0000-0000-0000-000000000104', 'accounts', 'twin person');
insert into client_master values ('C20', 'Zenith Trading - FZCO'), ('C30', 'Twin Client'), ('C31', 'twin client');

-- A staging row as legacy_load.py writes it. The key is 'k-' plus the label.
create function t.stage(k text, rn int, nm text, who jsonb default '[]', st text default 'staged', extra jsonb default '{}') returns void language sql as $$
  insert into accounting_legacy_rows (row_no, legacy_key, raw, mapped, state, reason)
  values (rn, 'k-' || k, jsonb_build_object('Task Name', nm, 'Status', 'x'),
          jsonb_build_object('client_name', nm, 'service_name', 'Corporate Tax Return Filing', 'service_department', 'Tax Compliance',
                             'work_status', 'In Progress', 'assignees', who, 'created_at', '2026-03-07', 'payment_tracked', true, 'legacy_key', 'k-' || k) || extra,
          st, case when st = 'held' then 'Same name, type and created date appears twice' end) $$;
create function t.lj(k text) returns accounting_jobs language sql as $$ select * from accounting_jobs where legacy_key = 'k-' || k $$;

select t.stage('a1', 1, '  ACME llc ', '[]', 'staged', '{"work_status":"Completed","completed_at":"2026-04-03","due_date":"2026-05-01","payment_tracked":false,"remarks":"Applied"}');
select t.stage('a2', 2, 'Zenith Trading FZCO');
select t.stage('a3', 3, 'Held Co', '[]', 'held');
select t.stage('a4', 4, 'Alias Co', '["Geo AB Capital"]');
select t.stage('a5', 5, 'Case Co', '["TARA QUILL"]');
select t.stage('a6', 6, 'Nobody Co', '["Omar Fictus"]');
select t.stage('a7', 7, 'Twin Staff Co', '["Twin Person"]');
select t.stage('a8', 8, 'Mixed Co', '["GEO","Omar Fictus"]');
select t.stage('a9', 9, 'Twin Client');

create table t.res (r jsonb);
insert into t.res select accounting_legacy_apply();

select t.ok('apply_result_counts', (select r ->> 'committed' = '8' and r ->> 'already_there' = '0' and r ->> 'held' = '1' and r ->> 'linked_clients' = '1' from t.res));
select t.ok('apply_result_unmatched', (select r -> 'unmatched_assignees' @> '["Omar Fictus","Twin Person"]'::jsonb and not (r -> 'unmatched_assignees' ? 'GEO') from t.res));
select t.ok('apply_creates_jobs', (select count(*) from accounting_jobs where legacy_key like 'k-a%') = 8);
select t.ok('apply_job_fields',
  (t.lj('a1')).work_status = 'Completed' and (t.lj('a1')).payment_tracked = false and (t.lj('a1')).due_date = '2026-05-01'
  and (t.lj('a1')).remarks = 'Applied' and (t.lj('a1')).service_name = 'Corporate Tax Return Filing' and (t.lj('a1')).service_department = 'Tax Compliance'
  and (t.lj('a1')).legacy_raw ->> 'Task Name' = '  ACME llc ' and (t.lj('a1')).created_by is null and (t.lj('a1')).client_name = 'ACME llc');
select t.ok('apply_dates_from_old_export',
  accounting_dubai_date((t.lj('a1')).created_at) = '2026-03-07' and accounting_dubai_date((t.lj('a1')).completed_at) = '2026-04-03'
  and (t.lj('a2')).completed_at is null);
select t.ok('apply_makes_imported_event',
  (select count(*) from accounting_job_events e where e.job_id = (t.lj('a1')).id and e.event = 'Imported' and e.created_by is null) = 1);
select t.ok('apply_links_staging_rows', (select count(*) from accounting_legacy_rows s join accounting_jobs j on j.id = s.job_id
  where s.legacy_key like 'k-a%' and s.state = 'committed' and j.legacy_key = s.legacy_key) = 8);
select t.ok('apply_skips_held', (t.lj('a3')).id is null
  and (select state = 'held' and job_id is null from accounting_legacy_rows where legacy_key = 'k-a3'));
select t.ok('assignee_alias', (t.lj('a4')).assignee_ids = array['00000000-0000-0000-0000-000000000101'::uuid] and (t.lj('a4')).legacy_assignees is null);
select t.ok('assignee_any_case', (t.lj('a5')).assignee_ids = array['00000000-0000-0000-0000-000000000102'::uuid] and (t.lj('a5')).legacy_assignees is null);
select t.ok('assignee_unknown_stays_text', (t.lj('a6')).assignee_ids = '{}' and (t.lj('a6')).legacy_assignees = 'Omar Fictus');
select t.ok('assignee_two_profiles_stay_text', (t.lj('a7')).assignee_ids = '{}' and (t.lj('a7')).legacy_assignees = 'Twin Person');
select t.ok('assignee_mixed', (t.lj('a8')).assignee_ids = array['00000000-0000-0000-0000-000000000101'::uuid] and (t.lj('a8')).legacy_assignees = 'Omar Fictus');
select t.ok('client_link_exact_only', (t.lj('a1')).client_id = 'C1' and (t.lj('a2')).client_id is null);
select t.ok('client_two_matches_stay_text', (t.lj('a9')).client_id is null);

-- A second run does nothing
truncate t.res;
insert into t.res select accounting_legacy_apply();
select t.ok('rerun_no_double', (select r ->> 'committed' = '0' and r ->> 'already_there' = '0' from t.res)
  and (select count(*) from accounting_jobs where legacy_key like 'k-a%') = 8);

-- Staff edit a job, then the same key is staged again by a later export
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select accounting_job_set_fee((t.lj('a2')).id, 500);
select accounting_job_set_status((t.lj('a2')).id, 'Completed', null, (t.lj('a2')).updated_at);
reset role;
select t.stage('a2', 99, 'Zenith Trading FZCO', '[]', 'staged', '{"work_status":"To Do"}');
truncate t.res;
insert into t.res select accounting_legacy_apply();
select t.ok('rerun_keeps_staff_edits',
  (select r ->> 'committed' = '0' and r ->> 'already_there' = '1' from t.res)
  and (t.lj('a2')).fee_amount = 500 and (t.lj('a2')).work_status = 'Completed'
  and (select count(*) from accounting_jobs where legacy_key = 'k-a2') = 1
  and (select state = 'committed' and reason = 'already there' and job_id = (t.lj('a2')).id from accounting_legacy_rows where legacy_key = 'k-a2' and row_no = 99));

-- Who may call and read
select t.ok('apply_refused_for_staff', not has_function_privilege('authenticated', 'public.accounting_legacy_apply()', 'execute')
  and not has_function_privilege('anon', 'public.accounting_legacy_apply()', 'execute'));
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.fails('apply_call_refused_for_accounts_user', $$select accounting_legacy_apply()$$, 'permission denied');
select t.fails('staging_direct_write_refused', $$insert into accounting_legacy_rows (row_no, legacy_key, raw, mapped) values (1000, 'x', '{}', '{}')$$, 'permission denied');
select t.ok('accounts_user_reads_staging', (select count(*) from accounting_legacy_rows) = 10);
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.ok('other_user_reads_no_staging', (select count(*) from accounting_legacy_rows) = 0);
reset role;

-- Staging key rules: unique on key and row number, state limited
select t.fails('staging_key_row_unique', $$select t.stage('a1', 1, 'Dup')$$, 'duplicate key');
select t.fails('staging_state_checked', $$select t.stage('zz', 500, 'Bad', '[]', 'weird')$$, 'violates check');

-- Migration 004 runs again with nothing lost
\ir ../migrations/004_legacy_import.sql
select t.ok('migration_rerun_keeps_rows', (select count(*) from accounting_legacy_rows) = 10 and (select count(*) from accounting_jobs where legacy_key like 'k-a%') = 8);
