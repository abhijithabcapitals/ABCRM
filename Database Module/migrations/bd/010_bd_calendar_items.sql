-- Business Development calendar: deadlines, meetings, tasks, conversion targets and
-- reminders, optionally linked to a lead and assigned to a person. Shown on the
-- Lead Calendar page together with the leads' follow-ups.
begin;

create table if not exists public.bd_calendar_items (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  kind text not null default 'deadline' check (kind in ('deadline', 'meeting', 'task', 'milestone', 'reminder')),
  starts_at timestamptz not null,
  ends_at timestamptz check (ends_at is null or ends_at > starts_at),
  all_day boolean not null default false,
  lead_id uuid references public.bd_leads(id) on delete cascade,
  assigned_to uuid references public.profiles(id) on delete set null,
  notes text check (notes is null or char_length(notes) <= 4000),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bd_calendar_items_starts_idx on public.bd_calendar_items (starts_at);
create index if not exists bd_calendar_items_lead_idx on public.bd_calendar_items (lead_id) where lead_id is not null;

create or replace function public.bd_calendar_items_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.created_by := old.created_by;
  if new.status = 'done' and old.status <> 'done' then new.completed_at := now(); end if;
  if new.status <> 'done' then new.completed_at := null; end if;
  return new;
end $$;
drop trigger if exists bd_calendar_items_touch on public.bd_calendar_items;
create trigger bd_calendar_items_touch before update on public.bd_calendar_items
  for each row execute function public.bd_calendar_items_touch();

alter table public.bd_calendar_items enable row level security;
revoke all on public.bd_calendar_items from anon, public;
grant select, insert, update, delete on public.bd_calendar_items to authenticated;
grant all on public.bd_calendar_items to service_role;

-- Everyone with a BD role sees general items and items of the leads they can see.
drop policy if exists bd_calendar_items_read on public.bd_calendar_items;
create policy bd_calendar_items_read on public.bd_calendar_items for select to authenticated
  using (public.bd_current_role() is not null and (lead_id is null or public.bd_can_view_lead(lead_id)));

-- BD staff who can work leads create items; managers, the creator and the assignee change them.
drop policy if exists bd_calendar_items_insert on public.bd_calendar_items;
create policy bd_calendar_items_insert on public.bd_calendar_items for insert to authenticated
  with check (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
    and created_by = auth.uid()
    and (lead_id is null or public.bd_can_view_lead(lead_id))
  );

drop policy if exists bd_calendar_items_update on public.bd_calendar_items;
create policy bd_calendar_items_update on public.bd_calendar_items for update to authenticated
  using (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader')
    or (public.bd_current_role() in ('sales_executive', 'marketing_executive') and auth.uid() in (created_by, assigned_to))
  )
  with check (lead_id is null or public.bd_can_view_lead(lead_id));

drop policy if exists bd_calendar_items_delete on public.bd_calendar_items;
create policy bd_calendar_items_delete on public.bd_calendar_items for delete to authenticated
  using (
    public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader')
    or (public.bd_current_role() in ('sales_executive', 'marketing_executive') and created_by = auth.uid())
  );

notify pgrst, 'reload schema';

commit;
