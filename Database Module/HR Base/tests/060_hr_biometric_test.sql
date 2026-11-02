-- LOCAL TEST ONLY: biometric ingest, roll-up, linking and access. Runs after 050 on the same cluster (reuses its helpers; profile ...0b is
-- the HR tester used by 030). Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

reset role;
truncate public.t_result;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Bio Staff', 'member'),
  ('00000000-0000-0000-0000-0000000000d2', 'Bio Colleague', 'member')
on conflict (id) do nothing;
insert into public.hr_employees (id, employee_code, full_name, profile_id, join_date, exit_date, status) values
  ('30000000-0000-0000-0000-0000000000d1', 'BIO-1', 'Bio Staff', '00000000-0000-0000-0000-0000000000d1', '2024-01-01', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000d2', 'BIO-2', 'Bio Colleague', '00000000-0000-0000-0000-0000000000d2', '2024-01-01', null, 'Active'),
  ('30000000-0000-0000-0000-0000000000d3', 'BIO-3', 'Bio Leaver', null, '2024-01-01', '2025-01-31', 'Left'),
  ('30000000-0000-0000-0000-0000000000d4', 'BIO-4', 'Bio Newcomer', null, '2025-06-01', null, 'Active');
create or replace function public.bio(p text) returns uuid language sql as $$ select ('30000000-0000-0000-0000-0000000000' || p)::uuid $$;
grant execute on function public.bio(text) to authenticated;
create or replace function public.day(p_e text, p_d date) returns public.hr_attendance language sql security definer as $$
  select * from public.hr_attendance where employee_id = public.bio(p_e) and work_date = p_d
$$;
grant execute on function public.day(text, date) to authenticated;

-- ── access: the sync's functions are service role only ──
set role authenticated;
select public.as_user('d1');
select public.must_fail('a member cannot call ingest', $s$select public.hr_biometric_ingest('[]')$s$, '%permission denied%');
select public.must_fail('a member cannot record sync state', $s$select public.hr_biometric_sync_record(true, null, null)$s$, '%permission denied%');
select public.must_fail('a member cannot call the roll-up', $s$select public.hr_biometric_rollup('BIO-1', '2025-03-03')$s$, '%permission denied%');
select public.must_fail('a member cannot see status', $s$select public.hr_biometric_status()$s$, '%Only HR%');
select public.must_fail('a member cannot link a code', $s$select public.hr_biometric_link(public.bio('d1'), 'BIO-2')$s$, '%Only HR%');
select public.ok('a member reads no punches', (select count(*) = 0 from public.hr_biometric_punches));
select public.must_fail('a member cannot insert punches', $s$insert into public.hr_biometric_punches (emp_code, punch_at) values ('BIO-2', now())$s$, '%permission denied%');
update public.hr_employees set biometric_code = 'BIO-2' where id = public.bio('d1');
select public.ok('a member cannot change their own biometric code', (select biometric_code is null from public.hr_employees where id = public.bio('d1')));

-- ── ingest and roll-up ──
reset role;
select public.ok('ingest returns counts', (select (r ->> 'new_punches')::int = 3 and (r #>> '{days,created}')::int = 1 and (r #>> '{days,unmatched}')::int = 1 and (r ->> 'received')::int = 3
  from (select public.hr_biometric_ingest('[
    {"emp_code":"BIO-1","punch_at":"2025-03-03T09:02:00","machine_id":"3","device_name":"Bio Staff"},
    {"emp_code":"BIO-1","punch_at":"2025-03-03T18:05:00","machine_id":"3","device_name":"Bio Staff"},
    {"emp_code":"GHOST","punch_at":"2025-03-03T09:00:00","machine_id":"3","device_name":"Ghost Person"}]') r) x));
select public.ok('first and last punch become in and out, as biometric Present', (select status = 'Present' and time_in = '09:02' and time_out = '18:05' and source = 'biometric' from public.day('d1', '2025-03-03')));
select public.ok('a roll-up is audited under attendance.', (select count(*) = 1 from public.hr_audit_log where action = 'attendance.biometric_created' and new_values ->> 'work_date' = '2025-03-03' and new_values ->> 'employee_id' = public.bio('d1')::text));

select public.ok('sending the same punches again adds nothing', (select (r ->> 'new_punches')::int = 0 and (r #>> '{days,same}')::int = 1
  from (select public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-03T09:02:00"},{"emp_code":"BIO-1","punch_at":"2025-03-03T18:05:00"}]') r) x));
select public.ok('no second audit for an unchanged day', (select count(*) = 1 from public.hr_audit_log where action like 'attendance.biometric%' and new_values ->> 'employee_id' = public.bio('d1')::text));

select public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-04T09:00:00"}]');
select public.ok('a single punch has no time out', (select time_in = '09:00' and time_out is null from public.day('d1', '2025-03-04')));
select public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-04T17:30:00"}]');
select public.ok('a later punch fills the time out', (select time_in = '09:00' and time_out = '17:30' from public.day('d1', '2025-03-04')));
select public.ok('a late-arriving earlier punch moves the time in', (select (public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-04T08:50:00"}]') #>> '{days,updated}')::int = 1));
select public.ok('time in moved and old values audited', (select (select time_in from public.day('d1', '2025-03-04')) = '08:50' and exists (select 1 from public.hr_audit_log where action = 'attendance.biometric_updated' and old_values ->> 'time_in' = '09:00:00')));

select public.ok('no absence is invented for a day with no punches', (public.day('d1', '2025-03-05')).id is null);

-- ── a manual day wins ──
set role authenticated;
select public.as_user('0b');
select public.hr_attendance_set(public.bio('d1'), '2025-03-06', 'Absent', null, null, 'sick');
select public.hr_attendance_set(public.bio('d1'), '2025-03-03', 'Present', '09:00', '18:00', 'corrected');
select public.ok('HR edit of a biometric day makes it manual', (select source = 'manual' and time_in = '09:00' from public.day('d1', '2025-03-03')));
reset role;
select public.ok('the sync reports a manual day and leaves it', (select (r #>> '{days,manual}')::int = 1 from (select public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-06T09:00:00"}]') r) x));
select public.ok('a manual Absent stays Absent', (select status = 'Absent' and time_in is null from public.day('d1', '2025-03-06')));
select public.hr_biometric_ingest('[{"emp_code":"BIO-1","punch_at":"2025-03-03T07:00:00"}]');
select public.ok('a corrected day keeps the correction', (select time_in = '09:00' and note = 'corrected' from public.day('d1', '2025-03-03')));

-- ── employment dates and future ──
select public.ok('after the exit date is out of range', (select (r #>> '{days,out_of_range}')::int = 1 from (select public.hr_biometric_ingest('[{"emp_code":"BIO-3","punch_at":"2025-02-03T09:00:00"}]') r) x));
select public.ok('before the join date is out of range', (select (r #>> '{days,out_of_range}')::int = 1 from (select public.hr_biometric_ingest('[{"emp_code":"BIO-4","punch_at":"2025-03-03T09:00:00"}]') r) x));
select public.ok('a future day is out of range', (select (r #>> '{days,out_of_range}')::int = 1 from (select public.hr_biometric_ingest(jsonb_build_array(jsonb_build_object('emp_code', 'BIO-2', 'punch_at', (now() + interval '3 days')::timestamp))) r) x));
select public.ok('no attendance came from those', (select count(*) = 0 from public.hr_attendance where employee_id in (public.bio('d3'), public.bio('d4'), public.bio('d2'))));
select public.ok('blank rows are ignored', (select (r ->> 'new_punches')::int = 0 from (select public.hr_biometric_ingest('[{"emp_code":"","punch_at":"2025-03-03T09:00:00"},{"emp_code":"BIO-1"}]') r) x));
select public.must_fail('ingest refuses a non-list', $s$select public.hr_biometric_ingest('{}')$s$, '%must be a list%');

-- ── sync record ──
select public.hr_biometric_sync_record(true, null, '{"new_punches":1}');
select public.hr_biometric_sync_record(false, 'e-timeoffice returned HTTP 500', null);
select public.ok('a failure keeps the last success and stats', (select last_error like '%HTTP 500%' and last_success_at is not null and last_stats ->> 'new_punches' = '1' from public.hr_biometric_sync));
select public.hr_biometric_sync_record(true, null, '{"new_punches":2}');
select public.ok('a success clears the error', (select last_error is null and last_stats ->> 'new_punches' = '2' from public.hr_biometric_sync));

-- ── unmatched and linking ──
set role authenticated;
select public.as_user('0b');
select public.ok('HR sees the unmatched code with the device name', (select public.hr_biometric_status() -> 'unmatched' @> '[{"emp_code":"GHOST","device_name":"Ghost Person"}]'));
select public.ok('HR reads punches', (select count(*) > 0 from public.hr_biometric_punches));
select public.ok('linking rolls up the stored punches', (select (r ->> 'days')::int = 1 from (select public.hr_biometric_link(public.bio('d2'), 'GHOST') r) x));
select public.ok('the linked employee now has the day', (select status = 'Present' and source = 'biometric' from public.day('d2', '2025-03-03')));
select public.ok('the code is no longer unmatched', not (public.hr_biometric_status() -> 'unmatched' @> '[{"emp_code":"GHOST"}]'));
select public.ok('the link is audited', (select count(*) = 1 from public.hr_audit_log where action = 'biometric.linked'));
select public.must_fail('a code cannot belong to two employees', $s$select public.hr_biometric_link(public.bio('d1'), 'GHOST')$s$, '%already linked%');
select public.ok('linking the same code again does nothing', (select (r ->> 'days')::int = 0 from (select public.hr_biometric_link(public.bio('d2'), ' GHOST ') r) x));
select public.ok('unlinking removes the biometric days of the wrong link', (select (r ->> 'removed')::int = 1 from (select public.hr_biometric_link(public.bio('d2'), null) r) x));
select public.ok('the day is gone', (public.day('d2', '2025-03-03')).id is null);
select public.ok('the removal is audited', (select count(*) = 1 from public.hr_audit_log where action = 'attendance.biometric_removed' and new_values ->> 'employee_id' = public.bio('d2')::text));
select public.hr_biometric_link(public.bio('d2'), 'OTHER-CODE');
reset role;
select public.ok('employee_code matches only when the employee has no biometric code', public.hr_biometric_employee('BIO-2') is null and public.hr_biometric_employee('OTHER-CODE') = public.bio('d2') and public.hr_biometric_employee('BIO-1') = public.bio('d1'));
set role authenticated;
select public.as_user('0b');

-- ── still locked down ──
select public.ok('new tables have RLS on', (select bool_and(relrowsecurity) from pg_class where oid in ('public.hr_biometric_punches'::regclass, 'public.hr_biometric_sync'::regclass)));
select public.ok('new functions are security definer with a fixed search_path', (select count(*) = 6 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute')) from pg_proc where proname in ('hr_biometric_employee', 'hr_biometric_rollup', 'hr_biometric_ingest', 'hr_biometric_sync_record', 'hr_biometric_status', 'hr_biometric_link')));

reset role;
\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
