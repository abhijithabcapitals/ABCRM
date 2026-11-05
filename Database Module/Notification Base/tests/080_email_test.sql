-- Staff email build. Nothing sends here. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into profiles (id, full_name, email, role) values
  ('00000000-0000-0000-0000-00000000a801', 'Mail one', 'one@example.test', 'member'),
  ('00000000-0000-0000-0000-00000000a802', 'Mail two', 'two@example.test', 'member'),
  ('00000000-0000-0000-0000-00000000a803', 'Mail none', null, 'member')
on conflict (id) do nothing;
insert into client_master (client_id, legal_name, data) values ('CLM01', 'Mail Client', '{}') on conflict do nothing;

create temp table mail_user as select '00000000-0000-0000-0000-00000000a801'::uuid as one, '00000000-0000-0000-0000-00000000a802'::uuid as two, '00000000-0000-0000-0000-00000000a803'::uuid as none;
select one, two, none from mail_user \gset

-- Everything is on, but the setting is off.
-- A scan closes alerts its rules did not raise, so it runs before the fixtures below.
update alert_settings set value = '"Live"' where key = 'alert_mode';
insert into client_compliance_items (client_id, item_type, person_name, reference, expiry_date) values ('CLM01', 'Passport', 'Mail Person', 'SECRET-REF-99', current_date + 5);
select public.alert_scan();
select alert_raise('job_due', 'mail-high', 'CLM01', 'Mail High', 'Accounting', current_date, 0, 'High', :'one', 't', 'm1') as high_id \gset
select alert_raise('licence_expiry', 'mail-crit', 'CLM01', 'Mail Crit', 'Business Setup', current_date - 2, -1, 'Critical', :'one', 't', 'm2') as crit_id \gset
select alert_raise('job_due', 'mail-none', 'CLM01', 'Mail None', 'Accounting', current_date, 0, 'High', :'none', 't', 'm3');
select t.ok('off by default', (select value = 'false'::jsonb from alert_settings where key = 'email_enabled'));
select t.ok('sender default', (select value = '"info@abcapital.ae"'::jsonb from alert_settings where key = 'email_sender'));
select t.ok('setting off builds nothing', alert_email_build('Digest') = '[]' and alert_email_build('Critical') = '[]');

update alert_settings set value = 'true' where key = 'email_enabled';
select t.ok('Digest finds the assigned person', (select count(*) >= 1 from jsonb_array_elements(alert_email_build('Digest')) u where u->>'user_id' = :'one'));
select t.ok('Critical holds only Critical alerts', (select bool_and(a->>'priority' = 'Critical') from jsonb_array_elements(alert_email_build('Critical')) u, jsonb_array_elements(u->'alerts') a));
select t.ok('nobody without an email', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Digest')) u where u->>'user_id' = :'none'));
select t.ok('alerts carry only the listed fields', (select bool_and((select array_agg(k order by k) from jsonb_object_keys(a) k) = array['action', 'due_date', 'id', 'number', 'priority', 'title'])
  from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a));

-- A register reference never appears (the item and scan are at the top).
select t.ok('a register reference is absent from the mail data', alert_email_build('Digest')::text not like '%SECRET-REF-99%' and alert_email_build('Critical')::text not like '%SECRET-REF-99%');

-- Recording stops a repeat; a failure does not.
select alert_email_record(jsonb_build_array(jsonb_build_object('alert_id', :'high_id', 'user_id', :'one', 'kind', 'Digest', 'status', 'Failed', 'error', 'server down')));
select t.ok('a failed send is retried', (select count(*) = 1 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where u->>'user_id' = :'one' and a->>'id' = :'high_id'));
select alert_email_record(jsonb_build_array(jsonb_build_object('alert_id', :'high_id', 'user_id', :'one', 'kind', 'Digest', 'status', 'Sent')));
select t.ok('retry updates the same row', (select count(*) = 1 and bool_and(status = 'Sent') from alert_deliveries where alert_id = :'high_id' and user_id = :'one'));
select t.ok('no second digest for it today', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where u->>'user_id' = :'one' and a->>'id' = :'high_id'));
select alert_email_record(jsonb_build_array(jsonb_build_object('alert_id', :'crit_id', 'user_id', :'one', 'kind', 'Critical', 'status', 'Sent')));
select t.ok('no second Critical mail, ever', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Critical')) u, jsonb_array_elements(u->'alerts') a where a->>'id' = :'crit_id' and u->>'user_id' = :'one'));
update alert_deliveries set sent_on = current_date - 1 where alert_id = :'high_id';
select t.ok('digest lists it again the next day', (select count(*) = 1 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where u->>'user_id' = :'one' and a->>'id' = :'high_id'));

-- Preferences, backlog and modes.
insert into alert_preferences (user_id, category, channel, enabled) values (:'two', 'Deadlines', 'Email', false);
select alert_raise('job_due', 'mail-pref', 'CLM01', 'Mail Pref', 'Accounting', current_date, 0, 'High', :'two', 't', 'm4') as pref_id \gset
select t.ok('email preference off leaves it out', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where a->>'id' = :'pref_id'));
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select t.ok('Preview builds nothing', alert_email_build('Digest') = '[]');
select alert_raise('job_due', 'mail-back', 'CLM01', 'Mail Back', 'Accounting', current_date, 0, 'High', :'one', 't', 'm5') as back_id \gset
update alert_settings set value = '"Live"' where key = 'alert_mode';
select t.ok('a backlog row is left out', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where a->>'id' = :'back_id'));
select alert_raise('job_due', 'mail-mgr', 'CLM01', 'Mail Mgr', 'Accounting', current_date, 0, 'High', null, 't', 'm6') as mgr_id \gset
update profiles set email = 'mgr@example.test' where id = '00000000-0000-0000-0000-0000000000b1';
select t.ok('Live mails managers an unassigned alert', (select count(*) >= 1 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where a->>'id' = :'mgr_id'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';
select t.ok('Triage does not mail managers', (select count(*) = 0 from jsonb_array_elements(alert_email_build('Digest')) u, jsonb_array_elements(u->'alerts') a where a->>'id' = :'mgr_id'));
update alert_settings set value = '"Live"' where key = 'alert_mode';
select t.fails('a bad kind is refused', $q$select alert_email_build('Weekly')$q$, 'Kind must be');

set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000000a1';
select t.fails('an admin browser call cannot build', $q$select alert_email_build('Digest')$q$, 'permission denied');
select t.fails('an admin browser call cannot record', $q$select alert_email_record('[]')$q$, 'permission denied');
select t.fails('the table is closed to the browser', $q$select * from alert_deliveries$q$, 'permission denied');
reset test.uid;
reset role;

update alert_settings set value = 'false' where key = 'email_enabled';
