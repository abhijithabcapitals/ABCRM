-- Step function and rule seed. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

select steps as lic from alert_rules where code = 'licence_expiry' \gset
select steps as visa from alert_rules where code = 'visa_expiry' \gset
select steps as task from alert_rules where code = 'job_due' \gset

select t.ok('91 days is outside', (select count(*) = 0 from alert_step_for(:'lic', 91)));
select t.ok('90 is Medium', (select priority = 'Medium' from alert_step_for(:'lic', 90)));
select t.ok('61 is step 90', (select step = 90 from alert_step_for(:'lic', 61)));
select t.ok('30 is High', (select priority = 'High' from alert_step_for(:'lic', 30)));
select t.ok('0 is still High', (select priority = 'High' from alert_step_for(:'lic', 0)));
select t.ok('expired is Critical', (select priority = 'Critical' and step = -1 from alert_step_for(:'lic', -1)));
select t.ok('visa 5 is step 7', (select step = 7 from alert_step_for(:'visa', 5)));
select t.ok('visa 16 is step 30', (select step = 30 from alert_step_for(:'visa', 16)));
select t.ok('due in 2 days is outside', (select count(*) = 0 from alert_step_for(:'task', 2)));
select t.ok('due tomorrow Medium', (select priority = 'Medium' from alert_step_for(:'task', 1)));
select t.ok('due today High', (select priority = 'High' from alert_step_for(:'task', 0)));
select t.ok('overdue 2 days High', (select priority = 'High' from alert_step_for(:'task', -2)));
select t.ok('overdue 3 days Critical', (select priority = 'Critical' from alert_step_for(:'task', -3)));
select t.ok('unsorted steps still work', (select step = 10 from alert_step_for('[{"days":30,"priority":"High"},{"days":10,"priority":"Medium"}]', 5)));
select t.ok('empty steps give no row', (select count(*) = 0 from alert_step_for('[]', 0)));

select t.ok('seven rules seeded', (select count(*) = 7 from alert_rules where code in ('licence_expiry','visa_expiry','job_due','service_due','setup_task_due','banking_task_due','crm_task_due')));
select t.ok('crm_task_due has null department', (select department is null from alert_rules where code = 'crm_task_due'));
select t.ok('departments as specified', (select string_agg(code || '=' || coalesce(department, '-'), ',' order by code) =
  'banking_task_due=Business Banking,crm_task_due=-,job_due=Accounting,licence_expiry=Business Setup,service_due=Business Setup,setup_task_due=Business Setup,visa_expiry=Business Setup'
  from alert_rules where code <> 'r'));
select t.ok('titles and actions as ruled', (select
  (select title_template = 'Licence expiry: {subject}' and action_template = 'Confirm the licence date, then start the renewal.' from alert_rules where code = 'licence_expiry')
  and (select title_template = 'Visa expiry: {subject}' and action_template = 'Confirm the visa date, then start the renewal or cancellation.' from alert_rules where code = 'visa_expiry')
  and (select count(*) = 5 and bool_and(title_template = 'Due: {subject}' and action_template = 'Complete this item or update its due date.' and category = 'Deadlines')
       from alert_rules where code in ('job_due','service_due','setup_task_due','banking_task_due','crm_task_due'))));
select t.ok('stored priorities are valid', (select bool_and(s->>'priority' in ('Critical','High','Medium','Normal'))
  from alert_rules r, jsonb_array_elements(r.steps) s where r.code <> 'r'));

-- Reapply keeps edited steps
update alert_rules set steps = '[{"days":5,"priority":"Normal"}]' where code = 'job_due';
\ir ../migrations/002_alert_scan.sql
select t.ok('reapply keeps edited steps', (select steps = '[{"days":5,"priority":"Normal"}]'::jsonb from alert_rules where code = 'job_due'));
update alert_rules set steps = :'task' where code = 'job_due';

-- Grants
select t.ok('authenticated cannot run alert_step_for', not has_function_privilege('authenticated', 'alert_step_for(jsonb,int)', 'execute'));
select t.ok('anon cannot run alert_step_for', not has_function_privilege('anon', 'alert_step_for(jsonb,int)', 'execute'));
select t.ok('public cannot run alert_step_for', (select count(*) = 0 from pg_proc p
  where p.oid = 'alert_step_for(jsonb,int)'::regprocedure
  and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')));
