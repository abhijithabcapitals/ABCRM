-- Client Base 007: OneDrive folder map. Each check prints "ok <name>" or raises FAILED.
create or replace function pg_temp.check(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is not true then raise exception 'FAILED %', p_name; end if;
  raise notice 'ok %', p_name;
end $$;

select pg_temp.check('split words read as one name', storage_name_score('Curve Ball Events', 'CURVEBALL EVENTS') = 1);
select pg_temp.check('joined name keeps word order for the prefix rule', storage_name_score('Curve Ball Events Mgt', 'CURVEBALL EVENTS') = 0.85);
select pg_temp.check('plural or singular is a prefix match', storage_name_score('SEAPRIME CAPITAL', 'Sea Prime Capitals LLC') = 0.85);
select pg_temp.check('different names stay apart', storage_name_score('Samson Technical', 'SAMSON ELECTRICALS') < 0.6);

-- the scan as postgres (the SQL editor / MCP), as the tool's SQL file does
select storage_folders_sync('C:\OneDrive\CRM AB CAPITAL', $j$[
  {"path": "Business Setup\\Apex Old Trading Name - CL000075", "name": "Apex Old Trading Name - CL000075", "area": "Business Setup", "kind": "client", "code": "CL000075", "subfolders": ["KYC", "Proposals", "OTHERS"]},
  {"path": "Accounting\\B&B International Holdings LLC - CL000089", "name": "B&B International Holdings LLC - CL000089", "area": "Accounting", "kind": "client", "code": "CL000089", "subfolders": []},
  {"path": "Accounting\\00 Unmatched - to link\\2. Accounting Clients\\CURVEBALL EVENTS MANAGEMENT L.L.C", "name": "CURVEBALL EVENTS MANAGEMENT L.L.C", "area": "Accounting", "kind": "client", "code": null},
  {"path": "Accounting\\00 Unmatched - to link\\4. VAT Clients\\Energyoptima", "name": "Energyoptima", "area": "Accounting", "kind": "client", "code": null},
  {"path": "Archive\\Prime Gold Trading L.L.C.", "name": "Prime Gold Trading L.L.C.", "area": "Archive", "kind": "client", "code": null},
  {"path": "Archive\\Golden Leap", "name": "Golden Leap", "area": "Archive", "kind": "client", "code": null},
  {"path": "Business Setup\\Ghost Co - CL999999", "name": "Ghost Co - CL999999", "area": "Business Setup", "kind": "client", "code": "CL999999"},
  {"path": "EMPLOYEES\\00 EX EMPLOYEES\\RISHU - NEW-RISHU", "name": "RISHU - NEW-RISHU", "area": "EMPLOYEES", "kind": "employee", "code": "NEW-RISHU", "ex": true},
  {"path": "EMPLOYEES\\00 Unmatched\\GEO JOJAN", "name": "GEO JOJAN", "area": "EMPLOYEES", "kind": "employee", "code": null},
  {"path": "EMPLOYEES\\ABAIZ - ABC-008", "name": "ABAIZ - ABC-008", "area": "EMPLOYEES", "kind": "employee", "code": "ABC-008", "subfolders": ["PERSONAL DOCUMENTS", "OTHERS"]},
  {"path": "EMPLOYEES\\00 EX EMPLOYEES\\Akash", "name": "Akash", "area": "EMPLOYEES", "kind": "employee", "code": null, "ex": true},
  {"path": "Business Development\\00 Leads (before client code)\\HMR - LD-2026-000002", "name": "HMR - LD-2026-000002", "area": "Business Development", "kind": "lead", "code": "LD-2026-000002"}
]$j$::jsonb);

select pg_temp.check('code links even when the folder name differs',
  (select status = 'linked' and match_method = 'code' and client_id = 'CL000075' and name_differs from storage_folders where folder_code = 'CL000075'));
select pg_temp.check('& and LLC do not stop a code link with the same name',
  (select status = 'linked' and not name_differs from storage_folders where folder_code = 'CL000089'));
select pg_temp.check('same name without punctuation and suffix links by name',
  (select status = 'linked' and match_method = 'name' and client_id = 'CL000225' from storage_folders where folder_name = 'Prime Gold Trading L.L.C.'));
select pg_temp.check('exact name beats a longer similar name',
  (select status = 'linked' and client_id = 'CL000141' from storage_folders where folder_name = 'Golden Leap'));
select pg_temp.check('extra word is only suggested',
  (select status = 'suggested' and match_method = 'fuzzy' and client_id = 'CL000020' from storage_folders where folder_name like 'CURVEBALL%'));
select pg_temp.check('name that starts the CRM name is suggested',
  (select status = 'suggested' and client_id = 'CL000122' and match_score = 0.85 from storage_folders where folder_name = 'Energyoptima'));
select pg_temp.check('unknown code with no name match stays unmatched',
  (select status = 'unmatched' and client_id is null from storage_folders where folder_code = 'CL999999'));
select pg_temp.check('ex employee links by code',
  (select status = 'linked' and is_ex and employee_id = '00000000-0000-0000-0000-0000000000e2' from storage_folders where folder_code = 'NEW-RISHU'));
select pg_temp.check('employee folder with full name is suggested for the short CRM name',
  (select status = 'suggested' and employee_id = '00000000-0000-0000-0000-0000000000e1' from storage_folders where folder_name = 'GEO JOJAN'));
select pg_temp.check('unknown employee stays unmatched', (select status = 'unmatched' from storage_folders where folder_name = 'Akash'));
select pg_temp.check('lead links by lead number', (select lead_id = '00000000-0000-0000-0000-0000000000f1' from storage_folders where kind = 'lead'));

-- people decide; a later scan keeps the decision
set test.uid = '00000000-0000-0000-0000-00000000000c';
select storage_folder_decide((select id from storage_folders where folder_name like 'CURVEBALL%'), 'confirm');
select storage_folder_decide((select id from storage_folders where folder_name = 'Energyoptima'), 'reject');
select storage_folder_decide((select id from storage_folders where folder_code = 'CL999999'), 'link', 'CL000251');
do $$ begin
  perform storage_folder_decide((select id from storage_folders where folder_name = 'Akash'), 'confirm');
  raise exception 'FAILED a Client Master user decided an employee folder';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok a Client Master user cannot decide an employee folder';
end $$;
do $$ begin
  perform storage_folders_sync('x', '[{"path": "a", "name": "a", "area": "Accounting", "kind": "client"}]');
  raise exception 'FAILED a non-admin ran the scan';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok only an admin can run the scan';
end $$;
reset test.uid;

select storage_folders_sync('C:\OneDrive\CRM AB CAPITAL', $j$[
  {"path": "Business Setup\\Apex Old Trading Name - CL000075", "name": "Apex Old Trading Name - CL000075", "area": "Business Setup", "kind": "client", "code": "CL000075", "subfolders": ["KYC", "Proposals", "OTHERS"]},
  {"path": "Accounting\\00 Unmatched - to link\\2. Accounting Clients\\CURVEBALL EVENTS MANAGEMENT L.L.C", "name": "CURVEBALL EVENTS MANAGEMENT L.L.C", "area": "Accounting", "kind": "client", "code": null},
  {"path": "Accounting\\00 Unmatched - to link\\4. VAT Clients\\Energyoptima", "name": "Energyoptima", "area": "Accounting", "kind": "client", "code": null},
  {"path": "Business Setup\\Ghost Co - CL999999", "name": "Ghost Co - CL999999", "area": "Business Setup", "kind": "client", "code": "CL999999"},
  {"path": "EMPLOYEES\\ABAIZ - ABC-008", "name": "ABAIZ - ABC-008", "area": "EMPLOYEES", "kind": "employee", "code": "ABC-008", "subfolders": ["PERSONAL DOCUMENTS", "OTHERS"]}
]$j$::jsonb);
select pg_temp.check('confirmed suggestion survives a scan',
  (select status = 'linked' and client_id = 'CL000020' from storage_folders where folder_name like 'CURVEBALL%'));
select pg_temp.check('rejected link survives a scan',
  (select status = 'rejected' and client_id is null from storage_folders where folder_name = 'Energyoptima'));
select pg_temp.check('manual link survives a scan',
  (select status = 'linked' and match_method = 'manual' and client_id = 'CL000251' from storage_folders where folder_code = 'CL999999'));
select pg_temp.check('folders the scan no longer finds are marked missing, not deleted',
  (select count(*) = 7 from storage_folders where missing_since is not null) and (select count(*) = 12 from storage_folders));

-- where documents go
insert into hub_documents (client_id, department, doc_type, document_number) values
  ('CL000075', 'Business Setup', 'quote', 'Q-1'), ('CL000075', 'Business Setup', 'letter', 'L-1'), ('CL000304', 'Business Setup', 'quote', 'Q-2');
insert into hr_documents (employee_id, doc_type) values ('00000000-0000-0000-0000-0000000000e3', 'Emirates ID');
set test.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.check('a quote goes to the existing Proposals folder',
  (select onedrive_status = 'ready' and onedrive_folder = 'C:\OneDrive\CRM AB CAPITAL\Business Setup\Apex Old Trading Name - CL000075\Proposals'
     from storage_document_links where label = 'Q-1'));
select pg_temp.check('a letter with no ENGAGEMENT LETTERS folder falls back to OTHERS, nothing is made',
  (select onedrive_status = 'no_subfolder' and onedrive_folder like '%CL000075\OTHERS' escape '' from storage_document_links where label = 'L-1'));
select pg_temp.check('a client with no folder gets no path',
  (select onedrive_status = 'no_folder' and onedrive_folder is null from storage_document_links where label = 'Q-2'));
select pg_temp.check('an employee document goes to PERSONAL DOCUMENTS',
  (select onedrive_folder like '%ABAIZ - ABC-008\PERSONAL DOCUMENTS' escape '' from storage_document_links where source = 'hr_documents'));
select pg_temp.check('owner view lists linked folders', (select count(*) >= 3 from storage_owner_folders));

set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.check('HR sees employee folders only', (select bool_and(kind = 'employee') and count(*) > 0 from storage_folders));
set test.uid = '00000000-0000-0000-0000-00000000000d';
select pg_temp.check('a user with no role sees no folders', (select count(*) = 0 from storage_folders));
select pg_temp.check('a user with no role gets no document path',
  (select storage_doc_target('client', 'CL000075', 'Business Setup', 'quote') ->> 'status' = 'no_folder'));
reset role;
reset test.uid;
