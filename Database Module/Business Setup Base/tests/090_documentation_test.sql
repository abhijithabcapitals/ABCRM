-- LOCAL TEST ONLY: suggested fee amounts and per-item VAT on quotes (restructure Task 7). Run through tests/run-local.sh, after 010.
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

-- ── a letter keeps the quote's stored amounts ──
select public.bs_as(null);
update public.hub_documents set status = 'accepted' where id = pg_temp.fx('mixed')::uuid;
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

-- ── Summary ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
