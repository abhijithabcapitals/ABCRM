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
-- Who may call what, checked before the blanket grant below hides it.
select public.bs_check('API roles cannot call the internal payment and gate helpers', not has_function_privilege('authenticated', 'public.business_setup_net_paid(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.business_setup_start_gate(uuid, text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_net_paid(uuid)', 'execute'));
select public.bs_check('only signed-in users can call the tracker functions', has_function_privilege('authenticated', 'public.business_setup_service_update(uuid, text, jsonb, text)', 'execute') and has_function_privilege('authenticated', 'public.business_setup_service_complete(uuid, jsonb, text)', 'execute') and has_function_privilege('authenticated', 'public.business_setup_quote_template_save(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.business_setup_service_update(uuid, text, jsonb, text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_service_complete(uuid, jsonb, text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_quote_template_save(jsonb)', 'execute'));
select public.bs_check('API roles cannot call the quote lock helper', not has_function_privilege('authenticated', 'public.business_setup_quote_locked(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_quote_locked(uuid)', 'execute'));
select public.bs_check('API roles cannot call the case stage and sync helpers', not has_function_privilege('authenticated', 'public.business_setup_case_sync(uuid)', 'execute') and not has_function_privilege('authenticated', 'public.business_setup_case_set_stage(uuid, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.business_setup_case_docs(uuid)', 'execute') and not has_function_privilege('anon', 'public.business_setup_case_sync(uuid)', 'execute'));
select public.bs_check('the lead and ownership functions are for signed-in staff only', (
  select bool_and(has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute') and not has_function_privilege('public', f, 'execute'))
    from unnest(array[
      'public.business_setup_case_new(jsonb)', 'public.business_setup_case_take(uuid)', 'public.business_setup_case_link_client(uuid, text, boolean)',
      'public.business_setup_case_shared(uuid)', 'public.business_setup_case_lost(uuid, text)', 'public.business_setup_case_confirm(uuid)',
      'public.business_setup_case_assign(uuid, uuid, text)', 'public.business_setup_reassign_request(uuid, uuid, text)', 'public.business_setup_reassign_respond(uuid, boolean, text)',
      'public.business_setup_form_staff_save(uuid, jsonb)', 'public.business_setup_form_doc_add(uuid, text, text)', 'public.business_setup_case_list(text)']) f));
select public.bs_check('API roles cannot call the service trigger function', not has_function_privilege('authenticated', 'public.business_setup_case_service_trg()', 'execute') and not has_function_privilege('anon', 'public.business_setup_case_service_trg()', 'execute'));
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

-- ── Workflow: quotes, KYC, services, payments rules (users act through Business Setup roles) ──
reset role;
-- Act as a signed-in CRM user (null: back to the table owner).
create function public.bs_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  perform set_config('role', case when p_user is null then 'postgres' else 'authenticated' end, false);
end $$;
grant execute on function public.bs_as(uuid) to authenticated;
-- Counts audit rows whatever the caller may read (the log needs setup.audit.view): action, optional row id, and a subset of new_data.
create function public.bs_audit_count(p_action text, p_row text, p_new jsonb) returns bigint language sql security definer set search_path = public, pg_temp as $$
  select count(*) from public.business_setup_audit_log where action = p_action and (p_row is null or row_id = p_row) and new_data @> p_new
$$;
grant execute on function public.bs_audit_count(text, text, jsonb) to authenticated;

-- TEST HELPERS for signed copies (restructure Task 8). A quote is accepted only on a confirmed signed copy. Older checks here mark
-- quotes accepted straight in the table or call the accept function: this trigger stands a Legacy signed row behind any quote that
-- becomes accepted without one, and bs_accept signs a quote then accepts it. Tests of the signed copy itself (090, 100) use the real functions.
create function public.bs_sign(p_quote uuid) returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.business_setup_signed_quotes (quote_id, source, status, note, decided_at)
  select p_quote, 'Legacy', 'Confirmed', 'test helper', now()
   where not exists (select 1 from public.business_setup_signed_quotes where quote_id = p_quote and status = 'Confirmed')
   on conflict do nothing;
end $$;
create function public.bs_accept(p_quote uuid, p_allow boolean default false) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.bs_sign(p_quote);
  return public.business_setup_quote_accept(p_quote, p_allow);
end $$;
grant execute on function public.bs_sign(uuid), public.bs_accept(uuid, boolean) to authenticated;
create function public.bs_sign_trg() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.doc_type = 'quote' and new.department = 'Business Setup' and new.status = 'accepted' then perform public.bs_sign(new.id); end if;
  return null;
end $$;
create trigger aaa_bs_sign after insert or update of status on public.hub_documents for each row execute function public.bs_sign_trg();
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'Manager', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'Sales', 'member'),
  ('00000000-0000-0000-0000-00000000000d', 'Docs', 'member'),
  ('00000000-0000-0000-0000-00000000000e', 'Finance', 'member'),
  ('00000000-0000-0000-0000-000000000099', 'Outsider', 'member');
insert into public.business_setup_staff (user_id, role) values
  ('00000000-0000-0000-0000-00000000000b', 'MANAGER'), ('00000000-0000-0000-0000-00000000000c', 'SALES_EXECUTIVE'),
  ('00000000-0000-0000-0000-00000000000d', 'DOCUMENT_EXECUTIVE'), ('00000000-0000-0000-0000-00000000000e', 'FINANCE');

-- ── Test data (as table owner) ──
insert into public.client_master (client_id, legal_name, data) values ('CL900001', 'Test Client LLC', '{}');
insert into public.business_setup_fee_items (grp, name, default_amount) values ('Test', 'Item A', 100);
-- Business Setup quotes now add 5% VAT on top (015). The payment and balance checks below are about payments, so their lines use a zero-rated item and keep round totals.
insert into public.business_setup_fee_items (grp, name, default_amount, vat_rate) values ('Test', 'Zero VAT', 0, 0);
create function pg_temp.zerofee() returns uuid language sql as $$ select id from public.business_setup_fee_items where grp = 'Test' and name = 'Zero VAT' $$;
insert into public.business_setup_services (client_id, name) values ('CL900001', 'Test service');
insert into public.business_setup_service_history (service_id, to_status) select id, 'Not started' from public.business_setup_services;
insert into public.business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, 100, 'Payment');
insert into public.business_setup_kyc_profiles (client_id) values ('CL900001');
insert into public.business_setup_kyc_partners (kyc_id, full_name, passport_number)
  select id, 'Partner One', 'P1234567' from public.business_setup_kyc_profiles;

-- ── Append-only (table owner, so only the trigger can refuse) ──
select public.bs_expect_error($$update business_setup_payments set amount = 1$$, 'append-only');
select public.bs_expect_error($$delete from business_setup_payments$$, 'append-only');
select public.bs_expect_error($$update business_setup_service_history set note = 'x'$$, 'append-only');
select public.bs_expect_error($$delete from business_setup_service_history$$, 'append-only');

-- ── Payments: shape rules ──
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, -5, 'Payment')$$, 'check');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, 0, 'Payment')$$, 'check');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, 5, 'Gift')$$, 'check');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, 5, 'Reversal')$$, 'check');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type, reverses_id) select client_id, current_date, 5, 'Payment', id from business_setup_payments$$, 'check');
insert into public.business_setup_payments (client_id, paid_on, amount, type, reverses_id)
  select client_id, current_date, amount, 'Reversal', id from public.business_setup_payments where type = 'Payment';
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type, reverses_id) select client_id, current_date, amount, 'Reversal', id from business_setup_payments where type = 'Payment'$$, 'duplicate key');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL000000', current_date, 5, 'Payment')$$, 'foreign key');

-- ── Fee master ──
select public.bs_expect_error($$insert into business_setup_fee_items (grp, name, default_amount) values ('Test', 'Item A', 5)$$, 'duplicate key');
insert into public.business_setup_fee_items (grp, name, default_amount) values ('Other', 'Item A', 5);
select public.bs_check('same name allowed in another group', (select count(*) from public.business_setup_fee_items where name = 'Item A') = 2);

-- ── Receipts: only file locations change ──
insert into public.business_setup_receipts (payment_id, receipt_number)
  select id, 'TEST-R1' from public.business_setup_payments where type = 'Payment';
update public.business_setup_receipts set storage_path = 'a/b.pdf', local_path = 'C:/x/b.pdf';
select public.bs_check('receipt file locations can be set', (select storage_path = 'a/b.pdf' from public.business_setup_receipts));
select public.bs_expect_error($$update business_setup_receipts set receipt_number = 'TEST-R2'$$, 'append-only');
select public.bs_expect_error($$delete from business_setup_receipts$$, 'append-only');

-- ── Signed-in users cannot write directly ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$insert into business_setup_fee_items (name) values ('x')$$, 'permission denied');
select public.bs_expect_error($$insert into business_setup_payments (client_id, paid_on, amount, type) values ('CL900001', current_date, 5, 'Payment')$$, 'permission denied');
select public.bs_expect_error($$update business_setup_services set name = 'x'$$, 'permission denied');
select public.bs_expect_error($$delete from business_setup_kyc_profiles$$, 'permission denied');

-- ── Read access ──
select public.bs_check('sales reads services', (select count(*) from public.business_setup_services) = 1);
select public.bs_check('sales reads kyc profile', (select count(*) from public.business_setup_kyc_profiles) = 1);
select public.bs_check('sales cannot see partner IDs', (select count(*) from public.business_setup_kyc_partners) = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('document executive sees partner IDs', (select count(*) from public.business_setup_kyc_partners) = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('finance reads payments', (select count(*) from public.business_setup_payments) = 2);
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_check('outsider sees no services', (select count(*) from public.business_setup_services) = 0);
select public.bs_check('outsider sees no payments', (select count(*) from public.business_setup_payments) = 0);
select public.bs_check('outsider sees no fee items', (select count(*) from public.business_setup_fee_items) = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('CRM admin reads partner IDs', (select count(*) from public.business_setup_kyc_partners) = 1);
select public.bs_as(null);

-- ── Hub extension: client link, quote status, letter gate, receipt numbering ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
create temp table bs_fx (k text primary key, v text);
grant all on bs_fx to authenticated;
create function pg_temp.bs_quote(p_dept text, p_extra jsonb default '{}') returns uuid language sql as $$
  select (public.hub_document_create(jsonb_build_object('doc_type','quote','department',p_dept,'client_name','Test Client LLC','contact_name','C','contact_email','c@x.ae','contact_phone','1','client_address','Dubai',
    'lines','[{"description":"Licence","amount":100}]'::jsonb) || p_extra)).id $$;
insert into bs_fx values ('bs_quote', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001"}')::text);
insert into bs_fx values ('acct_quote', pg_temp.bs_quote('Accounting')::text);
select public.bs_check('new quote is issued', (select status from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_quote')) = 'issued');
select public.bs_check('quote keeps client_id', (select client_id from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_quote')) = 'CL900001');
select public.bs_expect_error(format($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL000000"}')$$), 'client');
select public.bs_expect_error(format($$select public.hub_document_create('{"doc_type":"letter","parent_id":"%s"}')$$, (select v from bs_fx where k = 'bs_quote')), 'Mark the quote as accepted first');
select public.bs_check('Accounting letter still free', (public.hub_document_create(jsonb_build_object('doc_type','letter','parent_id',(select v from bs_fx where k = 'acct_quote')))).id is not null);
select public.bs_check('Accounting quote stays unlinked and issued', (select client_id is null and status = 'issued' from public.hub_documents where id = (select v::uuid from bs_fx where k = 'acct_quote')));
-- revision: marks the old quote superseded in the same call
insert into bs_fx values ('bs_rev', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900001','revises_id',(select v from bs_fx where k = 'bs_quote')))::text);
select public.bs_check('revision supersedes the old quote', (select status from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_quote')) = 'superseded');
select public.bs_check('revision links back', (select revises_id::text from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_rev')) = (select v from bs_fx where k = 'bs_quote'));
select public.bs_expect_error(format($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001","revises_id":"%s"}')$$, (select v from bs_fx where k = 'bs_quote')), 'issued');
select public.bs_expect_error($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001","revises_id":"00000000-0000-0000-0000-0000000000ff"}')$$, 'quote');
select public.bs_as(null);
select public.bs_expect_error($$update hub_documents set status = 'bogus'$$, 'check');
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900001', (select v::uuid from bs_fx where k = 'bs_rev'), current_date, 10, 'Payment');   -- a letter needs a payment first (Task 8)
update public.hub_documents set status = 'accepted', status_at = now() where id = (select v::uuid from bs_fx where k = 'bs_rev');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001","revises_id":"%s"}')$$, (select v from bs_fx where k = 'bs_rev')), 'issued');
insert into bs_fx values ('bs_letter', (public.hub_document_create(jsonb_build_object('doc_type','letter','parent_id',(select v from bs_fx where k = 'bs_rev')))).id::text);
select public.bs_check('letter keeps client', (select client_id from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_letter')) = 'CL900001');
select public.bs_check('letter number is BSE', (select document_number ~ '^ABC/[0-9]{4}/[0-9]{2}/BSE[0-9]{3}$' from public.hub_documents where id = (select v::uuid from bs_fx where k = 'bs_letter')));
select public.bs_as(null);

-- Receipt numbering
select public.bs_check('receipt number', public.hub_next_number('Business Setup','receipt') ~ '^ABC/[0-9]{4}/[0-9]{2}/BSR[0-9]{3}$');
select public.bs_check('receipt serial increments', public.hub_serial_of('Business Setup','receipt',public.hub_next_number('Business Setup','receipt')) = 2);
select public.bs_expect_error($$select public.hub_next_number('Accounting','receipt')$$, 'No numbering');
-- A number already used by a receipt is skipped.
insert into public.business_setup_receipts (payment_id, receipt_number)
  select id, (public.hub_numbering_status() -> 'Business Setup' -> 'receipt' ->> 'preview') from public.business_setup_payments where type = 'Reversal';
select public.bs_check('receipt number skips a used one', public.hub_next_number('Business Setup','receipt') <> (select receipt_number from public.business_setup_receipts where receipt_number <> 'TEST-R1'));
-- Numbering page
select public.bs_check('status lists BS receipt', (public.hub_numbering_status() -> 'Business Setup' -> 'receipt' ->> 'format') = 'ABC/{YYYY}/{MM}/BSR{SERIAL}');
select public.bs_check('status has no Accounting receipt', not (public.hub_numbering_status() -> 'Accounting' ? 'receipt'));
select public.bs_check('status keeps Accounting quote and letter', (public.hub_numbering_status() -> 'Accounting') ?& array['quote','letter']);
select public.bs_check('status keeps Banking untouched', not (public.hub_numbering_status() -> 'Business Banking' ? 'receipt'));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_expect_error($$select public.hub_numbering_save('Accounting','receipt','X{SERIAL}',3,'never',1)$$, 'Unknown document kind');
select public.hub_numbering_save('Business Setup','receipt','ABC/{YYYY}/BSR{SERIAL}',4,'year',7);
select public.bs_check('receipt numbering saved', (public.hub_numbering_status() -> 'Business Setup' -> 'receipt' ->> 'next_serial') = '7');
select public.bs_as(null);

-- Older documents: not treated as accepted
select public.bs_check('no existing row got accepted by default', not exists (select 1 from public.hub_documents where status = 'accepted' and id not in (select v::uuid from bs_fx where k = 'bs_rev')));

-- ── KYC, partners, fee items ──
-- Identity lives in client_master: CL900001 has it all except the licence, CL900002 is an Existing company with none.
update public.client_master set data = '{"Client Legal Name":"Test Client LLC","Primary Contact":"Jane Doe; Owner","General Email":"jane@test.ae","General Phone":"+971500000001"}' where client_id = 'CL900001';
insert into public.client_master (client_id, legal_name, data) values
  ('CL900002', 'Existing Co LLC', '{"Client Legal Name":"Existing Co LLC","Primary Contact":"Sam Roe","General Email":"sam@ex.ae","General Phone":"+971500000002"}');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
create temp table bs_kyc (k text primary key, v jsonb);
grant all on bs_kyc to authenticated;
insert into bs_kyc values ('empty', public.business_setup_kyc_status('CL900001'));
select public.bs_check('no profile data: activity, status and partner are missing',
  (select v -> 'missing' @> '["business activity","company status","partner"]'::jsonb and (v ->> 'percent')::int < 100 from bs_kyc where k = 'empty'));
-- CL900001 already has a profile row and a partner from the table tests; clear nothing, check New + partner
insert into bs_kyc values ('new1', public.business_setup_kyc_save('CL900001', '{"company_status":"New","business_activity":"Consulting","jurisdiction":"Dubai Mainland"}'));
select public.bs_check('New company, partner without nationality: partner still missing', (select v -> 'missing' = '["partner"]'::jsonb from bs_kyc where k = 'new1'));
select public.business_setup_partner_save('CL900001', '{"full_name":"Partner Two","nationality":"Indian","share_percent":60,"is_ubo":true,"passport_number":"P7654321","emirates_id":"784-1999-1234567-1"}') as ignored \gset
insert into bs_kyc values ('new2', public.business_setup_kyc_status('CL900001'));
select public.bs_check('New company with no licence is complete', (select (v ->> 'percent')::int = 100 and v -> 'missing' = '[]'::jsonb from bs_kyc where k = 'new2'));
select public.bs_check('kyc_save returns same shape', (select v ? 'percent' and v ? 'missing' from bs_kyc where k = 'new1'));
-- Existing company
select public.business_setup_kyc_save('CL900002', '{"company_status":"Existing","business_activity":"Trading"}') as ignored \gset
select public.business_setup_partner_save('CL900002', '{"full_name":"Sam Roe","nationality":"British"}') as ignored \gset
select public.bs_check('Existing company lists the licence fields',
  (select (public.business_setup_kyc_status('CL900002') -> 'missing') = '["licence number","licence expiry","issuing authority"]'::jsonb));
select public.business_setup_kyc_save('CL900002', '{"licence_number":"L-1","licence_expiry":"2030-01-01","details":{"issuing_authority":"DED"}}') as ignored \gset
select public.bs_check('Existing company with licence is complete', (public.business_setup_kyc_status('CL900002') ->> 'percent')::int = 100);
select public.bs_expect_error($$select public.business_setup_kyc_save('CL900002', '{"company_status":"Maybe"}')$$, 'company status');
select public.bs_expect_error($$select public.business_setup_kyc_save('CL000000', '{}')$$, 'not found');
select public.bs_expect_error($$select public.business_setup_partner_save('CL900001', '{"nationality":"X"}')$$, 'name');
-- Permissions
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select public.business_setup_kyc_save('CL900001', '{}')$$, 'permission');
select public.bs_expect_error($$select public.business_setup_kyc_status('CL900001')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error($$select public.business_setup_partner_save('CL900001', '{"full_name":"Z"}')$$, 'permission');
-- Sensitive reads
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('user without setup.kyc.sensitive reads no partner rows', (select count(*) from public.business_setup_kyc_partners) = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('user with setup.kyc.sensitive reads partner rows', (select count(*) from public.business_setup_kyc_partners where full_name = 'Partner Two') = 1);
-- Delete
select public.bs_as(null);
insert into bs_kyc values ('pid', to_jsonb((select id::text from public.business_setup_kyc_partners where full_name = 'Partner Two')));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_partner_delete((select (v #>> '{}')::uuid from bs_kyc where k = 'pid'));
select public.bs_as(null);
select public.bs_check('partner delete sets deleted_at, row kept', (select deleted_at is not null from public.business_setup_kyc_partners where full_name = 'Partner Two'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('deleted partner no longer counts', (public.business_setup_kyc_status('CL900001') -> 'missing') = '["partner"]'::jsonb);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('deleted partner hidden from readers', (select count(*) from public.business_setup_kyc_partners where full_name = 'Partner Two') = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_partner_delete('%s')$$, (select (v #>> '{}') from bs_kyc where k = 'pid')), 'not found');
select public.bs_as(null);
-- Activity is masked
select public.bs_check('audit log records kyc saves', exists (select 1 from public.business_setup_audit_log where new_data ->> 'client_id' = 'CL900001' and action like 'kyc%'));
select public.bs_check('audit log never holds passport or ID values',
  not exists (select 1 from public.business_setup_audit_log where new_data::text like '%P7654321%' or new_data::text like '%784-1999%' or old_data::text like '%P7654321%' or old_data::text like '%784-1999%'));
select public.bs_check('audit log holds masked marker for passport', exists (select 1 from public.business_setup_audit_log where table_name = 'business_setup_kyc_partners' and new_data::text like '%***%'));
-- Fee items
select public.bs_as('00000000-0000-0000-0000-00000000000b');
create temp table bs_fee (id uuid);
grant all on bs_fee to authenticated;
insert into bs_fee select public.business_setup_fee_item_save('{"grp":"Test","name":"Item B","default_amount":250}');
select public.bs_check('fee item saved', (select default_amount = 250 from public.business_setup_fee_items where grp = 'Test' and name = 'Item B'));
select public.business_setup_fee_item_save(jsonb_build_object('id', (select id from bs_fee), 'grp','Test','name','Item B','default_amount',300)) as ignored \gset
select public.bs_check('fee item amount edited in place', (select count(*) = 1 and max(default_amount) = 300 from public.business_setup_fee_items where grp = 'Test' and name = 'Item B'));
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"Test","name":"Item C","default_amount":-1}')$$, 'negative');
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"Test","default_amount":1}')$$, 'name');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"Test","name":"Item D","default_amount":1}')$$, 'permission');
select public.bs_as(null);
-- Seed: 24 rows when the private seed was loaded; skipped when absent (no prices printed)
do $$
declare n int;
begin
  select count(*) into n from public.business_setup_fee_items where grp not in ('Test', 'Other', 'Company');
  if n = 0 then
    raise notice 'skip fee seed count: private/007 seed not loaded';
  else
    perform public.bs_check('fee seed has 24 rows', n = 24, n::text || ' rows');
  end if;
end $$;

-- ── Task 3 fixes ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_fee_item_save(jsonb_build_object('id', (select id from bs_fee), 'grp','Test','name','Item B')) as ignored \gset
select public.bs_check('fee edit without default_amount keeps the amount', (select default_amount = 300 from public.business_setup_fee_items where grp = 'Test' and name = 'Item B'));
select public.business_setup_fee_item_save('{"grp":"Test","name":"Item B","active":true}') as ignored \gset
select public.bs_check('fee upsert by name without default_amount keeps the amount', (select default_amount = 300 from public.business_setup_fee_items where grp = 'Test' and name = 'Item B'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_partner_save('CL900002', '{"full_name":"Detail Tester","details":{"note":"SECRETVALUE-XYZ","other":"v2other"}}') as ignored \gset
select public.bs_as(null);
select public.bs_check('partner audit never holds details values',
  not exists (select 1 from public.business_setup_audit_log where new_data::text like '%SECRETVALUE%' or new_data::text like '%v2other%'));
select public.bs_check('partner audit holds details key names',
  exists (select 1 from public.business_setup_audit_log where action = 'partner_add' and new_data -> 'details_keys' @> '["note","other"]'::jsonb));

-- ── Quote lifecycle and tracker ──
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from bs_fx where k = p_k $$;
select public.bs_expect_error($$update business_setup_services set status = 'bogus'$$, 'check');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values
  ('q', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','valid_until',current_date + 30,
        'lines', jsonb_build_array(
          jsonb_build_object('service_name','Licence renewal','action','Renewal','description','Renewal of licence','amount',100,'fee_item_id',(select id from public.business_setup_fee_items where grp='Test' and name='Item A')),
          jsonb_build_object('description','Consulting only','amount',50))))::text),
  ('q_nolink', pg_temp.bs_quote('Business Setup')::text),
  ('q_no_kyc', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001"}')::text),
  ('q_expired', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002","valid_until":"2020-01-01"}')::text),
  ('q_zero', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002","lines":[{"description":"Free advice","amount":0}]}')::text),
  ('q2', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002"}')::text);
-- accept
insert into bs_kyc values ('acc', public.bs_accept(pg_temp.fx('q')::uuid));
select public.bs_check('accept returns quote_id, status, services_created',
  (select v ->> 'quote_id' = pg_temp.fx('q') and v ->> 'status' = 'accepted' and (v ->> 'services_created')::int = 2 from bs_kyc where k = 'acc'));
select public.bs_check('quote is accepted with date and person', (select status = 'accepted' and status_at is not null and status_by is not null from public.hub_documents where id = pg_temp.fx('q')::uuid));
select public.bs_check('one tracker line per quote line', (select count(*) from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid) = 2);
select public.bs_check('line keeps service name, action and fee item',
  exists (select 1 from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Licence renewal' and action = 'Renewal' and amount = 100
          and fee_item_id = (select id from public.business_setup_fee_items where grp='Test' and name='Item A') and client_id = 'CL900002'));
select public.bs_check('line without service name falls back to description, action to New',
  exists (select 1 from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Consulting only' and action = 'New' and status = 'Not started'));
select public.bs_check('each new tracker line has an opening history row',
  (select count(*) from public.business_setup_service_history h join public.business_setup_services s on s.id = h.service_id where s.quote_id = pg_temp.fx('q')::uuid and h.to_status = 'Not started' and h.from_status is null) = 2);
select public.bs_check('accept writes an audit row', public.bs_audit_count('quote_accept', pg_temp.fx('q'), '{"client_id":"CL900002"}') = 1);
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q')), 'already');
select public.bs_check('a refused accept creates no extra lines', (select count(*) from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid) = 2);
-- gates
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_nolink')), 'Link this quote to a client');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_no_kyc')), 'KYC');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_expired')), 'expired');
select public.bs_check('expired quote stays issued after refusal', (select status = 'issued' from public.hub_documents where id = pg_temp.fx('q_expired')::uuid));
select public.bs_check('expired quote accepted with the flag', (public.bs_accept(pg_temp.fx('q_expired')::uuid, true) ->> 'status') = 'accepted');
select public.bs_check('zero total can be accepted', (public.bs_accept(pg_temp.fx('q_zero')::uuid)) is not null);
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('acct_quote')), 'Business Setup');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, (select id from public.hub_documents where doc_type = 'letter' and department = 'Accounting')), 'Business Setup');
select public.bs_expect_error($$select business_setup_quote_accept('00000000-0000-0000-0000-0000000000ff')$$, 'not found');
-- renewal line links back to an earlier service of the same client
insert into bs_fx values
  ('q_ren', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
      jsonb_build_object('description','Renew again','action','Renewal','amount',10,'renews_service_id',(select id from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Licence renewal')))))::text),
  ('q_ren_bad', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
      jsonb_build_object('description','Renew other','action','Renewal','amount',10,'renews_service_id',(select id from public.business_setup_services where name = 'Test service')))))::text);
select public.bs_expect_error(format($$select bs_accept('%s')$$, pg_temp.fx('q_ren_bad')), 'earlier service');
select public.bs_check('refused renewal leaves the quote issued', (select status = 'issued' from public.hub_documents where id = pg_temp.fx('q_ren_bad')::uuid));
select public.bs_accept(pg_temp.fx('q_ren')::uuid) as ignored \gset
select public.bs_check('renewal line carries renews_service_id',
  (select renews_service_id = (select id from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Licence renewal') from public.business_setup_services where quote_id = pg_temp.fx('q_ren')::uuid));
-- reject
select public.bs_expect_error(format($$select business_setup_quote_reject('%s','')$$, pg_temp.fx('q2')), 'reason');
select public.bs_expect_error(format($$select business_setup_quote_reject('%s','   ')$$, pg_temp.fx('q2')), 'reason');
select public.business_setup_quote_reject(pg_temp.fx('q2')::uuid, 'Client chose another provider');
select public.bs_check('rejected with date, person and reason', (select status = 'rejected' and status_at is not null and status_by is not null and status_reason = 'Client chose another provider' from public.hub_documents where id = pg_temp.fx('q2')::uuid));
select public.bs_check('reject writes an audit row', public.bs_audit_count('quote_reject', pg_temp.fx('q2'), '{}') = 1);
select public.bs_expect_error(format($$select business_setup_quote_reject('%s','again')$$, pg_temp.fx('q2')), 'issued');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q2')), 'issued');
select public.bs_expect_error(format($$select business_setup_quote_reject('%s','x')$$, pg_temp.fx('acct_quote')), 'Business Setup');
select public.bs_check('rejecting created no tracker lines', (select count(*) from public.business_setup_services where quote_id = pg_temp.fx('q2')::uuid) = 0);
-- revision chain: one accepted quote per root
insert into bs_fx values ('r1', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002"}')::text);
insert into bs_fx values ('r2', pg_temp.bs_quote('Business Setup', jsonb_build_object('revises_id', pg_temp.fx('r1')))::text);
select public.bs_check('revision keeps the old quote client when none is given', (select client_id = 'CL900002' from public.hub_documents where id = pg_temp.fx('r2')::uuid));
select public.bs_check('root_quote_id: own id for a first quote, the root for a revision',
  (select root_quote_id = id from public.hub_documents where id = pg_temp.fx('r1')::uuid) and (select root_quote_id::text = pg_temp.fx('r1') from public.hub_documents where id = pg_temp.fx('r2')::uuid));
select public.bs_expect_error(format($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900001","revises_id":"%s"}')$$, pg_temp.fx('r2')), 'client');
select public.bs_accept(pg_temp.fx('r2')::uuid) as ignored \gset
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('r1')), 'already');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('r2')), 'already');
select public.bs_as(null);
select public.bs_expect_error(format($$update hub_documents set status = 'accepted' where id = '%s'$$, pg_temp.fx('r1')), 'duplicate key');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
-- link
select public.bs_expect_error(format($$select business_setup_quote_link('%s','CL000000')$$, pg_temp.fx('q_nolink')), 'not found');
select public.business_setup_quote_link(pg_temp.fx('q_nolink')::uuid, 'CL900002');
select public.bs_check('link sets the client', (select client_id = 'CL900002' from public.hub_documents where id = pg_temp.fx('q_nolink')::uuid));
select public.bs_check('link writes an audit row', public.bs_audit_count('quote_link', pg_temp.fx('q_nolink'), '{"client_id":"CL900002"}') = 1);
select public.business_setup_quote_link(pg_temp.fx('q_nolink')::uuid, 'CL900002');
select public.bs_expect_error(format($$select business_setup_quote_link('%s','CL900001')$$, pg_temp.fx('q_nolink')), 'different client');
select public.bs_expect_error(format($$select business_setup_quote_link('%s','CL900002')$$, pg_temp.fx('acct_quote')), 'Business Setup');
select public.bs_expect_error(format($$select business_setup_quote_link('%s','CL900002')$$, pg_temp.fx('bs_letter')), 'quote');
select public.bs_check('after linking, the quote can be accepted', (public.bs_accept(pg_temp.fx('q_nolink')::uuid) ->> 'status') = 'accepted');
-- engagement letter and signing
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', ((now() at time zone 'Asia/Dubai')::date + 1), 'a/b.pdf')$$, pg_temp.fx('bs_letter')), 'future');
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', current_date, '')$$, pg_temp.fx('bs_letter')), 'scan');
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', null, 'a/b.pdf')$$, pg_temp.fx('bs_letter')), 'date');
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', current_date, 'a/b.pdf')$$, pg_temp.fx('bs_rev')), 'letter');
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', current_date, 'a/b.pdf')$$, (select id from public.hub_documents where doc_type = 'letter' and department = 'Accounting')), 'Business Setup');
select public.bs_expect_error($$select business_setup_letter_sign('00000000-0000-0000-0000-0000000000ff', current_date, 'a/b.pdf')$$, 'not found');
select public.business_setup_letter_sign(pg_temp.fx('bs_letter')::uuid, (now() at time zone 'Asia/Dubai')::date, 'signed/scan.pdf');
select public.bs_check('letter signed with date and scan', (select signed_at = (now() at time zone 'Asia/Dubai')::date and signed_path = 'signed/scan.pdf' from public.hub_documents where id = pg_temp.fx('bs_letter')::uuid));
select public.bs_check('sign writes an audit row', public.bs_audit_count('letter_sign', pg_temp.fx('bs_letter'), '{"client_id":"CL900001"}') = 1);
-- service tracker: statuses and the start gate
select public.bs_as(null);
select public.bs_expect_error($$update business_setup_services set status = 'Waiting on partner'$$, 'check');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('statuses include waiting on client', business_setup_status_allowed('Waiting on client'));
select public.bs_check('every tracker status is allowed', business_setup_status_allowed('Not started') and business_setup_status_allowed('In progress') and business_setup_status_allowed('Waiting on government') and business_setup_status_allowed('Completed') and business_setup_status_allowed('Cancelled'));
select public.bs_check('an unknown status is not allowed', not business_setup_status_allowed('Done') and business_setup_status_allowed(null) is not true);
insert into bs_fx values ('svc', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Consulting only'));
insert into bs_fx values ('svc_zero', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_zero')::uuid));
-- 'q' totals 150 and has no payment yet
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('svc')), 'payment');
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress','{}','Client will pay later')$$, pg_temp.fx('svc')), 'payment');
select public.bs_check('a refused start leaves the service Not started', (select status = 'Not started' and started_at is null from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.bs_check('a refused start writes no history', (select count(*) from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid) = 1);
-- a zero total starts without a payment
select public.business_setup_service_update(pg_temp.fx('svc_zero')::uuid, 'In progress');
select public.bs_check('zero total starts without payment', (select status = 'In progress' and started_at is not null from public.business_setup_services where id = pg_temp.fx('svc_zero')::uuid));
-- a net payment above zero lets it start (the payment writer comes later, so the owner inserts the row)
select public.bs_as(null);
select public.bs_check('net paid is 0 before any payment', public.business_setup_net_paid(pg_temp.fx('q')::uuid) = 0);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900002', pg_temp.fx('q')::uuid, current_date, 60, 'Payment');
select public.bs_check('net paid counts the payment', public.business_setup_net_paid(pg_temp.fx('q')::uuid) = 60);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'In progress', '{"owner_id":"00000000-0000-0000-0000-00000000000d","start_date":"2026-11-03","notes":"Started"}');
select public.bs_check('service updated: status, owner, start date, notes',
  (select status = 'In progress' and owner_id = '00000000-0000-0000-0000-00000000000d' and start_date = '2026-11-03' and notes = 'Started' and started_at is not null from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.bs_check('status change writes history', (select count(*) from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid and from_status = 'Not started' and to_status = 'In progress') = 1);
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'In progress', '{"notes":"Still going"}');
select public.bs_check('same status adds no history', (select count(*) from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid) = 2);
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, null, '{"notes":"Fields only"}');
select public.bs_check('a null status changes only the fields', (select status = 'In progress' and notes = 'Fields only' and owner_id is not null from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'Waiting on client', '{}', 'Documents requested');
select public.bs_check('waiting on client is a status', (select status = 'Waiting on client' from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'In progress');
select public.bs_expect_error(format($$select business_setup_service_update('%s','Cancelled')$$, pg_temp.fx('svc')), 'reason');
select public.bs_expect_error(format($$select business_setup_service_update('%s','Cancelled','{}','  ')$$, pg_temp.fx('svc')), 'reason');
select public.bs_expect_error(format($$select business_setup_service_update('%s','Done')$$, pg_temp.fx('svc')), 'status');
select public.bs_check('refused status change left the service unchanged', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.bs_expect_error($$select business_setup_service_update('00000000-0000-0000-0000-0000000000ff','In progress')$$, 'not found');

-- start override: a quote with a total and no payment
insert into bs_fx values ('q_ov', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
    jsonb_build_object('service_name','Override one','amount',200), jsonb_build_object('service_name','Override two','amount',100))))::text);
select public.bs_accept(pg_temp.fx('q_ov')::uuid) as ignored \gset
insert into bs_fx values ('ov', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_ov')::uuid and name = 'Override one')),
  ('ov2', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_ov')::uuid and name = 'Override two'));
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress','{}','Client will pay Friday')$$, pg_temp.fx('ov')), 'payment');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('ov')), 'reason');
select public.bs_check('the manager is refused too without a reason', (select status = 'Not started' from public.business_setup_services where id = pg_temp.fx('ov')::uuid));
select public.business_setup_service_update(pg_temp.fx('ov')::uuid, 'In progress', '{}', 'Client will pay Friday');
select public.bs_check('override starts the service with the reason on its history',
  (select s.status = 'In progress' and s.started_at is not null and h.note = 'Client will pay Friday'
     from public.business_setup_services s join public.business_setup_service_history h on h.service_id = s.id and h.to_status = 'In progress' where s.id = pg_temp.fx('ov')::uuid));
select public.bs_check('the override is in the audit log', public.bs_audit_count('service_update', pg_temp.fx('ov'), '{"start_override": true}') = 1);
select public.bs_check('an ordinary start is not logged as an override', public.bs_audit_count('service_update', pg_temp.fx('svc'), '{"start_override": false}') > 0);

-- a reversed payment: started work stays, the next line is blocked again
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_rev', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
    jsonb_build_object('service_name','Reversal one','amount',100), jsonb_build_object('service_name','Reversal two','amount',100))))::text);
select public.bs_accept(pg_temp.fx('q_rev')::uuid) as ignored \gset
insert into bs_fx values ('rev1', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_rev')::uuid and name = 'Reversal one')),
  ('rev2', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_rev')::uuid and name = 'Reversal two'));
select public.bs_as(null);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900002', pg_temp.fx('q_rev')::uuid, current_date, 100, 'Payment');
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900002', pg_temp.fx('q_rev')::uuid, current_date, 30, 'Refund');
select public.bs_check('net paid takes a refund away', public.business_setup_net_paid(pg_temp.fx('q_rev')::uuid) = 70);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_service_update(pg_temp.fx('rev1')::uuid, 'In progress');
select public.bs_as(null);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, reverses_id)
  select client_id, quote_id, current_date, amount, 'Reversal', id from public.business_setup_payments where quote_id = pg_temp.fx('q_rev')::uuid and type = 'Payment';
select public.bs_check('net paid takes a reversal away', public.business_setup_net_paid(pg_temp.fx('q_rev')::uuid) = -30);
select public.bs_check('only this quote is counted', public.business_setup_net_paid(pg_temp.fx('q_zero')::uuid) = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('the started line stays In progress after the reversal', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('rev1')::uuid));
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('rev2')), 'payment');
select public.business_setup_service_update(pg_temp.fx('rev1')::uuid, 'Waiting on client');
select public.business_setup_service_update(pg_temp.fx('rev1')::uuid, 'In progress');
select public.bs_check('a started line can resume after the reversal', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('rev1')::uuid));

-- completion needs an output file
select public.bs_expect_error(format($$select business_setup_service_update('%s','Completed')$$, pg_temp.fx('svc')), 'output');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'output');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}','Nothing to upload')$$, pg_temp.fx('svc')), 'output');
select public.bs_as(null);
insert into public.business_setup_documents (client_id, kind, file_name, storage_path, service_id, is_output)
  values ('CL900002', 'Note', 'working-note.pdf', 'CL900002/working-note.pdf', pg_temp.fx('svc')::uuid, false);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'output');
select public.bs_check('a refused completion leaves the service In progress', (select status = 'In progress' and completed_at is null from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'reason');
select public.bs_as(null);
insert into public.business_setup_documents (client_id, kind, file_name, storage_path, service_id, is_output)
  values ('CL900002', 'Output', 'result.pdf', 'CL900002/result.pdf', pg_temp.fx('svc')::uuid, true);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_service_complete(pg_temp.fx('svc')::uuid, '{"note":"Delivered"}');
select public.bs_check('completed with an output file: status, time, details',
  (select status = 'Completed' and completed_at is not null and output_details ->> 'note' = 'Delivered' from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
select public.bs_check('completion writes history', (select count(*) from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid and from_status = 'In progress' and to_status = 'Completed') = 1);
select public.bs_check('completion with a file is not logged as an override', public.bs_audit_count('service_complete', pg_temp.fx('svc'), '{"without_output": false}') = 1);
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'already');
-- override: completing without a file needs a reason
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_service_complete(pg_temp.fx('ov')::uuid, '{}', 'Client collected the papers in person');
select public.bs_check('override completes without an output file', (select status = 'Completed' from public.business_setup_services where id = pg_temp.fx('ov')::uuid));
select public.bs_check('the completion override is in the audit log', public.bs_audit_count('service_complete', pg_temp.fx('ov'), '{"without_output": true}') = 1);
-- a never-started line also meets the payment gate when it is completed
select public.bs_as(null);
insert into public.business_setup_documents (client_id, kind, file_name, storage_path, service_id, is_output)
  values ('CL900002', 'Output', 'two.pdf', 'CL900002/two.pdf', pg_temp.fx('ov2')::uuid, true);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('ov2')), 'payment');
select public.bs_check('a refused completion leaves a Not started line alone', (select status = 'Not started' and started_at is null from public.business_setup_services where id = pg_temp.fx('ov2')::uuid));
-- cancelling
insert into bs_fx select 'pay_before_cancel', count(*)::text from public.business_setup_payments;
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'Cancelled', '{}', 'Client withdrew');
select public.bs_check('cancel history keeps the reason', (select note = 'Client withdrew' from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid and to_status = 'Cancelled'));
select public.bs_check('cancelling changes no payment', (select count(*) from public.business_setup_payments) = pg_temp.fx('pay_before_cancel')::int);
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'cancelled');
select public.bs_check('service changes and completions are all in the audit log', public.bs_audit_count('service_update', pg_temp.fx('svc'), '{}') + public.bs_audit_count('service_complete', pg_temp.fx('svc'), '{}') = 7);
select public.bs_expect_error($$select business_setup_service_complete('00000000-0000-0000-0000-0000000000ff','{}')$$, 'not found');

-- company registration: licence details reach Client Master and the service expiry
insert into bs_fx values ('q_reg', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
    jsonb_build_object('service_name','Company registration','amount',0))))::text);
select public.bs_accept(pg_temp.fx('q_reg')::uuid) as ignored \gset
insert into bs_fx values ('reg', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_reg')::uuid));
select public.bs_as(null);
insert into public.business_setup_documents (client_id, kind, file_name, storage_path, service_id, is_output)
  values ('CL900002', 'Output', 'licence.pdf', 'CL900002/licence.pdf', pg_temp.fx('reg')::uuid, true);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{"licence":{"number":"T-1","issue_date":"2026-01-15","expiry_date":"2027-01-14"}}')$$, pg_temp.fx('reg')), 'licence');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{"licence":{"number":"T-1","authority":"DED","issue_date":"2026-01-15","expiry_date":"2025-01-14"}}')$$, pg_temp.fx('reg')), 'expiry');
select public.bs_check('a refused licence leaves Client Master and the service alone',
  (select data ->> 'Trade License Number' is null from public.client_master where client_id = 'CL900002') and (select status = 'Not started' and expiry_date is null from public.business_setup_services where id = pg_temp.fx('reg')::uuid));
select public.business_setup_service_complete(pg_temp.fx('reg')::uuid, '{"licence":{"number":"T-1","authority":"DED","issue_date":"2026-01-15","expiry_date":"2027-01-14"}}');
select public.bs_check('licence reaches client master', (select data ->> 'Trade License Number' from public.client_master where client_id = 'CL900002') = 'T-1');
select public.bs_check('authority and dates reach client master as UAE dates',
  (select data ->> 'License Issuing Authority' = 'DED' and data ->> 'License Issue Date' = '15/01/2026' and data ->> 'License Expiry Date' = '14/01/2027' from public.client_master where client_id = 'CL900002'));
select public.bs_check('licence expiry sets the service expiry date', (select expiry_date = '2027-01-14' and status = 'Completed' from public.business_setup_services where id = pg_temp.fx('reg')::uuid));
select public.bs_check('client master history records the licence', exists (select 1 from public.client_master_history where client_id = 'CL900002' and field = 'Trade License Number' and new_value = 'T-1'));

-- quote templates
select public.bs_as(null);
select public.bs_check('six templates are seeded', (select array_agg(key order by key) from public.business_setup_quote_templates) = array['ifza','liquidation','mainland','rakez','service','shams']);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('sales reads the template list', (select count(*) from public.business_setup_quote_templates) = 6);
select public.bs_expect_error($$insert into business_setup_quote_templates (key, label, storage_file) values ('x', 'X', 'x.docx')$$, 'permission denied');
select public.bs_expect_error($$select business_setup_quote_template_save('{"key":"x","label":"X","storage_file":"x.docx"}')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_check('outsider reads no templates', (select count(*) from public.business_setup_quote_templates) = 0);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('save returns the key', public.business_setup_quote_template_save('{"key":"newzone","label":"New Zone","jurisdiction":"New Zone","storage_file":"NewZone.docx"}') = 'newzone');
select public.business_setup_quote_template_save('{"key":"newzone","label":"New Zone FZ"}') as ignored \gset
select public.bs_check('an edit changes only the keys given', (select label = 'New Zone FZ' and storage_file = 'NewZone.docx' and jurisdiction = 'New Zone' and active from public.business_setup_quote_templates where key = 'newzone'));
select public.bs_expect_error($$select business_setup_quote_template_save('{"key":"Bad Key!","label":"X","storage_file":"x.docx"}')$$, 'key');
select public.bs_expect_error($$select business_setup_quote_template_save('{"key":"nofile","label":"No file"}')$$, 'needs');
select public.bs_expect_error($$select business_setup_quote_template_save('{"key":"newzone","label":"  "}')$$, 'name');
select public.bs_check('template saves are in the audit log', (select count(*) from public.business_setup_audit_log where action = 'quote_template_save' and row_id = 'newzone') = 2);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_tpl', pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002","template_key":"ifza"}')::text);
select public.bs_check('a quote keeps its template', (select template_key = 'ifza' from public.hub_documents where id = pg_temp.fx('q_tpl')::uuid));
select public.bs_check('a quote without a template has none', (select template_key is null from public.hub_documents where id = pg_temp.fx('q_nolink')::uuid));
select public.bs_expect_error($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002","template_key":"nope"}')$$, 'template');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_quote_template_save('{"key":"newzone","active":false}') as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select pg_temp.bs_quote('Business Setup', '{"client_id":"CL900002","template_key":"newzone"}')$$, 'template');

-- numbering is shared: a Business Setup manager cannot change it without the settings right
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error($$select public.hub_numbering_save('Business Setup','receipt','ABC/{YYYY}/BSR{SERIAL}',4,'year',9)$$, 'permission');
select public.bs_check('the numbering page does not offer editing to a manager', (public.hub_numbering_status() ->> 'can_manage') = 'false');
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('the numbering page offers editing to a CRM admin', (public.hub_numbering_status() ->> 'can_manage') = 'true');
select public.bs_as(null);
-- permissions
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_no_kyc')), 'permission');
select public.bs_expect_error(format($$select business_setup_quote_reject('%s','x')$$, pg_temp.fx('q_no_kyc')), 'permission');
select public.bs_expect_error(format($$select business_setup_quote_link('%s','CL900002')$$, pg_temp.fx('q_no_kyc')), 'permission');
select public.bs_expect_error(format($$select business_setup_letter_sign('%s', current_date, 'a/b.pdf')$$, pg_temp.fx('bs_letter')), 'permission');
select public.bs_expect_error(format($$select business_setup_service_update('%s',null,'{"notes":"x"}')$$, pg_temp.fx('svc')), 'permission');
select public.bs_expect_error(format($$select business_setup_service_complete('%s','{}')$$, pg_temp.fx('svc')), 'permission');
select public.bs_expect_error($$select business_setup_quote_template_save('{"key":"x","label":"X","storage_file":"x.docx"}')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_no_kyc')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_quote_accept('%s')$$, pg_temp.fx('q_no_kyc')), 'permission');
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, null, '{"notes":"Docs may update the tracker"}');
select public.bs_as(null);

-- ── Payments and receipts ──
select public.bs_as(null);
select public.bs_check('only signed-in users can call the payment functions', has_function_privilege('authenticated', 'public.business_setup_payment_add(jsonb)', 'execute') and has_function_privilege('authenticated', 'public.business_setup_payment_reverse(uuid, text)', 'execute')
  and has_function_privilege('authenticated', 'public.business_setup_receipt_attach(uuid, text)', 'execute') and has_function_privilege('authenticated', 'public.business_setup_quote_balance(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.business_setup_payment_add(jsonb)', 'execute') and not has_function_privilege('anon', 'public.business_setup_payment_reverse(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.business_setup_receipt_attach(uuid, text)', 'execute') and not has_function_privilege('anon', 'public.business_setup_quote_balance(uuid)', 'execute'));
-- an earlier check edited the receipt format: put the shipped one back
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.hub_numbering_save('Business Setup','receipt','ABC/{YYYY}/{MM}/BSR{SERIAL}',3,'never',1);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_pay', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(
    jsonb_build_object('service_name','Pay one','amount',500,'fee_item_id',pg_temp.zerofee()), jsonb_build_object('service_name','Pay two','amount',500,'fee_item_id',pg_temp.zerofee()))))::text);
select public.bs_accept(pg_temp.fx('q_pay')::uuid) as ignored \gset
insert into bs_fx values ('pay1', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_pay')::uuid and name = 'Pay one')),
  ('pay2', (select id::text from public.business_setup_services where quote_id = pg_temp.fx('q_pay')::uuid and name = 'Pay two')),
  ('part', jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'paid_on', current_date, 'amount', 400, 'method', 'Bank transfer', 'reference', 'TT-1')::text),
  ('over', jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'paid_on', current_date, 'amount', 700)::text);
-- who may record
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('part')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('part')), 'permission');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('part')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
-- refused input
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q2'), 'amount', 10)), 'accepted');
select public.bs_expect_error($$select business_setup_payment_add('{"quote_id":"00000000-0000-0000-0000-0000000000ff","amount":10}')$$, 'quote');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', 0)), 'amount');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', -5)), 'amount');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', 'abc')), 'amount');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', 10.555)), 'amount');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', 10, 'paid_on', current_date + 3)), 'future');
select public.bs_check('refused payments left no ledger row', (select count(*) from public.business_setup_payments where quote_id = pg_temp.fx('q_pay')::uuid) = 0);
-- a part payment
insert into bs_fx select 'part_res', public.business_setup_payment_add(pg_temp.fx('part')::jsonb)::text;
select public.bs_check('receipt number format', (select v::jsonb ->> 'receipt_number' from bs_fx where k = 'part_res') ~ '^ABC/\d{4}/\d{2}/BSR\d{3}', (select v::jsonb ->> 'receipt_number' from bs_fx where k = 'part_res'));
select public.bs_check('add returns the payment, receipt and number', (select v::jsonb ->> 'payment_id' is not null and v::jsonb ->> 'receipt_id' is not null from bs_fx where k = 'part_res'));
select public.bs_check('the receipt belongs to the payment', (select count(*) from public.business_setup_receipts r join public.business_setup_payments p on p.id = r.payment_id
  where r.id = (select (v::jsonb ->> 'receipt_id')::uuid from bs_fx where k = 'part_res') and p.id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res')
    and r.receipt_number = (select v::jsonb ->> 'receipt_number' from bs_fx where k = 'part_res') and p.type = 'Payment' and p.amount = 400 and p.client_id = 'CL900002' and p.method = 'Bank transfer' and p.reference = 'TT-1') = 1);
select public.bs_check('part payment balance', (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'outstanding')::numeric = 600);
select public.bs_check('balance shows total and net paid', (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'total')::numeric = 1000 and (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'net_paid')::numeric = 400);
select public.bs_check('the receipt is in the voucher register', exists (select 1 from public.voucher_register where source = 'business_setup' and voucher_type = 'Receipt'
  and source_id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res') and voucher_number = (select v::jsonb ->> 'receipt_number' from bs_fx where k = 'part_res')
  and amount = 400 and status = 'Valid' and department = 'Business Setup' and client_name is not null and issued_on = current_date));
select public.bs_check('payment add is in the audit log', public.bs_audit_count('payment_add', (select v::jsonb ->> 'payment_id' from bs_fx where k = 'part_res'), '{"client_id":"CL900002","overpayment":false}') = 1);
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('over')), 'balance');
select public.bs_check('the refused overpayment left the balance alone', (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'outstanding')::numeric = 600);
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay'), 'amount', 700, 'override_reason', 'Client insists')), 'balance');
-- work starts after the part payment
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_service_update(pg_temp.fx('pay1')::uuid, 'In progress');
select public.bs_check('the line starts once a payment exists', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('pay1')::uuid));
-- reversal
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','Wrong quote')$$, (select v::jsonb ->> 'payment_id' from bs_fx where k = 'part_res')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s',null)$$, (select v::jsonb ->> 'payment_id' from bs_fx where k = 'part_res')), 'reason');
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','   ')$$, (select v::jsonb ->> 'payment_id' from bs_fx where k = 'part_res')), 'reason');
select public.bs_expect_error($$select business_setup_payment_reverse('00000000-0000-0000-0000-0000000000ff','x')$$, 'not found');
insert into bs_fx select 'rev_res', public.business_setup_payment_reverse((select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res'), 'Cheque bounced')::text;
insert into bs_fx select 'rev_id', (select v::jsonb ->> 'reversal_id' from bs_fx where k = 'rev_res');
select public.bs_check('the reversal entry points at the payment and carries the reason', (select type = 'Reversal' and amount = 400 and quote_id = pg_temp.fx('q_pay')::uuid and client_id = 'CL900002'
  and reverses_id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res') and note = 'Cheque bounced' from public.business_setup_payments where id = pg_temp.fx('rev_id')::uuid));
select public.bs_check('the receipt shows as Reversed', (select status = 'Reversed' from public.voucher_register where source = 'business_setup' and source_id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res')));
select public.bs_check('a reversal has no receipt of its own', not exists (select 1 from public.business_setup_receipts where payment_id = pg_temp.fx('rev_id')::uuid));
select public.bs_check('the reversal is in the audit log', public.bs_audit_count('payment_reverse', pg_temp.fx('rev_id'), '{"reason":"Cheque bounced"}') = 1);
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','again')$$, (select v::jsonb ->> 'payment_id' from bs_fx where k = 'part_res')), 'reversal');
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','again')$$, pg_temp.fx('rev_id')), 'reversal');
select public.bs_check('balance returns', (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'net_paid')::numeric = 0 and (business_setup_quote_balance(pg_temp.fx('q_pay')::uuid) ->> 'outstanding')::numeric = 1000);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('started service stays in progress after reversal', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('pay1')::uuid));
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('pay2')), 'payment');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(pg_temp.fx('part')::jsonb) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_service_update(pg_temp.fx('pay2')::uuid, 'In progress');
select public.bs_check('a net payment lets the next line start again', (select status = 'In progress' from public.business_setup_services where id = pg_temp.fx('pay2')::uuid));
-- a refund cannot be reversed
select public.bs_as(null);
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900002', pg_temp.fx('q_pay')::uuid, current_date, 50, 'Refund');
insert into bs_fx select 'refund_id', id::text from public.business_setup_payments where type = 'Refund' and quote_id = pg_temp.fx('q_pay')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','Mistake')$$, pg_temp.fx('refund_id')), 'reversal');
select public.bs_check('the refused reversals wrote nothing', (select count(*) from public.business_setup_payments where type = 'Reversal' and quote_id = pg_temp.fx('q_pay')::uuid) = 1);
-- a locked quote takes no payment and no reversal
select public.bs_as(null);
update public.business_setup_services set locked = true where id = pg_temp.fx('pay1')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('part')), 'locked');
select public.bs_expect_error(format($$select business_setup_payment_reverse('%s','Late fix')$$, (select id::text from public.business_setup_payments where quote_id = pg_temp.fx('q_pay')::uuid and type = 'Payment' and reference = 'TT-1' and id not in (select reverses_id from public.business_setup_payments where reverses_id is not null))), 'locked');
select public.bs_as(null);
update public.business_setup_services set locked = false where id = pg_temp.fx('pay1')::uuid;
-- overpayment: the override right and a reason
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_pay3', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(jsonb_build_object('service_name','Small job','amount',100,'fee_item_id',pg_temp.zerofee()))))::text);
select public.bs_accept(pg_temp.fx('q_pay3')::uuid) as ignored \gset
insert into bs_fx values ('too_much', jsonb_build_object('quote_id', pg_temp.fx('q_pay3'), 'amount', 130)::text),
  ('too_much_why', jsonb_build_object('quote_id', pg_temp.fx('q_pay3'), 'amount', 130, 'override_reason', 'Client prepaid the renewal')::text),
  ('one_more', jsonb_build_object('quote_id', pg_temp.fx('q_pay3'), 'amount', 1)::text);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('too_much')), 'balance');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_pay3'), 'amount', 130, 'override_reason', '  ')), 'balance');
select public.bs_check('refused overpayments left no row', (select count(*) from public.business_setup_payments where quote_id = pg_temp.fx('q_pay3')::uuid) = 0);
insert into bs_fx select 'over_res', public.business_setup_payment_add(pg_temp.fx('too_much_why')::jsonb)::text;
select public.bs_check('an override accepts the overpayment', (business_setup_quote_balance(pg_temp.fx('q_pay3')::uuid) ->> 'outstanding')::numeric = -30);
select public.bs_check('the overpayment and its reason are in the audit log', public.bs_audit_count('payment_add', (select v::jsonb ->> 'payment_id' from bs_fx where k = 'over_res'), '{"overpayment":true,"reason":"Client prepaid the renewal"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, pg_temp.fx('one_more')), 'balance');
-- an exact payment needs no override
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_pay4', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900002','lines', jsonb_build_array(jsonb_build_object('service_name','Exact job','amount',100,'fee_item_id',pg_temp.zerofee()))))::text);
select public.bs_accept(pg_temp.fx('q_pay4')::uuid) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('q_pay4'), 'amount', 100)) as ignored \gset
select public.bs_check('paying the exact balance clears it', (business_setup_quote_balance(pg_temp.fx('q_pay4')::uuid) ->> 'outstanding')::numeric = 0);
-- receipt files
select public.bs_expect_error(format($$select business_setup_receipt_attach('%s','  ')$$, (select v::jsonb ->> 'receipt_id' from bs_fx where k = 'part_res')), 'path');
select public.bs_expect_error($$select business_setup_receipt_attach('00000000-0000-0000-0000-0000000000ff','a/b.pdf')$$, 'not found');
select public.business_setup_receipt_attach((select (v::jsonb ->> 'receipt_id')::uuid from bs_fx where k = 'part_res'), 'receipts/CL900002/r1.pdf');
select public.bs_check('attach records the file location on the receipt and the register', (select storage_path = 'receipts/CL900002/r1.pdf' from public.business_setup_receipts where id = (select (v::jsonb ->> 'receipt_id')::uuid from bs_fx where k = 'part_res'))
  and exists (select 1 from public.voucher_register where source = 'business_setup' and source_id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res') and storage_path = 'receipts/CL900002/r1.pdf'));
select public.voucher_set_local((select id from public.voucher_register where source = 'business_setup' and source_id = (select (v::jsonb ->> 'payment_id')::uuid from bs_fx where k = 'part_res')), 'D:\x\r1.docx');
select public.bs_check('the PC location reaches the receipt', (select local_path = 'D:\x\r1.docx' from public.business_setup_receipts where id = (select (v::jsonb ->> 'receipt_id')::uuid from bs_fx where k = 'part_res')));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_receipt_attach('%s','a/b.pdf')$$, (select v::jsonb ->> 'receipt_id' from bs_fx where k = 'part_res')), 'permission');
-- reading
select public.bs_check('sales can read the balance', (business_setup_quote_balance(pg_temp.fx('q_pay3')::uuid) ->> 'total')::numeric = 100);
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_quote_balance('%s')$$, pg_temp.fx('q_pay3')), 'permission');
select public.bs_as(null);

-- ── Workspace reads, tasks, files and expiries ──
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL900040', 'Workspace Client LLC', '{"Primary Contact":"Contact One","General Email":"a@b.test","General Phone":"+971500000000"}'),
  ('CL900041', 'No Phone LLC', '{"General Email":"c@d.test"}'),
  ('CL900042', 'Bare Client LLC', '{}'),
  ('CL900043', 'Gone Company LLC', '{}');
insert into public.business_setup_kyc_profiles (client_id, client_status, kyc_state) values ('CL900041', 'Active', 'Done');
insert into public.business_setup_kyc_profiles (client_id, company_status, business_activity, licence_expiry, client_status, kyc_state)
  values ('CL900040', 'New', 'Trading', ((now() at time zone 'Asia/Dubai')::date + 30), 'Active', 'Done');
insert into public.business_setup_kyc_profiles (client_id, licence_expiry, client_status) values ('CL900043', ((now() at time zone 'Asia/Dubai')::date - 400), 'Liquidated');
insert into public.business_setup_kyc_partners (kyc_id, full_name, nationality, passport_number)
  select id, 'Partner One', 'Indian', 'A1234567' from public.business_setup_kyc_profiles where client_id = 'CL900040';
insert into public.business_setup_visas (client_id, person_name, occupation, expiry_date, status) values
  ('CL900040', 'past visa', 'PARTNER', ((now() at time zone 'Asia/Dubai')::date - 1), 'Active'),
  ('CL900040', 'soon visa', 'PARTNER', ((now() at time zone 'Asia/Dubai')::date + 90), 'Active'),
  ('CL900040', 'far visa', 'PARTNER', ((now() at time zone 'Asia/Dubai')::date + 91), 'Active'),
  ('CL900040', 'cancelled visa', 'PARTNER', ((now() at time zone 'Asia/Dubai')::date + 5), 'VISA CANCELLED'),
  ('CL900040', 'no date visa', 'PARTNER', null, 'Active');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx values ('q_ws', pg_temp.bs_quote('Business Setup', jsonb_build_object('client_id','CL900040','lines', jsonb_build_array(
    jsonb_build_object('service_name','WS one','amount',300,'fee_item_id',pg_temp.zerofee()), jsonb_build_object('service_name','WS two','amount',200,'fee_item_id',pg_temp.zerofee()))))::text);
select public.bs_accept(pg_temp.fx('q_ws')::uuid) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('q_ws'), 'amount', 100)) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000c');

create function pg_temp.exp(p_label text) returns jsonb language sql as $$
  select e from jsonb_array_elements(public.business_setup_expiries()) e where e ->> 'label' = p_label
$$;
select public.bs_check('past date state', pg_temp.exp('past visa') ->> 'state' = 'Past date');
select public.bs_check('90 days included', pg_temp.exp('soon visa') ->> 'state' = 'Upcoming');
select public.bs_check('91 days excluded', pg_temp.exp('far visa') is null);
select public.bs_check('a wider window finds it', exists (select 1 from jsonb_array_elements(public.business_setup_expiries(120)) e where e ->> 'label' = 'far visa'));
select public.bs_check('a cancelled visa is not an expiry', pg_temp.exp('cancelled visa') is null);
select public.bs_check('no date, no expiry', pg_temp.exp('no date visa') is null);
select public.bs_check('expiry carries kind, client and date', pg_temp.exp('past visa') ->> 'kind' = 'Visa' and pg_temp.exp('past visa') ->> 'client_id' = 'CL900040' and pg_temp.exp('past visa') ->> 'date' ~ '^\d{4}-\d{2}-\d{2}$');
select public.bs_check('a licence expiry is listed', exists (select 1 from jsonb_array_elements(public.business_setup_expiries()) e where e ->> 'kind' = 'Licence' and e ->> 'client_id' = 'CL900040'));
select public.bs_check('a liquidated company is not chased', not exists (select 1 from jsonb_array_elements(public.business_setup_expiries()) e where e ->> 'client_id' = 'CL900043'));
-- Client Master licence dates are DD/MM/YYYY text; a date that does not parse must not break the list
select public.bs_as(null);
update public.client_master set data = data || '{"License Expiry Date":"not a date"}' where client_id = 'CL900041';
insert into public.client_master (client_id, legal_name, data) values ('CL900044', 'Text Date LLC', jsonb_build_object('License Expiry Date', to_char((now() at time zone 'Asia/Dubai')::date + 10, 'DD/MM/YYYY')));
insert into public.business_setup_kyc_profiles (client_id) values ('CL900044');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('a bad date is skipped, the rest still list', jsonb_array_length(public.business_setup_expiries()) > 0
  and not exists (select 1 from jsonb_array_elements(public.business_setup_expiries()) e where e ->> 'client_id' = 'CL900041'));
select public.bs_check('a Client Master date is read as day first', exists (select 1 from jsonb_array_elements(public.business_setup_expiries()) e where e ->> 'client_id' = 'CL900044' and e ->> 'state' = 'Upcoming'));

create function pg_temp.cl(p_id text) returns jsonb language sql as $$
  select c from jsonb_array_elements(public.business_setup_client_list()) c where c ->> 'client_id' = p_id
$$;
select public.bs_check('missing contact flag', (pg_temp.cl('CL900041') ->> 'missing_contact')::boolean);
select public.bs_check('contact present, no flag', not (pg_temp.cl('CL900040') ->> 'missing_contact')::boolean);
select public.bs_check('list shows state and status', pg_temp.cl('CL900040') ->> 'kyc_state' = 'Done' and pg_temp.cl('CL900040') ->> 'client_status' = 'Active' and pg_temp.cl('CL900040') ->> 'legal_name' = 'Workspace Client LLC');
select public.bs_check('list counts active services', (pg_temp.cl('CL900040') ->> 'active_services')::int = 2);
select public.bs_check('list balance is total less net paid', (pg_temp.cl('CL900040') ->> 'balance')::numeric = 400);
select public.bs_check('a client with no Business Setup record is not listed', pg_temp.cl('CL900042') is null);

select public.bs_check('partner ID masked without sensitive right', public.business_setup_workspace('CL900040')::text !~ 'A1234567');
select public.bs_check('partner still shown when masked', public.business_setup_workspace('CL900040')::text ~ 'Partner One');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('partner ID visible with sensitive right', public.business_setup_workspace('CL900040')::text ~ 'A1234567');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('client with no KYC profile renders', public.business_setup_workspace('CL900042') -> 'client' ->> 'client_id' = 'CL900042' and public.business_setup_workspace('CL900042') -> 'services' = '[]'::jsonb);
select public.bs_expect_error($$select business_setup_workspace('CL999999')$$, 'not found');
select public.bs_check('workspace holds services, quotes and payments', jsonb_array_length(public.business_setup_workspace('CL900040') -> 'services') = 2
  and jsonb_array_length(public.business_setup_workspace('CL900040') -> 'quotes') = 1 and jsonb_array_length(public.business_setup_workspace('CL900040') -> 'payments') = 1);
select public.bs_check('quote carries its balance', (public.business_setup_workspace('CL900040') -> 'quotes' -> 0 -> 'balance' ->> 'outstanding')::numeric = 400);
select public.bs_check('payment carries its receipt number', public.business_setup_workspace('CL900040') -> 'payments' -> 0 ->> 'receipt_number' ~ 'BSR');

-- tasks
select public.bs_expect_error($$select business_setup_task_save('{"client_id":"CL900040","title":"  "}')$$, 'title');
insert into bs_fx select 'task1', public.business_setup_task_save('{"client_id":"CL900040","title":"Chase passport"}')::text;
select public.bs_check('task saved open', (select status = 'Open' from public.business_setup_tasks where id = pg_temp.fx('task1')::uuid));
select public.business_setup_task_save(jsonb_build_object('id', pg_temp.fx('task1'), 'client_id', 'CL900040', 'title', 'Chase passport', 'status', 'Done')) as ignored \gset
select public.bs_check('task updated', (select status = 'Done' from public.business_setup_tasks where id = pg_temp.fx('task1')::uuid));
select public.bs_check('task in workspace', jsonb_array_length(public.business_setup_workspace('CL900040') -> 'tasks') = 1);
select public.bs_check('task change is in the audit log', public.bs_audit_count('task_save', pg_temp.fx('task1'), '{"title":"Chase passport"}') = 2);
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select business_setup_task_save('{"client_id":"CL900040","title":"x"}')$$, 'permission');
select public.bs_expect_error($$select business_setup_workspace('CL900040')$$, 'permission');
select public.bs_expect_error($$select business_setup_client_list()$$, 'permission');
select public.bs_expect_error($$select business_setup_dashboard()$$, 'permission');
select public.bs_expect_error($$select business_setup_expiries()$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000c');

-- documents
select public.bs_expect_error($$select business_setup_document_add('{"client_id":"CL900040","file_name":"a.pdf"}')$$, 'storage');
insert into bs_fx select 'doc1', public.business_setup_document_add('{"client_id":"CL900040","kind":"Licence","file_name":"a.pdf","storage_path":"CL900040/a.pdf"}')::text;
select public.bs_check('document in workspace', public.business_setup_workspace('CL900040') -> 'documents' -> 0 ->> 'file_name' = 'a.pdf');
select public.bs_expect_error(format($$select business_setup_document_add('%s')$$, jsonb_build_object('client_id','CL900041','file_name','b.pdf','storage_path','x/b.pdf','service_id',(select id from public.business_setup_services where name = 'WS one'))), 'service');
select public.bs_as(null);
select public.bs_check('bucket is private', (select not public from storage.buckets where id = 'business-setup-documents'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');

-- dashboard
select public.bs_check('dashboard counts', (public.business_setup_dashboard() ->> 'active_services')::int >= 2 and (public.business_setup_dashboard() ->> 'outstanding')::numeric >= 400
  and (public.business_setup_dashboard() ->> 'accepted_without_letter')::int >= 1 and public.business_setup_dashboard() ? 'open_quotes' and public.business_setup_dashboard() ? 'expiries'
  and public.business_setup_dashboard() ? 'forms_waiting' and public.business_setup_dashboard() ? 'ready_for_accounts' and public.business_setup_dashboard() ? 'reverted_by_accounts');

-- visas
select public.bs_expect_error($$insert into business_setup_visas (client_id, person_name) values ('CL900040', 'direct')$$, 'permission');
select public.bs_check('visa read through the API', (select count(*) from public.business_setup_visas where client_id = 'CL900040') = 5);
select public.bs_check('visas are in the workspace', jsonb_array_length(public.business_setup_workspace('CL900040') -> 'visas') = 5);
select public.bs_as(null);

-- ── Final review fixes ──
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900045', 'Imported Done LLC', '{"General Email":"d@x.test","General Phone":"1","Primary Contact":"D"}');
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL900045', 'Done');
create function pg_temp.noaddr(p_dept text, p_client text default null) returns jsonb language sql as $$
  select jsonb_build_object('doc_type','quote','department',p_dept,'client_id',p_client,'client_name','No Address','contact_name','C','contact_email','c@x.ae','contact_phone','1','lines','[{"description":"Licence","amount":100}]'::jsonb)
$$;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
-- A Business Setup quote needs no address, as the client form does not collect one. Other departments still do.
insert into bs_fx select 'q_noaddr', (public.hub_document_create(pg_temp.noaddr('Business Setup', 'CL900045'))).id::text;
select public.bs_check('a Business Setup quote issues without an address', pg_temp.fx('q_noaddr') is not null);
select public.bs_expect_error(format($$select hub_document_create('%s')$$, pg_temp.noaddr('Accounting')), 'client details');
select public.bs_check('an imported client with KYC done can accept', (public.bs_accept(pg_temp.fx('q_noaddr')::uuid)) is not null);
select public.business_setup_quote_reject(pg_temp.bs_quote('Business Setup', '{"client_id":"CL900045"}'), 'Other work') as ignored \gset
-- Only people with the right can issue a Business Setup quote or letter.
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select hub_document_create('%s')$$, pg_temp.noaddr('Business Setup', 'CL900045')), 'permission');
select public.bs_expect_error(format($$select hub_document_create('%s')$$, jsonb_build_object('doc_type','letter','parent_id',pg_temp.fx('q_noaddr'))), 'permission');
select public.bs_check('another department is unaffected', (public.hub_document_create(pg_temp.noaddr('Accounting') || '{"client_address":"Dubai"}')).id is not null);
-- Refunds
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select business_setup_refund_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 10, 'reason', 'x')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 100)) as ignored \gset
select public.bs_expect_error(format($$select business_setup_refund_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 10)), 'reason');
select public.bs_expect_error(format($$select business_setup_refund_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 101, 'reason', 'x')), 'above');
select public.bs_expect_error(format($$select business_setup_refund_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 0, 'reason', 'x')), 'amount');
insert into bs_fx select 'refund2', public.business_setup_refund_add(jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 40, 'reason', 'Service cancelled'))::text;
select public.bs_check('a refund lowers net paid', (public.business_setup_quote_balance(pg_temp.fx('q_noaddr')::uuid) ->> 'net_paid')::numeric = 60);
select public.bs_check('a refund has no receipt and is in the audit log', not exists (select 1 from public.business_setup_receipts where payment_id = pg_temp.fx('refund2')::uuid) and public.bs_audit_count('refund_add', pg_temp.fx('refund2'), '{"reason":"Service cancelled"}') = 1);
select public.bs_as(null);
update public.business_setup_services set locked = true where quote_id = pg_temp.fx('q_noaddr')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_refund_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_noaddr'), 'amount', 10, 'reason', 'x')), 'Accounts');
select public.bs_as(null);
update public.business_setup_services set locked = false where quote_id = pg_temp.fx('q_noaddr')::uuid;
-- Accounts can open output files.
select public.bs_check('Accounts can read the file bucket', (select qual from pg_policies where policyname = 'business_setup_docs_read') ~ 'accounts.review');
-- Visas can be corrected.
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into bs_fx select 'visa_new', public.business_setup_visa_save('{"client_id":"CL900045","person_name":"New Visa","expiry_date":"2030-01-01","status":"Active"}')::text;
select public.business_setup_visa_save(jsonb_build_object('id', pg_temp.fx('visa_new'), 'client_id','CL900045','person_name','New Visa','expiry_date','2031-01-01','status','Active')) as ignored \gset
select public.bs_check('a visa can be corrected', (select expiry_date = '2031-01-01' from public.business_setup_visas where id = pg_temp.fx('visa_new')::uuid));
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error($$select business_setup_visa_save('{"client_id":"CL900045","person_name":"x"}')$$, 'permission');
select public.bs_as(null);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
