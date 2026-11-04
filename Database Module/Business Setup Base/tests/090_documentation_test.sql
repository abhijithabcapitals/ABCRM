-- LOCAL TEST ONLY: fee amounts, line VAT, signed copies, payment by case and the letter gate (restructure Tasks 7 and 8). Run through tests/run-local.sh, after 010.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 070 runs 013 again to restore grants, which also puts back 013's hub_document_create: run the later definitions again.
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
create temp table f90 (k text primary key, v text);
grant all on f90 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f90 where k = p_k $$;
-- A quote of any department; p_lines is the lines array, p_extra overrides top-level keys.
create function pg_temp.mkq(p_dept text, p_lines jsonb, p_extra jsonb default '{}') returns public.hub_documents language sql as $$
  select public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', p_dept, 'client_name', 'Vat Test LLC', 'contact_name', 'C', 'contact_email', 'c@x.ae',
    'contact_phone', '1', 'client_address', 'Dubai', 'lines', p_lines) || p_extra)
$$;
create function pg_temp.mk(p_key text, p_dept text, p_lines jsonb, p_extra jsonb default '{}') returns void language plpgsql as $$
begin insert into f90 values (p_key, (pg_temp.mkq(p_dept, p_lines, p_extra)).id::text); end $$;
select public.bs_as('00000000-0000-0000-0000-00000000000b');
insert into f90 values ('fee5', public.business_setup_fee_item_save('{"grp":"T90","name":"Five","default_amount":1000}')::text);
insert into f90 values ('fee0', public.business_setup_fee_item_save('{"grp":"T90","name":"Zero","default_amount":500,"vat_rate":0}')::text);
insert into f90 values ('feenull', public.business_setup_fee_item_save('{"grp":"T90","name":"NoAmount","default_amount":""}')::text);

-- ── fee items: nullable amount, VAT rate ──
select public.bs_check('fee_null: a fee item saves with no amount', (select default_amount is null and vat_rate = 5 from public.business_setup_fee_items where id = pg_temp.fx('feenull')::uuid));
select public.bs_check('a fee item keeps the rate it was saved with', (select vat_rate = 0 from public.business_setup_fee_items where id = pg_temp.fx('fee0')::uuid));
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"T90","name":"Neg","default_amount":-1}')$$, 'negative');
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"T90","name":"BadRate","default_amount":1,"vat_rate":7}')$$, 'VAT rate');
select public.business_setup_fee_item_save(jsonb_build_object('id', pg_temp.fx('fee5'), 'grp', 'T90', 'name', 'Five', 'vat_rate', 0)) as ignored \gset
select public.bs_check('editing the rate leaves the amount', (select vat_rate = 0 and default_amount = 1000 from public.business_setup_fee_items where id = pg_temp.fx('fee5')::uuid));
select public.business_setup_fee_item_save(jsonb_build_object('id', pg_temp.fx('fee5'), 'grp', 'T90', 'name', 'Five', 'vat_rate', 5)) as ignored \gset
select public.business_setup_fee_item_save(jsonb_build_object('id', pg_temp.fx('fee5'), 'grp', 'T90', 'name', 'Five', 'default_amount', '')) as ignored \gset
select public.bs_check('an empty amount clears a stored amount', (select default_amount is null and vat_rate = 5 from public.business_setup_fee_items where id = pg_temp.fx('fee5')::uuid));
select public.business_setup_fee_item_save(jsonb_build_object('id', pg_temp.fx('fee5'), 'grp', 'T90', 'name', 'Five', 'default_amount', 1000)) as ignored \gset
select public.bs_check('the table refuses a negative amount and a rate other than 0 or 5',
  (select count(*) = 0 from public.business_setup_fee_items where default_amount < 0 or vat_rate not in (0, 5)));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"T90","name":"Five","vat_rate":0}')$$, 'permission');
select public.bs_as(null);
select public.bs_check('Company registration, renewal and Visa exist with no amount, 5%', (select count(*) = 3 and bool_and(default_amount is null and vat_rate = 5 and active) from public.business_setup_fee_items
  where grp = 'Company' and name in ('Company registration', 'Company renewal', 'Visa')));

-- ── Business Setup quotes: VAT line by line ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mk('mixed', 'Business Setup', jsonb_build_array(
  jsonb_build_object('description', 'A', 'amount', 1000, 'fee_item_id', pg_temp.fx('fee5')), jsonb_build_object('description', 'B', 'amount', 500, 'fee_item_id', pg_temp.fx('fee0'))));
select public.bs_check('vat_mixed: 1000 at 5 and 500 at 0 give net 1500, vat 50, total 1550',
  (select vat_amount = 50 and total_amount = 1550 and vat_mode = 'exclusive' from public.hub_documents where id = pg_temp.fx('mixed')::uuid));
select public.bs_check('the server stamps each line with its rate',
  (select lines -> 0 ->> 'vat_rate' = '5' and lines -> 1 ->> 'vat_rate' = '0' from public.hub_documents where id = pg_temp.fx('mixed')::uuid));
select pg_temp.mk('round', 'Business Setup', '[{"description":"R","amount":33.33}]');
select public.bs_check('vat_rounding: 33.33 at 5 gives line vat 1.67',
  (select vat_amount = 1.67 and total_amount = 35.00 from public.hub_documents where id = pg_temp.fx('round')::uuid));
select pg_temp.mk('typed', 'Business Setup', '[{"description":"T","amount":100}]', '{"vat_mode":"none"}');
select public.bs_check('a typed service with no fee item uses 5, and the mode comes out exclusive whatever is sent',
  (select vat_amount = 5 and total_amount = 105 and vat_mode = 'exclusive' from public.hub_documents where id = pg_temp.fx('typed')::uuid));
select pg_temp.mk('ignored', 'Business Setup', jsonb_build_array(jsonb_build_object('description', 'S', 'amount', 1000, 'vat_rate', 0, 'fee_item_id', pg_temp.fx('feenull'))), '{"vat_rate":0}');
select public.bs_check('vat_browser_ignored: a rate of 0 sent on a 5% item still charges 5%',
  (select vat_amount = 50 and total_amount = 1050 and lines -> 0 ->> 'vat_rate' = '5' from public.hub_documents where id = pg_temp.fx('ignored')::uuid));
select pg_temp.mk('zero', 'Business Setup', jsonb_build_array(jsonb_build_object('description', 'Z', 'amount', 500, 'fee_item_id', pg_temp.fx('fee0'))));
select public.bs_check('vat_all_zero: every line at 0 gives vat 0 and total equals net',
  (select vat_amount = 0 and total_amount = 500 from public.hub_documents where id = pg_temp.fx('zero')::uuid));
select pg_temp.mk('scope', 'Business Setup', '[{"description":"S","amount":10,"scope":"Mainland licence"}]');
select public.bs_check('scope of work is kept on the line',
  (select lines -> 0 ->> 'scope' = 'Mainland licence' from public.hub_documents where id = pg_temp.fx('scope')::uuid));
select public.bs_expect_error($$select pg_temp.mkq('Business Setup', '[{"description":"Neg","amount":-5}]')$$, 'Enter a fee');

select public.bs_expect_error($$select pg_temp.mkq('Business Setup', '[{"description":"U","amount":10,"fee_item_id":"00000000-0000-0000-0000-0000000000ee"}]')$$, 'Unknown fee item');
select public.bs_expect_error($$select pg_temp.mkq('Business Setup', '[{"description":"M","amount":10,"fee_item_id":"not-an-id"}]')$$, 'not valid');
select pg_temp.mk('blankid', 'Business Setup', '[{"description":"B","amount":100,"fee_item_id":""}]');
select public.bs_check('an empty fee item id counts as none and uses 5', (select vat_amount = 5 from public.hub_documents where id = pg_temp.fx('blankid')::uuid));

-- ── paying a quote that carries VAT ──
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL990090', 'Pay Vat LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL990090', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mk('payq', 'Business Setup', '[{"description":"Pay","amount":1000}]', '{"client_id":"CL990090"}');
select public.bs_accept(pg_temp.fx('payq')::uuid) as ignored \gset
select public.bs_check('a 1000 line at 5% has total 1050', (select total_amount = 1050 from public.hub_documents where id = pg_temp.fx('payq')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('payq'), 'amount', 1051)), 'balance');
select public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('payq'), 'amount', 1050)) as ignored \gset
select public.bs_check('paying 1050 leaves the balance at 0', (business_setup_quote_balance(pg_temp.fx('payq')::uuid) ->> 'outstanding')::numeric = 0);

-- ── a letter keeps the quote's stored amounts ──
select public.bs_as(null);
update public.hub_documents set status = 'accepted' where id = pg_temp.fx('mixed')::uuid;
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL990090', pg_temp.fx('mixed')::uuid, current_date, 10, 'Payment');   -- a letter needs a payment first
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f90 values ('letter', (public.hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('mixed')))).id::text);
select public.bs_check('the letter carries the quote vat and total', (select vat_amount = 50 and total_amount = 1550 and vat_mode = 'exclusive' from public.hub_documents where id = pg_temp.fx('letter')::uuid));

-- ── a revision recomputes from its lines and keeps typed amounts ──
select public.bs_as(null);
update public.hub_documents set status = 'issued' where id = pg_temp.fx('mixed')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mk('rev', 'Business Setup', jsonb_build_array(
  jsonb_build_object('description', 'A', 'amount', 800, 'fee_item_id', pg_temp.fx('fee5')), jsonb_build_object('description', 'B', 'amount', 500, 'fee_item_id', pg_temp.fx('fee0'))),
  jsonb_build_object('revises_id', pg_temp.fx('mixed')));
select public.bs_check('a revision gets its own totals from its lines', (select vat_amount = 40 and total_amount = 1340 from public.hub_documents where id = pg_temp.fx('rev')::uuid));
select public.bs_check('the quote it replaces is superseded', (select status = 'superseded' from public.hub_documents where id = pg_temp.fx('mixed')::uuid));

-- ── other departments calculate as before ──
select pg_temp.mk('bank', 'Business Banking', '[{"description":"X","amount":1050}]', '{"vat_mode":"inclusive"}');
select public.bs_check('banking_totals_same: Banking inclusive 1050 gives vat 50, total 1050',
  (select vat_amount = 50 and total_amount = 1050 and vat_mode = 'inclusive' and not (lines -> 0 ? 'vat_rate') from public.hub_documents where id = pg_temp.fx('bank')::uuid));
select pg_temp.mk('acct', 'Accounting', '[{"description":"X","amount":100}]', '{"vat_mode":"exclusive"}');
select public.bs_check('Accounting exclusive still adds vat on the total',
  (select vat_amount = 5 and total_amount = 105 from public.hub_documents where id = pg_temp.fx('acct')::uuid));
select public.bs_as(null);

-- ══ Task 8: signed copy, payment by case, letter gate ══
select public.bs_as(null);
create function pg_temp.docs(p_k text) returns jsonb language sql security definer as $$ select public.business_setup_case_docs(pg_temp.fx(p_k)::uuid) $$;
create function pg_temp.stg(p_k text) returns text language sql security definer as $$ select stage from public.business_setup_cases where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.qst(p_k text) returns text language sql security definer as $$ select status from public.hub_documents where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.sgst(p_k text) returns text language sql security definer as $$ select status from public.business_setup_signed_quotes where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.cnp(p_k text) returns numeric language sql security definer as $$ select public.business_setup_case_net_paid(pg_temp.fx(p_k)::uuid) $$;
create function pg_temp.dash(p_k text) returns numeric language sql security definer as $$ select (public.business_setup_dashboard() ->> p_k)::numeric $$;
-- A case for a client at Documentation, an issued quote in it (as the acting user), and signing then accepting it as the acting user.
create function pg_temp.mkcase(p_key text, p_client text) returns void language plpgsql as $$
begin with c as (insert into public.business_setup_cases (client_id, stage, lead_name) values (p_client, 'Documentation', p_key) returning id) insert into f90 select p_key, id::text from c; end $$;
create function pg_temp.mkcq(p_key text, p_case text, p_amount numeric) returns void language plpgsql as $$
begin perform pg_temp.mk(p_key, 'Business Setup', jsonb_build_array(jsonb_build_object('description', 'S', 'amount', p_amount)), jsonb_build_object('client_id', 'CL990092', 'case_id', pg_temp.fx(p_case))); end $$;
create function pg_temp.signaccept(p_quote text, p_path text) returns void language plpgsql as $$
declare v_id uuid;
begin
  v_id := public.business_setup_signed_add(pg_temp.fx(p_quote)::uuid, p_path);
  perform public.business_setup_signed_decide(v_id, true, 'Looks right');
end $$;
insert into public.client_master (client_id, legal_name, data) values ('CL990092', 'Eight LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL990092', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
select pg_temp.mkcase('cA', 'CL990092'); select pg_temp.mkcase('cB', 'CL990092'); select pg_temp.mkcase('cC', 'CL990092'); select pg_temp.mkcase('cD', 'CL990092');
select pg_temp.mkcase('cE', 'CL990092'); select pg_temp.mkcase('cF', 'CL990092'); select pg_temp.mkcase('cG', 'CL990092'); select pg_temp.mkcase('cN', null);
select pg_temp.mkcase('cL', 'CL990092');

-- ── accept_needs_signed, the staff upload path rules, refuse_note ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcq('qA', 'cA', 1000);
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('qA')), 'signed copy');
select public.bs_check('accept_needs_signed: the refused accept left the quote issued and made no services', pg_temp.qst('qA') = 'issued' and not exists (select 1 from public.business_setup_services where quote_id = pg_temp.fx('qA')::uuid));
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'incoming/x/a.pdf')$$, pg_temp.fx('qA')), 'staff/CL990092/');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990093/a.pdf')$$, pg_temp.fx('qA')), 'staff/CL990092/');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL99009_/a.pdf')$$, pg_temp.fx('qA')), 'staff/CL990092/');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092/../CL990093/a.pdf')$$, pg_temp.fx('qA')), 'cannot contain');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092//a.pdf')$$, pg_temp.fx('qA')), 'cannot contain');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', '')$$, pg_temp.fx('qA')), 'file path');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092/a.pdf')$$, pg_temp.fx('qA')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f90 values ('sA1', public.business_setup_signed_add(pg_temp.fx('qA')::uuid, 'staff/CL990092/signed-a1.pdf')::text);
select public.bs_check('a staff upload is kept as Staff / Uploaded', (select source = 'Staff' and status = 'Uploaded' and storage_path = 'staff/CL990092/signed-a1.pdf' from public.business_setup_signed_quotes where id = pg_temp.fx('sA1')::uuid));
select public.bs_check('an Uploaded copy does not accept the quote', pg_temp.qst('qA') = 'issued');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092/signed-a2.pdf')$$, pg_temp.fx('qA')), 'already waiting');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('qA')), 'signed copy');
select public.bs_expect_error(format($$select business_setup_signed_decide('%s', false, '  ')$$, pg_temp.fx('sA1')), 'why');
select public.business_setup_signed_decide(pg_temp.fx('sA1')::uuid, false, 'Page 2 is not signed');
select public.bs_check('refuse_note: the refused copy keeps its note', (select status = 'Refused' and note = 'Page 2 is not signed' and decided_by is not null from public.business_setup_signed_quotes where id = pg_temp.fx('sA1')::uuid));
select public.bs_expect_error(format($$select business_setup_signed_decide('%s', true, null)$$, pg_temp.fx('sA1')), 'already been refused');
insert into f90 values ('sA2', public.business_setup_signed_add(pg_temp.fx('qA')::uuid, 'staff/CL990092/signed-a2.pdf')::text);
select public.bs_check('refuse_note: a new upload is allowed after a refusal', pg_temp.sgst('sA2') = 'Uploaded');
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092/signed-a2.pdf')$$, pg_temp.fx('qA')), 'already');
select public.bs_check('the staff file link names the stored path', public.business_setup_signed_file(pg_temp.fx('sA2')::uuid) ->> 'path' = 'staff/CL990092/signed-a2.pdf');
select public.business_setup_signed_decide(pg_temp.fx('sA2')::uuid, true, null);
select public.bs_check('confirming accepts the quote and creates its services', pg_temp.qst('qA') = 'accepted' and (select count(*) = 1 from public.business_setup_services where quote_id = pg_temp.fx('qA')::uuid));
select public.bs_check('the case reads signed', (pg_temp.docs('cA') ->> 'signed')::boolean and not (pg_temp.docs('cA') ->> 'paid')::boolean);
select public.bs_expect_error(format($$select business_setup_signed_add('%s', 'staff/CL990092/signed-a3.pdf')$$, pg_temp.fx('qA')), 'issued');

-- ── advance_payment, payment_needs_client, overpay only after acceptance ──
select public.bs_as('00000000-0000-0000-0000-00000000000e');
insert into f90 values ('advB', public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 500, 'method', 'Cash'))::text);
select public.bs_check('advance_payment: a payment before any quote is recorded on the case with no quote', (select quote_id is null and case_id = pg_temp.fx('cB')::uuid and client_id = 'CL990092' and amount = 500
  from public.business_setup_payments where id = (pg_temp.fx('advB')::jsonb ->> 'payment_id')::uuid));
select public.bs_check('advance_payment: it has a receipt', (select count(*) = 1 from public.business_setup_receipts where payment_id = (pg_temp.fx('advB')::jsonb ->> 'payment_id')::uuid and receipt_number = pg_temp.fx('advB')::jsonb ->> 'receipt_number'));
select public.bs_check('advance_payment: and a receipt voucher', exists (select 1 from public.voucher_register where source = 'business_setup' and voucher_type = 'Receipt' and source_id = (pg_temp.fx('advB')::jsonb ->> 'payment_id')::uuid and amount = 500 and status = 'Valid'));
select public.bs_check('the case pays the advance', pg_temp.cnp('cB') = 500 and (pg_temp.docs('cB') ->> 'paid')::boolean);
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('cN'), 'amount', 10)), 'Link a client');
select public.bs_expect_error($$select business_setup_payment_add('{"amount":10}')$$, 'case or the quote');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 0)), 'amount');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', gen_random_uuid(), 'amount', 10)), 'Case not found');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 10)), 'permission');
select pg_temp.mkcq('qC', 'cC', 1000);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cC'), 'amount', 5000)) as ignored \gset
select public.bs_check('overpay: before acceptance an amount above the quote total is recorded (no balance to check yet)', (select sum(amount) from public.business_setup_payments where case_id = pg_temp.fx('cC')::uuid) = 5000);

-- ── revised_balance: pay 500 on the case, issue a revision of 1050, accept it: balance 550 ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcq('qB1', 'cB', 2000);
select pg_temp.mk('qB2', 'Business Setup', '[{"description":"S","amount":1000}]', jsonb_build_object('client_id', 'CL990092', 'revises_id', pg_temp.fx('qB1')));
select public.bs_check('the revision totals 1050', (select total_amount = 1050 and case_id = pg_temp.fx('cB')::uuid from public.hub_documents where id = pg_temp.fx('qB2')::uuid));
select pg_temp.signaccept('qB2', 'staff/CL990092/signed-b2.pdf');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('revised_balance: the advance counts toward the accepted revision, balance 550',
  (public.business_setup_quote_balance(pg_temp.fx('qB2')::uuid) ->> 'outstanding')::numeric = 550 and (public.business_setup_quote_balance(pg_temp.fx('qB2')::uuid) ->> 'net_paid')::numeric = 500);
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 551)), 'balance');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('qB2'), 'amount', 551)), 'balance');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('qB2'), 'case_id', pg_temp.fx('cA'), 'amount', 10)), 'does not belong');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 551)), 'reason');
select public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cB'), 'amount', 551, 'override_reason', 'Client prepaid extra')) as ignored \gset
select public.bs_check('overpay: a manager with a reason may take it once the quote is accepted', (select sum(amount) from public.business_setup_payments where case_id = pg_temp.fx('cB')::uuid) = 1051);
select public.bs_check('overpay: the payment follows the accepted quote', (select count(*) = 1 from public.business_setup_payments where quote_id = pg_temp.fx('qB2')::uuid and case_id = pg_temp.fx('cB')::uuid));

-- ── reversal_after_letter: reverse the only payment after the letter ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcq('qD', 'cD', 1000);
select pg_temp.signaccept('qD', 'staff/CL990092/signed-d.pdf');
select public.bs_expect_error(format($$select hub_document_create('%s')$$, jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('qD'))), 'payment first');
select public.bs_check('letter_gate: a refused letter leaves no letter', not exists (select 1 from public.hub_documents where parent_id = pg_temp.fx('qD')::uuid and doc_type = 'letter'));
select public.bs_as('00000000-0000-0000-0000-00000000000e');
insert into f90 values ('payD', public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cD'), 'amount', 100))::text);
select public.bs_check('the payment lands on the accepted quote', (select quote_id = pg_temp.fx('qD')::uuid from public.business_setup_payments where id = (pg_temp.fx('payD')::jsonb ->> 'payment_id')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f90 values ('letD', (public.hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('qD')))).id::text);
select public.bs_check('letter_gate: a part payment is enough for the letter', pg_temp.fx('letD') is not null and pg_temp.stg('cD') = 'Assignment');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.dash('receivables') as recv_before \gset
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_reverse((pg_temp.fx('payD')::jsonb ->> 'payment_id')::uuid, 'Cheque bounced') as ignored \gset
select public.bs_check('reversal_after_letter: the reversal takes the money away from the case', (select sum(case when type = 'Payment' then amount else -amount end) from public.business_setup_payments where case_id = pg_temp.fx('cD')::uuid) = 0 and not (pg_temp.docs('cD') ->> 'paid')::boolean);
select public.bs_check('reversal_after_letter: the stage does not go back', pg_temp.stg('cD') = 'Assignment');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('reversal_after_letter: receivables go up by the reversed amount', pg_temp.dash('receivables') = :recv_before + 100, pg_temp.dash('receivables')::text || ' vs ' || :'recv_before');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_service_update('%s', 'In progress')$$, (select id from public.business_setup_services where quote_id = pg_temp.fx('qD')::uuid limit 1)), 'payment is needed');

-- ── letter_gate: zero total, override ──
select pg_temp.mkcq('qE', 'cE', 0);
select pg_temp.signaccept('qE', 'staff/CL990092/signed-e.pdf');
select public.bs_check('a zero total on the accepted quote counts as paid', (pg_temp.docs('cE') ->> 'paid')::boolean);
select public.hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('qE'))) as ignored \gset
select public.bs_check('letter_gate: a zero total allows the letter', exists (select 1 from public.hub_documents where parent_id = pg_temp.fx('qE')::uuid and doc_type = 'letter'));
select pg_temp.mkcq('qF', 'cF', 1000);
select public.bs_check('a case with an unaccepted quote is neither paid nor signed', not (pg_temp.docs('cF') ->> 'paid')::boolean and not (pg_temp.docs('cF') ->> 'signed')::boolean);
select public.bs_check('a case with no quote is not paid, not signed and has no quote', not (pg_temp.docs('cN') ->> 'paid')::boolean and not (pg_temp.docs('cN') ->> 'signed')::boolean and not (pg_temp.docs('cN') ->> 'quote')::boolean);
select pg_temp.signaccept('qF', 'staff/CL990092/signed-f.pdf');
select public.bs_expect_error(format($$select business_setup_case_paid_override('%s', 'Family friend')$$, pg_temp.fx('cF')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_case_paid_override('%s', 'Family friend')$$, pg_temp.fx('cF')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_case_paid_override('%s', '  ')$$, pg_temp.fx('cF')), 'reason');
select public.bs_expect_error(format($$select business_setup_case_paid_override('%s', 'x')$$, gen_random_uuid()), 'Case not found');
select public.bs_check('letter_gate: still unpaid before the override', not (pg_temp.docs('cF') ->> 'paid')::boolean);
select public.business_setup_case_paid_override(pg_temp.fx('cF')::uuid, 'Family friend');
select public.bs_check('letter_gate: the override with a reason marks Paid and is audited', (pg_temp.docs('cF') ->> 'paid')::boolean and public.bs_audit_count('case_paid_override', pg_temp.fx('cF'), '{"reason":"Family friend"}') = 1);
select public.bs_expect_error(format($$select business_setup_case_paid_override('%s', 'again')$$, pg_temp.fx('cF')), 'already');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('qF'))) as ignored \gset
select public.bs_check('letter_gate: with the override the letter is allowed and the case moves on', pg_temp.stg('cF') = 'Assignment');
-- a user without the department right learns nothing from the letter gate
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select hub_document_create('%s')$$, jsonb_build_object('doc_type', 'letter', 'parent_id', pg_temp.fx('qA'))), 'permission');

-- ── revision_refuses_old ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mkcq('qG1', 'cG', 1000);
insert into f90 values ('sG', public.business_setup_signed_add(pg_temp.fx('qG1')::uuid, 'staff/CL990092/signed-g1.pdf')::text);
select pg_temp.mk('qG2', 'Business Setup', '[{"description":"S","amount":900}]', jsonb_build_object('client_id', 'CL990092', 'revises_id', pg_temp.fx('qG1')));
select public.bs_check('revision_refuses_old: revising sets the old Uploaded copy to Refused with a note', (select status = 'Refused' and note ilike '%revised%' from public.business_setup_signed_quotes where id = pg_temp.fx('sG')::uuid));
select public.bs_check('the old quote is superseded and the new quote has no signed copy', pg_temp.qst('qG1') = 'superseded' and not exists (select 1 from public.business_setup_signed_quotes where quote_id = pg_temp.fx('qG2')::uuid));
select public.bs_expect_error(format($$select business_setup_signed_decide('%s', true, null)$$, pg_temp.fx('sG')), 'already been refused');

-- ── a quote accepted before signed copies were required keeps working ──
select public.bs_as(null);
with o as (insert into public.hub_documents (doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  values ('quote', 'Business Setup', 'Old LLC', 'CL990092', 'OLD-T8', 100, 'accepted', pg_temp.fx('cL')::uuid) returning id) insert into f90 select 'oldq', id::text from o;
delete from public.business_setup_signed_quotes where quote_id = pg_temp.fx('oldq')::uuid;
select public.bs_check('before the backfill the old accepted quote has no signed copy', not (pg_temp.docs('cL') ->> 'signed')::boolean);
\ir ../migrations/015_documentation.sql
select public.bs_check('backfill: the old accepted quote gets one Legacy row with no file', (select count(*) = 1 and bool_and(source = 'Legacy' and status = 'Confirmed' and storage_path is null) from public.business_setup_signed_quotes where quote_id = pg_temp.fx('oldq')::uuid));
select public.bs_check('backfill: and the case reads signed', (pg_temp.docs('cL') ->> 'signed')::boolean);
\ir ../migrations/015_documentation.sql
select public.bs_check('the backfill is not repeated on a second run', (select count(*) = 1 from public.business_setup_signed_quotes where quote_id = pg_temp.fx('oldq')::uuid));
select public.bs_check('a Legacy row has no path and a file row has one', not exists (select 1 from public.business_setup_signed_quotes where (source = 'Legacy') <> (storage_path is null)));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_signed_file('%s')$$, (select id from public.business_setup_signed_quotes where quote_id = pg_temp.fx('oldq')::uuid)), 'no file');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_signed_file('%s')$$, pg_temp.fx('sA2')), 'permission');
select public.bs_as(null);
select public.bs_check('signed copies cannot be written through the API', not has_table_privilege('authenticated', 'public.business_setup_signed_quotes', 'insert')
  and not has_table_privilege('authenticated', 'public.business_setup_signed_quotes', 'update') and not has_table_privilege('anon', 'public.business_setup_signed_quotes', 'select'));
select public.bs_check('the shared case sum is internal', not has_function_privilege('authenticated', 'public.business_setup_case_net_paid(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_case_net_paid(uuid)', 'execute'));
select public.bs_check('staff may call the signed and override functions, anon may not', has_function_privilege('authenticated', 'public.business_setup_signed_decide(uuid, boolean, text, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.business_setup_case_paid_override(uuid, text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_signed_add(uuid, text)', 'execute'));


-- ── a confirm that the accept refuses leaves the copy waiting ──
select public.bs_as(null);
select pg_temp.mkcase('cH', 'CL990092');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select pg_temp.mk('qH', 'Business Setup', '[{"description":"S","amount":100}]', jsonb_build_object('client_id', 'CL990092', 'case_id', pg_temp.fx('cH'), 'valid_until', (current_date - 3)::text));
insert into f90 values ('sH', public.business_setup_signed_add(pg_temp.fx('qH')::uuid, 'staff/CL990092/signed-h.pdf')::text);
select public.bs_expect_error(format($$select business_setup_signed_decide('%s', true, null)$$, pg_temp.fx('sH')), 'expired');
select public.bs_check('a refused accept rolls the confirmation back: the copy waits and the quote stays issued', pg_temp.sgst('sH') = 'Uploaded' and pg_temp.qst('qH') = 'issued');
select public.business_setup_signed_decide(pg_temp.fx('sH')::uuid, true, null, true);
select public.bs_check('with the expiry confirmed the copy is Confirmed and the quote accepted', pg_temp.sgst('sH') = 'Confirmed' and pg_temp.qst('qH') = 'accepted');

-- ── a case with no client shows its quote and letter numbers (read-only) ──
select public.bs_as(null);
select pg_temp.mkcase('cX', null);
insert into public.hub_documents (doc_type, department, client_name, document_number, total_amount, status, case_id, storage_path)
  values ('quote', 'Business Setup', 'Lead LLC', 'NOCLIENT-Q', 100, 'issued', pg_temp.fx('cX')::uuid, 'q/x.docx'), ('letter', 'Business Setup', 'Lead LLC', 'NOCLIENT-L', 100, 'issued', pg_temp.fx('cX')::uuid, null);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('case_documents: a client-less case lists its quote and letter with their numbers and files',
  (select count(*) = 2 and bool_or(e ->> 'document_number' = 'NOCLIENT-Q' and e ->> 'storage_path' = 'q/x.docx' and e ->> 'doc_type' = 'quote') and bool_or(e ->> 'document_number' = 'NOCLIENT-L' and e ->> 'doc_type' = 'letter')
    from jsonb_array_elements(public.business_setup_case_documents(pg_temp.fx('cX')::uuid)) e));
select public.bs_check('case_documents: another case is not mixed in', jsonb_array_length(public.business_setup_case_documents(pg_temp.fx('cN')::uuid)) = 0);
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_case_documents('%s')$$, pg_temp.fx('cX')), 'permission');
select public.bs_as(null);
-- ── Summary ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
