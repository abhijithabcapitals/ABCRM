-- Every signed-in user has the Notification Centre tab. Prints "ok ..." per check and stops at the first failure.
\set ON_ERROR_STOP on

insert into profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-000000000e01', 'Tab member none', 'member'),
  ('00000000-0000-0000-0000-000000000e02', 'Tab member some', 'member'),
  ('00000000-0000-0000-0000-000000000e03', 'Tab member has it', 'member'),
  ('00000000-0000-0000-0000-000000000e04', 'Tab manager', 'member')
on conflict (id) do nothing;
insert into member_tab_access (profile_id, tab_key) values
  ('00000000-0000-0000-0000-000000000e02', 'clients'),
  ('00000000-0000-0000-0000-000000000e03', 'mytasks')
on conflict do nothing;
insert into banking_user_roles (user_id, role) values ('00000000-0000-0000-0000-000000000e04', 'MANAGER')
on conflict (user_id) do nothing;

set role authenticated;
set test.uid = '00000000-0000-0000-0000-000000000e01';
select t.ok('member with no tabs has the Centre, and nothing else', my_tabs() = array['mytasks']);
set test.uid = '00000000-0000-0000-0000-000000000e02';
select t.ok('member keeps their own tabs', my_tabs() @> array['clients', 'mytasks'] and cardinality(my_tabs()) = 2);
select t.ok('this grants no Template Hub', not my_tabs() && array['quotations', 'ardentax']);
set test.uid = '00000000-0000-0000-0000-000000000e03';
select t.ok('a ticked Centre tab is not listed twice', my_tabs() = array['mytasks']);
set test.uid = '00000000-0000-0000-0000-000000000e04';
select t.ok('manager keeps the Template Hub tabs', my_tabs() @> array['ardentax', 'mytasks', 'quotations'] and cardinality(my_tabs()) = 3);
reset test.uid;
select t.ok('nobody signed in has no tabs', my_tabs() = '{}');
set role anon;
select t.fails('anon cannot call my_tabs', $q$select my_tabs()$q$, 'permission denied');
reset role;
