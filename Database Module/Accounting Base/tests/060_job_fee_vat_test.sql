-- VAT in the job fee (migration 005). Reuses t.ok, t.fails, t.mk, t.j, t.st, t.fee, t.pay and t.l from 010 and 030 in the same database.
\set ON_ERROR_STOP on
reset role;
update hub_documents set vat_mode = 'exclusive', vat_rate = 5 where id = '11111111-1111-1111-1111-111111111111';
update hub_documents set vat_mode = 'none', vat_rate = 5 where id = '22222222-2222-2222-2222-222222222222';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- The same figures the screen and the Zoho function work out
select t.ok('fee_with_vat_matches_screen', accounting_fee_with_vat(1000, null) = 1050 and accounting_fee_with_vat(123.45, null) = 129.62
  and accounting_fee_with_vat(0.10, null) = 0.11 and accounting_fee_with_vat(0.09, null) = 0.09 and accounting_fee_with_vat(null, null) is null);
select t.ok('quote_fee_has_nothing_added', accounting_fee_with_vat(1050, gen_random_uuid()) = 1050);

-- A typed fee: VAT is added until an invoice is recorded
select t.fee('v1', 1000);
select t.ok('typed_fee_due_includes_vat', (t.l(t.j('v1'))).amount_due = 1050 and (t.l(t.j('v1'))).balance = 1050 and (t.l(t.j('v1'))).fee_amount = 1000);
select t.ok('typed_fee_unpaid_not_invoiced', (t.l(t.j('v1'))).payment_status = 'Not invoiced');
select t.pay(t.j('v1'), 1050);
select t.ok('typed_fee_paid_in_full_is_settled', (t.l(t.j('v1'))).payment_status = 'Settled' and (t.l(t.j('v1'))).balance = 0);
select t.fails('typed_fee_payment_above_due_refused', format($$select t.pay(%L, 0.01)$$, t.j('v1')), 'balance');

-- A recorded invoice amount still wins
select t.fee('v2', 1000);
select t.st(t.j('v2'), 'Completed');
select accounting_invoice_set(t.j('v2'), 'INV-V2', accounting_dubai_date(), 1000);
select t.ok('invoice_amount_wins_over_fee_plus_vat', (t.l(t.j('v2'))).amount_due = 1000 and (t.l(t.j('v2'))).balance = 1000);

-- A job linked to a quote: the fee is the quote total, nothing added
select t.mk('v3');
select accounting_job_link_document(t.j('v3'), 'quote', '11111111-1111-1111-1111-111111111111', false);
select t.ok('quote_fee_due_equals_fee', (t.l(t.j('v3'))).fee_amount = 1500 and (t.l(t.j('v3'))).amount_due = 1500);
select t.pay(t.j('v3'), 1500);
select t.ok('quote_fee_settles_at_fee', (t.l(t.j('v3'))).payment_status = 'Settled');
select t.ok('quote_vat_mode_read', accounting_quote_vat_mode('11111111-1111-1111-1111-111111111111') = 'exclusive');

-- A No VAT quote: due is the fee, and the screen can see the mode
select t.mk('v4');
select accounting_job_link_document(t.j('v4'), 'quote', '22222222-2222-2222-2222-222222222222', true);
select t.ok('no_vat_quote_due_equals_fee', (t.l(t.j('v4'))).fee_amount = 900 and (t.l(t.j('v4'))).amount_due = 900);
select t.ok('no_vat_quote_mode_read', accounting_quote_vat_mode('22222222-2222-2222-2222-222222222222') = 'none');

-- A direct call cannot keep a typed fee beside a quote
select t.fee('v5', 500);
select accounting_job_link_document(t.j('v5'), 'quote', '11111111-1111-1111-1111-111111111111', false);
select t.ok('direct_link_cannot_keep_fee', (select fee_amount = 1500 from accounting_jobs where id = t.j('v5')));

-- Someone without accounts.review learns nothing about a quote
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.ok('quote_mode_hidden_without_permission', accounting_quote_vat_mode('11111111-1111-1111-1111-111111111111') is null);
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
