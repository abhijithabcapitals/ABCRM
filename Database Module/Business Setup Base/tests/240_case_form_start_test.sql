-- LOCAL TEST ONLY: a client form started by staff dropping files (028). Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir ../migrations/028_case_form_start.sql
create temp table f240 (k text primary key, v text);
grant all on f240 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f240 where k = p_k $$;

insert into public.client_master (client_id, legal_name, data) values ('CL990240', 'Dropped LLC', '{}'), ('CL990241', 'Has Form LLC', '{}') on conflict do nothing;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Onboarding', 'drop-240', 'CL990240') returning id) insert into f240 select 'case', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name) values ('Onboarding', 'drop-240-noclient') returning id) insert into f240 select 'noclient', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Onboarding', 'drop-241', 'CL990241') returning id) insert into f240 select 'case2', id::text from x;
insert into public.business_setup_onboarding_forms (client_id, form_version, status) values ('CL990241', (select max(version) from public.business_setup_form_versions), 'Submitted');

-- ── Rights and checks ──
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select public.business_setup_case_form_start('%s')$$, pg_temp.fx('case')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select public.business_setup_case_form_start('%s')$$, pg_temp.fx('noclient')), 'Link the client');

-- ── A case with no form: a new one, In review, on the case, no login ──
insert into f240 select 'form', public.business_setup_case_form_start(pg_temp.fx('case')::uuid)::text;
select public.bs_as(null);
select public.bs_check('form_start: a new form is In review on the case, with no login', (select status = 'In review' and case_id = pg_temp.fx('case')::uuid and account_id is null and taken_by is not null
  from public.business_setup_onboarding_forms where id = pg_temp.fx('form')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('form_start: a second drop returns the same form', public.business_setup_case_form_start(pg_temp.fx('case')::uuid)::text = pg_temp.fx('form'));
select public.business_setup_form_staff_save(pg_temp.fx('form')::uuid, '{"client_name":"Dropped LLC"}');
select public.business_setup_form_doc_add(pg_temp.fx('form')::uuid, 'Passport', 'staff/CL990240/p.pdf');

-- ── The client's open form, made earlier: linked and taken, not a second one ──
insert into f240 select 'form2', public.business_setup_case_form_start(pg_temp.fx('case2')::uuid)::text;
select public.bs_as(null);
select public.bs_check('form_start: the open form is linked and taken for review', (select count(*) = 1 from public.business_setup_onboarding_forms where client_id = 'CL990241')
  and (select status = 'In review' and case_id = pg_temp.fx('case2')::uuid from public.business_setup_onboarding_forms where id = pg_temp.fx('form2')::uuid));
select public.bs_check('form_start: logged', public.bs_audit_count('form_staff_start', pg_temp.fx('form'), '{"client_id":"CL990240"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('form_start: case_list shows the form', (select e ->> 'form_id' = pg_temp.fx('form') from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('case')));
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
