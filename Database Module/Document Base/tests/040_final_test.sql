-- Document Base tests, part 5 (final fix wave): run lock, planning stage, rollback/resume, client pilot approval,
-- stored area/kind, report speed (initplan policies), ex-employees, duplicate groups. Run by run-local.sh after 030.
-- Invented names only. Uses the admin (a1), staff (b2) and CEO (c3) users that part 1 created.
\set QUIET on
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;
create or replace function pg_temp.stage() returns text language sql as $$ select stage from od_copy.settings $$;
create or replace function pg_temp.rejects(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'ok   %', label; return; end;
  raise exception 'FAIL % was accepted', label;
end $$;
create or replace function pg_temp.as_admin(stmt text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
  execute 'set local role authenticated';
  execute stmt into r;
  execute 'reset role';
  return r;
end $$;

-- ---------- 3: policies are evaluated once per query (initplan) ----------
select pg_temp.check('every od_copy read policy wraps can_read() in a sub-select',
  (select bool_and(qual ilike '%select od_copy.can_read()%') from pg_policies
   where schemaname = 'od_copy' and policyname like '%\_read' and tablename <> 'client_folders'));
select pg_temp.check('read policies exist for all 8 tables',
  (select count(*) = 8 from pg_policies where schemaname = 'od_copy' and policyname like '%\_read'));
select pg_temp.check('client_folders policy wraps auth.uid() in a sub-select',
  (select qual ilike '%select auth.uid()%' from pg_policies where schemaname = 'od_copy' and policyname = 'client_folders_read'));

-- ---------- 9: stage 'planning' ----------
update od_copy.settings set stage = 'planning', stage_before_pause = null, rollback_scope = null;
select pg_temp.check('stage planning accepted', pg_temp.stage() = 'planning');
select pg_temp.rejects('unknown stage still refused', $$update od_copy.settings set stage = 'verifying'$$);
select pg_temp.check('pause from planning', pg_temp.as_admin($$select od_copy.set_stage('paused')$$) = 'paused');
select pg_temp.check('resume back to planning', pg_temp.as_admin($$select od_copy.set_stage('resume')$$) = 'planning');

-- ---------- 2: run lock ----------
update od_copy.settings set running_until = null, run_token = null, delta_link = 'https://graph.microsoft.com/v1.0/old';
create temp table lk (name text primary key, token uuid);
insert into lk select 'a', od_copy.try_lock(150);
insert into lk select 'b', od_copy.try_lock(150);
select pg_temp.check('first run takes the lock', (select token is not null from lk where name = 'a'));
select pg_temp.check('second run is refused while the lock is held', (select token is null from lk where name = 'b'));
select pg_temp.check('the holder saves the delta link',
  od_copy.save_delta_link((select token from lk where name = 'a'), 'https://graph.microsoft.com/v1.0/new'));
select pg_temp.check('a wrong token cannot save the delta link',
  not od_copy.save_delta_link(gen_random_uuid(), 'https://graph.microsoft.com/v1.0/stale')
  and (select delta_link from od_copy.settings) = 'https://graph.microsoft.com/v1.0/new');
select pg_temp.check('a wrong token cannot unlock', not od_copy.unlock(gen_random_uuid()) and (select running_until is not null from od_copy.settings));
select pg_temp.check('the holder unlocks', od_copy.unlock((select token from lk where name = 'a')));
select pg_temp.check('the lock is free after unlock', (select running_until is null and run_token is null from od_copy.settings));
insert into lk select 'c', od_copy.try_lock(150);
update od_copy.settings set running_until = now() - interval '1 second';
select pg_temp.check('an expired holder can no longer save the delta link (never moves backwards)',
  not od_copy.save_delta_link((select token from lk where name = 'c'), 'https://graph.microsoft.com/v1.0/stale')
  and (select delta_link from od_copy.settings) = 'https://graph.microsoft.com/v1.0/new');
insert into lk select 'd', od_copy.try_lock(150);
select pg_temp.check('an expired lock can be taken by the next run', (select token is not null from lk where name = 'd'));
select od_copy.unlock((select token from lk where name = 'd'));
select pg_temp.check('try_lock: service_role only', has_function_privilege('service_role', 'od_copy.try_lock(int)', 'execute')
  and not has_function_privilege('authenticated', 'od_copy.try_lock(int)', 'execute')
  and not has_function_privilege('authenticated', 'od_copy.unlock(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'od_copy.save_delta_link(uuid,text)', 'execute'));
-- Two sessions at once: exactly one gets the lock.
create extension if not exists dblink;
do $$
declare
  cs text := format('dbname=%s port=%s host=127.0.0.1 user=postgres', current_database(), current_setting('port'));
  a uuid;
  b uuid;
begin
  perform dblink_connect('la', cs);
  perform dblink_connect('lb', cs);
  perform dblink_exec('la', 'begin');
  select t into a from dblink('la', 'select od_copy.try_lock(150)') as x(t uuid);
  perform dblink_send_query('lb', 'select od_copy.try_lock(150)');
  perform pg_sleep(0.2);
  perform dblink_exec('la', 'commit');
  select t into b from dblink_get_result('lb') as x(t uuid);
  perform dblink_disconnect('la');
  perform dblink_disconnect('lb');
  perform pg_temp.check('concurrent try_lock: one winner', a is not null and b is null);
  perform od_copy.unlock(a);
end $$;

-- ---------- 11: rollback ends paused and Resume returns to the stage before it; Pause stops a rollback ----------
update od_copy.settings set stage = 'done', stage_before_pause = null, rollback_scope = '{"all": true}'::jsonb;
select pg_temp.check('done -> rollback', pg_temp.as_admin($$select od_copy.set_stage('rollback')$$) = 'rollback');
select pg_temp.check('rollback remembers done', (select stage_before_pause = 'done' from od_copy.settings));
-- The Edge Function finishes a pass: stage -> paused (setStage('paused', ['rollback']) changes only the stage).
update od_copy.settings set stage = 'paused' where stage = 'rollback';
select pg_temp.check('resume after a finished rollback goes back to done', pg_temp.as_admin($$select od_copy.set_stage('resume')$$) = 'done');
select pg_temp.check('rollback again', pg_temp.as_admin($$select od_copy.set_stage('rollback')$$) = 'rollback');
select pg_temp.check('pause stops a rollback', pg_temp.as_admin($$select od_copy.set_stage('paused')$$) = 'paused'
  and (select stage_before_pause = 'done' from od_copy.settings));
select pg_temp.check('resume after a stopped rollback goes back to done, not to rollback',
  pg_temp.as_admin($$select od_copy.set_stage('resume')$$) = 'done');
update od_copy.settings set stage = 'idle', stage_before_pause = null, rollback_scope = null;

-- ---------- 3: area and kind stored on plan; report reads them and matches the per-file map ----------
select od_copy.build_plan();
select pg_temp.check('every plan row has area and kind after build_plan',
  not exists (select 1 from od_copy.plan where area is null or kind is null));
select pg_temp.check('stored area and kind equal the file map',
  not exists (select 1 from od_copy.plan p join od_copy.item_map i on i.item_id = p.source_item_id
              where (p.area, p.kind) is distinct from (i.area, i.kind)));
select pg_temp.check('report counts match the per-file map', not exists (
  with old as (
    select i.area, count(*) as files, round(coalesce(sum(i.size), 0) / 1073741824.0, 3) as gb,
      count(*) filter (where p.status = 'skipped_duplicate') as duplicates,
      count(*) filter (where p.status = 'planned') as planned,
      count(*) filter (where p.status = 'approved') as approved,
      count(*) filter (where p.status = 'verified') as verified,
      count(*) filter (where p.status = 'failed') as failed,
      count(*) filter (where p.status = 'verified' and p.hash_checked is false) as verified_size_only
    from od_copy.item_map i join od_copy.plan p on p.source_item_id = i.item_id group by i.area)
  select 1 from old full join od_copy.report r using (area)
  where (old.files, old.gb, old.duplicates, old.planned, old.approved, old.verified, old.failed, old.verified_size_only)
    is distinct from (r.files, r.gb, r.duplicates, r.planned, r.approved, r.verified, r.failed, r.verified_size_only)));
select pg_temp.check('report no longer reads item_map', position('item_map' in pg_get_viewdef('od_copy.report'::regclass)) = 0);
select pg_temp.check('approve no longer reads item_map',
  position('item_map' in pg_get_functiondef('od_copy.approve(text,text,text)'::regprocedure)) = 0);

-- ---------- 5: client pilot through admin_approve; bulk approval only after a verified pilot ----------
delete from od_copy.plan where source_item_id like 'pl-%';
insert into public.client_master (client_id, legal_name) values ('CL900070', 'Pilotia Testco LLC'), ('CL900071', 'Otheria Testco LLC')
  on conflict do nothing;
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash, modified_at, is_folder) values
  ('pl-1', '4. VAT Clients/Pilotia Testco LLC/KYC', 'a.pdf', 1000, 'hpl1', '2025-01-01', false),
  ('pl-2', '4. VAT Clients/Pilotia Testco LLC/Invoices', 'b.pdf', 2000, 'hpl2', '2025-01-01', false),
  ('pl-3', '4. VAT Clients/Otheria Testco LLC/KYC', 'c.pdf', 3000, 'hpl3', '2025-01-01', false)
on conflict (item_id) do nothing;
select od_copy.build_plan();
-- Clean slate: no verified rows, everything still planned.
update od_copy.plan set status = 'planned' where status in ('verified', 'approved', 'copying', 'failed');
update od_copy.settings set stage = 'plan';
select pg_temp.check('report splits planned files into matched and unmatched with GB',
  (select sum(planned_matched) > 0 and sum(planned_unmatched) > 0 and sum(planned_matched + planned_unmatched) = sum(planned)
          and sum(planned_matched_gb) >= 0 from od_copy.report));
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.rejects('bulk approval refused before a pilot is verified', $$select od_copy.admin_approve('all')$$);
select pg_temp.rejects('unmatched approval refused before a pilot is verified', $$select od_copy.admin_approve('unmatched')$$);
select pg_temp.rejects('client pilot needs a client id', $$select od_copy.admin_approve('client')$$);
select pg_temp.check('client pilot approves only that client', od_copy.admin_approve('client', 'CL900070') = 2);
reset role;
select pg_temp.check('pilot moved the stage plan -> approved', pg_temp.stage() = 'approved');
select pg_temp.check('only the pilot client is approved',
  (select array_agg(source_item_id order by source_item_id) = array['pl-1', 'pl-2'] from od_copy.plan where status = 'approved'));
-- The pilot is copied and verified.
update od_copy.plan set status = 'verified', dest_item_id = 'D-' || source_item_id where client_id = 'CL900070';
update od_copy.settings set stage = 'done';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c3', false);
select pg_temp.check('CEO may approve one area after the pilot',
  od_copy.admin_approve('all', '4. VAT Clients') = (select count(*) from od_copy.plan p where p.status = 'planned' and p.area = '4. VAT Clients'
    and (p.kind <> 'client' or p.client_id is not null)));
reset role;
select pg_temp.check('area approval moved done -> approved', pg_temp.stage() = 'approved');
select pg_temp.check('area approval left other areas planned', exists (select 1 from od_copy.plan where status = 'planned' and area <> '4. VAT Clients'));
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.rejects('staff cannot run the pilot', $$select od_copy.admin_approve('client', 'CL900071')$$);
reset role;

-- ---------- 1: failed rows keep the copy's id for review ----------
update od_copy.plan set status = 'failed', dest_item_id = 'D-pl-3', error = 'verify mismatch: invented' where source_item_id = 'pl-3';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('failed_items shows the destination id and the area',
  (select dest_item_id = 'D-pl-3' and area = '4. VAT Clients' from od_copy.failed_items where source_item_id = 'pl-3'));
reset role;

-- ---------- 1, 7: claim returns the listing's modified time and the deferral counters ----------
update od_copy.plan set status = 'planned' where status in ('approved', 'copying');
update od_copy.plan set status = 'copying', deferrals = 3, deferred_since = now() - interval '5 minutes', updated_at = now() - interval '1 hour'
  where source_item_id = 'pl-1';
select pg_temp.check('claim returns modified_at, deferrals and deferred_since',
  (select modified_at = '2025-01-01'::timestamptz and deferrals = 3 and deferred_since is not null
   from od_copy.claim('copying', 10) where source_item_id = 'pl-1'));
select pg_temp.check('new plan rows start with 0 deferrals', (select deferrals = 0 and deferred_since is null from od_copy.plan where source_item_id = 'pl-2'));

-- ---------- 14: ex-employees go to 00 EX EMPLOYEES ----------
insert into public.hr_employees (employee_code, full_name, status, exit_date) values
  ('EMP951', 'Quill Leftperson', 'Left', null), ('EMP952', 'Rory Exitdate', 'Active', '2025-06-30'), ('EMP953', 'Sana Current', 'Active', null);
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash, modified_at, is_folder) values
  ('em-1', 'Employee Folders/Quill Leftperson/Docs', 'cv.pdf', 11, 'hem1', '2025-01-01', false),
  ('em-2', 'Employee Folders/Rory Exitdate', 'id.pdf', 12, 'hem2', '2025-01-01', false),
  ('em-3', 'Employee Folders/Sana Current', 'cv.pdf', 13, 'hem3', '2025-01-01', false)
on conflict (item_id) do nothing;
select od_copy.build_plan();
select pg_temp.check('status Left -> 00 EX EMPLOYEES/<Full Name> - <Code>/OTHERS',
  (select target_path = 'EMPLOYEES/00 EX EMPLOYEES/Quill Leftperson - EMP951/OTHERS/Docs/cv.pdf' from od_copy.plan where source_item_id = 'em-1'));
select pg_temp.check('exit date set -> 00 EX EMPLOYEES',
  (select target_path = 'EMPLOYEES/00 EX EMPLOYEES/Rory Exitdate - EMP952/OTHERS/id.pdf' from od_copy.plan where source_item_id = 'em-2'));
select pg_temp.check('current employee unchanged',
  (select target_path = 'EMPLOYEES/Sana Current - EMP953/OTHERS/cv.pdf' from od_copy.plan where source_item_id = 'em-3'));
select pg_temp.check('employee_label still answers for current and ex-employees',
  od_copy.employee_label('Sana Current') = 'Sana Current - EMP953' and od_copy.employee_label('quill leftperson') = 'Quill Leftperson - EMP951');

-- ---------- 15: duplicates list shows every location of a group ----------
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash, modified_at, is_folder) values
  ('dg-1', '4. VAT Clients/Pilotia Testco LLC/KYC', 'same.pdf', 777, 'hdg', '2025-01-01', false),
  ('dg-2', 'Desktop', 'same copy.pdf', 777, 'hdg', '2024-01-01', false),
  ('dg-3', 'Documents/Old', 'same.pdf', 777, 'hdg', '2023-01-01', false)
on conflict (item_id) do nothing;
select od_copy.build_plan();
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('duplicate group: keeper path and both skipped paths',
  (select keeper_path = '4. VAT Clients/Pilotia Testco LLC/KYC/same.pdf' and copies_skipped = 2
          and skipped_paths = array['Desktop/same copy.pdf', 'Documents/Old/same.pdf']
   from od_copy.duplicate_groups where keeper_id = 'dg-1'));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.check('staff sees no duplicate groups', (select count(*) = 0 from od_copy.duplicate_groups));
reset role;

update od_copy.settings set stage = 'idle', stage_before_pause = null, rollback_scope = null, running_until = null, run_token = null;
select 'final tests passed';
