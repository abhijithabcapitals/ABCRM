-- LOCAL TEST ONLY. Library templates, numbering, access, totals, Voucher Register and storage rules.
\set ON_ERROR_STOP on
\set manager '00000000-0000-0000-0000-0000000000b1'
\set quoter '00000000-0000-0000-0000-0000000000b2'
\set ardent '00000000-0000-0000-0000-0000000000b3'
\set outsider '00000000-0000-0000-0000-0000000000b4'

-- ── Numbering settings, before any document exists ───────────────────
select at_as(null);
select at_check('hub_numbering_status still returns every department, and Ardentax Documents has only document',
  (hub_numbering_status() - 'Ardentax Documents') = (select doc from at_status_before)
  and (select array_agg(k) from jsonb_object_keys(hub_numbering_status() -> 'Ardentax Documents') k) = array['document']
  and hub_numbering_status() #>> '{Ardentax Documents,document,preview}' = 'Ardentax/' || to_char(now() at time zone 'Asia/Dubai', 'YYYY/MM') || '/ADTD001');

select at_as(:'manager');
select hub_numbering_save('Ardentax Documents', 'document', 'Ardentax/{YYYY}/{MM}/ADTD{SERIAL}', 3, 'never', 1);
select hub_numbering_save('Business Setup', 'receipt', 'ABC/{YYYY}/{MM}/BSR{SERIAL}', 3, 'never', 1);
select hub_numbering_save('Accounting', 'quote', 'ABC/{YYYY}/{MM}/ACQ{SERIAL}', 3, 'never', 1);
select at_check('hub_numbering_save accepts document only where the setting has it',
  at_refused($f$select hub_numbering_save('Business Setup', 'document', 'X{SERIAL}', 3, 'never', 1)$f$, 'Unknown document kind')
  and at_refused($f$select hub_numbering_save('Ardentax Documents', 'quote', 'X{SERIAL}', 3, 'never', 1)$f$, 'Unknown document kind')
  and at_refused($f$select hub_numbering_save('Ardentax Documents', 'receipt', 'X{SERIAL}', 3, 'never', 1)$f$, 'Unknown document kind')
  and (select count(*) from jsonb_object_keys(hub_numbering_status() -> 'Ardentax Documents')) = 1);
select at_check('quote, letter and receipt saves still work where the setting has them (saved above without error)', true);

-- ── Templates ────────────────────────────────────────────────────────
select at_as(:'quoter');
select at_check('quoter cannot save a template',
  at_refused($f$select hub_library_template_save('{"template_key":"AB Capital/Test/Plain","company":"AB Capital","folder":"Test","name":"Plain"}')$f$, 'permission'));

select at_as(:'manager');
select at_check('manager can save templates',
  hub_library_template_save('{"template_key":"AB Capital/Test/Plain","company":"AB Capital","folder":"Test","name":"Plain","fee_rows":[],"usd_rate":3.6725,"active":true}') = 'AB Capital/Test/Plain'
  and hub_library_template_save('{"template_key":"AB Capital/Test/Other","company":"AB Capital","folder":"Test","name":"Other"}') = 'AB Capital/Test/Other'
  and hub_library_template_save('{"template_key":"AB Capital/Test/Old","company":"AB Capital","folder":"Test","name":"Old"}') = 'AB Capital/Test/Old'
  and hub_library_template_save('{"template_key":"Ardentax/Test/Doc","company":"Ardentax","folder":"Test","name":"Doc"}') = 'Ardentax/Test/Doc');
select at_check('a template key that is not Company/Folder/Name is refused',
  at_refused($f$select hub_library_template_save('{"template_key":"AB Capital/Test/Wrong","company":"AB Capital","folder":"Test","name":"Plain"}')$f$, 'Company/Folder/Name')
  and at_refused($f$select hub_library_template_save('{"template_key":"Other/Test/Plain","company":"Other","folder":"Test","name":"Plain"}')$f$, 'Company must be'));

select hub_library_template_upload('AB Capital/Test/Plain', 'Plain.docx', 'library-templates/AB Capital/11111111-1111-1111-1111-111111111111.docx') as ab_file \gset
select hub_library_template_upload('AB Capital/Test/Other', 'Other.docx', 'library-templates/AB Capital/22222222-2222-2222-2222-222222222222.docx') as other_file \gset
select hub_library_template_upload('AB Capital/Test/Old', 'Old.docx', 'library-templates/AB Capital/33333333-3333-3333-3333-333333333333.docx') as old_file \gset
select hub_library_template_upload('Ardentax/Test/Doc', 'Doc.docx', 'library-templates/Ardentax/44444444-4444-4444-4444-444444444444.docx') as ardent_file \gset
select at_check('upload refuses a path outside library-templates/, a name that is not .docx, a wrong company folder, an unknown template',
  at_refused($f$select hub_library_template_upload('AB Capital/Test/Plain', 'x.docx', 'master-templates/x.docx')$f$, '.docx')
  and at_refused($f$select hub_library_template_upload('AB Capital/Test/Plain', 'x.pdf', 'library-templates/AB Capital/x.pdf')$f$, '.docx')
  and at_refused($f$select hub_library_template_upload('Ardentax/Test/Doc', 'x.docx', 'library-templates/AB Capital/x.docx')$f$, 'must be stored under')
  and at_refused($f$select hub_library_template_upload('AB Capital/Nope/Nope', 'x.docx', 'library-templates/AB Capital/x.docx')$f$, 'Unknown template'));
select at_as(:'quoter');
select at_check('quoter cannot upload a template file',
  at_refused($f$select hub_library_template_upload('AB Capital/Test/Plain', 'x.docx', 'library-templates/AB Capital/x.docx')$f$, 'permission'));
select at_as(:'manager');
select hub_library_template_save('{"template_key":"AB Capital/Test/Old","company":"AB Capital","folder":"Test","name":"Old","active":false}') \gset

select at_check('hub_library_my_access reports the three rights',
  (select hub_library_my_access() = '{"ab": true, "ardentax": false, "manage": true}'::jsonb));
select at_as(:'ardent');
select at_check('hub_library_my_access for the ArdentTax user', (select hub_library_my_access() = '{"ab": false, "ardentax": true, "manage": false}'::jsonb));
select at_as(:'outsider');
select at_check('hub_library_my_access for an outsider', (select hub_library_my_access() = '{"ab": false, "ardentax": false, "manage": false}'::jsonb));

-- ── Numbers ──────────────────────────────────────────────────────────
select at_as(null);
select coalesce(sum(last_serial), 0) as adtq_before from hub_number_counters where department = 'ArdentTax (ASP)' \gset

-- A quote made the ordinary way, then a library quote: the BSQ series carries on.
select at_as(:'quoter');
select (hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', 'Plain Quote LLC', 'contact_name', 'P', 'contact_email', 'p@x.example',
  'contact_phone', '1', 'vat_mode', 'none', 'lines', jsonb_build_array(jsonb_build_object('description', 'Fee', 'amount', 100))))).document_serial as plain_serial \gset
select at_check('AB Capital continues the BSQ series after a Service Documents quote',
  (select document_serial = :plain_serial + 1 and document_number like 'ABC/%/BSQ%' and doc_type = 'quote' and department = 'Business Setup' and vat_mode = 'none' and library_template = 'AB Capital/Test/Plain'
          and library_file_id = :ab_file and field_values = '{"purpose": "test"}'::jsonb and services = array['Setup fee','Filing fee'] and status = 'issued'
     from hub_library_create(at_lib('AB Capital/Test/Plain', :ab_file))));
select at_check('total_amount is recalculated from lines, ignoring a total sent by the browser',
  (select total_amount = 1500.50 and vat_amount = 0 from hub_library_create(at_lib('AB Capital/Test/Plain', :ab_file, '{"total_amount": 99999, "vat_amount": 7}'))));
select at_check('company comes from the template row: a browser company is ignored',
  (select company = 'AB Capital' and department = 'Business Setup' and doc_type = 'quote' from hub_library_create(at_lib('AB Capital/Test/Plain', :ab_file, '{"company": "Ardentax", "department": "Ardentax Documents", "doc_type": "library"}'))));

select at_as(:'ardent');
select at_check('Ardentax starts at ADTD001 and leaves the ADTQ counter unchanged',
  (select document_number = 'Ardentax/' || to_char(now() at time zone 'Asia/Dubai', 'YYYY/MM') || '/ADTD001' and document_serial = 1 and doc_type = 'library' and department = 'Ardentax Documents'
          and company = 'Ardentax' and vat_mode = 'none' and library_template = 'Ardentax/Test/Doc' and library_file_id = :ardent_file and created_by = :'ardent'::uuid
     from hub_library_create(at_lib('Ardentax/Test/Doc', :ardent_file))));
select at_as(null);
select at_check('the ADTQ counter is untouched', (select coalesce(sum(last_serial), 0) = :adtq_before from hub_number_counters where department = 'ArdentTax (ASP)'));

select at_as(:'ardent');
select at_check('Ardentax total is recalculated too, and a browser company is ignored',
  (select total_amount = 1500.50 and company = 'Ardentax' and lines -> 0 ->> 'remarks' = 'one time' from hub_library_create(at_lib('Ardentax/Test/Doc', :ardent_file, '{"total_amount": 5, "company": "AB Capital"}'))));
select at_check('Ardentax stores contact fields and a client id of null when none is given',
  (select contact_email = 'sam@sample.example' and client_address = 'Dubai' and client_id is null from hub_documents where doc_type = 'library' order by created_at limit 1));
select at_check('Ardentax may have no lines', (select total_amount = 0 and lines = '[]'::jsonb and services = '{}' from hub_library_create(at_lib('Ardentax/Test/Doc', :ardent_file, '{"lines": []}'))));
select at_check('a negative Ardentax fee is refused',
  at_refused(format($f$select hub_library_create(at_lib('Ardentax/Test/Doc', %s, '{"lines": [{"description": "x", "amount": -1}]}'))$f$, :ardent_file), 'zero or more'));

select at_check('a client id that does not exist is refused for both companies',
  at_refused(format($f$select hub_library_create(at_lib('Ardentax/Test/Doc', %s, '{"client_id": "NOPE"}'))$f$, :ardent_file), 'Unknown client'));
select at_as(:'quoter');
select at_check('a client id that does not exist is refused for AB Capital (hub_document_create check)',
  at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s, '{"client_id": "NOPE"}'))$f$, :ab_file), 'Unknown client'));

-- ── Voucher Register ─────────────────────────────────────────────────
select at_as(null);
select at_check('library rows are skipped by the Voucher Register, AB Capital rows are recorded',
  (select count(*) from voucher_register v join hub_documents d on d.id = v.source_id and v.source = 'hub' where d.doc_type = 'library') = 0
  and (select count(*) from voucher_register v join hub_documents d on d.id = v.source_id and v.source = 'hub' where d.library_template = 'AB Capital/Test/Plain') = 3
  and (select count(*) from hub_documents where doc_type = 'library') >= 3);

-- ── Refusals ─────────────────────────────────────────────────────────
select at_as(:'manager');
select at_check('retired template is refused',
  at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Old', %s))$f$, :old_file), 'retired'));
select at_check('a file of another template is refused; so is an unknown template',
  at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s))$f$, :other_file), 'does not belong')
  and at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Nope', %s))$f$, :ab_file), 'Unknown template'));
select at_check('AB Capital needs at least one line; contact details are required',
  at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s, '{"lines": []}'))$f$, :ab_file), 'at least one')
  and at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s, '{"contact_phone": ""}'))$f$, :ab_file), 'client details'));
select at_as(:'outsider');
select at_check('outsider cannot create AB Capital: setup.quotes.manage required',
  at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s))$f$, :ab_file), 'permission'));
select at_check('outsider cannot create Ardentax',
  at_refused(format($f$select hub_library_create(at_lib('Ardentax/Test/Doc', %s))$f$, :ardent_file), 'access to Ardentax'));
select at_as(:'quoter');
select at_check('quoter cannot create Ardentax',
  at_refused(format($f$select hub_library_create(at_lib('Ardentax/Test/Doc', %s))$f$, :ardent_file), 'access to Ardentax'));
select at_as(:'ardent');
select at_check('ardent can create Ardentax but not AB Capital',
  (select document_number like '%/ADTD%' from hub_library_create(at_lib('Ardentax/Test/Doc', :ardent_file)))
  and at_refused(format($f$select hub_library_create(at_lib('AB Capital/Test/Plain', %s))$f$, :ab_file), 'permission'));

-- ── Reading ──────────────────────────────────────────────────────────
select at_as(:'outsider');
select at_check('outsider cannot read library rows or Ardentax template rows; AB Capital templates readable',
  (select count(*) from hub_documents where doc_type = 'library') = 0
  and (select count(*) from hub_library_templates where company = 'Ardentax') = 0
  and (select count(*) from hub_library_template_files where template_key like 'Ardentax/%') = 0
  and (select count(*) from hub_library_templates where company = 'AB Capital') = 3
  and (select count(*) from hub_library_template_files where template_key like 'AB Capital/%') = 3
  and (select count(*) from hub_documents where library_template = 'AB Capital/Test/Plain') = 3);
select at_as(:'ardent');
select at_check('the ArdentTax user reads library rows and Ardentax templates',
  (select count(*) from hub_documents where doc_type = 'library') >= 3 and (select count(*) from hub_library_templates where company = 'Ardentax') = 1
  and (select count(*) from hub_library_template_files where template_key like 'Ardentax/%') = 1);
select at_check('nobody can write the new tables directly',
  at_refused($f$insert into hub_library_templates (template_key, company, folder, name) values ('AB Capital/X/Y', 'AB Capital', 'X', 'Y')$f$, 'permission denied')
  and at_refused($f$update hub_documents set field_values = '{}'$f$, 'permission denied'));

-- ── Engagement letter step ───────────────────────────────────────────
select at_as(:'quoter');
select id as lq from hub_library_create(at_lib('AB Capital/Test/Plain', :ab_file)) \gset
select at_check('accepted library quote can take the engagement letter step; unaccepted is refused',
  at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'lq'), 'accepted first')
  or at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'lq'), 'Confirm the signed quote first'));
select at_as(null);
update hub_documents set status = 'accepted', status_at = now() where id = :'lq';
select at_as(:'quoter');
select at_check('accepted library quote gives an engagement letter with its lines and total',
  (select document_number like 'ABC/%/BSE%' and parent_id = :'lq'::uuid and total_amount = 1500.50 and lines -> 0 ->> 'description' = 'Setup fee' and vat_mode = 'none' and library_template is null
     from hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', :'lq'))));

-- ── Storage rules ────────────────────────────────────────────────────
select at_as(null);
select at_check('storage policies for Ardentax Documents and library-templates/Ardentax exist and are restrictive',
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('hub_docs_library_ardentax_read', 'hub_docs_library_ardentax_insert') and permissive = 'RESTRICTIVE') = 2
  and (select bool_and(coalesce(qual, with_check) like '%Ardentax Documents/%' and coalesce(qual, with_check) like '%library-templates/Ardentax/%' and coalesce(qual, with_check) like '%ardentax_can%')
         from pg_policies where schemaname = 'storage' and policyname like 'hub_docs_library_ardentax_%'));

-- ── The migration is the only thing that changed ─────────────────────
select at_check('doc_type and kind checks allow library and document, and library rows keep vat_mode none',
  (select count(*) from pg_constraint where conname = 'hub_documents_doc_type_check' and pg_get_constraintdef(oid) like '%library%') = 1
  and (select count(*) from pg_constraint where conname = 'hub_number_counters_kind_check' and pg_get_constraintdef(oid) like '%document%') = 1
  and (select count(*) from hub_documents where doc_type = 'library' and vat_mode <> 'none') = 0);

-- ── A valid client link ──────────────────────────────────────────────
select at_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900901', 'Linked Client LLC', '{}');
select at_as(:'quoter');
select at_check('AB Capital stores a valid client id',
  (select client_id = 'CL900901' and doc_type = 'quote' from hub_library_create(at_lib('AB Capital/Test/Plain', :ab_file, '{"client_id": "CL900901"}'))));
select at_as(:'ardent');
select at_check('Ardentax stores a valid client id',
  (select client_id = 'CL900901' and doc_type = 'library' from hub_library_create(at_lib('Ardentax/Test/Doc', :ardent_file, '{"client_id": "CL900901"}'))));

-- ── Rights from Template Hub 004_hub_admin stay in place ─────────────
select at_as(null);
select at_check('the numbering functions keep hub_is_admin',
  position('hub_is_admin' in pg_get_functiondef('public.hub_numbering_status'::regproc)) > 0
  and position('hub_is_admin' in pg_get_functiondef('public.hub_numbering_save'::regproc)) > 0);
select at_check('library settings accept a hub admin',
  position('hub_is_admin' in pg_get_functiondef('public.hub_library_template_save'::regproc)) > 0
  and position('hub_is_admin' in pg_get_functiondef('public.hub_library_template_upload'::regproc)) > 0
  and position('hub_is_admin' in pg_get_functiondef('public.hub_library_my_access'::regproc)) > 0);
