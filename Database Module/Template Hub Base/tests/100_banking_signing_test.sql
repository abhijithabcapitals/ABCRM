-- LOCAL TEST ONLY. Business Banking on the shared signing (011), as Banking Module/services/bankingSigning.js uses it: signing is optional,
-- the signed files sit in banking-documents under <case id>/generated/<id>/signed/ (beside the generated files, under the same storage
-- policies), and a regenerated file (a new banking_generated_documents row) lets any reader end the live signature ("Generated again").
-- No migration of its own. People, clients and numbers are invented. Uses at_sign from 060_signing_test.sql.
\set ON_ERROR_STOP on
\set appr   '00000000-0000-0000-0000-0000000000f1'
\set staff  '00000000-0000-0000-0000-0000000000f2'
\set viewer '00000000-0000-0000-0000-0000000000f3'
\set admin  '00000000-0000-0000-0000-0000000000f4'
\set cl  '00000000-0000-0000-0000-00000000f001'
\set cs  '00000000-0000-0000-0000-00000000f002'
\set q   '00000000-0000-0000-0000-00000000f003'
\set l   '00000000-0000-0000-0000-00000000f004'
\set p   '00000000-0000-0000-0000-00000000f005'
\set r   '00000000-0000-0000-0000-00000000f006'

select at_as(null);
insert into auth.users (id) values (:'appr'), (:'staff'), (:'viewer'), (:'admin') on conflict do nothing;
insert into public.profiles (id, full_name, role) values (:'appr', 'BS Approver', 'member'), (:'staff', 'BS Staff', 'member'),
  (:'viewer', 'BS Viewer', 'member'), (:'admin', 'BS Admin', 'admin') on conflict (id) do nothing;
-- The approver and the staff member may view and file quotes, letters and vouchers; the viewer may only view them.
insert into public.banking_user_permissions (user_id, permission, allowed)
select u, x, true from unnest(array[:'appr', :'staff']::uuid[]) u, unnest(array['quotes.view', 'quotes.manage', 'agreements.view', 'agreements.manage', 'payments.view', 'payments.manage']) x
on conflict do nothing;
insert into public.banking_user_permissions (user_id, permission, allowed)
select :'viewer'::uuid, x, true from unnest(array['quotes.view', 'agreements.view', 'payments.view']) x on conflict do nothing;
insert into storage.buckets (id, name) values ('banking-documents', 'banking-documents') on conflict do nothing;

insert into banking_clients (id, display_name) values (:'cl', 'Signing Sample Co');
insert into banking_cases (id, client_id) values (:'cs', :'cl');
insert into banking_quotations (id, case_id) values (:'q', :'cs');
insert into banking_engagement_letters (id, case_id, quotation_id) values (:'l', :'cs', :'q');
insert into banking_payments (id, case_id, payment_date, amount) values (:'p', :'cs', current_date, 10);
insert into banking_receipts (id, payment_id) values (:'r', :'p');
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'cs', 'quote', :'q', 'BS-BQ-1', 'q.docx', :'cs' || '/generated/aaaa-q.docx');
insert into banking_generated_documents (case_id, kind, payment_id, document_number, file_name, storage_path)
  values (:'cs', 'receipt', :'p', 'BS-RC-1', 'r.docx', :'cs' || '/generated/aaaa-r.docx');

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'appr'), 'signature_path', 'signatures/ab_capital/bs-test.png')) is not null as s0 \gset

-- ── signing is optional, and only for approvers ──────────────────────
select at_as(:'staff');
select at_check('staff who are not approvers may not sign', not doc_sign_can('ab_capital')
  and at_refused(format($f$select doc_sign_record(at_sign('banking_quotations', %L, '%s/generated'))$f$, :'q', :'cs'), 'not an approver'));
select at_check('they still file an unsigned quotation as before',
  (select count(*) = 1 from (select 1 from banking_generated_documents where quotation_id = :'q'::uuid) x));

-- ── where the signed files go ────────────────────────────────────────
select at_as(null);
select at_check('the signed prefixes are beside the generated files, a receipt in its payment''s case',
  doc_sign_prefix('banking_quotations', :'q') = :'cs' || '/generated/' || :'q' || '/signed/'
  and doc_sign_prefix('banking_engagement_letters', :'l') = :'cs' || '/generated/' || :'l' || '/signed/'
  and doc_sign_prefix('banking_receipts', :'r') = :'cs' || '/generated/' || :'r' || '/signed/');
select at_as(:'appr');
insert into storage.objects (bucket_id, name) values ('banking-documents', :'cs' || '/generated/' || :'q' || '/signed/s.pdf');
select at_check('an approver who files quotes can store the signed copy in banking-documents',
  (select count(*) = 1 from storage.objects where name = :'cs' || '/generated/' || :'q' || '/signed/s.pdf'));
select at_as(:'viewer');
select at_check('a viewer who cannot file is refused by the bucket''s insert policy',
  at_refused(format($f$insert into storage.objects (bucket_id, name) values ('banking-documents', '%s/generated/%s/signed/x.pdf')$f$, :'cs', :'q'), 'row-level security'));
select at_check('a viewer reads the signed copy by the bucket''s read policy',
  (select count(*) = 1 from storage.objects where bucket_id = 'banking-documents' and name = :'cs' || '/generated/' || :'q' || '/signed/s.pdf'));

-- ── an approver signs each kind ──────────────────────────────────────
select at_as(:'appr');
select at_check('the quotation is signed, keeping its latest generated Word file as the unsigned copy',
  (select company = 'ab_capital' and unsigned_word_path = :'cs' || '/generated/aaaa-q.docx' and pdf_path = :'cs' || '/generated/' || :'q' || '/signed/s.pdf'
     from doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated'))));
select at_check('the letter is signed (no generated file yet)', (doc_sign_record(at_sign('banking_engagement_letters', :'l', :'cs' || '/generated'))).unsigned_word_path is null);
select at_check('the receipt is signed against its banking_receipts row',
  (select source_id = :'r'::uuid and unsigned_word_path = :'cs' || '/generated/aaaa-r.docx' from doc_sign_record(at_sign('banking_receipts', :'r', :'cs' || '/generated'))));
select at_check('signing adds no generated document', (select count(*) = 2 from banking_generated_documents where case_id = :'cs'::uuid));

select at_as(:'viewer');
select at_check('a viewer sees the three live signatures', (select count(*) = 3 from document_signatures where source_id in (:'q', :'l', :'r') and superseded_at is null));
select at_check('a viewer cannot end a signature while nothing changed',
  at_refused(format($f$select doc_sign_supersede('banking_quotations', %L, 'Generated again')$f$, :'q'), 'has not changed'));

-- ── a regenerate ends the signature ──────────────────────────────────
-- Save to folder / Issue / a new voucher add a generated file, which moves the stamp; the screen then calls doc_sign_supersede.
select at_as(:'staff');
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'cs', 'quote', :'q', 'BS-BQ-1', 'q.docx', :'cs' || '/generated/bbbb-q.docx');
insert into banking_generated_documents (case_id, kind, letter_id, document_number, file_name, storage_path)
  values (:'cs', 'letter', :'l', 'BS-EL-1', 'l.docx', :'cs' || '/generated/bbbb-l.docx');
insert into banking_generated_documents (case_id, kind, payment_id, document_number, file_name, storage_path)
  values (:'cs', 'receipt', :'p', 'BS-RC-1', 'r.docx', :'cs' || '/generated/bbbb-r.docx');
select at_check('after a new file, staff who are not approvers end each signature (Generated again)',
  doc_sign_supersede('banking_quotations', :'q', 'Generated again') and doc_sign_supersede('banking_engagement_letters', :'l', 'Generated again')
  and doc_sign_supersede('banking_receipts', :'r', 'Generated again'));
select at_check('no live signature is left; the ended ones stay as history',
  (select count(*) filter (where superseded_at is null) = 0 and count(*) filter (where superseded_reason = 'Generated again') = 3
     from document_signatures where source_id in (:'q', :'l', :'r')));
select at_check('a second call finds nothing to end', not doc_sign_supersede('banking_quotations', :'q', 'Generated again'));

select at_as(:'appr');
select at_check('the approver signs the new version with the new stamp, and its unsigned copy is the new file',
  (select unsigned_word_path = :'cs' || '/generated/bbbb-q.docx' from doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated'))));
select at_as(null);
