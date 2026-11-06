-- Notification preferences. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-000000000f01', 'Pref one', 'member'),
  ('00000000-0000-0000-0000-000000000f02', 'Pref two', 'member')
on conflict (id) do nothing;
update alert_settings set value = '"Live"' where key = 'alert_mode';

set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000f01';
select t.ok('everything is on by default', (select jsonb_array_length(alert_preferences_get()->'off') = 0));
select t.ok('twelve categories are offered', (select jsonb_array_length(alert_preferences_get()->'categories') = 12));
select alert_preferences_save('Licence', 'Bell', false);
select t.ok('saved off is read back', (select alert_preferences_get()->'off' = '[{"channel": "Bell", "category": "Licence"}]'::jsonb));
select t.fails('unknown category refused', $q$select alert_preferences_save('Nope', 'Bell', false)$q$, 'Unknown category');
select t.fails('unknown channel refused', $q$select alert_preferences_save('Licence', 'Fax', false)$q$, 'Channel must be');
select t.fails('table is not readable by the browser', $q$select * from alert_preferences$q$, 'permission denied');
select t.fails('table is not writable by the browser', $q$delete from alert_preferences$q$, 'permission denied');
set test.uid = '00000000-0000-0000-0000-000000000f02';
select t.ok('another person does not see those rows', (select jsonb_array_length(alert_preferences_get()->'off') = 0));
reset test.uid;
select t.fails('signed out refused', $q$select alert_preferences_get()$q$, 'Sign in');
set role anon;
select t.fails('anon refused', $q$select alert_preferences_get()$q$, 'permission denied');
reset role;

-- 030 turned job_due off and on with no scan since, which leaves it waiting for its baseline (016).
update alert_rules set baseline_pending = false where code = 'job_due';
-- f01 has Licence bells off.
select alert_raise('licence_expiry', 'pref-high', null, 'Pref High', 'Business Setup', current_date + 20, 30, 'High', '00000000-0000-0000-0000-000000000f01', 't', 'p1') as high_id \gset
select t.ok('an off category writes no bell', (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'high_id'));
select t.ok('the person is still a recipient', (select count(*) = 1 from alert_recipients where alert_id = :'high_id' and user_id = '00000000-0000-0000-0000-000000000f01'));
select t.ok('the alert still exists and is open', (select status = 'Open' from alerts where id = :'high_id'));
select alert_raise('licence_expiry', 'pref-crit', null, 'Pref Crit', 'Business Setup', current_date - 2, -1, 'Critical', '00000000-0000-0000-0000-000000000f01', 't', 'p2') as crit_id \gset
select t.ok('Critical still bells', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'crit_id'));
select alert_raise('licence_expiry', 'pref-other', null, 'Pref Other', 'Business Setup', current_date + 20, 30, 'High', '00000000-0000-0000-0000-000000000f02', 't', 'p3') as other_id \gset
select t.ok('someone else still gets the bell', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'other_id'));
select alert_raise('job_due', 'pref-job', null, 'Pref Job', 'Accounting', current_date, 0, 'High', '00000000-0000-0000-0000-000000000f01', 't', 'p4') as job_id \gset
select t.ok('another category still bells', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'job_id'));

-- The silence rules still hold with preferences on.
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select alert_raise('job_due', 'pref-prev', null, 'Pref Prev', 'Accounting', current_date, 0, 'High', '00000000-0000-0000-0000-000000000f02', 't', 'p5') as prev_id \gset
select t.ok('Preview still writes no bell', (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'prev_id'));
update alert_settings set value = '"Live"' where key = 'alert_mode';
select alert_bell(:'prev_id', '00000000-0000-0000-0000-000000000f02', 'Assigned');
select t.ok('a backlog row still writes no bell', (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'prev_id'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';
select alert_raise('job_due', 'pref-tri', null, 'Pref Tri', 'Accounting', current_date, 0, 'High', '00000000-0000-0000-0000-000000000f02', 't', 'p6') as tri_id \gset
select alert_bell(:'tri_id', '00000000-0000-0000-0000-000000000f01', 'Manager');
select t.ok('Triage still bells only Assigned', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'tri_id' and user_id = '00000000-0000-0000-0000-000000000f02')
  and (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'tri_id' and user_id = '00000000-0000-0000-0000-000000000f01'));
update alert_settings set value = '"Live"' where key = 'alert_mode';
