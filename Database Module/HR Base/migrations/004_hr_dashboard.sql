-- =====================================================================
-- HR Base - dashboard and employee task view                       004
-- =====================================================================
-- hr_employee_tasks(): open tasks per employee, matched by profiles.full_name = any(tasks.assignees) because tasks store assignee
-- names as text. Returns only the listed columns. HR/admin: every employee. Manager: self and direct reports. Employee: self.
-- hr_dashboard(): headcount, present_today, pending_leave, expiring_documents, scoped the same way.
-- Leave and attendance tables do not exist yet, so present_today and pending_leave stay 0 until those tasks update this function.
-- Requires 002 (access helpers) and 003 (hr_documents_expiring). Idempotent.
--
-- "Open" test: a task is closed when date_done or date_closed is set, or when its status is a Complete status in
-- space_statuses. The status is looked up by name at the most specific scope that defines it (list, then folder, then space).
-- An Auto status (status_category null and is_complete null) has no say, so only the dates decide. The dates alone are not enough:
-- the app writes date_done only for a status literally named "Done" and date_closed only for names like cancel/closed/rejected.
-- =====================================================================
create or replace function public.hr_employee_tasks()
returns table (
  employee_id uuid, employee_name text, task_id uuid, title text, status text, priority text, due_date date,
  overdue boolean, space_id uuid, folder_id uuid, list_id uuid, duplicate_name boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  select e.id, e.full_name, t.id, t.title, t.status, t.priority, t.due_date,
         coalesce(t.due_date < (now() at time zone 'Asia/Dubai')::date, false),
         coalesce(t.space_id, l.space_id), coalesce(t.folder_id, l.folder_id), t.list_id,
         (select count(*) > 1
            from public.hr_employees e2
            join public.profiles p2 on p2.id = e2.profile_id
            where p2.full_name = p.full_name)
  from public.hr_employees e
  join public.profiles p on p.id = e.profile_id
  join public.tasks t on p.full_name = any (t.assignees)
  left join public.lists l on l.id = t.list_id
  left join lateral (
    select s.is_complete, s.status_category
    from public.space_statuses s
    where lower(s.name) = lower(t.status)
      and (   s.list_id = t.list_id
           or (s.list_id is null and s.folder_id is not null and s.folder_id = coalesce(t.folder_id, l.folder_id))
           or (s.list_id is null and s.folder_id is null and s.space_id = coalesce(t.space_id, l.space_id)))
    order by (s.list_id is not null) desc, (s.folder_id is not null) desc
    limit 1
  ) st on true
  where e.status <> 'Left'
    and t.deleted_at is null
    and t.date_done is null
    and t.date_closed is null
    and not (coalesce(st.status_category = 'complete', st.is_complete, false))
    and (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))
  order by 8 desc, t.due_date nulls last, e.full_name, t.title
$$;
revoke all on function public.hr_employee_tasks() from public, anon, authenticated;
grant execute on function public.hr_employee_tasks() to authenticated;

create or replace function public.hr_dashboard() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'headcount', (select count(*) from public.hr_employees e
                  where e.status <> 'Left'
                    and (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))),
    'present_today', 0,
    'pending_leave', 0,
    'expiring_documents', (select count(*) from public.hr_documents_expiring())
  )
$$;
revoke all on function public.hr_dashboard() from public, anon, authenticated;
grant execute on function public.hr_dashboard() to authenticated;
