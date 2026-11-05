-- LOCAL TEST ONLY: Business Setup clients on All Clients. Invented rows. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create function pg_temp.row_of(p text) returns jsonb language sql as $$ select e from jsonb_array_elements(public.client_base_list()) e where e ->> 'client_master_id' = p $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL900180', 'Setup Only LLC', '{"Client Legal Name":"Setup Only LLC","General Email":"a@b.test"}'),
  ('CL900181', 'Setup And Banking LLC', '{"Client Legal Name":"Setup And Banking LLC"}'),
  ('CL900182', 'Master Only LLC', '{"Client Legal Name":"Master Only LLC"}');
insert into public.business_setup_kyc_profiles (client_id, licence_number, jurisdiction, licence_expiry, kyc_state) values
  ('CL900180', 'L-180', 'IFZA', '2027-01-01', 'Done'), ('CL900181', 'L-181', 'RAKEZ', null, 'Done');
insert into public.banking_clients (client_type, display_name, client_master_id) values ('Company', 'Setup And Banking LLC', 'CL900181');
create temp table n180 as select count(*) as banking_rows from public.banking_clients;
grant select on n180 to authenticated;

select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('a Business Setup client with no Banking row is listed', pg_temp.row_of('CL900180') ->> 'display_name' = 'Setup Only LLC');
select public.bs_check('its line is Business Setup alone', pg_temp.row_of('CL900180') -> 'lines' = '["Business Setup"]'::jsonb);
select public.bs_check('it is marked, with its licence, zone and expiry', (pg_temp.row_of('CL900180') ->> 'setup_only')::boolean and pg_temp.row_of('CL900180') ->> 'license_number' = 'L-180' and pg_temp.row_of('CL900180') ->> 'issuing_authority' = 'IFZA' and pg_temp.row_of('CL900180') ->> 'license_expiry_date' = '2027-01-01');
select public.bs_check('a client with a Banking row is listed once and gets the line', (select count(*) from jsonb_array_elements(public.client_base_list()) e where e ->> 'client_master_id' = 'CL900181') = 1 and pg_temp.row_of('CL900181') -> 'lines' ? 'Business Setup' and pg_temp.row_of('CL900181') ->> 'setup_only' is null);
select public.bs_check('a Client Master row with no Business Setup profile stays off the list', pg_temp.row_of('CL900182') is null);
select public.bs_check('nothing is added to Banking', (select count(*) from public.banking_clients) = (select banking_rows from n180));
select public.bs_check('the list is in name order', (select bool_and(a <= b) from (select lower(e ->> 'display_name') a, lead(lower(e ->> 'display_name')) over (order by ord) b from jsonb_array_elements(public.client_base_list()) with ordinality x(e, ord)) y where b is not null));
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_check('a user with no rights sees none of them', pg_temp.row_of('CL900180') is null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
