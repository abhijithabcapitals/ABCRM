-- LOCAL TEST ONLY: the email saved with a client login, and the password a client must replace at first sign-in.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

create table public.t_result (n serial, name text, ok boolean, detail text);
create function public.ok(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into public.t_result (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;
create function public.must_fail(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.ok(p_name, false, 'no error raised');
  exception when others then
    perform public.ok(p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
  end;
end $$;
create function public.who(p_uid text) returns void language sql as $$ select set_config('request.jwt.claim.sub', p_uid, false) $$;
grant all on public.t_result to authenticated, anon, service_role;
grant usage on sequence public.t_result_n_seq to authenticated, anon, service_role;
grant execute on function public.ok(text, boolean, text), public.must_fail(text, text, text), public.who(text) to authenticated, anon, service_role;

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-000000000099', 'Staff Person', 'member');
insert into public.banking_clients (id, display_name) values
  ('a0000000-0000-0000-0000-00000000000a', 'Kyc Email LLC'),
  ('b0000000-0000-0000-0000-00000000000b', 'Lead Email LLC'),
  ('c0000000-0000-0000-0000-00000000000c', 'No Email LLC');
insert into public.banking_kyc_profiles (client_id, legal_name, company_email) values
  ('a0000000-0000-0000-0000-00000000000a', 'Kyc Email LLC', 'kyc@alpha.test'),
  ('b0000000-0000-0000-0000-00000000000b', 'Lead Email LLC', '  ');
insert into public.banking_leads (id, company_name, email, client_id)
  values ('d0000000-0000-0000-0000-00000000000b', 'Lead Email LLC', 'lead@beta.test', 'b0000000-0000-0000-0000-00000000000b');
insert into public.banking_cases (id, case_ref, client_id, lead_id, current_stage, account_kind)
  values ('e0000000-0000-0000-0000-00000000000b', 'T-LEAD', 'b0000000-0000-0000-0000-00000000000b', 'd0000000-0000-0000-0000-00000000000b', 3, 'Business');

-- ── the email to suggest ──
select public.who('00000000-0000-0000-0000-00000000000a');
select public.ok('suggest: KYC email', public.client_portal_admin_access_email('a0000000-0000-0000-0000-00000000000a', null) = 'kyc@alpha.test');
select public.ok('suggest: a blank KYC email falls back to the lead', public.client_portal_admin_access_email('b0000000-0000-0000-0000-00000000000b', null) = 'lead@beta.test');
select public.ok('suggest: nothing on file', public.client_portal_admin_access_email('c0000000-0000-0000-0000-00000000000c', null) is null);

-- ── giving access ──
select public.who('00000000-0000-0000-0000-000000000099');
select public.must_fail('grant: a member is refused',
  $$select public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword1', 'a@alpha.test')$$, 'Admins only');
select public.must_fail('suggest: a member is refused',
  $$select public.client_portal_admin_access_email('a0000000-0000-0000-0000-00000000000a', null)$$, 'Admins only');
select public.who('00000000-0000-0000-0000-00000000000a');
select public.must_fail('grant: an email is required',
  $$select public.client_portal_admin_grant('c0000000-0000-0000-0000-00000000000c', null, 'gamma.user', 'firstpassword1', '  ')$$, 'valid email');
select public.must_fail('grant: a bad email is refused',
  $$select public.client_portal_admin_grant('c0000000-0000-0000-0000-00000000000c', null, 'gamma.user', 'firstpassword1', 'not an email')$$, 'valid email');
select public.must_fail('grant: an email cannot carry a header',
  $$select public.client_portal_admin_grant('c0000000-0000-0000-0000-00000000000c', null, 'gamma.user', 'firstpassword1', E'a@b.test\r\nBcc: x@y.test')$$, 'valid email');
select public.ok('grant: a refused email creates no login', not exists (select 1 from public.client_portal_accounts where username = 'gamma.user'));

select public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword1', ' Client@Alpha.test ');
select public.ok('grant: login saved with the trimmed email, and must change the password',
  exists (select 1 from public.client_portal_accounts where username = 'alpha.user' and email = 'Client@Alpha.test' and must_change_password));
select public.ok('grant: returns the details the email needs, never the password',
  (select r ->> 'email' = 'Client@Alpha.test' and r ->> 'username' = 'alpha.user' and r ->> 'display_name' = 'Kyc Email LLC' and r::text !~ 'firstpassword1'
     from public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword2', 'Client@Alpha.test') r));
select public.ok('grant: the saved login email is suggested next time',
  public.client_portal_admin_access_email('a0000000-0000-0000-0000-00000000000a', null) = 'Client@Alpha.test');
select public.ok('grant: the password is not stored anywhere in the audit logs',
  not exists (select 1 from public.admin_audit where detail::text ~ 'firstpassword' or target ~ 'firstpassword')
  and not exists (select 1 from public.audit_trail where new_values::text ~ 'firstpassword' or old_values::text ~ 'firstpassword'));

-- ── first sign-in ──
select public.ok('first sign-in: the emailed password signs in', (public.client_portal_login('alpha.user', 'firstpassword2') ->> 'ok')::boolean);
select set_config('t.token', public.client_portal_login('alpha.user', 'firstpassword2') ->> 'token', false) as _ \gset
select public.ok('change: the same password is not accepted',
  public.client_portal_change_password(current_setting('t.token'), 'firstpassword2', 'firstpassword2') = false);
select public.ok('change: still must change after the refusal',
  (select must_change_password from public.client_portal_accounts where username = 'alpha.user'));
select public.ok('change: a wrong current password is not accepted',
  public.client_portal_change_password(current_setting('t.token'), 'wrongpassword', 'ownpassword123') = false);
select public.ok('change: own password accepted', public.client_portal_change_password(current_setting('t.token'), 'firstpassword2', 'ownpassword123'));
select public.ok('change: no longer must change',
  not (select must_change_password from public.client_portal_accounts where username = 'alpha.user'));
select public.ok('change: the emailed password stops working', not (public.client_portal_login('alpha.user', 'firstpassword2') ->> 'ok')::boolean);
select public.ok('change: the new password works', (public.client_portal_login('alpha.user', 'ownpassword123') ->> 'ok')::boolean);
select public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword3', 'Client@Alpha.test');
select public.ok('new password: must change again',
  (select must_change_password from public.client_portal_accounts where username = 'alpha.user'));

-- ── who may call ──
select public.ok('rights: grant is not open to anon', not has_function_privilege('anon', 'public.client_portal_admin_grant(uuid, text, text, text, text)', 'execute'));
select public.ok('rights: suggest is not open to anon', not has_function_privilege('anon', 'public.client_portal_admin_access_email(uuid, text)', 'execute'));
select public.ok('rights: change password stays server only', not has_function_privilege('authenticated', 'public.client_portal_change_password(text, text, text)', 'execute'));
select public.ok('rights: staff can reach grant', has_function_privilege('authenticated', 'public.client_portal_admin_grant(uuid, text, text, text, text)', 'execute'));

-- ── undoing 003 ──
select public.ok('grant: records the admin who gave access',
  (public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword4', 'Client@Alpha.test') ->> 'actor') = '00000000-0000-0000-0000-00000000000a');
\ir ../rollback/003_rollback.sql
select public.ok('rollback: both columns gone',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_portal_accounts' and column_name in ('email', 'must_change_password')));
select public.ok('rollback: both functions gone', to_regprocedure('public.client_portal_admin_grant(uuid, text, text, text, text)') is null and to_regprocedure('public.client_portal_admin_access_email(uuid, text)') is null);
select set_config('t.token2', public.client_portal_login('alpha.user', 'firstpassword4') ->> 'token', false) as _ \gset
select public.ok('rollback: change password works as before', public.client_portal_change_password(current_setting('t.token2'), 'firstpassword4', 'ownpassword456'));
select public.ok('rollback: change password stays server only', not has_function_privilege('authenticated', 'public.client_portal_change_password(text, text, text)', 'execute'));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
