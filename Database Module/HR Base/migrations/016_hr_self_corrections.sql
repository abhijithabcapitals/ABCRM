-- =====================================================================
-- HR Base - employees correct their own days, and the history      016
-- =====================================================================
-- An employee may ask to use Annual leave, work from home or correct the times on their own day. It waits for HR or an administrator, and the day keeps its value until then.
-- Not on a holiday or a weekly off, and not in a month whose pay run is approved. Someone on the HR list follows the same rules for their own day; an administrator changes it directly.
-- Using Annual leave becomes an approved leave request when validated, so the ledger charges it once. With no balance left the day is unpaid, like any leave beyond the balance.
-- hr_attendance_history: every attendance request, decision and manual change from the audit log, which cannot be changed. HR sees everyone, a manager direct reports, an employee their own.
-- Requires 015. Idempotent.
-- =====================================================================
alter table public.hr_attendance_edits add column if not exists use_annual boolean not null default false;

-- HR list: anyone. A manager: direct reports. An employee: their own, under the rules above. A newer request replaces a pending one for that day.
drop function if exists public.hr_attendance_request(uuid, date, text, time, time, text, text);
create or replace function public.hr_attendance_request(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text, p_reason text, p_use_annual boolean default false) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare old jsonb; new_id uuid; own boolean := p_employee is not distinct from public.hr_my_employee_id(); cur text;
begin
  if not (own or public.hr_is_admin_or_hr() or public.hr_manages(p_employee)) then raise exception 'You are not allowed to change this attendance'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'A change needs a reason'; end if;
  if coalesce(p_use_annual, false) and (not own or p_status is distinct from 'Leave') then raise exception 'Annual leave here is only for your own day'; end if;
  perform public.hr_attendance_validate(p_employee, p_date, p_status, p_in, p_out);
  if own and not public.admin_is() then
    if not (p_status = 'WFH' or (p_status = 'Present' and p_in is not null and p_out is not null) or (p_status = 'Leave' and coalesce(p_use_annual, false))) then
      raise exception 'Choose Annual leave, work from home, or give both the login and logoff times';
    end if;
    select d.status into cur from public.hr_attendance_days(p_date, p_date, p_employee) d;
    if cur in ('Holiday', 'Weekend') or exists (select 1 from public.hr_holidays h where h.holiday_date = p_date)
       or extract(dow from p_date)::int = any ((select s.weekend_days from public.hr_settings s where s.id = 1)::int[]) then
      raise exception 'A holiday or weekly off cannot be changed here';
    end if;
    if exists (select 1 from public.hr_pay_runs r where r.period_month = date_trunc('month', p_date)::date and r.status = 'approved') then
      raise exception 'The pay run for this month is approved. Ask HR';
    end if;
    if coalesce(p_use_annual, false) and exists (
      select 1 from public.hr_leave_requests r where r.employee_id = p_employee and r.status in ('pending', 'approved') and p_date between r.from_date and r.to_date) then
      raise exception 'There is already a leave request for this day';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_employee::text || p_date::text, 0));
  update public.hr_attendance_edits set state = 'superseded', decided_at = now() where employee_id = p_employee and work_date = p_date and state = 'pending';
  select jsonb_build_object('status', d.status, 'time_in', d.time_in, 'time_out', d.time_out) into old from public.hr_attendance_days(p_date, p_date, p_employee) d;
  insert into public.hr_attendance_edits (employee_id, work_date, status, time_in, time_out, note, old_values, reason, use_annual)
  values (p_employee, p_date, p_status, p_in, p_out, p_note, old, btrim(p_reason), coalesce(p_use_annual, false)) returning id into new_id;
  perform public.hr_audit('attendance.edit_requested', 'hr_attendance_edits:' || new_id, old,
    jsonb_build_object('employee_id', p_employee, 'work_date', p_date, 'status', p_status, 'time_in', p_in, 'time_out', p_out, 'reason', btrim(p_reason), 'use_annual', coalesce(p_use_annual, false)));
  return new_id;
end $$;

-- As in 015. Using Annual leave also adds the approved leave request. Returns {warning}: a locked month, when approving. A rejection needs a note.
create or replace function public.hr_attendance_decide(p_edit uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e public.hr_attendance_edits%rowtype; r jsonb := jsonb_build_object('warning', null); annual uuid; days_n numeric;
begin
  if not public.hr_is_admin_or_hr() then raise exception 'Only HR can approve attendance changes'; end if;
  select * into e from public.hr_attendance_edits where id = p_edit for update;
  if not found then raise exception 'Change request not found'; end if;
  if not public.admin_is() and e.employee_id is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot decide a change to your own attendance';
  end if;
  if e.state <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', e.state; end if;
  if not coalesce(p_approve, false) and (p_note is null or btrim(p_note) = '') then raise exception 'A rejection needs a note'; end if;
  if p_approve and e.use_annual then
    annual := coalesce(public.hr_leave_rules_type(), (select t.id from public.hr_leave_types t where t.name = 'Annual'));
    if annual is null then raise exception 'There is no Annual leave type'; end if;
    days_n := public.hr_leave_days(e.work_date, e.work_date);
    if days_n <= 0 then raise exception 'This day is not a working day'; end if;
    insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, note, approver, decided_at, decision_note, created_by)
    values (e.employee_id, annual, e.work_date, e.work_date, days_n, 'approved', e.reason, auth.uid(), now(), p_note, e.requested_by);
  end if;
  if p_approve then r := public.hr_attendance_write(e.employee_id, e.work_date, e.status, e.time_in, e.time_out, e.note); end if;
  update public.hr_attendance_edits set state = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = p_note where id = p_edit;
  perform public.hr_audit(case when p_approve then 'attendance.edit_approved' else 'attendance.edit_rejected' end, 'hr_attendance_edits:' || p_edit,
    e.old_values, jsonb_build_object('employee_id', e.employee_id, 'work_date', e.work_date, 'status', e.status, 'time_in', e.time_in, 'time_out', e.time_out, 'use_annual', e.use_annual, 'reason', e.reason, 'note', p_note));
  return r;
end $$;

-- Newest first, at most 500 entries.
create or replace function public.hr_attendance_history()
returns table (at timestamptz, action text, employee_id uuid, employee_code text, full_name text, work_date date, old_values jsonb, new_values jsonb, actor_name text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.at, a.action, e.id, e.employee_code, e.full_name, (a.new_values ->> 'work_date')::date, a.old_values, a.new_values, p.full_name
  from public.hr_audit_log a
  join public.hr_employees e on e.id = (a.new_values ->> 'employee_id')::uuid
  left join public.profiles p on p.id = a.actor
  where a.action in ('attendance.edit_requested', 'attendance.edit_approved', 'attendance.edit_rejected', 'attendance.created', 'attendance.updated')
    and (public.hr_is_admin_or_hr() or e.id = public.hr_my_employee_id() or public.hr_manages(e.id))
  order by a.at desc
  limit 500
$$;

revoke all on function public.hr_attendance_request(uuid, date, text, time, time, text, text, boolean), public.hr_attendance_history() from public, anon, authenticated;
grant execute on function public.hr_attendance_request(uuid, date, text, time, time, text, text, boolean), public.hr_attendance_history() to authenticated;
