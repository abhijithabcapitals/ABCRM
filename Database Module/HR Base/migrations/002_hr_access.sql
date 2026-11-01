-- =====================================================================
-- HR Base - access model                                           002
-- =====================================================================
-- Admin (profiles.role = 'admin') and the HR list (hr_access) see and change everything.
-- A manager reads direct reports' job details. An employee reads their own row and personal details.
-- Personal details live in their own table so managers cannot read them. Audit log is append-only and
-- written only through hr_audit(). Helpers are security definer so policies never recurse. Idempotent.
-- Requires 001 (hr_employees, admin_is).
-- =====================================================================
alter table public.hr_employees add column if not exists manager_id uuid references public.hr_employees(id) on delete set null;
alter table public.hr_employees add column if not exists exit_date date;
create index if not exists hr_employees_manager_idx on public.hr_employees (manager_id);

create table if not exists public.hr_access (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null default auth.uid(),
  granted_at timestamptz not null default now()
);

create table if not exists public.hr_audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  action text not null,
  target text not null,
  old_values jsonb,
  new_values jsonb
);

create table if not exists public.hr_employee_personal (
  employee_id uuid primary key references public.hr_employees(id) on delete cascade,
  date_of_birth date,
  nationality text,
  address text,
  emergency_contact text
);

-- ── helpers ──
create or replace function public.hr_is_admin_or_hr() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.admin_is() or exists (select 1 from public.hr_access a where a.profile_id = auth.uid())
$$;

create or replace function public.hr_my_employee_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.hr_employees e where e.profile_id = auth.uid()
$$;

create or replace function public.hr_manages(p_employee uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.hr_employees e
    where e.id = p_employee and e.manager_id is not null and e.manager_id = public.hr_my_employee_id()
  )
$$;

create or replace function public.hr_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'role', case
      when public.hr_is_admin_or_hr() then 'hr'
      when exists (select 1 from public.hr_employees r where r.manager_id = public.hr_my_employee_id()) then 'manager'
      when public.hr_my_employee_id() is not null then 'employee'
      else 'none' end,
    'employee_id', public.hr_my_employee_id())
$$;

create or replace function public.hr_audit(p_action text, p_target text, p_old jsonb, p_new jsonb) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.hr_audit_log (actor, action, target, old_values, new_values)
  values (auth.uid(), p_action, p_target, p_old, p_new)
$$;

-- hr_audit is for other security definer functions (which run as the owner). Users cannot forge entries.
revoke all on function public.hr_is_admin_or_hr(), public.hr_my_employee_id(), public.hr_manages(uuid), public.hr_my_access(),
  public.hr_audit(text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.hr_is_admin_or_hr(), public.hr_my_employee_id(), public.hr_manages(uuid), public.hr_my_access() to authenticated;

-- ── audit log is append-only, even for the owner ──
create or replace function public.hr_audit_log_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'hr_audit_log is append-only';
end $$;
drop trigger if exists hr_audit_log_no_change on public.hr_audit_log;
create trigger hr_audit_log_no_change before update or delete on public.hr_audit_log
  for each row execute function public.hr_audit_log_immutable();
drop trigger if exists hr_audit_log_no_truncate on public.hr_audit_log;
create trigger hr_audit_log_no_truncate before truncate on public.hr_audit_log
  for each statement execute function public.hr_audit_log_immutable();

-- ── RLS and grants ──
alter table public.hr_access enable row level security;
alter table public.hr_audit_log enable row level security;
alter table public.hr_employee_personal enable row level security;

revoke all on public.hr_access, public.hr_audit_log, public.hr_employee_personal from public, anon, authenticated;
grant select, insert, delete on public.hr_access to authenticated;
grant select on public.hr_audit_log to authenticated;
grant select, insert, update, delete on public.hr_employee_personal to authenticated;

-- hr_employees: 001's hr_employees_admin stays; add HR list, self and manager.
drop policy if exists hr_employees_hr on public.hr_employees;
create policy hr_employees_hr on public.hr_employees for all to authenticated
  using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());
drop policy if exists hr_employees_self on public.hr_employees;
create policy hr_employees_self on public.hr_employees for select to authenticated using (profile_id = auth.uid());
drop policy if exists hr_employees_manager on public.hr_employees;
create policy hr_employees_manager on public.hr_employees for select to authenticated using (public.hr_manages(id));

-- hr_access: only admin changes the list; members can see their own entry.
drop policy if exists hr_access_admin on public.hr_access;
create policy hr_access_admin on public.hr_access for all to authenticated using (public.admin_is()) with check (public.admin_is());
drop policy if exists hr_access_self on public.hr_access;
create policy hr_access_self on public.hr_access for select to authenticated using (profile_id = auth.uid());

-- hr_audit_log: HR and admin read. No insert/update/delete policy or grant.
drop policy if exists hr_audit_log_read on public.hr_audit_log;
create policy hr_audit_log_read on public.hr_audit_log for select to authenticated using (public.hr_is_admin_or_hr());

-- hr_employee_personal: HR and admin everything, the employee reads their own. Managers get nothing.
drop policy if exists hr_employee_personal_hr on public.hr_employee_personal;
create policy hr_employee_personal_hr on public.hr_employee_personal for all to authenticated
  using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());
drop policy if exists hr_employee_personal_self on public.hr_employee_personal;
create policy hr_employee_personal_self on public.hr_employee_personal for select to authenticated
  using (employee_id = public.hr_my_employee_id());
