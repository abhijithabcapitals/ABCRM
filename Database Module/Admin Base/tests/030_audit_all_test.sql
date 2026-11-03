-- Prints "ok ..." per check and stops at the first failure. Runs on the throwaway cluster after 020.
\set ON_ERROR_STOP on
create table public.hr_employees (id uuid primary key, profile_id uuid, full_name text);
create table public.hr_things (id serial primary key, employee_id uuid, v text);
grant all on public.hr_things to authenticated;
grant all on all sequences in schema public to authenticated;
select public.audit_trail_attach_all();

-- Employee link
set test.uid = 'ad000000-0000-0000-0000-00000000000a';
set request.jwt.claims = '{"role":"authenticated"}';
insert into public.hr_employees values ('e0000000-0000-0000-0000-000000000001', null, 'Eva');
insert into public.hr_things (employee_id, v) values ('e0000000-0000-0000-0000-000000000001', 'a');
update public.hr_things set v = 'b';
select t2.ok('an employee record is linked to the employee', (select employee_id = 'e0000000-0000-0000-0000-000000000001' from public.audit_trail where table_name = 'hr_employees'));
select t2.ok('a change to their data is linked, even when employee_id did not change', (select count(*) = 2 and bool_and(employee_id = 'e0000000-0000-0000-0000-000000000001') from public.audit_trail where table_name = 'hr_things'));

-- Logins and logouts
insert into auth.sessions (id, user_id, ip, user_agent) values ('50000000-0000-0000-0000-000000000001', 'be000000-0000-0000-0000-00000000000b', '10.0.0.5', 'Chrome');
select t2.ok('a login names the user with IP and browser', (select actor_name = 'Mo Member' and new_values ->> 'ip' like '10.0.0.5%' and new_values ->> 'browser' = 'Chrome' from public.audit_trail where action = 'LOGIN' and row_id = '50000000-0000-0000-0000-000000000001'));
delete from auth.sessions where id = '50000000-0000-0000-0000-000000000001';
select t2.ok('a logout names the user', (select actor_name = 'Mo Member' from public.audit_trail where action = 'LOGOUT' and row_id = '50000000-0000-0000-0000-000000000001'));
alter table public.audit_trail add constraint block_for_test check (action <> 'LOGIN') not valid;
insert into auth.sessions (id, user_id) values ('50000000-0000-0000-0000-000000000002', 'be000000-0000-0000-0000-00000000000b');
select t2.ok('a failed audit entry does not block the login', exists (select 1 from auth.sessions where id = '50000000-0000-0000-0000-000000000002'));
alter table public.audit_trail drop constraint block_for_test;

-- Clicks and page opens
set test.uid = 'be000000-0000-0000-0000-00000000000b';
set role authenticated;
select public.audit_events('[{"kind":"PAGE","page":"hr"},{"kind":"CLICK","page":"hr","label":"Save","element":"button","at":"2026-11-03T10:00:00Z"},{"kind":"INSERT","page":"hr"}]');
select t2.fails('more than 100 events are refused', $$select public.audit_events((select jsonb_agg(jsonb_build_object('kind','CLICK')) from generate_series(1,101)))$$);
reset role;
select t2.ok('page and click are stored under the signed-in user', (select count(*) = 2 and bool_and(actor_name = 'Mo Member' and source = 'browser') from public.audit_trail where action in ('PAGE', 'CLICK')));
select t2.ok('the browser cannot send a data change as an event', not exists (select 1 from public.audit_trail where source = 'browser' and action = 'INSERT'));
select t2.ok('the click keeps its label', (select new_values ->> 'label' = 'Save' and table_name = 'hr' from public.audit_trail where action = 'CLICK'));
set test.uid = '';
select t2.fails('events need a login', $$select public.audit_events('[]')$$);

-- Keeping and removing
alter table public.audit_trail disable trigger audit_trail_lock;
insert into public.audit_trail (at, source, table_schema, table_name, action) values (now() - interval '13 months', 'browser', 'app', 'old', 'CLICK'), (now() - interval '13 months', 'x', 'public', 'old', 'UPDATE'), (now() - interval '13 months', 'auth', 'auth', 'old', 'LOGIN');
alter table public.audit_trail enable trigger audit_trail_lock;
select t2.fails('a recent click cannot be deleted', $$delete from public.audit_trail where action = 'CLICK' and table_name = 'hr'$$);
select t2.fails('an old data change cannot be deleted', $$delete from public.audit_trail where action = 'UPDATE' and table_name = 'old'$$);
select public.audit_trail_purge_old();
select t2.ok('the purge removes only clicks and pages over 12 months', (select count(*) = 2 from public.audit_trail where table_name = 'old') and exists (select 1 from public.audit_trail where action = 'CLICK' and table_name = 'hr'));
select t2.ok('the purge job is scheduled', exists (select 1 from cron.job where jobname = 'audit-trail-purge'));
select 'all audit activity checks passed';
