-- Open alerts by due date for the calendar. Assigned ones for most people, all for managers and admins.
-- alert_can_see still applies, so nobody but admins gets anything in Preview.
create or replace function public.alert_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to see the calendar.'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range.'; end if;
  if p_to - p_from > 400 then raise exception 'Choose a range of at most 400 days.'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title, 'due_date', x.due_date, 'priority', x.priority) order by x.due_date, x.id)
    from (
      select a.id, a.title, a.due_date, a.priority from alerts a
      where a.status in ('Open', 'In progress') and a.due_date between p_from and p_to
        and alert_can_see(a.id)
        and (alert_is_admin() or alert_is_manager() or a.assigned_to = auth.uid())
      order by a.due_date, a.id
      limit 500) x), '[]'::jsonb);
end $$;

revoke all on function public.alert_calendar(date, date) from public, anon, authenticated;
grant execute on function public.alert_calendar(date, date) to authenticated;
