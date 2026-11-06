-- Phase 3: service notifications from the Business Setup checklists. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000b301', 'Svc owner', 'member'), ('00000000-0000-0000-0000-00000000b302', 'Item owner', 'member')
on conflict (id) do nothing;
insert into client_master (client_id, legal_name, data) values ('S1', 'Svc One', '{}'), ('S2', 'Svc Closed', '{}'), ('S3', 'Svc Renew', '{}') on conflict do nothing;
insert into business_setup_kyc_profiles (client_id, client_status, licence_expiry) values ('S1', 'Active', current_date + 400), ('S2', 'Liquidated', null), ('S3', 'Active', current_date + 20)
on conflict do nothing;
update alert_settings set value = '"Triage"' where key = 'alert_mode';
select t.ok('the rules ship switched off', (select count(*) = 8 and bool_and(not enabled) from alert_rules where code in ('checkpoint_due', 'checkpoint_client', 'checkpoint_authority', 'checkpoint_stale', 'service_expected', 'service_delayed', 'renewal_not_started', 'closure_pending')));
update alert_rules set enabled = true where code in ('checkpoint_due', 'checkpoint_client', 'checkpoint_authority', 'checkpoint_stale', 'service_expected', 'service_delayed', 'renewal_not_started', 'closure_pending');

-- A started service with a plan, and its checklist.
insert into business_setup_services (id, client_id, name, status, historical, owner_id, started_at, expected_completion) values
  ('00000000-0000-0000-0000-0000000005a1', 'S1', 'Mainland Company Formation', 'In progress', false, '00000000-0000-0000-0000-00000000b301', now() - interval '20 days', current_date + 5),
  ('00000000-0000-0000-0000-0000000005a2', 'S2', 'Closed client service', 'In progress', false, '00000000-0000-0000-0000-00000000b301', now() - interval '20 days', current_date + 5),
  ('00000000-0000-0000-0000-0000000005a3', 'S1', 'Visa Registration', 'In progress', false, '00000000-0000-0000-0000-00000000b301', now() - interval '20 days', current_date - 5);
insert into stub_progress (service_id, done) values ('00000000-0000-0000-0000-0000000005a1', 10);
insert into business_setup_service_checkpoints (id, service_id, sort_order, label, requirement, status, assigned_to, due_date, started_at) values
  ('00000000-0000-0000-0000-0000000006a1', '00000000-0000-0000-0000-0000000005a1', 1, 'Client requirements received', 'Mandatory', 'In Progress', '00000000-0000-0000-0000-00000000b302', current_date - 2, now() - interval '10 days'),
  ('00000000-0000-0000-0000-0000000006a2', '00000000-0000-0000-0000-0000000005a1', 2, 'Passport / Emirates ID collected', 'Mandatory', 'Pending Client', null, null, now() - interval '9 days'),
  ('00000000-0000-0000-0000-0000000006a3', '00000000-0000-0000-0000-0000000005a1', 3, 'Initial approval obtained', 'Mandatory', 'Pending Authority', null, current_date + 2, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000006a4', '00000000-0000-0000-0000-0000000005a1', 4, 'Trade name approved', 'Mandatory', 'Not Started', null, null, null),
  ('00000000-0000-0000-0000-0000000006a5', '00000000-0000-0000-0000-0000000005a1', 5, 'Office layout chosen', 'Optional', 'Not Started', null, null, null),
  ('00000000-0000-0000-0000-0000000006a6', '00000000-0000-0000-0000-0000000005a1', 6, 'Final documents delivered', 'Mandatory', 'Completed', null, current_date - 10, null),
  ('00000000-0000-0000-0000-0000000006a7', '00000000-0000-0000-0000-0000000005a2', 1, 'Trade name approved', 'Mandatory', 'In Progress', null, current_date - 4, null);
insert into business_setup_cases (id, case_number, client_id, stage, owner_id, updated_at) values
  ('00000000-0000-0000-0000-0000000007a1', 'BS-TEST-1', 'S1', 'Completion', '00000000-0000-0000-0000-00000000b301', now() - interval '5 days');

select public.alert_scan() as scan \gset
select t.ok('the scan is clean', (:'scan'::jsonb)->>'status' = 'Ok');
select t.ok('an overdue item raises High to its own assignee, naming item, service and client',
  (select priority = 'High' and assigned_to = '00000000-0000-0000-0000-00000000b302' and title like '%Client requirements received - Mainland Company Formation - Svc One%' and service_id = '00000000-0000-0000-0000-0000000005a1'
   from alerts where rule_code = 'checkpoint_due' and source_id = '00000000-0000-0000-0000-0000000006a1'));
select t.ok('an item waiting on the client is a Client Documents alert to the service owner, High once past a week',
  (select category = 'Client Documents' and priority = 'High' and assigned_to = '00000000-0000-0000-0000-00000000b301' from alerts where rule_code = 'checkpoint_client'));
select t.ok('an item waiting on the authority is a Government Applications alert, High', (select category = 'Government Applications' and priority = 'High' from alerts where rule_code = 'checkpoint_authority'));
select t.ok('the authority item is not raised twice as a dated item', (select count(*) = 0 from alerts where rule_code = 'checkpoint_due' and source_id = '00000000-0000-0000-0000-0000000006a3'));
select t.ok('a named milestone still open after the stale days raises', (select count(*) = 1 from alerts where rule_code = 'checkpoint_stale' and source_id = '00000000-0000-0000-0000-0000000006a4'));
select t.ok('an unnamed open item does not', (select count(*) = 0 from alerts where source_id = '00000000-0000-0000-0000-0000000006a5'));
select t.ok('a completed item raises nothing', (select count(*) = 0 from alerts where source_id = '00000000-0000-0000-0000-0000000006a6'));
select t.ok('a closed client raises nothing', (select count(*) = 0 from alerts where source_id = '00000000-0000-0000-0000-0000000006a7' or (client_id = 'S2' and rule_code in ('service_expected', 'service_delayed', 'checkpoint_stale'))));
select t.ok('a service near its date raises High', (select priority = 'High' from alerts where rule_code = 'service_expected' and source_id = '00000000-0000-0000-0000-0000000005a1'));
select t.ok('imported Visa Registration services raise no scan alert', (select count(*) = 0 from alerts where source_id = '00000000-0000-0000-0000-0000000005a3' and rule_code not in ('service_assigned', 'service_completed')));
select t.ok('a service behind plan raises, with its figures', (select title like '%10% done%' and priority = 'High' from alerts where rule_code = 'service_delayed'));
select t.ok('a licence near expiry with no renewal service raises', (select priority = 'High' from alerts where rule_code = 'renewal_not_started' and client_id = 'S3'));
select t.ok('a licence far off raises no renewal alert', (select count(*) = 0 from alerts where rule_code = 'renewal_not_started' and client_id = 'S1'));
select t.ok('a case at Completion raises a closure alert to its owner', (select assigned_to = '00000000-0000-0000-0000-00000000b301' from alerts where rule_code = 'closure_pending'));
select count(*) as n_after_first from alerts \gset
select public.alert_scan();
select t.ok('a second scan adds nothing', (select count(*) = :n_after_first from alerts));

-- Starting a renewal clears that alert; finishing items clears theirs.
insert into business_setup_services (client_id, name, status, historical) values ('S3', 'Trade License Renewal', 'Not started', false);
update business_setup_service_checkpoints set status = 'Completed' where id = '00000000-0000-0000-0000-0000000006a1';
update business_setup_service_checkpoints set status = 'In Progress' where id = '00000000-0000-0000-0000-0000000006a2';
select public.alert_scan();
select t.ok('a renewal service closes the renewal alert', (select bool_and(status = 'Resolved') from alerts where rule_code = 'renewal_not_started' and client_id = 'S3'));
select t.ok('a finished item closes its alert', (select bool_and(status = 'Resolved') from alerts where source_id = '00000000-0000-0000-0000-0000000006a1'));
select t.ok('an item no longer waiting on the client closes that alert', (select bool_and(status = 'Resolved') from alerts where rule_code = 'checkpoint_client'));

-- Notices: assigned, milestone, completed. Each bells the owner once and closes at once.
select count(*) as bells0 from notifications where type = 'alert_centre' and user_id = '00000000-0000-0000-0000-00000000b302' \gset
update business_setup_services set owner_id = '00000000-0000-0000-0000-00000000b302' where id = '00000000-0000-0000-0000-0000000005a1';
select t.ok('a new owner gets one bell', (select count(*) = :bells0 + 1 from notifications where type = 'alert_centre' and user_id = '00000000-0000-0000-0000-00000000b302'));
select t.ok('the notice closes itself', (select bool_and(status = 'Resolved' and resolved_by_system) from alerts where rule_code = 'service_assigned'));
update business_setup_service_checkpoints set status = 'Completed' where id = '00000000-0000-0000-0000-0000000006a3';
select t.ok('a named milestone done sends a closed notice to the owner', (select count(*) = 1 and bool_and(status = 'Resolved' and assigned_to = '00000000-0000-0000-0000-00000000b302') from alerts where rule_code = 'milestone_reached'));
update business_setup_service_checkpoints set status = 'Completed' where id = '00000000-0000-0000-0000-0000000006a5';
select t.ok('an unnamed item done sends nothing', (select count(*) = 1 from alerts where rule_code = 'milestone_reached'));
update business_setup_services set status = 'Completed' where id = '00000000-0000-0000-0000-0000000005a1';
select t.ok('a completed service sends a closed notice', (select count(*) = 1 and bool_and(status = 'Resolved') from alerts where rule_code = 'service_completed'));
select public.alert_scan();
select t.ok('the scan leaves notices closed', (select bool_and(status = 'Resolved') from alerts where rule_code in ('service_assigned', 'milestone_reached', 'service_completed')));
select t.ok('a completed service closes its service alerts', (select bool_and(status = 'Resolved') from alerts where rule_code in ('service_expected', 'service_delayed', 'checkpoint_stale') and service_id = '00000000-0000-0000-0000-0000000005a1'));

-- Preview: notices stay silent, and a historical service sends nothing.
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select count(*) as bells1 from notifications where type = 'alert_centre' \gset
update business_setup_services set owner_id = '00000000-0000-0000-0000-00000000b301' where id = '00000000-0000-0000-0000-0000000005a2';
select t.ok('Preview sends no notice bell', (select count(*) = :bells1 from notifications where type = 'alert_centre'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';
update business_setup_services set owner_id = '00000000-0000-0000-0000-00000000b302' where id = '00000000-0000-0000-0000-0000000005a3';
insert into business_setup_services (client_id, name, status, historical, owner_id) values ('S1', 'Old import', 'Completed', true, '00000000-0000-0000-0000-00000000b302');
select t.ok('a historical service sends nothing', (select count(*) = 0 from alerts a where a.rule_code = 'service_assigned' and a.subject like 'Old import%'));

-- A failing notice never blocks a Business Setup save.
alter table alerts add constraint t_block_notices check (rule_code <> 'service_assigned') not valid;
update business_setup_services set owner_id = '00000000-0000-0000-0000-00000000b301' where id = '00000000-0000-0000-0000-0000000005a1';
select t.ok('the save went through though the notice failed', (select owner_id = '00000000-0000-0000-0000-00000000b301' from business_setup_services where id = '00000000-0000-0000-0000-0000000005a1'));
alter table alerts drop constraint t_block_notices;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000a1';
select t.fails('rule functions are closed to the browser', $q$select * from alert_rule_checkpoint_due()$q$, 'permission denied');
reset test.uid;
reset role;
update alert_settings set value = '"Live"' where key = 'alert_mode';
