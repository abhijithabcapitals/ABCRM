-- LOCAL TEST ONLY: runs the module's business rules as signed-in users on a throwaway cluster.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Setup Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000b1', 'Setup Manager', 'member'),
  ('00000000-0000-0000-0000-0000000000c1', 'Read-only User', 'member'),
  ('00000000-0000-0000-0000-0000000000d1', 'No Role', 'member'),
  ('00000000-0000-0000-0000-0000000000e1', 'Banking Admin', 'member');
insert into public.banking_user_roles (user_id, role) values ('00000000-0000-0000-0000-0000000000e1', 'ADMIN');
insert into public.business_setup_staff (user_id, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'MANAGER'),
  ('00000000-0000-0000-0000-0000000000c1', 'READ_ONLY');

create table public.bs_result (n serial, label text, ok boolean, detail text);
grant all on public.bs_result to authenticated;
grant usage on sequence public.bs_result_n_seq to authenticated;

-- Record one check and print it. Every other helper below goes through this one.
create function public.bs_check(p_label text, p_ok boolean, p_detail text default null) returns void language plpgsql as $$
begin
  insert into public.bs_result (label, ok, detail) values (p_label, coalesce(p_ok, false), p_detail);
  if coalesce(p_ok, false) then raise notice 'ok   %', p_label;
  else raise notice 'FAIL % %', p_label, coalesce('(' || p_detail || ')', ''); end if;
end $$;

-- Run p_sql; it must raise an error whose message contains p_fragment (case-insensitive).
create function public.bs_expect_error(p_sql text, p_fragment text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.bs_check(left(p_sql, 80) || ' -> ' || p_fragment, false, 'no error raised');
  exception when others then
    perform public.bs_check(left(p_sql, 80) || ' -> ' || p_fragment, sqlerrm ilike '%' || p_fragment || '%', sqlerrm);
  end;
end $$;

create function public.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', p_id::text, false)
$$;
create function public.t_ok(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  select public.bs_check(p_name, p_ok, p_detail)
$$;
create function public.t_fails(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.t_ok(p_name, false, 'no error raised');
  exception when others then
    perform public.t_ok(p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
  end;
end $$;
-- Runs a statement as the anon role and reports whether it was refused.
create function public.t_anon_refused(p_name text, p_sql text) returns void language plpgsql as $$
begin
  begin
    set local role anon;
    execute p_sql;
    reset role;
    perform public.t_ok(p_name, false, 'anon was allowed');
  exception when insufficient_privilege then
    reset role;
    perform public.t_ok(p_name, true);
  end;
end $$;
create function public.t_rows_changed(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin execute p_sql; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema public to authenticated;

select public.t_anon_refused('anon cannot select settings', 'select * from public.business_setup_settings');
select public.t_anon_refused('anon cannot select audit log', 'select * from public.business_setup_audit_log');

set role authenticated;

-- ── Roles ──
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('read-only user has setup.access', public.business_setup_my_access() -> 'permissions' ? 'setup.access');
select public.t_ok('read-only user has kyc.view', public.business_setup_my_access() -> 'permissions' ? 'kyc.view');
select public.t_ok('read-only user lacks setup.payments.manage', not (public.business_setup_my_access() -> 'permissions' ? 'setup.payments.manage'));
select public.t_ok('read-only user lacks setup.settings.manage', not (public.business_setup_my_access() -> 'permissions' ? 'setup.settings.manage'));
select public.t_ok('read-only user lacks kyc.manage', not (public.business_setup_my_access() -> 'permissions' ? 'kyc.manage'));
select public.t_ok('read-only role is reported', public.business_setup_my_access() ->> 'role' = 'READ_ONLY');

select public.as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_ok('manager has setup.payments.override', public.business_setup_my_access() -> 'permissions' ? 'setup.payments.override');
select public.t_ok('manager has kyc.manage', public.business_setup_my_access() -> 'permissions' ? 'kyc.manage');
select public.t_ok('manager lacks setup.settings.manage', not (public.business_setup_my_access() -> 'permissions' ? 'setup.settings.manage'));
select public.t_ok('require passes for a holder', public.business_setup_require('setup.access')::text = '');

select public.as_user('00000000-0000-0000-0000-0000000000d1');
select public.t_ok('user with no role has no permissions', public.business_setup_my_access() -> 'permissions' = '[]'::jsonb);
select public.t_fails('user with no role cannot save a setting', $q$select public.business_setup_settings_save('reminder_days', '[90,30,7,1]'::jsonb)$q$, 'permission');
select public.t_ok('user with no role sees no settings', (select count(*) = 0 from public.business_setup_settings));

-- ── Settings ──
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_fails('read-only user cannot save a setting', $q$select public.business_setup_settings_save('reminder_days', '[90,30,7,1]'::jsonb)$q$, 'permission');
select public.t_fails('read-only user cannot write settings directly', $q$insert into public.business_setup_settings (key, value) values ('x', '1')$q$, 'permission denied');
select public.t_fails('read-only user cannot add staff', $q$insert into public.business_setup_staff (user_id, role) values ('00000000-0000-0000-0000-0000000000d1', 'READ_ONLY')$q$, 'row-level security');
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.t_ok('admin has every permission', jsonb_array_length(public.business_setup_my_access() -> 'permissions') = cardinality(public.business_setup_permissions()));
select public.business_setup_settings_save('reminder_days', '[90,30,7,1]'::jsonb) is not null;
select public.business_setup_settings_save('reminder_days', '[90,30,7]'::jsonb) is not null;
select public.t_ok('admin saved a setting', (select value = '[90,30,7]'::jsonb from public.business_setup_settings where key = 'reminder_days'));
select public.t_ok('saving stamps who and when', (select created_by is not null and updated_by is not null and archived_at is null from public.business_setup_settings where key = 'reminder_days'));
select public.t_ok('every setting change is in the audit log', (select count(*) = 2 from public.business_setup_audit_log where table_name = 'business_setup_settings' and row_id = 'reminder_days'));
select public.t_ok('audit log keeps old and new value', (select old_data ->> 'value' = '[90, 30, 7, 1]' and new_data ->> 'value' = '[90, 30, 7]' from public.business_setup_audit_log where table_name = 'business_setup_settings' and action = 'UPDATE' limit 1));
select public.as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_ok('manager can read settings', (select count(*) = 1 from public.business_setup_settings));
select public.t_ok('manager can read the audit log', (select count(*) >= 2 from public.business_setup_audit_log));
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('read-only user cannot read the audit log', (select count(*) = 0 from public.business_setup_audit_log));

-- ── Audit log is append-only ──
select public.as_user('00000000-0000-0000-0000-0000000000a1');
select public.t_fails('audit log cannot be updated', $q$update public.business_setup_audit_log set action = 'X'$q$, 'permission denied');
select public.t_fails('audit log cannot be deleted', $q$delete from public.business_setup_audit_log$q$, 'permission denied');
select public.t_fails('audit log cannot be written directly', $q$insert into public.business_setup_audit_log (table_name, action) values ('t', 'INSERT')$q$, 'permission denied');
reset role;
select public.t_fails('audit log cannot be updated even by the owner', $q$update public.business_setup_audit_log set action = 'X'$q$, 'append-only');
select public.t_fails('audit log cannot be deleted even by the owner', $q$delete from public.business_setup_audit_log$q$, 'append-only');
select public.t_fails('audit log cannot be truncated', $q$truncate public.business_setup_audit_log$q$, 'append-only');
set role authenticated;

-- ── Role defaults (spec 5.1) ──
reset role;
select public.t_ok('all seven roles are seeded', (select count(distinct role) = 7 from public.business_setup_role_permissions));
select public.t_ok('only MANAGER and ADMIN may override a payment', (select array_agg(role order by role) from public.business_setup_role_permissions where permission = 'setup.payments.override') = array['ADMIN','MANAGER']);
select public.t_ok('FINANCE records payments', exists(select 1 from public.business_setup_role_permissions where role = 'FINANCE' and permission = 'setup.payments.manage'));
select public.t_ok('only ADMIN, DOCUMENT_EXECUTIVE, MANAGER see partner IDs', (select array_agg(role order by role) from public.business_setup_role_permissions where permission = 'setup.kyc.sensitive') = array['ADMIN','DOCUMENT_EXECUTIVE','MANAGER']);
select public.t_ok('READ_ONLY has only setup.access and kyc.view', (select array_agg(permission order by permission) from public.business_setup_role_permissions where role = 'READ_ONLY') = array['kyc.view','setup.access']);
select public.t_ok('no role holds setup.settings.manage', not exists(select 1 from public.business_setup_role_permissions where permission = 'setup.settings.manage'));
select public.t_ok('every seeded permission is on the list', not exists(select 1 from public.business_setup_role_permissions where permission <> all (public.business_setup_permissions())));
set role authenticated;

-- ── Client Master through Business Setup roles, without Banking rights ──
select public.as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_ok('setup manager: client_master_can kyc.manage', public.client_master_can('kyc.manage'));
select public.t_ok('setup manager: banking_can kyc.manage stays false', not public.banking_can('kyc.manage'));
select public.t_ok('setup manager: banking_can kyc.view stays false', not public.banking_can('kyc.view'));
select public.t_ok('setup manager can create a client', (public.client_master_save(null, '{"Client Legal Name": "Setup Test LLC"}'::jsonb) ->> 'ok')::boolean);
select public.t_ok('setup manager reads the client', (select count(*) = 1 from public.client_master where legal_name = 'Setup Test LLC'));
select public.t_ok('setup manager sees the client history', (select count(*) = 1 from public.client_master_history));
select public.t_ok('setup manager finds the client in lookup', public.client_lookup()::text like '%Setup Test LLC%');
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('read-only user reads client_master', (select count(*) = 1 from public.client_master));
select public.t_fails('read-only user cannot save a client', $q$select public.client_master_save(null, '{"Client Legal Name": "Nope LLC"}'::jsonb)$q$, 'permission');
select public.as_user('00000000-0000-0000-0000-0000000000d1');
select public.t_ok('a user with no role cannot read client_master', (select count(*) = 0 from public.client_master));
select public.t_fails('a user with no role cannot save a client', $q$select public.client_master_save(null, '{"Client Legal Name": "Nope LLC"}'::jsonb)$q$, 'permission');

reset role;
insert into public.banking_clients (id, display_name) values ('10000000-0000-0000-0000-000000000001', 'Banking Only LLC');
insert into public.banking_kyc_profiles (client_id, legal_name) values ('10000000-0000-0000-0000-000000000001', 'Banking Only LLC');
set role authenticated;
select public.as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_ok('setup manager cannot read banking_kyc_profiles', (select count(*) = 0 from public.banking_kyc_profiles));
select public.t_ok('setup manager cannot read banking_clients', (select count(*) = 0 from public.banking_clients));
select public.as_user('00000000-0000-0000-0000-0000000000e1');
select public.t_ok('banking admin can read banking_kyc_profiles', (select count(*) = 1 from public.banking_kyc_profiles));

-- ── Setup rights are separate from Banking rights ──
select public.t_ok('banking admin holds settings.manage in Banking', public.banking_can('settings.manage'));
select public.t_ok('banking admin has no setup rights', public.business_setup_my_access() -> 'permissions' = '[]'::jsonb);
select public.t_fails('banking admin cannot change setup role permissions', $q$insert into public.business_setup_role_permissions (role, permission) values ('READ_ONLY', 'setup.settings.manage')$q$, 'row-level security');
select public.t_fails('banking admin cannot change setup user permissions', $q$insert into public.business_setup_user_permissions (user_id, permission, allowed) values ('00000000-0000-0000-0000-0000000000e1', 'setup.settings.manage', true)$q$, 'row-level security');
select public.t_fails('banking admin cannot add setup staff', $q$insert into public.business_setup_staff (user_id, role) values ('00000000-0000-0000-0000-0000000000e1', 'MANAGER')$q$, 'row-level security');
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('read-only user cannot change setup role permissions', public.t_rows_changed($q$update public.business_setup_role_permissions set allowed = true$q$) = 0);
select public.t_ok('setup permissions are not in Banking tables', (select count(*) = 0 from public.banking_role_permissions where permission like 'setup.%'));
reset role;
-- A Banking override with the same permission name must not reach Business Setup.
insert into public.banking_user_permissions (user_id, permission, allowed) values
  ('00000000-0000-0000-0000-0000000000c1', 'kyc.manage', true), ('00000000-0000-0000-0000-0000000000b1', 'kyc.view', false);
set role authenticated;
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('banking kyc.manage override does not change business_setup_can', not public.business_setup_can('kyc.manage'));
select public.t_ok('banking kyc.manage override does not change my_access', not (public.business_setup_my_access() -> 'permissions' ? 'kyc.manage'));
select public.as_user('00000000-0000-0000-0000-0000000000b1');
select public.t_ok('banking kyc.view=false override does not remove setup kyc.view', public.business_setup_can('kyc.view'));
-- A Business Setup override works, and only for Business Setup.
select public.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.business_setup_user_permissions (user_id, permission, allowed) values ('00000000-0000-0000-0000-0000000000c1', 'kyc.manage', true);
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('a setup user override grants the right', public.business_setup_can('kyc.manage'));
select public.as_user('00000000-0000-0000-0000-0000000000a1');
delete from public.business_setup_user_permissions;
select public.as_user('00000000-0000-0000-0000-0000000000c1');
select public.t_ok('removing the setup override takes the right away', not public.business_setup_can('kyc.manage'));

-- ── Foundation: permission list, dropped tables, guard (spec 5.1 and 5.2) ──
reset role;
select public.bs_check('permission list', business_setup_permissions() @> array['setup.portal.manage','setup.import.manage','setup.services.override','setup.fees.manage','setup.audit.view','kyc.view','kyc.manage']);
select public.bs_check('old permissions gone', not business_setup_permissions() && array['setup.applications.view','setup.compliance.view','setup.regulatory.view']);
select public.bs_check('dropped tables absent', to_regclass('public.business_setup_client_profiles') is null and to_regclass('public.business_setup_notifications') is null);
select public.as_user('00000000-0000-0000-0000-0000000000d1');
set role authenticated;
select public.bs_expect_error('select business_setup_require(''setup.access'')', 'permission');
reset role;

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
