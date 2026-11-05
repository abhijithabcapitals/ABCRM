-- Follow-ups, payments, items logged by hand, review dates, tax and relationship rules. Prints "ok ..." and stops at the first failure.
\set ON_ERROR_STOP on

insert into client_master (client_id, legal_name, data) values
  ('P1', 'Phase One', '{"License Issue Date":"10/06/2020"}'), ('P2', 'Phase Two', '{}'), ('P3', 'Phase Closed', '{}')
on conflict do nothing;
insert into business_setup_kyc_profiles (client_id, client_status, jurisdiction, licence_extras) values ('P1', 'Active', 'DMCC', '{}'), ('P2', 'Active', 'DMCC', '{}'), ('P3', 'Liquidated', 'DMCC', '{"ct_reg":"Done"}') on conflict do nothing;
update alert_settings set value = '"Triage"' where key = 'alert_mode';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000c1';
-- Contact log.
select client_contact_log(jsonb_build_object('client_id', 'P1', 'channel', 'Call', 'contacted_on', (current_date - 200)::text, 'follow_up_on', (current_date - 2)::text)) as c1 \gset
select t.fails('an unknown client is refused', $q$select client_contact_log('{"client_id":"NOPE"}')$q$, 'Unknown client');
select t.fails('a bad channel is refused', $q$select client_contact_log('{"client_id":"P1","channel":"Pigeon"}')$q$, 'check constraint');
select t.fails('a follow-up before the contact is refused', format($q$select client_contact_log('{"client_id":"P1","contacted_on":"2026-01-10","follow_up_on":"2026-01-01"}')$q$), 'before the contact');
select t.fails('the table is closed to the browser', $q$select * from client_contacts$q$, 'permission denied');
-- Document request.
select client_document_request(jsonb_build_object('client_id', 'P2', 'what', 'Passport copy', 'due_on', (current_date - 1)::text)) as r1 \gset
select t.fails('what is required', $q$select client_document_request('{"client_id":"P2"}')$q$, 'which documents');
select t.ok('the client page lists both', (select jsonb_array_length(client_work_list('P1')->'contacts') = 1 and jsonb_array_length(client_work_list('P2')->'requests') = 1));
-- Items logged by hand.
select alert_manual_raise('Complaint', 'P1', 'Late delivery') as m1 \gset
select t.fails('an unknown item is refused', $q$select alert_manual_raise('Nope', 'P1')$q$, 'Unknown item');
select t.fails('an unknown client is refused for an item', $q$select alert_manual_raise('Complaint', 'NOPE')$q$, 'Unknown client');
reset test.uid;
select t.fails('signed out refused', $q$select client_contact_log('{"client_id":"P1"}')$q$, 'Sign in');
set role anon;
select t.fails('anon refused', $q$select client_work_list('P1')$q$, 'permission denied');
reset role;
select t.ok('a logged item is High, assigned to the person who logged it, with the detail', (select priority = 'High' and category = 'Client Activity' and assigned_to = '00000000-0000-0000-0000-0000000000c1' and description = 'Late delivery' from alerts where id = :'m1'));

-- Rules.
insert into accounting_job_list (client_id, client_name, service_name, service_department, work_status, next_follow_up_on, invoice_date, balance, assignee_ids)
values ('P1', 'Phase One', 'Audit', 'Accounting', 'In Progress', current_date - 1, current_date - 40, 500, array['00000000-0000-0000-0000-000000000000']::uuid[]);
insert into business_setup_invoices (client_id, quote_id, invoice_number, issued_on, amount) values
  ('P2', '00000000-0000-0000-0000-00000000f001', 'INV-1', current_date - 40, 1000),
  ('P1', '00000000-0000-0000-0000-00000000f002', 'INV-2', current_date - 40, 1000);
insert into stub_net_paid (quote_id, amount) values ('00000000-0000-0000-0000-00000000f001', 400), ('00000000-0000-0000-0000-00000000f002', 1000);
insert into client_compliance_items (client_id, item_type, next_review_date) values ('P1', 'UBO verification', current_date + 5), ('P3', 'UBO verification', current_date + 5);
insert into client_compliance_items (client_id, item_type, expiry_date) values ('P1', 'Tax residency certificate', current_date + 20);
insert into business_setup_services (client_id, name, status, historical) values
  ('P2', 'Trade License Renewal', 'In progress', false), ('P2', 'Ejari Renewal', 'Not started', false),
  ('P1', 'Visa Registration', 'In progress', false), ('P1', 'Visa Registration', 'Not started', false);
select alert_tax_ingest(jsonb_build_array(
  jsonb_build_object('item_key', 'P1:VAT:1', 'client_id', 'P1', 'title', 'VAT return', 'due_date', (current_date + 10)::text),
  jsonb_build_object('item_key', 'NOPE:VAT:1', 'client_id', 'NOPE', 'title', 'VAT return', 'due_date', (current_date + 10)::text),
  jsonb_build_object('item_key', 'P3:VAT:1', 'client_id', 'P3', 'title', 'VAT return', 'due_date', (current_date + 10)::text)));
select public.alert_scan() as scan \gset
select t.ok('the scan is clean', (:'scan'::jsonb)->>'status' = 'Ok');
select t.ok('follow-up raises from the newest contact', (select priority = 'High' and category = 'Follow-ups' from alerts where rule_code = 'contact_followup' and client_id = 'P1' and status = 'Open'));
select t.ok('job follow-up raises, ignoring a deleted assignee', (select count(*) = 1 and bool_and(assigned_to is null) from alerts where rule_code = 'job_followup' and client_id = 'P1' and status = 'Open'));
select t.ok('an overdue document request raises', (select priority = 'High' and category = 'Client Documents' from alerts where rule_code = 'document_request' and client_id = 'P2' and status = 'Open'));
select t.ok('a job with a balance past terms raises', (select priority = 'High' from alerts where rule_code = 'job_payment_due' and client_id = 'P1' and status = 'Open'));
select t.ok('an unpaid invoice raises', (select count(*) = 1 from alerts where rule_code = 'setup_invoice_due' and client_id = 'P2' and status = 'Open'));
select t.ok('a paid invoice does not', (select count(*) = 0 from alerts where rule_code = 'setup_invoice_due' and client_id = 'P1'));
select t.ok('UBO review raises High at 5 days', (select priority = 'High' and category = 'UBO & AML' from alerts where rule_code = 'compliance_ubo_verification' and client_id = 'P1' and status = 'Open'));
select t.ok('a closed client raises no review', (select count(*) = 0 from alerts where rule_code = 'compliance_ubo_verification' and client_id = 'P3'));
select t.ok('tax residency goes to the tax department', (select department = 'Tax Compliance' from alerts where rule_code = 'compliance_tax_residency_certificate' and client_id = 'P1' and status = 'Open'));
select t.ok('tax date raises High at 10 days', (select priority = 'High' and department = 'Tax Compliance' from alerts where rule_code = 'tax_deadline' and client_id = 'P1' and status = 'Open'));
select t.ok('unknown client left out of tax items', (select count(*) = 0 from alert_tax_items where client_id = 'NOPE'));
select t.ok('closed client raises no tax alert', (select count(*) = 0 from alerts where rule_code = 'tax_deadline' and client_id = 'P3'));
select t.ok('two pending services raise', (select count(*) = 1 from alerts where rule_code = 'multiple_services' and client_id = 'P2' and status = 'Open'));
select t.ok('Visa Registration rows do not', (select count(*) = 0 from alerts where rule_code = 'multiple_services' and client_id = 'P1'));
select t.ok('a logged complaint survives the scan', (select status = 'Open' from alerts where id = :'m1'));
select t.ok('rules off raise nothing', (select count(*) = 0 from alerts where rule_code in ('client_not_contacted', 'client_inactive', 'company_anniversary', 'ct_dereg_review')));

-- A newer contact replaces the follow-up; an answered request closes.
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000c1';
select client_contact_log(jsonb_build_object('client_id', 'P1', 'channel', 'Email'));
select client_document_answered(:'r1', 'Received');
select t.fails('an answered request cannot be answered again', format($q$select client_document_answered(%L)$q$, :'r1'), 'not open');
reset test.uid;
reset role;
delete from alert_tax_items where client_id = 'P1';
select public.alert_scan();
select t.ok('a newer contact closes the follow-up', (select bool_and(status = 'Resolved') from alerts where rule_code = 'contact_followup' and client_id = 'P1'));
select t.ok('an answered request closes its alert', (select bool_and(status = 'Resolved') from alerts where rule_code = 'document_request' and client_id = 'P2'));
select t.ok('a removed tax item closes its alert', (select bool_and(status = 'Resolved') from alerts where rule_code = 'tax_deadline' and client_id = 'P1'));

-- Rules that are off work when turned on.
update alert_rules set enabled = true where code in ('client_not_contacted', 'client_inactive', 'company_anniversary', 'ct_dereg_review');
update client_contacts set contacted_on = current_date - 200 where client_id = 'P1';
update client_master set data = jsonb_build_object('License Issue Date', to_char(current_date + 3, 'DD/MM') || '/2020') where client_id = 'P1';
select public.alert_scan();
select t.ok('not contacted raises from the log', (select count(*) = 1 from alerts where rule_code = 'client_not_contacted' and client_id = 'P1' and status = 'Open'));
select t.ok('no logged contact reports nobody', (select count(*) = 0 from alerts where rule_code = 'client_not_contacted' and client_id = 'P2'));
select t.ok('inactive raises past its setting', (select count(*) = 1 from alerts where rule_code = 'client_inactive' and client_id = 'P1' and status = 'Open'));
select t.ok('anniversary inside 7 days raises', (select priority = 'Normal' from alerts where rule_code = 'company_anniversary' and client_id = 'P1' and status = 'Open'));
select t.ok('CT deregistration review raises for a closed company', (select count(*) = 1 from alerts where rule_code = 'ct_dereg_review' and client_id = 'P3'));
update alert_rules set enabled = false where code in ('client_not_contacted', 'client_inactive', 'company_anniversary', 'ct_dereg_review');
select public.alert_scan();

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000a1';
select t.fails('tax ingest is closed to the browser', $q$select alert_tax_ingest('[]')$q$, 'permission denied');
reset test.uid;
reset role;
update alert_settings set value = '"Live"' where key = 'alert_mode';
