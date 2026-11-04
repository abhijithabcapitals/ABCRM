-- Zoho invoices for Accounting jobs (Admin Base 005 and 013). Reuses t.ok and t.fails from 010_jobs_test.sql in the same database.
\set ON_ERROR_STOP on

insert into client_master values ('ZC1', 'Zoho Test LLC') on conflict do nothing;
create function t.zjob(st text, inv text default null) returns uuid language sql as $$
  insert into accounting_jobs (client_id, client_name, service_name, work_status, fee_amount, invoice_number)
  values ('ZC1', 'Zoho Test LLC', 'VAT Return', st, 1000, inv) returning id $$;
create function t.fill(j uuid, n text default 'INV-0001', d date default date '2026-11-03', a numeric default 1050) returns jsonb
language sql as $$ select accounting_zoho_invoice_fill(j, n, d, a, '00000000-0000-0000-0000-0000000000f1') $$;
create function t.events(j uuid) returns int language sql as $$ select count(*)::int from accounting_job_events where job_id = j and event = 'Invoice recorded' $$;
create table t.zj (k text primary key, id uuid);
insert into t.zj values ('done', t.zjob('Completed')), ('open', t.zjob('In Progress')), ('typed', t.zjob('Completed', 'INV-TYPED'));
create function t.zid(key text) returns uuid language sql as $$ select id from t.zj where k = key $$;
grant usage on schema t to public;
grant select on t.zj to public;
grant execute on all functions in schema t to public;

-- The widened checks
insert into zoho_documents (department, source_table, source_id, kind, reference, state)
  values ('Accounting', 'accounting_jobs', t.zid('done'), 'invoice', 'JOB-X', 'created');
select t.ok('accounting_values_accepted', (select count(*) from zoho_documents where department = 'Accounting' and source_table = 'accounting_jobs') = 1);
insert into zoho_documents (department, source_table, source_id, kind, reference, state)
  values ('Banking', 'banking_quotations', gen_random_uuid(), 'estimate', 'BQ-X', 'created'),
         ('Business Setup', 'hub_documents', gen_random_uuid(), 'estimate', 'Q-X', 'created');
select t.ok('old_values_still_accepted', (select count(*) from zoho_documents) = 3);
select t.fails('other_department_refused',
  $$insert into zoho_documents (department, source_table, source_id, kind, reference, state) values ('Sales', 'accounting_jobs', gen_random_uuid(), 'invoice', 'R', 'created')$$,
  'zoho_documents_department_check');
select t.fails('other_source_refused',
  $$insert into zoho_documents (department, source_table, source_id, kind, reference, state) values ('Accounting', 'accounting_payments', gen_random_uuid(), 'invoice', 'R', 'created')$$,
  'zoho_documents_source_table_check');

-- Jobs for the refusal checks, made as the owner
create table t.zbad (id uuid);
insert into t.zbad select t.zjob('Completed') from generate_series(1, 4);
grant select on t.zbad to public;

-- The fill function, as the service role. Supabase gives that role table access by default; the checks below read the tables as it.
grant select on accounting_jobs, accounting_job_events to service_role;
set role service_role;
select t.ok('fill_records_once', (t.fill(t.zid('done')) ->> 'result') = 'recorded');
select t.ok('fill_sets_the_fields', (select invoice_number = 'INV-0001' and invoice_date = date '2026-11-03' and invoice_amount = 1050
  and invoiced_by = '00000000-0000-0000-0000-0000000000f1' and invoiced_at is not null and payment_tracked
  from accounting_jobs where id = t.zid('done')));
select t.ok('fill_writes_one_event', t.events(t.zid('done')) = 1);
select t.ok('event_shape', (select to_value = 'INV-0001' and from_value is null and remarks = '1050 (Zoho)' and created_by = '00000000-0000-0000-0000-0000000000f1'
  from accounting_job_events where job_id = t.zid('done') and event = 'Invoice recorded'));
select t.ok('same_number_changes_nothing', (t.fill(t.zid('done')) ->> 'result') = 'same');
select t.ok('same_number_adds_no_event', t.events(t.zid('done')) = 1);
select t.ok('second_number_refused', t.fill(t.zid('done'), 'INV-0002', date '2026-11-04', 500) = '{"result": "different", "number": "INV-0001"}'::jsonb);
select t.ok('second_number_keeps_first', (select invoice_number = 'INV-0001' and invoice_amount = 1050 from accounting_jobs where id = t.zid('done')));
select t.ok('second_number_adds_no_event', t.events(t.zid('done')) = 1);
select t.ok('typed_invoice_not_overwritten', (t.fill(t.zid('typed')) ->> 'result') = 'different'
  and (select invoice_number from accounting_jobs where id = t.zid('typed')) = 'INV-TYPED' and t.events(t.zid('typed')) = 0);
select t.ok('open_job_refused', (t.fill(t.zid('open')) ->> 'result') = 'refused');
select t.ok('open_job_unchanged', (select invoice_number is null from accounting_jobs where id = t.zid('open')) and t.events(t.zid('open')) = 0);
select t.ok('zero_amount_refused', (t.fill((select id from t.zbad limit 1), 'INV-A', date '2026-11-03', 0) ->> 'result') = 'refused');
select t.ok('no_number_refused', (t.fill((select id from t.zbad limit 1), '  ', date '2026-11-03', 10) ->> 'result') = 'refused');
select t.ok('no_date_refused', (t.fill((select id from t.zbad limit 1), 'INV-A', null, 10) ->> 'result') = 'refused');
select t.ok('refusals_leave_jobs_empty', (select count(*) from accounting_jobs where id in (select id from t.zbad) and invoice_number is not null) = 0);
select t.fails('unknown_job_fails', $$select accounting_zoho_invoice_fill(gen_random_uuid(), 'INV-1', date '2026-11-03', 10, null)$$, 'Job not found');
reset role;

-- Nobody else can call it
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.fails('authenticated_cannot_execute', format($$select accounting_zoho_invoice_fill(%L, 'INV-9', date '2026-11-03', 10, null)$$, t.zid('open')), 'permission denied');
reset role;
set role anon;
select t.fails('anon_cannot_execute', format($$select accounting_zoho_invoice_fill(%L, 'INV-9', date '2026-11-03', 10, null)$$, t.zid('open')), 'permission denied');
reset role;
select t.ok('only_service_role_has_execute', not has_function_privilege('public', 'accounting_zoho_invoice_fill(uuid,text,date,numeric,uuid)', 'execute')
  and has_function_privilege('service_role', 'accounting_zoho_invoice_fill(uuid,text,date,numeric,uuid)', 'execute'));
select t.ok('job_still_empty_after_denied_calls', (select invoice_number is null from accounting_jobs where id = t.zid('open')));

-- Migration 013 runs again with nothing lost
\ir '../../Admin Base/migrations/013_zoho_accounting.sql'
select t.ok('migration_rerun_keeps_rows', (select count(*) from zoho_documents) = 3 and (select invoice_number from accounting_jobs where id = t.zid('done')) = 'INV-0001');
