-- Invoice and link checks. Reuses the helpers (t.ok, t.fails, t.mk, t.j, t.st) that 010_jobs_test.sql creates in the same database.
\set ON_ERROR_STOP on
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- Invoice
select t.mk('i');
select t.fails('invoice_needs_completed', format($$select accounting_invoice_set(%L, 'INV-1', accounting_dubai_date(), 1000)$$, t.j('i')), 'Completed');
select t.st(t.j('i'), 'Completed');
select t.fails('invoice_needs_number', format($$select accounting_invoice_set(%L, '  ', accounting_dubai_date(), 1000)$$, t.j('i')), 'number');
select t.fails('invoice_needs_positive_amount', format($$select accounting_invoice_set(%L, 'INV-1', accounting_dubai_date(), 0)$$, t.j('i')), 'amount');
select t.fails('invoice_needs_date', format($$select accounting_invoice_set(%L, 'INV-1', null, 1000)$$, t.j('i')), 'date');
select accounting_invoice_set(t.j('i'), ' INV-1 ', accounting_dubai_date(), 1000);
select t.ok('invoice_recorded', (select invoice_number = 'INV-1' and invoice_amount = 1000 and invoiced_by is not null and invoiced_at is not null from accounting_jobs where id = t.j('i')));
select t.fails('completed_with_invoice_locked', format($$select t.st(%L, 'In Progress')$$, t.j('i')), 'invoice');
select t.fails('invoice_clear_needs_reason', format($$select accounting_invoice_clear(%L, '  ')$$, t.j('i')), 'reason');
select accounting_invoice_clear(t.j('i'), 'Wrong amount');
select t.ok('invoice_clear_event', exists (select 1 from accounting_job_events where job_id = t.j('i') and event = 'Invoice cleared' and from_value = 'INV-1' and remarks = 'Wrong amount')
  and (select invoice_number is null and invoice_amount is null and invoice_date is null and invoiced_by is null from accounting_jobs where id = t.j('i')));
select t.st(t.j('i'), 'In Progress');
select t.ok('unlocked_after_clear', (select work_status = 'In Progress' from accounting_jobs where id = t.j('i')));

-- Links
select t.mk('l');
select t.fails('link_wrong_doc_type_refused', format($$select accounting_job_link_document(%L, 'quote', '33333333-3333-3333-3333-333333333333', true)$$, t.j('l')), 'quote');
select accounting_job_link_document(t.j('l'), 'quote', '11111111-1111-1111-1111-111111111111', false);
select t.ok('link_fills_null_fee', (select fee_amount = 1500 and payment_tracked and quote_id is not null from accounting_jobs where id = t.j('l')));
select accounting_job_link_document(t.j('l'), 'quote', '22222222-2222-2222-2222-222222222222', false);
select t.ok('link_always_takes_quote_total', (select fee_amount = 900 and quote_id = '22222222-2222-2222-2222-222222222222' from accounting_jobs where id = t.j('l')));
select accounting_job_link_document(t.j('l'), 'quote', '22222222-2222-2222-2222-222222222222', true);
select t.ok('link_quote_takes_total', (select fee_amount = 900 from accounting_jobs where id = t.j('l')));
select accounting_job_link_document(t.j('l'), 'letter', '33333333-3333-3333-3333-333333333333', false);
select t.ok('link_letter', (select letter_id is not null and fee_amount = 900 from accounting_jobs where id = t.j('l')));
select t.fails('link_client_must_exist', format($$select accounting_job_link_client(%L, 'NOPE')$$, t.j('l')), 'client');
select accounting_job_link_client(t.j('l'), 'C1');
select t.ok('link_client', (select client_id = 'C1' from accounting_jobs where id = t.j('l')));

-- A quote total of 0 counts as no total
select t.mk('z1');
select accounting_job_link_document(t.j('z1'), 'quote', '44444444-4444-4444-4444-444444444444', false);
select t.ok('zero_quote_no_fee', (select fee_amount is null and quote_id is not null from accounting_jobs where id = t.j('z1')));
select accounting_job_set_fee(t.j('z1'), 500);
select t.fails('zero_quote_refused_when_job_has_fee', format($$select accounting_job_link_document(%L, 'quote', '44444444-4444-4444-4444-444444444444', true)$$, t.j('z1')), 'no total');
select t.ok('zero_quote_keeps_fee', (select fee_amount = 500 and quote_id is not null from accounting_jobs where id = t.j('z1')));
insert into t.keep select 'z2', t.oldjob();
select accounting_job_link_document(t.j('z2'), 'quote', '44444444-4444-4444-4444-444444444444', false);
select t.ok('zero_quote_leaves_old_job_untracked', (select fee_amount is null and not payment_tracked from accounting_jobs where id = t.j('z2')));

-- Clearing an invoice on a job imported as Done, with no fee and no payments, restores payment_tracked false
reset role;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, legacy_raw) values ('Old Co', 'VAT Return', 'Completed', false, 'k-clear', '{"Status":"Done"}') returning id)
insert into t.keep select 'lg', id from x;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, fee_amount) values ('Old Co', 'VAT Return', 'Completed', true, 'k-clear-fee', 300) returning id)
insert into t.keep select 'lgfee', id from x;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, legacy_raw) values ('Old Co', 'VAT Return', 'Completed', true, 'k-clear-open', '{"Status":"In Progress"}') returning id)
insert into t.keep select 'lgopen', id from x;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, legacy_raw) values ('Old Co', 'VAT Return', 'Completed', false, 'k-clear-space', '{"Status":" Done\u00a0"}') returning id)
insert into t.keep select 'lgspace', id from x;
set role authenticated;
select accounting_invoice_set(t.j('lg'), 'INV-L', accounting_dubai_date(), 100);
select t.ok('old_job_invoice_tracks', (select payment_tracked from accounting_jobs where id = t.j('lg')));
select accounting_invoice_clear(t.j('lg'), 'Wrong job');
select t.ok('old_done_clear_restores_untracked', (select not payment_tracked and payment_status = 'Not tracked' from accounting_job_list where id = t.j('lg')));
select accounting_invoice_set(t.j('lgspace'), 'INV-S', accounting_dubai_date(), 100);
select accounting_invoice_clear(t.j('lgspace'), 'Wrong job');
select t.ok('old_done_status_spaces_ignored', (select not payment_tracked from accounting_jobs where id = t.j('lgspace')));
select accounting_invoice_set(t.j('lgopen'), 'INV-O', accounting_dubai_date(), 100);
select accounting_invoice_clear(t.j('lgopen'), 'Wrong job');
select t.ok('old_open_clear_stays_tracked', (select payment_tracked and payment_status = 'No fee' from accounting_job_list where id = t.j('lgopen')));
select accounting_invoice_set(t.j('lgfee'), 'INV-F', accounting_dubai_date(), 100);
select accounting_invoice_clear(t.j('lgfee'), 'Wrong job');
select t.ok('old_job_with_fee_stays_tracked', (select payment_tracked from accounting_jobs where id = t.j('lgfee')));
select t.ok('new_job_clear_stays_tracked', (select payment_tracked from accounting_jobs where id = t.j('i')));
