-- LOCAL TEST ONLY: Visa Registration records from a sheet. Invented rows. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create function pg_temp.main_of(p text) returns jsonb language sql as $$ select e from jsonb_array_elements(public.business_setup_client_main_fields()) e where e ->> 'client_id' = p $$;
create function pg_temp.svc(p text) returns text language sql as $$ select public.client_master_plain(data ->> 'Services Provided') from public.client_master where client_id = p $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL900170', 'Visa Existing LLC', '{"Client Legal Name":"Visa Existing LLC","Services Provided":"Bookkeeping"}'),
  ('CL900171', 'Visa Linked Name', '{"Client Legal Name":"Visa Linked Name"}');
insert into public.business_setup_kyc_profiles (client_id, kyc_state, licence_extras) values ('CL900170', 'Done', '{"service":"Company Registration","visa":"2 Visa"}');

select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select business_setup_visa_sheet_apply('[]')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
create temp table r170 as select public.business_setup_visa_sheet_apply($json$[
  {"source_key":"a:existing","person":"A Person","company":"VISA EXISTING L.L.C","occupation":"PARTNER","issue_date":"2025-01-01","expiry_date":"2027-01-01"},
  {"source_key":"b:existing","person":"B Person","company":"Visa Existing LLC","occupation":"INVESTOR","issue_date":"2025-02-01","expiry_date":"2027-02-01","update":"On Going"},
  {"source_key":"c:linked","person":"C Person","company":"VISA LINKED NAME FZ LLC","client_id":"CL900171","occupation":"PARTNER","issue_date":"2024-01-01","expiry_date":"2025-01-01","update":"X"},
  {"source_key":"d:new","person":"D Person","company":"Visa Brand New FZE","occupation":"NEEDS TO ENTER THE UAE"},
  {"source_key":"e:new","person":"E Person","company":"VISA BRAND NEW F.Z.E","occupation":"PARTNER","issue_date":"2025-03-01","expiry_date":"2027-03-01"}
]$json$::jsonb) as j;
grant select on r170 to authenticated;
create function pg_temp.new_id() returns text language sql as $$ select min(client_id) from public.client_master where legal_name = 'Visa Brand New FZE' $$;

select public.bs_check('counts come back', (select j ->> 'visas' = '5' and j ->> 'services' = '5' and j ->> 'new_clients' = '1' and j ->> 'clients' = '3' from r170));
select public.bs_check('an exact name links to the client', (select count(*) from public.business_setup_visas where client_id = 'CL900170') = 2);
select public.bs_check('a hand link is used', (select count(*) from public.business_setup_visas where client_id = 'CL900171') = 1);
select public.bs_check('spellings of one new company make one client', (select count(*) from public.client_master where legal_name ilike 'Visa Brand New%') = 1 and (select count(*) from public.business_setup_visas where client_id = pg_temp.new_id()) = 2);
select public.bs_check('the visa keeps its details as written', (select occupation = 'PARTNER' and issue_date = '2024-01-01' and expiry_date = '2025-01-01' and status = 'X' from public.business_setup_visas where source_key = 'c:linked'));
select public.bs_check('an issued visa is a completed past service', (select status = 'Completed' and historical and name = 'Visa Registration' from public.business_setup_services where source_key = 'visa_sheet:a:existing'));
select public.bs_check('on going stays open', (select status = 'In progress' and not historical from public.business_setup_services where source_key = 'visa_sheet:b:existing'));
select public.bs_check('no issue date has not started', (select status = 'Not started' and not historical from public.business_setup_services where source_key = 'visa_sheet:d:new'));
select public.bs_check('the list adds the service to what is there', pg_temp.main_of('CL900170') ->> 'service' = 'Company Registration, Visa Registration');
select public.bs_check('an existing visa count stays', pg_temp.main_of('CL900170') ->> 'visa' = '2 Visa');
select public.bs_check('a blank client gets the service and its count', pg_temp.main_of('CL900171') ->> 'service' = 'Visa Registration' and pg_temp.main_of('CL900171') ->> 'visa' = '1 Visa');
select public.bs_check('a new client is on the list', pg_temp.main_of(pg_temp.new_id()) ->> 'visa' = '2 Visa');
select public.bs_check('Client Master adds the service to what is there', pg_temp.svc('CL900170') = 'Bookkeeping; Visa Registration');
select public.bs_check('Client Master fills a blank', pg_temp.svc('CL900171') = 'Visa Registration');
select public.bs_check('KYC state is left alone', (select kyc_state = 'Done' from public.business_setup_kyc_profiles where client_id = 'CL900170') and (select kyc_state is null from public.business_setup_kyc_profiles where client_id = 'CL900171'));
select public.bs_as(null);
select public.bs_check('no login is issued', not exists (select 1 from public.client_portal_accounts where client_master_id in ('CL900170', 'CL900171', pg_temp.new_id())));
select public.bs_as('00000000-0000-0000-0000-00000000000a');

select public.bs_check('a second run adds nothing', (public.business_setup_visa_sheet_apply('[{"source_key":"a:existing","person":"A Person","company":"Visa Existing LLC"}]') ->> 'visas') = '0');
select public.bs_check('a second run does not repeat the service name', pg_temp.svc('CL900170') = 'Bookkeeping; Visa Registration' and pg_temp.main_of('CL900170') ->> 'service' = 'Company Registration, Visa Registration');
select public.bs_expect_error($$select business_setup_visa_sheet_apply('[{"source_key":"z","person":"Z","company":"Nope","client_id":"CL999999"}]')$$, 'not found');
select public.bs_expect_error($$select business_setup_visa_sheet_apply('[{"source_key":"z","company":"Nope"}]')$$, 'needs a company');
select public.bs_check('these are on All Clients as Business Setup', (select bool_and(e -> 'lines' ? 'Business Setup') from jsonb_array_elements(public.client_base_list()) e where e ->> 'client_master_id' in ('CL900170', 'CL900171')));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
