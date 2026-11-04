-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
drop schema if exists t cascade;
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
create function t.n(q text) returns bigint language plpgsql as $$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
grant execute on all functions in schema t to public;

-- Data as owner. 21 = admin, 22 and 23 = members.
insert into profiles values ('00000000-0000-0000-0000-000000000021', 'admin'), ('00000000-0000-0000-0000-000000000022', 'member'), ('00000000-0000-0000-0000-000000000023', 'member');
insert into microsoft_connection (tenant_id, status, client_secret_expires_on) values ('tenant-x', 'active', '2027-01-01');
insert into microsoft_user_links (profile_id, microsoft_user_id, upn, scopes, status) values
  ('00000000-0000-0000-0000-000000000022', 'ms-22', 'b@example.test', array['Chat.Create'], 'active'),
  ('00000000-0000-0000-0000-000000000023', 'ms-23', 'c@example.test', array['Chat.Create'], 'active');
insert into microsoft_sync_log (action, status, created_at) values ('old', 'ok', now() - interval '91 days'), ('recent', 'ok', now() - interval '89 days');

-- Member
select set_config('test.uid', '00000000-0000-0000-0000-000000000022', false);
set role authenticated;
select t.ok('member reads own link only', t.n('select * from microsoft_user_links') = 1 and t.n($$select * from microsoft_user_links where profile_id = '00000000-0000-0000-0000-000000000022'$$) = 1);
select t.fails('member cannot change own status', $$update microsoft_user_links set status = 'revoked'$$, 'permission denied');
select t.fails('member cannot insert a link', $$insert into microsoft_user_links (profile_id) values ('00000000-0000-0000-0000-000000000023')$$, 'permission denied');
select t.fails('member cannot delete a link', 'delete from microsoft_user_links', 'permission denied');
select t.ok('member sees no tenant data', t.n('select * from microsoft_connection') = 0);
select t.ok('member sees no log rows', t.n('select * from microsoft_sync_log') = 0);
select t.fails('member cannot write the connection', $$update microsoft_connection set status = 'revoked'$$, 'permission denied');
select t.fails('member cannot write the log', $$insert into microsoft_sync_log (action, status) values ('x', 'y')$$, 'permission denied');
select t.fails('authenticated cannot run ms_token_get', $$select ms_token_get('00000000-0000-0000-0000-000000000022')$$, 'permission denied');
select t.fails('authenticated cannot run ms_token_set', $$select ms_token_set('00000000-0000-0000-0000-000000000022', 'x')$$, 'permission denied');
select t.fails('authenticated cannot run ms_token_delete', $$select ms_token_delete('00000000-0000-0000-0000-000000000022')$$, 'permission denied');
select t.fails('authenticated cannot run ms365_prune_logs', 'select ms365_prune_logs()', 'permission denied');
select t.fails('authenticated cannot read vault.decrypted_secrets', 'select * from vault.decrypted_secrets', 'permission denied');
select t.fails('authenticated cannot read vault.secrets', 'select * from vault.secrets', 'permission denied');

-- Admin
reset role;
select set_config('test.uid', '00000000-0000-0000-0000-000000000021', false);
set role authenticated;
select t.ok('admin reads all links', t.n('select * from microsoft_user_links') = 2);
select t.ok('admin reads the connection', t.n('select * from microsoft_connection') = 1);
select t.ok('admin reads the log', t.n('select * from microsoft_sync_log') = 2);
select t.fails('admin cannot write from the browser', $$update microsoft_connection set status = 'revoked'$$, 'permission denied');
select t.fails('admin cannot run ms_token_get', $$select ms_token_get('00000000-0000-0000-0000-000000000022')$$, 'permission denied');

-- anon
reset role;
select set_config('test.uid', '', false);
set role anon;
select t.fails('anon reads no links', 'select * from microsoft_user_links', 'permission denied');
select t.fails('anon cannot run ms_token_get', $$select ms_token_get('00000000-0000-0000-0000-000000000022')$$, 'permission denied');
reset role;

-- One connection row only
select t.fails('second connection row refused', $$insert into microsoft_connection (id, status) values (false, 'active')$$, 'violates check');
select t.fails('duplicate connection row refused', $$insert into microsoft_connection (status) values ('active')$$, 'duplicate key');
select t.fails('bad connection status refused', $$update microsoft_connection set status = 'weird'$$, 'violates check');

-- Service role: token round trip
set role service_role;
select ms_token_set('00000000-0000-0000-0000-000000000022', 'rt-one');
select t.ok('service_role reads the token back', ms_token_get('00000000-0000-0000-0000-000000000022') = 'rt-one');
select ms_token_set('00000000-0000-0000-0000-000000000022', 'rt-two');
select t.ok('second set replaces the token', ms_token_get('00000000-0000-0000-0000-000000000022') = 'rt-two');
select t.ok('unknown profile gives null', ms_token_get('00000000-0000-0000-0000-000000000023') is null);
insert into microsoft_sync_log (action, status) values ('svc', 'ok');
select t.ok('service_role writes the log', t.n($$select * from microsoft_sync_log where action = 'svc'$$) = 1);
reset role;
select t.ok('token stored under ms_rt:<profile_id>, once', (select count(*) from vault.secrets where name = 'ms_rt:00000000-0000-0000-0000-000000000022') = 1);
set role service_role;
select ms_token_delete('00000000-0000-0000-0000-000000000022');
select t.ok('delete removes the token', ms_token_get('00000000-0000-0000-0000-000000000022') is null);
select ms_token_set('00000000-0000-0000-0000-000000000023', 'rt-three');   -- left for the rollback to remove

-- Guard
select t.fails('ms_token_set refuses a null token', $$select ms_token_set('00000000-0000-0000-0000-000000000022', null)$$, 'needs a profile and a token');
select t.fails('ms_token_set refuses an empty token', $$select ms_token_set('00000000-0000-0000-0000-000000000022', '')$$, 'needs a profile and a token');
select t.fails('ms_token_set refuses a null profile', $$select ms_token_set(null, 'x')$$, 'needs a profile and a token');
select t.ok('refused set stored nothing', ms_token_get('00000000-0000-0000-0000-000000000022') is null);

-- Removing a link, or deleting the login, removes the stored token
reset role;
insert into profiles values ('00000000-0000-0000-0000-000000000024', 'member'), ('00000000-0000-0000-0000-000000000025', 'member');
insert into microsoft_user_links (profile_id, microsoft_user_id, upn, status) values ('00000000-0000-0000-0000-000000000024', 'ms-24', 'd@example.test', 'active'), ('00000000-0000-0000-0000-000000000025', 'ms-25', 'e@example.test', 'active');
set role service_role;
select ms_token_set('00000000-0000-0000-0000-000000000024', 'rt-24');
select ms_token_set('00000000-0000-0000-0000-000000000025', 'rt-25');
delete from microsoft_user_links where profile_id = '00000000-0000-0000-0000-000000000024';
select t.ok('deleting a link removes its token', ms_token_get('00000000-0000-0000-0000-000000000024') is null);
reset role;
delete from profiles where id = '00000000-0000-0000-0000-000000000025';
select t.ok('deleting a login removes its token', (select count(*) from vault.secrets where name = 'ms_rt:00000000-0000-0000-0000-000000000025') = 0);
select t.ok('other tokens untouched', (select count(*) from vault.secrets where name = 'ms_rt:00000000-0000-0000-0000-000000000023') = 1);
select t.fails('authenticated cannot run the cleanup function', 'set role authenticated; select ms_token_cleanup_on_link_delete()', 'permission denied');
reset role;
set role service_role;

-- Prune
select ms365_prune_logs();
reset role;
select t.ok('prune removes the 91-day row', t.n($$select * from microsoft_sync_log where action = 'old'$$) = 0);
select t.ok('prune keeps the 89-day row', t.n($$select * from microsoft_sync_log where action = 'recent'$$) = 1);
select t.ok('all connection checks passed', true);
