-- LOCAL TEST ONLY: the open referral link (019). Run through tests/run-local.sh, last.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier tests re-run older migrations and grant every function to staff: put the real final state back, in order.
alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/016_client_flow.sql
\ir ../migrations/017_kyc_finished.sql
\ir ../migrations/018_portal.sql
\ir ../migrations/019_intake.sql
create temp table f200 (k text primary key, v text);
grant all on f200 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f200 where k = p_k $$;
create function pg_temp.a(p_name text, p_email text default 'x@y.ae') returns jsonb language sql as $$ select jsonb_build_object('client_name', p_name, 'phone', '050', 'email', p_email, 'company_status', 'New') $$;

-- ── Generating links: any member of staff ──
select public.bs_as('00000000-0000-0000-0000-000000000099');
insert into f200 select 'link', public.business_setup_intake_link_new() ->> 'id';
select public.bs_check('link_any_staff: someone with no Business Setup rights generates a link, and sees its token', (select (e ->> 'mine')::boolean and length(e ->> 'token') = 64 from jsonb_array_elements(public.business_setup_intake_link_list()) e where e ->> 'id' = pg_temp.fx('link')));
select public.bs_as(null);
insert into f200 select 'token', token from public.business_setup_intake_links where id = pg_temp.fx('link')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('link_scope: another member of staff does not see it', not exists (select 1 from jsonb_array_elements(public.business_setup_intake_link_list()) e where e ->> 'id' = pg_temp.fx('link')));
select public.bs_expect_error(format($$select public.business_setup_intake_link_revoke('%s')$$, pg_temp.fx('link')), 'Only the person');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('link_scope: a manager sees it, without the token', (select e ->> 'token' is null from jsonb_array_elements(public.business_setup_intake_link_list()) e where e ->> 'id' = pg_temp.fx('link')));
-- ── Nothing public can reach ──
select public.bs_as(null);
select public.bs_check('anon: no link function, and only the service role reaches the public functions',
  not has_function_privilege('anon', 'public.business_setup_intake_link_new()', 'execute') and not has_function_privilege('anon', 'public.business_setup_intake_submit(text, uuid, jsonb, text, uuid)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.proname in ('business_setup_intake_open', 'business_setup_intake_upload_ok', 'business_setup_intake_submit', 'business_setup_intake_cleanup') and x.grantee <> p.proowner and x.grantee <> 'service_role'::regrole)
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.proname = 'business_setup_intake_apply' and x.grantee <> p.proowner));
select public.bs_check('anon: the tables are closed', not has_table_privilege('anon', 'public.business_setup_intake_links', 'select') and not has_table_privilege('authenticated', 'public.business_setup_intake_links', 'select')
  and not has_table_privilege('authenticated', 'public.business_setup_intake_submissions', 'select') and not has_table_privilege('authenticated', 'public.business_setup_intake_files', 'select'));

-- ── Submitting ──
select public.bs_check('open: a good token gets the form', (public.business_setup_intake_open(pg_temp.fx('token')) -> 'definition') is not null);
select public.bs_expect_error($$select public.business_setup_intake_open('wrong')$$, 'no longer active');
insert into f200 values ('s1', gen_random_uuid()::text), ('s2', gen_random_uuid()::text);
insert into f200 select 'path1', public.business_setup_intake_upload_ok(pg_temp.fx('token'), pg_temp.fx('s1')::uuid, 'Passport', 'my pass/port.pdf', 1000);
select public.bs_check('upload: the path is the server''s, with no folder from the file name', pg_temp.fx('path1') ~ ('^intake/' || pg_temp.fx('s1') || '/[0-9a-f-]{36}-my_pass_port\.pdf$'));
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', '%s', 'Passport', 'a.exe', 10)$$, pg_temp.fx('token'), pg_temp.fx('s1')), 'Only PDF');
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', '%s', 'Passport', 'a.pdf', 11000000)$$, pg_temp.fx('token'), pg_temp.fx('s1')), '10 MB');
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', '%s', 'Secret', 'a.pdf', 10)$$, pg_temp.fx('token'), pg_temp.fx('s1')), 'document type');
select public.bs_expect_error(format($$select public.business_setup_intake_submit('%s', '%s', '{"client_name":"A"}', 'ip0')$$, pg_temp.fx('token'), pg_temp.fx('s1')), 'name, email and phone');
insert into f200 select 'c1', public.business_setup_intake_submit(pg_temp.fx('token'), pg_temp.fx('s1')::uuid, pg_temp.a('Referred Co LLC'), 'ip1')::text;
select public.bs_check('submit: a case at Review, tagged with who generated the link, with no owner and no client',
  (select stage = 'Review' and referred_by = '00000000-0000-0000-0000-000000000099' and owner_id is null and client_id is null and source = 'Open link' and lead_name = 'Referred Co LLC' from public.business_setup_cases where id = pg_temp.fx('c1')::uuid));
select public.bs_check('submit: the same submission makes one case', public.business_setup_intake_submit(pg_temp.fx('token'), pg_temp.fx('s1')::uuid, pg_temp.a('Referred Co LLC'), 'ip1')::text = pg_temp.fx('c1'));
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', '%s', 'Passport', 'b.pdf', 10)$$, pg_temp.fx('token'), pg_temp.fx('s1')), 'already been sent');
insert into f200 select 'c2', public.business_setup_intake_submit(pg_temp.fx('token'), pg_temp.fx('s2')::uuid, pg_temp.a('Second Co LLC'), 'ip2')::text;
select public.bs_check('link_multi: one link takes many forms, each its own case', pg_temp.fx('c1') <> pg_temp.fx('c2'));
select public.bs_check('history: the audit log names the referrer', public.bs_audit_count('case_referred', pg_temp.fx('c1'), '{"referred_by":"00000000-0000-0000-0000-000000000099"}') = 1);

-- ── Limits ──
do $$
declare i int;
begin
  for i in 1..5 loop perform public.business_setup_intake_submit(pg_temp.fx('token'), gen_random_uuid(), pg_temp.a('Rate ' || i), 'ipR'); end loop;
end $$;
select public.bs_expect_error(format($$select public.business_setup_intake_submit('%s', gen_random_uuid(), '{"client_name":"A","phone":"1","email":"a@b.ae"}', 'ipR')$$, pg_temp.fx('token')), 'from here');
do $$
declare i int;
begin
  for i in 1..23 loop perform public.business_setup_intake_submit(pg_temp.fx('token'), gen_random_uuid(), pg_temp.a('Day ' || i), 'ipD' || i); end loop;
end $$;
select public.bs_expect_error(format($$select public.business_setup_intake_submit('%s', gen_random_uuid(), '{"client_name":"A","phone":"1","email":"a@b.ae"}', 'ipZ')$$, pg_temp.fx('token')), 'too many forms today');
insert into f200 values ('s3', gen_random_uuid()::text);
do $$
declare i int;
begin
  for i in 1..15 loop perform public.business_setup_intake_upload_ok(pg_temp.fx('token'), pg_temp.fx('s3')::uuid, 'Other', 'f' || i || '.pdf', 10); end loop;
end $$;
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', '%s', 'Other', 'g.pdf', 10)$$, pg_temp.fx('token'), pg_temp.fx('s3')), 'up to 15');

-- ── Client Inputs and moving the case ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('inputs: the case waits at Client Inputs, with its referrer', (select e ->> 'referred_by_name' = 'Outsider' and (e ->> 'intake_pending')::boolean from jsonb_array_elements(public.business_setup_case_list('inputs')) e where e ->> 'id' = pg_temp.fx('c1')));
select public.bs_check('detail: staff read the answers and the file names', (select d -> 'answers' ->> 'client_name' = 'Referred Co LLC' and d -> 'files' -> 0 ->> 'kind' = 'Passport' from public.business_setup_intake_detail(pg_temp.fx('c1')::uuid) d));
select public.business_setup_case_take(pg_temp.fx('c1')::uuid);
select public.bs_as(null);
insert into storage.objects (bucket_id, name) values ('client-portal', pg_temp.fx('path1'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f200 select 'client', public.business_setup_case_move_to_onboarding(pg_temp.fx('c1')::uuid, null, true);
select public.bs_as(null);
select public.bs_check('move: a form at Submitted with the answers and no login', (select status = 'Submitted' and account_id is null and answers ->> 'client_name' = 'Referred Co LLC' and case_id = pg_temp.fx('c1')::uuid from public.business_setup_onboarding_forms where client_id = pg_temp.fx('client')));
select public.bs_check('move: the stored file becomes the form''s document', (select count(*) = 1 and bool_and(d.doc_type = 'Passport') and bool_and(d.account_id is null) from public.client_portal_documents d where d.storage_path = pg_temp.fx('path1')));
select public.bs_check('move: tag stays, stage is Onboarding, no longer at Client Inputs', (select stage = 'Onboarding' and referred_by = '00000000-0000-0000-0000-000000000099' from public.business_setup_cases where id = pg_temp.fx('c1')::uuid)
  and (select applied_at is not null from public.business_setup_intake_submissions where id = pg_temp.fx('s1')::uuid));
insert into f200 select 'doc1', d.id::text from public.client_portal_documents d where d.storage_path = pg_temp.fx('path1');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('review: staff open a document whose client has no login', public.client_inputs_file(pg_temp.fx('doc1')::uuid) ->> 'client' = 'Referred Co LLC');
select public.bs_as(null);
select public.bs_expect_error(format($$update public.business_setup_onboarding_forms set status = 'Returned' where client_id = '%s'$$, pg_temp.fx('client')), 'no login yet');

-- ── The login joins the form and files ──
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values (pg_temp.fx('client'), 'R', 'portal.r200', 'x', 'active');
select public.bs_check('login: the form and file join the new login', (select f.account_id is not null from public.business_setup_onboarding_forms f where f.client_id = pg_temp.fx('client'))
  and (select d.account_id is not null from public.client_portal_documents d where d.storage_path = pg_temp.fx('path1')));

-- ── An existing client who already has a login ──
insert into public.client_master (client_id, legal_name, data) values ('CL990200', 'Existing LLC', '{"General Email":"e@x.ae"}') on conflict do nothing;
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL990200', 'E', 'portal.e200', 'hash-kept', 'active');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_case_take(pg_temp.fx('c2')::uuid);
select public.business_setup_case_move_to_onboarding(pg_temp.fx('c2')::uuid, 'CL990200');
select public.bs_as(null);
select public.bs_check('existing_client: linked, one login, password unchanged, form on that login', (select count(*) = 1 and bool_and(password_hash = 'hash-kept') from public.client_portal_accounts where client_master_id = 'CL990200')
  and (select f.account_id = (select id from public.client_portal_accounts where username = 'portal.e200') from public.business_setup_onboarding_forms f where f.client_id = 'CL990200'));

-- ── Referred by, and changing it ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('referrers: All Clients can list who referred a client', public.business_setup_referrers() -> 'CL990200' ->> 0 = 'Outsider');
select public.bs_expect_error(format($$select public.business_setup_case_set_referrer('%s', '00000000-0000-0000-0000-00000000000c', 'mine')$$, pg_temp.fx('c2')), 'Admins only');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error(format($$select public.business_setup_case_set_referrer('%s', '00000000-0000-0000-0000-00000000000c', ' ')$$, pg_temp.fx('c2')), 'reason');
select public.business_setup_case_set_referrer(pg_temp.fx('c2')::uuid, '00000000-0000-0000-0000-00000000000c', 'Handled by Sales');
select public.bs_as(null);
select public.bs_check('referrer: an admin changes it, and the log keeps the old one', (select referred_by = '00000000-0000-0000-0000-00000000000c' from public.business_setup_cases where id = pg_temp.fx('c2')::uuid)
  and public.bs_audit_count('case_referrer_change', pg_temp.fx('c2'), '{"reason":"Handled by Sales"}') = 1);

-- ── Spam, revoke, clean-up ──
insert into f200 values ('s4', gen_random_uuid()::text);
insert into f200 select 'path4', public.business_setup_intake_upload_ok(pg_temp.fx('token'), pg_temp.fx('s4')::uuid, 'Other', 'spam.pdf', 10);
update public.business_setup_intake_submissions set created_at = now() - interval '2 days';
insert into f200 select 'c4', public.business_setup_intake_submit(pg_temp.fx('token'), pg_temp.fx('s4')::uuid, pg_temp.a('Spam Co'), 'ipS')::text;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_case_spam('%s', 'x')$$, pg_temp.fx('c4')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('spam: hands back the files to delete', public.business_setup_case_spam(pg_temp.fx('c4')::uuid, 'junk') ->> 0 = pg_temp.fx('path4'));
select public.bs_check('spam: the lead is Lost', (select stage = 'Lost' from public.business_setup_cases where id = pg_temp.fx('c4')::uuid));
select public.bs_expect_error(format($$select public.business_setup_case_spam('%s', 'x')$$, pg_temp.fx('c1')), 'moved to Client Onboarding');
select public.business_setup_intake_link_revoke(pg_temp.fx('link')::uuid);
select public.bs_as(null);
select public.bs_expect_error(format($$select public.business_setup_intake_open('%s')$$, pg_temp.fx('token')), 'no longer active');
select public.bs_expect_error(format($$select public.business_setup_intake_upload_ok('%s', gen_random_uuid(), 'Other', 'a.pdf', 10)$$, pg_temp.fx('token')), 'no longer active');
select public.bs_expect_error(format($$select public.business_setup_intake_submit('%s', gen_random_uuid(), '{"client_name":"A","phone":"1","email":"a@b.ae"}', 'ipY')$$, pg_temp.fx('token')), 'no longer active');
update public.business_setup_intake_files set created_at = now() - interval '8 days' where submission_id = pg_temp.fx('s3')::uuid;
select public.bs_check('cleanup: only old files with no submission go', jsonb_array_length(public.business_setup_intake_cleanup()) = 15 and exists (select 1 from public.business_setup_intake_files where submission_id = pg_temp.fx('s1')::uuid));

-- ── Terms on the open form ──
insert into f200 select 't1', id::text from public.client_portal_terms where version = 1;
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.client_portal_terms_publish(pg_temp.fx('t1')::uuid);
insert into f200 select 'link2', public.business_setup_intake_link_new() ->> 'id';
select public.bs_as(null);
insert into f200 select 'token2', token from public.business_setup_intake_links where id = pg_temp.fx('link2')::uuid;
select public.bs_check('terms: the form carries the published terms', public.business_setup_intake_open(pg_temp.fx('token2')) -> 'terms' ->> 'version' = '1');
select public.bs_expect_error(format($$select public.business_setup_intake_submit('%s', gen_random_uuid(), '{"client_name":"A","phone":"1","email":"a@b.ae"}', 'ipT')$$, pg_temp.fx('token2')), 'Terms and Conditions');
insert into f200 values ('s5', gen_random_uuid()::text);
select public.business_setup_intake_submit(pg_temp.fx('token2'), pg_temp.fx('s5')::uuid, pg_temp.a('Terms Co'), 'ipT', (select id from public.client_portal_terms where version = 1));
select public.bs_check('terms: the submission records the version agreed', (select terms_version = 1 from public.business_setup_intake_submissions where id = pg_temp.fx('s5')::uuid));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
