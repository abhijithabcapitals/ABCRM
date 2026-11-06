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

-- Part 2 (Task 2): plan builder, matching, duplicates, approval. Invented fixture names only.
select pg_temp.check('normalize ACME Trading L.L.C = Acme Trading LLC',
  od_copy.normalize_name('ACME Trading L.L.C') = od_copy.normalize_name('Acme Trading LLC'));
select pg_temp.check('normalize ACME Trading L.L.C = acme', od_copy.normalize_name('ACME Trading L.L.C') = 'acme');
select pg_temp.check('normalize & to and, filler removed', od_copy.normalize_name('The Kappa & Sons General Trading Co.') = 'kappa sons');
select pg_temp.check('legal_form FZCO', od_copy.legal_form('Beta Advisors FZCO') = 'fzco');
select pg_temp.check('legal_form L.L.C = llc', od_copy.legal_form('ACME Trading L.L.C') = 'llc');
select pg_temp.check('legal_form none', od_copy.legal_form('Beta Advisors') = '');
select pg_temp.check('clean_segment forbidden chars', od_copy.clean_segment('Gamma: "Co"?') = 'Gamma- -Co--');
select pg_temp.check('clean_segment slashes and pipe', od_copy.clean_segment('a/b\c|d*e<f>g') = 'a-b-c-d-e-f-g');
select pg_temp.check('clean_segment trailing dot and space', od_copy.clean_segment('  name. . ') = 'name');
select pg_temp.check('clean_segment reserved CON', od_copy.clean_segment('CON') = '_CON');
select pg_temp.check('clean_segment reserved com3.txt', od_copy.clean_segment('com3.txt') = '_com3.txt');
select pg_temp.check('clean_segment reserved .lock', od_copy.clean_segment('.lock') = '_.lock');
select pg_temp.check('clean_segment _vti_ removed', position('_vti_' in od_copy.clean_segment('x_vti_y')) = 0);
select pg_temp.check('clean_segment empty and dots', od_copy.clean_segment('..') = '_' and od_copy.clean_segment(null) = '_');
select pg_temp.check('clean_segment 120 chars keeps extension',
  length(od_copy.clean_segment(repeat('x', 200) || '.pdf')) = 120 and od_copy.clean_segment(repeat('x', 200) || '.pdf') like '%x.pdf');

insert into public.client_master (client_id, legal_name) values
  ('CL900001', 'ACME TRADING LLC'), ('CL900002', 'Beta Advisors FZCO'), ('CL900003', 'Beta Advisors LLC'),
  ('CL900004', 'Delta Foods LLC'), ('CL900005', 'Epsilonix Holdings LLC');
insert into public.hr_employees (employee_code, full_name, status) values
  ('EMP901', 'Zed Testperson', 'active'), ('EMP902', 'Yan Sample', 'active'), ('EMP903', 'Yan Other', 'active');
insert into od_copy.source_items (item_id, parent_path, name, size, quickxor_hash, modified_at, is_folder) values
  ('i01', '4. VAT Clients/Acme Trading LLC/KYC', 'pass.pdf', 100, 'h01', '2025-01-01', false),
  ('i02', '2. Accounting Clients/ACME TRADING L.L.C/2025', 'bank.pdf', 200, 'h02', '2025-01-01', false),
  ('i03', '2. Accounting Clients/Beta Advisors', 'trade licence.pdf', 300, 'h03', '2025-01-01', false),
  ('i04', '5. Audit Clients/Gamma: "Co"?/' || repeat('a', 100) || '/' || repeat('b', 100) || '/' || repeat('c', 100) || '/' || repeat('d', 100),
          'report.pdf', 400, 'h04', '2025-01-01', false),
  ('i05', '4. VAT Clients/Acme Trading LLC/Invoices', 'inv1.pdf', 500, 'hdup', '2025-01-01', false),
  ('i06', 'Desktop', 'copy of inv1.pdf', 500, 'hdup', '2026-01-01', false),
  ('i07', 'Documents', 'a.txt', 50, 'hx1', '2025-01-01', false),
  ('i08', 'Pictures', 'a.txt', 50, 'hx2', '2025-01-01', false),
  ('i09', 'Documents', 'nohash1.bin', 700, null, '2025-01-01', false),
  ('i10', 'Pictures', 'nohash2.bin', 700, null, '2025-01-01', false),
  ('i11', 'Desktop', 'notes.txt', 10, 'h11', '2025-01-01', false),
  ('i12', '', 'root.txt', 10, 'h12', '2025-01-01', false),
  ('i13', 'Banking ACCOUNT ABC/Bank Account Clients/Delta Foods LLC/KYC', 'tl.pdf', 10, 'h13', '2025-01-01', false),
  ('i14', 'Banking ACCOUNT ABC/Partner Bank X', 'form.pdf', 10, 'h14', '2025-01-01', false),
  ('i15', '1. AB Capital Documents/Staff Employment Register', 'list.xlsx', 10, 'h15', '2025-01-01', false),
  ('i16', '1. AB Capital Documents/Trade Licence', 'tl.pdf', 10, 'h16', '2025-01-01', false),
  ('i17', '3. Corporate Tax/CT Filing Returns/Acme Trading LLC/2024', 'ct.pdf', 10, 'h17', '2025-01-01', false),
  ('i18', 'Employee Folders/Zed Testperson/Docs', 'cv.pdf', 10, 'h18', '2025-01-01', false),
  ('i19', 'Employee Folders/Zed', 'x.pdf', 10, 'h19', '2025-01-01', false),
  ('i20', 'Employee Folders/Yan', 'y.pdf', 10, 'h20', '2025-01-01', false),
  ('i21', 'EX Employees/Old Person', 'z.pdf', 10, 'h21', '2025-01-01', false),
  ('i22', '4. VAT Clients/Epsilonix', 'a.pdf', 10, 'h22', '2025-01-01', false),
  ('i23', '4. VAT Clients/Acme Trading LLC', 'loose.pdf', 10, 'h23', '2025-01-01', false),
  ('f01', '4. VAT Clients', 'Acme Trading LLC', 0, null, '2025-01-01', true);

create temp table run1 as select od_copy.build_plan() r;
create or replace function pg_temp.t(id text) returns text language sql as $$ select target_path from od_copy.plan where source_item_id = id $$;
create or replace function pg_temp.s(id text) returns text language sql as $$ select status from od_copy.plan where source_item_id = id $$;

-- Review Focus 1: same client from two old areas
select pg_temp.check('VAT KYC target', pg_temp.t('i01') = 'Accounting/ACME TRADING LLC - CL900001/KYC/VAT/KYC/pass.pdf');
select pg_temp.check('Accounting 2025 target', pg_temp.t('i02') = 'Accounting/ACME TRADING LLC - CL900001/FINANCIALS INFORMATION/Accounting/2025/bank.pdf');
select pg_temp.check('matched rows carry client_id and department',
  (select bool_and(client_id = 'CL900001' and department = 'Accounting') from od_copy.plan where source_item_id in ('i01','i02','i17','i23')));
select pg_temp.check('file directly in client folder -> OTHERS', pg_temp.t('i23') = 'Accounting/ACME TRADING LLC - CL900001/OTHERS/VAT/loose.pdf');
select pg_temp.check('Corporate Tax service includes task',
  pg_temp.t('i17') = 'Accounting/ACME TRADING LLC - CL900001/FINANCIALS INFORMATION/Corporate Tax/CT Filing Returns/2024/ct.pdf');
select pg_temp.check('Acme match auto exact 1.0', exists (select 1 from od_copy.client_matches
  where area = '4. VAT Clients' and folder_name = 'Acme Trading LLC' and status = 'auto' and method = 'exact' and confidence = 1.0 and client_id = 'CL900001'));
-- Review Focus 2: FZCO vs LLC
select pg_temp.check('Beta Advisors -> review', exists (select 1 from od_copy.client_matches
  where area = '2. Accounting Clients' and folder_name = 'Beta Advisors' and status = 'review'));
select pg_temp.check('Beta Advisors target under unmatched', pg_temp.t('i03') = 'Accounting/00 Unmatched - to link/2. Accounting Clients/Beta Advisors/trade licence.pdf');
select pg_temp.check('unmatched row has no client_id', (select client_id is null from od_copy.plan where source_item_id = 'i03'));
select pg_temp.check('Epsilonix close -> review 0.7', exists (select 1 from od_copy.client_matches
  where folder_name = 'Epsilonix' and status = 'review' and method = 'close' and confidence = 0.7 and client_id = 'CL900005'));
-- Review Focus 3: names and length
select pg_temp.check('long target <= 400', length(pg_temp.t('i04')) <= 400);
select pg_temp.check('long target valid characters', pg_temp.t('i04') !~ '["*:<>?\\|]');
select pg_temp.check('long target keeps first two and last two', pg_temp.t('i04') like 'Accounting/00 Unmatched - to link/%/' || repeat('d', 100) || '/report.pdf');
select pg_temp.check('source_path keeps the original', (select source_path from od_copy.plan where source_item_id = 'i04')
  = '5. Audit Clients/Gamma: "Co"?/' || repeat('a', 100) || '/' || repeat('b', 100) || '/' || repeat('c', 100) || '/' || repeat('d', 100) || '/report.pdf');
-- duplicates
select pg_temp.check('duplicate kept in matched client folder', pg_temp.s('i05') = 'planned');
select pg_temp.check('duplicate other skipped', pg_temp.s('i06') = 'skipped_duplicate'
  and (select duplicate_of from od_copy.plan where source_item_id = 'i06') = 'i05');
select pg_temp.check('same name and size, different hash: both planned', pg_temp.s('i07') = 'planned' and pg_temp.s('i08') = 'planned');
select pg_temp.check('null hash files planned', pg_temp.s('i09') = 'planned' and pg_temp.s('i10') = 'planned');
select pg_temp.check('folders not planned', not exists (select 1 from od_copy.plan where source_item_id = 'f01'));
-- other areas
select pg_temp.check('Desktop archive', pg_temp.t('i11') = '08 Archive/From old OneDrive/Desktop/notes.txt');
select pg_temp.check('root file archive', pg_temp.t('i12') = '08 Archive/From old OneDrive/(root files)/root.txt');
select pg_temp.check('bank account client longest prefix', pg_temp.t('i13') = 'Business Banking/Delta Foods LLC - CL900004/KYC/Bank Account/KYC/tl.pdf');
select pg_temp.check('bank partner fixed', pg_temp.t('i14') = 'Business Banking/00 Bank Partner Documents/Partner Bank X/form.pdf');
select pg_temp.check('employment list to HR', pg_temp.t('i15') = 'HR/00 Policies/Employment list/Staff Employment Register/list.xlsx'
  and (select department from od_copy.plan where source_item_id = 'i15') = 'HR');
select pg_temp.check('company records to CEO', pg_temp.t('i16') = 'CEO/00 Company Records (AB Capital)/Trade Licence/tl.pdf');
select pg_temp.check('employee full name', pg_temp.t('i18') = 'EMPLOYEES/Zed Testperson - EMP901/OTHERS/Docs/cv.pdf');
select pg_temp.check('employee unique first word', pg_temp.t('i19') = 'EMPLOYEES/Zed Testperson - EMP901/OTHERS/x.pdf');
select pg_temp.check('employee ambiguous first word unmatched', pg_temp.t('i20') = 'EMPLOYEES/00 Unmatched/Yan/y.pdf');
select pg_temp.check('EX Employees', pg_temp.t('i21') = 'EMPLOYEES/00 EX EMPLOYEES/Old Person/z.pdf');
-- counts and re-run
select pg_temp.check('counts', (select r = '{"files":23,"to_copy":22,"duplicates":1,"bytes_to_copy":3130,"matched_folders":4,"review_folders":2,"unmatched_folders":1}'::jsonb from run1));
update od_copy.plan set status = 'verified', target_path = 'kept/as/is' where source_item_id = 'i11';
select pg_temp.check('build_plan twice same counts', (select od_copy.build_plan() = r from run1));
select pg_temp.check('verified row untouched', pg_temp.s('i11') = 'verified' and pg_temp.t('i11') = 'kept/as/is');
-- manual match is kept and used
insert into od_copy.client_matches (area, folder_name, client_id, method, status, confidence)
values ('2. Accounting Clients', 'Beta Advisors', 'CL900003', 'manual', 'approved', 1)
on conflict (area, folder_name) do update set client_id = excluded.client_id, method = excluded.method, status = excluded.status;
select od_copy.build_plan();
select pg_temp.check('manual match kept', exists (select 1 from od_copy.client_matches where folder_name = 'Beta Advisors' and method = 'manual' and status = 'approved'));
select pg_temp.check('manual match used', pg_temp.t('i03') = 'Accounting/Beta Advisors LLC - CL900003/OTHERS/Accounting/trade licence.pdf');
-- report view
select pg_temp.check('report Desktop row', exists (select 1 from od_copy.report where area = 'Desktop' and files = 2 and duplicates = 1 and verified = 1));
-- approval
select pg_temp.check('approve client pilot', od_copy.approve('client', null, 'CL900001') = 5);
select pg_temp.check('pilot rows approved', (select bool_and(status = 'approved') from od_copy.plan where client_id = 'CL900001'));
do $$ begin
  begin perform od_copy.approve('client'); raise exception 'FAIL approve client without id accepted';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'ok   approve client needs a client id'; end;
end $$;
select pg_temp.check('approve all', od_copy.approve('all') = 14);
select pg_temp.check('approve all leaves only unmatched client rows planned',
  (select array_agg(source_item_id order by source_item_id) = array['i04','i22'] from od_copy.plan where status = 'planned'));
select pg_temp.check('approve unmatched narrowed by area', od_copy.approve('unmatched', '5. Audit Clients') = 1 and pg_temp.s('i04') = 'approved');
select pg_temp.check('approve unmatched', od_copy.approve('unmatched') = 1 and pg_temp.s('i22') = 'approved');
select pg_temp.check('duplicate never approved', pg_temp.s('i06') = 'skipped_duplicate');
-- access
set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000a1', false);
select pg_temp.check('admin reads report', (select count(*) > 0 from od_copy.report));
do $$ begin
  begin perform od_copy.build_plan(); raise exception 'FAIL authenticated ran build_plan';
  exception when insufficient_privilege then raise notice 'ok   authenticated cannot run build_plan'; end;
  begin perform od_copy.approve('all'); raise exception 'FAIL authenticated ran approve';
  exception when insufficient_privilege then raise notice 'ok   authenticated cannot run approve'; end;
end $$;
select set_config('test.uid', '00000000-0000-0000-0000-0000000000b2', false);
select pg_temp.check('staff sees empty report', (select count(*) = 0 from od_copy.report));
reset role;
