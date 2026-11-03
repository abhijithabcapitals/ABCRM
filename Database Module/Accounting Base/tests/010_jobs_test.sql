-- Prints "ok <name>" per check and stops at the first failure.
\set ON_ERROR_STOP on
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
-- A new job, then its version stamp, then a status move that passes the stamp
create function t.job(nm text default 'Acme LLC') returns uuid language sql as $$
  select (accounting_job_save(jsonb_build_object('client_name', nm, 'service_name', 'CT Filing FY2025', 'service_department', 'Tax Compliance'))).id $$;
create function t.ts(j uuid) returns timestamptz language sql as $$ select updated_at from accounting_jobs where id = j $$;
create function t.st(j uuid, s text, r text default null) returns void language sql as $$ select accounting_job_set_status(j, s, r, t.ts(j)) $$;
create function t.batch(j uuid, files jsonb, mode text default 'Email', rec date default accounting_dubai_date(), note text default null) returns uuid language sql as $$
  select accounting_batch_add(jsonb_build_object('job_id', j, 'received_on', rec, 'receipt_mode', mode, 'mode_note', note, 'files', files)) $$;
-- Named jobs, so later checks can find them again
create table t.keep (k text primary key, id uuid);
grant all on t.keep to public;
create function t.mk(k text) returns uuid language sql as $$ insert into t.keep select k, t.job() returning id $$;
create function t.j(k text) returns uuid language sql as $$ select id from t.keep where t.keep.k = $1 $$;
-- An old imported job with no fee, which only the importer can make (direct insert as owner)
create function t.oldjob() returns uuid language sql security definer as $$
  insert into accounting_jobs (client_name, service_name, work_status, payment_tracked) values ('Old Co', 'VAT Return', 'Completed', false) returning id $$;

insert into profiles values ('00000000-0000-0000-0000-00000000000a', 'accounts'), ('00000000-0000-0000-0000-00000000000b', 'member');
insert into client_master values ('C1', 'Acme LLC');
insert into hub_documents (id, doc_type, total_amount) values
  ('11111111-1111-1111-1111-111111111111', 'quote', 1500), ('22222222-2222-2222-2222-222222222222', 'quote', 900),
  ('33333333-3333-3333-3333-333333333333', 'letter', null), ('44444444-4444-4444-4444-444444444444', 'quote', 0);

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- Dubai date
select t.ok('dubai_date_after_midnight', accounting_dubai_date('2026-11-03 20:30+00') = date '2026-11-04');

-- Creating
select t.mk('first');
select t.ok('job_number_format', (select job_number from accounting_jobs where id = t.j('first')) = 'JOB-000001');
select t.fails('client_required', $$select accounting_job_save('{"client_name":"  ","service_name":"CT"}')$$, 'client');
select t.fails('service_required', $$select accounting_job_save('{"client_name":"Acme","service_name":""}')$$, 'service');
select t.fails('client_and_service_required_missing_keys', $$select accounting_job_save('{}')$$, 'client');

-- Who may do what
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.fails('no_role_refused', $$select accounting_job_save('{"client_name":"Acme","service_name":"CT"}')$$, 'permission');
select t.ok('no_role_sees_no_rows', (select count(*) from accounting_jobs) = 0);
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.ok('role_sees_rows', (select count(*) from accounting_jobs) = 1);
select t.fails('direct_write_refused', $$insert into accounting_jobs (client_name, service_name) values ('x', 'y')$$, 'permission denied');
select t.fails('direct_update_refused', $$update accounting_jobs set remarks = 'x'$$, 'permission denied');


-- Work status
select t.mk('s');
select t.fails('pending_needs_remarks', $$select t.st(t.j('s'), 'Pending', '  ')$$, 'remarks');
select t.st(t.j('s'), 'Pending', 'Waiting for bank statement');
select t.ok('pending_with_remarks', (select work_status = 'Pending' and remarks = 'Waiting for bank statement' from accounting_jobs where id = t.j('s')));
select t.fails('cancelled_needs_remarks', $$select t.st(t.j('s'), 'Client Cancelled', null)$$, 'remarks');
select t.st(t.j('s'), 'Client Cancelled', 'Client closed the company');
select t.ok('cancelled_with_remarks', (select work_status = 'Client Cancelled' from accounting_jobs where id = t.j('s')));
select t.fails('bad_status_refused', $$select t.st(t.j('s'), 'Done', 'x')$$, 'status');

select t.st(t.j('s'), 'Completed');
select t.ok('completed_stamps', (select completed_at is not null and completed_by = '00000000-0000-0000-0000-00000000000a' from accounting_jobs where id = t.j('s')));
select t.st(t.j('s'), 'In Progress');
select t.ok('leaving_completed_clears', (select completed_at is null and completed_by is null from accounting_jobs where id = t.j('s')));

-- Events
select t.ok('event_written', exists (select 1 from accounting_job_events where job_id = t.j('s') and from_value = 'Completed' and to_value = 'In Progress'));
reset role;
select t.fails('events_update_refused', $$update accounting_job_events set remarks = 'x'$$, 'cannot be changed');
select t.fails('events_delete_refused', $$delete from accounting_job_events$$, 'cannot be changed');
set role authenticated;

-- Saving and stale versions
select t.mk('e');
select t.ok('edit_saves', (select period_label = 'FY2025' from accounting_job_save(jsonb_build_object('id', t.j('e'), 'expected_updated_at', t.ts(t.j('e')), 'client_name', 'Acme LLC', 'service_name', 'CT Filing', 'period_label', 'FY2025'))));
select t.fails('stale_save_refused', format($$select accounting_job_save(jsonb_build_object('id', %L, 'expected_updated_at', %L::timestamptz, 'client_name', 'A', 'service_name', 'B'))$$, t.j('e'), (select created_at from accounting_jobs where id = t.j('e')) - interval '1 second'), 'reload');
select t.fails('stale_status_refused', format($$select accounting_job_set_status(%L, 'In Progress', null, %L::timestamptz)$$, t.j('e'), (select created_at from accounting_jobs where id = t.j('e')) - interval '1 second'), 'reload');
select t.fails('edit_without_version_refused', format($$select accounting_job_save(jsonb_build_object('id', %L, 'client_name', 'A', 'service_name', 'B'))$$, t.j('e')), 'reload');

-- Fee
select t.ok('create_with_fee', (select fee_amount = 750 and payment_tracked from accounting_job_save('{"client_name":"Fee Co","service_name":"VAT","fee_amount":750}')));
select t.fails('create_fee_not_negative', $$select accounting_job_save('{"client_name":"Fee Co","service_name":"VAT","fee_amount":-1}')$$, 'negative');
select t.fails('edit_cannot_change_fee', format($$select accounting_job_save(jsonb_build_object('id', %L, 'expected_updated_at', %L::timestamptz, 'client_name', 'A', 'service_name', 'B', 'fee_amount', 99))$$, t.j('e'), t.ts(t.j('e'))), 'fee');
select accounting_job_set_fee(t.j('e'), 400);
select t.ok('set_fee', (select fee_amount = 400 from accounting_jobs where id = t.j('e')) and exists (select 1 from accounting_job_events where job_id = t.j('e') and event = 'Fee changed' and to_value = '400'));
select t.fails('fee_not_negative', format($$select accounting_job_set_fee(%L, -5)$$, t.j('e')), 'negative');
select t.mk('old');
reset role;
update accounting_jobs set payment_tracked = false, work_status = 'Completed' where id = t.j('old');
set role authenticated;
select accounting_job_set_fee(t.j('old'), 500);
select t.ok('fee_sets_tracked', (select payment_tracked from accounting_jobs where id = t.j('old')));
select t.mk('old2');
reset role;
update accounting_jobs set payment_tracked = false, work_status = 'Completed' where id = t.j('old2');
set role authenticated;
select accounting_invoice_set(t.j('old2'), 'INV-9', accounting_dubai_date(), 100);
select t.ok('invoice_sets_tracked', (select payment_tracked from accounting_jobs where id = t.j('old2')));

-- Batches
select t.mk('b');
select t.fails('batch_needs_files', format($$select t.batch(%L, '[]')$$, t.j('b')), 'file');
select t.fails('batch_blank_files', format($$select t.batch(%L, '["  ",""]')$$, t.j('b')), 'file');
select t.fails('batch_no_future_date', format($$select t.batch(%L, '["a.pdf"]', 'Email', accounting_dubai_date() + 1)$$, t.j('b')), 'future');
select t.fails('batch_other_needs_note', format($$select t.batch(%L, '["a.pdf"]', 'Other')$$, t.j('b')), 'note');
select t.fails('batch_bad_mode_refused', format($$select t.batch(%L, '["a.pdf"]', 'Fax')$$, t.j('b')), 'mode');
select t.ok('batch_other_with_note', t.batch(t.j('b'), '["a.pdf"]', 'Other', accounting_dubai_date(), 'Left at reception') is not null);
insert into t.keep select 'bid', t.batch(t.j('b'), '["a.pdf"," a.pdf "]');
select t.ok('batch_repeats_stored_once', (select count(*) = 1 from accounting_job_files where batch_id = t.j('bid')));
select accounting_batch_set_saved(t.j('bid'), true);
select t.ok('saved_tick_stamps', (select saved_to_folder and saved_by = '00000000-0000-0000-0000-00000000000a' and saved_at is not null from accounting_job_batches where id = t.j('bid')));
select accounting_batch_set_saved(t.j('bid'), false);
select t.ok('saved_untick_clears', (select not saved_to_folder and saved_by is null and saved_at is null from accounting_job_batches where id = t.j('bid')));

-- Dubai date has a fixed search_path
select t.ok('dubai_date_has_search_path', (select proconfig is not null from pg_proc where proname = 'accounting_dubai_date'));

-- Completed to Completed with new remarks leaves the completion stamps alone
insert into t.keep select 'done1', t.oldjob();
select t.st(t.j('done1'), 'Completed', 'New remark on an old job');
select t.ok('old_done_no_date_stays_blank', (select remarks = 'New remark on an old job' and completed_at is null and completed_by is null from accounting_jobs where id = t.j('done1')));
insert into t.keep select 'done2', t.oldjob();
reset role;
update accounting_jobs set completed_at = '2026-01-15 09:00+04' where id = t.j('done2');
set role authenticated;
select t.st(t.j('done2'), 'Completed', 'Another remark');
select t.ok('old_done_not_claimed_by_editor', (select completed_at = '2026-01-15 09:00+04' and completed_by is null from accounting_jobs where id = t.j('done2')));
select t.mk('done3');
select t.st(t.j('done3'), 'Completed');
select t.ok('real_completion_stamps', (select completed_at is not null and completed_by = '00000000-0000-0000-0000-00000000000a' from accounting_jobs where id = t.j('done3')));
