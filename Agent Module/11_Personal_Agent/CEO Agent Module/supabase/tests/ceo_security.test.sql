begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(12);

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000011',
    'authenticated', 'authenticated', 'ceo-rls-owner@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    'authenticated', 'authenticated', 'ceo-rls-other@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
  );

insert into ceo.captures (user_id, idempotency_key, input_text)
values
  (
    '00000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000011',
    'Owner-only test capture'
  ),
  (
    '00000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000012',
    'Other-user test capture'
  );

select extensions.ok(
  (select count(*) = 26
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'ceo'
      and c.relkind = 'r'
      and c.relrowsecurity),
  'RLS is enabled on every CEO table'
);

select extensions.ok(
  has_table_privilege('authenticated', 'ceo.captures', 'select'),
  'authenticated users can use the RLS-protected capture table'
);

select extensions.ok(
  not has_table_privilege('anon', 'ceo.captures', 'select'),
  'anonymous users have no capture table grant'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'ceo.profiles', 'insert'),
  'users cannot provision or elevate their own profile'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'ceo.audit_logs', 'update')
  and not has_table_privilege('authenticated', 'ceo.audit_logs', 'delete'),
  'audit log rows cannot be changed or deleted by browser users'
);

select extensions.ok(
  not has_table_privilege('authenticated', 'ceo.agent_registry', 'insert')
  and not has_table_privilege('authenticated', 'ceo.agent_permissions', 'update'),
  'browser users cannot enable agents or grant agent permissions'
);

select extensions.ok(
  has_table_privilege('authenticated', 'ceo.captures', 'insert')
  and not has_table_privilege('authenticated', 'ceo.captures', 'update'),
  'browser users may submit captures but cannot forge their processing state'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-4000-8000-000000000011',
  true
);

select extensions.is(
  (select count(*) from ceo.captures),
  1::bigint,
  'a signed-in user can read their own capture'
);

select extensions.is(
  (select count(*) from ceo.captures where user_id = '00000000-0000-4000-8000-000000000012'),
  0::bigint,
  'a signed-in user cannot read another user capture'
);

select extensions.throws_ok(
  $$
    insert into ceo.captures (user_id, idempotency_key, input_text)
    values (
      '00000000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000013',
      'Cross-user write must fail'
    )
  $$,
  '42501',
  null,
  'a signed-in user cannot write a capture for another user'
);

insert into ceo.captures (user_id, idempotency_key, input_text)
values (
  '00000000-0000-4000-8000-000000000011',
  '10000000-0000-4000-8000-000000000014',
  'Permitted owner capture'
);

select extensions.is(
  (select count(*) from ceo.captures),
  2::bigint,
  'a signed-in user can insert a capture for themselves'
);

reset role;

select extensions.ok(
  (select public = false from storage.buckets where id = 'ceo-captures')
  and not exists (
    select 1
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname like 'ceo_capture_objects_%'
  ),
  'audio storage remains private and inaccessible until retention is configured'
);

select * from extensions.finish();
rollback;
