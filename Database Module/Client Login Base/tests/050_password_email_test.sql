-- LOCAL TEST ONLY: admin-managed client logins: the email, the encrypted password copy, who can read it, and that clients cannot change it.
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
insert into public.client_master (client_id, legal_name, data) values
  ('CL000801', 'Master Linked LLC', jsonb_build_object('Client Legal Name', 'Master Linked LLC', 'General Email', 'master@linked.test'));
insert into public.banking_clients (id, display_name, client_master_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'Kyc Email LLC', null),
  ('b0000000-0000-0000-0000-00000000000b', 'Lead Email LLC', null),
  ('c0000000-0000-0000-0000-00000000000c', 'No Email LLC', null),
  ('f0000000-0000-0000-0000-00000000000f', 'Master Linked LLC', 'CL000801');
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
select set_config('t.a', (select id::text from public.client_portal_accounts where username = 'alpha.user'), false) as _ \gset
select public.ok('grant: login saved with the trimmed email',
  exists (select 1 from public.client_portal_accounts where username = 'alpha.user' and email = 'Client@Alpha.test'));
select public.ok('grant: returns what the email needs and who acted, never the password',
  (select r ->> 'email' = 'Client@Alpha.test' and r ->> 'username' = 'alpha.user' and r ->> 'display_name' = 'Kyc Email LLC' and r ->> 'actor' = '00000000-0000-0000-0000-00000000000a' and r::text !~ 'firstpassword'
     from public.client_portal_admin_grant('a0000000-0000-0000-0000-00000000000a', null, 'alpha.user', 'firstpassword2', 'Client@Alpha.test') r));
select public.ok('grant: the saved login email is suggested next time',
  public.client_portal_admin_access_email('a0000000-0000-0000-0000-00000000000a', null) = 'Client@Alpha.test');
select public.ok('grant: the password signs in', (public.client_portal_login('alpha.user', 'firstpassword2') ->> 'ok')::boolean);
select public.ok('grant: the old password stops working', not (public.client_portal_login('alpha.user', 'firstpassword1') ->> 'ok')::boolean);

-- ── an admin reading it ──
select public.ok('show: an admin reads the current password, not the old one',
  public.client_portal_admin_password(current_setting('t.a')::uuid) = 'firstpassword2');
select public.ok('show: the read is logged with the admin and the login',
  exists (select 1 from public.admin_audit where action = 'client_portal_password_viewed' and target = 'alpha.user' and actor = '00000000-0000-0000-0000-00000000000a'));
select public.ok('show: one secret per login after two saves', (select count(*) = 1 from vault.secrets where name = 'client_portal_pw:' || current_setting('t.a')));
select public.ok('show: the password is in no public table or log',
  not exists (select 1 from public.admin_audit where detail::text ~ 'firstpassword' or target ~ 'firstpassword')
  and not exists (select 1 from public.audit_trail where new_values::text ~ 'firstpassword' or old_values::text ~ 'firstpassword')
  and not exists (select 1 from public.client_portal_accounts where row_to_json(client_portal_accounts)::text ~ 'firstpassword'));
select public.must_fail('show: an unknown login is refused', $$select public.client_portal_admin_password('00000000-0000-0000-0000-000000000000')$$, 'Login not found');
select public.who('00000000-0000-0000-0000-000000000099');
select public.must_fail('show: a member is refused', format('select public.client_portal_admin_password(%L)', current_setting('t.a')), 'Admins only');
select public.must_fail('panel: a member is refused', $$select public.client_portal_admin_login('a0000000-0000-0000-0000-00000000000a', null)$$, 'Admins only');
select public.who('00000000-0000-0000-0000-00000000000a');

-- ── the panel in a client's record ──
select public.ok('panel: a login shows email, username, status and that a password is readable',
  (select r ->> 'email' = 'Client@Alpha.test' and r ->> 'username' = 'alpha.user' and r ->> 'status' = 'active' and (r ->> 'has_password')::boolean and r ->> 'password' is null and r::text !~ 'firstpassword'
     from public.client_portal_admin_login('a0000000-0000-0000-0000-00000000000a', null) r));
select public.ok('panel: no login yet shows the suggested email and no account',
  (select r ->> 'account_id' is null and r ->> 'email' = 'lead@beta.test' and not (r ->> 'has_password')::boolean and r ->> 'display_name' = 'Lead Email LLC'
     from public.client_portal_admin_login('b0000000-0000-0000-0000-00000000000b', null) r));
select public.client_portal_admin_grant('f0000000-0000-0000-0000-00000000000f', null, 'linked.user', 'linkedpassword1', 'x@linked.test');
select public.ok('panel: found from the Client Master id when the login hangs off the banking client',
  (public.client_portal_admin_login(null, 'CL000801') ->> 'username') = 'linked.user');
select public.client_portal_admin_grant('c0000000-0000-0000-0000-00000000000c', null, 'noemail.user', 'noemailpassword', 'y@none.test');
update public.client_portal_accounts set email = null where username = 'noemail.user';
select public.ok('panel: an older login with no vault copy says so',
  (select not (public.client_portal_admin_login('b0000000-0000-0000-0000-00000000000b', null) ->> 'has_password')::boolean));

-- ── who may call ──
select public.ok('rights: grant is not open to anon', not has_function_privilege('anon', 'public.client_portal_admin_grant(uuid, text, text, text, text)', 'execute'));
select public.ok('rights: show is not open to anon', not has_function_privilege('anon', 'public.client_portal_admin_password(uuid)', 'execute'));
select public.ok('rights: panel is not open to anon', not has_function_privilege('anon', 'public.client_portal_admin_login(uuid, text)', 'execute'));
select public.ok('rights: the Vault secrets are not open to staff', not has_table_privilege('authenticated', 'vault.secrets', 'select') and not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'select'));
select public.ok('rights: the old save cannot be called from a browser, so Vault cannot go stale', not has_function_privilege('authenticated', 'public.client_portal_admin_save(uuid, text, text, text)', 'execute'));
select public.ok('rights: staff can reach grant, show and panel',
  has_function_privilege('authenticated', 'public.client_portal_admin_grant(uuid, text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.client_portal_admin_password(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.client_portal_admin_login(uuid, text)', 'execute'));

-- ── clients cannot change it ──
select public.ok('client: the change function is gone', to_regprocedure('public.client_portal_change_password(text, text, text)') is null);
select public.ok('client: the must-change column is gone',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_portal_accounts' and column_name = 'must_change_password'));

-- ── a deleted login leaves nothing readable ──
delete from public.client_portal_accounts where username = 'linked.user';
select public.ok('delete: its Vault copy goes too', not exists (select 1 from vault.secrets s where s.name not in (select 'client_portal_pw:' || id from public.client_portal_accounts) and s.name like 'client_portal_pw:%'));

-- ── undoing 004, then 003 ──
\ir ../rollback/004_rollback.sql
select public.ok('rollback 004: readable passwords are gone', not exists (select 1 from vault.secrets where name like 'client_portal_pw:%'));
select public.ok('rollback 004: the functions are gone',
  to_regprocedure('public.client_portal_admin_password(uuid)') is null and to_regprocedure('public.client_portal_admin_login(uuid, text)') is null);
select public.ok('rollback 004: clients can still sign in', (public.client_portal_login('alpha.user', 'firstpassword2') ->> 'ok')::boolean);
\ir ../migrations/003_password_email.sql
select public.ok('rollback 004: re-running 003 restores must-change',
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_portal_accounts' and column_name = 'must_change_password')
  and to_regprocedure('public.client_portal_change_password(text, text, text)') is not null);
\ir ../rollback/003_rollback.sql
select public.ok('rollback 003: both columns gone',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'client_portal_accounts' and column_name in ('email', 'must_change_password')));
select public.ok('rollback 003: both functions gone', to_regprocedure('public.client_portal_admin_grant(uuid, text, text, text, text)') is null and to_regprocedure('public.client_portal_admin_access_email(uuid, text)') is null);
select public.ok('rollback 003: change password stays server only', not has_function_privilege('authenticated', 'public.client_portal_change_password(text, text, text)', 'execute'));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
