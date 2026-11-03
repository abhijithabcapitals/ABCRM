-- LOCAL TEST ONLY: calendar marks, confirming a mark into a real holiday, and the new personal fields. Runs after 070 on the same cluster (reuses its helpers).
-- Profile ...0b is the HR list member from 010. ...f1 is Day Staff (employee DS-1), ...f2 a login with no employee and ...f6 Day Staff's manager, all from 070.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
delete from public.hr_calendar_marks;
delete from public.hr_holidays;
update public.hr_settings set absent_from_blank_days = true, attendance_tracked_from = '2026-01-01' where id = 1;
insert into public.hr_employees (id, employee_code, full_name, join_date, status) values ('4a000000-0000-0000-0000-0000000000f7', 'DS-7', 'Mark Check', '2026-09-01', 'Active');
create or replace function public.cm_id(p_name text) returns uuid language sql security definer as $$ select id from public.hr_calendar_marks where name = p_name $$;
grant execute on function public.cm_id(text) to authenticated;
insert into public.hr_employee_personal (employee_id) values (public.ds('f1')) on conflict (employee_id) do nothing;

set role authenticated;

-- ── marks: HR writes, linked staff read, others nothing ──
select public.as_user('0b');
insert into public.hr_calendar_marks (mark_date, name, region, source) values
  ('2026-10-14', 'Test Eid', 'UAE', 'test'),
  ('2026-10-15', 'Test Diwali', 'India', 'test'),
  ('2026-10-16', 'Test Moved', 'UAE', 'test'),
  ('2026-10-19', 'Second Name', 'UAE', 'test');
select public.ok('HR adds marks', (select count(*) = 4 from public.hr_calendar_marks));
select public.must_fail('a region must be UAE or India', $$insert into public.hr_calendar_marks (mark_date, name, region) values ('2026-10-20', 'X', 'Oman')$$, 'check constraint');
select public.must_fail('the same name twice on a date is refused', $$insert into public.hr_calendar_marks (mark_date, name, region) values ('2026-10-14', 'Test Eid', 'UAE')$$, 'duplicate key');
select public.as_user('f1');
select public.ok('an employee reads marks', (select count(*) = 4 from public.hr_calendar_marks));
select public.must_fail('an employee cannot add a mark', $$insert into public.hr_calendar_marks (mark_date, name, region) values ('2026-10-21', 'Sneaky', 'UAE')$$, 'row-level security');
select public.as_user('f2');
select public.ok('a login with no employee reads no marks', (select count(*) = 0 from public.hr_calendar_marks));

-- ── a mark changes nothing until confirmed ──
select public.ok('a UAE mark leaves a blank day Absent', public.ds_status('f7', '2026-10-14') = 'Absent', public.ds_status('f7', '2026-10-14'));
select public.ok('an India mark leaves a blank day Absent', public.ds_status('f7', '2026-10-15') = 'Absent', public.ds_status('f7', '2026-10-15'));

-- ── confirm ──
select public.as_user('f1');
select public.must_fail('an employee cannot confirm', $$select public.hr_calendar_mark_confirm(public.cm_id('Test Eid'), '2026-10-14')$$, 'Only HR');
select public.as_user('0b');
select public.must_fail('an India mark cannot become a holiday', $$select public.hr_calendar_mark_confirm(public.cm_id('Test Diwali'), '2026-10-15')$$, 'Only a UAE');
select public.must_fail('a date is required', $$select public.hr_calendar_mark_confirm(public.cm_id('Test Eid'), null)$$, 'date is required');
select public.must_fail('an unknown mark is refused', $$select public.hr_calendar_mark_confirm('00000000-0000-0000-0000-000000000000', '2026-10-15')$$, 'no longer exists');
select public.hr_calendar_mark_confirm(public.cm_id('Test Eid'), '2026-10-14');
select public.ok('confirm makes the holiday', (select name = 'Test Eid' from public.hr_holidays where holiday_date = '2026-10-14'));
select public.ok('confirm removes the mark', public.cm_id('Test Eid') is null);
select public.ok('a confirmed day is Holiday', public.ds_status('f7', '2026-10-14') = 'Holiday', public.ds_status('f7', '2026-10-14'));
select public.hr_calendar_mark_confirm(public.cm_id('Test Moved'), '2026-10-13');
select public.ok('confirm can use the announced date', (select name = 'Test Moved' from public.hr_holidays where holiday_date = '2026-10-13'));
select public.ok('the estimated date stays a working day', public.ds_status('f7', '2026-10-16') = 'Absent', public.ds_status('f7', '2026-10-16'));
select public.hr_calendar_mark_confirm(public.cm_id('Second Name'), '2026-10-14');
select public.ok('a date that is already a holiday keeps both names', (select name = 'Test Eid / Second Name' from public.hr_holidays where holiday_date = '2026-10-14'));

-- ── personal fields ──
update public.hr_employee_personal set photo_path = 'x/p.png', visa_status = 'Employment', permanent_country = 'India', permanent_address = 'Home' where employee_id = public.ds('f1');
select public.ok('HR saves the new personal fields', (select visa_status = 'Employment' and permanent_country = 'India' from public.hr_employee_personal where employee_id = public.ds('f1')));
select public.as_user('f1');
select public.ok('the employee reads their own new fields', (select photo_path = 'x/p.png' from public.hr_employee_personal where employee_id = public.ds('f1')));
update public.hr_employee_personal set visa_status = 'Golden' where employee_id = public.ds('f1');
select public.as_user('0b');
select public.ok('the employee cannot change them', (select visa_status = 'Employment' from public.hr_employee_personal where employee_id = public.ds('f1')));
select public.as_user('f6');
select public.ok('a manager does not see a report''s personal row', (select count(*) = 0 from public.hr_employee_personal where employee_id = public.ds('f1')));

reset role;

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
