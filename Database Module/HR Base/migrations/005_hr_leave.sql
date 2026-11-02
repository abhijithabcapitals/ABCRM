-- =====================================================================
-- HR Base - leave                                                  005
-- =====================================================================
-- hr_settings (one row: weekend days, payroll pay-days basis), hr_holidays, hr_leave_types, hr_leave_balances, hr_leave_requests.
-- No statutory values are stored: hr_leave_types starts empty, weekend_days defaults to {0,6} (extract(dow): 0 = Sunday) and is
-- editable by HR, pay_days_basis is null until confirmed.
-- Requests are written only by functions (direct writes denied). A request that spans a year end is split into one row per year.
-- Balance is derived: entitlement + adjustment - approved days in that year. Only 'pending' can be decided; 'pending' or
-- 'approved' can be cancelled by HR or the employee. Nobody decides their own leave. A manager decides for direct reports; HR for all.
-- hr_dashboard() is redefined to count pending leave (HR all, manager reports, employee own).
-- Requires 002 (access helpers, hr_audit), 003 (hr_touch), 004 (hr_documents_expiring). Idempotent.
-- =====================================================================
create table if not exists public.hr_settings (
  id int primary key default 1 check (id = 1),
  weekend_days int[] not null default '{0,6}' check (weekend_days <@ array[0,1,2,3,4,5,6]),
  pay_days_basis numeric check (pay_days_basis is null or pay_days_basis > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
insert into public.hr_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.hr_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.hr_leave_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  paid boolean not null default true,
  annual_days numeric check (annual_days is null or annual_days >= 0),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.hr_leave_balances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id) on delete cascade,
  year int not null,
  entitlement numeric not null check (entitlement >= 0),
  adjustment numeric not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (employee_id, leave_type_id, year)
);

create table if not exists public.hr_leave_requests (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  leave_type_id uuid not null references public.hr_leave_types(id),
  from_date date not null,
  to_date date not null,
  days numeric not null check (days > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  note text,
  approver uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  check (to_date >= from_date),
  check (extract(year from from_date) = extract(year from to_date))
);
create index if not exists hr_leave_requests_employee_idx on public.hr_leave_requests (employee_id, from_date);
create index if not exists hr_leave_requests_status_idx on public.hr_leave_requests (status);

do $do$
declare t text;
begin
  foreach t in array array['hr_settings', 'hr_holidays', 'hr_leave_types', 'hr_leave_balances', 'hr_leave_requests'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.hr_touch()', t || '_touch', t);
  end loop;
end $do$;

-- ── RLS and grants ──
alter table public.hr_settings enable row level security;
alter table public.hr_holidays enable row level security;
alter table public.hr_leave_types enable row level security;
alter table public.hr_leave_balances enable row level security;
alter table public.hr_leave_requests enable row level security;
revoke all on public.hr_settings, public.hr_holidays, public.hr_leave_types, public.hr_leave_balances, public.hr_leave_requests from public, anon, authenticated;
grant select, update on public.hr_settings to authenticated;
grant select, insert, update, delete on public.hr_holidays, public.hr_leave_types, public.hr_leave_balances to authenticated;
grant select on public.hr_leave_requests to authenticated;

-- settings, holidays, types: readable by HR and anyone linked to an employee; writable by HR only
do $do$
declare t text;
begin
  foreach t in array array['hr_settings', 'hr_holidays', 'hr_leave_types'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.hr_is_admin_or_hr() or public.hr_my_employee_id() is not null)', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_hr', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr())', t || '_hr', t);
  end loop;
end $do$;

drop policy if exists hr_leave_balances_hr on public.hr_leave_balances;
create policy hr_leave_balances_hr on public.hr_leave_balances for all to authenticated
  using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());
drop policy if exists hr_leave_balances_read on public.hr_leave_balances;
create policy hr_leave_balances_read on public.hr_leave_balances for select to authenticated
  using (employee_id = public.hr_my_employee_id() or public.hr_manages(employee_id));

drop policy if exists hr_leave_requests_read on public.hr_leave_requests;
create policy hr_leave_requests_read on public.hr_leave_requests for select to authenticated
  using (public.hr_is_admin_or_hr() or employee_id = public.hr_my_employee_id() or public.hr_manages(employee_id));
-- no write policy and no write grant on hr_leave_requests

-- ── functions ──
-- Working days in a range: not a configured weekend day, not a holiday. Whole days only.
create or replace function public.hr_leave_days(p_from date, p_to date) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare wk int[]; n numeric;
begin
  if p_from is null or p_to is null then raise exception 'Both dates are required'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  select s.weekend_days into wk from public.hr_settings s where s.id = 1;
  select count(*) into n
  from generate_series(p_from, p_to, interval '1 day') g(d)
  where not (extract(dow from g.d)::int = any (coalesce(wk, '{0,6}')))
    and not exists (select 1 from public.hr_holidays h where h.holiday_date = g.d::date);
  return n;
end $$;

drop function if exists public.hr_leave_balance(uuid, int); -- 010 adds a column; create or replace cannot change a return type
-- Balance per leave type for one employee and year. HR any; manager direct reports; employee own.
create or replace function public.hr_leave_balance(p_employee uuid, p_year int)
returns table (leave_type_id uuid, leave_type text, paid boolean, year int, entitlement numeric, adjustment numeric, used numeric, pending numeric, remaining numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not (public.hr_is_admin_or_hr() or p_employee is not distinct from public.hr_my_employee_id() or public.hr_manages(p_employee)) then
    raise exception 'You are not allowed to see this balance';
  end if;
  return query
  select t.id, t.name, t.paid, p_year,
         coalesce(b.entitlement, t.annual_days),
         coalesce(b.adjustment, 0),
         coalesce((select sum(r.days) from public.hr_leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'approved' and extract(year from r.from_date) = p_year), 0),
         coalesce((select sum(r.days) from public.hr_leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'pending' and extract(year from r.from_date) = p_year), 0),
         case when t.paid and coalesce(b.entitlement, t.annual_days) is not null then
           coalesce(b.entitlement, t.annual_days) + coalesce(b.adjustment, 0)
           - coalesce((select sum(r.days) from public.hr_leave_requests r where r.employee_id = p_employee and r.leave_type_id = t.id and r.status = 'approved' and extract(year from r.from_date) = p_year), 0)
         end
  from public.hr_leave_types t
  left join public.hr_leave_balances b on b.employee_id = p_employee and b.leave_type_id = t.id and b.year = p_year
  order by t.name;
end $$;

-- Files a request. Returns {ids: [uuid], warning: text|null}. A range over a year end is split into one row per year.
-- A paid request beyond the remaining balance still goes through (HR decides) and returns a warning.
create or replace function public.hr_leave_request(p_employee uuid, p_type uuid, p_from date, p_to date, p_note text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  ty public.hr_leave_types%rowtype; emp public.hr_employees%rowtype;
  y int; seg_from date; seg_to date; d numeric; total numeric := 0; rem numeric;
  ids uuid[] := '{}'; new_id uuid; warns text[] := '{}';
begin
  select * into emp from public.hr_employees where id = p_employee;
  if not found then raise exception 'Employee not found'; end if;
  if not (public.hr_is_admin_or_hr() or p_employee is not distinct from public.hr_my_employee_id()) then
    raise exception 'You can request leave only for yourself. Ask HR to enter it for someone else';
  end if;
  if emp.status = 'Left' then raise exception 'This employee has left'; end if;
  select * into ty from public.hr_leave_types where id = p_type;
  if not found then raise exception 'Leave type not found'; end if;
  if p_from is null or p_to is null then raise exception 'Both dates are required'; end if;
  if p_to < p_from then raise exception 'The end date is before the start date'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text, 0));
  if exists (select 1 from public.hr_leave_requests r
             where r.employee_id = p_employee and r.status in ('pending', 'approved') and r.from_date <= p_to and r.to_date >= p_from) then
    raise exception 'This overlaps an existing leave request for the same employee';
  end if;
  for y in extract(year from p_from)::int .. extract(year from p_to)::int loop
    seg_from := greatest(p_from, make_date(y, 1, 1));
    seg_to := least(p_to, make_date(y, 12, 31));
    d := public.hr_leave_days(seg_from, seg_to);
    continue when d = 0;
    total := total + d;
    insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, note)
    values (p_employee, p_type, seg_from, seg_to, d, p_note) returning id into new_id;
    ids := ids || new_id;
    if ty.paid then
      select b.remaining into rem from public.hr_leave_balance(p_employee, y) b where b.leave_type_id = p_type;
      if rem is not null and d > rem then
        warns := warns || format('%s %s: %s day(s) requested, %s remaining', ty.name, y, d, rem);
      end if;
    end if;
  end loop;
  if total = 0 then raise exception 'There are no working days in that range'; end if;
  return jsonb_build_object('ids', to_jsonb(ids), 'warning', case when array_length(warns, 1) > 0 then array_to_string(warns, '; ') end);
end $$;

drop function if exists public.hr_leave_decide(uuid, boolean, text); -- 008 returns jsonb; create or replace cannot change a return type
-- Approve or reject a pending request. HR any; a manager for direct reports. Nobody decides their own.
create or replace function public.hr_leave_decide(p_request uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_leave_requests%rowtype; new_status text;
begin
  select * into r from public.hr_leave_requests where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if r.employee_id is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot decide your own leave';
  end if;
  if not (public.hr_is_admin_or_hr() or public.hr_manages(r.employee_id)) then
    raise exception 'You are not allowed to decide this request';
  end if;
  if r.status <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', r.status; end if;
  new_status := case when p_approve then 'approved' else 'rejected' end;
  update public.hr_leave_requests set status = new_status, approver = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
  perform public.hr_audit('leave.' || new_status, 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', new_status, 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days, 'note', p_note));
end $$;

drop function if exists public.hr_leave_cancel(uuid); -- 008 returns jsonb
-- Cancel a pending or approved request. HR or the employee. Cancelling an approved one restores the balance (balance is derived).
create or replace function public.hr_leave_cancel(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.hr_leave_requests%rowtype;
begin
  select * into r from public.hr_leave_requests where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if not (public.hr_is_admin_or_hr() or r.employee_id is not distinct from public.hr_my_employee_id()) then
    raise exception 'You are not allowed to cancel this request';
  end if;
  if r.status not in ('pending', 'approved') then raise exception 'A % request cannot be cancelled', r.status; end if;
  update public.hr_leave_requests set status = 'cancelled' where id = p_request;
  perform public.hr_audit('leave.cancelled', 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', 'cancelled', 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days));
end $$;

-- Dashboard: same keys and scoping as 004; pending_leave is now real.
create or replace function public.hr_dashboard() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'headcount', (select count(*) from public.hr_employees e
                  where e.status <> 'Left'
                    and (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))),
    'present_today', 0,
    'pending_leave', (select count(*) from public.hr_leave_requests r
                      where r.status = 'pending'
                        and (public.hr_is_admin_or_hr() or r.employee_id = public.hr_my_employee_id() or public.hr_manages(r.employee_id))),
    'expiring_documents', (select count(*) from public.hr_documents_expiring())
  )
$$;

revoke all on function public.hr_leave_days(date, date), public.hr_leave_balance(uuid, int), public.hr_leave_request(uuid, uuid, date, date, text),
  public.hr_leave_decide(uuid, boolean, text), public.hr_leave_cancel(uuid), public.hr_dashboard() from public, anon, authenticated;
grant execute on function public.hr_leave_days(date, date), public.hr_leave_balance(uuid, int), public.hr_leave_request(uuid, uuid, date, date, text),
  public.hr_leave_decide(uuid, boolean, text), public.hr_leave_cancel(uuid), public.hr_dashboard() to authenticated;
