-- LOCAL TEST ONLY: a referrer who is not on the staff (027). Run through tests/run-local.sh, after 200.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 200 re-runs 019, which puts back its own business_setup_referrers: put 027 back on top.
\ir ../migrations/027_other_referrers.sql
create temp table f220 (k text primary key, v text);
grant all on f220 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f220 where k = p_k $$;

insert into public.client_master (client_id, legal_name, data) values ('CL990220', 'Referred LLC', '{}') on conflict do nothing;
with x as (insert into public.business_setup_cases (stage, lead_name, client_id) values ('Onboarding', 'ref-220', 'CL990220') returning id) insert into f220 select 'case', id::text from x;
with x as (insert into public.business_setup_cases (stage, lead_name) values ('Lead', 'ref-220-b') returning id) insert into f220 select 'case2', id::text from x;

-- ── Only admins, with a reason and a name ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_set_referrer_other('%s', 'Ahmed Broker', 'his lead')$$, pg_temp.fx('case')), 'Admins only');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select public.business_setup_case_set_referrer_other('%s', 'Ahmed Broker', ' ')$$, pg_temp.fx('case')), 'reason');
select public.bs_expect_error(format($$select public.business_setup_case_set_referrer_other('%s', ' ', 'his lead')$$, pg_temp.fx('case')), 'name');

-- ── A third party is saved, and offered next time ──
select public.business_setup_case_set_referrer_other(pg_temp.fx('case')::uuid, '  Ahmed   Broker ', 'his lead');
select public.bs_check('other_referrer: the case holds the cleaned name and no staff referrer', (select referred_by is null and referred_by_other = 'Ahmed Broker' from public.business_setup_cases where id = pg_temp.fx('case')::uuid));
select public.bs_check('other_referrer: the name is listed for next time', public.business_setup_other_referrer_list() ? 'Ahmed Broker');
select public.business_setup_case_set_referrer_other(pg_temp.fx('case2')::uuid, 'ahmed broker', 'same person');
select public.bs_check('other_referrer: the same name in another case is kept once, as first saved', (select count(*) = 1 from jsonb_array_elements_text(public.business_setup_other_referrer_list()) n where lower(n) = 'ahmed broker')
  and (select referred_by_other = 'Ahmed Broker' from public.business_setup_cases where id = pg_temp.fx('case2')::uuid));
select public.bs_check('other_referrer: All Clients lists the third party', public.business_setup_referrers() -> 'CL990220' ->> 0 = 'Ahmed Broker');
select public.bs_check('other_referrer: case_list carries the name', (select e ->> 'referred_by_other' = 'Ahmed Broker' from jsonb_array_elements(public.business_setup_case_list('onboarding')) e where e ->> 'id' = pg_temp.fx('case')));

-- ── Back to a member of staff: the name is cleared on the case, kept in the list ──
select public.business_setup_case_set_referrer(pg_temp.fx('case')::uuid, '00000000-0000-0000-0000-00000000000c', 'Handled by Sales');
select public.bs_check('other_referrer: choosing staff clears the third party', (select referred_by = '00000000-0000-0000-0000-00000000000c' and referred_by_other is null from public.business_setup_cases where id = pg_temp.fx('case')::uuid)
  and public.business_setup_other_referrer_list() ? 'Ahmed Broker');
select public.bs_as(null);
select public.bs_check('other_referrer: each change is logged', public.bs_audit_count('case_referrer_change', pg_temp.fx('case'), '{"reason":"his lead"}') = 1
  and public.bs_audit_count('case_referrer_change', pg_temp.fx('case'), '{"reason":"Handled by Sales"}') = 1);
select public.bs_expect_error(format($$update public.business_setup_cases set referred_by_other = 'X' where id = '%s'$$, pg_temp.fx('case')), 'one_referrer');

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
