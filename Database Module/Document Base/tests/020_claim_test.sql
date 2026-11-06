-- Document Base tests, part 3: od_copy.claim (work queue for the copy Edge Function) and od_copy.rollback_candidates.
-- Run by run-local.sh after 010. Two concurrent claims are made over two dblink sessions, each inside its own open
-- transaction. Invented names only.
\set QUIET on
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;

create extension if not exists dblink;

-- Only this test's rows are in the queue.
update od_copy.plan set status = 'planned' where status in ('approved', 'copying');
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash)
select 'ct-' || i, 'Claim Test', 'f' || i || '.pdf', i * 10, 'h' || i from generate_series(1, 9) i
on conflict (item_id) do nothing;
insert into od_copy.plan (source_item_id, source_path, target_path, status)
select 'ct-' || i, 'Claim Test/f' || i || '.pdf', 'Claim Area/f' || i || '.pdf', case when i <= 6 then 'approved' else 'planned' end
from generate_series(1, 9) i
on conflict (source_item_id) do nothing;

-- Two sessions claim at the same time: A holds its transaction open while B claims.
do $$
declare
  cs text := format('dbname=%s port=%s host=127.0.0.1 user=postgres', current_database(), current_setting('port'));
  a text[];
  b text[];
begin
  perform dblink_connect('ca', cs);
  perform dblink_connect('cb', cs);
  perform dblink_exec('ca', 'begin');
  select array_agg(id order by id) into a from dblink('ca', $q$select source_item_id from od_copy.claim('approved', 3)$q$) as t(id text);
  perform dblink_exec('cb', 'begin');
  select array_agg(id order by id) into b from dblink('cb', $q$select source_item_id from od_copy.claim('approved', 6)$q$) as t(id text);
  perform dblink_exec('ca', 'commit');
  perform dblink_exec('cb', 'commit');
  perform dblink_disconnect('ca');
  perform dblink_disconnect('cb');
  perform pg_temp.check('claim A got 3 rows', cardinality(a) = 3);
  perform pg_temp.check('claim B (concurrent) got the other 3 rows', cardinality(b) = 3);
  perform pg_temp.check('concurrent claims never return the same row', not (a && b));
  perform pg_temp.check('A and B together cover all 6 approved rows', (select count(distinct x) = 6 from unnest(a || b) x));
end $$;

select pg_temp.check('claimed rows are copying with no monitor URL', (select count(*) = 6 from od_copy.plan
  where source_item_id like 'ct-%' and status = 'copying' and monitor_url is null));

-- In-flight cap: 6 rows copying, limit 4 -> nothing new.
update od_copy.plan set status = 'approved' where source_item_id = 'ct-7';
select pg_temp.check('approved claim respects the in-flight cap', (select count(*) = 0 from od_copy.claim('approved', 4)));
select pg_temp.check('capped row stays approved', (select status = 'approved' from od_copy.plan where source_item_id = 'ct-7'));

-- Lease: copying rows touched just now are not handed out again; with lease 0 they are, with size and hash.
select pg_temp.check('copying rows are leased (default 150 s)', (select count(*) = 0 from od_copy.claim('copying', 10)));
select pg_temp.check('copying claim with lease 0 returns the rows with size and hash',
  (select count(*) = 6 and bool_and(size is not null and quickxor_hash is not null) from od_copy.claim('copying', 10, 0)));
select pg_temp.check('copying claim keeps the status', (select count(*) = 6 from od_copy.plan where source_item_id like 'ct-%' and status = 'copying'));

-- Retry back-off and order: a row that failed before waits; fresh rows go first.
update od_copy.plan set status = 'planned' where source_item_id in ('ct-1', 'ct-2', 'ct-3', 'ct-4', 'ct-5', 'ct-6');
update od_copy.plan set status = 'approved', attempts = 1, updated_at = now() where source_item_id = 'ct-7';
select pg_temp.check('recently failed row waits for the back-off', (select count(*) = 0 from od_copy.claim('approved', 4)));
select pg_temp.check('after the back-off the row is claimed', (select array_agg(source_item_id) = array['ct-7'] from od_copy.claim('approved', 4, 0)));
update od_copy.plan set status = 'approved', attempts = 2, updated_at = now() - interval '1 hour' where source_item_id = 'ct-8';
update od_copy.plan set status = 'approved', attempts = 0 where source_item_id = 'ct-9';
update od_copy.plan set status = 'planned' where source_item_id = 'ct-7';
select pg_temp.check('rows never tried go first', (select array_agg(source_item_id) = array['ct-9'] from od_copy.claim('approved', 1)));

do $$ begin
  begin perform od_copy.claim('verified', 1); raise exception 'FAIL claim accepted status verified';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   claim rejects other statuses'; end;
end $$;

-- rollback_candidates: only verified rows with a recorded destination id, by area (longest rule), client and cursor.
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash) values
  ('rb-1', 'Banking ACCOUNT ABC', 'x.pdf', 1, 'r1'),
  ('rb-2', 'Banking ACCOUNT ABC/Bank Account Clients/Alpha Testco', 'y.pdf', 2, 'r2'),
  ('rb-3', '', 'root.pdf', 3, 'r3'),
  ('rb-4', 'Desktop', 'nodest.pdf', 4, 'r4'),
  ('rb-5', 'Desktop', 'gone.pdf', 5, 'r5')
on conflict (item_id) do nothing;
insert into od_copy.plan (source_item_id, source_path, target_path, client_id, status, dest_item_id) values
  ('rb-1', 'Banking ACCOUNT ABC/x.pdf', 'Business Banking/00 Bank Partner Documents/x.pdf', null, 'verified', 'D-rb-1'),
  ('rb-2', 'Banking ACCOUNT ABC/Bank Account Clients/Alpha Testco/y.pdf', 'Business Banking/Alpha Testco LLC - CL900009/OTHERS/Bank Account/y.pdf', 'CL900009', 'verified', 'D-rb-2'),
  ('rb-3', 'root.pdf', '08 Archive/From old OneDrive/(root files)/root.pdf', null, 'verified', 'D-rb-3'),
  ('rb-4', 'Desktop/nodest.pdf', '08 Archive/From old OneDrive/Desktop/nodest.pdf', null, 'verified', null),
  ('rb-5', 'Desktop/gone.pdf', '08 Archive/From old OneDrive/Desktop/gone.pdf', null, 'rolled_back', 'D-rb-5')
on conflict (source_item_id) do nothing;

select pg_temp.check('rollback area excludes the longer client area', (select array_agg(source_item_id) = array['rb-1']
  from od_copy.rollback_candidates('Banking ACCOUNT ABC', null, null, 50) where source_item_id like 'rb-%'));
select pg_temp.check('rollback client area', (select array_agg(source_item_id) = array['rb-2']
  from od_copy.rollback_candidates('Banking ACCOUNT ABC/Bank Account Clients', null, null, 50)));
select pg_temp.check('rollback root files', (select array_agg(source_item_id) = array['rb-3']
  from od_copy.rollback_candidates('(root files)', null, null, 50) where source_item_id like 'rb-%'));
select pg_temp.check('rollback by client', (select array_agg(source_item_id) = array['rb-2']
  from od_copy.rollback_candidates(null, 'CL900009', null, 50)));
select pg_temp.check('rollback skips rows without a destination id and rows not verified', (select count(*) = 0
  from od_copy.rollback_candidates('Desktop', null, null, 50)));
select pg_temp.check('rollback pages after the cursor', (select array_agg(source_item_id order by source_item_id) = array['rb-2', 'rb-3']
  from od_copy.rollback_candidates(null, null, 'rb-1', 50) where source_item_id like 'rb-%'));

-- hash_checked: size-only verification is flagged and counted in the report.
select pg_temp.check('plan.hash_checked boolean', exists (select 1 from information_schema.columns
  where table_schema = 'od_copy' and table_name = 'plan' and column_name = 'hash_checked' and data_type = 'boolean'));
update od_copy.plan set hash_checked = false where source_item_id = 'rb-1';
update od_copy.plan set hash_checked = true where source_item_id = 'rb-2';
select pg_temp.check('report counts size-only verified copies', (select sum(verified_size_only) = 1 from od_copy.report));

-- Grants: service_role only.
select pg_temp.check('claim: service_role may execute', has_function_privilege('service_role', 'od_copy.claim(text,int,int)', 'execute'));
select pg_temp.check('claim: authenticated may not', not has_function_privilege('authenticated', 'od_copy.claim(text,int,int)', 'execute'));
select pg_temp.check('claim: anon may not', not has_function_privilege('anon', 'od_copy.claim(text,int,int)', 'execute'));
select pg_temp.check('rollback_candidates: authenticated may not',
  not has_function_privilege('authenticated', 'od_copy.rollback_candidates(text,text,text,int)', 'execute'));
select pg_temp.check('rollback_candidates: service_role may execute',
  has_function_privilege('service_role', 'od_copy.rollback_candidates(text,text,text,int)', 'execute'));

select 'claim tests passed';
