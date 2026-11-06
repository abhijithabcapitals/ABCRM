-- The review's fixes (migration 015). Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

\set mem '00000000-0000-0000-0000-000000013001'
\set own '00000000-0000-0000-0000-000000013002'
\set adm '00000000-0000-0000-0000-000000013003'
\set tab '00000000-0000-0000-0000-000000013004'
select (now() at time zone 'Asia/Dubai')::date as today \gset

insert into profiles (id, full_name, email, role) values
  (:'mem', 'Review Member', 'mem@x.test', 'member'), (:'own', 'Review Owner', 'own@x.test', 'member'),
  (:'adm', 'Review Admin', 'adm@x.test', 'admin'), (:'tab', 'Review Tab', 'tab@x.test', 'member');
insert into member_tab_access (profile_id, tab_key) values (:'tab', 'clients');
insert into client_master (client_id, legal_name, data) values
  ('W1', 'Work One', '{}'), ('W2', 'Work Two', '{}'), ('W3', 'Work Three', '{}'), ('W4', 'Work Four', '{}'), ('W5', 'Work Five', '{}'), ('W6', 'Work Closed', '{}'), ('W7', 'Work Seven', '{}');
insert into business_setup_kyc_profiles (client_id, client_status, jurisdiction, licence_extras) values
  ('W1', 'Active', 'DMCC', '{}'), ('W2', 'Active', 'DMCC', '{}'), ('W3', 'Active', 'DMCC', '{}'), ('W4', '  ', ' dMcC ', '{}'), ('W5', 'Active', 'DMCC', '{}'),
  ('W6', 'Liquidated', 'DMCC', '{"ct_reg":"Done"}'), ('W7', ' ACTIVE ', 'DMCC', '{}');
insert into client_owners (client_id, department, owner_id) values ('W3', 'Business Setup', :'own'), ('W5', 'Business Setup', :'own');

-- Builds an update at List proposed, with every Check decided, as the caller.
create function t.reg_ready(p_status text, p_evidence text) returns uuid language plpgsql as $$
declare v_id uuid; c jsonb;
begin
  v_id := regulatory_update_save(jsonb_build_object('title', 'Review ' || p_status, 'category', 'Tax', 'legal_status', p_status, 'evidence_level', p_evidence, 'official_url', 'https://tax.gov.ae/r'));
  perform regulatory_start_review(v_id);
  perform regulatory_update_save(jsonb_build_object('id', v_id, 'effective_date', (current_date + 30)::text, 'applicability', '{"jurisdictions":["DMCC"]}'::jsonb));
  perform regulatory_propose_list(v_id);
  for c in select e from jsonb_array_elements(regulatory_detail(v_id)->'clients') e where e->>'decision' = 'Check' loop
    perform regulatory_decide_client(v_id, c->>'client_id', 'Does not apply');
  end loop;
  return v_id;
end $$;

-- ── C1: client work needs the Clients access or an open alert on that client ─────────────
insert into client_document_requests (client_id, what, due_on) values ('W1', 'W1 papers', current_date + 9) returning id as rq1 \gset
insert into client_document_requests (client_id, what, due_on) values ('W2', 'W2 papers', current_date + 9) returning id as rq2 \gset
update alert_settings set value = '"Triage"' where key = 'alert_mode';
set role authenticated;
set test.uid = :'mem';
select t.fails('no access: contact refused', $q$select client_contact_log('{"client_id":"W1"}')$q$, 'permission');
select t.fails('no access: request refused', $q$select client_document_request('{"client_id":"W1","what":"x"}')$q$, 'permission');
select t.fails('no access: list refused', $q$select client_work_list('W1')$q$, 'permission');
select t.fails('no access: logged item refused', $q$select alert_manual_raise('Complaint', 'W1')$q$, 'permission');
select t.fails('no access: answering refused, as for a request that is not there', format($q$select client_document_answered(%L)$q$, :'rq1'), 'That request is not open');
select t.fails('a missing request reads the same', $q$select client_document_answered('00000000-0000-0000-0000-00000000dead')$q$, 'That request is not open');
select t.fails('no access: an unknown client says nothing about existence', $q$select client_work_list('NOPE')$q$, 'permission');
select t.fails('the check itself is internal', $q$select client_work_can('W1')$q$, 'permission denied');
reset role;
select t.ok('nothing was written', (select count(*) = 0 from client_contacts where client_id = 'W1') and (select status = 'Open' from client_document_requests where id = :'rq1'));
select alert_raise('manual_client_activity', 'review:c1', 'W1', 'Review', 'Business Setup', current_date + 5, 0, 'High', :'mem', 'client_master', 'W1') as c1a \gset
set role authenticated;
select t.ok('a recipient of an open alert may read the work', client_work_list('W1') ? 'contacts');
select t.ok('a recipient may log a contact', client_contact_log('{"client_id":"W1","channel":"Call"}') is not null);
select t.ok('a recipient may log a request', client_document_request('{"client_id":"W1","what":"More"}') is not null);
select t.ok('a recipient may log an item', alert_manual_raise('Complaint', 'W1') is not null);
select client_document_answered(:'rq1');
select t.fails('another client stays refused: list', $q$select client_work_list('W2')$q$, 'permission');
select t.fails('another client stays refused: contact', $q$select client_contact_log('{"client_id":"W2"}')$q$, 'permission');
select t.fails('another client stays refused: request', $q$select client_document_request('{"client_id":"W2","what":"x"}')$q$, 'permission');
select t.fails('another client stays refused: item', $q$select alert_manual_raise('Complaint', 'W2')$q$, 'permission');
select t.fails('another client stays refused: answering', format($q$select client_document_answered(%L)$q$, :'rq2'), 'That request is not open');
reset role;
update alerts set status = 'Resolved', resolved_at = now() where client_id = 'W1' and rule_code = 'manual_client_activity';
set role authenticated;
select t.fails('access ends when the alerts close', $q$select client_work_list('W1')$q$, 'permission');
set test.uid = :'tab';
select t.ok('the Clients tab still reads any client', client_work_list('W2') ? 'contacts');
select client_document_answered(:'rq2');
set test.uid = :'adm';
select t.ok('an admin still reads any client', client_work_list('W2') ? 'contacts');
reset role;
reset test.uid;

-- ── Register rules' baseline, duplicates and locked fields (I1, I5) ──────────────────────
select count(*) as bells0 from notifications where user_id = :'own' and type = 'alert_centre' \gset
set role authenticated;
set test.uid = :'adm';
select client_compliance_import(jsonb_build_array(
  jsonb_build_object('client_id', 'W3', 'item_type', 'Passport', 'person_name', 'Base One', 'expiry_date', (current_date + 25)::text),
  jsonb_build_object('client_id', 'W3', 'item_type', 'Ejari', 'expiry_date', (current_date - 5)::text),
  jsonb_build_object('client_id', 'W3', 'item_type', 'Work permit', 'person_name', 'Far One', 'expiry_date', (current_date + 400)::text))) as imp1 \gset
reset role;
select t.ok('import saved its rows flagged', (:'imp1'::jsonb->>'saved')::int = 3 and (select bool_and(baseline_pending) and count(*) = 3 from client_compliance_items where client_id = 'W3'));
select public.alert_scan() as s1 \gset
select t.ok('the scan after an import is clean', (:'s1'::jsonb)->>'status' = 'Ok');
select t.ok('an imported row raises as backlog', (select count(*) = 2 and bool_and(backlog) from alerts where client_id = 'W3' and source_table = 'client_compliance_items'));
select t.ok('an import in Triage writes no bell', (select count(*) = :bells0 from notifications where user_id = :'own' and type = 'alert_centre'));
select t.ok('the scan clears the flags of the rows it saw', (select count(*) = 0 from client_compliance_items where client_id = 'W3' and baseline_pending));
update alert_settings set value = '"Live"' where key = 'alert_mode';
select public.alert_scan();
select t.ok('imported rows do not escalate, even overdue in Live', (select count(*) = 2 and bool_and(escalation_level = 0 and backlog) from alerts where client_id = 'W3' and source_table = 'client_compliance_items'));
select t.ok('nor do they bell in Live', (select count(*) = :bells0 from notifications where user_id = :'own' and type = 'alert_centre'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';
update alerts set current_step = 60 where client_id = 'W3' and rule_code = 'compliance_passport';
select public.alert_scan();
select t.ok('a later step crossing clears backlog', (select not backlog from alerts where client_id = 'W3' and rule_code = 'compliance_passport'));
select t.ok('and rings the bell', (select count(*) = :bells0 + 1 from notifications where user_id = :'own' and type = 'alert_centre'));
update client_compliance_items set expiry_date = current_date + 25 where client_id = 'W3' and item_type = 'Work permit';
select public.alert_scan();
select t.ok('an imported row outside any step raises normally when it comes due', (select not backlog from alerts where client_id = 'W3' and rule_code = 'compliance_work_permit' and status = 'Open'));
select t.ok('with its bell', (select count(*) = :bells0 + 2 from notifications where user_id = :'own' and type = 'alert_centre'));
set role authenticated;
set test.uid = :'adm';
select client_compliance_save(jsonb_build_object('client_id', 'W3', 'item_type', 'Emirates ID', 'person_name', 'Saved One', 'expiry_date', (current_date + 25)::text)) as e1 \gset
reset role;
select t.ok('a row saved by hand carries no flag', (select not baseline_pending from client_compliance_items where id = :'e1'));
select public.alert_scan();
select t.ok('and raises with its bell', (select not backlog from alerts where source_id = :'e1') and (select count(*) = :bells0 + 3 from notifications where user_id = :'own' and type = 'alert_centre'));

-- Duplicates.
set role authenticated;
set test.uid = :'adm';
select t.fails('a second Active row for the same person and date is refused', format($q$select client_compliance_save(jsonb_build_object('client_id', 'W3', 'item_type', 'Emirates ID', 'person_name', ' saved one ', 'expiry_date', %L))$q$, (current_date + 25)::text), 'already on the register');
select client_compliance_import(jsonb_build_array(
  jsonb_build_object('client_id', 'W3', 'item_type', 'Passport', 'person_name', 'Base One', 'expiry_date', (current_date + 25)::text),
  jsonb_build_object('client_id', 'W3', 'item_type', 'Ejari', 'expiry_date', (current_date - 5)::text))) as imp2 \gset
select t.ok('importing the same file twice reports duplicates per row', (:'imp2'::jsonb->>'saved')::int = 0 and jsonb_array_length(:'imp2'::jsonb->'errors') = 2 and :'imp2'::jsonb->'errors'->1->>'row' = '2' and :'imp2'::jsonb->'errors'->0->>'error' like '%already on the register%');
select t.ok('saving a row again is not a duplicate of itself', client_compliance_save(jsonb_build_object('id', :'e1', 'notes', 'Same row')) = :'e1');
select t.ok('another person is not a duplicate', client_compliance_save(jsonb_build_object('client_id', 'W3', 'item_type', 'Emirates ID', 'person_name', 'Other One', 'expiry_date', (current_date + 25)::text)) is not null);
select client_compliance_close(:'e1', 'Replaced');
select t.ok('a closed row does not block a new one', client_compliance_save(jsonb_build_object('client_id', 'W3', 'item_type', 'Emirates ID', 'person_name', 'Saved One', 'expiry_date', (current_date + 25)::text)) is not null);

reset role;
reset test.uid;

-- ── I1: a newly enabled rule ─────────────────────────────────────────────────────────────
select public.alert_scan();   -- the rows saved by hand above raise their own bells first
insert into client_contacts (client_id, channel, contacted_on) values ('W3', 'Call', :'today'::date - 200);
select steps as nc_steps from alert_rules where code = 'client_not_contacted' \gset
set role authenticated;
set test.uid = :'adm';
select alert_rule_save('client_not_contacted', true, :'nc_steps'::jsonb);
reset role;
reset test.uid;
select t.ok('enabling a rule flags it', (select baseline_pending from alert_rules where code = 'client_not_contacted'));
select count(*) as bells1 from notifications where user_id = :'own' and type = 'alert_centre' \gset
select public.alert_scan();
select t.ok('its first run raises as backlog', (select bool_and(backlog) and count(*) = 1 from alerts where rule_code = 'client_not_contacted' and client_id = 'W3' and status = 'Open'));
select t.ok('with no bell', (select count(*) = :bells1 from notifications where user_id = :'own' and type = 'alert_centre'));
select t.ok('the scan clears the rule flag', (select not baseline_pending from alert_rules where code = 'client_not_contacted'));
update alerts set current_step = 99 where rule_code = 'client_not_contacted' and client_id = 'W3' and status = 'Open';
select public.alert_scan();
select t.ok('a later step crossing bells', (select count(*) = :bells1 + 1 from notifications where user_id = :'own' and type = 'alert_centre') and (select not backlog from alerts where rule_code = 'client_not_contacted' and client_id = 'W3' and status = 'Open'));
set role authenticated;
set test.uid = :'adm';
select alert_rule_save('client_not_contacted', true, :'nc_steps'::jsonb);
reset role;
reset test.uid;
select t.ok('saving a rule already on leaves it unflagged', (select not baseline_pending from alert_rules where code = 'client_not_contacted'));
-- A rule that fails keeps its flag, so its first good run is still a baseline.
update alert_rules set baseline_pending = true where code = 'client_not_contacted';
alter function public.alert_rule_client_not_contacted() rename to alert_rule_client_not_contacted_away;
select public.alert_scan();
alter function public.alert_rule_client_not_contacted_away() rename to alert_rule_client_not_contacted;
select t.ok('a rule that failed keeps its flag', (select baseline_pending from alert_rules where code = 'client_not_contacted'));
update alert_rules set baseline_pending = false where code = 'client_not_contacted';
update alert_rules set enabled = false where code = 'client_not_contacted';

-- ── I2, I3, I4: regulatory ───────────────────────────────────────────────────────────────
set role authenticated;
set test.uid = :'adm';
select t.fails('a javascript: source is refused on create', $q$select regulatory_update_save('{"title":"x","category":"Tax","official_url":"javascript:alert(1)"}')$q$, 'https://');
select t.fails('a plain http source is refused on create', $q$select regulatory_update_save('{"title":"x","category":"Tax","official_url":"http://tax.gov.ae/x"}')$q$, 'https://');
select t.reg_ready('ENACTED', 'E1') as r1 \gset
select t.fails('a javascript: source is refused on edit', format($q$select regulatory_update_save(jsonb_build_object('id', %L, 'official_url', 'javascript:alert(1)'))$q$, :'r1'), 'https://');
select t.ok('a blank source may be saved', regulatory_update_save(jsonb_build_object('id', :'r1', 'official_url', '')) = :'r1');
select regulatory_update_save(jsonb_build_object('id', :'r1', 'official_url', 'https://tax.gov.ae/r'));
reset role;
select t.fails('the Tax Agent intake refuses it too', $q$select regulatory_update_intake('{"title":"x","category":"Tax","official_url":"ftp://x"}')$q$, 'https://');
update regulatory_updates set official_url = 'javascript:alert(1)' where id = :'r1';
set role authenticated;
select t.fails('verify refuses a stored source that is not https', format($q$select regulatory_verify(%L)$q$, :'r1'), 'https://');
reset role;
update regulatory_updates set official_url = 'https://tax.gov.ae/r', evidence_level = 'E3' where id = :'r1';
set role authenticated;
select t.fails('E3 cannot be verified', format($q$select regulatory_verify(%L)$q$, :'r1'), 'E1 or E2');
reset role;
update regulatory_updates set evidence_level = 'E4' where id = :'r1';
set role authenticated;
select t.fails('E4 stays information only', format($q$select regulatory_verify(%L)$q$, :'r1'), 'third-party');
reset role;
update regulatory_updates set evidence_level = 'E1' where id = :'r1';
do $$
declare s text; v_id uuid := (select id from regulatory_updates where title = 'Review ENACTED' order by created_at desc limit 1);
begin
  foreach s in array array['ANNOUNCED', 'SUPERSEDED', 'REPEALED', 'UNCERTAIN', 'PROPOSED', 'UNDER CONSULTATION', 'UNVERIFIED'] loop
    update regulatory_updates set legal_status = s where id = v_id;
    set local test.uid = '00000000-0000-0000-0000-000000013003';
    perform t.fails(s || ' cannot be verified', format('select regulatory_verify(%L)', v_id), 'stays information only');
  end loop;
  update regulatory_updates set legal_status = 'ENACTED' where id = v_id;
end $$;
set role authenticated;
select regulatory_verify(:'r1');
reset role;
select t.ok('ENACTED with E1 verifies, and still closes the new-update alert', (select workflow_status = 'Verified' from regulatory_updates where id = :'r1') and (select status = 'Resolved' from alerts where dedupe_key = 'regulatory:new:' || :'r1'));
set role authenticated;
select t.reg_ready('IN FORCE', 'E2') as r2 \gset
select regulatory_verify(:'r2');
select t.reg_ready('PUBLISHED', 'E2') as r3 \gset
select regulatory_verify(:'r3');
select t.reg_ready('SCHEDULED', 'E1') as r4 \gset
select regulatory_verify(:'r4');
reset role;
select t.ok('IN FORCE, PUBLISHED and SCHEDULED verify', (select count(*) = 3 from regulatory_updates where id in (:'r2', :'r3', :'r4') and workflow_status = 'Verified'));

-- A list goes stale when what it was built from changes.
set role authenticated;
select t.reg_ready('ENACTED', 'E1') as r5 \gset
select regulatory_update_save(jsonb_build_object('id', :'r5', 'title', 'Reworded', 'effective_date', (current_date + 30)::text, 'applicability', '{"jurisdictions":["DMCC"]}'::jsonb));
reset role;
select t.ok('other edits keep the list', (select workflow_status = 'List proposed' from regulatory_updates where id = :'r5') and (select count(*) > 0 from regulatory_update_clients where update_id = :'r5'));
set role authenticated;
select regulatory_update_save(jsonb_build_object('id', :'r5', 'effective_date', (current_date + 31)::text));
reset role;
select t.ok('a new effective date drops the list and returns to review', (select workflow_status = 'Under review' from regulatory_updates where id = :'r5') and (select count(*) = 0 from regulatory_update_clients where update_id = :'r5'));
set role authenticated;
select regulatory_propose_list(:'r5');
select regulatory_update_save(jsonb_build_object('id', :'r5', 'applicability', '{"all_clients":true}'::jsonb));
reset role;
select t.ok('a new applicability drops the list and returns to review', (select workflow_status = 'Under review' from regulatory_updates where id = :'r5') and (select count(*) = 0 from regulatory_update_clients where update_id = :'r5'));

-- Matching ignores case and spaces; a blank status under a filter is Check.
set role authenticated;
select regulatory_update_save(jsonb_build_object('id', :'r5', 'applicability', '{"jurisdictions":[" DMCC"]}'::jsonb));
select regulatory_propose_list(:'r5');
reset role;
select t.ok('jurisdictions match lower-cased and trimmed', (select decision = 'Applies' from regulatory_update_clients where update_id = :'r5' and client_id = 'W4'));
set role authenticated;
select regulatory_update_save(jsonb_build_object('id', :'r5', 'applicability', '{"statuses":["active "]}'::jsonb));
select regulatory_propose_list(:'r5');
reset role;
select t.ok('statuses match lower-cased and trimmed', (select decision = 'Applies' from regulatory_update_clients where update_id = :'r5' and client_id = 'W7'));
select t.ok('a blank status under a statuses filter is Check', (select decision = 'Check' from regulatory_update_clients where update_id = :'r5' and client_id = 'W4'));

-- An empty list is refused and changes nothing. Every client needs a filled profile for that, so this runs in a transaction.
begin;
insert into business_setup_kyc_profiles (client_id, client_status, jurisdiction) select client_id, 'Active', 'ELSEWHERE' from client_master on conflict (client_id) do update set client_status = coalesce(nullif(btrim(business_setup_kyc_profiles.client_status), ''), 'Active'), jurisdiction = 'ELSEWHERE';
update regulatory_updates set workflow_status = 'Under review', applicability = '{"jurisdictions":["NOWHERE"]}' where id = :'r5';
set local role authenticated;
select t.fails('an empty list is refused in a plain sentence', format($q$select regulatory_propose_list(%L)$q$, :'r5'), 'No client matches');
reset role;
select t.ok('the status stays as it was', (select workflow_status = 'Under review' from regulatory_updates where id = :'r5'));
rollback;

-- ── I5: locked fields
set role authenticated;
set test.uid = :'adm';
select t.fails('the client of an entry cannot change', format($q$select client_compliance_save(jsonb_build_object('id', %L, 'client_id', 'W2'))$q$, :'e1'), 'Close this entry and add a new one');
select t.fails('the type of an entry cannot change', format($q$select client_compliance_save(jsonb_build_object('id', %L, 'item_type', 'Passport'))$q$, :'e1'), 'Close this entry and add a new one');
select t.ok('sending the same client and type is fine', client_compliance_save(jsonb_build_object('id', :'e1', 'client_id', 'W3', 'item_type', 'Emirates ID')) = :'e1');
reset role;
reset test.uid;

-- ── I6, I7: period keys and rolling rules ────────────────────────────────────────────────
select to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY-MM') as ym, to_char((now() at time zone 'Asia/Dubai')::date, 'YYYY') as yyyy,
       (date_trunc('month', (now() at time zone 'Asia/Dubai')::date) + interval '1 month - 1 day')::date as month_end,
       make_date(extract(year from (now() at time zone 'Asia/Dubai')::date)::int, 12, 31) as year_end \gset
select t.ok('the four rolling rules have one wide step, priority kept', (select count(*) = 4 and bool_and(jsonb_array_length(steps) = 1 and (steps->0->>'days')::int = 366) from alert_rules where code in ('multiple_services', 'client_not_contacted', 'client_inactive', 'ct_dereg_review'))
  and (select steps->0->>'priority' = 'Normal' from alert_rules where code = 'multiple_services') and (select steps->0->>'priority' = 'Medium' from alert_rules where code = 'ct_dereg_review'));
insert into business_setup_services (client_id, name, status, historical) values ('W5', 'Renewal', 'In progress', false), ('W5', 'Ejari Renewal', 'Not started', false), ('W6', 'Renewal', 'In progress', false), ('W6', 'Ejari Renewal', 'Not started', false);
update alert_rules set enabled = true where code in ('client_not_contacted', 'client_inactive', 'ct_dereg_review');
select public.alert_scan();
select t.ok('multiple services key has its month', (select count(*) = 1 from alerts where dedupe_key = 'multiservices:W5:' || :'ym' and status = 'Open'));
select t.ok('not contacted key has the last contact date', (select count(*) = 1 from alerts where dedupe_key = 'notcontacted:W3:' || (:'today'::date - 200)));
select t.ok('inactive key has the last contact date', (select count(*) = 1 from alerts where dedupe_key = 'inactive:W3:' || (:'today'::date - 200)));
select t.ok('CT deregistration key has its year', (select count(*) = 1 from alerts where dedupe_key = 'ctdereg:W6:' || :'yyyy'));
select t.ok('monthly rules are due at the end of the month', (select bool_and(due_date = :'month_end') and count(*) = 3 from alerts where dedupe_key in ('multiservices:W5:' || :'ym', 'notcontacted:W3:' || (:'today'::date - 200), 'inactive:W3:' || (:'today'::date - 200))));
select t.ok('the CT rule is due at the end of the year', (select due_date = :'year_end' from alerts where dedupe_key = 'ctdereg:W6:' || :'yyyy'));
select t.ok('they raise on the wide step', (select bool_and(current_step = 366) from alerts where status = 'Open' and rule_code in ('multiple_services', 'client_not_contacted', 'client_inactive', 'ct_dereg_review')));
-- A person closes the not contacted alert; a later contact that also lapses raises a new one.
update alerts set status = 'Resolved', resolved_at = now(), resolved_by = :'adm' where dedupe_key = 'notcontacted:W3:' || (:'today'::date - 200);
select public.alert_scan();
select t.ok('a person''s close holds for that contact date', (select status = 'Resolved' and not resolved_by_system from alerts where dedupe_key = 'notcontacted:W3:' || (:'today'::date - 200)));
insert into client_contacts (client_id, channel, contacted_on) values ('W3', 'Call', :'today'::date - 150);
select public.alert_scan();
select t.ok('a later lapse raises again', (select status = 'Open' from alerts where dedupe_key = 'notcontacted:W3:' || (:'today'::date - 150)));

-- What 015 does to open alerts on live: old keys move, steps move, no bell and no new row.
update alerts set dedupe_key = 'multiservices:W5', current_step = 0, due_date = :'today' where dedupe_key = 'multiservices:W5:' || :'ym' returning id as ms_id \gset
update alert_rules set steps = '[{"days":0,"priority":"Normal"}]' where code = 'multiple_services';
select count(*) as bells2 from notifications where type = 'alert_centre' \gset
\ir ../migrations/018_register_and_rules.sql
select t.ok('015 moves an open alert to its period key', (select dedupe_key = 'multiservices:W5:' || :'ym' and current_step = 366 and due_date = :'month_end' from alerts where id = :'ms_id'));
select t.ok('015 replaces a seed that is unedited', (select steps = '[{"days":366,"priority":"Normal"}]'::jsonb from alert_rules where code = 'multiple_services'));
select public.alert_scan();
select t.ok('the next scan neither re-raises nor bells', (select status = 'Open' from alerts where id = :'ms_id') and (select count(*) = 1 from alerts where client_id = 'W5' and rule_code = 'multiple_services') and (select count(*) = :bells2 from notifications where type = 'alert_centre'));
update alert_rules set steps = '[{"days":5,"priority":"High"}]' where code = 'client_inactive';
\ir ../migrations/018_register_and_rules.sql
select t.ok('015 leaves edited steps alone', (select steps = '[{"days":5,"priority":"High"}]'::jsonb from alert_rules where code = 'client_inactive'));
update alert_rules set steps = '[{"days":366,"priority":"Medium"}]' where code = 'client_inactive';
update alert_rules set enabled = false where code in ('client_not_contacted', 'client_inactive', 'ct_dereg_review');

-- ── Minors: rule filters, invoices, titles, table grant, rule codes ──────────────────────
select t.ok('closed client: no multiple services alert', (select count(*) = 0 from alerts where rule_code = 'multiple_services' and client_id = 'W6'));
insert into client_contacts (client_id, channel, contacted_on, follow_up_on) values ('W6', 'Call', current_date - 3, current_date - 1);
insert into client_document_requests (client_id, what, due_on) values ('W6', 'Closed papers', current_date - 1);
insert into accounting_job_list (client_id, client_name, service_name, service_department, work_status, next_follow_up_on, invoice_date, balance) values
  ('W6', 'Work Closed', 'Closed job', 'Accounting', 'In Progress', current_date - 1, current_date - 40, 100),
  ('W5', 'Work Five', 'No status job', 'Accounting', null, current_date - 1, current_date - 40, 100),
  ('W2', 'Work Two', 'Cancelled job', 'Accounting', 'Client Cancelled', current_date - 1, current_date - 40, 100),
  ('W1', 'Work One', 'Completed job', 'Accounting', 'Completed', current_date - 1, current_date - 40, 100);
insert into business_setup_invoices (client_id, quote_id, invoice_number, issued_on, amount) values
  ('W5', '00000000-0000-0000-0000-00000001f001', 'OLD-1', current_date - 50, 1000),
  ('W5', '00000000-0000-0000-0000-00000001f001', 'NEW-2', current_date - 40, 1000),
  ('W4', '00000000-0000-0000-0000-00000001f002', 'A-1', current_date - 50, 500),
  ('W4', '00000000-0000-0000-0000-00000001f002', 'A-2', current_date - 45, 500),
  ('W4', '00000000-0000-0000-0000-00000001f002', 'A-3', current_date - 40, 500),
  ('W6', '00000000-0000-0000-0000-00000001f003', 'CL-1', current_date - 50, 1000);
insert into stub_net_paid (quote_id, amount) values ('00000000-0000-0000-0000-00000001f001', 1000), ('00000000-0000-0000-0000-00000001f002', 700);
select public.alert_scan();
select t.ok('only the newest invoice past net paid raises', (select count(*) = 1 and bool_and(subject like 'NEW-2%') from alerts where rule_code = 'setup_invoice_due' and client_id = 'W5' and status = 'Open'));
select t.ok('worked back from the newest, a part-covered invoice still raises', (select count(*) = 2 and bool_and(subject like 'A-2%' or subject like 'A-3%') from alerts where rule_code = 'setup_invoice_due' and client_id = 'W4' and status = 'Open'));
select t.ok('closed client: no invoice alert', (select count(*) = 0 from alerts where rule_code = 'setup_invoice_due' and client_id = 'W6'));
select t.ok('closed client: no contact follow-up', (select count(*) = 0 from alerts where rule_code = 'contact_followup' and client_id = 'W6'));
select t.ok('closed client: no job follow-up', (select count(*) = 0 from alerts where rule_code = 'job_followup' and client_id = 'W6'));
select t.ok('closed client: no document chase', (select count(*) = 0 from alerts where rule_code = 'document_request' and client_id = 'W6'));
select t.ok('a job with no status still follows up', (select count(*) = 1 from alerts where rule_code = 'job_followup' and client_id = 'W5' and status = 'Open'));
select t.ok('a job with no status still chases payment', (select count(*) = 1 from alerts where rule_code = 'job_payment_due' and client_id = 'W5' and status = 'Open'));
select t.ok('a cancelled job chases no payment', (select count(*) = 0 from alerts where rule_code = 'job_payment_due' and client_id = 'W2'));
select t.ok('a completed job with a balance chases payment', (select count(*) = 1 from alerts where rule_code = 'job_payment_due' and client_id = 'W1' and status = 'Open'));
select t.ok('titles join names with concat_ws', (select bool_and(pg_get_functiondef(f) like '%concat_ws(%') from unnest(array['alert_manual_raise(text,text,text,date)', 'alert_rule_document_request()', 'alert_rule_tax_deadline()', 'regulatory_create_tasks(uuid)']::regprocedure[]) f));
select t.ok('the browser may not read the register table', not has_table_privilege('authenticated', 'public.client_compliance_items', 'select'));
set role authenticated;
set test.uid = :'adm';
select t.fails('workflow rules cannot be saved: regulatory', $q$select alert_rule_save('regulatory_new', true, '[{"days":1,"priority":"High"}]')$q$, 'cannot be changed here');
select t.fails('workflow rules cannot be saved: manual', $q$select alert_rule_save('manual_tax', true, '[{"days":1,"priority":"High"}]')$q$, 'cannot be changed here');
reset role;
reset test.uid;

reset role;
reset test.uid;
update alert_settings set value = '"Live"' where key = 'alert_mode';
