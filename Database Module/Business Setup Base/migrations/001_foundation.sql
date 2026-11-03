-- =====================================================================
-- Business Setup Base - foundation                                  001
-- =====================================================================
-- Business Setup module: staff roles, permissions, settings and the audit trail. Target: PostgreSQL 15+ (the CRM Supabase project).
-- Idempotent: safe to re-run.
--
-- Self-contained access control: business_setup_staff (who holds which role),
-- business_setup_role_permissions and business_setup_user_permissions (overrides). Nothing is
-- shared with Banking's tables, so Banking administrators cannot change Business Setup rights.
-- A person can hold a Banking role and a Business Setup role at the same time.
-- Reuses public.client_master (Client Base 002). There is no second client table.
-- =====================================================================

-- ── Permissions ──────────────────────────────────────────────────────
-- The full list a CRM admin holds. Roles get a subset, seeded below and editable in
-- business_setup_role_permissions. setup.settings.manage is held by admins only.
-- The full list a CRM admin holds. Roles get a subset, seeded below and editable in
-- business_setup_role_permissions. setup.settings.manage is held by admins only.
create or replace function public.business_setup_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage',
    'setup.payments.manage', 'setup.payments.override', 'setup.services.manage', 'setup.services.override',
    'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'setup.settings.manage',
    'kyc.view', 'kyc.manage']
$$;

create table if not exists public.business_setup_staff (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role    text not null check (role in ('ADMIN', 'MANAGER', 'SALES_EXECUTIVE', 'DOCUMENT_EXECUTIVE', 'FINANCE', 'BANKING_EXECUTIVE', 'READ_ONLY')),
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  archived_at timestamptz
);
create index if not exists business_setup_staff_role_idx on public.business_setup_staff (role) where archived_at is null;

create table if not exists public.business_setup_role_permissions (
  role       text not null check (role in ('ADMIN', 'MANAGER', 'SALES_EXECUTIVE', 'DOCUMENT_EXECUTIVE', 'FINANCE', 'BANKING_EXECUTIVE', 'READ_ONLY')),
  permission text not null,
  allowed    boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  archived_at timestamptz,
  primary key (role, permission)
);
create table if not exists public.business_setup_user_permissions (   -- per-user override of the role
  user_id    uuid not null references public.profiles(id) on delete cascade,
  permission text not null,
  allowed    boolean not null,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  archived_at timestamptz,
  primary key (user_id, permission)
);

-- The working default for each role. Client Master reading (kyc.view) goes with every role; editing it (kyc.manage) with KYC work.
insert into public.business_setup_role_permissions (role, permission)
select r.role, p from (values
  ('ADMIN', array['setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage', 'setup.payments.manage', 'setup.payments.override',
    'setup.services.manage', 'setup.services.override', 'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'kyc.view', 'kyc.manage']),
  ('MANAGER', array['setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage', 'setup.payments.manage', 'setup.payments.override',
    'setup.services.manage', 'setup.services.override', 'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'kyc.view', 'kyc.manage']),
  ('SALES_EXECUTIVE', array['setup.access', 'setup.kyc.manage', 'setup.quotes.manage', 'setup.services.manage', 'kyc.view', 'kyc.manage']),
  ('DOCUMENT_EXECUTIVE', array['setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.services.manage', 'kyc.view', 'kyc.manage']),
  ('FINANCE', array['setup.access', 'setup.payments.manage', 'kyc.view']),
  ('BANKING_EXECUTIVE', array['setup.access', 'setup.services.manage', 'kyc.view']),
  ('READ_ONLY', array['setup.access', 'kyc.view'])
) as r(role, perms), unnest(r.perms) as p
on conflict (role, permission) do nothing;

-- CRM admins always pass; a per-user override beats the role.
create or replace function public.business_setup_can(p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select true from profiles where id = auth.uid() and role = 'admin'),
    (select allowed from business_setup_user_permissions where user_id = auth.uid() and permission = p_permission and archived_at is null),
    (select rp.allowed from business_setup_staff s join business_setup_role_permissions rp on rp.role = s.role
      where s.user_id = auth.uid() and s.archived_at is null and rp.permission = p_permission and rp.archived_at is null),
    false)
$$;

-- First line of every write function: refuses with a plain message when the caller lacks the permission.
create or replace function public.business_setup_require(p_permission text) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not business_setup_can(p_permission) then raise exception 'You do not have permission to do this'; end if;
end $$;

create or replace function public.business_setup_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'role', coalesce(
      (select role from business_setup_staff where user_id = auth.uid() and archived_at is null),
      case when (select role from profiles where id = auth.uid()) = 'admin' then 'ADMIN' end),
    'permissions', coalesce((select jsonb_agg(p order by p) from unnest(business_setup_permissions()) p where business_setup_can(p)), '[]'::jsonb))
$$;

-- ── Tables ───────────────────────────────────────────────────────────
create table if not exists public.business_setup_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid,
  archived_at timestamptz
);

-- Append-only. Written only by business_setup_audit().
create table if not exists public.business_setup_audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor       uuid,
  table_name  text not null,
  row_id      text,
  action      text not null,
  old_data    jsonb,
  new_data    jsonb
);
create index if not exists business_setup_audit_row_idx on public.business_setup_audit_log (table_name, row_id, occurred_at desc);
create index if not exists business_setup_audit_time_idx on public.business_setup_audit_log (occurred_at desc);

-- ── Audit trail, touch and append-only triggers ──────────────────────
create or replace function public.business_setup_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- Other migrations and workflow functions call this to record an event. Not callable from the API.
create or replace function public.business_setup_audit(p_table text, p_row text, p_action text, p_old jsonb, p_new jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into business_setup_audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (auth.uid(), p_table, p_row, p_action, p_old, p_new);
end $$;

create or replace function public.business_setup_audit_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  masked text[] := array['passport_number', 'emirates_id', 'passport_expiry', 'residential_address', 'identifier_value'];
  k text;
  row_key text;
begin
  foreach k in array masked loop
    if o ? k then o := o || jsonb_build_object(k, '***'); end if;
    if n ? k then n := n || jsonb_build_object(k, '***'); end if;
  end loop;
  row_key := coalesce(coalesce(n ->> 'role', n ->> 'user_id', o ->> 'role', o ->> 'user_id') || ':' || coalesce(n ->> 'permission', o ->> 'permission'),
    n ->> 'id', n ->> 'key', n ->> 'user_id', n ->> 'client_id', o ->> 'id', o ->> 'key', o ->> 'user_id', o ->> 'client_id');
  if tg_op = 'UPDATE' then
    perform business_setup_audit(tg_table_name, row_key, tg_op,
      (select jsonb_object_agg(e.key, e.value) from jsonb_each(o) e where (n -> e.key) is distinct from e.value and e.key not in ('updated_at', 'updated_by')),
      (select jsonb_object_agg(e.key, e.value) from jsonb_each(n) e where (o -> e.key) is distinct from e.value and e.key not in ('updated_at', 'updated_by')));
  else
    perform business_setup_audit(tg_table_name, row_key, tg_op, o, n);
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.business_setup_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% is append-only: add a new record instead of changing history', tg_table_name;
end $$;

drop trigger if exists business_setup_audit_log_immutable on public.business_setup_audit_log;
create trigger business_setup_audit_log_immutable before update or delete on public.business_setup_audit_log
  for each row execute function public.business_setup_append_only();
drop trigger if exists business_setup_audit_log_no_truncate on public.business_setup_audit_log;
create trigger business_setup_audit_log_no_truncate before truncate on public.business_setup_audit_log
  for each statement execute function public.business_setup_append_only();

do $$
declare t text;
begin
  foreach t in array array['business_setup_settings', 'business_setup_staff', 'business_setup_role_permissions', 'business_setup_user_permissions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.business_setup_touch()', t || '_touch', t);
  end loop;
  foreach t in array array['business_setup_settings', 'business_setup_staff', 'business_setup_role_permissions', 'business_setup_user_permissions'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.business_setup_audit_trg()', t || '_audit', t);
  end loop;
end $$;

-- ── Settings ─────────────────────────────────────────────────────────
create or replace function public.business_setup_settings_save(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.settings.manage');
  if nullif(trim(p_key), '') is null then raise exception 'A setting name is required'; end if;
  if p_value is null then raise exception 'A setting needs a value'; end if;
  insert into business_setup_settings (key, value) values (trim(p_key), p_value)
  on conflict (key) do update set value = excluded.value, archived_at = null;
  return p_value;
end $$;

-- ── Row-level security and grants ────────────────────────────────────
alter table public.business_setup_settings enable row level security;
alter table public.business_setup_staff enable row level security;
alter table public.business_setup_audit_log enable row level security;
alter table public.business_setup_role_permissions enable row level security;
alter table public.business_setup_user_permissions enable row level security;

do $$
declare
  rules text[][] := array[
    -- table, read permission, write permission (null: functions only)
    ['business_setup_settings', 'setup.access', null],
    ['business_setup_staff', 'setup.access', 'setup.settings.manage'],
    ['business_setup_audit_log', 'setup.audit.view', null],
    ['business_setup_role_permissions', 'setup.access', 'setup.settings.manage'],
    ['business_setup_user_permissions', 'setup.access', 'setup.settings.manage']
  ];
  i int; t text; r text; w text;
begin
  for i in 1 .. array_length(rules, 1) loop
    t := rules[i][1]; r := rules[i][2]; w := rules[i][3];
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.business_setup_can(%L))', t || '_read', t, r);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    -- Supabase default privileges include TRUNCATE, which bypasses RLS: start from nothing.
    execute format('revoke all on public.%I from anon, authenticated', t);
    if w is not null then
      execute format('create policy %I on public.%I for all to authenticated using (public.business_setup_can(%L)) with check (public.business_setup_can(%L))', t || '_write', t, w, w);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    else
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

revoke all on function public.business_setup_audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.business_setup_audit_trg() from public, anon, authenticated;
revoke all on function public.business_setup_can(text), public.business_setup_require(text), public.business_setup_my_access(), public.business_setup_settings_save(text, jsonb) from public, anon;
grant execute on function public.business_setup_can(text), public.business_setup_require(text), public.business_setup_my_access(), public.business_setup_settings_save(text, jsonb) to authenticated;
