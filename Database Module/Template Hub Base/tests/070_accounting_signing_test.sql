-- LOCAL TEST ONLY. Accounting on the shared signing (012): signing is optional, edits and new files end the signature,
-- hub_acct_approve is no longer callable, and Accounting's image is covered by the 011 policies only. People and documents are invented.
\set ON_ERROR_STOP on
\set admin '00000000-0000-0000-0000-0000000000f1'
\set appr  '00000000-0000-0000-0000-0000000000f2'
\set plain '00000000-0000-0000-0000-0000000000f3'

select at_as(null);
insert into auth.users (id) values (:'admin'), (:'appr'), (:'plain') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  (:'admin', 'AS Admin', 'admin'), (:'appr', 'AS Approver', 'member'), (:'plain', 'AS Plain', 'member') on conflict (id) do nothing;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'appr'), 'signature_path', 'signatures/ab_capital/as-test.png')) is not null as s1 \gset

-- A quote and its agreement, made by a staff member who is not an approver.
select at_as(:'plain');
select id as q from hub_acct_quote_create(at_acq()) \gset
select hub_acct_attach(:'q', 'Accounting/' || :'q' || '/q.pdf', 'Accounting/' || :'q' || '/q.docx') is not null as a0 \gset
select hub_acct_accept(:'q', 0) is not null as a1 \gset
select id as ag from hub_acct_agreement_create(jsonb_build_object('quote_id', :'q', 'agreement', at_aga())) \gset
select hub_acct_attach(:'ag', 'Accounting/' || :'ag' || '/a.pdf', 'Accounting/' || :'ag' || '/a.docx') is not null as a2 \gset

-- ── signing is optional ──────────────────────────────────────────────
select at_check('an unsigned quote with a PDF can be sent', hub_acct_can_send(:'q'));
select at_check('an unsigned agreement with a PDF can be sent', hub_acct_can_send(:'ag'));
select at_check('a document with no PDF, an unknown id and a non-Accounting row cannot be sent',
  not hub_acct_can_send(gen_random_uuid())
  and not hub_acct_can_send((select id from hub_documents where library_template is distinct from 'AB Capital/Accounting Quote'
                               and library_template is distinct from 'AB Capital/Accounting Agreement' and storage_path is not null limit 1)));
select at_check('hub_acct_approve is kept but no signed-in user may call it',
  at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', now())$f$, :'ag'), 'permission denied'));
select at_as(:'appr');
select at_check('not even an approver', at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', now())$f$, :'ag'), 'permission denied'));

-- ── Sign on quotes and agreements ────────────────────────────────────
select at_check('the AB Capital approver signs the quote', (select source_id = :'q'::uuid and company = 'ab_capital' from doc_sign_record(at_sign('hub_documents', :'q', 'Accounting'))));
select at_check('and the agreement', (select source_id = :'ag'::uuid from doc_sign_record(at_sign('hub_documents', :'ag', 'Accounting'))));
select at_check('signing changes nothing on the document row: no approval, the unsigned files stay',
  (select approved_at is null and approved_by is null and storage_path = 'Accounting/' || :'ag' || '/a.pdf' from hub_documents where id = :'ag'));
select at_as(:'plain');
select at_check('a non-approver cannot sign', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting'))$f$, :'ag'), 'not an approver'));
select id as q2 from hub_acct_quote_create(at_acq()) \gset
select hub_acct_attach(:'q2', 'Accounting/' || :'q2' || '/q.pdf', 'Accounting/' || :'q2' || '/q.docx') is not null as a3 \gset
select at_as(:'appr');
select doc_sign_record(at_sign('hub_documents', :'q2', 'Accounting')) is not null as s2 \gset
select at_as(:'plain');
select hub_acct_accept(:'q2', 0) is not null as a3b \gset
select at_check('accepting an option does not end the quote''s signature', (select id is not null from doc_sign_live('hub_documents', :'q2')));
select hub_acct_saved(:'ag', 'Proposals/Test') is not null as a4 \gset
select at_check('saving to OneDrive does not end the agreement''s signature', (select id is not null from doc_sign_live('hub_documents', :'ag')));

-- ── new files end the signature ──────────────────────────────────────
select hub_acct_attach(:'q', 'Accounting/' || :'q' || '/q2.pdf', 'Accounting/' || :'q' || '/q2.docx') is not null as a5 \gset
select at_check('new files through hub_acct_attach end the live signature, also for a non-approver',
  (select id is null from doc_sign_live('hub_documents', :'q'))
  and (select count(*) = 1 from document_signatures where source_id = :'q'::uuid and superseded_at is not null and superseded_reason is not null));
select hub_acct_attach(:'ag', 'Accounting/' || :'ag' || '/a.pdf', 'Accounting/' || :'ag' || '/a.docx') is not null as a6 \gset
select at_check('attaching the same files again keeps the signature', (select id is not null from doc_sign_live('hub_documents', :'ag')));

-- ── an edit ends the signature ───────────────────────────────────────
select at_check('a non-approver edits a signed agreement: no approval is written, the files are cleared',
  (select approved_at is null and approved_by is null and storage_path is null and word_path is null
     from hub_acct_agreement_update(:'ag', at_aga('{"signatory_name": "Pat Edited"}'))));
select at_check('and the signature ends', (select id is null from doc_sign_live('hub_documents', :'ag'))
  and (select superseded_at is not null from document_signatures where source_id = :'ag'::uuid order by signed_at desc limit 1));
select at_check('the edited agreement has no PDF, so it cannot be sent until it is rebuilt', not hub_acct_can_send(:'ag'));
select hub_acct_attach(:'ag', 'Accounting/' || :'ag' || '/b.pdf', 'Accounting/' || :'ag' || '/b.docx') is not null as a7 \gset
select at_check('the rebuilt, unsigned agreement can be sent', hub_acct_can_send(:'ag'));
select at_check('the file flag does not outlast the statement', coalesce(current_setting('hub_acct.files', true), '') <> 'on');
select at_as(:'appr');
select at_check('the old stamp no longer signs: the approver must open it again',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting', jsonb_build_object('seen', (select document_changed_at from document_signatures where source_id = %L::uuid order by signed_at desc limit 1))))$f$, :'ag', :'ag'), 'The document changed'));
select at_check('with the new stamp it signs again', (select id is not null from doc_sign_record(at_sign('hub_documents', :'ag', 'Accounting'))));

-- ── the client's signed copy needs no approval ───────────────────────
select at_as(:'plain');
select at_check('an unsigned or company-signed agreement records the client''s signed copy',
  (select signed_at = date '2026-11-06' from hub_acct_signed(:'ag', date '2026-11-06', 'Accounting/' || :'ag' || '/client.pdf')));
select at_check('recording it does not end the company signature', (select id is not null from doc_sign_live('hub_documents', :'ag')));
select at_check('the client''s copy is refused outside the document''s own Accounting/<id>/ folder',
  at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'q' || '/client.pdf'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '/signed/client.pdf'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '/../' || :'q' || '/x.pdf'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '//client.pdf'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '/..'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '/'), 'must be stored under')
  and at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/signed/client.pdf'), 'must be stored under')
  and (select signed_path = 'Accounting/' || :'ag' || '/client.pdf' from hub_documents where id = :'ag'));
select at_check('a client copy at the screen''s path (Accounting/<id>/<uuid>.pdf) is accepted',
  (select signed_path = 'Accounting/' || :'q' || '/' || x || '.pdf' from (select gen_random_uuid()::text x) u,
     lateral hub_acct_signed(:'q', date '2026-11-06', 'Accounting/' || :'q' || '/' || x || '.pdf')));
select set_config('request.jwt.claim.sub', '', false);
select at_check('a caller with no session cannot record a client copy',
  at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, :'ag', 'Accounting/' || :'ag' || '/x.pdf'), 'Sign in first'));
select at_as(:'plain');
select at_check('nor on a document that is not an Accounting quote or agreement',
  at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', %L)$f$, gen_random_uuid(), 'Accounting/x/y.pdf'), 'not found'));

-- ── Accounting's image: the 011 policies only ────────────────────────
select at_as(null);
insert into storage.buckets (id, name) values ('hub-documents', 'hub-documents') on conflict do nothing;
delete from storage.objects where name = 'accounting-signature/as-test.png';
insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/as-test.png');
select at_check('the 008 accounting-signature policies are gone', (select count(*) = 0 from pg_policies where policyname like 'hub\_docs\_accounting\_signature%'));
select at_check('the 011 image policies still cover accounting-signature/',
  (select count(*) = 4 from pg_policies where policyname in ('doc_sign_image_read', 'doc_sign_image_insert', 'doc_sign_image_update', 'doc_sign_image_delete')
     and coalesce(qual, with_check) like '%accounting-signature/%'));
select at_as(:'admin');
select at_check('an administrator who is not an approver reads Accounting''s image', (select count(*) = 1 from storage.objects where name = 'accounting-signature/as-test.png'));
select at_as(:'appr');
select at_check('the AB Capital approver reads it', (select count(*) = 1 from storage.objects where name = 'accounting-signature/as-test.png'));
select at_check('and still cannot add one', at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/forged2.png')$f$, 'row-level security'));
select at_as(:'plain');
select at_check('a non-approver does not read it', (select count(*) = 0 from storage.objects where name like 'accounting-signature/%'));
with d as (delete from storage.objects where name = 'accounting-signature/as-test.png' returning name) select count(*) as del_plain from d \gset
select at_as(:'admin');
with d as (delete from storage.objects where name = 'accounting-signature/as-test.png' returning name) select count(*) as del_admin from d \gset
select at_as(null);
select at_check('a non-approver cannot delete it; an administrator who is not an approver can', :'del_plain' = '0' and :'del_admin' = '1');
