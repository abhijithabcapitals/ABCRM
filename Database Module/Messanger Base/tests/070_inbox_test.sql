-- Prints "ok ..." per check and stops at the first failure. Data here is invented.
\set ON_ERROR_STOP on
\set boss 00000000-0000-0000-0000-000000000091
\set ana 00000000-0000-0000-0000-000000000092
\set raj 00000000-0000-0000-0000-000000000093
drop schema if exists i cascade;
create schema i;
grant usage on schema i to public;
create function i.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
create function i.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
grant execute on all functions in schema i to public;
create table i.ids (name text primary key, id uuid);
grant select, insert on i.ids to public;
create function i.id(n text) returns uuid language sql stable as $$ select id from i.ids where name = n $$;
grant execute on function i.id(text) to public;

insert into public.profiles (id, role, full_name) values (:'boss', 'admin', 'Boss'), (:'ana', 'member', 'Ana'), (:'raj', 'member', 'Raj');

-- Only admins connect, and no staff member reaches secrets or writes
set role authenticated;
select set_config('test.uid', :'ana', false);
select i.fails('a member cannot connect', $$select public.messenger_inbox_connect('telegram', 'X', '1')$$, 'Only an admin');
select i.fails('a member cannot list accounts for admins', $$select * from public.messenger_inbox_admin_list()$$, 'Only an admin');
select set_config('test.uid', :'boss', false);
insert into i.ids values ('wa', public.messenger_inbox_connect('whatsapp', 'Sales', 'pn1', '+971 sample'));
insert into i.ids values ('tg', public.messenger_inbox_connect('telegram', 'Support', 'bot1'));
select i.fails('one account connects once', $$select public.messenger_inbox_connect('whatsapp', 'Again', 'pn1')$$, 'already connected');
select i.fails('an unknown channel is refused', $$select public.messenger_inbox_connect('fax', 'X', '9')$$, 'check constraint');
select i.ok('the admin sees the people list, not messages', (select count(*) = 2 and bool_and(cardinality(people) = 1) from public.messenger_inbox_admin_list()));
select i.fails('staff cannot read a secret', $$select public.messenger_inbox_secret_get(i.id('wa'), 'token')$$, 'permission denied');
select i.fails('staff cannot write a secret', $$select public.messenger_inbox_secret_set(i.id('wa'), 'token', 'x')$$, 'permission denied');
select i.fails('staff cannot store a message', $$select public.messenger_inbox_store(i.id('wa'), 't', 'c', 'm', 'b')$$, 'permission denied');
select i.fails('staff cannot finish a send', $$select public.messenger_inbox_send_done(gen_random_uuid(), 'x', true)$$, 'permission denied');
select i.fails('tables take no direct writes', $$insert into public.messenger_inbox_threads (account_id, external_id) values (i.id('wa'), 'x')$$, 'permission denied');
select i.fails('the access table is closed', $$select * from public.messenger_inbox_access$$, 'permission denied');
reset role;

-- Vault
select public.messenger_inbox_secret_set(i.id('wa'), 'token', 'first');
select public.messenger_inbox_secret_set(i.id('wa'), 'token', 'second');
select i.ok('a secret saves and updates', public.messenger_inbox_secret_get(i.id('wa'), 'token') = 'second');
select i.ok('secrets are per account', public.messenger_inbox_secret_get(i.id('tg'), 'token') is null);

-- Inbound, repeated
select public.messenger_inbox_store(i.id('wa'), '971500', 'Client One', 'wamid.1', 'Hello there', now());
select public.messenger_inbox_store(i.id('wa'), '971500', 'Client One', 'wamid.1', 'Hello there', now());
select i.ok('a repeated webhook adds one message', (select count(*) = 1 from public.messenger_inbox_messages where external_id = 'wamid.1'));
select public.messenger_inbox_store(gen_random_uuid(), 't', 'c', 'm', 'b');
select i.ok('an unknown account stores nothing', (select count(*) = 1 from public.messenger_inbox_messages));
insert into i.ids values ('t1', (select id from public.messenger_inbox_threads where external_id = '971500'));
select i.ok('a new message marks the thread new', (select status = 'new' and last_preview = 'Hello there' from public.messenger_inbox_threads where id = i.id('t1')));

-- Nobody sees an account by default, even an admin not on the list
set role authenticated;
select set_config('test.uid', :'ana', false);
select i.ok('no default access: accounts', (select count(*) = 0 from public.messenger_inbox_accounts));
select i.ok('no default access: threads', (select count(*) = 0 from public.messenger_inbox_threads));
select i.ok('no default access: messages', (select count(*) = 0 from public.messenger_inbox_messages));
select i.ok('no default access: unread count', public.messenger_inbox_unread() = 0);
select i.fails('no access: cannot send', format($$select * from public.messenger_inbox_send_begin(%L, 'x')$$, i.id('t1')), 'do not have access');
select i.fails('no access: cannot change status', format($$select public.messenger_inbox_set_status(%L, 'read')$$, i.id('t1')), 'do not have access');
select i.fails('a member cannot grant themselves access', format($$select public.messenger_inbox_set_access(%L, array[%L]::uuid[])$$, i.id('wa'), :'ana'), 'Only an admin');

select set_config('test.uid', :'boss', false);
select public.messenger_inbox_set_access(i.id('wa'), array[:'ana']::uuid[]);
select i.ok('an admin taken off the list reads nothing', (select count(*) = 0 from public.messenger_inbox_messages));
select i.ok('but still manages the account', (select count(*) = 2 from public.messenger_inbox_admin_list()));
select i.fails('access is for staff only', format($$select public.messenger_inbox_set_access(%L, array['00000000-0000-0000-0000-0000000000ee']::uuid[])$$, i.id('wa')), 'not a staff member');

select set_config('test.uid', :'ana', false);
select i.ok('a granted person reads the thread', (select count(*) = 1 from public.messenger_inbox_threads));
select i.ok('and the unread count', public.messenger_inbox_unread() = 1);
select public.messenger_inbox_set_status(i.id('t1'), 'read');
select i.ok('status changes', public.messenger_inbox_unread() = 0);
select public.messenger_inbox_assign(i.id('t1'), :'ana');
select i.fails('cannot assign to someone without access', format($$select public.messenger_inbox_assign(%L, %L)$$, i.id('t1'), :'raj'), 'cannot see this account');
select public.messenger_inbox_assign(i.id('t1'), null);

-- Sending inside and outside the window
insert into i.ids select 'm1', message_id from public.messenger_inbox_send_begin(i.id('t1'), 'Thanks');
select i.ok('a send starts as sending, by this person', (select status = 'sending' and direction = 'out' and sent_by = :'ana' from public.messenger_inbox_messages where id = i.id('m1')));
select i.fails('an empty message is refused', format($$select * from public.messenger_inbox_send_begin(%L, '   ')$$, i.id('t1')), '1 to 4096');
reset role;
select public.messenger_inbox_send_done(i.id('m1'), 'wamid.out', true);
select i.ok('a finished send is marked, and updates the list', (select m.status = 'sent' and t.last_preview = 'Thanks' from public.messenger_inbox_messages m join public.messenger_inbox_threads t on t.id = m.thread_id where m.id = i.id('m1')));
update public.messenger_inbox_threads set last_inbound_at = now() - interval '25 hours' where id = i.id('t1');
set role authenticated;
select set_config('test.uid', :'ana', false);
select i.fails('WhatsApp refuses after 24 hours', format($$select * from public.messenger_inbox_send_begin(%L, 'late')$$, i.id('t1')), 'over 24 hours');
reset role;
select public.messenger_inbox_store(i.id('tg'), 'chat9', 'Someone', 'chat9:1', 'Old message', now() - interval '3 days');
insert into i.ids values ('t2', (select id from public.messenger_inbox_threads where external_id = 'chat9'));
set role authenticated;
select set_config('test.uid', :'boss', false);
select i.ok('Telegram has no such window', (select count(*) = 1 from public.messenger_inbox_send_begin(i.id('t2'), 'still fine')));

-- The audit trail keeps out the text
reset role;
create trigger audit_trail_row after insert or update or delete on public.messenger_inbox_messages for each row execute function public.audit_trail_capture('id');
set role authenticated;
select set_config('test.uid', :'boss', false);
select i.ok('sending while audited works', (select count(*) = 1 from public.messenger_inbox_send_begin(i.id('t2'), 'Secret client words')));
reset role;
select i.ok('the audit trail holds no client text', (select count(*) = 0 from public.audit_trail t where t::text ilike '%secret client%'));
drop trigger audit_trail_row on public.messenger_inbox_messages;

-- Disconnecting
set role authenticated;
select set_config('test.uid', :'ana', false);
select i.fails('a member cannot disconnect', format($$select public.messenger_inbox_disconnect(%L)$$, i.id('wa')), 'Only an admin');
select set_config('test.uid', :'boss', false);
select public.messenger_inbox_disconnect(i.id('wa'));
reset role;
select i.ok('disconnecting removes its conversations', (select count(*) = 0 from public.messenger_inbox_messages where account_id = i.id('wa')));
select i.ok('and its secrets', (select count(*) = 0 from vault.secrets where name like 'inbox:' || i.id('wa')::text || '%'));

set role anon;
select i.fails('anon cannot read the count', $$select public.messenger_inbox_unread()$$, 'permission denied');
select i.fails('anon cannot read accounts', $$select * from public.messenger_inbox_accounts$$, 'permission denied');
reset role;
do $$ begin raise notice 'all inbox checks passed'; end $$;
drop schema i cascade;
