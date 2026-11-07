-- Document Base tests, part 4: od_copy.set_stage, od_copy.admin_approve, od_copy.failed_items. Run by run-local.sh after 020.
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

update od_copy.settings set stage = 'idle', stage_before_pause = null, rollback_scope = null;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.rejects('staff cannot set stage', $$select od_copy.set_stage('inventory')$$);
select pg_temp.rejects('staff cannot approve', $$select od_copy.admin_approve('all')$$);
select pg_temp.check('staff sees no failed items', (select count(*) = 0 from od_copy.failed_items));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.rejects('unknown stage refused', $$select od_copy.set_stage('copying')$$);
select pg_temp.rejects('pause from idle refused', $$select od_copy.set_stage('paused')$$);
select pg_temp.rejects('resume when not paused refused', $$select od_copy.set_stage('resume')$$);
select pg_temp.rejects('rollback from idle refused', $$select od_copy.set_stage('rollback')$$);
select pg_temp.check('admin idle -> inventory', od_copy.set_stage('inventory') = 'inventory' and pg_temp.stage() = 'inventory');
select pg_temp.rejects('inventory twice refused', $$select od_copy.set_stage('inventory')$$);
select pg_temp.check('admin pauses inventory', od_copy.set_stage('paused') = 'paused' and pg_temp.stage() = 'paused');
select pg_temp.rejects('pause twice refused', $$select od_copy.set_stage('paused')$$);
select pg_temp.check('resume returns to the previous stage', od_copy.set_stage('resume') = 'inventory' and pg_temp.stage() = 'inventory');
select pg_temp.rejects('rollback without a scope refused', $$select od_copy.set_stage('rollback')$$);
reset role;

-- A stage that moved meanwhile wins: pausing from a stage the function does not expect is refused.
update od_copy.settings set stage = 'plan';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c3', false);
select pg_temp.check('CEO may pause the plan stage', od_copy.set_stage('paused') = 'paused');
select pg_temp.check('CEO resumes to plan', od_copy.set_stage('resume') = 'plan');
reset role;

-- Rollback needs a scope and a done or paused stage.
update od_copy.settings set stage = 'done', rollback_scope = '{"all": true}'::jsonb;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('done -> rollback with a scope', od_copy.set_stage('rollback') = 'rollback' and pg_temp.stage() = 'rollback');
select pg_temp.check('pause stops a rollback', od_copy.set_stage('paused') = 'paused');
reset role;
update od_copy.settings set stage = 'paused', stage_before_pause = null;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.rejects('resume with nothing to resume refused', $$select od_copy.set_stage('resume')$$);
select pg_temp.check('paused -> rollback with a scope', od_copy.set_stage('rollback') = 'rollback');
reset role;

-- admin_approve: approves through approve() and moves plan -> approved.
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash)
values ('st-1', 'Stage Test', 'a.pdf', 10, 'sh1'), ('st-2', 'Stage Test', 'b.pdf', 20, 'sh2'), ('st-3', 'Stage Test', 'c.pdf', 30, 'sh3'),
       ('st-4', 'Stage Test', 'd.pdf', 20, 'sh2') on conflict (item_id) do nothing;
insert into od_copy.plan (source_item_id, source_path, target_path, status, duplicate_of, attempts, error) values
  ('st-1', 'Stage Test/a.pdf', 'Stage Area/a.pdf', 'failed', null, 5, 'copy failed: invented'),
  ('st-2', 'Stage Test/b.pdf', 'Stage Area/b.pdf', 'failed', null, 5, 'invented too'),
  ('st-3', 'Stage Test/c.pdf', 'Stage Area/c.pdf', 'verified', null, 0, null),
  ('st-4', 'Stage Test/d.pdf', 'Stage Area/d.pdf', 'skipped_duplicate', 'st-2', 0, null)
on conflict (source_item_id) do nothing;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('failed_items lists failed rows only', (select count(*) = 2 from od_copy.failed_items where source_item_id like 'st-%'));
select pg_temp.check('failed_items counts skipped duplicates of a failed keeper',
  (select duplicates_not_copied = 1 from od_copy.failed_items where source_item_id = 'st-2')
  and (select duplicates_not_copied = 0 from od_copy.failed_items where source_item_id = 'st-1'));
select pg_temp.check('failed_items shows the path and the error',
  (select path = 'Stage Test/a.pdf' and error = 'copy failed: invented' from od_copy.failed_items where source_item_id = 'st-1'));
select pg_temp.rejects('admin_approve rejects a bad scope', $$select od_copy.admin_approve('everything')$$);
select pg_temp.rejects('admin_approve client pilot needs a client id', $$select od_copy.admin_approve('client')$$);
reset role;
update od_copy.settings set stage = 'plan', rollback_scope = null;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('admin_approve runs and moves plan -> approved', (select od_copy.admin_approve('all') >= 0) and pg_temp.stage() = 'approved');
reset role;
update od_copy.settings set stage = 'copying';
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('admin_approve leaves a copying stage alone', (select od_copy.admin_approve('unmatched') >= 0) and pg_temp.stage() = 'copying');
reset role;

-- R13: client_folders is readable by any signed-in user; the rest of od_copy is not.
insert into od_copy.client_folders (client_id, department, dest_item_id, web_url)
values ('CLST01', 'Accounting', 'dest-x', 'https://example.invalid/folder') on conflict do nothing;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.check('non-admin reads client_folders', (select count(*) >= 1 from od_copy.client_folders where client_id = 'CLST01'));
select pg_temp.check('non-admin still sees no plan rows', (select count(*) = 0 from od_copy.plan));
select pg_temp.check('non-admin still sees no settings', (select count(*) = 0 from od_copy.settings));
select pg_temp.check('non-admin still sees no failed_items', (select count(*) = 0 from od_copy.failed_items));
select pg_temp.check('non-admin still sees no client_matches', (select count(*) = 0 from od_copy.client_matches));
select pg_temp.rejects('non-admin cannot write client_folders', $$insert into od_copy.client_folders (client_id, department) values ('CLST02', 'x')$$);
select pg_temp.rejects('non-admin cannot call admin_approve', $$select od_copy.admin_approve('all')$$);
select pg_temp.rejects('non-admin cannot call set_stage', $$select od_copy.set_stage('inventory')$$);
select set_config('test.uid', '', false);
select pg_temp.check('no user id sees no client_folders', (select count(*) = 0 from od_copy.client_folders));
reset role;

-- Grants: authenticated and service_role may run them, anon may not.
select pg_temp.check('set_stage: authenticated may execute', has_function_privilege('authenticated', 'od_copy.set_stage(text)', 'execute'));
select pg_temp.check('set_stage: anon may not', not has_function_privilege('anon', 'od_copy.set_stage(text)', 'execute'));
select pg_temp.check('admin_approve: authenticated may execute', has_function_privilege('authenticated', 'od_copy.admin_approve(text,text)', 'execute'));
select pg_temp.check('admin_approve: anon may not', not has_function_privilege('anon', 'od_copy.admin_approve(text,text)', 'execute'));
select pg_temp.check('approve itself stays service_role only', not has_function_privilege('authenticated', 'od_copy.approve(text,text,text)', 'execute'));
update od_copy.settings set stage = 'idle', stage_before_pause = null, rollback_scope = null;

select 'stage tests passed';
