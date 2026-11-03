-- =====================================================================
-- HR Base - HR changes attendance and decides approvals            015
-- =====================================================================
-- The HR list now does what only an administrator could: change a day directly and decide change requests. Each change stays audited, and an edited day stays manual.
-- One limit: someone on the HR list cannot change or approve their own attendance, the same rule as leave. Their request waits for an administrator or another HR member.
-- An administrator has no such limit. Requires 010. Idempotent.
-- =====================================================================
create or replace function public.hr_attendance_set(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can change attendance directly. Send it for approval'; end if;
  if not public.admin_is() and p_employee is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot change your own attendance directly. Send it for approval';
  end if;
  return public.hr_attendance_write(p_employee, p_date, p_status, p_in, p_out, p_note);
end $$;

-- Returns {warning}: a locked month, when approving. A rejection needs a note.
create or replace function public.hr_attendance_decide(p_edit uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.hr_attendance_edits%rowtype; r jsonb := jsonb_build_object('warning', null);
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can approve attendance changes'; end if;
  select * into e from public.hr_attendance_edits where id = p_edit for update;
  if not found then raise exception 'Change request not found'; end if;
  if not public.admin_is() and e.employee_id is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot decide a change to your own attendance';
  end if;
  if e.state <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', e.state; end if;
  if not coalesce(p_approve, false) and (p_note is null or btrim(p_note) = '') then raise exception 'A rejection needs a note'; end if;
  if p_approve then r := public.hr_attendance_write(e.employee_id, e.work_date, e.status, e.time_in, e.time_out, e.note); end if;
  update public.hr_attendance_edits set state = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_edit;
  perform public.hr_audit(case when p_approve then 'attendance.edit_approved' else 'attendance.edit_rejected' end, 'hr_attendance_edits:' || p_edit,
    e.old_values, jsonb_build_object('employee_id', e.employee_id, 'work_date', e.work_date, 'status', e.status, 'note', p_note));
  return r;
end $$;

-- For the Approvals tab label: what this person can decide.
create or replace function public.hr_attendance_edits_pending() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when public.hr_is_admin_or_hr() then (
    select count(*)::int from public.hr_attendance_edits ed
    where ed.state = 'pending' and (public.admin_is() or ed.employee_id is distinct from public.hr_my_employee_id())
  ) else 0 end
$$;
