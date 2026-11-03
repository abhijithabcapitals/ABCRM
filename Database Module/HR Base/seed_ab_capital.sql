-- AB Capital's own attendance, leave and pay values. Run on live, after migration 013. Not a numbered migration, so tests keep their own fixtures.
-- Run once. A second run adds no rows, but it does put these settings back over anything HR has changed since.
-- 1,000 AED is the figure the user gave. HR changes it per person in Salary Master.
update public.hr_settings set
  weekend_days = '{0}',
  shift_start = '09:30',
  shift_end = '18:30',
  saturday_end = '14:00',
  absent_from_blank_days = true,
  attendance_tracked_from = '2026-08-10', -- the first punch e-timeoffice holds
  pay_day_divisor_mode = 'calendar_days',
  pay_unpaid_wage_base = 'total'
where id = 1;

insert into public.hr_wfh_saturday_rules (effective_from, effective_to, pattern)
select null, '2026-12-31'::date, 'last'
where not exists (select 1 from public.hr_wfh_saturday_rules where effective_to = '2026-12-31' and pattern = 'last');
insert into public.hr_wfh_saturday_rules (effective_from, effective_to, pattern)
select '2027-01-01'::date, null, 'second_and_last'
where not exists (select 1 from public.hr_wfh_saturday_rules where effective_from = '2027-01-01' and pattern = 'second_and_last');

insert into public.hr_leave_types (name, paid, annual_days, carry_forward) values
  ('Annual', true, 30, true),
  ('Unpaid', false, null, false)
on conflict (name) do update set paid = excluded.paid, annual_days = excluded.annual_days, carry_forward = excluded.carry_forward;

-- Run after migration 013. Annual leave accrues 2.5 days a month after 6 months of service. The opening balances were counted to the end of October 2026, so the rules start the next day.
update public.hr_leave_types set accrual_per_month = 2.5, accrual_after_months = 6 where name = 'Annual';
update public.hr_settings set leave_rules_from = '2026-11-01' where id = 1;

insert into public.hr_pay_details (employee_id, effective_from, basic)
select e.id, '2026-01-01', 1000 from public.hr_employees e
where not exists (select 1 from public.hr_pay_details p where p.employee_id = e.id);
