-- The "new update" alert closes when its update is verified. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

update alert_settings set value = '"Live"' where key = 'alert_mode';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select regulatory_update_save('{"title":"Close check","category":"Tax","legal_status":"ENACTED","evidence_level":"E1","official_url":"https://tax.gov.ae/x"}') as u \gset
select regulatory_start_review(:'u');
select regulatory_update_save(jsonb_build_object('id', :'u', 'effective_date', (current_date + 30)::text, 'applicability', '{"jurisdictions":["DMCC"]}'::jsonb));
select regulatory_propose_list(:'u');
reset role;
select t.ok('it stays open through review', (select status = 'Open' from alerts where dedupe_key = 'regulatory:new:' || :'u'));
update regulatory_update_clients set decision = 'Does not apply' where update_id = :'u' and decision = 'Check';
set role authenticated;
select regulatory_verify(:'u');
reset role;
select t.ok('verifying closes the new-update alert', (select status = 'Resolved' and resolved_at is not null and resolved_by = '00000000-0000-0000-0000-0000000000b1' and not resolved_by_system from alerts where dedupe_key = 'regulatory:new:' || :'u'));
select t.ok('its note says why', (select resolution_note = 'Update verified by a manager.' from alerts where dedupe_key = 'regulatory:new:' || :'u'));
select t.ok('its history records it', (select count(*) = 1 from alert_events e join alerts a on a.id = e.alert_id where a.dedupe_key = 'regulatory:new:' || :'u' and e.event = 'resolved'));
select t.ok('verifying still works as before', (select workflow_status = 'Verified' and verified_at is not null from regulatory_updates where id = :'u'));
set role authenticated;
select t.ok('client tasks still follow', regulatory_create_tasks(:'u') >= 1);
reset role;
select t.ok('client tasks stay open', (select bool_and(status = 'Open') from alerts where regulatory_update_id = :'u' and rule_code = 'regulatory_impact'));
select t.ok('the update does not close while tasks are open', (select workflow_status = 'Tasks created' from regulatory_updates where id = :'u'));

-- A refused verify closes nothing.
set role authenticated;
select regulatory_update_save('{"title":"Refused check","category":"Tax","legal_status":"PROPOSED","evidence_level":"E1","official_url":"https://tax.gov.ae/y"}') as v \gset
select regulatory_start_review(:'v');
select regulatory_update_save(jsonb_build_object('id', :'v', 'effective_date', (current_date + 30)::text, 'applicability', '{"jurisdictions":["DMCC"]}'::jsonb));
select regulatory_propose_list(:'v');
select t.fails('a proposal is still refused', format($q$select regulatory_verify(%L)$q$, :'v'), 'not yet law');
reset role;
select t.ok('a refused verify leaves the alert open', (select status = 'Open' from alerts where dedupe_key = 'regulatory:new:' || :'v'));
reset test.uid;
