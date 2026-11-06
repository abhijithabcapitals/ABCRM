-- Calendar of due dates. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000a901', 'Cal one', 'member'),
  ('00000000-0000-0000-0000-00000000a902', 'Cal two', 'member')
on conflict (id) do nothing;
update alert_settings set value = '"Live"' where key = 'alert_mode';
select alert_raise('job_due', 'cal-one', null, 'Cal One', 'Accounting', current_date + 3, 0, 'High', '00000000-0000-0000-0000-00000000a901', 't', 'c1') as one_id \gset
select alert_raise('job_due', 'cal-two', null, 'Cal Two', 'Accounting', current_date + 4, 0, 'High', '00000000-0000-0000-0000-00000000a902', 't', 'c2') as two_id \gset
select alert_raise('job_due', 'cal-far', null, 'Cal Far', 'Accounting', current_date + 60, 0, 'High', '00000000-0000-0000-0000-00000000a901', 't', 'c3') as far_id \gset
select alert_raise('job_due', 'cal-done', null, 'Cal Done', 'Accounting', current_date + 5, 0, 'High', '00000000-0000-0000-0000-00000000a901', 't', 'c4') as done_id \gset
update alerts set status = 'Resolved', resolved_at = now() where id = :'done_id';
select count(*) as all_in_range from alerts where status in ('Open', 'In progress') and due_date between current_date and current_date + 10 \gset

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000a901';
select t.ok('a member sees only their own in range', (select array_agg(e->>'id') = array[:'one_id'] from jsonb_array_elements(alert_calendar((current_date)::date, (current_date + 10)::date)) e));
select t.ok('the range is applied', (select count(*) = 2 from jsonb_array_elements(alert_calendar((current_date)::date, (current_date + 90)::date)) e where e->>'id' in (:'one_id', :'far_id')));
select t.ok('rows carry only the calendar fields', (select bool_and((select array_agg(k order by k) from jsonb_object_keys(e) k) = array['due_date', 'id', 'priority', 'title'])
  from jsonb_array_elements(alert_calendar((current_date)::date, (current_date + 10)::date)) e));
select t.fails('a backwards range is refused', $q$select alert_calendar(current_date, current_date - 1)$q$, 'valid date range');
select t.fails('a long range is refused', $q$select alert_calendar(current_date, current_date + 401)$q$, 'at most 400');
set test.uid = '00000000-0000-0000-0000-0000000000b1';
select t.ok('a manager sees all open in range', (select count(*) = :all_in_range from jsonb_array_elements(alert_calendar((current_date)::date, (current_date + 10)::date))));
reset role;
update alert_settings set value = '"Preview"' where key = 'alert_mode';
set role authenticated;
select t.ok('a manager sees nothing in Preview', alert_calendar((current_date)::date, (current_date + 10)::date) = '[]');
set test.uid = '00000000-0000-0000-0000-00000000a901';
select t.ok('a member sees nothing in Preview', alert_calendar((current_date)::date, (current_date + 10)::date) = '[]');
set test.uid = '00000000-0000-0000-0000-0000000000a1';
select t.ok('an admin still sees all in Preview', (select count(*) = :all_in_range from jsonb_array_elements(alert_calendar((current_date)::date, (current_date + 10)::date))));
reset test.uid;
select t.fails('signed out refused', $q$select alert_calendar(current_date, current_date)$q$, 'Sign in');
reset role;
update alert_settings set value = '"Live"' where key = 'alert_mode';
