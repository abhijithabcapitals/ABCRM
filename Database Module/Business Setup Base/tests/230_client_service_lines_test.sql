-- LOCAL TEST ONLY: a client's service lines (026). Run through tests/run-local.sh, after 220.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create temp table f230 (k text primary key, v text);
grant all on f230 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f230 where k = p_k $$;

insert into public.client_master (client_id, legal_name, data) values ('CL990230', 'Lines LLC', '{}'), ('CL990231', 'Other LLC', '{}') on conflict do nothing;
with x as (insert into public.business_setup_fee_items (grp, name, default_amount, active) values ('T230', 'Mainland licence', 1500, true) returning id) insert into f230 select 'fee', id::text from x;
with x as (insert into public.business_setup_fee_items (grp, name, default_amount, active) values ('T230', 'Old service', 100, false) returning id) insert into f230 select 'old', id::text from x;

-- ── Only staff who make quotes add lines; anyone in Setup reads them ──
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"client_id":"CL990230","fee_item_id":"%s","amount":1000}')$$, pg_temp.fx('fee')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select public.business_setup_service_line_save('{"client_id":"CL990230","amount":1000}')$$, 'Choose a service');
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"client_id":"CL990230","fee_item_id":"%s","amount":1000}')$$, pg_temp.fx('old')), 'Choose a service');
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"client_id":"CL990230","fee_item_id":"%s","amount":-1}')$$, pg_temp.fx('fee')), 'fee amount');
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"client_id":"CL990230","fee_item_id":"%s","amount":"abc"}')$$, pg_temp.fx('fee')), 'fee amount');
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"client_id":"NOPE","fee_item_id":"%s","amount":1}')$$, pg_temp.fx('fee')), 'Client not found');

-- ── Add two lines, change one, remove one ──
insert into f230 select 'l1', public.business_setup_service_line_save(jsonb_build_object('client_id', 'CL990230', 'fee_item_id', pg_temp.fx('fee'), 'amount', 1200.456))::text;
insert into f230 select 'l2', public.business_setup_service_line_save(jsonb_build_object('client_id', 'CL990230', 'fee_item_id', pg_temp.fx('fee'), 'amount', 50))::text;
select public.bs_check('service_lines: the list carries name, group and fee', (select e ->> 'service_name' = 'Mainland licence' and e ->> 'grp' = 'T230' and (e ->> 'amount')::numeric = 1200.46
  from jsonb_array_elements(public.business_setup_service_line_list('CL990230')) e where e ->> 'id' = pg_temp.fx('l1')));
select public.business_setup_service_line_save(jsonb_build_object('id', pg_temp.fx('l2'), 'fee_item_id', pg_temp.fx('fee'), 'amount', 75));
select public.bs_check('service_lines: a line changes', (select (e ->> 'amount')::numeric = 75 from jsonb_array_elements(public.business_setup_service_line_list('CL990230')) e where e ->> 'id' = pg_temp.fx('l2')));
select public.bs_expect_error($$select count(*) from public.business_setup_client_service_lines$$, 'permission denied');
select public.business_setup_service_line_delete(pg_temp.fx('l2')::uuid);
select public.bs_check('service_lines: a line is removed', jsonb_array_length(public.business_setup_service_line_list('CL990230')) = 1);
select public.bs_check('service_lines: another client sees none', jsonb_array_length(public.business_setup_service_line_list('CL990231')) = 0);

-- ── Once quoted, a line is fixed ──
select public.bs_as(null);
with x as (insert into public.hub_documents (doc_type, department, client_name, document_number, document_serial, client_id) values ('quote', 'Business Setup', 'Lines LLC', 'Q-230', 230, 'CL990230') returning id) insert into f230 select 'q', id::text from x;
with x as (insert into public.hub_documents (doc_type, department, client_name, document_number, document_serial, client_id) values ('quote', 'Business Setup', 'Other LLC', 'Q-231', 231, 'CL990231') returning id) insert into f230 select 'q2', id::text from x;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('service_lines: a quote for another client takes no line', public.business_setup_service_line_quoted(pg_temp.fx('q2')::uuid, array[pg_temp.fx('l1')::uuid]) = 0);
select public.bs_check('service_lines: the quote takes the line', public.business_setup_service_line_quoted(pg_temp.fx('q')::uuid, array[pg_temp.fx('l1')::uuid]) = 1);
select public.bs_check('service_lines: the list shows the quote number', (select e ->> 'quote_number' = 'Q-230' from jsonb_array_elements(public.business_setup_service_line_list('CL990230')) e where e ->> 'id' = pg_temp.fx('l1')));
select public.bs_expect_error(format($$select public.business_setup_service_line_save('{"id":"%s","fee_item_id":"%s","amount":1}')$$, pg_temp.fx('l1'), pg_temp.fx('fee')), 'on a quote');
select public.bs_expect_error(format($$select public.business_setup_service_line_delete('%s')$$, pg_temp.fx('l1')), 'on a quote');
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
