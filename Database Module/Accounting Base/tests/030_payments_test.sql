-- Payments, receipts, follow-ups and the job list view. Reuses t.ok, t.fails, t.mk, t.j, t.st, t.oldjob from 010 in the same database.
-- Two checks run migration 003 again with \ir, which reads the path relative to this file.
\set ON_ERROR_STOP on
reset role;

-- Helpers for this file. t.fee gives a named job a fee; t.pay records a payment of a named job.
create function t.fee(k text, amt numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := t.mk(k);
  perform accounting_job_set_fee(v, amt);
  return v;
end $$;
create function t.pay(j uuid, amt numeric, m text default 'Bank transfer', on_ date default null) returns jsonb language sql as $$
  select accounting_payment_add(jsonb_strip_nulls(jsonb_build_object('job_id', j, 'amount', amt, 'method', m, 'paid_on', on_, 'reference', 'REF-1'))) $$;
create function t.rev(pid uuid, r text default 'Entered twice') returns void language sql as $$ select accounting_payment_reverse(pid, r) $$;
create function t.lastpay(j uuid) returns uuid language sql as $$
  select id from accounting_payments where job_id = j and reverses_id is null order by created_at desc, id limit 1 $$;
create function t.l(j uuid) returns accounting_job_list language sql as $$ select * from accounting_job_list where id = j $$;
create function t.fu(j uuid, nxt date, ch text default 'Phone', nt text default 'Called the client') returns uuid language sql as $$
  select accounting_followup_add(jsonb_strip_nulls(jsonb_build_object('job_id', j, 'channel', ch, 'note', nt, 'next_follow_up_on', nxt))) $$;
-- The owner changes things the API cannot: a direct edit that must be refused by the trigger, and a stamped date.
create function t.tamper(stmt text) returns void language plpgsql security definer as $$ begin execute stmt; end $$;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- Who may call what
select t.ok('anon_cannot_call_' || f, not has_function_privilege('anon', 'public.' || f, 'execute'))
  from unnest(array['accounting_payment_add(jsonb)', 'accounting_payment_reverse(uuid,text)', 'accounting_receipt_attach(uuid,text)', 'accounting_followup_add(jsonb)']) f;
select t.ok('authenticated_can_call_' || f, has_function_privilege('authenticated', 'public.' || f, 'execute'))
  from unnest(array['accounting_payment_add(jsonb)', 'accounting_payment_reverse(uuid,text)', 'accounting_receipt_attach(uuid,text)', 'accounting_followup_add(jsonb)']) f;
select t.ok('trigger_functions_not_callable', not has_function_privilege('authenticated', 'public.accounting_voucher_from_receipt()', 'execute')
  and not has_function_privilege('authenticated', 'public.accounting_voucher_from_payment()', 'execute'));
select t.fails('payment_direct_write_refused', $$insert into accounting_payments (job_id, amount, method) values (gen_random_uuid(), 1, 'Cash')$$, 'permission denied');

-- Recording a payment
select t.fee('p1', 1000);
select t.pay(t.j('p1'), 400);
select t.ok('payment_writes_receipt',
  (select count(*) from accounting_receipts r join voucher_register v on v.source_id = r.payment_id
    where r.payment_id = t.lastpay(t.j('p1')) and r.receipt_number = to_char(accounting_dubai_date(), '"ABC/"YYYY"/"MM"/ACR001"')
      and v.source = 'accounting' and v.voucher_type = 'Receipt' and v.status = 'Valid' and v.voucher_number = r.receipt_number
      and v.department = 'Accounting' and v.client_name = 'Acme LLC' and v.amount = 400) = 1);
select t.ok('payment_returns_keys', (select (r ? 'payment_id') and (r ? 'receipt_id') and (r ->> 'receipt_number') like 'ABC/%' and (r ->> 'amount')::numeric = 100
  and (r ->> 'paid_on')::date = accounting_dubai_date() and r ->> 'method' = 'Cash' and r ->> 'reference' = 'REF-1'
  from (select t.pay(t.j('p1'), 100, 'Cash') r) s));
select t.ok('payment_makes_job_event', exists (select 1 from accounting_job_events where job_id = t.j('p1') and event = 'Payment recorded'));
select t.mk('nofee');
select t.fails('payment_needs_fee', format($$select t.pay(%L, 100)$$, t.j('nofee')), 'fee');
select t.fee('p2', 1000);
select t.fails('payment_above_balance_refused', format($$select t.pay(%L, 1000.01)$$, t.j('p2')), 'balance');
select t.fails('payment_zero_refused', format($$select t.pay(%L, 0)$$, t.j('p2')), 'amount');
select t.fails('payment_negative_refused', format($$select t.pay(%L, -5)$$, t.j('p2')), 'amount');
select t.fails('payment_three_decimals_refused', format($$select t.pay(%L, 1.234)$$, t.j('p2')), 'amount');
select t.fails('payment_text_amount_refused', format($$select accounting_payment_add(jsonb_build_object('job_id', %L, 'amount', 'abc', 'method', 'Cash'))$$, t.j('p2')), 'amount');
select t.fails('payment_no_future_date', format($$select t.pay(%L, 10, 'Cash', accounting_dubai_date() + 1)$$, t.j('p2')), 'future');
select t.fails('payment_bad_method', format($$select t.pay(%L, 10, 'Bitcoin')$$, t.j('p2')), 'method');
select t.fails('payment_missing_method', format($$select accounting_payment_add(jsonb_build_object('job_id', %L, 'amount', 10))$$, t.j('p2')), 'method');
select t.fails('payment_unknown_job', $$select t.pay(gen_random_uuid(), 10)$$, 'Job not found');
select t.ok('refused_payments_left_nothing', (select count(*) from accounting_payments where job_id = t.j('p2')) = 0);
select t.pay(t.j('p2'), 1000);
select t.ok('payment_up_to_balance_allowed', (t.l(t.j('p2'))).balance = 0);
select t.fails('payment_after_settled_refused', format($$select t.pay(%L, 0.01)$$, t.j('p2')), 'balance');
select t.fee('adv', 1000);
select t.st(t.j('adv'), 'In Progress');
select t.pay(t.j('adv'), 250);
select t.ok('advance_allowed', (t.l(t.j('adv'))).balance = 750);
select t.fails('payments_not_editable', $$update accounting_payments set amount = 1$$, 'permission denied');
select t.fails('payments_append_only_update', $$select t.tamper('update accounting_payments set note = ''x''')$$, 'cannot be changed');
select t.fails('payments_append_only_delete', $$select t.tamper('delete from accounting_payments')$$, 'cannot be changed');

-- Reversing
select t.fee('r1', 1000);
select t.pay(t.j('r1'), 400);
select t.ok('balance_after_payment', (t.l(t.j('r1'))).balance = 600);
select t.fails('reverse_needs_reason', format($$select t.rev(%L, '  ')$$, t.lastpay(t.j('r1'))), 'reason');
select t.fails('reverse_null_reason', format($$select accounting_payment_reverse(%L, null)$$, t.lastpay(t.j('r1'))), 'reason');
select t.fails('reverse_unknown_payment', $$select t.rev(gen_random_uuid())$$, 'not found');
select t.rev(t.lastpay(t.j('r1')), 'Entered twice');
select t.ok('reverse_restores_balance', (t.l(t.j('r1'))).balance = 1000 and (t.l(t.j('r1'))).paid_total = 0);
select t.ok('reverse_marks_voucher', (select status = 'Reversed' from voucher_register where source = 'accounting' and source_id = t.lastpay(t.j('r1'))));
select t.ok('reversal_row_negative', (select amount = -400 and reverses_id = t.lastpay(t.j('r1')) and note = 'Entered twice' and method = 'Bank transfer'
  from accounting_payments where job_id = t.j('r1') and reverses_id is not null));
select t.ok('reversal_makes_no_receipt', (select count(*) from accounting_receipts r join accounting_payments p on p.id = r.payment_id where p.job_id = t.j('r1')) = 1);
select t.ok('reversal_makes_job_event', exists (select 1 from accounting_job_events where job_id = t.j('r1') and event = 'Payment reversed' and remarks = 'Entered twice'));
select t.fails('double_reverse_refused', format($$select t.rev(%L)$$, t.lastpay(t.j('r1'))), 'already');
select t.fails('reverse_of_reversal_refused', format($$select t.rev(%L)$$, (select id from accounting_payments where job_id = t.j('r1') and reverses_id is not null)), 'reversal');
select t.pay(t.j('r1'), 1000);
select t.ok('pay_again_after_reversal', (t.l(t.j('r1'))).balance = 0);

-- Receipt file
select t.fee('a1', 500);
select t.pay(t.j('a1'), 500);
select accounting_receipt_attach((select id from accounting_receipts where payment_id = t.lastpay(t.j('a1'))), 'accounting/receipts/a1.docx');
select t.ok('attach_updates_voucher',
  (select r.storage_path = 'accounting/receipts/a1.docx' and v.storage_path = 'accounting/receipts/a1.docx'
     from accounting_receipts r join voucher_register v on v.source = 'accounting' and v.voucher_type = 'Receipt' and v.source_id = r.payment_id
    where r.payment_id = t.lastpay(t.j('a1'))));
select t.fails('attach_needs_path', format($$select accounting_receipt_attach(%L, '  ')$$, (select id from accounting_receipts where payment_id = t.lastpay(t.j('a1')))), 'path');
select t.fails('attach_unknown_receipt', $$select accounting_receipt_attach(gen_random_uuid(), 'x')$$, 'not found');

-- Payment status
select t.ok('status_not_tracked', (t.l(t.oldjob())).payment_status = 'Not tracked');
select t.ok('status_no_fee', (t.l(t.j('nofee'))).payment_status = 'No fee');
select t.fee('sn', 1000);
select t.ok('status_not_invoiced', (t.l(t.j('sn'))).payment_status = 'Not invoiced' and (t.l(t.j('sn'))).amount_due = 1000);
select t.mk('si');
select t.st(t.j('si'), 'Completed');
select accounting_invoice_set(t.j('si'), 'INV-1', accounting_dubai_date(), 1000);
select t.ok('status_invoiced', (t.l(t.j('si'))).payment_status = 'Invoiced' and (t.l(t.j('si'))).paid_total = 0);
select t.pay(t.j('si'), 400);
select t.ok('status_part_paid', (t.l(t.j('si'))).payment_status = 'Part paid' and (t.l(t.j('si'))).balance = 600);
select t.pay(t.j('si'), 600);
select t.ok('status_settled', (t.l(t.j('si'))).payment_status = 'Settled' and (t.l(t.j('si'))).balance = 0);
select t.fee('so', 1000);
select t.pay(t.j('so'), 1000);
select t.st(t.j('so'), 'Completed');
select accounting_invoice_set(t.j('so'), 'INV-2', accounting_dubai_date(), 900);
select t.ok('status_overpaid', (t.l(t.j('so'))).payment_status = 'Overpaid' and (t.l(t.j('so'))).balance = -100);
select t.fails('payment_on_overpaid_refused', format($$select t.pay(%L, 1)$$, t.j('so')), 'balance');
select t.fee('io', 1000);
select t.st(t.j('io'), 'Completed');
select accounting_invoice_set(t.j('io'), 'INV-3', accounting_dubai_date(), 1050);
select t.ok('invoice_overrides_fee', (t.l(t.j('io'))).amount_due = 1050 and (t.l(t.j('io'))).balance = 1050);
select t.ok('job_columns_kept', (t.l(t.j('io'))).job_number is not null and (t.l(t.j('io'))).fee_amount = 1000 and (t.l(t.j('io'))).invoice_number = 'INV-3');

-- To invoice and follow-up lists
select t.fee('sb', 1000);
select t.pay(t.j('sb'), 1000);
select t.st(t.j('sb'), 'Completed');
select t.ok('settled_before_invoice_still_needs_invoice', (t.l(t.j('sb'))).payment_status = 'Settled' and (t.l(t.j('sb'))).needs_invoice and not (t.l(t.j('sb'))).follow_up_listed);
select t.mk('nf2');
select t.st(t.j('nf2'), 'Completed');
select t.ok('no_fee_needs_invoice_not_followup', (t.l(t.j('nf2'))).needs_invoice and not (t.l(t.j('nf2'))).follow_up_listed and (t.l(t.j('nf2'))).payment_status = 'No fee');
select t.ok('not_tracked_never_listed', not (t.l(t.oldjob())).needs_invoice and not (t.l(t.oldjob())).follow_up_listed);
select t.fee('fn', 1000);
select t.st(t.j('fn'), 'Completed');
select t.ok('fee_no_invoice_in_both', (t.l(t.j('fn'))).needs_invoice and (t.l(t.j('fn'))).follow_up_listed);
select t.ok('invoiced_not_in_needs_invoice', not (t.l(t.j('si'))).needs_invoice and not (t.l(t.j('io'))).needs_invoice and (t.l(t.j('io'))).follow_up_listed);
select t.fee('ip', 1000);
select t.st(t.j('ip'), 'In Progress');
select t.ok('incomplete_not_listed', not (t.l(t.j('ip'))).needs_invoice and not (t.l(t.j('ip'))).follow_up_listed and not (t.l(t.j('ip'))).follow_up_due);
select t.fee('cc', 1000);
select t.pay(t.j('cc'), 400);
select t.st(t.j('cc'), 'Completed');
select t.ok('listed_before_cancel', (t.l(t.j('cc'))).follow_up_listed);
select t.st(t.j('cc'), 'Client Cancelled', 'Client left');
select t.ok('cancelled_leaves_followups', not (t.l(t.j('cc'))).follow_up_listed and not (t.l(t.j('cc'))).needs_invoice and (t.l(t.j('cc'))).paid_total = 400);

-- Follow-ups
select t.fails('followup_needs_note', format($$select t.fu(%L, null, 'Phone', '  ')$$, t.j('fn')), 'note');
select t.fails('followup_needs_channel', format($$select t.fu(%L, null, '', 'Called')$$, t.j('fn')), 'channel');
select t.fails('followup_unknown_job', $$select t.fu(gen_random_uuid(), null)$$, 'Job not found');
select t.fails('followup_past_next_date_refused', format($$select t.fu(%L, accounting_dubai_date() - 1)$$, t.j('fn')), 'next');
select t.fails('followup_future_contact_refused', format($$select accounting_followup_add(jsonb_build_object('job_id', %L, 'contacted_on', accounting_dubai_date() + 1, 'channel', 'Phone', 'note', 'x'))$$, t.j('fn')), 'future');
select t.ok('refused_followups_left_nothing', (select count(*) from accounting_followups where job_id = t.j('fn')) = 0);
select t.fu(t.j('fn'), accounting_dubai_date() + 7);
select t.ok('followup_sets_next_date', (select next_follow_up_on = accounting_dubai_date() + 7 from accounting_jobs where id = t.j('fn'))
  and (select count(*) from accounting_followups where job_id = t.j('fn') and contacted_on = accounting_dubai_date() and channel = 'Phone') = 1);
select t.ok('followup_makes_job_event', exists (select 1 from accounting_job_events where job_id = t.j('fn') and event = 'Follow-up logged'));
select t.ok('not_due_when_future', (t.l(t.j('fn'))).follow_up_listed and not (t.l(t.j('fn'))).follow_up_due);
select t.fails('followups_not_editable', $$update accounting_followups set note = 'x'$$, 'permission denied');
select t.fails('followups_append_only_update', $$select t.tamper('update accounting_followups set note = ''x''')$$, 'cannot be changed');
select t.fails('followups_append_only_delete', $$select t.tamper('delete from accounting_followups')$$, 'cannot be changed');

-- The view and the follow-up date both use accounting_dubai_date()
select t.fee('fb_none', 1000);
select t.st(t.j('fb_none'), 'Completed');
select t.ok('view_due_with_no_next_date', (t.l(t.j('fb_none'))).follow_up_due);
select t.fee('fd', 1000);
select t.st(t.j('fd'), 'Completed');
select t.tamper(format('update accounting_jobs set next_follow_up_on = accounting_dubai_date() where id = %L', t.j('fd')));
select t.ok('view_due_uses_dubai_helper', (t.l(t.j('fd'))).follow_up_due);
select t.tamper(format('update accounting_jobs set next_follow_up_on = accounting_dubai_date() + 1 where id = %L', t.j('fd')));
select t.ok('view_not_due_tomorrow', not (t.l(t.j('fd'))).follow_up_due and (t.l(t.j('fd'))).follow_up_listed);
select t.tamper(format('update accounting_jobs set next_follow_up_on = accounting_dubai_date() - 1 where id = %L', t.j('fd')));
select t.ok('view_due_when_overdue', (t.l(t.j('fd'))).follow_up_due);
select t.ok('followup_today_accepted', t.fu(t.j('fd'), accounting_dubai_date()) is not null and (t.l(t.j('fd'))).follow_up_due);

-- Access
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.ok('view_hidden_without_role', (select count(*) from accounting_job_list) = 0);
select t.ok('payments_hidden_without_role', (select count(*) from accounting_payments) = 0 and (select count(*) from accounting_receipts) = 0 and (select count(*) from accounting_followups) = 0);
select t.fails('payment_refused_without_role', format($$select t.pay(%L, 10)$$, t.j('p1')), 'permission');
select t.fails('reverse_refused_without_role', format($$select t.rev(%L)$$, t.lastpay(t.j('p1'))), 'permission');
select t.fails('followup_refused_without_role', format($$select t.fu(%L, null)$$, t.j('p1')), 'permission');
select t.fails('attach_refused_without_role', $$select accounting_receipt_attach(gen_random_uuid(), 'x')$$, 'permission');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.ok('role_sees_view', (select count(*) from accounting_job_list) > 10);

-- Migration 003 again, and what it must leave alone
reset role;
select t.ok('numbering_receipt_added', (select value #>> '{Accounting,receipt,format}' = 'ABC/{YYYY}/{MM}/ACR{SERIAL}'
  and (value #>> '{Accounting,receipt,digits}')::int = 3 and value #>> '{Accounting,receipt,restart}' = 'never' from hub_settings where key = 'document_numbering'));
update hub_settings set value = jsonb_set(value, '{Accounting,receipt}', '{"digits":5,"format":"CUSTOM{SERIAL}","restart":"yearly"}') where key = 'document_numbering';
\ir ../migrations/003_payments_followups.sql
select t.ok('numbering_kept', (select value #>> '{Accounting,quote,format}' = 'ABC/{YYYY}/{MM}/ACQ{SERIAL}' from hub_settings where key = 'document_numbering'));
select t.ok('numbering_receipt_not_overwritten', (select value #>> '{Accounting,receipt,format}' = 'CUSTOM{SERIAL}' from hub_settings where key = 'document_numbering'));
delete from hub_settings where key = 'document_numbering';
insert into hub_settings values ('document_numbering', '{"Business Setup":{"quote":{"digits":4}}}');
\ir ../migrations/003_payments_followups.sql
select t.ok('numbering_other_keys_kept', (select value #>> '{"Business Setup",quote,digits}' = '4' and value #>> '{Accounting,receipt,format}' = 'ABC/{YYYY}/{MM}/ACR{SERIAL}' from hub_settings where key = 'document_numbering'));
select t.ok('data_kept_after_rerun', (select count(*) from accounting_receipts) >= 5);

-- Voucher register source check
insert into voucher_register (voucher_type, voucher_number, source, source_id) values ('Receipt', 'BS-1', 'business_setup', gen_random_uuid());
select t.ok('voucher_check_keeps_business_setup', exists (select 1 from voucher_register where voucher_number = 'BS-1'));
insert into voucher_register (voucher_type, voucher_number, source, source_id) values ('Receipt', 'B-1', 'banking', gen_random_uuid()), ('Receipt', 'H-1', 'hub', gen_random_uuid()), ('Receipt', 'T-1', 'template', gen_random_uuid());
select t.ok('voucher_check_keeps_older_sources', (select count(*) from voucher_register where voucher_number in ('B-1', 'H-1', 'T-1')) = 3);
select t.fails('voucher_check_refuses_unknown_source', $$insert into voucher_register (voucher_type, voucher_number, source, source_id) values ('Receipt', 'X-1', 'other', gen_random_uuid())$$, 'voucher_register_source_check');

-- Real numbering: counter kind widened, serial counts on, format comes from hub_settings
select t.ok('counter_kind_widened', (select pg_get_constraintdef(oid) like '%receipt%' and pg_get_constraintdef(oid) like '%quote%' and pg_get_constraintdef(oid) like '%letter%'
  from pg_constraint where conname = 'hub_number_counters_kind_check'));
select t.ok('receipt_counter_counts', (select last_serial >= 5 from hub_number_counters where department = 'Accounting' and kind = 'receipt'));
select t.ok('receipt_numbers_unique', (select count(distinct receipt_number) = count(*) from accounting_receipts));
select t.ok('view_uses_dubai_helper', pg_get_viewdef('public.accounting_job_list'::regclass) like '%accounting_dubai_date%');

-- Accounting receipts stay with accounts.review, though payments.view reads every Receipt
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select t.ok('payments_view_user_sees_no_accounting_vouchers', (select count(*) from voucher_register where source = 'accounting') = 0);
select t.ok('payments_view_user_still_sees_banking', (select count(*) from voucher_register where voucher_number = 'B-1') = 1);
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.ok('accounts_user_sees_accounting_vouchers', (select count(*) from voucher_register where source = 'accounting') >= 5);
select t.ok('accounts_user_sees_banking_too', (select count(*) from voucher_register where voucher_number = 'B-1') = 1);

-- Client options: the client master for ACCOUNTS users, who lack kyc.view and so get no master rows from client_lookup
reset role;
insert into client_master (client_id, legal_name, data) values ('C90', 'Option Co LLC', jsonb_build_object(
  'Client Legal Name', 'Option Co LLC', 'Trade Name', 'Option Co', 'Primary Contact', 'Sara Test; Other Person', 'General Email', 'opt@example.test',
  'General Phone', 'Not Provided', 'Registered Address', 'Street 1 (Provided – Verification Required)', 'Trade License Number', 'L-1', 'TRN', '100', 'Risk Level', 'Low'));
create function t.opt(r text) returns jsonb language sql as $$ select e from jsonb_array_elements(public.accounting_client_options()) e where e ->> 'ref' = r $$;
set role authenticated;
select t.ok('client_options_anon_cannot_call', not has_function_privilege('anon', 'public.accounting_client_options()', 'execute'));
select t.ok('client_options_authenticated_can_call', has_function_privilege('authenticated', 'public.accounting_client_options()', 'execute'));
select t.ok('client_options_security_definer', (select prosecdef and proconfig is not null from pg_proc where proname = 'accounting_client_options'));
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.fails('client_options_no_role_refused', $$select accounting_client_options()$$, 'permission');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select t.fails('client_options_payments_view_refused', $$select accounting_client_options()$$, 'permission');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000d', false);
select t.ok('only_accounts_review_lacks_kyc', not banking_can('kyc.view') and not banking_can('payments.view') and banking_can('accounts.review'));
select t.ok('client_options_accounts_review_gets_rows', jsonb_array_length(accounting_client_options()) >= 2);
select t.ok('client_options_same_keys_as_lookup', (select array_agg(k order by k) from jsonb_object_keys(t.opt('C90')) k)
  = array['address','contact','email','legal_name','license','name','phone','rank','ref','trade_name','trn']);
select t.ok('client_options_values', t.opt('C90') = '{"rank":1,"ref":"C90","name":"Option Co LLC","legal_name":"Option Co LLC","trade_name":"Option Co","contact":"Sara Test","email":"opt@example.test","phone":null,"address":"Street 1","license":"L-1","trn":"100"}'::jsonb);

-- The real ACCOUNTS permission list, and the admin pass the real banking_can has
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select t.ok('accounts_list_stub', banking_can('accounts.review') and banking_can('payments.view') and banking_can('agreements.view') and not banking_can('kyc.view'));
select t.ok('accounts_list_gets_client_options', (t.opt('C90') ->> 'name') = 'Option Co LLC');
reset role;
insert into profiles values ('00000000-0000-0000-0000-00000000000f', 'admin');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000f', false);
select t.ok('stub_admin_passes_everything', banking_can('kyc.view') and banking_can('accounts.review'));
select set_config('test.uid', '', false);
select t.ok('stub_no_user_is_false', banking_can('accounts.review') = false);
select t.ok('stub_number_format_keeps_long_serial', banking_number_format('X{SERIAL}', 3, 1234, '2026-01-01') = 'X1234');

-- Receipt files stay with accounts.review, other Template Hub files do not change
reset role;
insert into storage.objects (bucket_id, name) values
  ('hub-documents', 'Accounting/receipts/r1/a.docx'), ('hub-documents', 'Accounting/quotes/q1.docx'), ('other-bucket', 'Accounting/receipts/r2/b.docx');
create function t.objs() returns text language sql stable as $$ select coalesce(string_agg(name, '|' order by name), '') from storage.objects where bucket_id = 'hub-documents' $$;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
select t.ok('receipt_file_hidden_from_payments_view', t.objs() = 'Accounting/quotes/q1.docx');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.ok('receipt_file_hidden_from_no_role', t.objs() = 'Accounting/quotes/q1.docx');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000e', false);
select t.ok('receipt_file_seen_by_accounts', t.objs() = 'Accounting/quotes/q1.docx|Accounting/receipts/r1/a.docx');
select t.ok('receipt_policy_restrictive', exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and permissive = 'RESTRICTIVE' and cmd = 'SELECT'));
reset role;

-- Clearing the invoice of a job imported as Done keeps it tracked once it has payment history, reversals included
reset role;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, legacy_raw) values ('Old Co', 'VAT Return', 'Completed', false, 'k-clear-paid', '{"Status":"Done"}') returning id)
insert into t.keep select 'lgpaid', id from x;
with x as (insert into accounting_jobs (client_name, service_name, work_status, payment_tracked, legacy_key, legacy_raw) values ('Old Co', 'VAT Return', 'Completed', false, 'k-clear-rev', '{"Status":"Done"}') returning id)
insert into t.keep select 'lgrev', id from x;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select accounting_invoice_set(t.j('lgpaid'), 'INV-P', accounting_dubai_date(), 100);
select t.pay(t.j('lgpaid'), 40);
select accounting_invoice_clear(t.j('lgpaid'), 'Wrong amount');
select t.ok('old_done_with_payment_stays_tracked', (t.l(t.j('lgpaid'))).payment_tracked and (t.l(t.j('lgpaid'))).paid_total = 40 and (t.l(t.j('lgpaid'))).payment_status <> 'Not tracked');
select accounting_invoice_set(t.j('lgrev'), 'INV-R', accounting_dubai_date(), 100);
select t.pay(t.j('lgrev'), 40);
select t.rev(t.lastpay(t.j('lgrev')));
select accounting_invoice_clear(t.j('lgrev'), 'Wrong amount');
select t.ok('old_done_with_reversed_payment_stays_tracked', (t.l(t.j('lgrev'))).payment_tracked and (t.l(t.j('lgrev'))).paid_total = 0 and (t.l(t.j('lgrev'))).payment_status <> 'Not tracked');
reset role;
