-- Step function and rule seed. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

select steps as lic from alert_rules where code = 'licence_expiry' \gset
select steps as visa from alert_rules where code = 'visa_expiry' \gset
select steps as task from alert_rules where code = 'job_due' \gset

select t.ok('91 days is outside', (select count(*) = 0 from alert_step_for(:'lic', 91)));
select t.ok('90 is Medium', (select priority = 'Medium' from alert_step_for(:'lic', 90)));
select t.ok('61 is step 90', (select step = 90 from alert_step_for(:'lic', 61)));
select t.ok('30 is High', (select priority = 'High' from alert_step_for(:'lic', 30)));
select t.ok('0 is still High', (select priority = 'High' from alert_step_for(:'lic', 0)));
select t.ok('expired is Critical', (select priority = 'Critical' and step = -1 from alert_step_for(:'lic', -1)));
select t.ok('visa 5 is step 7', (select step = 7 from alert_step_for(:'visa', 5)));
select t.ok('visa 16 is step 30', (select step = 30 from alert_step_for(:'visa', 16)));
select t.ok('due in 2 days is outside', (select count(*) = 0 from alert_step_for(:'task', 2)));
select t.ok('due tomorrow Medium', (select priority = 'Medium' from alert_step_for(:'task', 1)));
select t.ok('due today High', (select priority = 'High' from alert_step_for(:'task', 0)));
select t.ok('overdue 2 days High', (select priority = 'High' from alert_step_for(:'task', -2)));
select t.ok('overdue 3 days Critical', (select priority = 'Critical' from alert_step_for(:'task', -3)));
select t.ok('unsorted steps still work', (select step = 10 from alert_step_for('[{"days":30,"priority":"High"},{"days":10,"priority":"Medium"}]', 5)));
select t.ok('empty steps give no row', (select count(*) = 0 from alert_step_for('[]', 0)));

select t.ok('seven rules seeded', (select count(*) = 7 from alert_rules where code in ('licence_expiry','visa_expiry','job_due','service_due','setup_task_due','banking_task_due','crm_task_due')));
select t.ok('crm_task_due has null department', (select department is null from alert_rules where code = 'crm_task_due'));
select t.ok('departments as specified', (select string_agg(code || '=' || coalesce(department, '-'), ',' order by code) =
  'banking_task_due=Business Banking,crm_task_due=-,job_due=Accounting,licence_expiry=Business Setup,service_due=Business Setup,setup_task_due=Business Setup,visa_expiry=Business Setup'
  from alert_rules where code in ('licence_expiry','visa_expiry','job_due','service_due','setup_task_due','banking_task_due','crm_task_due')));
select t.ok('titles and actions as ruled', (select
  (select title_template = 'Licence expiry: {subject}' and action_template = 'Confirm the licence date, then start the renewal.' from alert_rules where code = 'licence_expiry')
  and (select title_template = 'Visa expiry: {subject}' and action_template = 'Confirm the visa date, then start the renewal or cancellation.' from alert_rules where code = 'visa_expiry')
  and (select count(*) = 5 and bool_and(title_template = 'Due: {subject}' and action_template = 'Complete this item or update its due date.' and category = 'Deadlines')
       from alert_rules where code in ('job_due','service_due','setup_task_due','banking_task_due','crm_task_due'))));
select t.ok('stored priorities are valid', (select bool_and(s->>'priority' in ('Critical','High','Medium','Normal'))
  from alert_rules r, jsonb_array_elements(r.steps) s where r.code <> 'r'));

-- Reapply keeps edited steps
update alert_rules set steps = '[{"days":5,"priority":"Normal"}]' where code = 'job_due';
\ir ../migrations/002_alert_scan.sql
\ir reapply_review_fixes.sql
select t.ok('reapply keeps edited steps', (select steps = '[{"days":5,"priority":"Normal"}]'::jsonb from alert_rules where code = 'job_due'));
update alert_rules set steps = :'task' where code = 'job_due';

-- Grants
select t.ok('authenticated cannot run alert_step_for', not has_function_privilege('authenticated', 'alert_step_for(jsonb,int)', 'execute'));
select t.ok('anon cannot run alert_step_for', not has_function_privilege('anon', 'alert_step_for(jsonb,int)', 'execute'));
select t.ok('public cannot run alert_step_for', (select count(*) = 0 from pg_proc p
  where p.oid = 'alert_step_for(jsonb,int)'::regprocedure
  and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')));

-- ═══ Rules and the daily scan (Task 3) ═══════════════════════════════
-- Triage here keeps these scans free of escalation; 030 covers the Live scan and alert_escalate_due().
update alert_settings set value = '"Triage"' where key = 'alert_mode';
update alert_rules set enabled = false where code = 'r';   -- test rule left by 010; it has no rule function
select (now() at time zone 'Asia/Dubai')::date as today \gset
select to_char(:'today'::date + 20, 'DD/MM/YYYY') as master20 \gset

insert into client_master (client_id, legal_name, data) values
  ('C30', 'Thirty LLC', '{}'), ('CM', 'Master LLC', jsonb_build_object('License Expiry Date', :'master20')),
  ('CBAD', 'Bad Date LLC', '{"License Expiry Date": "garbage"}'), ('CLIQ', 'Liquidated LLC', '{}'), ('CREJ', 'Rejected LLC', '{}'),
  ('CK', 'Ten Days LLC', '{}'), ('CB', 'Beyond LLC', '{}'), ('CFAR', 'Far LLC', '{}'), ('CV', 'Visa LLC', '{}'),
  ('CS', 'Service LLC', '{}'), ('CT', 'Tasks LLC', '{}');
insert into business_setup_kyc_profiles (client_id, client_status, licence_expiry) values
  ('C30', 'Active', :'today'::date + 30), ('CM', 'Active', null), ('CBAD', 'Active', null),
  ('CLIQ', 'LIQUIDATED', :'today'::date + 10), ('CREJ', 'rejected', :'today'::date + 10),
  ('CK', 'Active', :'today'::date + 10), ('CB', 'Active', :'today'::date + 60), ('CFAR', 'Active', :'today'::date + 200),
  ('CV', 'Active', null);
insert into client_owners (client_id, department, owner_id) values
  ('C30', 'Business Setup', '00000000-0000-0000-0000-0000000000c1'),
  ('CK', 'Business Setup', '00000000-0000-0000-0000-0000000000c2'),
  ('CS', 'Accounting', '00000000-0000-0000-0000-0000000000c2');

insert into business_setup_visas (client_id, person_name, expiry_date, status) values
  ('CV', 'Visa Holder', :'today'::date + 20, 'Active'),
  ('CNOPROFILE', 'No Profile Person', :'today'::date + 20, 'Active'),
  ('CLIQ', 'Closed Client Person', :'today'::date + 20, 'Active'),
  ('CV', 'Cancelled Person', :'today'::date + 20, 'Cancelled'),
  ('CV', 'Resigned Person', :'today'::date + 20, 'resigned'),
  ('CV', 'Pending Person', :'today'::date + 20, 'x'),
  ('CV', 'Dateless Person', null, 'Active');
select id as x_visa from business_setup_visas where person_name = 'Pending Person' \gset

insert into business_setup_services (client_id, name, status, due_date, owner_id, historical) values
  ('CS', 'VAT Registration', 'In progress', :'today'::date, '00000000-0000-0000-0000-0000000000c1', false),
  ('CS', 'Visa Registration', 'In progress', :'today'::date, null, false),
  ('CS', 'Old Service', 'In progress', :'today'::date, null, true),
  ('CS', 'Finished Service', 'Completed', :'today'::date, null, false),
  ('CS', 'Dropped Service', 'Cancelled', :'today'::date, null, false);

insert into accounting_job_list (client_id, client_name, service_name, service_department, due_date, assignee_ids, work_status) values
  ('CS', 'Service LLC', 'Job two days late', 'Accounting', :'today'::date - 2, array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'In progress'),
  ('CS', 'Service LLC', 'Job three days late', null, :'today'::date - 3, array['00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'In progress'),
  ('CS', 'Service LLC', 'Job done', 'Accounting', :'today'::date - 5, null, 'Completed'),
  ('CS', 'Service LLC', 'Job cancelled', 'Accounting', :'today'::date - 5, null, 'Client Cancelled'),
  ('CS', 'Service LLC', 'Job no date', 'Accounting', null, null, 'In progress');

insert into business_setup_tasks (client_id, title, owner_id, due_date, status) values
  ('CT', 'Setup open', '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'Open'),
  ('CT', 'Setup done', '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'Done');
-- Banking clients and cases are uuid-keyed. client_master_id links to the alert's client id; a banking client may have none.
insert into banking_clients (id, client_master_id, display_name) values
  ('00000000-0000-0000-0000-00000000bc01', 'CT', 'Tasks Banking Name'),
  ('00000000-0000-0000-0000-00000000bc02', null, 'Unlinked Banking Co');
insert into banking_cases (id, client_id) values ('00000000-0000-0000-0000-00000000bca1', '00000000-0000-0000-0000-00000000bc01');
insert into banking_tasks (client_id, case_id, task_type, title, assigned_to, due_date, status) values
  ('00000000-0000-0000-0000-00000000bc01', null, 'KYC', 'Bank open', '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'Open'),
  ('00000000-0000-0000-0000-00000000bc01', null, 'KYC', 'Bank progress', '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'In Progress'),
  ('00000000-0000-0000-0000-00000000bc01', null, 'KYC', 'Bank closed', '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'Closed'),
  (null, '00000000-0000-0000-0000-00000000bca1', 'Case follow-up', null, '00000000-0000-0000-0000-0000000000c1', :'today'::date, 'Open'),
  (null, null, 'Loose task', null, null, :'today'::date, 'Open'),
  ('00000000-0000-0000-0000-00000000bc02', null, 'Unlinked', null, null, :'today'::date, 'Open');
insert into tasks (title, status, assignee_id, due_date, deleted_at) values
  ('Crm live', 'Open', '00000000-0000-0000-0000-0000000000c2', :'today'::date, null),
  ('Crm done', 'Done', '00000000-0000-0000-0000-0000000000c2', :'today'::date, null),
  ('Crm deleted', 'Open', '00000000-0000-0000-0000-0000000000c2', :'today'::date, now()),
  ('Crm no date', 'Open', '00000000-0000-0000-0000-0000000000c2', null, null);

-- Unfiltered figures before the first scan
select count(*) as alerts0 from alerts \gset
select count(*) as bells0 from notifications where type = 'alert_centre' \gset
select count(*) as logs0 from alert_scan_log \gset

select alert_scan() as scan1 \gset
select t.ok('scan returns Ok and logs one row', (select status = 'Ok' from alert_scan_log order by id desc limit 1) and (select count(*) = :logs0 + 1 from alert_scan_log) and (:'scan1'::jsonb->>'status') = 'Ok');
select t.ok('scan wrote alerts', (select count(*) > :alerts0 from alerts));

-- Licence
select t.ok('licence at 30 days is High', (select priority = 'High' and current_step = 30 and due_date = :'today'::date + 30 and assigned_to = '00000000-0000-0000-0000-0000000000c1' from alerts where rule_code = 'licence_expiry' and client_id = 'C30'));
select t.ok('master date used when profile date null', (select count(*) = 1 and bool_and(due_date = :'today'::date + 20 and priority = 'High') from alerts where rule_code = 'licence_expiry' and client_id = 'CM'));
select t.ok('unparseable master date counts missing, scan Ok', (select status = 'Ok' and (rule_counts->'licence_expiry'->>'with_data')::int < (rule_counts->'licence_expiry'->>'checked')::int from alert_scan_log order by id desc limit 1)
  and not exists (select 1 from alerts where client_id = 'CBAD'));
select t.ok('licence counts are exact', (select rule_counts->'licence_expiry' from alert_scan_log order by id desc limit 1) @> '{"checked": 7, "with_data": 5, "raised": 4}'::jsonb);
select t.ok('liquidated and rejected clients raise nothing, any case', not exists (select 1 from alerts where client_id in ('CLIQ', 'CREJ') and rule_code = 'licence_expiry'));
select t.ok('licence 200 days away raises nothing', not exists (select 1 from alerts where client_id = 'CFAR'));
select t.ok('licence subject carries the legal name and the title is built', (select subject = 'Thirty LLC' and title = 'Licence expiry: Thirty LLC' and department = 'Business Setup' from alerts where client_id = 'C30' and rule_code = 'licence_expiry'));
select t.ok('three missed steps: one row, top step, one bell', (select count(*) = 1 and bool_and(current_step = 30 and priority = 'High') from alerts where client_id = 'CK')
  and (select count(*) = 1 from notifications n join alerts a on n.link_scope->>'alert_id' = a.id::text where a.client_id = 'CK'));
select t.ok('owner from client_owners when the rule gives none', (select assigned_to = '00000000-0000-0000-0000-0000000000c2' from alerts where client_id = 'CK'));

-- Visa
select t.ok('visa with no profile still raises', (select count(*) = 1 from alerts where rule_code = 'visa_expiry' and subject like 'No Profile Person%'));
select t.ok('visa of liquidated client raises nothing', not exists (select 1 from alerts where subject like 'Closed Client Person%'));
select t.ok('cancelled and resigned visas raise nothing', not exists (select 1 from alerts where subject like 'Cancelled Person%' or subject like 'Resigned Person%'));
select t.ok('visa status X is raised as pending follow-up', (select description = 'Pending follow-up' and priority = 'High' from alerts where source_id = :'x_visa'));
select t.ok('normal visa has no description and carries person and client', (select description is null and subject = 'Visa Holder (Visa LLC)' and title = 'Visa expiry: Visa Holder (Visa LLC)' from alerts where rule_code = 'visa_expiry' and subject like 'Visa Holder%'));
select t.ok('visa counts: three raised, dateless counted', (select rule_counts->'visa_expiry' from alert_scan_log order by id desc limit 1) @> '{"checked": 4, "with_data": 3, "raised": 3}'::jsonb
  and (select count(*) = 3 from alerts where rule_code = 'visa_expiry'));

-- Services
select t.ok('imported Visa Registration service raises nothing', not exists (select 1 from alerts where subject like 'Visa Registration%'));
select t.ok('only the live service raises', (select count(*) = 1 and bool_and(subject like 'VAT Registration%' and priority = 'High' and assigned_to = '00000000-0000-0000-0000-0000000000c1') from alerts where rule_code = 'service_due'));

-- Jobs
select t.ok('job due 2 days ago is High, 3 days Critical', (select priority from alerts where subject like 'Job two days late%') = 'High' and (select priority from alerts where subject like 'Job three days late%') = 'Critical');
select t.ok('completed, cancelled and dateless jobs raise nothing, exactly two job alerts', (select count(*) = 2 from alerts where rule_code = 'job_due')
  and (select rule_counts->'job_due' from alert_scan_log order by id desc limit 1) @> '{"checked": 3, "with_data": 2, "raised": 2}'::jsonb);
select t.ok('first assignee assigned, the rest recipients; department defaults to Accounting', (select department = 'Accounting' and assigned_to = '00000000-0000-0000-0000-0000000000c1'
    and (select count(*) = 2 and bool_and(reason = 'Assigned') from alert_recipients r where r.alert_id = a.id) from alerts a where a.subject like 'Job three days late%'));

-- Tasks
select t.ok('setup task Open raises, Done does not', (select count(*) = 1 and bool_and(subject like 'Setup open%') from alerts where rule_code = 'setup_task_due'));
select t.ok('banking Open and In Progress raise, Closed does not', (select count(*) = 5 from alerts where rule_code = 'banking_task_due') and not exists (select 1 from alerts where subject like 'Bank closed%'));
select t.ok('banking task linked by client_id: master client id, master name',
  (select client_id = 'CT' and subject = 'Bank open - Tasks LLC' from alerts where rule_code = 'banking_task_due' and subject like 'Bank open%'));
select t.ok('banking task linked only by case_id: client through the case, task type stands in for a null title',
  (select client_id = 'CT' and subject = 'Case follow-up - Tasks LLC' from alerts where rule_code = 'banking_task_due' and subject like 'Case follow-up%'));
select t.ok('banking task with neither link: null client, still raised, goes unassigned',
  (select client_id is null and subject = 'Loose task' and assigned_to is null from alerts where rule_code = 'banking_task_due' and subject like 'Loose task%'));
select t.ok('banking client with no master link: null client, banking display name in the subject',
  (select client_id is null and subject = 'Unlinked - Unlinked Banking Co' from alerts where rule_code = 'banking_task_due' and subject like 'Unlinked%'));
select t.ok('crm task: live raises, done and deleted do not, assignee is assignee_id', (select count(*) = 1 and bool_and(subject = 'Crm live' and assigned_to = '00000000-0000-0000-0000-0000000000c2') from alerts where rule_code = 'crm_task_due'));
select t.ok('a crm task with no date counts as missing, scan Ok', (select status = 'Ok' and rule_counts->'crm_task_due' @> '{"checked": 2, "with_data": 1, "raised": 1}'::jsonb from alert_scan_log order by id desc limit 1));

-- Re-scan
select count(*) as alerts1 from alerts \gset
select count(*) as bells1 from notifications where type = 'alert_centre' \gset
select count(*) as events1 from alert_events \gset
select alert_scan() as scanned \gset
select t.ok('re-scan same day: no new rows, no new bell, no new events', (select count(*) = :alerts1 from alerts) and (select count(*) = :bells1 from notifications where type = 'alert_centre')
  and (select count(*) = :events1 from alert_events));
select t.ok('bells exist to compare against', :bells1 > :bells0);

-- Date moved
select id as c30_old from alerts where client_id = 'C30' and rule_code = 'licence_expiry' \gset
update business_setup_kyc_profiles set licence_expiry = :'today'::date + 25 where client_id = 'C30';
select alert_scan() as scanned \gset
select t.ok('date moved: old closed with note, new cycle', (select status = 'Resolved' and resolution_note = 'Date changed or no longer applies' and resolved_by is null and resolved_by_system and resolved_at is not null from alerts where id = :'c30_old')
  and (select count(*) = 2 from alerts where client_id = 'C30') and (select count(*) = 1 from alerts where client_id = 'C30' and status = 'Open' and due_date = :'today'::date + 25)
  and (select count(*) = 1 from alert_events where alert_id = :'c30_old' and event = 'resolved'));
update business_setup_kyc_profiles set licence_expiry = :'today'::date + 120 where client_id = 'CB';
select alert_scan() as scanned \gset
select t.ok('date moved beyond 90: old closed, no new row', (select count(*) = 1 and bool_and(status = 'Resolved') from alerts where client_id = 'CB'));
update business_setup_kyc_profiles set licence_expiry = :'today'::date + 30 where client_id = 'C30';   -- back to the first date
select alert_scan() as scanned \gset
select t.ok('date moved back: the system-closed alert of that key reopens', (select status = 'Open' from alerts where id = :'c30_old'));

-- A person's close survives the scan
update alerts set status = 'Resolved', resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000c1' where client_id = 'CK';
select alert_scan() as scanned \gset
select t.ok('person-resolved alert stays resolved', (select status = 'Resolved' and not resolved_by_system and resolved_by is not null from alerts where client_id = 'CK'));

-- Broken rule
select count(*) as banking_open from alerts where rule_code = 'banking_task_due' and status = 'Open' \gset
create or replace function alert_rule_banking_task_due() returns setof alert_candidate
language plpgsql security definer set search_path = public, pg_temp as $f$
begin
  if current_setting('test.break_rule', true) = '1' then raise exception 'broken on purpose'; end if;
  return;
end $f$;
select set_config('test.break_rule', '1', false);
insert into accounting_job_list (client_id, client_name, service_name, service_department, due_date, assignee_ids, work_status)
  values ('CS', 'Service LLC', 'Job added while broken', 'Accounting', :'today'::date, null, 'In progress');
select alert_scan() as scanned \gset
select t.ok('broken rule logged, other rules still ran, scan Failed', (select status = 'Failed' and rule_counts->'banking_task_due'->>'error' like '%broken on purpose%' and rule_counts->'job_due'->>'error' is null
    and error like '%banking_task_due%' from alert_scan_log order by id desc limit 1)
  and exists (select 1 from alerts where subject like 'Job added while broken%'));
select t.ok('broken rule closes nothing', (select count(*) = :banking_open from alerts where rule_code = 'banking_task_due' and status = 'Open') and :banking_open = 5);
select set_config('test.break_rule', '', false);
\ir ../migrations/002_alert_scan.sql
\ir reapply_review_fixes.sql
select alert_scan() as scanned \gset
select t.ok('after restoring the rule the scan is Ok again', (select status = 'Ok' and rule_counts->'banking_task_due'->>'error' is null from alert_scan_log order by id desc limit 1));

-- A rule without a function is an error for that rule, not a scan crash
insert into alert_rules (code, category, title_template, enabled) values ('no_function', 'X', 'x {subject}', true);
select alert_scan() as scanned \gset
select t.ok('enabled rule without a function fails alone', (select status = 'Failed' and rule_counts->'no_function'->>'error' is not null and rule_counts->'job_due'->>'error' is null from alert_scan_log order by id desc limit 1));
update alert_rules set enabled = false where code = 'no_function';
select alert_scan() as scanned \gset
select t.ok('a disabled rule is not scanned and the scan is Ok again', (select status = 'Ok' and not rule_counts ? 'no_function' from alert_scan_log order by id desc limit 1));

-- A refresh brings the description up to date: a visa that moves to status X, with no bell
insert into business_setup_visas (client_id, person_name, expiry_date, status) values ('CV', 'Turning X', :'today'::date + 20, 'Active');
select alert_scan() as scanned \gset
select id as tx from alerts where subject like 'Turning X%' \gset
select count(*) as tx_bells from notifications where link_scope->>'alert_id' = :'tx' \gset
select t.ok('active visa has no description', (select description is null from alerts where id = :'tx'));
update business_setup_visas set status = 'X' where person_name = 'Turning X';
select alert_scan() as scanned \gset
select t.ok('visa moved to X: description refreshed, same row, no bell', (select description = 'Pending follow-up' and status = 'Open' from alerts where id = :'tx')
  and (select count(*) = :tx_bells from notifications where link_scope->>'alert_id' = :'tx'));
update business_setup_visas set status = 'Active' where person_name = 'Turning X';
select alert_scan() as scanned \gset
select t.ok('visa moved back: description cleared', (select description is null from alerts where id = :'tx'));

-- A system reopen refreshes the row and clears every trace of the close
select alert_raise('r', 'reopen-1', 'CS', 'Old subject', 'Accounting', :'today'::date + 9, 5, 'Medium', null, 't', 'i', null, 'Old description') as ro \gset
update alerts set status = 'Resolved', resolved_at = now(), resolved_by = null, resolved_by_system = true, resolution_note = 'Date changed or no longer applies' where id = :'ro';
select t.ok('system reopen returns the row', alert_raise('r', 'reopen-1', 'CS', 'New subject', 'Accounting', :'today'::date + 8, 2, 'High', null, 't', 'i', null, 'New description') = :'ro');
select t.ok('system reopen refreshes subject, due date, step, priority and description, and clears the close',
  (select status = 'Open' and subject = 'New subject' and due_date = :'today'::date + 8 and current_step = 2 and priority = 'High' and description = 'New description'
     and resolution_note is null and resolved_at is null and resolved_by is null and not resolved_by_system from alerts where id = :'ro'));

-- A person's close survives the scan: a dismissal, and a resolver whose profile has since been deleted
insert into profiles values ('00000000-0000-0000-0000-0000000000e9', 'Soon Gone', 'e9@x', 'member');
insert into business_setup_visas (client_id, person_name, expiry_date, status) values
  ('CV', 'Dismissed Person', :'today'::date + 20, 'Active'), ('CV', 'Gone Resolver Person', :'today'::date + 20, 'Active');
select alert_scan() as scanned \gset
update alerts set status = 'Dismissed', resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000c1' where subject like 'Dismissed Person%';
update alerts set status = 'Resolved', resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000e9' where subject like 'Gone Resolver Person%';
delete from profiles where id = '00000000-0000-0000-0000-0000000000e9';
select t.ok('deleting the resolver clears resolved_by', (select resolved_by is null and not resolved_by_system from alerts where subject like 'Gone Resolver Person%'));
select alert_scan() as scanned \gset
select t.ok('a Dismissed row stays put on re-scan', (select count(*) = 1 and bool_and(status = 'Dismissed' and resolved_by = '00000000-0000-0000-0000-0000000000c1') from alerts where subject like 'Dismissed Person%'));
select t.ok('a row closed by a since-deleted person stays closed on re-scan', (select count(*) = 1 and bool_and(status = 'Resolved') from alerts where subject like 'Gone Resolver Person%'));

-- A deleted profile left in assignee_ids must not fail the rule: the foreign keys would refuse it.
insert into accounting_job_list (client_id, client_name, service_name, service_department, due_date, assignee_ids, work_status) values
  ('CS', 'Service LLC', 'Job stale first', 'Accounting', :'today'::date, array['ffffffff-ffff-ffff-ffff-ffffffffffff', '00000000-0000-0000-0000-0000000000c2']::uuid[], 'In progress'),
  ('CS', 'Service LLC', 'Job stale extra', 'Accounting', :'today'::date, array['00000000-0000-0000-0000-0000000000c1', 'ffffffff-ffff-ffff-ffff-ffffffffffff']::uuid[], 'In progress'),
  ('CS', 'Service LLC', 'Job stale only', 'Accounting', :'today'::date, array['ffffffff-ffff-ffff-ffff-ffffffffffff']::uuid[], 'In progress');
select alert_scan() as scanned \gset
select t.ok('stale assignee ids: the scan is Ok and every job raises', (select status = 'Ok' and rule_counts->'job_due'->>'error' is null from alert_scan_log order by id desc limit 1)
  and (select count(*) = 3 from alerts where subject like 'Job stale%'));
select t.ok('stale first id: the next real assignee is assigned, alone', (select assigned_to = '00000000-0000-0000-0000-0000000000c2' and (select count(*) = 1 from alert_recipients r where r.alert_id = a.id) from alerts a where subject like 'Job stale first%'));
select t.ok('stale extra id: only real people are recipients', (select assigned_to = '00000000-0000-0000-0000-0000000000c1' and (select count(*) = 1 from alert_recipients r where r.alert_id = a.id) from alerts a where subject like 'Job stale extra%'));
select t.ok('only a stale id: falls back to the client owner', (select assigned_to = '00000000-0000-0000-0000-0000000000c2' from alerts where subject like 'Job stale only%'));

-- Grants
select t.ok('postgres and service_role can run alert_scan', has_function_privilege('postgres', 'alert_scan()', 'execute') and has_function_privilege('service_role', 'alert_scan()', 'execute'));
select t.ok('authenticated and anon cannot run alert_scan', not has_function_privilege('authenticated', 'alert_scan()', 'execute') and not has_function_privilege('anon', 'alert_scan()', 'execute'));
select t.ok('public cannot run alert_scan', (select count(*) = 0 from pg_proc p where p.oid = 'alert_scan()'::regprocedure
  and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')));
-- 7 from 002, 9 from 006, 5 from 011, 9 from 012, 4 from 013
select t.ok('rule functions are not browser-callable', (select count(*) = 34 and bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'alert\_rule\_%' and proname not in ('alert_rule_save', 'alert_rule_list')));
select t.ok('alert_scan is scheduled daily at 02:00', (select count(*) = 1 and bool_and(schedule = '0 2 * * *' and command = 'select public.alert_scan()') from cron.job where jobname = 'alert-scan'));

-- run-local.sh expects the tests to leave the mode on Live.
update alert_settings set value = '"Live"' where key = 'alert_mode';
