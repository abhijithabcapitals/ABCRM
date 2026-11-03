-- Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
create function t.dubai(s text) returns timestamptz language sql as $$ select (s || '+04')::timestamptz $$;
create function t.nx(k text, r timestamptz, e int, t time, w int[], m int, a timestamptz) returns timestamptz language sql as $$ select public.admin_trigger_next(k, r, e, t, w, m, a) $$;

-- Schedule calculation, in Dubai time
select t.ok('daily later today', t.nx('daily', null, null, '09:00', null, null, t.dubai('2026-11-01 08:00')) = t.dubai('2026-11-01 09:00'));
select t.ok('daily rolls to tomorrow', t.nx('daily', null, null, '09:00', null, null, t.dubai('2026-11-01 09:00')) = t.dubai('2026-11-02 09:00'));
select t.ok('daily 2 AM Dubai is the previous UTC day', t.nx('daily', null, null, '02:00', null, null, '2026-11-01 20:00+00') = '2026-11-01 22:00+00');
select t.ok('weekly next chosen day', t.nx('weekly', null, null, '09:00', '{1,3}', null, t.dubai('2026-11-03 10:00')) = t.dubai('2026-11-04 09:00'));
select t.ok('weekly wraps to next week', t.nx('weekly', null, null, '09:00', '{1}', null, t.dubai('2026-11-02 10:00')) = t.dubai('2026-11-09 09:00'));
select t.ok('monthly day 31 in a 30 day month', t.nx('monthly', null, null, '09:00', null, 31, t.dubai('2026-11-02 00:00')) = t.dubai('2026-11-30 09:00'));
select t.ok('monthly day 31 in February', t.nx('monthly', null, null, '09:00', null, 31, t.dubai('2027-02-01 00:00')) = t.dubai('2027-02-28 09:00'));
select t.ok('monthly next month', t.nx('monthly', null, null, '09:00', null, 15, t.dubai('2026-11-15 09:00')) = t.dubai('2026-12-15 09:00'));
select t.ok('interval on the clock', t.nx('interval', null, 15, null, null, null, '2026-11-01 10:07:30+00') = '2026-11-01 10:15:00+00');
select t.ok('once in future', t.nx('once', t.dubai('2026-12-01 09:00'), null, null, null, null, t.dubai('2026-11-01 09:00')) = t.dubai('2026-12-01 09:00'));
select t.ok('once in past', t.nx('once', t.dubai('2026-10-01 09:00'), null, null, null, null, t.dubai('2026-11-01 09:00')) is null);

-- Who may do what
insert into profiles values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member');
insert into vault.decrypted_secrets values ('email_base_sync_secret', 'SECRET-VALUE');
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.fails('member cannot list', 'select admin_trigger_list()', 'Admin access required');
select t.fails('member cannot save', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'daily', p_time := '09:00')$q$, 'Admin access required');
select t.fails('member cannot read triggers', 'select * from admin_triggers', 'permission denied');
select t.fails('member cannot read runs', 'select * from admin_trigger_runs', 'permission denied');
select t.fails('member cannot dispatch', 'select admin_triggers_dispatch()', 'permission denied');
select t.fails('member cannot start a task', $q$select admin_trigger_start(gen_random_uuid(), 'manual', null)$q$, 'permission denied');
select t.fails('member cannot post', $q$select admin_trigger_post('x', 'y', 'email_base_sync_secret', '{}')$q$, 'permission denied');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.fails('admin cannot read tables directly', 'select * from admin_triggers', 'permission denied');
select t.fails('admin cannot start a task directly', $q$select admin_trigger_start(gen_random_uuid(), 'manual', null)$q$, 'permission denied');

-- Validation
select t.fails('unknown task', $q$select admin_trigger_save(null, 'x', 'drop_everything', 'daily', p_time := '09:00')$q$, 'not in the catalogue');
select t.fails('task without a backend', $q$select admin_trigger_save(null, 'x', 'hr_sync', 'daily', p_time := '09:00')$q$, 'No HR sync');
select t.fails('no name', $q$select admin_trigger_save(null, '  ', 'purge_notifications', 'daily', p_time := '09:00')$q$, 'name');
select t.fails('past date', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'once', p_run_at := now() - interval '1 minute')$q$, 'future');
select t.fails('interval too short', $q$select admin_trigger_save(null, 'x', 'mail_sync', 'interval', p_every := 1)$q$, 'between 5 minutes');
select t.fails('date automations not on an interval', $q$select admin_trigger_save(null, 'x', 'date_automations', 'interval', p_every := 60)$q$, 'at most once a day');
select t.fails('weekly with no days', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'weekly', p_time := '09:00', p_weekdays := '{}')$q$, 'day of the week');
select t.fails('weekly bad day', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'weekly', p_time := '09:00', p_weekdays := '{8}')$q$, 'day of the week');
select t.fails('monthly bad day', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'monthly', p_time := '09:00', p_month_day := 32)$q$, '1 to 31');
select t.fails('daily without time', $q$select admin_trigger_save(null, 'x', 'purge_notifications', 'daily')$q$, 'Choose a time');

-- Create, pause, resume, edit, delete
select admin_trigger_save(null, ' Purge ', 'purge_notifications', 'daily', p_time := '09:00', p_month_day := 5) ->> 'id' as purge_id \gset
select t.ok('listed with catalogue', (select jsonb_array_length(admin_trigger_list()->'triggers') = 1 and jsonb_array_length(admin_trigger_list()->'catalogue') = 9));
select t.ok('dispatcher reported', (admin_trigger_list()->>'dispatcher_active')::boolean);
select t.ok('name trimmed, unused cleared', (select t->>'name' = 'Purge' and t->'month_day' = 'null'::jsonb and t->>'next_run_at' is not null from jsonb_array_elements(admin_trigger_list()->'triggers') t));
select admin_trigger_set_active(:'purge_id', false);
select t.ok('paused has no next run', (select t->'next_run_at' = 'null'::jsonb and t->>'active' = 'false' from jsonb_array_elements(admin_trigger_list()->'triggers') t));
select admin_trigger_save(:'purge_id', 'Purge weekly', 'purge_notifications', 'weekly', p_time := '10:00', p_weekdays := '{5,1,1}');
select t.ok('edit keeps paused, sorts days', (select t->'next_run_at' = 'null'::jsonb and t->'weekdays' = '[1,5]'::jsonb from jsonb_array_elements(admin_trigger_list()->'triggers') t));
select admin_trigger_set_active(:'purge_id', true);
select t.ok('resume sets next run', (select t->>'next_run_at' is not null from jsonb_array_elements(admin_trigger_list()->'triggers') t));

reset role;
insert into notifications (read, created_at) values (true, now() - interval '40 days'), (true, now() - interval '5 days'), (false, now() - interval '40 days');
set role authenticated;
select t.ok('run now purges only old read rows', admin_trigger_run_now(:'purge_id')->>'detail' = 'Deleted 1 notification(s)');
reset role;
select t.ok('run now left the schedule', (select next_run_at > now() and last_status = 'succeeded' from admin_triggers));

-- Dispatcher: runs what is due, once
select set_config('test.uid', '', false);
update admin_triggers set next_run_at = now() - interval '3 days';
select admin_triggers_dispatch();
select t.ok('due trigger ran once and moved on', (select count(*) = 2 from admin_trigger_runs where source in ('schedule', 'manual')) and (select next_run_at > now() from admin_triggers));
select admin_triggers_dispatch();
select t.ok('not run again', (select count(*) = 2 from admin_trigger_runs));
select t.ok('schedule run has no person', (select started_by is null from admin_trigger_runs where source = 'schedule'));

update admin_triggers set active = false, next_run_at = now() - interval '1 hour';
select admin_triggers_dispatch();
select t.ok('paused does not run', (select count(*) = 2 from admin_trigger_runs));

-- One-off: finishes, cannot resume, can be given a new date
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select admin_trigger_save(null, 'Once', 'date_automations', 'once', p_run_at := now() + interval '1 hour') ->> 'id' as once_id \gset
update admin_triggers set next_run_at = now() - interval '1 minute' where id = :'once_id';
select set_config('test.uid', '', false);
select admin_triggers_dispatch();
select t.ok('one-off ran', (select count(*) = 1 from automation_calls));
select t.ok('one-off finished', (select not active and finished_at is not null and next_run_at is null and last_status = 'succeeded' from admin_triggers where id = :'once_id'));
select admin_triggers_dispatch();
select t.ok('one-off does not repeat', (select count(*) = 1 from automation_calls));
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
select t.fails('finished one-off cannot resume', format('select admin_trigger_set_active(%L, true)', :'once_id'), 'has finished');
select admin_trigger_save(:'once_id', 'Once', 'date_automations', 'once', p_run_at := now() + interval '2 hours');
select t.ok('new date restarts it', (select active and finished_at is null and next_run_at is not null from admin_triggers where id = :'once_id'));

-- A failing task is recorded and does not stop others
select set_config('test.automations_fail', 'yes', false);
select admin_trigger_run_now(:'once_id');
select set_config('test.automations_fail', '', false);
select t.ok('failure recorded', (select last_status = 'failed' and last_detail like '%automations broke%' from admin_triggers where id = :'once_id'));

-- Edge Function: secret sent but never stored, result collected later
select admin_trigger_save(null, 'Mail', 'mail_sync', 'interval', p_every := 15) ->> 'id' as mail_id \gset
select admin_trigger_run_now(:'mail_id')->>'status' = 'running' as was_running \gset
select t.ok('edge run is running', :'was_running'::boolean);
select t.fails('no double run', format('select admin_trigger_run_now(%L)', :'mail_id'), 'still running');
select t.ok('secret sent in header', (select headers->>'x-sync-secret' = 'SECRET-VALUE' and url like '%/functions/v1/ceo-mail-sync' from net.requests));
select t.ok('secret not returned or stored', admin_trigger_list()::text not like '%SECRET-VALUE%' and (select string_agg(r::text, '') from admin_trigger_runs r) not like '%SECRET-VALUE%');
insert into net._http_response select id, 200, false, null, '{"ok":true}' from net.requests;
select admin_trigger_list();
select t.ok('success collected', (select last_status = 'succeeded' and last_detail = 'HTTP 200' from admin_triggers where id = :'mail_id'));
select admin_trigger_run_now(:'mail_id');
insert into net._http_response select max(id), 500, false, null, 'boom' from net.requests;
select admin_triggers_dispatch();
select t.ok('HTTP error is failure', (select last_status = 'failed' and last_detail = 'HTTP 500: boom' from admin_triggers where id = :'mail_id'));
delete from vault.decrypted_secrets;
select admin_trigger_run_now(:'mail_id');
select t.ok('missing secret is failure', (select last_status = 'failed' and last_detail like '%secret email_base_sync_secret is missing%' from admin_triggers where id = :'mail_id'));
select admin_trigger_run_now(:'mail_id');
update admin_trigger_runs set status = 'running', net_request_id = 999999, started_at = now() - interval '11 minutes' where id = (select max(id) from admin_trigger_runs);
select admin_triggers_dispatch();
select t.ok('no answer times out', (select last_status = 'failed' and last_detail like 'No answer%' from admin_triggers where id = :'mail_id'));

-- History, delete, audit
select t.ok('history readable', jsonb_array_length(admin_trigger_history(:'mail_id')) = 4);
select admin_trigger_delete(:'mail_id');
select t.ok('delete removes runs', (select count(*) = 0 from admin_trigger_runs where trigger_id = :'mail_id'));
select t.ok('audit recorded', (select count(distinct action) = 6 from admin_audit where action in ('create_trigger', 'edit_trigger', 'pause_trigger', 'resume_trigger', 'run_trigger', 'delete_trigger')));
\echo all trigger checks passed
