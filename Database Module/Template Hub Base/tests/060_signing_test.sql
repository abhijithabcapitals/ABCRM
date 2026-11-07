-- LOCAL TEST ONLY. Shared document signing (011): approvers per company, the company from the row, signed paths, the change stamp,
-- one live signature, supersede on a content edit, the signature images, and the settings move. People and documents are invented.
\set ON_ERROR_STOP on
\set admin  '00000000-0000-0000-0000-0000000000d1'
\set abappr '00000000-0000-0000-0000-0000000000d2'
\set atappr '00000000-0000-0000-0000-0000000000d3'
\set plain  '00000000-0000-0000-0000-0000000000d4'
\set hubmgr '00000000-0000-0000-0000-0000000000d5'
\set oldappr '00000000-0000-0000-0000-0000000000d6'
\set h1  '00000000-0000-0000-0000-00000000e001'
\set h2  '00000000-0000-0000-0000-00000000e002'
\set a1  '00000000-0000-0000-0000-00000000e003'
\set bq1 '00000000-0000-0000-0000-00000000e004'
\set bl1 '00000000-0000-0000-0000-00000000e005'
\set br1 '00000000-0000-0000-0000-00000000e006'
\set bp1 '00000000-0000-0000-0000-00000000e007'
\set bc1 '00000000-0000-0000-0000-00000000e008'
\set bca '00000000-0000-0000-0000-00000000e009'

select at_as(null);
insert into auth.users (id) values (:'admin'), (:'abappr'), (:'atappr'), (:'plain'), (:'hubmgr'), (:'oldappr') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  (:'admin', 'SG Admin', 'admin'), (:'abappr', 'SG AB Approver', 'member'), (:'atappr', 'SG AT Approver', 'member'),
  (:'plain', 'SG Plain', 'member'), (:'hubmgr', 'SG Hub Manager', 'member'), (:'oldappr', 'SG Old Approver', 'member') on conflict (id) do nothing;
insert into public.banking_user_roles (user_id, role) values (:'hubmgr', 'MANAGER') on conflict do nothing;
-- The AB Capital approver also has the ArdentTax tab, so it can read the Ardentax rows and is refused as a non-approver, not as a non-reader.
insert into public.member_tab_access (profile_id, tab_key) values (:'atappr', 'ardentax'), (:'abappr', 'ardentax') on conflict do nothing;
insert into public.banking_user_permissions (user_id, permission, allowed) values
  (:'abappr', 'quotes.view', true), (:'abappr', 'agreements.view', true), (:'abappr', 'payments.view', true) on conflict do nothing;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
insert into storage.buckets (id, name) values ('hub-documents', 'hub-documents') on conflict do nothing;

-- One document of each family. Signed paths go under <prefix>/<id>/signed/.
insert into hub_documents (id, doc_type, department, client_name, document_number, storage_path, word_path)
  values (:'h1', 'quote', 'Business Setup', 'Sign Test LLC', 'SG-Q-1', 'Business Setup/' || :'h1' || '/u.pdf', 'Business Setup/' || :'h1' || '/u.docx');
insert into hub_documents (id, doc_type, department, client_name, document_number, library_template, word_path)
  values (:'h2', 'library', 'Ardentax Documents', 'Sign Test LLC', 'SG-L-1', 'Ardentax/Test/Signing', 'Ardentax Documents/' || :'h2' || '/u.docx');
insert into ardentax_documents (id, request_id, doc_type, document_number, quote_type, client_name, details, word_path, pdf_path)
  values (:'a1', gen_random_uuid(), 'quote', 'SG-AT-1', 'Standard', 'Sign Test LLC', '{}'::jsonb,
          'ArdentTax (ASP)/' || :'a1' || '/x/u.docx', 'ArdentTax (ASP)/' || :'a1' || '/x/u.pdf');
insert into banking_clients (id, display_name) values (:'bc1', 'Sign Test Banking Co');
insert into banking_cases (id, client_id) values (:'bca', :'bc1');
insert into banking_quotations (id, case_id) values (:'bq1', :'bca');
insert into banking_engagement_letters (id, case_id, quotation_id) values (:'bl1', :'bca', :'bq1');
insert into banking_payments (id, case_id, payment_date, amount) values (:'bp1', :'bca', current_date, 10);
insert into banking_receipts (id, payment_id) values (:'br1', :'bp1');
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'bca', 'quote', :'bq1', 'SG-BQ-1', 'q.docx', :'bca' || '/generated/old-q.docx');

-- A signing request; p_extra is merged over it.
create or replace function public.at_sign(p_table text, p_id uuid, p_prefix text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('source_table', p_table, 'source_id', p_id, 'word_path', p_prefix || '/' || p_id || '/signed/s.docx',
    'pdf_path', p_prefix || '/' || p_id || '/signed/s.pdf', 'seen', doc_changed_at(p_table, p_id)) || p_extra
$$;
grant execute on function public.at_sign(text, uuid, text, jsonb) to authenticated;

-- ── settings move ────────────────────────────────────────────────────
-- Accounting's approvers and image as they stood before 011: the migration seeds ab_capital from them and keeps them in place.
delete from hub_settings where key = 'document_signing';
update hub_settings set value = value || jsonb_build_object('approvers', jsonb_build_array(:'oldappr'), 'signature_path', 'accounting-signature/old-test.png',
  'signature_uploaded_at', '2026-01-01T00:00:00Z', 'signature_uploaded_by', :'admin') where key = 'accounting_proposal_defaults';
set client_min_messages = warning;
\ir ../migrations/011_document_signing.sql
set client_min_messages = notice;
select at_as(null);
select at_check('the settings move keeps the old approver and the existing path in ab_capital',
  (select value #> '{companies,ab_capital,approvers}' = jsonb_build_array(:'oldappr') and value #>> '{companies,ab_capital,signature_path}' = 'accounting-signature/old-test.png'
      and value #>> '{companies,ab_capital,uploaded_by}' = :'admin' and value #>> '{companies,ab_capital,name}' = 'AB Capital Services FZE'
      and value #> '{companies,ardentax,approvers}' = '[]'::jsonb and value #>> '{companies,ardentax,signature_path}' is null
     from hub_settings where key = 'document_signing'));
select at_check('and Accounting still holds them, so its screens keep working',
  (select value -> 'approvers' = jsonb_build_array(:'oldappr') and value ->> 'signature_path' = 'accounting-signature/old-test.png'
     from hub_settings where key = 'accounting_proposal_defaults'));
set client_min_messages = warning;
\ir ../migrations/011_document_signing.sql
set client_min_messages = notice;
select at_as(null);
select at_check('the migration runs again and keeps the setting',
  (select value #> '{companies,ab_capital,approvers}' = jsonb_build_array(:'oldappr') from hub_settings where key = 'document_signing'));

-- ── approvers per company ────────────────────────────────────────────
select at_as(:'abappr');
select at_check('a non-admin approver cannot change the lists', at_refused($f$select doc_sign_admin_save('{"company": "ab_capital", "approvers": []}')$f$, 'CRM administrator'));
select at_as(:'hubmgr');
select at_check('nor can a Hub-admin manager', at_refused($f$select doc_sign_admin_save('{"company": "ab_capital", "approvers": []}')$f$, 'CRM administrator'));
select at_as(:'admin');
select at_check('an unknown company is refused', at_refused($f$select doc_sign_admin_save('{"company": "other", "approvers": []}')$f$, 'Unknown signing company'));
select at_check('an unknown approver is refused', at_refused($f$select doc_sign_admin_save('{"company": "ab_capital", "approvers": ["not-a-uuid"]}')$f$, 'known user'));
select at_check('an image outside its company folder is refused',
  at_refused($f$select doc_sign_admin_save('{"company": "ab_capital", "signature_path": "elsewhere/x.png"}')$f$, 'signatures/ab_capital/')
  and at_refused($f$select doc_sign_admin_save('{"company": "ab_capital", "signature_path": "signatures/ardentax/x.png"}')$f$, 'signatures/ab_capital/')
  and at_refused($f$select doc_sign_admin_save('{"company": "ardentax", "signature_path": "accounting-signature/x.png"}')$f$, 'signatures/ardentax/'));
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'abappr'), 'signature_path', 'signatures/ab_capital/sig.png')) is not null as s1 \gset
select doc_sign_admin_save(jsonb_build_object('company', 'ardentax', 'approvers', '[]'::jsonb, 'signature_path', 'signatures/ardentax/sig.png')) is not null as s2 \gset
select at_check('the save records the uploader and keeps the other company',
  (select value #>> '{companies,ab_capital,uploaded_by}' = :'admin' and value #>> '{companies,ab_capital,uploaded_at}' is not null
      and value #>> '{companies,ardentax,signature_path}' = 'signatures/ardentax/sig.png' from hub_settings where key = 'document_signing'));
select at_check('the AB Capital list and image are mirrored into the Accounting setting',
  (select value -> 'approvers' = jsonb_build_array(:'abappr') and value ->> 'signature_path' = 'signatures/ab_capital/sig.png' and value ->> 'signature_uploaded_by' = :'admin'
     from hub_settings where key = 'accounting_proposal_defaults'));
select at_check('the admin is not an AB Capital approver while the list has someone, but is the Ardentax approver while its list is empty',
  not doc_sign_can('ab_capital') and doc_sign_can('ardentax'));
select at_check('an unknown company has no approver, not even an admin', not doc_sign_can('other') and not doc_sign_can(null));
select at_as(:'abappr');
select at_check('the listed person approves for AB Capital only', doc_sign_can('ab_capital') and not doc_sign_can('ardentax'));
select at_check('hub_acct_can_approve follows the AB Capital list', hub_acct_can_approve());
select at_as(:'hubmgr');
select at_check('a Hub-admin manager approves for neither', not doc_sign_can('ab_capital') and not doc_sign_can('ardentax') and not hub_acct_can_approve());
select at_as(:'plain');
select at_check('a plain member approves for neither', not doc_sign_can('ab_capital') and not doc_sign_can('ardentax'));
select at_as(null);
select at_check('signed out approves for neither', not doc_sign_can('ab_capital') and not doc_sign_can('ardentax'));

-- Accounting's own save still works and reaches the shared list.
select at_as(:'admin');
select hub_acct_admin_save(jsonb_build_object('approvers', jsonb_build_array(:'abappr', :'oldappr'))) is not null as s3 \gset
select at_check('hub_acct_admin_save changes the AB Capital list too',
  (select value #> '{companies,ab_capital,approvers}' = jsonb_build_array(:'abappr', :'oldappr') from hub_settings where key = 'document_signing'));
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'abappr'))) is not null as s4 \gset
-- An Ardentax approver for the rest of the file.
select doc_sign_admin_save(jsonb_build_object('company', 'ardentax', 'approvers', jsonb_build_array(:'atappr'))) is not null as s5 \gset

-- ── the company comes from the row ───────────────────────────────────
select at_as(null);
select at_check('doc_company reads the row',
  doc_company('hub_documents', :'h1') = 'ab_capital' and doc_company('hub_documents', :'h2') = 'ardentax' and doc_company('ardentax_documents', :'a1') = 'ardentax'
  and doc_company('banking_quotations', :'bq1') = 'ab_capital' and doc_company('banking_engagement_letters', :'bl1') = 'ab_capital' and doc_company('banking_receipts', :'br1') = 'ab_capital');
select at_check('a missing row has no company', doc_company('hub_documents', gen_random_uuid()) is null);
select at_as(:'abappr');
select at_check('doc_company is not callable from the browser', at_refused(format($f$select doc_company('hub_documents', %L)$f$, :'h1'), 'permission denied'));
select at_as(:'atappr');
select at_check('an Ardentax approver cannot sign an AB Capital document by naming Ardentax',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', '{"company": "ardentax"}'))$f$, :'h1'), 'not an approver'));
select at_as(:'abappr');
select at_check('an AB Capital approver cannot sign an Ardentax library document by naming AB Capital',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Ardentax Documents', '{"company": "ab_capital"}'))$f$, :'h2'), 'not an approver'));

-- ── a caller who cannot read learns nothing ──────────────────────────
select at_as(:'plain');
select at_check('a missing document and an unreadable one give the same message, before any approver check',
  at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'ArdentTax (ASP)'))$f$, gen_random_uuid()), 'The document was not found')
  and at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'ArdentTax (ASP)'))$f$, :'a1'), 'The document was not found')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Ardentax Documents'))$f$, :'h2'), 'The document was not found')
  and not at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'ArdentTax (ASP)'))$f$, :'a1'), 'approver'));

-- ── non-approver refused ─────────────────────────────────────────────
select at_as(:'plain');
select at_check('a non-approver cannot record a signature', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'h1'), 'not an approver'));
select at_check('nor write the table directly',
  at_refused(format($f$insert into document_signatures (source_table, source_id, company, signed_by) values ('hub_documents', %L, 'ab_capital', %L)$f$, :'h1', :'plain'), 'permission denied'));
select at_as(:'hubmgr');
select at_check('nor can a Hub-admin manager', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'h1'), 'not an approver'));

-- ── paths under the document's own prefix ────────────────────────────
select at_as(:'abappr');
select at_check('hub_documents: a path outside <department>/<id>/signed/ is refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting'))$f$, :'h1'), 'signed/')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/%s/u.pdf')))$f$, :'h1', :'h1'), 'signed/')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/%s/signed/../u.pdf')))$f$, :'h1', :'h1'), 'signed/')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/%s/signed/a/b.pdf')))$f$, :'h1', :'h1'), 'signed/'));
select at_check('both signed files are needed', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', '{"word_path": null}'))$f$, :'h1'), 'Word and PDF'));
select at_check('banking_quotations: a path outside <case>/generated/<id>/signed/ is refused',
  at_refused(format($f$select doc_sign_record(at_sign('banking_quotations', %L, '%s'))$f$, :'bq1', :'bca'), 'signed/'));
select at_check('banking_engagement_letters: likewise', at_refused(format($f$select doc_sign_record(at_sign('banking_engagement_letters', %L, 'Business Banking'))$f$, :'bl1'), 'signed/'));
select at_check('banking_receipts: likewise', at_refused(format($f$select doc_sign_record(at_sign('banking_receipts', %L, '%s/receipts'))$f$, :'br1', :'bca'), 'signed/'));
select at_as(:'atappr');
select at_check('ardentax_documents: a path outside ArdentTax (ASP)/<id>/signed/ is refused',
  at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'Ardentax Documents'))$f$, :'a1'), 'signed/'));
select at_check('hub_documents Ardentax library: a path outside Ardentax Documents/<id>/signed/ is refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'ArdentTax (ASP)'))$f$, :'h2'), 'signed/'));
select at_check('an unknown table is refused', at_refused(format($f$select doc_sign_record(at_sign('profiles', %L, 'x'))$f$, :'h1'), 'Unknown document table'));

-- ── the change stamp ─────────────────────────────────────────────────
select at_as(:'abappr');
select at_check('a stale seen is refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('seen', doc_changed_at('hub_documents', %L) - interval '1 second')))$f$, :'h1', :'h1'), 'The document changed')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', '{"seen": null}'))$f$, :'h1'), 'The document changed'));
select at_check('a future seen is refused, even now() and infinity',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('seen', doc_changed_at('hub_documents', %L) + interval '1 second')))$f$, :'h1', :'h1'), 'The document changed')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('seen', now())))$f$, :'h1'), 'The document changed')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', '{"seen": "infinity"}'))$f$, :'h1'), 'The document changed'));
select at_check('the stamp of a document never edited is its creation time', doc_changed_at('hub_documents', :'h1') = (select created_at from hub_documents where id = :'h1'));

-- ── record, then a second record ─────────────────────────────────────
-- The exact stamp is accepted (sig0, superseded at once by sig1); so is the stamp cut to the millisecond, as a browser keeps it.
select id as sig0 from doc_sign_record(at_sign('hub_documents', :'h1', 'Business Setup')) \gset
select at_check('the exact seen is accepted', (select signed_by = :'abappr'::uuid from document_signatures where id = :'sig0'));
select id as sig1 from doc_sign_record(at_sign('hub_documents', :'h1', 'Business Setup',
  jsonb_build_object('seen', to_char(date_trunc('milliseconds', doc_changed_at('hub_documents', :'h1')) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))) \gset
select at_check('a seen cut to the millisecond is accepted', (select superseded_reason = 'Signed again' from document_signatures where id = :'sig0'));
select at_check('the record holds the company, signer, signed and unsigned files and the stamp',
  (select company = 'ab_capital' and signed_by = :'abappr'::uuid and signed_at is not null and superseded_at is null
      and word_path = 'Business Setup/' || :'h1' || '/signed/s.docx' and pdf_path = 'Business Setup/' || :'h1' || '/signed/s.pdf'
      and unsigned_word_path = 'Business Setup/' || :'h1' || '/u.docx' and unsigned_pdf_path = 'Business Setup/' || :'h1' || '/u.pdf'
      and document_changed_at = (select created_at from hub_documents where id = :'h1')
     from document_signatures where id = :'sig1'));
select at_check('doc_sign_live returns it', (doc_sign_live('hub_documents', :'h1')).id = :'sig1'::uuid);
select at_check('the document row keeps its unsigned files', (select storage_path = 'Business Setup/' || :'h1' || '/u.pdf' from hub_documents where id = :'h1'));
select id as sig2 from doc_sign_record(at_sign('hub_documents', :'h1', 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/' || :'h1' || '/signed/t.pdf'))) \gset
select at_check('a second record supersedes the first',
  (select superseded_at is not null and superseded_reason = 'Signed again' from document_signatures where id = :'sig1')
  and (doc_sign_live('hub_documents', :'h1')).id = :'sig2'::uuid
  and (select count(*) = 1 from document_signatures where source_table = 'hub_documents' and source_id = :'h1' and superseded_at is null));
select at_as(null);
select at_check('at most one live signature per document, held by a unique index',
  at_refused(format($f$insert into document_signatures (source_table, source_id, company, signed_by) values ('hub_documents', %L, 'ab_capital', %L)$f$, :'h1', :'abappr'), 'duplicate key'));

-- ── every family can be signed ───────────────────────────────────────
select at_as(:'abappr');
select at_check('a banking quotation is signed under <case>/generated/<id>/signed/, its unsigned Word file from the generated documents',
  (select company = 'ab_capital' and unsigned_word_path = :'bca' || '/generated/old-q.docx' and unsigned_pdf_path is null
     from doc_sign_record(at_sign('banking_quotations', :'bq1', :'bca' || '/generated'))));
select at_check('a banking engagement letter is signed', (doc_sign_record(at_sign('banking_engagement_letters', :'bl1', :'bca' || '/generated'))).company = 'ab_capital');
select at_check('a banking receipt is signed', (doc_sign_record(at_sign('banking_receipts', :'br1', :'bca' || '/generated'))).company = 'ab_capital');
select at_as(:'atappr');
select at_check('an Ardentax document is signed for Ardentax',
  (select company = 'ardentax' and unsigned_pdf_path = 'ArdentTax (ASP)/' || :'a1' || '/x/u.pdf' from doc_sign_record(at_sign('ardentax_documents', :'a1', 'ArdentTax (ASP)'))));
select at_check('an Ardentax library document is signed for Ardentax', (doc_sign_record(at_sign('hub_documents', :'h2', 'Ardentax Documents'))).company = 'ardentax');

-- ── who sees a signature ─────────────────────────────────────────────
select at_as(:'plain');
select at_check('a plain member sees the AB Capital quote signature, not the Ardentax or banking ones',
  (select count(*) = 1 from document_signatures where source_id = :'h1' and superseded_at is null)
  and (select count(*) = 0 from document_signatures where source_id in (:'h2', :'a1', :'bq1', :'bl1', :'br1'))
  and doc_sign_live('ardentax_documents', :'a1') is null);
select at_check('and is refused the stamp of a document they cannot read', doc_changed_at('ardentax_documents', :'a1') is null);
select at_as(:'atappr');
select at_check('the Ardentax tab user sees the Ardentax signatures', (select count(*) = 2 from document_signatures where source_id in (:'h2', :'a1')));
select at_as(:'abappr');
select at_check('a banking viewer sees the banking signatures', (select count(*) = 3 from document_signatures where source_id in (:'bq1', :'bl1', :'br1')));

-- ── a content edit supersedes ────────────────────────────────────────
select at_as(null);
update hub_documents set mail_subject = 'Changed subject', status = 'accepted', mail_sent_at = now() where id = :'h1';
select at_check('a mail or status change keeps the signature', (doc_sign_live('hub_documents', :'h1')).id = :'sig2'::uuid
  and (select content_changed_at is null from hub_documents where id = :'h1'));
update hub_documents set client_name = 'Sign Test Renamed LLC' where id = :'h1';
select at_check('a content edit sets the stamp and supersedes the live signature',
  doc_sign_live('hub_documents', :'h1') is null and (select content_changed_at is not null from hub_documents where id = :'h1')
  and (select superseded_reason = 'Document changed' from document_signatures where id = :'sig2'));
update hub_documents set client_name = 'Sign Test Renamed LLC' where id = :'h1';
select at_check('an update to the same value changes nothing', (select count(*) = 3 from document_signatures where source_id = :'h1'));
update ardentax_documents set client_name = 'Sign Test Renamed LLC' where id = :'a1';
update banking_quotations set remarks = 'changed' where id = :'bq1';
update banking_engagement_letters set status = 'Sent to Client' where id = :'bl1';
select at_check('an ardentax edit supersedes', doc_sign_live('ardentax_documents', :'a1') is null);
select at_check('a quotation edit supersedes', doc_sign_live('banking_quotations', :'bq1') is null);
select at_check('a letter status change does not', (doc_sign_live('banking_engagement_letters', :'bl1')).id is not null);
-- Receipts are append-only: a regenerated receipt file is a new generated document, which moves the stamp.
insert into banking_generated_documents (case_id, kind, payment_id, document_number, file_name, storage_path)
  values (:'bca', 'receipt', :'bp1', 'SG-RC-1', 'r.docx', :'bca' || '/generated/new-r.docx');
-- (013 also ends the receipt's live signature then; 100_banking_signing_test.sql covers that.)
select at_check('a regenerated receipt file moves the stamp past the signature',
  doc_sign_stamp('banking_receipts', :'br1') > (select document_changed_at from document_signatures where source_table = 'banking_receipts' and source_id = :'br1' order by signed_at desc limit 1));
update banking_engagement_letters set content = '{"x": 1}' where id = :'bl1';
select at_check('a letter content edit supersedes', doc_sign_live('banking_engagement_letters', :'bl1') is null);
select at_check('the new stamp is what a signer must now have seen',
  doc_sign_stamp('ardentax_documents', :'a1') = (select content_changed_at from ardentax_documents where id = :'a1')
  and doc_sign_stamp('banking_quotations', :'bq1') = (select content_changed_at from banking_quotations where id = :'bq1'));
select at_check('signed out, doc_changed_at gives nothing', doc_changed_at('hub_documents', :'h1') is null);
select at_as(:'abappr');
select at_check('a signer holding the old stamp is refused after the edit',
  at_refused(format($f$select doc_sign_record(at_sign('banking_quotations', %L, '%s/generated', jsonb_build_object('seen', %L::timestamptz)))$f$, :'bq1', :'bca',
    (select document_changed_at from document_signatures where source_id = :'bq1' order by signed_at limit 1)), 'The document changed'));

-- A multi-option quote: accepting an option rewrites lines and totals from that option, which is not a content edit.
select at_as(null);
insert into hub_documents (id, doc_type, department, client_name, document_number, library_template, field_values, storage_path, word_path)
  values ('00000000-0000-0000-0000-00000000e00a', 'quote', 'Accounting', 'Sign Test LLC', 'SG-ACQ-1', 'AB Capital/Accounting Quote',
          '{"quote": {"options": [{"name": "A"}, {"name": "B"}]}}', 'Accounting/00000000-0000-0000-0000-00000000e00a/u.pdf', 'Accounting/00000000-0000-0000-0000-00000000e00a/u.docx');
select at_as(:'abappr');
select doc_sign_record(at_sign('hub_documents', '00000000-0000-0000-0000-00000000e00a', 'Accounting')) is not null as s10 \gset
select at_as(null);
update hub_documents set field_values = jsonb_set(jsonb_set(field_values, '{quote,accepted_option}', '1'), '{file_history}', '[]'),
       lines = '[{"description": "B", "amount": 1}]', services = '{B}', total_amount = 1, status = 'accepted' where id = '00000000-0000-0000-0000-00000000e00a';
select at_check('accepting an option of a multi-option quote keeps its signature', (doc_sign_live('hub_documents', '00000000-0000-0000-0000-00000000e00a')).id is not null);
update hub_documents set field_values = jsonb_set(field_values, '{quote,options,0,name}', '"A2"') where id = '00000000-0000-0000-0000-00000000e00a';
select at_check('changing its options supersedes it', doc_sign_live('hub_documents', '00000000-0000-0000-0000-00000000e00a') is null);
select at_as(:'abappr');

-- ── doc_sign_supersede ───────────────────────────────────────────────
select id as sig3 from doc_sign_record(at_sign('hub_documents', :'h1', 'Business Setup')) \gset
select at_as(:'plain');
select at_check('a reader who is not an approver cannot withdraw an unchanged signature',
  at_refused(format($f$select doc_sign_supersede('hub_documents', %L, 'test')$f$, :'h1'), 'not an approver'));
select at_as(:'abappr');
select doc_sign_supersede('hub_documents', :'h1', 'Regenerated') as sp \gset
select at_check('an approver withdraws it with a reason', :'sp'::boolean and doc_sign_live('hub_documents', :'h1') is null
  and (select superseded_reason = 'Regenerated' from document_signatures where id = :'sig3'));
select at_check('withdrawing with nothing live is a no-op', not doc_sign_supersede('hub_documents', :'h1', 'again'));
select id as sig4 from doc_sign_record(at_sign('hub_documents', :'h1', 'Business Setup')) \gset
select at_as(null);
update hub_documents set notes = 'edited' where id = :'h1';
update document_signatures set superseded_at = null, superseded_reason = null where id = :'sig4';
select at_as(:'plain');
select doc_sign_supersede('hub_documents', :'h1', 'Edited') as sp2 \gset
select at_check('once the document changed after signing, any reader may withdraw it (an edit path)',
  :'sp2'::boolean and doc_sign_live('hub_documents', :'h1') is null);

-- ── a company with no image ──────────────────────────────────────────
select at_as(:'admin');
select doc_sign_admin_save('{"company": "ardentax", "signature_path": null}') is not null as s6 \gset
select at_as(:'atappr');
select at_check('signing needs the company image', at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'ArdentTax (ASP)'))$f$, :'a1'), 'Upload the Ardentax signature'));
select at_as(:'admin');
select doc_sign_admin_save('{"company": "ardentax", "signature_path": "signatures/ardentax/sig.png"}') is not null as s7 \gset

-- ── unsigned documents are not blocked ───────────────────────────────
select at_as(null);
update hub_documents set storage_path = 'Business Setup/' || :'h1' || '/u2.pdf', mail_sent_at = now() where id = :'h1';
insert into hub_documents (doc_type, department, client_name, document_number) values ('quote', 'Business Setup', 'Unsigned Test LLC', 'SG-Q-2');
select at_check('unsigned documents still insert and update', (select count(*) = 1 from hub_documents where document_number = 'SG-Q-2')
  and (select storage_path like '%/u2.pdf' from hub_documents where id = :'h1'));

-- ── signature images ─────────────────────────────────────────────────
-- ab_capital approvers: abappr. ardentax approvers: atappr. The admin is on neither list.
select at_as(:'plain');
select at_check('a non-approver cannot add an image', at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'signatures/ab_capital/forged.png')$f$, 'row-level security'));
select at_as(:'abappr');
select at_check('an approver who is not an admin cannot add one either',
  at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'signatures/ab_capital/forged.png')$f$, 'row-level security')
  and at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/forged.png')$f$, 'row-level security'));
select at_as(:'admin');
insert into storage.objects (bucket_id, name) values ('hub-documents', 'signatures/ab_capital/sig.png'), ('hub-documents', 'signatures/ardentax/sig.png'), ('hub-documents', 'signatures/ardentax/old.png');
select at_check('an admin adds images for both companies', true);
select at_check('an admin on neither list reads both companies'' images', (select count(*) = 3 from storage.objects where name like 'signatures/%'));
select at_as(:'abappr');
select at_check('the AB Capital approver reads the AB Capital image and the Accounting one, not the Ardentax one',
  (select count(*) = 1 from storage.objects where name = 'signatures/ab_capital/sig.png')
  and (select count(*) >= 1 from storage.objects where name like 'accounting-signature/%')
  and (select count(*) = 0 from storage.objects where name like 'signatures/ardentax/%'));
delete from storage.objects where name like 'signatures/%';
select at_as(:'atappr');
select at_check('the Ardentax approver reads only the Ardentax images',
  (select count(*) = 2 from storage.objects where name like 'signatures/ardentax/%') and (select count(*) = 0 from storage.objects where name like 'signatures/ab_capital/%')
  and (select count(*) = 0 from storage.objects where name like 'accounting-signature/%'));
delete from storage.objects where name like 'signatures/%';
update storage.objects set name = 'signatures/ardentax/moved.png' where name = 'signatures/ardentax/old.png';
select at_as(:'plain');
select at_check('a non-approver reads no image', (select count(*) = 0 from storage.objects where name like 'signatures/%' or name like 'accounting-signature/%'));
delete from storage.objects where name like 'signatures/%';
select at_as(null);
select at_check('approvers and non-approvers deleted or moved nothing',
  (select count(*) = 3 from storage.objects where name like 'signatures/%') and (select count(*) = 0 from storage.objects where name like '%moved.png'));
-- The admin is on neither list (ab_capital: abappr, ardentax: atappr) and still manages both companies' images.
select at_as(:'admin');
select at_check('the admin is an approver of neither company', not doc_sign_can('ab_capital') and not doc_sign_can('ardentax'));
with d as (delete from storage.objects where name = 'signatures/ardentax/old.png' returning name) select count(*) as del_n from d \gset
with u as (update storage.objects set name = 'signatures/ab_capital/sig-v2.png' where name = 'signatures/ab_capital/sig.png' returning name) select count(*) as upd_n from u \gset
select at_as(null);
select at_check('an admin on neither list deletes an image (delete with RETURNING)', :'del_n' = '1' and (select count(*) = 0 from storage.objects where name = 'signatures/ardentax/old.png'));
select at_check('and replaces one (update with RETURNING)', :'upd_n' = '1' and (select count(*) = 1 from storage.objects where name = 'signatures/ab_capital/sig-v2.png')
  and (select count(*) = 1 from storage.objects where name = 'signatures/ardentax/sig.png'));
select at_check('the image policies are restrictive and cover both prefixes',
  (select count(*) = 4 from pg_policies where policyname in ('doc_sign_image_read', 'doc_sign_image_insert', 'doc_sign_image_update', 'doc_sign_image_delete')
     and permissive = 'RESTRICTIVE' and coalesce(qual, with_check) like '%signatures/%' and coalesce(qual, with_check) like '%accounting-signature/%'));
select at_as(null);

-- ── the mirror runs at any trigger depth ─────────────────────────────
-- A trigger on another table changes Accounting's approvers: the mirror must still reach document_signing.
create table public.at_sign_poke (id int);
create or replace function public.at_sign_poke_fn() returns trigger language plpgsql as $f$
begin
  update hub_settings set value = value || jsonb_build_object('approvers', jsonb_build_array('00000000-0000-0000-0000-0000000000d6')) where key = 'accounting_proposal_defaults';
  return new;
end $f$;
create trigger at_sign_poke after insert on public.at_sign_poke for each row execute function public.at_sign_poke_fn();
insert into public.at_sign_poke values (1);
select at_check('an update made from inside another trigger still mirrors',
  (select value #> '{companies,ab_capital,approvers}' = jsonb_build_array(:'oldappr') from hub_settings where key = 'document_signing'));
select at_check('the sync flag does not outlast the statement', coalesce(current_setting('doc_sign.syncing', true), '') <> 'on');
update hub_settings set value = jsonb_set(value, '{companies,ab_capital,approvers}', jsonb_build_array(:'abappr')) where key = 'document_signing';
select at_check('and the reverse direction mirrors too', (select value -> 'approvers' = jsonb_build_array(:'abappr') from hub_settings where key = 'accounting_proposal_defaults'));
drop table public.at_sign_poke;
drop function public.at_sign_poke_fn();
