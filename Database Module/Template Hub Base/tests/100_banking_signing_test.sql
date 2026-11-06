-- LOCAL TEST ONLY. Business Banking on the shared signing (011), as Banking Module/services/bankingSigning.js uses it: signing is optional,
-- the signed files sit in banking-documents under <case id>/generated/<id>/signed/ (beside the generated files, under the same storage
-- policies), and a regenerated file (a new banking_generated_documents row) lets any reader end the live signature ("Generated again").
-- 013 ends the signature in the database on a new generated file or a line item change. People, clients and numbers are invented. Uses at_sign from 060_signing_test.sql.
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

-- ── a regenerate ends the signature (013, in the database) ─────────
-- Save to folder / Issue / a new voucher add a generated file. 013's trigger ends the live signature on that insert; the screen's
-- doc_sign_supersede call after it is a second line and then finds nothing to end.
select at_as(:'staff');
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'cs', 'quote', :'q', 'BS-BQ-1', 'q.docx', :'cs' || '/generated/bbbb-q.docx');
select at_check('filing a new file for a signed quotation ends its signature, for staff who are not approvers',
  doc_sign_live('banking_quotations', :'q') is null
  and (select superseded_reason = 'Generated again' from document_signatures where source_id = :'q'::uuid order by signed_at desc limit 1));
select at_check('the letter and receipt are untouched by the quotation''s file',
  (doc_sign_live('banking_engagement_letters', :'l')).id is not null and (doc_sign_live('banking_receipts', :'r')).id is not null);
insert into banking_generated_documents (case_id, kind, letter_id, document_number, file_name, storage_path)
  values (:'cs', 'letter', :'l', 'BS-EL-1', 'l.docx', :'cs' || '/generated/bbbb-l.docx');
select at_check('filing a new file for a signed letter ends its signature', doc_sign_live('banking_engagement_letters', :'l') is null);
insert into banking_generated_documents (case_id, kind, payment_id, document_number, file_name, storage_path)
  values (:'cs', 'receipt', :'p', 'BS-RC-1', 'r.docx', :'cs' || '/generated/bbbb-r.docx');
select at_check('filing a new voucher file for a signed receipt ends its signature', doc_sign_live('banking_receipts', :'r') is null);
select at_check('the ended ones stay as history, all Generated again',
  (select count(*) filter (where superseded_at is null) = 0 and count(*) filter (where superseded_reason = 'Generated again') = 3
     from document_signatures where source_id in (:'q', :'l', :'r')));
select at_check('the screen''s second-line call then finds nothing to end', not doc_sign_supersede('banking_quotations', :'q', 'Generated again'));

select at_as(:'appr');
select at_check('the approver signs the new version with the new stamp, and its unsigned copy is the new file',
  (select unsigned_word_path = :'cs' || '/generated/bbbb-q.docx' from doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated'))));

-- ── a line item change ends the signature ────────────────────────────
select at_as(null);
select content_changed_at as before_items from banking_quotations where id = :'q' \gset
insert into banking_quotation_items (quotation_id, item_type, description, unit_amount) values (:'q', 'Service Fee', 'Sample fee', 100);
select at_check('adding a line item to a signed quotation ends its signature and moves its stamp',
  doc_sign_live('banking_quotations', :'q') is null
  and (select superseded_reason = 'Document changed' from document_signatures where source_id = :'q'::uuid order by signed_at desc limit 1)
  and (select content_changed_at > :'before_items'::timestamptz from banking_quotations where id = :'q'));
select at_as(:'appr');
select at_check('a signer holding the stamp from before the line change is refused',
  at_refused(format($f$select doc_sign_record(at_sign('banking_quotations', %L, '%s/generated', jsonb_build_object('seen', %L::timestamptz)))$f$, :'q', :'cs', :'before_items'), 'The document changed'));
select doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated')) is not null as s9 \gset
select at_as(null);
update banking_quotation_items set unit_amount = 150 where quotation_id = :'q';
select at_check('changing a line item amount ends it', doc_sign_live('banking_quotations', :'q') is null);
select at_as(:'appr');
select doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated')) is not null as s10 \gset
select at_as(null);
update banking_quotation_items set unit_amount = 150 where quotation_id = :'q';
select at_check('an update to the same values keeps it', (doc_sign_live('banking_quotations', :'q')).id is not null);
delete from banking_quotation_items where quotation_id = :'q';
select at_check('removing a line item ends it', doc_sign_live('banking_quotations', :'q') is null);

-- ── unsigned documents, and a failing rule ───────────────────────────
\set q2 '00000000-0000-0000-0000-00000000f007'
insert into banking_quotations (id, case_id) values (:'q2', :'cs');
select count(*) as sigs_before, count(*) filter (where superseded_at is null) as live_before from document_signatures \gset
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'cs', 'quote', :'q2', 'BS-BQ-2', 'q2.docx', :'cs' || '/generated/cccc-q2.docx');
insert into banking_quotation_items (quotation_id, item_type, description, unit_amount) values (:'q2', 'Service Fee', 'Sample fee', 100);
select at_check('filing or editing an unsigned document changes no signature and is filed as before',
  (select count(*) = :'sigs_before'::int and count(*) filter (where superseded_at is null) = :'live_before'::int from document_signatures)
  and (select count(*) = 1 from banking_generated_documents where quotation_id = :'q2'::uuid));

-- The withdraw step is made to fail: filing and line edits still go through (the rule only warns).
select at_as(:'appr');
select doc_sign_record(at_sign('banking_quotations', :'q', :'cs' || '/generated')) is not null as s11 \gset
select at_as(null);
create temp table at_withdraw_def as select pg_get_functiondef('public.doc_sign_withdraw(text, uuid, text)'::regprocedure) as def;
create or replace function public.doc_sign_withdraw(p_table text, p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$ begin raise exception 'forced test failure'; end $$;
set client_min_messages = error;
insert into banking_generated_documents (case_id, kind, quotation_id, document_number, file_name, storage_path)
  values (:'cs', 'quote', :'q', 'BS-BQ-1', 'q.docx', :'cs' || '/generated/dddd-q.docx');
insert into banking_quotation_items (quotation_id, item_type, description, unit_amount) values (:'q', 'Service Fee', 'Sample fee', 100);
set client_min_messages = notice;
do $$ begin execute (select def from at_withdraw_def); end $$;
select at_check('a failure inside the rule never blocks filing or a line edit',
  (select count(*) = 1 from banking_generated_documents where storage_path = :'cs' || '/generated/dddd-q.docx')
  and (select count(*) = 1 from banking_quotation_items where quotation_id = :'q'::uuid));
select at_check('the withdraw step is restored after the test', (select prosrc not like '%forced test failure%' from pg_proc where proname = 'doc_sign_withdraw'));
select at_as(null);
