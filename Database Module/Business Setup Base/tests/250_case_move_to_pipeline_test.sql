-- LOCAL TEST ONLY: a manager moves an Onboarding case to Pipeline by hand (029). Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir ../migrations/029_case_move_to_pipeline.sql
create temp table f250 (k text primary key, v text);
grant all on f250 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f250 where k = p_k $$;

insert into public.client_master (client_id, legal_name, data) values ('CL990250', 'Pipeline Move LLC', '{}') on conflict do nothing;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Onboarding', 'move-250', 'CL990250') returning id) insert into f250 select 'case', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name) values ('Onboarding', 'move-250-noclient') returning id) insert into f250 select 'noclient', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Lead', 'move-250-lead', 'CL990250') returning id) insert into f250 select 'lead', id::text from x;

-- ── Rights and checks ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_pipeline('%s', 'go')$$, pg_temp.fx('case')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_pipeline('%s', '  ')$$, pg_temp.fx('case')), 'Give a reason');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_pipeline('%s', 'go')$$, pg_temp.fx('noclient')), 'Link the client');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_pipeline('%s', 'go')$$, pg_temp.fx('lead')), 'Only a case at Client Onboarding');

-- ── The move ──
select public.business_setup_case_move_to_pipeline(pg_temp.fx('case')::uuid, 'Client paid in cash, papers to follow');
select public.bs_as(null);
select public.bs_check('move_to_pipeline: the case is at Pipeline', (select stage = 'Pipeline' from public.business_setup_cases where id = pg_temp.fx('case')::uuid));
select public.bs_check('move_to_pipeline: audited', public.bs_audit_count('case_stage', pg_temp.fx('case'), '{"stage":"Pipeline"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_pipeline('%s', 'again')$$, pg_temp.fx('case')), 'Only a case at Client Onboarding');
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
