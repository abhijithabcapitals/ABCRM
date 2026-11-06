-- Document Base tests. Run by run-local.sh with ON_ERROR_STOP=1; any failed check raises and stops the run.
-- Part 1 (schema and rule tables). Later tasks append plan-function tests below.
\set QUIET on
create or replace function pg_temp.check(label text, ok boolean) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FAIL %', label; end if;
  raise notice 'ok   %', label;
end $$;

-- every table exists
select pg_temp.check('table od_copy.' || t, to_regclass('od_copy.' || t) is not null)
from unnest(array['settings','source_items','area_rules','folder_rules','client_matches','plan','client_folders','operations']) t;

-- RLS on every table
select pg_temp.check('rls on od_copy.' || c.relname, c.relrowsecurity)
from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'od_copy' and c.relkind = 'r';

-- settings: one row, idle, rollback_scope column present
select pg_temp.check('settings has exactly one idle row', (select count(*) = 1 and bool_and(stage = 'idle') from od_copy.settings));
select pg_temp.check('settings.rollback_scope jsonb', exists (select 1 from information_schema.columns
  where table_schema = 'od_copy' and table_name = 'settings' and column_name = 'rollback_scope' and data_type = 'jsonb'));
do $$ begin
  begin insert into od_copy.settings (id) values (false); raise exception 'FAIL second settings row accepted';
  exception when check_violation or unique_violation then raise notice 'ok   settings rejects a second row'; end;
end $$;

-- area_rules
select pg_temp.check('area 2. Accounting Clients -> Accounting/client/Accounting', exists (select 1 from od_copy.area_rules
  where area = '2. Accounting Clients' and department = 'Accounting' and kind = 'client' and service = 'Accounting'));
select pg_temp.check('area Desktop -> archive', exists (select 1 from od_copy.area_rules where area = 'Desktop' and kind = 'archive'));
select pg_temp.check('area Bank Account Clients two-segment prefix', exists (select 1 from od_copy.area_rules
  where area = 'Banking ACCOUNT ABC/Bank Account Clients' and department = 'Business Banking' and kind = 'client'));
select pg_temp.check('area LOAN CLIENTS -> Business Banking', exists (select 1 from od_copy.area_rules where area = 'LOAN CLIENTS' and department = 'Business Banking'));
select pg_temp.check('area rules cover 25 areas', (select count(*) = 25 from od_copy.area_rules));

-- folder_rules
select pg_temp.check('folder kyc -> KYC', exists (select 1 from od_copy.folder_rules where pattern = 'kyc' and folder = 'KYC' and not is_regex));
select pg_temp.check('folder bank statement -> FINANCIALS INFORMATION', exists (select 1 from od_copy.folder_rules
  where pattern = 'bank statement' and folder = 'FINANCIALS INFORMATION'));
select pg_temp.check('folder year regex rule', exists (select 1 from od_copy.folder_rules where is_regex and folder = 'FINANCIALS INFORMATION' and '2024' ~ pattern and '2031' !~ pattern and '2018' !~ pattern));
select pg_temp.check('folder rules have unique priorities', (select count(*) = count(distinct priority) from od_copy.folder_rules));

-- operations is append-only
insert into od_copy.operations (action, result) values ('test', 'ok');
do $$ begin
  begin update od_copy.operations set result = 'changed'; raise exception 'FAIL operations update allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   operations update raises'; end;
  begin delete from od_copy.operations; raise exception 'FAIL operations delete allowed';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   operations delete raises'; end;
end $$;

-- RLS behaviour: anonymous-style user sees nothing, admin and CEO see rows, service_role may write.
insert into public.profiles (id, role) values ('00000000-0000-0000-0000-0000000000a1', 'admin'), ('00000000-0000-0000-0000-0000000000b2', 'staff')
  on conflict do nothing;
insert into ceo.profiles (user_id, role) values ('00000000-0000-0000-0000-0000000000c3', 'owner') on conflict do nothing;
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.check('staff sees no area_rules', (select count(*) = 0 from od_copy.area_rules));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('admin sees area_rules', (select count(*) > 0 from od_copy.area_rules));
select set_config('test.uid', '00000000-0000-0000-0000-0000000000c3', false);
select pg_temp.check('CEO sees area_rules', (select count(*) > 0 from od_copy.area_rules));
do $$ begin
  begin insert into od_copy.operations (action) values ('x'); raise exception 'FAIL authenticated write allowed';
  exception when insufficient_privilege then raise notice 'ok   authenticated cannot write'; end;
end $$;
reset role;
set role service_role;
update od_copy.settings set batch_size = 20;
select pg_temp.check('service_role can write', true);
reset role;
