-- Prints "ok ..." per check and stops at the first failure. Runs on the throwaway cluster after 010.
\set ON_ERROR_STOP on
create schema t2;
grant usage on schema t2 to public;
create function t2.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function t2.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok %', label;
    return;
  end;
  raise exception 'FAILED: % (it worked)', label;
end $$;
grant execute on all functions in schema t2 to public;

alter table public.profiles add column if not exists full_name text, add column if not exists email text;
insert into public.profiles (id, role, full_name, email) values
  ('ad000000-0000-0000-0000-00000000000a', 'admin', 'Ada Admin', 'ada@test.local'),
  ('be000000-0000-0000-0000-00000000000b', 'member', 'Mo Member', 'mo@test.local');

create table public.deals (id serial primary key, name text, passport_number text, password_hash text, api_key text, prompt_tokens int, notes text, updated_at timestamptz, position int);
create table public.pairs (a int, b int, v text, primary key (a, b));
create schema ceo;
create table ceo.records (id serial primary key, body text);
grant all on public.deals, public.pairs to authenticated;
grant all on all sequences in schema public to authenticated;
grant usage on schema ceo to authenticated;
grant all on ceo.records to authenticated;
grant all on all sequences in schema ceo to authenticated;

select t2.ok('the first attach reports no failures', (select failed = '{}' and attached >= 3 from public.audit_trail_attach_all()));
select t2.ok('attaching again adds nothing', (select attached = 0 from public.audit_trail_attach_all()));
select t2.ok('log tables get no trigger', not exists (select 1 from pg_trigger where tgname = 'audit_trail_row' and tgrelid in ('public.audit_trail'::regclass, 'public.admin_audit'::regclass)));
select t2.ok('the hourly job is scheduled', exists (select 1 from cron.job where jobname = 'audit-trail-attach'));

-- A member's changes, with identity
set test.uid = 'be000000-0000-0000-0000-00000000000b';
set request.jwt.claims = '{"role":"authenticated","email":"mo@test.local"}';
set role authenticated;
insert into public.deals (name, passport_number, password_hash, api_key, prompt_tokens, notes, position) values ('First', 'P123', 'abc', 'k-1', 5, repeat('x', 5000), 1);
update public.deals set position = 2 where name = 'First';
update public.deals set position = 2 where name = 'First';
update public.deals set updated_at = now() where name = 'First';
update public.deals set password_hash = 'def' where name = 'First';
delete from public.deals where name = 'First';
insert into public.pairs values (1, 2, 'x');
delete from public.pairs;
insert into ceo.records (body) values ('private mail');
select t2.fails('a member cannot write the log directly', $$insert into public.audit_trail (source, table_schema, table_name, action) values ('x', 'y', 'z', 'INSERT')$$);
select t2.ok('a member cannot read the log', (select count(*) = 0 from public.audit_trail));
reset role;

create temp view log as select * from public.audit_trail where table_name in ('deals', 'pairs', 'records') order by id;
select t2.ok('add, moved, secret change and delete give 4 rows on deals', (select count(*) = 4 from log where table_name = 'deals'));
select t2.ok('the add names the user', (select actor = 'be000000-0000-0000-0000-00000000000b' and actor_name = 'Mo Member' and actor_email = 'mo@test.local' and source = 'authenticated' from log where action = 'INSERT' and table_name = 'deals'));
select t2.ok('the add stores the row id and passport in full', (select row_id = '1' and new_values ->> 'passport_number' = 'P123' from log where action = 'INSERT' and table_name = 'deals'));
select t2.ok('passwords and keys are hidden', (select new_values ->> 'password_hash' = '[hidden]' and new_values ->> 'api_key' = '[hidden]' from log where action = 'INSERT' and table_name = 'deals'));
select t2.ok('token counts are not mistaken for secrets', (select new_values ->> 'prompt_tokens' = '5' from log where action = 'INSERT' and table_name = 'deals'));
select t2.ok('very long text is shortened', (select new_values ->> 'notes' = '[long text, 5000 characters]' from log where action = 'INSERT' and table_name = 'deals'));
select t2.ok('a move stores old and new of that field only', (select changed = '{position}' and old_values = '{"position": 1}' and new_values = '{"position": 2}' from log where action = 'UPDATE' and changed = '{position}'));
select t2.ok('a save that changes nothing, or only updated_at, is not logged', (select count(*) = 2 from log where action = 'UPDATE' and table_name = 'deals'));
select t2.ok('a secret change is logged without its value', (select old_values ->> 'password_hash' = '[hidden]' and new_values ->> 'password_hash' = '[hidden]' from log where changed = '{password_hash}'));
select t2.ok('a delete keeps the old row', (select row_id = '1' and old_values ->> 'name' = 'First' and new_values is null from log where action = 'DELETE' and table_name = 'deals'));
select t2.ok('a two-column key is recorded', (select row_id = '1/2' from log where table_name = 'pairs' and action = 'INSERT'));
select t2.ok('private mail logs the change without values', (select old_values is null and new_values is null and actor_name = 'Mo Member' from log where table_name = 'records'));

-- A job or service with no user
set test.uid = '';
set request.jwt.claims = '{"role":"service_role"}';
insert into public.deals (name) values ('By a function');
insert into ceo.records (body) values ('synced mail');
select t2.ok('a function without a user is logged as such', (select actor is null and source = 'service_role' from log where new_values ->> 'name' = 'By a function'));
select t2.ok('background mail sync is not logged', (select count(*) = 1 from log where table_name = 'records'));

-- Admin reads; nobody changes it
set test.uid = 'ad000000-0000-0000-0000-00000000000a';
set request.jwt.claims = '{"role":"authenticated"}';
set role authenticated;
select t2.ok('an admin can read the log', (select count(*) > 0 from public.audit_trail));
select t2.fails('an admin cannot edit the log', $$update public.audit_trail set actor_name = 'x'$$);
select t2.fails('an admin cannot delete from the log', $$delete from public.audit_trail$$);
select t2.fails('a member cannot run the attach', $$select public.audit_trail_attach_all()$$);
reset role;
select t2.fails('even the owner cannot edit the log', $$update public.audit_trail set actor_name = 'x'$$);
select t2.fails('even the owner cannot delete from the log', $$delete from public.audit_trail$$);
select t2.fails('even the owner cannot empty the log', $$truncate public.audit_trail$$);

-- A new table is covered at the next hourly run
create table public.brand_new (id serial primary key);
select t2.ok('a new table is picked up', (select attached = 1 from public.audit_trail_attach_all()));
select 'all audit trail checks passed';
