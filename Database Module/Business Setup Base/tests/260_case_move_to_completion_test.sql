-- LOCAL TEST ONLY: a manager moves a Pipeline case to Completion by hand (031). Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned
\ir ../migrations/031_case_move_to_completion.sql
create temp table f260 (k text primary key, v text);
grant all on f260 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f260 where k = p_k $$;

insert into public.client_master (client_id, legal_name, data) values ('CL990260', 'Completion Move LLC', '{}') on conflict do nothing;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Pipeline', 'move-260', 'CL990260') returning id) insert into f260 select 'case', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name) values ('Pipeline', 'move-260-noclient') returning id) insert into f260 select 'noclient', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Onboarding', 'move-260-onb', 'CL990260') returning id) insert into f260 select 'onb', id::text from x;

-- ── Rights and checks ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_completion('%s', 'go')$$, pg_temp.fx('case')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_completion('%s', '  ')$$, pg_temp.fx('case')), 'Give a reason');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_completion('%s', 'go')$$, pg_temp.fx('noclient')), 'Link the client');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_completion('%s', 'go')$$, pg_temp.fx('onb')), 'Only a case at Pipeline');

-- ── The move ──
select public.business_setup_case_move_to_completion(pg_temp.fx('case')::uuid, 'Work done outside the tracker');
select public.bs_as(null);
select public.bs_check('move_to_completion: the case is at Completion', (select stage = 'Completion' from public.business_setup_cases where id = pg_temp.fx('case')::uuid));
select public.bs_check('move_to_completion: audited', public.bs_audit_count('case_stage', pg_temp.fx('case'), '{"stage":"Completion"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_case_move_to_completion('%s', 'again')$$, pg_temp.fx('case')), 'Only a case at Pipeline');
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
