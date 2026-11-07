-- LOCAL TEST ONLY. Company Templates documents (hub_documents with a library template) on the shared signing (011), as
-- Template Module/logic/librarySigning.js uses it: the AB Capital built-in quote and letter and Company Library fills. The company
-- comes from the row: Ardentax for Ardentax library templates, AB Capital otherwise, whatever the caller says. Signed files sit under
-- <department>/<id>/signed/ (Business Setup/ or Ardentax Documents/), and a new file (hub_document_attach, Retry) ends the signature in
-- the database. No migration of its own: 011 covers these rows. People and documents are invented. Uses at_sign from 060_signing_test.sql.
\set ON_ERROR_STOP on
\set abappr '00000000-0000-0000-0000-0000000000c5'
\set axappr '00000000-0000-0000-0000-0000000000c6'
\set staff  '00000000-0000-0000-0000-0000000000c7'
\set admin  '00000000-0000-0000-0000-0000000000c8'
\set dq     '00000000-0000-0000-0000-00000000c702'
\set dl     '00000000-0000-0000-0000-00000000c703'
\set fx     '00000000-0000-0000-0000-00000000c704'

select at_as(null);
insert into auth.users (id) values (:'abappr'), (:'axappr'), (:'staff'), (:'admin') on conflict do nothing;
insert into public.profiles (id, full_name, role) values (:'abappr', 'CT AB Approver', 'member'), (:'axappr', 'CT AX Approver', 'member'), (:'staff', 'CT Staff', 'member'),
  (:'admin', 'CT Admin', 'admin') on conflict (id) do nothing;
insert into public.member_tab_access (profile_id, tab_key) values (:'axappr', 'ardentax'), (:'staff', 'ardentax') on conflict do nothing;
insert into hub_library_templates (template_key, company, folder, name) values ('AB Capital/Test/CT Work', 'AB Capital', 'Test', 'CT Work'), ('Ardentax/Test/CT Master', 'Ardentax', 'Test', 'CT Master')
  on conflict do nothing;
insert into hub_library_template_files (template_key, file_name, storage_path) values ('Ardentax/Test/CT Master', 'ct.docx', 'library-templates/Ardentax/ct.docx');
insert into hub_documents (id, doc_type, department, document_number, client_name, library_template, field_values, lines, total_amount, created_by) values
  (:'dq', 'quote', 'Business Setup', 'TEST/BSQ/CT1', 'TEST CLIENT - DO NOT USE', 'AB Capital/Test/CT Work', '{"date": "2026-11-04"}', '[{"description": "Formation", "amount": 100}]', 100, :'staff'),
  (:'dl', 'letter', 'Business Setup', 'TEST/BSE/CT1', 'TEST CLIENT - DO NOT USE', 'AB Capital/Engagement Letter', '{"date": "2026-11-04"}', '[]', 0, :'staff');
insert into hub_documents (id, doc_type, department, company, document_number, client_name, library_template, library_file_id, field_values, created_by)
  values (:'fx', 'library', 'Ardentax Documents', 'Ardentax', 'TEST/ADTD/CT1', 'TEST CLIENT - DO NOT USE', 'Ardentax/Test/CT Master',
          (select max(id) from hub_library_template_files where template_key = 'Ardentax/Test/CT Master'), '{"date": "2026-11-04"}', :'staff');

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'abappr'), 'signature_path', 'signatures/ab_capital/ct-test.png')) is not null as s0 \gset
select doc_sign_admin_save(jsonb_build_object('company', 'ardentax', 'approvers', jsonb_build_array(:'axappr'), 'signature_path', 'signatures/ardentax/ct-test.png')) is not null as s1 \gset

-- ── signing is optional ──────────────────────────────────────────────
select at_as(:'staff');
select hub_document_attach(:'dq', 'Business Setup/' || :'dq' || '/a.docx', null);
select hub_document_attach(:'dl', 'Business Setup/' || :'dl' || '/a.docx', null);
select hub_document_attach(:'fx', 'Ardentax Documents/' || :'fx' || '/a.docx', null);
select at_check('staff file the unsigned documents as before', (select count(*) = 3 from hub_documents where id in (:'dq', :'dl', :'fx') and storage_path like '%/a.docx'));
select at_as(null);
select at_check('the AB Capital designs are AB Capital documents; the Ardentax fill is Ardentax',
  doc_company('hub_documents', :'dq') = 'ab_capital' and doc_company('hub_documents', :'dl') = 'ab_capital' and doc_company('hub_documents', :'fx') = 'ardentax');
select at_check('their signed files go under <department>/<id>/signed/',
  doc_sign_prefix('hub_documents', :'dq') = 'Business Setup/' || :'dq' || '/signed/' and doc_sign_prefix('hub_documents', :'fx') = 'Ardentax Documents/' || :'fx' || '/signed/');

-- ── who signs what ───────────────────────────────────────────────────
select at_as(:'staff');
select at_check('staff who are not approvers cannot sign either company',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'dq'), 'not an approver')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Ardentax Documents'))$f$, :'fx'), 'not an approver'));
select at_as(:'abappr');
select at_check('the AB Capital approver cannot read the Ardentax fill, so cannot sign it',
  (select count(*) = 0 from hub_documents where id = :'fx')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Ardentax Documents', '{"company": "ab_capital"}'))$f$, :'fx'), 'The document was not found'));
select at_check('the AB Capital approver signs the quote and letter, even when naming Ardentax',
  (select company = 'ab_capital' and unsigned_word_path = 'Business Setup/' || :'dq' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'dq', 'Business Setup', '{"company": "ardentax"}')))
  and (select company = 'ab_capital' from doc_sign_record(at_sign('hub_documents', :'dl', 'Business Setup'))));
select at_as(:'axappr');
select at_check('the Ardentax approver cannot sign the AB Capital quote', not doc_sign_can('ab_capital'));
select at_check('a signed path outside the fill''s own folder is refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'fx'), 'must be stored under'));
select at_check('the Ardentax approver signs the fill as Ardentax, keeping its unsigned file',
  (select company = 'ardentax' and unsigned_word_path = 'Ardentax Documents/' || :'fx' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'fx', 'Ardentax Documents', '{"company": "ab_capital"}'))));
select at_as(:'staff');
select at_check('Ardentax staff see the fill''s live signature', (select id is not null from doc_sign_live('hub_documents', :'fx')));

-- ── a new file ends it ───────────────────────────────────────────────
select hub_document_attach(:'dq', null, 'C:/Generated/dq.docx');
select at_check('the office folder copy keeps the signature', (select id is not null from doc_sign_live('hub_documents', :'dq')));
select hub_document_attach(:'dq', 'Business Setup/' || :'dq' || '/b.docx', null);
select hub_document_attach(:'fx', 'Ardentax Documents/' || :'fx' || '/b.docx', null);
select at_check('a new file ends the design''s and the fill''s signatures in the database',
  (select id is null from doc_sign_live('hub_documents', :'dq')) and (select id is null from doc_sign_live('hub_documents', :'fx')));
select at_check('the screen''s second-line withdrawal then finds nothing live and does not fail',
  doc_sign_supersede('hub_documents', :'dq', 'Generated again') = false and doc_sign_supersede('hub_documents', :'fx', 'Generated again') = false);
select at_check('the letter keeps its own signature', (select id is not null from doc_sign_live('hub_documents', :'dl')));
select at_as(null);
