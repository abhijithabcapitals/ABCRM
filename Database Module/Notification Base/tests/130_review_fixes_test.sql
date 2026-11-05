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

reset role;
reset test.uid;
update alert_settings set value = '"Live"' where key = 'alert_mode';
