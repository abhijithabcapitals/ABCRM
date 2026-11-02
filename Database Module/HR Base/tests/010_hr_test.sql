-- LOCAL TEST ONLY: HR access rules as signed-in users on a throwaway cluster.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'HR Member', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'Manager', 'member'),
  ('00000000-0000-0000-0000-00000000000d', 'Report', 'member'),
  ('00000000-0000-0000-0000-00000000000e', 'Other Employee', 'member'),
  ('00000000-0000-0000-0000-000000000099', 'Outsider', 'member');
insert into public.hr_employees (id, employee_code, full_name, profile_id, manager_id) values
  ('10000000-0000-0000-0000-00000000000c', 'E-C', 'Manager', '00000000-0000-0000-0000-00000000000c', null),
  ('10000000-0000-0000-0000-00000000000d', 'E-D', 'Report', '00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-00000000000c'),
  ('10000000-0000-0000-0000-00000000000e', 'E-E', 'Other Employee', '00000000-0000-0000-0000-00000000000e', null);
insert into public.hr_employee_personal (employee_id, nationality) values
  ('10000000-0000-0000-0000-00000000000d', 'IN'), ('10000000-0000-0000-0000-00000000000e', 'AE');
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-00000000000b');
insert into public.hr_audit_log (action, target) values ('seed', 'x');

create table public.t_result (n serial, name text, ok boolean, detail text);
grant all on public.t_result to authenticated;
grant usage on sequence public.t_result_n_seq to authenticated;

create function public.as_user(c text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || c, false)
$$;
create function public.ok(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into public.t_result (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;
create function public.must_fail(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.ok(p_name, false, 'no error raised');
  exception when others then
    perform public.ok(p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
  end;
end $$;
grant execute on function public.as_user(text), public.ok(text, boolean, text), public.must_fail(text, text, text) to authenticated;

set role authenticated;

-- ── hr_employees visibility ──
select public.as_user('0a');
select public.ok('admin reads all employees', (select count(*) = 3 from public.hr_employees));
select public.ok('admin role is hr', public.hr_my_access() ->> 'role' = 'hr');
select public.as_user('0b');
select public.ok('HR list member reads all employees', (select count(*) = 3 from public.hr_employees));
select public.ok('HR list member role is hr', public.hr_my_access() ->> 'role' = 'hr');
select public.as_user('0c');
select public.ok('manager reads self and direct report only', (select count(*) = 2 and bool_and(employee_code in ('E-C', 'E-D')) from public.hr_employees));
select public.ok('manager cannot see another employee', (select count(*) = 0 from public.hr_employees where employee_code = 'E-E'));
select public.ok('manager role', public.hr_my_access() ->> 'role' = 'manager');
select public.ok('manager hr_manages report', public.hr_manages('10000000-0000-0000-0000-00000000000d'));
select public.ok('manager does not manage other employee', not public.hr_manages('10000000-0000-0000-0000-00000000000e'));
select public.as_user('0d');
select public.ok('employee reads only own row', (select count(*) = 1 and bool_and(employee_code = 'E-D') from public.hr_employees));
select public.ok('employee role and id', public.hr_my_access() ->> 'role' = 'employee' and (public.hr_my_access() ->> 'employee_id')::uuid = '10000000-0000-0000-0000-00000000000d');
select public.ok('employee manages nobody', not public.hr_manages('10000000-0000-0000-0000-00000000000c'));
select public.as_user('99');
select public.ok('outsider reads 0 employees', (select count(*) = 0 from public.hr_employees));
select public.ok('outsider role is none', public.hr_my_access() ->> 'role' = 'none');
select public.must_fail('outsider cannot add employee', $$insert into public.hr_employees (employee_code, full_name) values ('E-X', 'X')$$, 'row-level security');

-- ── hr_employee_personal ──
select public.as_user('0c');
select public.ok('manager reads 0 personal rows for a report', (select count(*) = 0 from public.hr_employee_personal));
select public.as_user('0d');
select public.ok('employee reads only own personal row', (select count(*) = 1 and bool_and(nationality = 'IN') from public.hr_employee_personal));
select public.as_user('0b');
select public.ok('HR list member reads all personal rows', (select count(*) = 2 from public.hr_employee_personal));
select public.as_user('99');
select public.ok('outsider reads 0 personal rows', (select count(*) = 0 from public.hr_employee_personal));

-- ── writes ──
select public.as_user('0d');
update public.hr_employees set manager_id = '10000000-0000-0000-0000-00000000000e' where id = '10000000-0000-0000-0000-00000000000d';
update public.hr_employees set full_name = 'Hacked' where id = '10000000-0000-0000-0000-00000000000d';
select public.as_user('0a');
select public.ok('employee cannot update own manager_id or name', (select manager_id = '10000000-0000-0000-0000-00000000000c' and full_name = 'Report' from public.hr_employees where employee_code = 'E-D'));
select public.as_user('0c');
update public.hr_employees set designation = 'Boss' where id = '10000000-0000-0000-0000-00000000000d';
select public.as_user('0a');
select public.ok('manager cannot edit a report', (select designation is null from public.hr_employees where employee_code = 'E-D'));
select public.as_user('0b');
update public.hr_employees set designation = 'Analyst' where id = '10000000-0000-0000-0000-00000000000d';
select public.ok('HR list member can edit employees', (select designation = 'Analyst' from public.hr_employees where employee_code = 'E-D'));
select public.as_user('0d');
select public.must_fail('employee cannot grant themselves HR access', $$insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-00000000000d')$$, 'row-level security');
select public.ok('employee sees no HR access rows', (select count(*) = 0 from public.hr_access));
select public.as_user('0b');
select public.must_fail('HR list member cannot grant HR access', $$insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-00000000000e')$$, 'row-level security');
select public.as_user('0a');
insert into public.hr_access (profile_id) values ('00000000-0000-0000-0000-00000000000e');
select public.ok('admin can grant HR access', (select count(*) = 2 from public.hr_access));
delete from public.hr_access where profile_id = '00000000-0000-0000-0000-00000000000e';

-- ── audit log ──
select public.ok('admin reads audit log', (select count(*) = 1 from public.hr_audit_log where action = 'seed'));
select public.must_fail('audit log rejects update', $$update public.hr_audit_log set action = 'x'$$, 'permission');
select public.must_fail('audit log rejects delete', $$delete from public.hr_audit_log$$, 'permission');
select public.must_fail('audit log rejects direct insert', $$insert into public.hr_audit_log (action, target) values ('forged', 'x')$$, 'permission');
select public.must_fail('authenticated cannot call hr_audit directly', $$select public.hr_audit('a', 't', null, null)$$, 'permission');
select public.as_user('0d');
select public.ok('employee reads 0 audit rows', (select count(*) = 0 from public.hr_audit_log));

reset role;
select public.as_user('0a');
select public.must_fail('owner update blocked by trigger', $$update public.hr_audit_log set action = 'x'$$, 'append-only');
select public.must_fail('owner delete blocked by trigger', $$delete from public.hr_audit_log$$, 'append-only');
select public.hr_audit('test', 'hr_employees:1', '{"a":1}', '{"a":2}');
select public.ok('hr_audit records actor and values', (select count(*) = 1 from public.hr_audit_log where action = 'test' and actor = '00000000-0000-0000-0000-00000000000a' and old_values = '{"a":1}' and new_values = '{"a":2}'));
reset role;

-- ── documents (003) ──
-- Seed as owner. E-L has left; far-off and Left documents must not show in the expiring list.
insert into public.hr_employees (id, employee_code, full_name, status) values
  ('10000000-0000-0000-0000-00000000000f', 'E-L', 'Leaver', 'Left');
insert into public.hr_documents (employee_id, doc_type, doc_number, expiry_date) values
  ('10000000-0000-0000-0000-00000000000d', 'Passport', 'P-D', (now() at time zone 'Asia/Dubai')::date + 10),
  ('10000000-0000-0000-0000-00000000000d', 'Emirates ID', 'EID-D', (now() at time zone 'Asia/Dubai')::date + 200),
  ('10000000-0000-0000-0000-00000000000e', 'Visa', 'V-E', (now() at time zone 'Asia/Dubai')::date - 5),
  ('10000000-0000-0000-0000-00000000000f', 'Visa', 'V-L', (now() at time zone 'Asia/Dubai')::date + 5);

-- A stand-in for Supabase Storage, so the bucket policies are exercised too. 003 is re-run on top (idempotence).
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant execute on function storage.foldername(text) to authenticated;
\ir ../migrations/003_hr_documents.sql
\ir ../migrations/008_hr_review_fixes.sql

select public.ok('bucket is private with a 25 MB limit', (select not public and file_size_limit = 26214400 from storage.buckets where id = 'hr-documents'));

set role authenticated;
select public.as_user('0d');
select public.ok('employee reads only own documents', (select count(*) = 2 and bool_and(employee_id = '10000000-0000-0000-0000-00000000000d') from public.hr_documents));
insert into public.hr_documents (employee_id, doc_type, doc_number, expiry_date) values ('10000000-0000-0000-0000-00000000000d', 'Labour card', 'LC-D', (now() at time zone 'Asia/Dubai')::date + 80);
select public.ok('employee can add own document row', (select count(*) = 3 from public.hr_documents));
select public.must_fail('employee cannot add a row for someone else', $$insert into public.hr_documents (employee_id, doc_type) values ('10000000-0000-0000-0000-00000000000e', 'Passport')$$, 'row-level security');
update public.hr_documents set doc_number = 'HACK' where doc_number = 'P-D';
delete from public.hr_documents where doc_number = 'LC-D';
select public.as_user('0a');
select public.ok('employee cannot edit or delete document rows', (select count(*) = 1 from public.hr_documents where doc_number = 'P-D') and (select count(*) = 1 from public.hr_documents where doc_number = 'LC-D'));
select public.must_fail('employee cannot point a row at another employees file', $$insert into public.hr_documents (employee_id, doc_type, storage_path) values ('10000000-0000-0000-0000-00000000000d', 'Passport', '10000000-0000-0000-0000-00000000000e/u9-x.pdf')$$, 'hr_documents_path_own_folder');
select public.as_user('0b');
select public.must_fail('HR cannot point a row at another employees file either', $$insert into public.hr_documents (employee_id, doc_type, storage_path) values ('10000000-0000-0000-0000-00000000000d', 'Passport', '10000000-0000-0000-0000-00000000000e/u9-x.pdf')$$, 'hr_documents_path_own_folder');
select public.must_fail('HR cannot repoint an existing row at another folder', $$update public.hr_documents set storage_path = '10000000-0000-0000-0000-00000000000d/u9-x.pdf' where doc_number = 'V-E'$$, 'hr_documents_path_own_folder');
select public.as_user('0d');
select public.as_user('0c');
select public.ok('manager reads none of a reports documents', (select count(*) = 0 from public.hr_documents));
select public.must_fail('manager cannot add a document for a report', $$insert into public.hr_documents (employee_id, doc_type) values ('10000000-0000-0000-0000-00000000000d', 'Passport')$$, 'row-level security');
select public.as_user('99');
select public.ok('outsider reads no documents', (select count(*) = 0 from public.hr_documents));
select public.as_user('0b');
select public.ok('HR list member reads all documents', (select count(*) = 5 from public.hr_documents));
update public.hr_documents set doc_number = 'P-D2' where doc_number = 'P-D';
select public.ok('HR list member can edit a document row', (select count(*) = 1 from public.hr_documents where doc_number = 'P-D2'));
select public.as_user('0a');
select public.ok('admin reads all documents', (select count(*) = 5 from public.hr_documents));

-- expiring: expired or within 90 days; leavers omitted; same visibility as the table
select public.ok('HR sees expired and soon-to-expire, not far-off, not Left', (select count(*) = 3 and bool_and(doc_number in ('P-D2', 'V-E', 'LC-D')) from public.hr_documents_expiring()));
select public.ok('expiring reports days left (negative when expired)', (select days_left = -5 from public.hr_documents_expiring() where doc_number = 'V-E') and (select days_left = 10 from public.hr_documents_expiring() where doc_number = 'P-D2'));
select public.ok('expiring omits an employee with status Left', (select count(*) = 0 from public.hr_documents_expiring() where employee_code = 'E-L'));
select public.as_user('0d');
select public.ok('employee sees only own expiring documents', (select count(*) = 2 and bool_and(employee_code = 'E-D') from public.hr_documents_expiring()));
select public.as_user('0c');
select public.ok('manager sees no expiring documents', (select count(*) = 0 from public.hr_documents_expiring()));
select public.as_user('99');
select public.ok('outsider sees no expiring documents', (select count(*) = 0 from public.hr_documents_expiring()));

-- storage bucket policies: HR/admin anywhere, employee only their own folder, manager nothing
select public.as_user('0d');
insert into storage.objects (bucket_id, name) values ('hr-documents', '10000000-0000-0000-0000-00000000000d/u1-passport.pdf');
select public.ok('employee can upload to own folder', (select count(*) = 1 from storage.objects where bucket_id = 'hr-documents'));
select public.must_fail('employee cannot upload to another folder', $$insert into storage.objects (bucket_id, name) values ('hr-documents', '10000000-0000-0000-0000-00000000000e/u2-x.pdf')$$, 'row-level security');
select public.must_fail('employee cannot upload to the bucket root', $$insert into storage.objects (bucket_id, name) values ('hr-documents', 'x.pdf')$$, 'row-level security');
delete from storage.objects where bucket_id = 'hr-documents';
update storage.objects set name = '10000000-0000-0000-0000-00000000000d/renamed.pdf' where bucket_id = 'hr-documents';
select public.as_user('0b');
insert into storage.objects (bucket_id, name) values ('hr-documents', '10000000-0000-0000-0000-00000000000e/u3-visa.pdf');
select public.ok('HR can upload to any folder and read all', (select count(*) = 2 from storage.objects where bucket_id = 'hr-documents'));
select public.ok('nobody changed or removed a stored file (no update or delete policy)', (select count(*) = 1 from storage.objects where name = '10000000-0000-0000-0000-00000000000d/u1-passport.pdf'));
select public.as_user('0e');
select public.ok('another employee reads none of that folder', (select count(*) = 0 from storage.objects where bucket_id = 'hr-documents' and name like '10000000-0000-0000-0000-00000000000d/%'));
select public.ok('employee reads own folder', (select count(*) = 1 from storage.objects where bucket_id = 'hr-documents'));
select public.as_user('0c');
select public.ok('manager reads no stored HR files', (select count(*) = 0 from storage.objects where bucket_id = 'hr-documents'));
select public.must_fail('manager cannot upload', $$insert into storage.objects (bucket_id, name) values ('hr-documents', '10000000-0000-0000-0000-00000000000d/u4.pdf')$$, 'row-level security');
select public.as_user('99');
select public.ok('outsider reads no stored HR files', (select count(*) = 0 from storage.objects where bucket_id = 'hr-documents'));
reset role;

select public.ok('hr_documents has RLS on', (select relrowsecurity from pg_class where oid = 'public.hr_documents'::regclass));
select public.ok('hr_documents_expiring is security definer, fixed search_path, not open to anon', (select prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute') from pg_proc where proname = 'hr_documents_expiring'));

-- ── dashboard and task view (004) ──
reset role;
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000f', 'Twin', 'member'),
  ('00000000-0000-0000-0000-000000000010', 'Twin', 'member'),
  ('00000000-0000-0000-0000-000000000011', 'Gone Person', 'member');
insert into public.hr_employees (id, employee_code, full_name, profile_id, status) values
  ('10000000-0000-0000-0000-0000000000f1', 'E-T1', 'Twin', '00000000-0000-0000-0000-00000000000f', 'Active'),
  ('10000000-0000-0000-0000-0000000000f2', 'E-T2', 'Twin', '00000000-0000-0000-0000-000000000010', 'Active'),
  ('10000000-0000-0000-0000-0000000000f3', 'E-X', 'Gone Person', '00000000-0000-0000-0000-000000000011', 'Left'),
  ('10000000-0000-0000-0000-0000000000f4', 'E-N', 'Nobody Linked', null, 'Active');
insert into public.spaces (id, name) values ('20000000-0000-0000-0000-000000000001', 'S1'), ('20000000-0000-0000-0000-000000000002', 'S2');
insert into public.folders (id, space_id, name) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'F1');
insert into public.lists (id, space_id, folder_id, name) values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'L1');
-- 'Approved' is a Complete status in S1 only; 'Review' is In Progress; 'Parked' is Auto in the space but explicitly Complete on the list.
insert into public.space_statuses (space_id, name, is_complete, status_category) values
  ('20000000-0000-0000-0000-000000000001', 'Approved', true, 'complete'),
  ('20000000-0000-0000-0000-000000000001', 'Review', false, 'in_progress'),
  ('20000000-0000-0000-0000-000000000001', 'Parked', null, null),
  ('20000000-0000-0000-0000-000000000001', 'Done by Boss', null, null),
  ('20000000-0000-0000-0000-000000000001', 'Waiting', null, null);
insert into public.space_statuses (space_id, list_id, name, is_complete, status_category) values
  ('20000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'Parked', true, 'complete');
create function public.dubai_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Dubai')::date $$;
insert into public.tasks (title, assignees, due_date, status, date_done, date_closed, deleted_at, space_id, folder_id, list_id) values
  ('A overdue',  '{Report}', public.dubai_today() - 1, 'To Do', null, null, null, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('B tomorrow', '{Report}', public.dubai_today() + 1, 'To Do', null, null, null, '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('C done',     '{Report}', public.dubai_today() - 3, 'Done', current_date, null, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('D deleted',  '{Report}', public.dubai_today() - 3, 'To Do', null, null, now(), '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('E closed',   '{Report}', public.dubai_today() - 3, 'Cancelled', null, current_date, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('F approved', '{Report}', public.dubai_today() - 3, 'Approved', null, null, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('G review',   '{Report}', null, 'Review', null, null, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('H shared',   '{Report,"Other Employee"}', public.dubai_today(), 'To Do', null, null, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('I manager',  '{Manager}', null, 'To Do', null, null, null, null, null, '40000000-0000-0000-0000-000000000001'),
  ('J twin',     '{Twin}', null, 'To Do', null, null, null, '20000000-0000-0000-0000-000000000001', null, null),
  ('K leaver',   '{"Gone Person"}', null, 'To Do', null, null, null, null, null, null),
  ('L nobody',   '{"Nobody Linked"}', null, 'To Do', null, null, null, null, null, null),
  ('M other space', '{"Other Employee"}', null, 'Approved', null, null, null, '20000000-0000-0000-0000-000000000002', null, null),
  ('N parked',   '{Report}', null, 'Parked', null, null, null, '20000000-0000-0000-0000-000000000001', null, '40000000-0000-0000-0000-000000000001'),
  ('P completed', '{Report}', null, 'Completed', null, null, null, '20000000-0000-0000-0000-000000000002', null, null),
  ('Q closed',    '{Report}', null, 'Closed', null, null, null, '20000000-0000-0000-0000-000000000002', null, null),
  ('R rejected',  '{Report}', null, 'Rejected', null, null, null, '20000000-0000-0000-0000-000000000002', null, null),
  ('S cancelled', '{Report}', null, 'Cancelled', null, null, null, '20000000-0000-0000-0000-000000000002', null, null),
  ('T auto done', '{Report}', null, 'Done by Boss', null, null, null, '20000000-0000-0000-0000-000000000001', null, null),
  ('U auto open', '{Report}', null, 'Waiting', null, null, null, '20000000-0000-0000-0000-000000000001', null, null);

set role authenticated;
select public.as_user('0b');
select public.ok('HR sees every linked active employee''s open tasks', (select count(*) = 10 from public.hr_employee_tasks()));
select public.ok('done, closed, deleted, Complete-status, Left-employee and no-login tasks are left out', (select not exists (select 1 from public.hr_employee_tasks() where title in ('C done', 'D deleted', 'E closed', 'F approved', 'K leaver', 'L nobody', 'N parked', 'P completed', 'Q closed', 'R rejected', 'S cancelled', 'T auto done'))));
select public.ok('a Complete status in another space does not close the task', (select count(*) = 1 from public.hr_employee_tasks() where title = 'M other space'));
select public.ok('name-only: Completed, Closed, Rejected, Cancelled with no dates and no status row are not open', (select not exists (select 1 from public.hr_employee_tasks() where title in ('P completed', 'Q closed', 'R rejected', 'S cancelled'))));
select public.ok('name-only: an Auto status with a Done-like name is closed, an Auto status with another name stays open', (select not exists (select 1 from public.hr_employee_tasks() where title = 'T auto done') and exists (select 1 from public.hr_employee_tasks() where title = 'U auto open')));
select public.ok('a custom In Progress status stays open', (select count(*) = 1 from public.hr_employee_tasks() where title = 'G review'));
select public.ok('overdue is true only before today in Dubai', (select count(*) = 1 and bool_and(title = 'A overdue') from public.hr_employee_tasks() where overdue));
select public.ok('due today and no due date are not overdue', (select not bool_or(overdue) from public.hr_employee_tasks() where title in ('H shared', 'G review')));
select public.ok('a task shared by two assignees shows under both employees', (select count(distinct employee_id) = 2 from public.hr_employee_tasks() where title = 'H shared'));
select public.ok('same name on two employees sets duplicate_name', (select count(*) = 2 and bool_and(duplicate_name) from public.hr_employee_tasks() where title = 'J twin'));
select public.ok('unique names are not flagged', (select not bool_or(duplicate_name) from public.hr_employee_tasks() where title <> 'J twin'));
select public.ok('rows carry the scope the CRM needs to open the task', (select space_id = '20000000-0000-0000-0000-000000000001' and folder_id = '30000000-0000-0000-0000-000000000001' and list_id = '40000000-0000-0000-0000-000000000001' from public.hr_employee_tasks() where title = 'A overdue'));
select public.ok('space and folder come from the list when the task has none', (select space_id = '20000000-0000-0000-0000-000000000001' and folder_id = '30000000-0000-0000-0000-000000000001' from public.hr_employee_tasks() where title = 'I manager'));
select public.ok('employee name is returned', (select bool_and(employee_name is not null) from public.hr_employee_tasks()));
select public.ok('overdue rows come first', (select overdue from public.hr_employee_tasks() limit 1));
select public.as_user('0c');
select public.ok('manager sees self and direct report tasks only', (select count(*) = 6 and bool_and(employee_name in ('Manager', 'Report')) from public.hr_employee_tasks()));
select public.as_user('0d');
select public.ok('employee sees only own tasks', (select count(*) = 5 and bool_and(employee_name = 'Report') from public.hr_employee_tasks()));
select public.as_user('0e');
select public.ok('another employee sees only their own', (select count(*) = 2 and bool_and(employee_name = 'Other Employee') from public.hr_employee_tasks()));
select public.as_user('0f');
select public.ok('a duplicate-name employee sees only their own row, flagged', (select count(*) = 1 and bool_and(duplicate_name) and bool_and(employee_id = '10000000-0000-0000-0000-0000000000f1') from public.hr_employee_tasks()));
select public.as_user('99');
select public.ok('outsider gets no tasks', (select count(*) = 0 from public.hr_employee_tasks()));

-- dashboard numbers, scoped the same way
select public.as_user('0b');
select public.ok('HR dashboard: headcount counts active employees only', (public.hr_dashboard() ->> 'headcount')::int = 6);
select public.ok('HR dashboard: present today is 0 until attendance exists (pending leave is tested in 020)', (public.hr_dashboard() ->> 'present_today')::int = 0);
select public.ok('HR dashboard: expiring documents match the document alert list', (public.hr_dashboard() ->> 'expiring_documents')::int = (select count(*) from public.hr_documents_expiring()) and (public.hr_dashboard() ->> 'expiring_documents')::int > 0);
select public.as_user('0c');
select public.ok('manager dashboard: self and reports, no documents', (public.hr_dashboard() ->> 'headcount')::int = 2 and (public.hr_dashboard() ->> 'expiring_documents')::int = 0);
select public.as_user('0d');
select public.ok('employee dashboard: own numbers, own documents', (public.hr_dashboard() ->> 'headcount')::int = 1 and (public.hr_dashboard() ->> 'expiring_documents')::int = (select count(*) from public.hr_documents_expiring()));
select public.as_user('99');
select public.ok('outsider dashboard is all zeros', (select bool_and(value::int = 0) from jsonb_each_text(public.hr_dashboard())));
reset role;
select public.ok('dashboard keys are exactly the four agreed', (select array_agg(k order by k) = array['expiring_documents', 'headcount', 'pending_leave', 'present_today'] from (select jsonb_object_keys(public.hr_dashboard()) k) q));
select public.ok('dashboard functions are security definer, fixed search_path, closed to anon and public', (select count(*) = 2 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%' and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('public', oid, 'execute') and has_function_privilege('authenticated', oid, 'execute')) from pg_proc where proname in ('hr_employee_tasks', 'hr_dashboard')));

-- ── hardening ──
select public.ok('every HR table has RLS on', (select bool_and(relrowsecurity) from pg_class where oid in ('public.hr_employees'::regclass, 'public.hr_access'::regclass, 'public.hr_audit_log'::regclass, 'public.hr_employee_personal'::regclass)));
select public.ok('helper functions are security definer with fixed search_path', (select count(*) = 5 and bool_and(prosecdef and proconfig::text ilike '%search_path=public, pg_temp%') from pg_proc where proname in ('hr_is_admin_or_hr', 'hr_my_employee_id', 'hr_manages', 'hr_my_access', 'hr_audit')));
select public.ok('no HR function executable by anon or public', (select not bool_or(has_function_privilege('anon', oid, 'execute') or has_function_privilege('public', oid, 'execute')) from pg_proc where proname in ('hr_is_admin_or_hr', 'hr_my_employee_id', 'hr_manages', 'hr_my_access', 'hr_audit')));

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
