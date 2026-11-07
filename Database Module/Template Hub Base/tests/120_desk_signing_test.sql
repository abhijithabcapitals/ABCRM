-- LOCAL TEST ONLY. Service Desk old form quotations and engagement letters (hub_documents of Accounting, Tax Compliance, Business
-- Setup and Business Banking without a library template) on the shared signing (011), as Template Module/logic/deskSigning.js uses
-- it: signing is optional, the company is AB Capital from the row whatever the caller says, the signed files sit under
-- <department>/<id>/signed/, and a new file (hub_document_attach, Create file) ends the signature in the database. No migration of its
-- own: 011 covers these rows. The screen's doc_sign_supersede after Create file is the second line and never refuses a save.
-- People and documents are invented. Uses at_sign from 060_signing_test.sql.
\set ON_ERROR_STOP on
\set appr  '00000000-0000-0000-0000-0000000000b5'
\set staff '00000000-0000-0000-0000-0000000000b6'
\set admin '00000000-0000-0000-0000-0000000000b7'
\set aq    '00000000-0000-0000-0000-00000000b702'
\set tl    '00000000-0000-0000-0000-00000000b703'
\set bq    '00000000-0000-0000-0000-00000000b704'
\set sq    '00000000-0000-0000-0000-00000000b705'

select at_as(null);
insert into auth.users (id) values (:'appr'), (:'staff'), (:'admin') on conflict do nothing;
insert into public.profiles (id, full_name, role) values (:'appr', 'SD Approver', 'member'), (:'staff', 'SD Staff', 'member'), (:'admin', 'SD Admin', 'admin')
  on conflict (id) do nothing;
insert into hub_documents (id, doc_type, department, document_number, client_name, lines, total_amount, created_by) values
  (:'aq', 'quote', 'Accounting', 'TEST/AQ/1', 'TEST CLIENT - DO NOT USE', '[{"description": "Bookkeeping", "amount": 100}]', 100, :'staff'),
  (:'bq', 'quote', 'Business Banking', 'TEST/BBQ/1', 'TEST CLIENT - DO NOT USE', '[{"description": "Account opening", "amount": 100}]', 100, :'staff'),
  (:'sq', 'quote', 'Business Setup', 'TEST/BSQ/9', 'TEST CLIENT - DO NOT USE', '[{"description": "Formation", "amount": 100}]', 100, :'staff');
insert into hub_documents (id, doc_type, department, document_number, client_name, parent_id, created_by)
  values (:'tl', 'letter', 'Tax Compliance', 'TEST/TL/1', 'TEST CLIENT - DO NOT USE', null, :'staff');

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'appr'), 'signature_path', 'signatures/ab_capital/sd-test.png')) is not null as s0 \gset

-- ── signing is optional ──────────────────────────────────────────────
select at_as(:'staff');
select hub_document_attach(:'aq', 'Accounting/' || :'aq' || '/a.docx', null);
select hub_document_attach(:'tl', 'Tax Compliance/' || :'tl' || '/a.docx', null);
select hub_document_attach(:'bq', 'Business Banking/' || :'bq' || '/a.docx', null);
select hub_document_attach(:'sq', 'Business Setup/' || :'sq' || '/a.docx', null);
select at_check('staff file the unsigned quotations and letters as before', (select count(*) = 4 from hub_documents where id in (:'aq', :'tl', :'bq', :'sq') and storage_path like '%/a.docx'));
select at_as(null);
select at_check('every desk department''s document is an AB Capital document', (select bool_and(doc_company('hub_documents', id) = 'ab_capital') from hub_documents where id in (:'aq', :'tl', :'bq', :'sq')));
select at_check('their signed files go under <department>/<id>/signed/',
  doc_sign_prefix('hub_documents', :'aq') = 'Accounting/' || :'aq' || '/signed/' and doc_sign_prefix('hub_documents', :'tl') = 'Tax Compliance/' || :'tl' || '/signed/'
  and doc_sign_prefix('hub_documents', :'bq') = 'Business Banking/' || :'bq' || '/signed/' and doc_sign_prefix('hub_documents', :'sq') = 'Business Setup/' || :'sq' || '/signed/');
select at_as(:'staff');
select at_check('staff who are not approvers cannot sign', not doc_sign_can('ab_capital')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting'))$f$, :'aq'), 'not an approver'));

-- ── an approver signs ────────────────────────────────────────────────
select at_as(:'appr');
select at_check('a caller naming another company still signs as the row''s company',
  (select company = 'ab_capital' from doc_sign_record(at_sign('hub_documents', :'aq', 'Accounting', '{"company": "ardentax"}'))));
select at_check('signed files under another department''s folder are refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting'))$f$, :'tl'), 'must be stored under'));
select at_check('the Tax Compliance letter and the Business Banking and Business Setup quotes sign, keeping their unsigned files',
  (select unsigned_word_path = 'Tax Compliance/' || :'tl' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'tl', 'Tax Compliance')))
  and (select unsigned_word_path = 'Business Banking/' || :'bq' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'bq', 'Business Banking')))
  and (select unsigned_word_path = 'Business Setup/' || :'sq' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'sq', 'Business Setup'))));
select at_check('signing changes nothing on the row', (select storage_path = 'Accounting/' || :'aq' || '/a.docx' from hub_documents where id = :'aq'));

-- ── what keeps the signature ─────────────────────────────────────────
select at_as(null);
insert into hub_documents (doc_type, department, client_name, parent_id, mail_subject, created_by) values ('mail', 'Accounting', 'TEST CLIENT - DO NOT USE', :'aq', 'Quote', :'staff');
select at_as(:'staff');
select hub_mail_update((select id from hub_documents where parent_id = :'aq' and doc_type = 'mail'), 'Quote', 'Changed body');
select at_check('a mail draft and its edit keep the quotation''s signature', (select id is not null from doc_sign_live('hub_documents', :'aq')));
select hub_document_attach(:'aq', null, 'C:/Generated/aq.docx');
select at_check('the office folder copy keeps it', (select id is not null from doc_sign_live('hub_documents', :'aq')));
select at_check('the screen''s second-line withdrawal by staff is refused while nothing changed (caught as a warning, never blocks the save)',
  at_refused(format($f$select doc_sign_supersede('hub_documents', %L, 'Generated again')$f$, :'aq'), 'has not changed since it was signed'));

-- ── a new file ends it ───────────────────────────────────────────────
select (select doc_changed_at('hub_documents', :'aq')) as seen_before \gset
select hub_document_attach(:'aq', 'Accounting/' || :'aq' || '/b.docx', null);
select at_check('Create file again ends the signature in the database',
  (select id is null from doc_sign_live('hub_documents', :'aq'))
  and (select superseded_reason = 'Document changed' from document_signatures where source_table = 'hub_documents' and source_id = :'aq'::uuid order by signed_at desc limit 1));
select at_check('the second-line withdrawal then finds nothing live and does not fail', doc_sign_supersede('hub_documents', :'aq', 'Generated again') = false);
select at_check('the other documents keep their own signatures',
  (select count(*) = 3 from document_signatures where source_table = 'hub_documents' and source_id in (:'tl', :'bq', :'sq') and superseded_at is null));
select at_as(:'appr');
select at_check('a signer holding the old stamp is refused', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting', jsonb_build_object('seen', %L)))$f$, :'aq', :'seen_before'), 'The document changed'));
select at_check('the new file can be signed again', (select unsigned_word_path = 'Accounting/' || :'aq' || '/b.docx' from doc_sign_record(at_sign('hub_documents', :'aq', 'Accounting'))));
select at_as(null);
