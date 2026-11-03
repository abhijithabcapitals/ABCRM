-- =====================================================================
-- HR Base - calendar marks                                         011
-- =====================================================================
-- Names on the attendance calendar that are not holidays: UAE Islamic holidays until their dates are announced, and India's main festivals.
-- A mark changes nothing: attendance, pay and leave read only hr_holidays. hr_calendar_mark_confirm turns a UAE mark into a holiday on the announced date.
-- Read: HR and anyone linked to an employee. Write: HR only. Idempotent. Requires 005 (hr_holidays, hr_touch).
-- =====================================================================
create table if not exists public.hr_calendar_marks (
  id uuid primary key default gen_random_uuid(),
  mark_date date not null,
  name text not null,
  region text not null check (region in ('UAE', 'India')),
  source text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  unique (mark_date, name)
);
create index if not exists hr_calendar_marks_date_idx on public.hr_calendar_marks (mark_date);

drop trigger if exists hr_calendar_marks_touch on public.hr_calendar_marks;
create trigger hr_calendar_marks_touch before update on public.hr_calendar_marks for each row execute function public.hr_touch();

alter table public.hr_calendar_marks enable row level security;
revoke all on public.hr_calendar_marks from public, anon, authenticated;
grant select, insert, update, delete on public.hr_calendar_marks to authenticated;
drop policy if exists hr_calendar_marks_read on public.hr_calendar_marks;
create policy hr_calendar_marks_read on public.hr_calendar_marks for select to authenticated using (public.hr_is_admin_or_hr() or public.hr_my_employee_id() is not null);
drop policy if exists hr_calendar_marks_hr on public.hr_calendar_marks;
create policy hr_calendar_marks_hr on public.hr_calendar_marks for all to authenticated using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());

-- The announced date may differ from the mark's. A date that is already a holiday keeps both names, as when Eid meets National Day.
create or replace function public.hr_calendar_mark_confirm(p_mark uuid, p_date date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.hr_calendar_marks%rowtype;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can confirm a holiday'; end if;
  if p_date is null then raise exception 'The date is required'; end if;
  select * into m from public.hr_calendar_marks where id = p_mark;
  if not found then raise exception 'This mark no longer exists'; end if;
  if m.region <> 'UAE' then raise exception 'Only a UAE mark can become a public holiday'; end if;
  insert into public.hr_holidays (holiday_date, name) values (p_date, m.name)
  on conflict (holiday_date) do update set name = public.hr_holidays.name || ' / ' || excluded.name;
  delete from public.hr_calendar_marks where id = p_mark;
end $$;
revoke all on function public.hr_calendar_mark_confirm(uuid, date) from public, anon, authenticated;
grant execute on function public.hr_calendar_mark_confirm(uuid, date) to authenticated;
