-- LOCAL TEST ONLY: main fields on the Clients list and what they lack. Invented rows. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create function pg_temp.row_of(p text) returns jsonb language sql as $$ select e from jsonb_array_elements(public.business_setup_client_main_fields()) e where e ->> 'client_id' = p $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900190', 'Main Field Empty LLC', '{"Client Legal Name":"Main Field Empty LLC"}');
insert into public.business_setup_kyc_profiles (client_id) values ('CL900190');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.business_setup_import_stage('00000000-0000-0000-0000-00000000bbbb', $json$[
  {"source":"company","source_key":"company:dataset:full","name":"Dataset Full LLC","company":"Dataset Full LLC","payload":{"service":"Company Registration","jurisdiction":"IFZA","zone_as_written":"IFZA","licence_number":"2218174.01","licence_date":"2025-01-02","licence_issue":"2025-01-02","licence_expiry":"2026-01-01","shareholder":"S One","manager":"M One","visa":"1 Visa","client_status":"Active","kyc_form":"Done","kyc_form_sheet":"N/A","remarks":"Idenfo","ct_reg":"Done"}},
  {"source":"company","source_key":"company:dataset:part","name":"Dataset Part LLC","company":"Dataset Part LLC","payload":{"service":"Company Registration","licence_date":"2026-02-27","licence_issue":"2026-02-27","licence_expiry":"2026-02-26","client_status":"Liquidated","kyc_form":"Done","dates_to_check":true}},
  {"source":"company","source_key":"company:dataset:twin","name":"Dataset Twin LLC","company":"Dataset Twin LLC","payload":{"kyc_form":"Done","client_status":"Active"}},
  {"source":"company","source_key":"company:dataset:twin:2","name":"Dataset Twin LLC","company":"Dataset Twin LLC","payload":{"kyc_form":"Done","client_status":"Active","licence_number":"T2"}}
]$json$::jsonb);
select public.business_setup_import_apply('00000000-0000-0000-0000-00000000bbbb');
create function pg_temp.cid(p text) returns text language sql as $$ select min(client_id) from public.client_master where legal_name = p $$;

select public.bs_check('a full row has nothing missing', pg_temp.row_of(pg_temp.cid('Dataset Full LLC')) -> 'missing' = '[]'::jsonb);
select public.bs_check('all main fields read back', (pg_temp.row_of(pg_temp.cid('Dataset Full LLC')) ->> 'licence_number') = '2218174.01' and (pg_temp.row_of(pg_temp.cid('Dataset Full LLC')) ->> 'licence_date') = '2025-01-02' and (pg_temp.row_of(pg_temp.cid('Dataset Full LLC')) ->> 'manager') = 'M One' and (pg_temp.row_of(pg_temp.cid('Dataset Full LLC')) ->> 'service') = 'Company Registration');
select public.bs_check('imported clients are KYC done', (select count(*) from public.business_setup_kyc_profiles k join public.client_master c using (client_id) where c.legal_name like 'Dataset %' and k.kyc_state = 'Done') = 3);
select public.bs_check('optional fields are kept', (select licence_extras ->> 'remarks' = 'Idenfo' and licence_extras ->> 'ct_reg' = 'Done' and licence_extras ->> 'kyc_form_sheet' = 'N/A' from public.business_setup_kyc_profiles where client_id = pg_temp.cid('Dataset Full LLC')));
select public.bs_check('status is stored', (select client_status = 'Liquidated' from public.business_setup_kyc_profiles where client_id = pg_temp.cid('Dataset Part LLC')));
select public.bs_check('missing fields are named', pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) -> 'missing' = '["Zone","Licence number","Shareholder","Manager","Visa"]'::jsonb);
select public.bs_check('odd dates are captured and flagged', (pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) ->> 'licence_expiry') = '2026-02-26' and (pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) ->> 'dates_to_check')::boolean);
select public.bs_check('an empty profile shows all eight missing', jsonb_array_length(pg_temp.row_of('CL900190') -> 'missing') = 8);
select public.bs_check('the same name twice leaves one client', (select count(*) from public.client_master where legal_name = 'Dataset Twin LLC') = 1);

select public.business_setup_client_main_save(pg_temp.cid('Dataset Part LLC'), '{"zone":"RAKEZ","licence_number":"N-1","licence_date":"2026-02-27","licence_expiry":"2027-02-26","shareholder":"S Two","manager":"M Two","visa":"0 Visa","service":"Company Registration"}');
select public.bs_check('completing fields clears the indicator', pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) -> 'missing' = '[]'::jsonb);
select public.bs_check('saving dates clears the date flag', not (pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) ->> 'dates_to_check')::boolean);
select public.bs_check('licence details reach Client Master', (select public.client_master_plain(data ->> 'Trade License Number') = 'N-1' and public.client_master_plain(data ->> 'License Issuing Authority') = 'RAKEZ' and public.client_master_plain(data ->> 'License Expiry Date') = '26/02/2027' from public.client_master where client_id = pg_temp.cid('Dataset Part LLC')));
select public.bs_check('optional fields survive a save', (select licence_extras ->> 'client_status' is null and client_status = 'Liquidated' from public.business_setup_kyc_profiles where client_id = pg_temp.cid('Dataset Part LLC')));
select public.business_setup_client_main_save(pg_temp.cid('Dataset Part LLC'), '{"manager":""}');
select public.bs_check('an empty value clears one field and leaves the rest', pg_temp.row_of(pg_temp.cid('Dataset Part LLC')) -> 'missing' = '["Manager"]'::jsonb);
select public.bs_expect_error(format($$select business_setup_client_main_save('%s','{"licence_expiry":"not a date"}')$$, pg_temp.cid('Dataset Part LLC')), 'real date');
select public.bs_expect_error($$select business_setup_client_main_save('CL999999','{"manager":"x"}')$$, 'not found');

select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select business_setup_client_main_fields()$$, 'permission');
select public.bs_expect_error($$select business_setup_client_main_save('CL900190','{"manager":"x"}')$$, 'permission');
select public.bs_as(null);
select public.bs_check('anon cannot run them', not has_function_privilege('anon', 'public.business_setup_client_main_fields()', 'execute') and not has_function_privilege('anon', 'public.business_setup_client_main_save(text, jsonb)', 'execute'));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
