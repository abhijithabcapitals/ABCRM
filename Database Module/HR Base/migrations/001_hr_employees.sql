-- =====================================================================
-- HR Base - employee records                                       001
-- =====================================================================
-- One row per employee. A CRM member is onboarded from a row here, which links the login to the employee code.
-- Read and write: CRM admins. Idempotent.
-- =====================================================================
create table if not exists public.hr_employees (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,
  full_name text not null,
  work_email text,
  phone text,
  department text,
  designation text,
  join_date date,
  status text not null default 'Active' check (status in ('Active', 'On Leave', 'Left')),
  profile_id uuid unique references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.admin_is() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin')
$$;
revoke all on function public.admin_is() from public, anon;
grant execute on function public.admin_is() to authenticated;

alter table public.hr_employees enable row level security;
revoke all on public.hr_employees from public, anon, authenticated;
grant select, insert, update, delete on public.hr_employees to authenticated;
drop policy if exists hr_employees_admin on public.hr_employees;
create policy hr_employees_admin on public.hr_employees for all to authenticated using (admin_is()) with check (admin_is());
