-- Alert core. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into client_master values ('CL000001', 'TEST Client', '{}');
insert into profiles values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin One', 'a1@x', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Admin Two', 'a2@x', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Manager Banking', 'b1@x', 'member'),
  ('00000000-0000-0000-0000-0000000000b2', 'Manager HR', 'b2@x', 'member'),
  ('00000000-0000-0000-0000-0000000000b3', 'Manager Inactive', 'b3@x', 'member'),
  ('00000000-0000-0000-0000-0000000000c1', 'Employee One', 'c1@x', 'member'),
  ('00000000-0000-0000-0000-0000000000c2', 'Employee Two', 'c2@x', 'member'),
  ('00000000-0000-0000-0000-0000000000c3', 'Employee Leaver', 'c3@x', 'member');
insert into alert_rules (code, category, department, title_template, action_template)
values ('r', 'Licence', 'Business Setup', 'Licence expiry: {subject}', 'Start the renewal');

-- Managers
select t.ok('no tagged manager falls back to admins', (select bool_and(fell_back) and count(*) = 2 from alert_managers()));
insert into banking_user_roles values ('00000000-0000-0000-0000-0000000000b1', 'MANAGER'), ('00000000-0000-0000-0000-0000000000c2', 'STAFF');
insert into hr_employees (profile_id, status, designation) values
  ('00000000-0000-0000-0000-0000000000b2', 'Active', 'Manager'),
  ('00000000-0000-0000-0000-0000000000b3', 'Inactive', 'Manager'),
  ('00000000-0000-0000-0000-0000000000c1', 'Active', 'Accountant');
select t.ok('both tag sources count, inactive HR manager excluded',
  (select count(*) = 2 and bool_and(not fell_back) and array_agg(user_id order by user_id) = array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2']::uuid[] from alert_managers()));
select t.ok('alert mode starts as Preview', alert_mode() = 'Preview');

-- Preview
select alert_raise('r', 'k1', 'CL000001', 'Acme LLC', 'Business Setup', current_date + 30, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 'business_setup_kyc_profiles', 'x') as k1_id \gset
select t.ok('preview raise is backlog', (select backlog from alerts where dedupe_key = 'k1'));
select t.ok('title, category, action and number come from the rule', (select title = 'Licence expiry: Acme LLC' and category = 'Licence' and action_required = 'Start the renewal' and department = 'Business Setup' and alert_number ~ '^ALT-[0-9]{6}$' from alerts where dedupe_key = 'k1'));
select t.ok('assigned employee is a recipient even in Preview', (select count(*) = 1 from alert_recipients where alert_id = :'k1_id' and reason = 'Assigned'));
select t.ok('preview writes no bell', (select count(*) = 0 from notifications where type = 'alert_centre'));
select alert_raise('r', 'k1', 'CL000001', 'Acme LLC renamed', 'Business Setup', current_date + 20, 1, 'Normal', '00000000-0000-0000-0000-0000000000c1', 'business_setup_kyc_profiles', 'x');
select t.ok('second raise keeps one row', (select count(*) = 1 from alerts where dedupe_key = 'k1'));
select t.ok('same step refreshes subject and due date only', (select subject = 'Acme LLC renamed' and due_date = current_date + 20 and priority = 'High' and title = 'Licence expiry: Acme LLC' from alerts where dedupe_key = 'k1'));
select t.ok('raised event written once', (select count(*) = 1 from alert_events where alert_id = :'k1_id' and event = 'raised'));
select t.fails('missing rule raises an error', $q$select alert_raise('nope', 'kx', null, 's', null, null, 1, 'Normal', null, 't', 'i')$q$, 'does not exist');

select alert_raise('r', 'k3', 'CL000001', 'Three', 'Business Setup', current_date + 30, 1, 'Medium', '00000000-0000-0000-0000-0000000000c1', 't', 'i') as k3_id \gset
select alert_raise('r', 'k7', null, 'Unassigned', 'Business Setup', current_date + 30, 1, 'Normal', null, 't', 'i') as k7_id \gset
select t.ok('unassigned alert goes to both managers, no fallback', (select count(*) = 2 and bool_and(reason = 'Manager') from alert_recipients where alert_id = :'k7_id') and (select not fell_back and client_id is null from alerts where id = :'k7_id'));

-- Who sees what in Preview
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', false);
select t.ok('member sees nothing in Preview', not alert_can_see(:'k1_id') and (select count(*) = 0 from alerts));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b1', false);
select t.ok('tagged manager sees nothing in Preview', (select count(*) = 0 from alerts));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select t.ok('admin sees everything in Preview', alert_can_see(:'k1_id') and (select count(*) = 3 from alerts));
select t.fails('browser cannot insert', $q$insert into alerts (title) values ('x')$q$, 'permission denied');
select t.fails('browser cannot update', $q$update alerts set title = 'x'$q$, 'permission denied');
select t.fails('browser cannot read recipients', 'select * from alert_recipients', 'permission denied');
select t.fails('browser cannot read events', 'select * from alert_events', 'permission denied');
select t.fails('browser cannot read rules', 'select * from alert_rules', 'permission denied');
select t.fails('browser cannot read settings', 'select * from alert_settings', 'permission denied');
select t.fails('browser cannot raise', $q$select alert_raise('r', 'kz', null, 's', null, null, 1, 'Normal', null, 't', 'i')$q$, 'permission denied');
select t.fails('browser cannot add a recipient', format('select alert_add_recipient(%L, %L, %L)', :'k1_id', auth.uid(), 'Manager'), 'permission denied');
reset role;

-- Live
update alert_settings set value = '"Live"' where key = 'alert_mode';
select alert_raise('r', 'k1', 'CL000001', 'Acme LLC renamed', 'Business Setup', current_date + 20, 1, 'Normal', '00000000-0000-0000-0000-0000000000c1', 'business_setup_kyc_profiles', 'x');
select t.ok('backlog row stays backlog on a same-step raise', (select backlog from alerts where dedupe_key = 'k1'));
select alert_add_recipient(:'k1_id', '00000000-0000-0000-0000-0000000000c2', 'Manager');
select t.ok('backlog row gets a recipient but no bell', (select count(*) = 2 from alert_recipients where alert_id = :'k1_id') and (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'k1_id'));

select alert_raise('r', 'k3', 'CL000001', 'Three', 'Business Setup', current_date + 10, 2, 'Medium', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select t.ok('step change clears backlog outside Preview', (select not backlog and current_step = 2 from alerts where dedupe_key = 'k3'));
select t.ok('step change bells once', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'k3_id'));
select t.ok('bell carries title, action, type and no task', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'k3_id' and type = 'alert_centre' and title = 'Licence expiry: Three' and body = 'Start the renewal' and task_id is null and user_id = '00000000-0000-0000-0000-0000000000c1'));
select t.ok('step change event written', (select count(*) = 1 from alert_events where alert_id = :'k3_id' and event = 'step changed'));
select alert_raise('r', 'k3', 'CL000001', 'Three', 'Business Setup', current_date + 10, 2, 'Critical', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select t.ok('same step again sends no second bell and keeps priority', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'k3_id') and (select priority = 'Medium' from alerts where dedupe_key = 'k3'));

select alert_raise('r', 'k2', 'CL000001', 'Two', 'Business Setup', current_date + 30, 1, 'Medium', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select alert_raise('r', 'k2', 'CL000001', 'Two', 'Business Setup', current_date + 20, 2, 'Critical', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select alert_raise('r', 'k2', 'CL000001', 'Two', 'Business Setup', current_date + 10, 3, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select t.ok('priority never falls', (select priority = 'Critical' and current_step = 3 from alerts where dedupe_key = 'k2'));

select alert_raise('r', 'k4', 'CL000001', 'Four', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
update alerts set status = 'Resolved', resolved_at = now(), resolved_by = '00000000-0000-0000-0000-0000000000c1' where dedupe_key = 'k4';
select t.ok('person-resolved stays resolved', alert_raise('r', 'k4', 'CL000001', 'Four', 'Business Setup', current_date, 2, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i') is null);
select t.ok('person-resolved row is unchanged', (select status = 'Resolved' and current_step = 1 from alerts where dedupe_key = 'k4'));
select alert_raise('r', 'k4b', 'CL000001', 'Four B', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
update alerts set status = 'Dismissed' where dedupe_key = 'k4b';
select t.ok('dismissed stays dismissed', alert_raise('r', 'k4b', 'CL000001', 'Four B', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i') is null);

select alert_raise('r', 'k5', 'CL000001', 'Five', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i') as k5_id \gset
update alerts set status = 'Resolved', resolved_at = now(), resolved_by_system = true where dedupe_key = 'k5';
select alert_raise('r', 'k5', 'CL000001', 'Five', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i');
select t.ok('system-resolved reopens', (select status = 'Open' and resolved_at is null and not resolved_by_system from alerts where dedupe_key = 'k5'));
select t.ok('reopen event written', (select count(*) = 1 from alert_events where alert_id = :'k5_id' and event = 'reopened'));

select alert_raise('r', 'k6', 'CL000001', 'Six', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c3', 't', 'i');
delete from profiles where id = '00000000-0000-0000-0000-0000000000c3';
select t.ok('deleted owner returns to unassigned', (select assigned_to is null from alerts where dedupe_key = 'k6'));

select alert_raise('r', 'k9', 'CL000001', 'Nine', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i', null, null, array['00000000-0000-0000-0000-0000000000c2']::uuid[]) as k9_id \gset
select t.ok('extra recipients are added as Assigned and belled', (select count(*) = 2 and bool_and(reason = 'Assigned') from alert_recipients where alert_id = :'k9_id') and (select count(*) = 2 from notifications where link_scope->>'alert_id' = :'k9_id'));
select alert_raise('r', 'k8', null, 'Eight', 'Business Setup', current_date, 1, 'High', null, 't', 'i') as k8_id \gset
select t.ok('unassigned alert in Live bells both managers', (select count(*) = 2 from notifications where link_scope->>'alert_id' = :'k8_id'));

-- Triage: only reason Assigned bells
update alert_settings set value = '"Triage"' where key = 'alert_mode';
select alert_raise('r', 'k10', 'CL000001', 'Ten', 'Business Setup', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i') as k10_id \gset
select alert_raise('r', 'k11', null, 'Eleven', 'Business Setup', current_date, 1, 'High', null, 't', 'i') as k11_id \gset
select t.ok('triage bells the assigned employee', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'k10_id'));
select t.ok('triage does not bell managers', (select count(*) = 0 from notifications where link_scope->>'alert_id' = :'k11_id') and (select count(*) = 2 from alert_recipients where alert_id = :'k11_id'));
select t.ok('triage raise is not backlog', (select not backlog from alerts where dedupe_key = 'k10'));
update alert_settings set value = '"Live"' where key = 'alert_mode';

-- Fallback to admins, then restore the tags
create temp table saved_roles as select * from banking_user_roles;
create temp table saved_hr as select * from hr_employees;
delete from banking_user_roles; delete from hr_employees;
select alert_raise('r', 'k12', null, 'Twelve', 'Business Setup', current_date, 1, 'High', null, 't', 'i') as k12_id \gset
select t.ok('fallback alert records fell_back and reaches admins', (select fell_back from alerts where dedupe_key = 'k12') and (select count(*) = 2 from alert_recipients where alert_id = :'k12_id'));
insert into banking_user_roles select * from saved_roles;
insert into hr_employees select * from saved_hr;

-- Visibility in Live. Unfiltered figures are taken before the role switch.
select alert_raise('r', 'k13', 'CL000001', 'Thirteen', 'Accounting', current_date, 1, 'High', '00000000-0000-0000-0000-0000000000c1', 't', 'i') as k13_id \gset
insert into client_owners (client_id, department, owner_id) values ('CL000001', 'Business Setup', '00000000-0000-0000-0000-0000000000c1');
select count(*) as total_alerts from alerts \gset
select not exists (select 1 from alert_recipients where alert_id = :'k13_id' and user_id = '00000000-0000-0000-0000-0000000000b2') as k13_unlinked \gset
select t.ok('unfiltered count is meaningful', :total_alerts > 10);
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', false);
select t.ok('untagged member sees only alerts where a recipient', (select count(*) > 0 from alerts) and (select count(*) < :total_alerts from alerts) and (select bool_and(alert_can_see(id)) from alerts)
  and not exists (select 1 from alerts where dedupe_key in ('k7', 'k8', 'k11', 'k12')));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c2', false);
select t.ok('other untagged member sees only their own', (select count(*) = 2 from alerts) and exists (select 1 from alerts where dedupe_key = 'k1') and exists (select 1 from alerts where dedupe_key = 'k9'));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select t.ok('tagged manager sees every alert outside Preview', alert_is_manager() and (select count(*) = :total_alerts from alerts));
select t.ok('tagged manager sees an Accounting alert with no link to them', exists (select 1 from alerts where dedupe_key = 'k13' and department = 'Accounting') and :'k13_unlinked'::boolean);
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', false);
select t.ok('untagged member is not a manager and not an admin', not alert_is_manager() and not alert_is_admin());
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select t.ok('admin is not tagged but sees all', not alert_is_manager() and alert_is_admin() and (select count(*) = :total_alerts from alerts));
select t.ok('client_owners readable by admin', (select count(*) = 1 from client_owners));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select t.ok('client_owners readable by tagged manager', (select count(*) = 1 from client_owners));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c1', false);
select t.ok('client_owners hidden from untagged member, even the owner', (select count(*) = 0 from client_owners));
select t.fails('browser cannot write client_owners', $q$delete from client_owners$q$, 'permission denied');
reset role;

-- Same figures back in Preview: the tagged manager sees none, the admin still sees all
update alert_settings set value = '"Preview"' where key = 'alert_mode';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select t.ok('tagged manager sees none in Preview', (select count(*) = 0 from alerts));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select t.ok('admin still sees all in Preview', (select count(*) = :total_alerts from alerts));
reset role;
update alert_settings set value = '"Live"' where key = 'alert_mode';

-- Grants: authenticated may run only the three policy helpers and the browser actions of 003; anon none; anon cannot read alerts
select t.ok('authenticated runs only the policy helpers, the browser actions and the browser reads',
  (select count(*) = 22 and array_agg(proname::text order by proname) = array['alert_assign', 'alert_calendar', 'alert_can_see', 'alert_coverage', 'alert_detail', 'alert_escalate', 'alert_is_admin', 'alert_is_manager',
     'alert_list', 'alert_management_summary', 'alert_manager_list', 'alert_mark_read', 'alert_my_access', 'alert_preferences_get', 'alert_preferences_save', 'alert_resolve', 'alert_rule_list', 'alert_rule_save', 'alert_scan_now', 'alert_set_mode', 'alert_set_status', 'alert_tiles']
   from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'alert\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
select t.ok('authenticated runs exactly the three client owner functions outside the alert_ names',
  (select count(*) = 3 and array_agg(proname::text order by proname) = array['client_owner_list', 'client_owner_proposals', 'client_owners_set']
   from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'client\_owner%' and has_function_privilege('authenticated', p.oid, 'execute')));
select t.ok('anon and public run no client owner function', (select count(*) = 3 and bool_and(not has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'client\_owner%'));
select t.ok('every alert and client owner function pins its search_path',
  (select count(*) = 0 from pg_proc p where pronamespace = 'public'::regnamespace and (proname like 'alert\_%' or proname like 'client\_owner%')
   and not coalesce('search_path=public, pg_temp' = any (p.proconfig), false)));
select t.ok('there are alert functions to check', (select count(*) >= 9 from pg_proc where pronamespace = 'public'::regnamespace and proname like 'alert\_%'));
select t.ok('anon runs no alert function', (select count(*) = 0 from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'alert\_%' and has_function_privilege('anon', p.oid, 'execute')));
select t.ok('public runs no alert function', (select count(*) = 0 from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'alert\_%'
  and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')));
set role anon;
select t.fails('anon cannot read alerts', 'select * from alerts', 'permission denied');
select t.fails('anon cannot read client_owners', 'select * from client_owners', 'permission denied');
reset role;

select t.ok('alert_owner reads client_owners', alert_owner('CL000001', 'Business Setup') = '00000000-0000-0000-0000-0000000000c1' and alert_owner('CL000001', 'Accounting') is null);
select t.fails('client_owners unique per client and department', $q$insert into client_owners (client_id, department, owner_id) values ('CL000001', 'Business Setup', '00000000-0000-0000-0000-0000000000c2')$q$, 'duplicate key');
select t.fails('events are append-only (update)', $q$update alert_events set event = 'x'$q$, 'append-only');
select t.fails('events are append-only (delete)', $q$delete from alert_events$q$, 'append-only');
select t.fails('priority Urgent is never stored', $q$insert into alerts (title, priority, dedupe_key) values ('x', 'Urgent', 'zz')$q$, 'check constraint');
select t.ok('alert numbers are unique and sequential', (select count(distinct alert_number) = count(*) from alerts));
select t.ok('every table has row security on', (select count(*) = 7 and bool_and(relrowsecurity) from pg_class where relname in ('alert_settings', 'alert_rules', 'client_owners', 'alerts', 'alert_recipients', 'alert_events', 'alert_scan_log') and relkind = 'r'));
