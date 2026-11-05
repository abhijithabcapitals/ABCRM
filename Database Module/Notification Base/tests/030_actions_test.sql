-- Actions, escalation and client owners (Task 4). Prints "ok ..." per check and stops at the first failure.
-- Runs after 010 and 020: mode Live, managers b1 (banking tag) and b2 (HR tag), admins a1 and a2, employees c1 and c2.
\set ON_ERROR_STOP on

select '00000000-0000-0000-0000-0000000000a1'::uuid as adm,
       '00000000-0000-0000-0000-0000000000b1'::uuid as mgr1,
       '00000000-0000-0000-0000-0000000000b2'::uuid as mgr2,
       '00000000-0000-0000-0000-0000000000c1'::uuid as emp1,
       '00000000-0000-0000-0000-0000000000c2'::uuid as emp2 \gset
select (now() at time zone 'Asia/Dubai')::date as today \gset
update alert_settings set value = '"Live"' where key = 'alert_mode';
select t.ok('tests start in Live with tagged managers', alert_mode() = 'Live' and (select count(*) = 2 and bool_and(not fell_back) from alert_managers()));

-- ═══ Resolve, dismiss, assign, status, read ═════════════════════════
select alert_raise('r', 't4-main', 'CL000001', 'Main', 'Business Setup', :'today'::date + 5, 1, 'High', :'emp1', 't', 'i') as a_main \gset
select alert_raise('r', 't4-crit', 'CL000001', 'Crit', 'Business Setup', :'today'::date + 5, 1, 'Critical', :'emp1', 't', 'i') as a_crit \gset
select alert_raise('r', 't4-open', 'CL000001', 'Unassigned one', 'Business Setup', :'today'::date + 5, 1, 'Medium', null, 't', 'i') as a_open \gset

select set_config('test.uid', :'emp2', false);
select t.fails('member cannot assign', format('select alert_assign(%L, %L)', :'a_main', :'emp2'), 'You do not have');
select t.fails('unrelated member cannot resolve', format('select alert_resolve(%L)', :'a_main'), 'You do not have');
select t.fails('unrelated member cannot change status', format('select alert_set_status(%L, %L)', :'a_main', 'In progress'), 'You do not have');
select t.fails('unrelated member cannot escalate', format('select alert_escalate(%L, %L)', :'a_main', 'why'), 'You do not have');
select t.fails('unrelated member cannot even mark read', format('select alert_mark_read(%L)', :'a_main'), 'You do not have');
select set_config('test.uid', :'emp1', false);
select t.fails('the assigned employee cannot assign either', format('select alert_assign(%L, %L)', :'a_main', :'emp2'), 'You do not have');
select set_config('test.uid', '', false);
select t.fails('nobody signed in is refused', format('select alert_resolve(%L)', :'a_main'), 'You do not have');
select t.ok('refusals changed nothing', (select count(*) = 3 and bool_and(status = 'Open' and escalation_level = 0 and resolved_by is null) from alerts where id in (:'a_main', :'a_crit', :'a_open')));

-- Critical needs a note with text after trimming
select set_config('test.uid', :'emp1', false);
select t.fails('critical needs a note', format('select alert_resolve(%L)', :'a_crit'), 'note');
select t.fails('critical note of spaces is refused', format('select alert_resolve(%L, %L)', :'a_crit', '   '), 'note');
select t.fails('critical note of tabs and newlines is refused', format('select alert_resolve(%L, %L)', :'a_crit', E'\t \n '), 'note');
select t.fails('critical cannot be dismissed without a note', format('select alert_resolve(%L, %L, true)', :'a_crit', ' '), 'note');
select t.ok('refused critical stays open', (select status = 'Open' and resolved_by is null from alerts where id = :'a_crit'));
select alert_resolve(:'a_crit', '  Client paid, renewal filed  ');
select t.ok('critical with a note resolves, note trimmed', (select status = 'Resolved' and resolution_note = 'Client paid, renewal filed' from alerts where id = :'a_crit'));
select t.fails('a closed alert cannot be closed again', format('select alert_resolve(%L)', :'a_crit'), 'closed');

-- status, mark read
select t.ok('assigned employee has an unread recipient row and an unread bell',
  (select read_at is null from alert_recipients where alert_id = :'a_main' and user_id = :'emp1')
  and (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'a_main' and user_id = :'emp1' and not read));
select alert_set_status(:'a_main', 'In progress');
select t.ok('assigned employee sets In progress, event written', (select status = 'In progress' from alerts where id = :'a_main')
  and (select count(*) = 1 from alert_events where alert_id = :'a_main' and event = 'status changed' and detail->>'to' = 'In progress'));
select alert_set_status(:'a_main', 'Open');
select t.ok('and back to Open', (select status = 'Open' from alerts where id = :'a_main'));
select t.fails('status Resolved is not allowed here', format('select alert_set_status(%L, %L)', :'a_main', 'Resolved'), 'Status must be');
select t.fails('status null is not allowed', format('select alert_set_status(%L, null)', :'a_main'), 'Status must be');
select alert_mark_read(:'a_main');
select t.ok('mark read sets read_at and clears the bell',
  (select read_at is not null from alert_recipients where alert_id = :'a_main' and user_id = :'emp1')
  and (select count(*) = 1 and bool_and(read) from notifications where link_scope->>'alert_id' = :'a_main' and user_id = :'emp1'));
select t.ok('mark read touched nobody else', (select count(*) = 0 from alert_recipients where alert_id = :'a_main' and user_id <> :'emp1' and read_at is not null));

-- resolved records person and date
select alert_resolve(:'a_main', '  done  ');
select t.ok('resolved records person and date, by a person',
  (select status = 'Resolved' and resolved_by = :'emp1' and not resolved_by_system and resolved_at is not null
          and (resolved_at at time zone 'Asia/Dubai')::date = :'today'::date and resolution_note = 'done' from alerts where id = :'a_main'));
select t.ok('resolve event names the person', (select count(*) = 1 from alert_events where alert_id = :'a_main' and event = 'resolved' and detail->>'by' = :'emp1'));
select t.ok('a scan or raise does not reopen a person-resolved alert',
  alert_raise('r', 't4-main', 'CL000001', 'Main', 'Business Setup', :'today'::date + 5, 2, 'High', :'emp1', 't', 'i') is null
  and (select status = 'Resolved' from alerts where id = :'a_main'));
select t.fails('a closed alert cannot change status', format('select alert_set_status(%L, %L)', :'a_main', 'Open'), 'closed');
select t.fails('a closed alert cannot be escalated', format('select alert_escalate(%L, %L)', :'a_main', 'late'), 'closed');
select set_config('test.uid', :'mgr1', false);
select t.fails('a closed alert cannot be assigned', format('select alert_assign(%L, %L)', :'a_main', :'emp2'), 'closed');

-- assign by a tagged manager, then dismiss by a manager who is not assigned
select alert_raise('r', 't4-d', 'CL000001', 'Dismiss me', 'Business Setup', :'today'::date + 5, 1, 'Normal', :'emp1', 't', 'i') as a_dis \gset
select set_config('test.uid', :'mgr1', false);
select t.ok('tagged manager is not the assigned employee', not exists (select 1 from alerts where id = :'a_dis' and assigned_to = :'mgr1'));
select alert_resolve(:'a_dis', null, true);
select t.ok('tagged manager can dismiss, recorded as a person', (select status = 'Dismissed' and resolved_by = :'mgr1' and not resolved_by_system and resolution_note is null from alerts where id = :'a_dis')
  and (select count(*) = 1 from alert_events where alert_id = :'a_dis' and event = 'dismissed'));

select set_config('test.uid', :'mgr1', false);
select t.ok('unassigned alert reaches both managers before assignment', (select count(*) = 2 and bool_and(reason = 'Manager') from alert_recipients where alert_id = :'a_open'));
select count(*) as bells_emp2 from notifications where user_id = :'emp2' and type = 'alert_centre' \gset
select alert_assign(:'a_open', :'emp2');
select t.ok('manager assigns: column, Assigned recipient, event',
  (select assigned_to = :'emp2' from alerts where id = :'a_open')
  and (select reason = 'Assigned' from alert_recipients where alert_id = :'a_open' and user_id = :'emp2')
  and (select count(*) = 1 from alert_events where alert_id = :'a_open' and event = 'assigned' and detail->>'to' = :'emp2'));
select t.ok('the assignee is belled once and managers stay recipients',
  (select count(*) = :bells_emp2 + 1 from notifications where user_id = :'emp2' and type = 'alert_centre')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_open' and reason = 'Manager'));
select alert_assign(:'a_open', :'emp2');
select t.ok('assigning the same person again sends no second bell', (select count(*) = :bells_emp2 + 1 from notifications where user_id = :'emp2' and type = 'alert_centre'));
select alert_assign(:'a_open', :'mgr2');
select t.ok('assigning a manager promotes their recipient row to Assigned and bells them',
  (select reason = 'Assigned' from alert_recipients where alert_id = :'a_open' and user_id = :'mgr2')
  and (select count(*) = 2 from notifications where user_id = :'mgr2' and link_scope->>'alert_id' = :'a_open'));
select alert_assign(:'a_open', :'emp2');
select t.ok('reassigning keeps the earlier recipients', (select count(*) = 3 from alert_recipients where alert_id = :'a_open') and (select assigned_to = :'emp2' from alerts where id = :'a_open'));
select t.fails('assigning a person who does not exist is refused', format('select alert_assign(%L, %L)', :'a_open', 'ffffffff-ffff-ffff-ffff-ffffffffffff'), 'employee');
select t.fails('assigning nobody is refused', format('select alert_assign(%L, null)', :'a_open'), 'employee');
select t.fails('an alert that does not exist is refused', format('select alert_assign(%L, %L)', 'ffffffff-ffff-ffff-ffff-ffffffffffff', :'emp2'), 'does not exist');

-- Manager acts through the browser role, not only as postgres
set role authenticated;
select set_config('test.uid', :'mgr2', false);
select alert_set_status(:'a_open', 'In progress');
select set_config('test.uid', :'emp1', false);
select t.fails('browser role: untagged member cannot assign', format('select alert_assign(%L, %L)', :'a_open', :'emp1'), 'You do not have');
reset role;
select t.ok('browser role: manager status change went through', (select status = 'In progress' from alerts where id = :'a_open'));

-- ═══ Manual escalation ═══════════════════════════════════════════════
select alert_raise('r', 't4-esc', 'CL000001', 'Manual', 'Business Setup', :'today'::date + 5, 1, 'High', :'emp1', 't', 'i') as a_esc \gset
select t.ok('assigned alert starts with no manager recipient', (select count(*) = 0 from alert_recipients where alert_id = :'a_esc' and reason = 'Manager'));
select set_config('test.uid', :'emp1', false);
select t.fails('escalation needs a reason', format('select alert_escalate(%L, null)', :'a_esc'), 'reason');
select t.fails('escalation reason of spaces is refused', format('select alert_escalate(%L, %L)', :'a_esc', '   '), 'reason');
select t.ok('refused escalation changed nothing', (select escalation_level = 0 and escalated_at is null from alerts where id = :'a_esc'));
select alert_escalate(:'a_esc', '  Client not answering  ');
select t.ok('escalate: level 1, escalated_at, both managers added, employee stays',
  (select escalation_level = 1 and escalated_at is not null from alerts where id = :'a_esc')
  and (select count(*) = 2 and bool_and(reason = 'Manager') from alert_recipients where alert_id = :'a_esc' and user_id in (:'mgr1', :'mgr2'))
  and (select reason = 'Assigned' from alert_recipients where alert_id = :'a_esc' and user_id = :'emp1'));
select t.ok('escalate event has level, trimmed reason and the person',
  (select count(*) = 1 from alert_events where alert_id = :'a_esc' and event = 'escalated' and detail->>'reason' = 'Client not answering' and (detail->>'level')::int = 1 and detail->>'by' = :'emp1'));
select t.ok('each manager has one bell', (select count(*) = 2 and bool_and(n = 1) from (select user_id, count(*) n from notifications where link_scope->>'alert_id' = :'a_esc' and user_id in (:'mgr1', :'mgr2') group by user_id) x));
select set_config('test.uid', :'mgr1', false);
select alert_escalate(:'a_esc', 'Second push');
select t.ok('a second escalation raises the level and sends a fresh bell to managers already on it',
  (select escalation_level = 2 from alerts where id = :'a_esc')
  and (select count(*) = 2 and bool_and(n = 2) from (select user_id, count(*) n from notifications where link_scope->>'alert_id' = :'a_esc' and user_id in (:'mgr1', :'mgr2') group by user_id) x));

-- ═══ Automatic escalation, alert_escalate_due in Live ════════════════
select set_config('test.uid', '', false);
-- preview-born rows are backlog
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select alert_raise('r', 't4-backlog', 'CL000001', 'Backlog overdue', 'Business Setup', :'today'::date - 5, 1, 'High', :'emp1', 't', 'i') as a_bl \gset
update alert_settings set value = '"Live"' where key = 'alert_mode';

select alert_raise('r', 't4-o1', 'CL000001', 'Overdue 1', 'Business Setup', :'today'::date - 1, 1, 'High', :'emp1', 't', 'i') as a_o1 \gset
select alert_raise('r', 't4-o2', 'CL000001', 'Overdue 3', 'Business Setup', :'today'::date - 3, 1, 'Critical', :'emp1', 't', 'i') as a_o2 \gset
select alert_raise('r', 't4-o3', 'CL000001', 'Overdue then later', 'Business Setup', :'today'::date - 1, 1, 'High', :'emp1', 't', 'i') as a_o3 \gset
select alert_raise('r', 't4-today', 'CL000001', 'Due today', 'Business Setup', :'today'::date, 1, 'High', :'emp1', 't', 'i') as a_today \gset
select alert_raise('r', 't4-future', 'CL000001', 'Due soon', 'Business Setup', :'today'::date + 2, 1, 'Medium', :'emp1', 't', 'i') as a_future \gset
select alert_raise('r', 't4-nodate', 'CL000001', 'No date', 'Business Setup', null, 1, 'Medium', :'emp1', 't', 'i') as a_nodate \gset
select alert_raise('r', 't4-closed', 'CL000001', 'Closed overdue', 'Business Setup', :'today'::date - 9, 1, 'High', :'emp1', 't', 'i') as a_closed \gset
update alerts set status = 'Resolved', resolved_at = now(), resolved_by_system = true where id = :'a_closed';
select alert_raise('licence_expiry', 't4-lic90', 'CL000001', 'Licence far', 'Business Setup', :'today'::date + 40, 30, 'High', :'emp1', 't', 'i') as a_lic30 \gset
select alert_raise('licence_expiry', 't4-lic', 'CL000001', 'Licence expired', 'Business Setup', :'today'::date, -1, 'Critical', :'emp1', 't', 'i') as a_lic \gset
select alert_raise('visa_expiry', 't4-visa', 'CL000001', 'Visa expired', 'Business Setup', :'today'::date, -1, 'Critical', :'emp2', 't', 'i') as a_visa \gset
select alert_raise('r', 't4-notlic', 'CL000001', 'Other rule at step -1', 'Business Setup', :'today'::date, -1, 'Critical', :'emp1', 't', 'i') as a_notlic \gset
select alert_raise('r', 't4-un', 'CL000001', 'Lost its owner', 'Business Setup', :'today'::date + 4, 1, 'Normal', :'emp1', 't', 'i') as a_un \gset
update alerts set assigned_to = null where id = :'a_un';   -- what happens when the assigned profile is deleted

select t.ok('before the run: no manager on any of the test alerts', (select count(*) = 0 from alert_recipients where reason = 'Manager'
  and alert_id in (:'a_o1', :'a_o2', :'a_o3', :'a_today', :'a_future', :'a_nodate', :'a_closed', :'a_lic30', :'a_lic', :'a_visa', :'a_notlic', :'a_un', :'a_bl')));
select alert_escalate_due() as changed \gset
select t.ok('first run reports the alerts it changed', :changed >= 6);

select t.ok('overdue at level 0 adds both managers and sets level 1, employee stays',
  (select escalation_level = 1 and escalated_at is not null from alerts where id = :'a_o1')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_o1' and reason = 'Manager')
  and (select reason = 'Assigned' from alert_recipients where alert_id = :'a_o1' and user_id = :'emp1')
  and (select count(*) = 1 from alert_events where alert_id = :'a_o1' and event = 'escalated' and detail->>'by' = 'system' and (detail->>'level')::int = 1));
select t.ok('overdue managers each get one bell', (select count(*) = 2 and bool_and(n = 1) from (select user_id, count(*) n from notifications where link_scope->>'alert_id' = :'a_o1' and user_id in (:'mgr1', :'mgr2') group by user_id) x));
select t.ok('3 days overdue goes straight to level 2 with one bell per manager, employee stays',
  (select escalation_level = 2 from alerts where id = :'a_o2')
  and (select count(*) = 2 and bool_and(n = 1) from (select user_id, count(*) n from notifications where link_scope->>'alert_id' = :'a_o2' and user_id in (:'mgr1', :'mgr2') group by user_id) x)
  and (select count(*) = 1 from alert_recipients where alert_id = :'a_o2' and user_id = :'emp1' and reason = 'Assigned'));
select t.ok('due today, due soon, undated and closed alerts are not escalated',
  (select count(*) = 4 and bool_and(escalation_level = 0 and escalated_at is null) from alerts where id in (:'a_today', :'a_future', :'a_nodate', :'a_closed'))
  and (select count(*) = 0 from alert_recipients where reason = 'Manager' and alert_id in (:'a_today', :'a_future', :'a_nodate', :'a_closed')));
select t.ok('critical expiry at step -1 adds the managers at level 1 even though not yet overdue',
  (select escalation_level = 1 from alerts where id in (:'a_lic'))
  and (select escalation_level = 1 from alerts where id = :'a_visa')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_lic' and reason = 'Manager')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_visa' and reason = 'Manager'));
select t.ok('other rules and earlier licence steps do not escalate on expiry', (select count(*) = 2 and bool_and(escalation_level = 0) from alerts where id in (:'a_notlic', :'a_lic30'))
  and (select count(*) = 0 from alert_recipients where reason = 'Manager' and alert_id in (:'a_notlic', :'a_lic30')));
select t.ok('unassigned alert with no manager recipient gets the managers, level unchanged',
  (select escalation_level = 0 and assigned_to is null from alerts where id = :'a_un')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_un' and reason = 'Manager')
  and (select count(*) = 2 from notifications where link_scope->>'alert_id' = :'a_un' and user_id in (:'mgr1', :'mgr2')));
select t.ok('backlog row never escalates, adds no manager, sends no bell',
  (select backlog and escalation_level = 0 and escalated_at is null from alerts where id = :'a_bl')
  and (select count(*) = 0 from alert_recipients where alert_id = :'a_bl' and reason = 'Manager')
  and (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'a_bl' and user_id in (:'mgr1', :'mgr2')));

-- Level 1 becomes level 2 later: a fresh bell to managers who are already recipients; the employee stays
select count(*) as o3_bells from notifications where link_scope->>'alert_id' = :'a_o3' and user_id = :'mgr1' \gset
select t.ok('o3 sits at level 1 with one manager bell', (select escalation_level = 1 from alerts where id = :'a_o3') and :o3_bells = 1);
update alerts set due_date = :'today'::date - 3 where id = :'a_o3';
select alert_escalate_due() as changed2 \gset
select t.ok('3 days reaches level 2 with a fresh bell to managers, employee stays',
  (select escalation_level = 2 from alerts where id = :'a_o3')
  and (select count(*) = 2 and bool_and(n = 2) from (select user_id, count(*) n from notifications where link_scope->>'alert_id' = :'a_o3' and user_id in (:'mgr1', :'mgr2') group by user_id) x)
  and (select count(*) = 1 from alert_recipients where alert_id = :'a_o3' and user_id = :'emp1' and reason = 'Assigned')
  and :changed2 >= 1);

-- A third run changes nothing
select count(*) as bells_mid from notifications where type = 'alert_centre' \gset
select count(*) as events_mid from alert_events \gset
select alert_escalate_due() as changed3 \gset
select t.ok('a second run changes nothing: no rows, no bells, no events', :changed3 = 0
  and (select count(*) = :bells_mid from notifications where type = 'alert_centre') and (select count(*) = :events_mid from alert_events));

-- Fallback to the admins when nobody is tagged
create temp table t4_saved_roles as select * from banking_user_roles;
create temp table t4_saved_hr as select * from hr_employees;
delete from banking_user_roles; delete from hr_employees;
select alert_raise('r', 't4-fb', 'CL000001', 'Fallback overdue', 'Business Setup', :'today'::date - 1, 1, 'High', :'emp1', 't', 'i') as a_fb \gset
select alert_escalate_due();
select t.ok('no tagged manager falls back to the admins and records fell_back',
  (select fell_back and escalation_level = 1 from alerts where id = :'a_fb')
  and (select count(*) = 2 and bool_and(reason = 'Manager') from alert_recipients where alert_id = :'a_fb' and user_id in (select id from profiles where role = 'admin')));
insert into banking_user_roles select * from t4_saved_roles;
insert into hr_employees select * from t4_saved_hr;
select t.ok('tags restored', (select count(*) = 2 from alert_managers()));

-- ═══ The scan escalates only in Live ═════════════════════════════════
select alert_raise('r', 't4-scan', 'CL000001', 'Scan overdue', 'Business Setup', :'today'::date - 1, 1, 'High', :'emp1', 't', 'i') as a_scan \gset
select alert_raise('r', 't4-scan-un', 'CL000001', 'Scan lost owner', 'Business Setup', :'today'::date + 4, 1, 'Normal', :'emp1', 't', 'i') as a_scan_un \gset
update alerts set assigned_to = null where id = :'a_scan_un';
select count(*) as bells_scan from notifications where type = 'alert_centre' \gset

update alert_settings set value = '"Preview"' where key = 'alert_mode';
select alert_scan() as scanned \gset
select t.ok('a scan in Preview escalates nothing',
  (select escalation_level = 0 and escalated_at is null from alerts where id = :'a_scan')
  and (select count(*) = 0 from alert_recipients where alert_id in (:'a_scan', :'a_scan_un') and reason = 'Manager')
  and (select status = 'Ok' and not rule_counts ? 'escalation' from alert_scan_log order by id desc limit 1)
  and (select count(*) = :bells_scan from notifications where type = 'alert_centre'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';
select alert_scan() as scanned \gset
select t.ok('a scan in Triage escalates nothing',
  (select escalation_level = 0 from alerts where id = :'a_scan')
  and (select count(*) = 0 from alert_recipients where alert_id in (:'a_scan', :'a_scan_un') and reason = 'Manager')
  and (select status = 'Ok' and not rule_counts ? 'escalation' from alert_scan_log order by id desc limit 1));
update alert_settings set value = '"Live"' where key = 'alert_mode';
select alert_scan() as scanned \gset
select t.ok('a scan in Live calls alert_escalate_due and succeeds',
  (select escalation_level = 1 from alerts where id = :'a_scan')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_scan' and reason = 'Manager')
  and (select count(*) = 2 from alert_recipients where alert_id = :'a_scan_un' and reason = 'Manager')
  and (select status = 'Ok' and error is null from alert_scan_log order by id desc limit 1));

-- ═══ Client owners ═══════════════════════════════════════════════════
insert into profiles values
  ('00000000-0000-0000-0000-0000000000d1', 'Twin Name', 'd1@x', 'member'),
  ('00000000-0000-0000-0000-0000000000d2', ' twin name ', 'd2@x', 'member');
insert into client_master (client_id, legal_name, data) values
  ('T4A', 'T4 Alpha', jsonb_build_object('Accountant', '  employee ONE  ')),
  ('T4B', 'T4 Bravo', jsonb_build_object('Accountant', 'Employee One')),
  ('T4C', 'T4 Charlie', jsonb_build_object('Accountant', 'Twin Name')),
  ('T4D', 'T4 Delta', jsonb_build_object('Accountant', 'Nobody Here')),
  ('T4E', 'T4 Echo', jsonb_build_object('Accountant', 'Employee Two')),
  ('T4F', 'T4 Foxtrot', null),
  ('T4G', 'T4 Golf', null),
  ('T4H', 'T4 Hotel', null);
insert into business_setup_kyc_profiles (client_id, client_status, jurisdiction) values ('T4G', 'Active', 'Dubai Mainland');
insert into accounting_job_list (client_id, client_name, service_name, service_department, assignee_ids, work_status) values
  ('T4B', 'T4 Bravo', 'j1', 'Accounting', array[:'emp2']::uuid[], 'In progress'),
  ('T4B', 'T4 Bravo', 'j2', 'Accounting', array[:'emp2', :'emp1']::uuid[], 'In progress'),
  ('T4B', 'T4 Bravo', 'j3', 'Accounting', array[:'emp2']::uuid[], 'In progress'),
  ('T4B', 'T4 Bravo', 'j4', 'Accounting', array[:'emp1']::uuid[], 'In progress'),
  ('T4B', 'T4 Bravo', 'j5', 'Accounting', null, 'In progress');
insert into client_owners (client_id, department, owner_id) values ('T4E', 'Accounting', :'emp1');

-- Alerts for client T4G: one of each kind
select alert_raise('r', 't4g-open', 'T4G', 'G open unassigned', 'Accounting', :'today'::date + 9, 1, 'Normal', null, 't', 'i') as g_open \gset
select alert_raise('r', 't4g-open2', 'T4G', 'G open unassigned two', 'Accounting', :'today'::date + 9, 1, 'Normal', null, 't', 'i') as g_open2 \gset
select alert_raise('r', 't4g-has', 'T4G', 'G already assigned', 'Accounting', :'today'::date + 9, 1, 'Normal', :'emp1', 't', 'i') as g_has \gset
select alert_raise('r', 't4g-bs', 'T4G', 'G other department', 'Business Setup', :'today'::date + 9, 1, 'Normal', null, 't', 'i') as g_bs \gset
select alert_raise('r', 't4g-closed', 'T4G', 'G closed', 'Accounting', :'today'::date + 9, 1, 'Normal', null, 't', 'i') as g_closed \gset
update alerts set status = 'Resolved', resolved_at = now(), resolved_by_system = true where id = :'g_closed';
select alert_raise('r', 't4h-open', 'T4H', 'H other client', 'Accounting', :'today'::date + 9, 1, 'Normal', null, 't', 'i') as h_open \gset

-- permission
select set_config('test.uid', :'emp1', false);
select t.fails('untagged member cannot set owners', format('select client_owners_set(%L, array[%L], %L)', 'Accounting', 'T4G', :'emp1'), 'You do not have');
select t.fails('untagged member cannot list owners', 'select * from client_owner_list()', 'You do not have');
select t.fails('untagged member cannot see proposals', $q$select * from client_owner_proposals('Accounting')$q$, 'You do not have');
select set_config('test.uid', '', false);
select t.fails('nobody signed in cannot set owners', format('select client_owners_set(%L, array[%L], %L)', 'Accounting', 'T4G', :'emp1'), 'You do not have');
select t.ok('refusals saved nothing', (select count(*) = 0 from client_owners where client_id = 'T4G'));

-- proposals save nothing
select count(*) as owners_before from client_owners \gset
select count(*) as assigned_before from alerts where assigned_to is not null \gset
select md5(string_agg(id::text || coalesce(assigned_to::text, ''), ',' order by id)) as alerts_sig_before from alerts \gset
select set_config('test.uid', :'mgr1', false);
select t.ok('proposals: job assignees win, text names match exactly and ignore case and spaces, twins and unknowns are skipped',
  (select count(*) = 2 from client_owner_proposals('Accounting') where client_id like 'T4%')
  and (select owner_id = :'emp2' and basis = 'Most frequent job assignee' from client_owner_proposals('Accounting') where client_id = 'T4B')
  and (select owner_id = :'emp1' and basis = 'Accountant text matched to a staff name' from client_owner_proposals('Accounting') where client_id = 'T4A')
  and not exists (select 1 from client_owner_proposals('Accounting') where client_id in ('T4C', 'T4D', 'T4E', 'T4F', 'T4G', 'T4H')));
select t.ok('proposals for another department are empty', (select count(*) = 0 from client_owner_proposals('Business Setup')));
select t.ok('proposals save nothing',
  (select count(*) = :owners_before from client_owners)
  and (select count(*) = :assigned_before from alerts where assigned_to is not null)
  and (select md5(string_agg(id::text || coalesce(assigned_to::text, ''), ',' order by id)) = :'alerts_sig_before' from alerts)
  and (select provolatile = 's' from pg_proc where oid = 'client_owner_proposals(text)'::regprocedure));
select set_config('test.uid', :'adm', false);
select t.ok('admin can read proposals too', (select count(*) = 2 from client_owner_proposals('Accounting') where client_id like 'T4%'));

-- list
select set_config('test.uid', :'mgr1', false);
select t.ok('list has one row per client and department, owner null when unset',
  (select count(*) = (select count(*) from service_departments) and bool_and(owner_id is null) from client_owner_list() where client_id = 'T4F')
  and (select count(distinct department) = (select count(*) from service_departments) from client_owner_list() where client_id = 'T4G'));
select t.ok('list joins the KYC profile and the owner',
  (select client_status = 'Active' and jurisdiction = 'Dubai Mainland' and legal_name = 'T4 Golf' from client_owner_list() where client_id = 'T4G' limit 1)
  and (select client_status is null and jurisdiction is null from client_owner_list() where client_id = 'T4F' limit 1)
  and (select owner_id = :'emp1' from client_owner_list() where client_id = 'T4E' and department = 'Accounting')
  and (select owner_id is null from client_owner_list() where client_id = 'T4E' and department = 'Business Setup'));

-- set: manager, Accounting
select client_owners_set('Accounting', array['T4G', 'NOT-A-CLIENT'], :'emp2') as set_n \gset
select t.ok('owners set returns the clients set and ignores unknown ids', :set_n = 1);
select t.ok('owner row saved with the person who set it',
  (select owner_id = :'emp2' and assigned_by = :'mgr1' and assigned_at is not null from client_owners where client_id = 'T4G' and department = 'Accounting')
  and (select count(*) = 0 from client_owners where client_id = 'NOT-A-CLIENT'));
select t.ok('owners set assigns open unassigned alerts of that client and department only',
  (select count(*) = 2 and bool_and(assigned_to = :'emp2') from alerts where id in (:'g_open', :'g_open2'))
  and (select count(*) = 2 and bool_and(reason = 'Assigned') from alert_recipients where alert_id in (:'g_open', :'g_open2') and user_id = :'emp2')
  and (select assigned_to = :'emp1' from alerts where id = :'g_has')
  and (select assigned_to is null from alerts where id = :'g_bs')
  and (select assigned_to is null and status = 'Resolved' from alerts where id = :'g_closed')
  and (select assigned_to is null from alerts where id = :'h_open'));
select t.ok('assignment writes events and bells the new owner',
  (select count(*) = 2 from alert_events where alert_id in (:'g_open', :'g_open2') and event = 'assigned' and detail->>'to' = :'emp2')
  and (select count(*) = 2 from notifications where user_id = :'emp2' and link_scope->>'alert_id' in (:'g_open', :'g_open2'))
  and (select count(*) = 0 from alert_events where alert_id in (:'g_has', :'g_bs', :'g_closed', :'h_open') and event = 'assigned'));
select t.ok('managers stay on the alerts that were unassigned', (select count(*) = 2 from alert_recipients where alert_id = :'g_open' and reason = 'Manager'));

-- a tagged manager reassigns an owner, any department
select set_config('test.uid', :'mgr2', false);
select client_owners_set('Accounting', array['T4G'], :'emp1') as re_acc \gset
select client_owners_set('Business Setup', array['T4G', 'T4H'], :'emp1') as re_bs \gset
select t.ok('tagged manager can reassign an owner in any department',
  :re_acc = 1 and :re_bs = 2
  and (select count(*) = 1 and bool_and(owner_id = :'emp1' and assigned_by = :'mgr2') from client_owners where client_id = 'T4G' and department = 'Accounting')
  and (select count(*) = 2 from client_owners where department = 'Business Setup' and client_id in ('T4G', 'T4H') and owner_id = :'emp1'));
select t.ok('the Business Setup owner took the open Business Setup alert, the reassigned Accounting owner left old alerts alone',
  (select assigned_to = :'emp1' from alerts where id = :'g_bs')
  and (select count(*) = 2 and bool_and(assigned_to = :'emp2') from alerts where id in (:'g_open', :'g_open2')));
select set_config('test.uid', :'adm', false);
select t.ok('admin can set owners', client_owners_set('Accounting', array['T4F'], :'emp2') = 1 and client_owners_set('Accounting', array[]::text[], :'emp2') = 0 and client_owners_set('Accounting', null, :'emp2') = 0);
select t.fails('unknown department is refused', format('select client_owners_set(%L, array[%L], %L)', 'Nope', 'T4G', :'emp1'), 'department');
select t.fails('unknown owner is refused', format('select client_owners_set(%L, array[%L], %L)', 'Accounting', 'T4G', 'ffffffff-ffff-ffff-ffff-ffffffffffff'), 'owner');
select t.fails('no owner is refused', format('select client_owners_set(%L, array[%L], null)', 'Accounting', 'T4G'), 'owner');

-- a proposal is gone once confirmed
select t.ok('a client with an owner is no longer proposed', (select count(*) = 2 from client_owner_proposals('Accounting') where client_id like 'T4%'));
select client_owners_set('Accounting', array['T4A', 'T4B'], :'emp1');
select t.ok('after confirming, nothing is proposed for them', (select count(*) = 0 from client_owner_proposals('Accounting') where client_id like 'T4%'));

-- a client added after the seed has no owner: unassigned, to the managers
select set_config('test.uid', '', false);
insert into client_master (client_id, legal_name, data) values ('T4N', 'T4 New Client', null);
insert into business_setup_kyc_profiles (client_id, client_status, licence_expiry) values ('T4N', 'Active', :'today'::date + 20);
select count(*) as new_bells from notifications where type = 'alert_centre' and user_id in (:'mgr1', :'mgr2') \gset
select alert_scan() as scanned \gset
select t.ok('client added after the seed has no owner, its alert is Unassigned and goes to the manager',
  (select status = 'Ok' from alert_scan_log order by id desc limit 1)
  and (select count(*) = 1 and bool_and(assigned_to is null and not backlog) from alerts where rule_code = 'licence_expiry' and client_id = 'T4N')
  and (select count(*) = 2 and bool_and(reason = 'Manager') from alert_recipients r join alerts a on a.id = r.alert_id where a.client_id = 'T4N' and a.rule_code = 'licence_expiry')
  and (select count(*) = 2 from notifications n join alerts a on a.id::text = n.link_scope->>'alert_id' where a.client_id = 'T4N' and n.user_id in (:'mgr1', :'mgr2')));
select set_config('test.uid', :'mgr1', false);
select t.ok('the new client shows in the owner list with no owner',
  (select count(*) = (select count(*) from service_departments) and bool_and(owner_id is null) from client_owner_list() where client_id = 'T4N'));
select set_config('test.uid', :'adm', false);
select client_owners_set('Business Setup', array['T4N'], :'emp2') as n_set \gset
select t.ok('setting an owner assigns the new client alert',
  :n_set = 1
  and (select assigned_to = :'emp2' from alerts where client_id = 'T4N' and rule_code = 'licence_expiry'));

-- ═══ Rule steps, mode and Run now ════════════════════════════════════
select steps as job_steps from alert_rules where code = 'job_due' \gset
select enabled as job_enabled from alert_rules where code = 'job_due' \gset
select steps as crm_steps from alert_rules where code = 'crm_task_due' \gset
select set_config('test.uid', :'mgr1', false);
select t.fails('a tagged manager is not an admin: cannot save a rule', $q$select alert_rule_save('job_due', true, '[{"days":1,"priority":"High"}]')$q$, 'You do not have');
select t.fails('a tagged manager cannot set the mode', $q$select alert_set_mode('Preview')$q$, 'You do not have');
select t.fails('a tagged manager cannot run the scan', 'select alert_scan_now()', 'You do not have');
select set_config('test.uid', :'emp1', false);
select t.fails('an employee cannot save a rule', $q$select alert_rule_save('job_due', true, '[]')$q$, 'You do not have');
select set_config('test.uid', :'adm', false);
select t.fails('bad step priority refused', $q$select alert_rule_save('job_due', true, '[{"days":1,"priority":"Bogus"}]')$q$, 'priority');
select t.fails('Urgent refused as a priority', $q$select alert_rule_save('job_due', true, '[{"days":1,"priority":"Urgent"}]')$q$, 'priority');
select t.fails('lower case priority refused', $q$select alert_rule_save('job_due', true, '[{"days":1,"priority":"high"}]')$q$, 'priority');
select t.fails('missing priority refused', $q$select alert_rule_save('job_due', true, '[{"days":1}]')$q$, 'priority');
select t.fails('fractional days refused', $q$select alert_rule_save('job_due', true, '[{"days":1.5,"priority":"High"}]')$q$, 'days');
select t.fails('text days refused', $q$select alert_rule_save('job_due', true, '[{"days":"1","priority":"High"}]')$q$, 'days');
select t.fails('steps that are not a list refused', $q$select alert_rule_save('job_due', true, '{"days":1,"priority":"High"}')$q$, 'list');
select t.fails('null steps refused', $q$select alert_rule_save('job_due', true, null)$q$, 'list');
select t.fails('two steps with the same days refused', $q$select alert_rule_save('job_due', true, '[{"days":1,"priority":"High"},{"days":1,"priority":"Medium"}]')$q$, 'same days');
select t.fails('unknown rule refused', $q$select alert_rule_save('nope_rule', true, '[]')$q$, 'does not exist');
select t.ok('refused saves left the rule alone', (select steps = :'job_steps'::jsonb and enabled = :'job_enabled'::boolean from alert_rules where code = 'job_due'));
select alert_rule_save('job_due', false, '[{"days":7,"priority":"Normal"},{"days":-2,"priority":"Critical"}]');
select t.ok('admin saves steps and the enabled flag', (select not enabled and steps = '[{"days":7,"priority":"Normal"},{"days":-2,"priority":"Critical"}]'::jsonb from alert_rules where code = 'job_due'));
select alert_rule_save('job_due', null, :'job_steps'::jsonb);
select alert_rule_save('job_due', true, :'job_steps'::jsonb);
select t.ok('and restores them, null enabled keeps the flag', (select enabled and steps = :'job_steps'::jsonb from alert_rules where code = 'job_due'));
select alert_rule_save('crm_task_due', true, '[]');
select t.ok('an empty step list is allowed', (select steps = '[]'::jsonb from alert_rules where code = 'crm_task_due'));
select alert_rule_save('crm_task_due', true, :'crm_steps'::jsonb);
select t.ok('and the seeded steps are back', (select steps = :'crm_steps'::jsonb from alert_rules where code = 'crm_task_due'));

select t.fails('bad mode refused', $q$select alert_set_mode('Urgent')$q$, 'Mode must');
select t.fails('null mode refused', $q$select alert_set_mode(null)$q$, 'Mode must');
select t.fails('lower case mode refused', $q$select alert_set_mode('live')$q$, 'Mode must');
select t.ok('mode unchanged after refusals', alert_mode() = 'Live');
select alert_set_mode('Triage');
select t.ok('admin sets Triage', alert_mode() = 'Triage');
select alert_set_mode('Preview');
select t.ok('admin sets Preview', alert_mode() = 'Preview');
select alert_set_mode('Live');
select t.ok('admin sets Live, one settings row', alert_mode() = 'Live' and (select count(*) = 1 from alert_settings where key = 'alert_mode'));

-- Run now as the browser role. alert_scan itself is not granted to it.
reset role;
select set_config('test.uid', :'adm', false);
select count(*) as logs_before from alert_scan_log \gset
set role authenticated;
select t.fails('the browser role cannot call alert_scan directly', 'select alert_scan()', 'permission denied');
select alert_scan_now()->>'status' as now_status \gset
reset role;
select t.ok('admin Run now works through the browser role', :'now_status' = 'Ok' and (select count(*) = :logs_before + 1 from alert_scan_log) and (select status = 'Ok' from alert_scan_log order by id desc limit 1));
set role authenticated;
select set_config('test.uid', :'mgr1', false);
select t.fails('browser role: manager cannot Run now', 'select alert_scan_now()', 'You do not have');
select set_config('test.uid', :'emp1', false);
select t.fails('browser role: employee cannot Run now', 'select alert_scan_now()', 'You do not have');
reset role;
select set_config('test.uid', '', false);

-- ═══ Grants ══════════════════════════════════════════════════════════
select t.ok('alert_escalate_due is executable by postgres and service_role only',
  has_function_privilege('postgres', 'alert_escalate_due()', 'execute') and has_function_privilege('service_role', 'alert_escalate_due()', 'execute')
  and not has_function_privilege('authenticated', 'alert_escalate_due()', 'execute') and not has_function_privilege('anon', 'alert_escalate_due()', 'execute')
  and (select count(*) = 0 from pg_proc p where p.oid = 'alert_escalate_due()'::regprocedure
       and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')));
select t.ok('internal helpers are not browser-callable',
  not has_function_privilege('authenticated', 'alert_can_act(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'alert_notify_managers(uuid,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'alert_set_assignee(uuid,uuid)', 'execute')
  and not has_function_privilege('authenticated', 'alert_scan()', 'execute'));
select t.ok('the eleven browser actions and owner functions are executable by authenticated, not by anon or public',
  (select count(*) = 11 and bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
       and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
   from pg_proc p where p.oid in ('alert_assign(uuid,uuid)'::regprocedure, 'alert_set_status(uuid,text)'::regprocedure, 'alert_resolve(uuid,text,boolean)'::regprocedure,
     'alert_escalate(uuid,text)'::regprocedure, 'alert_mark_read(uuid)'::regprocedure, 'alert_rule_save(text,boolean,jsonb)'::regprocedure,
     'alert_set_mode(text)'::regprocedure, 'alert_scan_now()'::regprocedure, 'client_owner_list()'::regprocedure,
     'client_owner_proposals(text)'::regprocedure, 'client_owners_set(text,text[],uuid)'::regprocedure)));
set role anon;
select t.fails('anon cannot assign', format('select alert_assign(%L, %L)', :'a_open', :'emp1'), 'permission denied');
select t.fails('anon cannot list owners', 'select * from client_owner_list()', 'permission denied');
select t.fails('anon cannot set owners', $q$select client_owners_set('Accounting', array['T4G'], null)$q$, 'permission denied');
reset role;

-- run-local.sh expects the tests to leave the mode on Live.
update alert_settings set value = '"Live"' where key = 'alert_mode';
