-- Regulatory Updates Centre. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into client_master (client_id, legal_name, data) values
  ('REG01', 'Reg Dubai', '{}'), ('REG02', 'Reg Sharjah', '{}'), ('REG03', 'Reg Closed', '{}'), ('REG04', 'Reg Blank', '{}'), ('REG05', 'Reg NoProfile', '{}')
on conflict do nothing;
insert into business_setup_kyc_profiles (client_id, client_status, jurisdiction) values
  ('REG01', 'Active', 'DMCC'), ('REG02', 'Active', 'SHAMS'), ('REG03', 'Liquidated', 'DMCC'), ('REG04', 'Active', null)
on conflict do nothing;
update alert_settings set value = '"Live"' where key = 'alert_mode';
select count(*) as cm_count from client_master \gset

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select t.fails('an untagged member cannot create', $q$select regulatory_update_save('{"title":"x","category":"Tax"}')$q$, 'You do not have permission');
reset test.uid;
select t.fails('signed out cannot list', $q$select regulatory_list()$q$, 'Sign in');
set role anon;
select t.fails('anon refused', $q$select regulatory_list()$q$, 'permission denied');
set role authenticated;

set test.uid = '00000000-0000-0000-0000-0000000000b1';
select regulatory_update_save('{"title":"New CT rule","category":"Tax","issuing_authority":"FTA"}') as u1 \gset
reset role;
select t.ok('it starts as a Draft with a number', (select workflow_status = 'Draft' and update_number ~ '^REG-[0-9]{6}$' and source = 'Manual' from regulatory_updates where id = :'u1'));
select t.ok('new update alerts the managers', (select count(*) = (select count(*) from alert_managers()) and count(*) >= 2 from alert_recipients r join alerts a on a.id = r.alert_id where a.dedupe_key = 'regulatory:new:' || :'u1' and r.reason = 'Manager'));
select t.ok('no client task exists yet', (select count(*) = 0 from alerts where regulatory_update_id = :'u1' and rule_code = 'regulatory_impact'));
select t.ok('event rules are off, so the scan skips them', (select bool_and(not enabled) from alert_rules where code like 'regulatory\_%'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';

-- Every shortcut is refused.
select t.fails('tasks refused from Draft', format($q$select regulatory_create_tasks(%L)$q$, :'u1'), 'Only a verified update');
select t.fails('verify refused from Draft', format($q$select regulatory_verify(%L)$q$, :'u1'), 'Propose the client list');
select t.fails('list refused before review', format($q$select regulatory_propose_list(%L)$q$, :'u1'), 'Start the review');
select regulatory_start_review(:'u1');
select t.fails('list refused without an effective date', format($q$select regulatory_propose_list(%L)$q$, :'u1'), 'effective date');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'effective_date', (current_date + 30)::text));
select t.fails('list refused without applicability', format($q$select regulatory_propose_list(%L)$q$, :'u1'), 'who this applies to');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'applicability', '{"jurisdictions":["DMCC"]}'::jsonb));
select regulatory_propose_list(:'u1');
reset role;
select t.ok('a match is Applies', (select decision = 'Applies' from regulatory_update_clients where update_id = :'u1' and client_id = 'REG01'));
select t.ok('another jurisdiction is not listed', (select count(*) = 0 from regulatory_update_clients where update_id = :'u1' and client_id = 'REG02'));
select t.ok('a closed client is not listed', (select count(*) = 0 from regulatory_update_clients where update_id = :'u1' and client_id = 'REG03'));
select t.ok('a blank profile is Check, not excluded', (select decision = 'Check' from regulatory_update_clients where update_id = :'u1' and client_id = 'REG04'));
select t.ok('no profile is Check, not excluded', (select decision = 'Check' from regulatory_update_clients where update_id = :'u1' and client_id = 'REG05'));
set role authenticated;

select t.fails('verify needs the official source', format($q$select regulatory_verify(%L)$q$, :'u1'), 'official source');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'official_url', 'https://tax.gov.ae/x'));
select t.fails('E4 stays information only', format($q$select regulatory_verify(%L)$q$, :'u1'), 'third-party');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'evidence_level', 'E1'));
select t.fails('UNVERIFIED stays information only', format($q$select regulatory_verify(%L)$q$, :'u1'), 'not yet law');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'legal_status', 'PROPOSED'));
select t.fails('PROPOSED stays information only', format($q$select regulatory_verify(%L)$q$, :'u1'), 'not yet law');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'legal_status', 'UNDER CONSULTATION'));
select t.fails('UNDER CONSULTATION stays information only', format($q$select regulatory_verify(%L)$q$, :'u1'), 'not yet law');
select regulatory_update_save(jsonb_build_object('id', :'u1', 'legal_status', 'ENACTED'));
select t.fails('every Check needs a decision', format($q$select regulatory_verify(%L)$q$, :'u1'), 'marked Check');
select t.fails('tasks still refused before verification', format($q$select regulatory_create_tasks(%L)$q$, :'u1'), 'Only a verified update');
-- Clients from earlier test files also have no profile, so they are Check too.
reset role;
update regulatory_update_clients set decision = 'Does not apply' where update_id = :'u1' and decision = 'Check' and client_id not in ('REG04', 'REG05');
set role authenticated;
select regulatory_decide_client(:'u1', 'REG04', 'Does not apply');
select regulatory_decide_client(:'u1', 'REG05', 'Does not apply');
select t.fails('a bad decision is refused', format($q$select regulatory_decide_client(%L, 'REG01', 'Maybe')$q$, :'u1'), 'Decision must be');
select regulatory_verify(:'u1');
reset role;
select t.ok('verified records who and when', (select workflow_status = 'Verified' and verified_by = '00000000-0000-0000-0000-0000000000b1' and verified_at is not null from regulatory_updates where id = :'u1'));
set role authenticated;
select t.fails('a verified update cannot change', format($q$select regulatory_update_save(jsonb_build_object('id', %L, 'title', 'y'))$q$, :'u1'), 'cannot be changed');
select t.fails('the list cannot change after verification', format($q$select regulatory_decide_client(%L, 'REG01', 'Does not apply')$q$, :'u1'), 'before verification');
select t.ok('create tasks makes one per Applies', regulatory_create_tasks(:'u1') = 1);
reset role;
select t.ok('task only for the client marked Applies', (select count(*) = 1 and bool_and(client_id = 'REG01') from alerts where regulatory_update_id = :'u1' and rule_code = 'regulatory_impact'));
select t.ok('task due on the effective date', (select due_date = current_date + 30 and category = 'Regulatory' from alerts where regulatory_update_id = :'u1' and rule_code = 'regulatory_impact'));
select t.ok('status is Tasks created', (select workflow_status = 'Tasks created' from regulatory_updates where id = :'u1'));
set role authenticated;
select t.fails('tasks cannot run twice', format($q$select regulatory_create_tasks(%L)$q$, :'u1'), 'Only a verified update');
select t.ok('detail shows progress', (select (d->>'tasks_total')::int = 1 and (d->>'tasks_open')::int = 1 from regulatory_detail(:'u1') d));

-- A member sees verified updates only, with no client list.
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select regulatory_update_save('{"title":"Draft only","category":"Customs"}') as u2 \gset
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select t.ok('a member lists only verified', (select bool_and(e->>'workflow_status' in ('Verified', 'Tasks created', 'Closed')) and bool_or(e->>'id' = :'u1') from jsonb_array_elements(regulatory_list()->'rows') e));
select t.fails('a member cannot open a draft', format($q$select regulatory_detail(%L)$q$, :'u2'), 'not available');
select t.ok('a member sees no client list', regulatory_detail(:'u1')->'clients' = '[]');
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select t.ok('Needs review lists the draft', (select bool_or(e->>'id' = :'u2') from jsonb_array_elements(regulatory_list('Needs review')->'rows') e));

-- The scan leaves regulatory alerts alone, and finishing the last task closes the update.
reset role;
select public.alert_scan();
select t.ok('the scan closes no regulatory alert', (select count(*) = 1 from alerts where regulatory_update_id = :'u1' and rule_code = 'regulatory_impact' and status = 'Open'));
update alerts set status = 'Resolved', resolved_at = now() where regulatory_update_id = :'u1' and rule_code = 'regulatory_impact';
select t.ok('last task resolved closes the update', (select workflow_status = 'Closed' from regulatory_updates where id = :'u1'));

-- All clients leaves out closed ones; has_visa filters.
insert into business_setup_visas (client_id, person_name, expiry_date) values ('REG01', 'Reg Person', current_date + 400);
set role authenticated;
select regulatory_update_save('{"title":"All","category":"Labour","legal_status":"ENACTED","evidence_level":"E2","official_url":"https://mohre.gov.ae/x"}') as u3 \gset
select regulatory_start_review(:'u3');
select regulatory_update_save(jsonb_build_object('id', :'u3', 'effective_date', (current_date + 10)::text, 'applicability', '{"has_visa":true}'::jsonb));
select regulatory_propose_list(:'u3');
reset role;
select t.ok('has_visa keeps a visa holder', (select count(*) = 1 from regulatory_update_clients where update_id = :'u3' and client_id = 'REG01'));
select t.ok('has_visa drops a client with none', (select count(*) = 0 from regulatory_update_clients where update_id = :'u3' and client_id = 'REG02'));
set role authenticated;
select regulatory_update_save(jsonb_build_object('id', :'u3', 'applicability', '{"all_clients":true}'::jsonb));
select regulatory_propose_list(:'u3');
reset role;
select t.ok('all clients leaves out closed ones', (select count(*) = 0 from regulatory_update_clients where update_id = :'u3' and client_id = 'REG03'));
select t.ok('re-proposing replaces the list', (select count(*) >= 3 from regulatory_update_clients where update_id = :'u3'));

-- Intake is always a Draft.
select regulatory_update_intake('{"title":"From agent","category":"Tax","workflow_status":"Verified","verified_at":"2026-01-01","legal_status":"ENACTED","evidence_level":"E1"}') as u4 \gset
select t.ok('intake is always a Draft from the Tax Agent', (select workflow_status = 'Draft' and source = 'Tax Agent' and verified_at is null from regulatory_updates where id = :'u4'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select t.fails('the browser cannot call intake', $q$select regulatory_update_intake('{"title":"x","category":"Tax"}')$q$, 'permission denied');
select t.fails('tables are closed to the browser', $q$select * from regulatory_updates$q$, 'permission denied');
reset test.uid;
reset role;
