-- 018: HR decides everything about people. Leave, half days, work from home, late concessions and overtime were also open to a person's manager; now only HR or an administrator decides them.
-- Attendance changes were already HR only (015). Expense claims stay with a Finance Manager. Managers keep seeing their direct reports' requests, and can still ask for a change to a report's day.
-- Nobody decides their own request, as before. Run after 017. Safe to run twice.

create or replace function public.hr_request_can_decide(p_kind text, p_employee uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select p_employee is distinct from public.hr_my_employee_id() and case p_kind
    when 'reimbursement' then public.hr_is_finance()
    else public.hr_is_admin_or_hr()
  end
$$;

-- Same as 010 except the permission check.
create or replace function public.hr_leave_decide(p_request uuid, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.hr_leave_requests%rowtype; new_status text; ty public.hr_leave_types%rowtype; rem numeric; warns text[] := '{}'; locked text; yr int;
  unpaid_id uuid; keep numeric; split_at date; d date; counted numeric := 0;
begin
  select * into r from public.hr_leave_requests where id = p_request for update;
  if not found then raise exception 'Leave request not found'; end if;
  if r.employee_id is not distinct from public.hr_my_employee_id() then
    raise exception 'You cannot decide your own leave';
  end if;
  if not public.hr_is_admin_or_hr() then
    raise exception 'You are not allowed to decide this request';
  end if;
  if r.status <> 'pending' then raise exception 'Only a pending request can be decided (this one is %)', r.status; end if;
  new_status := case when p_approve then 'approved' else 'rejected' end;
  select * into ty from public.hr_leave_types where id = r.leave_type_id;
  yr := extract(year from r.from_date)::int;

  if p_approve and ty.paid and ty.carry_forward then
    select b.remaining into rem from public.hr_leave_balance(r.employee_id, yr) b where b.leave_type_id = r.leave_type_id;
    if rem < r.days then
      select id into unpaid_id from public.hr_leave_types where name = 'Unpaid' and not paid;
      if unpaid_id is null then raise exception 'Add an Unpaid leave type first'; end if;
      keep := greatest(floor(rem), 0);
      if keep = 0 then
        update public.hr_leave_requests set leave_type_id = unpaid_id where id = p_request;
        warns := warns || format('%s %s: no balance left, so all %s day(s) are unpaid', ty.name, yr, r.days);
      else
        d := r.from_date;
        loop
          counted := counted + public.hr_leave_days(d, d);
          exit when counted >= keep;
          d := d + 1;
        end loop;
        split_at := d;
        update public.hr_leave_requests set to_date = split_at, days = keep where id = p_request;
        insert into public.hr_leave_requests (employee_id, leave_type_id, from_date, to_date, days, status, note, approver, decided_at, decision_note, created_by)
        select r.employee_id, unpaid_id, g.first_d, r.to_date, r.days - keep, 'approved', r.note, auth.uid(), now(), p_note, r.created_by
        from (select min(x.d)::date as first_d from generate_series((split_at + 1)::timestamp, r.to_date::timestamp, interval '1 day') x(d) where public.hr_leave_days(x.d::date, x.d::date) > 0) g;
        warns := warns || format('%s %s: %s day(s) from the balance, %s day(s) unpaid', ty.name, yr, keep, r.days - keep);
      end if;
    end if;
  end if;

  update public.hr_leave_requests set status = new_status, approver = auth.uid(), decided_at = now(), decision_note = p_note where id = p_request;
  perform public.hr_audit('leave.' || new_status, 'hr_leave_requests:' || p_request,
    jsonb_build_object('status', r.status),
    jsonb_build_object('status', new_status, 'employee_id', r.employee_id, 'from_date', r.from_date, 'to_date', r.to_date, 'days', r.days, 'note', p_note));
  if p_approve and ty.paid and not coalesce(ty.carry_forward, false) then
    select b.remaining into rem from public.hr_leave_balance(r.employee_id, yr) b where b.leave_type_id = r.leave_type_id;
    if rem < 0 then warns := warns || format('%s %s: approved %s day(s), which is %s beyond the balance', ty.name, yr, r.days, -rem); end if;
  end if;
  locked := public.hr_locked_month_warning(r.from_date, r.to_date);
  if locked is not null then warns := warns || locked; end if;
  return jsonb_build_object('warning', case when cardinality(warns) > 0 then array_to_string(warns, '; ') end);
end $$;
