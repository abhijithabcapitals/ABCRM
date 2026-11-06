-- CHANGES MADE (migration 020). Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

\set acc '00000000-0000-0000-0000-000000014001'
\set non '00000000-0000-0000-0000-000000014002'
\set edt '00000000-0000-0000-0000-000000014003'
insert into profiles (id, full_name, email, role) values
  (:'acc', 'Changes Accountant', 'acc@x.test', 'member'), (:'non', 'Changes Nobody', 'non@x.test', 'member'),
  (:'edt', 'Changes Editor', 'edt@x.test', 'member');
insert into member_tab_access (profile_id, tab_key) values (:'acc', 'accounts');
insert into client_master (client_id, legal_name, data) values ('CH1', 'Change One LLC', '{}'), ('CH2', 'Change Two LLC', '{}');

-- Client Master: watched fields are copied with who and when, others are not.
set test.uid = :'edt';
insert into client_master_history (client_id, action, field, old_value, new_value) values
  ('CH1', 'Updated', 'Trade License Number', '111', '222'),
  ('CH1', 'Updated', 'License Expiry Date', '01/01/2026', '01/01/2027'),
  ('CH1', 'Updated', 'Shareholders', 'Ali – Ownership: 100', 'Ali – Ownership: 50; Sara – Ownership: 50'),
  ('CH1', 'Updated', 'Company Registration Number', null, 'CR-9'),
  ('CH1', 'Updated', 'Registered Address', 'A', 'B'),
  ('CH1', 'Created', null, null, null);
select t.ok('Client Master watched fields are logged', (select count(*) from changes_made_log where client_id = 'CH1' and source = 'Client Master') = 4);
select t.ok('an unwatched field is not logged', not exists (select 1 from changes_made_log where field = 'Registered Address'));
select t.ok('who made it is kept', (select bool_and(changed_by = :'edt') from changes_made_log where client_id = 'CH1'));
select t.ok('client name is kept', (select bool_and(client_name = 'Change One LLC') from changes_made_log where client_id = 'CH1'));

-- Business Setup KYC: licence and partners, with passport and Emirates ID masked.
insert into business_setup_kyc_profiles (client_id, licence_extras) values ('CH2', '{}');
select t.ok('a blank KYC profile logs nothing', not exists (select 1 from changes_made_log where client_id = 'CH2'));
update business_setup_kyc_profiles set licence_number = 'L-1', licence_expiry = '2027-05-01' where client_id = 'CH2';
select t.ok('licence number and expiry are logged', (select count(*) from changes_made_log where client_id = 'CH2' and field in ('Trade License Number', 'License Expiry Date')) = 2);
update business_setup_kyc_profiles set jurisdiction = 'DMCC' where client_id = 'CH2';
select t.ok('an unwatched KYC column logs nothing', (select count(*) from changes_made_log where client_id = 'CH2') = 2);

insert into business_setup_kyc_partners (kyc_id, full_name, share_percent, passport_number, emirates_id)
  select id, 'Omar', 60, 'P1234567', '784-1990-1234567-1' from business_setup_kyc_profiles where client_id = 'CH2';
select t.ok('a new partner is logged once', (select count(*) from changes_made_log where client_id = 'CH2' and field = 'Shareholder / Partner added' and person = 'Omar') = 1);
update business_setup_kyc_partners set emirates_id = '784-1990-7654321-9', passport_number = 'P7654321', share_percent = 40 where full_name = 'Omar';
select t.ok('Emirates ID change is logged masked', exists (select 1 from changes_made_log where field = 'Emirates ID' and person = 'Omar' and old_value = '****67-1' and new_value = '****21-9'));
select t.ok('passport change is logged masked', exists (select 1 from changes_made_log where field = 'Passport Number' and old_value = '****4567' and new_value = '****4321'));
select t.ok('no full Emirates ID or passport is stored', not exists (select 1 from changes_made_log where coalesce(old_value, '') || coalesce(new_value, '') ~ '(784-1990|P7654321|P1234567)'));
select t.ok('share change is logged', exists (select 1 from changes_made_log where field = 'Ownership %' and old_value = '60.00' and new_value = '40.00'));
update business_setup_kyc_partners set deleted_at = now() where full_name = 'Omar';
select t.ok('a removed partner is logged', exists (select 1 from changes_made_log where field = 'Shareholder / Partner removed' and person = 'Omar'));

-- Banking KYC shareholders map to the Client Master ID.
insert into banking_clients (id, client_master_id, display_name) values ('00000000-0000-0000-0000-0000000140b1', 'CH1', 'Change One LLC');
insert into banking_kyc_profiles (id, client_id) values ('00000000-0000-0000-0000-0000000140b2', '00000000-0000-0000-0000-0000000140b1');
insert into banking_kyc_shareholders (kyc_profile_id, full_name, passport_number) values ('00000000-0000-0000-0000-0000000140b2', 'Lina', 'X99');
update banking_kyc_shareholders set passport_number = 'X100' where full_name = 'Lina';
select t.ok('banking shareholder change reaches the client', exists (select 1 from changes_made_log where client_id = 'CH1' and source = 'Banking KYC' and field = 'Passport Number' and old_value = '****' and new_value = '****'));
update banking_kyc_profiles set license_expiry_date = '2028-01-01';
select t.ok('banking licence expiry is logged', exists (select 1 from changes_made_log where client_id = 'CH1' and source = 'Banking KYC' and field = 'License Expiry Date'));
reset test.uid;

select t.fails('the log cannot be edited', $q$update changes_made_log set new_value = 'x'$q$, 'cannot be changed');
select t.fails('the log cannot be deleted', $q$delete from changes_made_log$q$, 'cannot be changed');

-- Reading.
set role authenticated;
set test.uid = :'acc';
select t.ok('Accounting tab holder may read', changes_made_can_read());
select t.ok('list returns everything with names', (select (r ->> 'allowed')::boolean and (r ->> 'total')::int = (r ->> 'new_count')::int and (r ->> 'total')::int >= 12
  and r -> 'items' -> 0 ->> 'changed_by_name' = 'Changes Editor' from (select changes_made_list() r) x));
select changes_made_mark_seen();
select t.ok('after opening, nothing is new', (changes_made_list() ->> 'new_count')::int = 0);
select t.fails('the table is not readable directly', $q$select * from changes_made_log$q$, 'permission denied');
select t.fails('the writer is not browser-callable', $q$select changes_made_write('CH1', 'x', null, 'f', null, null)$q$, 'permission denied');
set test.uid = :'non';
select t.ok('without the tab the list is refused', (changes_made_list() ->> 'allowed')::boolean = false and changes_made_list() -> 'items' is null);
select t.fails('without the tab mark seen is refused', $q$select changes_made_mark_seen()$q$, 'permission');
reset test.uid;
reset role;
set role anon;
select t.fails('anon cannot list', $q$select changes_made_list()$q$, 'permission denied');
reset role;
select 'client changes tests passed';
