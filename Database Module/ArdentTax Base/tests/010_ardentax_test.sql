-- LOCAL TEST ONLY. Numbers, access, totals, revisions, Voucher Register and storage rules for the ArdentTax tab.
\set ON_ERROR_STOP on
\set member '00000000-0000-0000-0000-0000000000a2'
\set outsider '00000000-0000-0000-0000-0000000000a3'

-- ── Numbers ──────────────────────────────────────────────────────────
select at_as(:'member');
select at_check('first quote is ADTQ001', (select document_number = 'Ardentax/' || to_char(now() at time zone 'Asia/Dubai', 'YYYY/MM') || '/ADTQ001' and document_serial = 1 and version = 1 from ardentax_document_create(at_req('quote'))));
select at_check('next quote is ADTQ002', (select document_number like '%/ADTQ002' and document_serial = 2 from ardentax_document_create(at_req('quote'))));
select at_check('first letter is ADTE001 on its own count', (select document_number like '%/ADTE001' and document_serial = 1 and source_quote_id is null from ardentax_document_create(at_req('letter'))));
select at_check('stored figures', (select one_time = 1500 and annual = 4199 and year1_total = 5699 and volume = 3600 and selected_package = 'Established' and client_name = 'Sample Trading LLC' from ardentax_documents where document_number like '%/ADTQ001'));

-- ── One request uses one number ──────────────────────────────────────
do $$
declare r jsonb := at_req('quote'); a ardentax_documents; b ardentax_documents; before int;
begin
  a := ardentax_document_create(r);
  select count(*) into before from ardentax_documents;
  b := ardentax_document_create(r);
  perform at_check('same request_id returns the same row', a.id = b.id);
  perform at_check('same request_id uses no number', (select count(*) from ardentax_documents) = before);
end $$;

-- ── Revisions ────────────────────────────────────────────────────────
do $$
declare q ardentax_documents; v2 ardentax_documents; v3 ardentax_documents;
begin
  q := ardentax_document_create(at_req('quote'));
  v2 := ardentax_document_revise(q.id, at_req('quote'));
  v3 := ardentax_document_revise(v2.id, at_req('quote'));
  perform at_check('revision keeps the number', v2.document_number = q.document_number and v3.document_number = q.document_number);
  perform at_check('revision raises the version', v2.version = 2 and v3.version = 3);
  perform at_check('revision points to what it revises', v2.revision_of = q.id);
end $$;

-- ── Letters from quotes ──────────────────────────────────────────────
do $$
declare q ardentax_documents; l ardentax_documents; v ardentax_documents;
begin
  q := ardentax_document_create(at_req('quote'));
  l := ardentax_document_create(jsonb_build_object('request_id', gen_random_uuid(), 'doc_type', 'letter', 'source_quote_id', q.id));
  perform at_check('letter copies the quote', l.client_name = q.client_name and l.year1_total = q.year1_total and l.source_quote_id = q.id and l.details ->> 'docType' = 'letter');
  perform at_check('second letter for a quote refused', at_refused(format($f$select ardentax_document_create(jsonb_build_object('request_id', gen_random_uuid(), 'doc_type', 'letter', 'source_quote_id', %L::uuid))$f$, q.id), 'already has its engagement letter'));
  v := ardentax_document_revise(l.id, at_req('letter'));
  perform at_check('letter revision keeps the link to its quote', v.source_quote_id = q.id and v.version = 2);
  perform at_check('a letter cannot come from a letter', at_refused(format($f$select ardentax_document_create(jsonb_build_object('request_id', gen_random_uuid(), 'doc_type', 'letter', 'source_quote_id', %L::uuid))$f$, l.id), 'Choose a quote'));
end $$;

-- ── Totals ───────────────────────────────────────────────────────────
do $$
declare f jsonb;
begin
  for f in select jsonb_array_elements(doc) from public.at_fixtures loop
    perform at_check('totals fixture: ' || (f ->> 'name'), ardentax_totals(f -> 'details') @> (f -> 'expect') and (f -> 'expect') @> ardentax_totals(f -> 'details'));
  end loop;
end $$;
select at_check('wrong totals refused', at_refused($f$select ardentax_document_create(at_req('quote', '{"totals":{"one_time":1,"annual":2,"year1":3}}'))$f$, 'totals do not match'));
select at_check('missing client refused', at_refused($f$select ardentax_document_create(at_req('quote') || jsonb_build_object('details', at_req('quote') -> 'details' || '{"client":{"legal":""}}'))$f$, 'client'));
select at_check('unknown document type refused', at_refused($f$select ardentax_document_create(at_req('mail'))$f$, 'document type'));

-- ── Files and mail ───────────────────────────────────────────────────
do $$
declare q ardentax_documents; r ardentax_documents;
begin
  q := ardentax_document_create(at_req('quote'));
  perform at_check('a new document has no file yet', q.word_path is null and q.pdf_path is null);
  perform ardentax_document_attach(q.id, 'ArdentTax (ASP)/' || q.id || '/a.docx', 'ArdentTax (ASP)/' || q.id || '/a.pdf');
  select * into r from ardentax_documents where id = q.id;
  perform at_check('attach records the files', r.word_path like '%a.docx' and r.pdf_path like '%a.pdf');
  perform at_check('attach refuses a path outside the document', at_refused(format($f$select ardentax_document_attach(%L::uuid, 'Accounting/receipts/a.docx', 'x.pdf')$f$, q.id), 'path'));
  perform ardentax_mail_update(q.id, 'a@b.example', 'c@d.example', 'Subj', 'Body', true);
  select * into r from ardentax_documents where id = q.id;
  perform at_check('mail draft saved', r.mail_to = 'a@b.example' and r.mail_cc = 'c@d.example' and r.mail_subject = 'Subj' and r.mail_body = 'Body' and r.mail_attach_word);
  perform at_check('a user cannot mark mail sent', at_refused(format($f$select ardentax_mail_sent(%L::uuid, %L::uuid)$f$, q.id, q.created_by), 'permission denied'));
  perform at_check('a user cannot write the table directly', at_refused(format($f$update ardentax_documents set mail_sent_at = now() where id = %L::uuid$f$, q.id), 'permission denied'));
end $$;

-- ── Voucher Register ─────────────────────────────────────────────────
select at_check('voucher row written', (select count(*) = 1 and bool_and(v.source = 'ardentax' and v.company = 'Ardentax' and v.department = 'ArdentTax (ASP)' and v.voucher_type = 'Quotation' and v.amount = 5699 and v.client_name = 'Sample Trading LLC') from voucher_register v where v.voucher_number like '%/ADTQ001'));
select at_check('letter voucher type', (select voucher_type = 'Engagement Letter' from voucher_register where voucher_number like '%/ADTE001' limit 1));
select at_check('each version has its own voucher row', (select count(*) = (select count(*) from ardentax_documents d) from voucher_register where source = 'ardentax'));
select at_check('voucher version recorded', (select max(version) = 3 from voucher_register where source = 'ardentax'));
select at_check('voucher shows the attached Word file', (select count(*) = 1 from voucher_register v where v.source = 'ardentax' and v.storage_path like '%a.docx'));

-- ── Access ───────────────────────────────────────────────────────────
select at_as(:'outsider');
select at_check('no tab: create refused', at_refused($f$select ardentax_document_create(at_req('quote'))$f$, 'No access'));
select at_check('no tab: table shows nothing', (select count(*) = 0 from ardentax_documents));
select at_check('no tab: voucher rows follow Template Hub', (select count(*) > 0 from voucher_register where source = 'ardentax'));
do $$
declare a_doc uuid;
begin
  perform at_as(null);
  select id into a_doc from ardentax_documents limit 1;
  perform at_as('00000000-0000-0000-0000-0000000000a3');
  perform at_check('no tab: revise refused', at_refused(format($f$select ardentax_document_revise(%L::uuid, at_req('quote'))$f$, a_doc), 'No access'));
  perform at_check('no tab: attach refused', at_refused(format($f$select ardentax_document_attach(%L::uuid, 'a', 'b')$f$, a_doc), 'No access'));
  perform at_check('no tab: mail update refused', at_refused(format($f$select ardentax_mail_update(%L::uuid, 'a', 'b', 'c', 'd', false)$f$, a_doc), 'No access'));
end $$;
select at_as('00000000-0000-0000-0000-0000000000a1');
select at_check('admin may use it without the tab', (select count(*) > 0 from ardentax_documents));
select at_as(:'member');
select at_check('tab holder sees documents', (select count(*) > 0 from ardentax_documents));

-- ── Numbering page ───────────────────────────────────────────────────
select at_as(null);
select at_check('numbering formats stored', (select value -> 'ArdentTax (ASP)' -> 'quote' ->> 'format' = 'Ardentax/{YYYY}/{MM}/ADTQ{SERIAL}' and value -> 'ArdentTax (ASP)' -> 'letter' ->> 'format' = 'Ardentax/{YYYY}/{MM}/ADTE{SERIAL}' and (value -> 'ArdentTax (ASP)' -> 'quote' ->> 'digits')::int = 3 and value -> 'ArdentTax (ASP)' -> 'quote' ->> 'restart' = 'never' from hub_settings where key = 'document_numbering'));
select at_check('numbering page lists the department', hub_numbering_status() ? 'ArdentTax (ASP)');
select at_check('numbering page next quote', (hub_numbering_status() -> 'ArdentTax (ASP)' -> 'quote' ->> 'preview') like '%/ADTQ%');
select at_check('mail defaults stored', (select value ->> 'subject' = 'Ardentax E-Invoicing (ASP) Proposal - {CLIENT}' and value ->> 'body' like 'Dear {POC_FIRST},%' and value ->> 'signature_html' like '%cid:ardentax-banner%' from hub_settings where key = 'ardentax_mail'));

-- ── Storage ──────────────────────────────────────────────────────────
select at_as(null);
insert into storage.buckets (id, name) values ('hub-documents', 'hub-documents') on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('hub-documents', 'ArdentTax (ASP)/x/a.docx'), ('hub-documents', 'Business Setup/x/a.docx');
grant usage on schema storage to authenticated;
grant select, insert on storage.objects to authenticated;
select at_as(:'outsider');
select at_check('no tab: ArdentTax files hidden, others seen', (select string_agg(name, '|') = 'Business Setup/x/a.docx' from storage.objects where bucket_id = 'hub-documents'));
select at_check('no tab: upload to ArdentTax refused', at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'ArdentTax (ASP)/y/a.docx')$f$, 'row-level security'));
select at_as(:'member');
select at_check('tab holder: ArdentTax files seen', (select count(*) = 2 from storage.objects where bucket_id = 'hub-documents'));
insert into storage.objects (bucket_id, name) values ('hub-documents', 'ArdentTax (ASP)/y/a.docx');
select at_check('tab holder: upload allowed', true);

-- ── Other departments are unchanged ──────────────────────────────────
select at_as(null);
select at_check('other departments still have numbering', (select value ? 'Business Setup' and value ? 'Accounting' and value ? 'Tax Compliance' from hub_settings where key = 'document_numbering'));
select at_check('hub_next_number still works for Tax Compliance', hub_next_number('Tax Compliance', 'quote') like 'ABC/%/TCQ%');
