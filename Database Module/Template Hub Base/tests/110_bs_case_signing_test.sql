-- LOCAL TEST ONLY. Business Setup case quotes and letters (hub_documents with case_id) on the shared signing (011), as
-- Business Setup Module/logic/caseSigning.js uses it: signing is optional, the signed files sit under Business Setup/<id>/signed/, the
-- client's decisions, status changes and the client-signed letter keep the signature, and a new file (hub_document_attach, Create
-- file) ends it in the database. No migration of its own: the 011 content trigger watches storage_path. The screen's
-- doc_sign_supersede after Create file is the second line and never refuses a save. People and documents are invented.
-- Uses at_sign from 060_signing_test.sql.
\set ON_ERROR_STOP on
\set appr  '00000000-0000-0000-0000-0000000000a5'
\set staff '00000000-0000-0000-0000-0000000000a6'
\set admin '00000000-0000-0000-0000-0000000000a7'
\set cs    '00000000-0000-0000-0000-00000000a701'
\set q     '00000000-0000-0000-0000-00000000a702'
\set l     '00000000-0000-0000-0000-00000000a703'
\set q2    '00000000-0000-0000-0000-00000000a704'

select at_as(null);
insert into auth.users (id) values (:'appr'), (:'staff'), (:'admin') on conflict do nothing;
insert into public.profiles (id, full_name, role) values (:'appr', 'CS Approver', 'member'), (:'staff', 'CS Staff', 'member'), (:'admin', 'CS Admin', 'admin')
  on conflict (id) do nothing;
insert into business_setup_cases (id, lead_name) values (:'cs', 'TEST CLIENT - DO NOT USE');
insert into hub_documents (id, doc_type, department, document_number, client_name, case_id, lines, total_amount, created_by)
  values (:'q', 'quote', 'Business Setup', 'TEST/BSQ/1', 'TEST CLIENT - DO NOT USE', :'cs', '[{"description": "Formation", "amount": 1000}]', 1000, :'staff');
insert into hub_documents (id, doc_type, department, document_number, client_name, case_id, parent_id, created_by)
  values (:'l', 'letter', 'Business Setup', 'TEST/BSE/1', 'TEST CLIENT - DO NOT USE', :'cs', :'q', :'staff');

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'appr'), 'signature_path', 'signatures/ab_capital/cs-test.png')) is not null as s0 \gset

-- ── signing is optional ──────────────────────────────────────────────
select at_as(:'staff');
select hub_document_attach(:'q', 'Business Setup/' || :'q' || '/a.docx', null);
select hub_document_attach(:'l', 'Business Setup/' || :'l' || '/a.docx', null);
select at_check('staff create the unsigned files as before', (select count(*) = 2 from hub_documents where id in (:'q', :'l') and storage_path like 'Business Setup/%/a.docx'));
select at_as(null);
select at_check('a case quote and letter are AB Capital documents', doc_company('hub_documents', :'q') = 'ab_capital' and doc_company('hub_documents', :'l') = 'ab_capital');
select at_check('their signed files go under Business Setup/<id>/signed/',
  doc_sign_prefix('hub_documents', :'q') = 'Business Setup/' || :'q' || '/signed/' and doc_sign_prefix('hub_documents', :'l') = 'Business Setup/' || :'l' || '/signed/');
select at_as(:'staff');
select at_check('staff who are not approvers cannot sign', not doc_sign_can('ab_capital')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'q'), 'not an approver'));

-- ── an approver signs ────────────────────────────────────────────────
select at_as(:'appr');
select at_check('signed files outside the document''s own signed/ folder are refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/' || %L || '/signed/x.pdf')))$f$, :'q', :'l'), 'must be stored under')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('word_path', 'Business Setup/' || %L || '/signed/a/b.docx')))$f$, :'q', :'q'), 'must be stored under'));
select at_check('the AB Capital approver signs the quote, keeping its unsigned file',
  (select company = 'ab_capital' and unsigned_word_path = 'Business Setup/' || :'q' || '/a.docx' from doc_sign_record(at_sign('hub_documents', :'q', 'Business Setup'))));
select at_check('and the letter', (select source_id = :'l'::uuid from doc_sign_record(at_sign('hub_documents', :'l', 'Business Setup'))));
select at_check('signing changes nothing on the row', (select storage_path = 'Business Setup/' || :'q' || '/a.docx' from hub_documents where id = :'q'));

-- ── what keeps the signature ─────────────────────────────────────────
select at_as(null);
update hub_documents set status = 'accepted', status_at = now(), status_by = :'staff', status_reason = 'Accepted after expiry' where id = :'q';
select at_check('the client''s acceptance keeps the quote''s signature', (select id is not null from doc_sign_live('hub_documents', :'q')));
update hub_documents set signed_at = current_date, signed_path = 'staff/CL000001/signed.pdf' where id = :'l';
select at_check('recording the client-signed letter keeps AB Capital''s signature', (select id is not null from doc_sign_live('hub_documents', :'l')));
update hub_documents set local_path = 'C:/Generated/q.docx' where id = :'q';
select at_check('the office folder copy keeps it', (select id is not null from doc_sign_live('hub_documents', :'q')));
insert into hub_documents (doc_type, department, client_name, parent_id, mail_subject, created_by) values ('mail', 'Business Setup', 'TEST CLIENT - DO NOT USE', :'q', 'Quote', :'staff');
select at_check('a mail draft under the quote keeps it', (select id is not null from doc_sign_live('hub_documents', :'q')));
select at_as(:'staff');
select hub_document_attach(:'q', 'Business Setup/' || :'q' || '/a.docx', null);
select at_check('attaching the same file again keeps it', (select id is not null from doc_sign_live('hub_documents', :'q')));
select at_check('the screen''s second-line withdrawal by staff is refused while nothing changed (caught as a warning, never blocks the save)',
  at_refused(format($f$select doc_sign_supersede('hub_documents', %L, 'Generated again')$f$, :'q'), 'has not changed since it was signed'));

-- ── a new file ends it ───────────────────────────────────────────────
select (select doc_changed_at('hub_documents', :'q')) as seen_before \gset
select hub_document_attach(:'q', 'Business Setup/' || :'q' || '/b.docx', null);
select at_check('Create file again ends the quote''s signature in the database',
  (select id is null from doc_sign_live('hub_documents', :'q'))
  and (select superseded_reason = 'Document changed' from document_signatures where source_table = 'hub_documents' and source_id = :'q'::uuid order by signed_at desc limit 1));
select at_check('and moves its change stamp', (select content_changed_at is not null from hub_documents where id = :'q') and doc_changed_at('hub_documents', :'q') > :'seen_before'::timestamptz);
select at_check('the second-line withdrawal then finds nothing live and does not fail', doc_sign_supersede('hub_documents', :'q', 'Generated again') = false);
select at_check('the letter''s signature is its own and stays', (select id is not null from doc_sign_live('hub_documents', :'l')));
select at_as(:'appr');
select at_check('a signer holding the old stamp is refused', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('seen', %L)))$f$, :'q', :'seen_before'), 'The document changed'));
select at_check('the new file can be signed again', (select unsigned_word_path = 'Business Setup/' || :'q' || '/b.docx' from doc_sign_record(at_sign('hub_documents', :'q', 'Business Setup'))));

-- ── a revision ───────────────────────────────────────────────────────
-- A revision is a new row; the revised quote only changes status, so its signed copy stays (the ruling for Banking and Ardentax).
select at_as(null);
insert into hub_documents (id, doc_type, department, document_number, client_name, case_id, revises_id, created_by)
  values (:'q2', 'quote', 'Business Setup', 'TEST/BSQ/2', 'TEST CLIENT - DO NOT USE', :'cs', :'q', :'staff');
update hub_documents set status = 'superseded', status_at = now(), status_reason = 'Revised by TEST/BSQ/2' where id = :'q';
select at_check('a revised quote keeps the signature of that unchanged version; the revision starts unsigned',
  (select id is not null from doc_sign_live('hub_documents', :'q')) and (select id is null from doc_sign_live('hub_documents', :'q2')));
select at_as(:'staff');
select hub_document_attach(:'q2', 'Business Setup/' || :'q2' || '/a.docx', null);
select at_check('the revision''s first file is saved unsigned, and the screen''s withdrawal finds nothing', doc_sign_supersede('hub_documents', :'q2', 'Generated again') = false
  and (select storage_path is not null from hub_documents where id = :'q2'));
select at_as(null);
