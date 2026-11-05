-- LOCAL TEST ONLY: Terms and Conditions at client sign-in (Client Login Base 005). Run through tests/run-local.sh, after 150.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier test files grant every function to staff: this puts this migration's own grants back.
\ir '../../Client Login Base/migrations/005_terms.sql'
create temp table f160 (k text primary key, v text);
grant all on f160 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f160 where k = p_k $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL990160', 'Terms LLC', '{}') on conflict do nothing;
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL990160', 'T', 'portal.t160', 'x', 'active');
insert into f160 select 'acc', id::text from public.client_portal_accounts where username = 'portal.t160';
insert into public.client_master (client_id, legal_name, data) values ('CL990161', 'Other LLC', '{}') on conflict do nothing;
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL990161', 'O', 'portal.o160', 'x', 'revoked');
insert into f160 select 'revoked', id::text from public.client_portal_accounts where username = 'portal.o160';
create function pg_temp.req() returns boolean language sql as $$ select (public.client_portal_terms_state(pg_temp.fx('acc')::uuid) ->> 'required')::boolean $$;

-- ── The seed ──
select public.bs_check('seed: one draft, marked not reviewed, with lawyer placeholders', (select count(*) = 1 and bool_and(status = 'Draft') and bool_and(title like '%not yet legally reviewed%') and bool_and(body like '%[EMIRATE: lawyer to confirm]%') from public.client_portal_terms));
select public.bs_check('nothing published: no client is held back', not pg_temp.req());
insert into f160 select 'v1', id::text from public.client_portal_terms where version = 1;

-- ── Who may manage it ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.client_portal_terms_publish('%s')$$, pg_temp.fx('v1')), 'Admins only');
select public.bs_expect_error($$select public.client_portal_terms_save_draft('{"title":"x","body":"y"}')$$, 'Admins only');
select public.bs_expect_error($$select public.client_portal_terms_list()$$, 'Admins only');
select public.bs_as(null);
select public.bs_check('the state and accept functions are granted to the service role alone', not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.proname in ('client_portal_terms_state', 'client_portal_terms_accept') and x.grantee <> p.proowner and x.grantee <> 'service_role'::regrole) and (select bool_and(p.proacl is not null) from pg_proc p where p.proname in ('client_portal_terms_state', 'client_portal_terms_accept')));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error($$select * from public.client_portal_terms$$, 'permission denied');
select public.bs_expect_error($$select * from public.client_portal_terms_acceptances$$, 'permission denied');
select public.bs_check('a manager reads who agreed', jsonb_typeof(public.client_portal_terms_acceptances_for(pg_temp.fx('acc')::uuid)) = 'array');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select public.client_portal_terms_acceptances_for('%s')$$, pg_temp.fx('acc')), 'permission');

-- ── Draft and publish ──
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error($$select public.client_portal_terms_save_draft('{"title":"Second","body":"Text"}')$$, 'draft already exists');
select public.bs_expect_error(format($$select public.client_portal_terms_save_draft('{"id":"%s","title":"T","body":"  "}')$$, pg_temp.fx('v1')), 'text of the terms');
select public.client_portal_terms_save_draft(jsonb_build_object('id', pg_temp.fx('v1'), 'title', 'Terms one', 'body', 'Body one'));
select public.bs_check('a draft can be edited', (select e ->> 'title' = 'Terms one' from jsonb_array_elements(public.client_portal_terms_list()) e where e ->> 'id' = pg_temp.fx('v1')));
select public.client_portal_terms_publish(pg_temp.fx('v1')::uuid);
select public.bs_as(null);
select public.bs_check('publishing is in the admin log', exists (select 1 from public.admin_audit where action = 'client_portal_terms_publish' and target = 'version 1'));
select public.bs_check('required once published', pg_temp.req() and public.client_portal_terms_state(pg_temp.fx('acc')::uuid) ->> 'body' = 'Body one');

-- ── Published text cannot change ──
select public.bs_expect_error(format($$update public.client_portal_terms set body = 'changed' where id = '%s'$$, pg_temp.fx('v1')), 'cannot be changed');
select public.bs_expect_error(format($$delete from public.client_portal_terms where id = '%s'$$, pg_temp.fx('v1')), 'cannot be deleted');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select public.client_portal_terms_save_draft('{"id":"%s","title":"T","body":"changed"}')$$, pg_temp.fx('v1')), 'Only a draft');
select public.bs_expect_error(format($$select public.client_portal_terms_publish('%s')$$, pg_temp.fx('v1')), 'Only a draft');
select public.bs_as(null);

-- ── Agreeing ──
select public.bs_expect_error(format($$select public.client_portal_terms_accept('%s', '%s')$$, pg_temp.fx('revoked'), pg_temp.fx('v1')), 'sign in again');
select public.client_portal_terms_accept(pg_temp.fx('acc')::uuid, pg_temp.fx('v1')::uuid);
select public.bs_check('agreeing clears it', not pg_temp.req());
select public.client_portal_terms_accept(pg_temp.fx('acc')::uuid, pg_temp.fx('v1')::uuid);
select public.bs_check('agreeing twice leaves one record, naming the login and client', (select count(*) = 1 and bool_and(username = 'portal.t160') and bool_and(client_master_id = 'CL990160') and bool_and(version = 1) from public.client_portal_terms_acceptances where account_id = pg_temp.fx('acc')::uuid));
select public.bs_expect_error(format($$update public.client_portal_terms_acceptances set version = 9 where account_id = '%s'$$, pg_temp.fx('acc')), 'cannot be changed');
select public.bs_expect_error(format($$delete from public.client_portal_terms_acceptances where account_id = '%s'$$, pg_temp.fx('acc')), 'cannot be changed');
select public.bs_check('another login still has to agree', (public.client_portal_terms_state(pg_temp.fx('revoked')::uuid) ->> 'required')::boolean);

-- ── A new version ──
select public.bs_as('00000000-0000-0000-0000-00000000000a');
insert into f160 values ('v2', public.client_portal_terms_save_draft('{"title":"Terms two","body":"Body two"}')::text);
select public.bs_as(null);
select public.bs_expect_error(format($$select public.client_portal_terms_accept('%s', '%s')$$, pg_temp.fx('acc'), pg_temp.fx('v2')), 'replaced');
select public.bs_check('a draft changes nothing for the client', not pg_temp.req());
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.client_portal_terms_publish(pg_temp.fx('v2')::uuid);
select public.bs_as(null);
select public.bs_check('a new version: the old one is retired, one published, agreement needed again',
  (select status = 'Retired' from public.client_portal_terms where id = pg_temp.fx('v1')::uuid) and (select count(*) = 1 from public.client_portal_terms where status = 'Published') and pg_temp.req());
select public.bs_expect_error(format($$select public.client_portal_terms_accept('%s', '%s')$$, pg_temp.fx('acc'), pg_temp.fx('v1')), 'replaced');
select public.client_portal_terms_accept(pg_temp.fx('acc')::uuid, pg_temp.fx('v2')::uuid);
select public.bs_check('the old agreement stays on record', (select count(*) = 2 from public.client_portal_terms_acceptances where account_id = pg_temp.fx('acc')::uuid));

-- ── Re-running the migration ──
\ir '../../Client Login Base/migrations/005_terms.sql'
select public.bs_check('a re-run adds no second seed and keeps the published text', (select count(*) = 2 from public.client_portal_terms) and (select body = 'Body two' from public.client_portal_terms where id = pg_temp.fx('v2')::uuid));

-- Later tests must not meet a published version.
set session_replication_role = replica;
delete from public.client_portal_terms_acceptances where account_id = pg_temp.fx('acc')::uuid;
delete from public.client_portal_terms where id in (pg_temp.fx('v2')::uuid);
update public.client_portal_terms set status = 'Draft', title = 'Terms and Conditions (DRAFT, not yet legally reviewed)', published_at = null, published_by = null where id = pg_temp.fx('v1')::uuid;
set session_replication_role = origin;

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
