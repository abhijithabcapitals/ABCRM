-- LOCAL TEST ONLY. Business Formation Proposal on the shared signing (011): signing is optional, the signed files sit under
-- Business Setup/<id>/signed/, the client's choice, the office copy and the mail marks keep the signature, and new files end it.
-- No migration of its own: hub_proposal_attach writes storage_path and word_path, which the 011 content trigger watches.
-- People and documents are invented. Uses at_prop from 050_proposal_test.sql and at_sign from 060_signing_test.sql.
\set ON_ERROR_STOP on
\set admin '00000000-0000-0000-0000-0000000000e1'
\set appr  '00000000-0000-0000-0000-0000000000e2'
\set quoter '00000000-0000-0000-0000-0000000000b2'

select at_as(null);
insert into auth.users (id) values (:'admin'), (:'appr') on conflict do nothing;
insert into public.profiles (id, full_name, role) values (:'admin', 'PS Admin', 'admin'), (:'appr', 'PS Approver', 'member') on conflict (id) do nothing;

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ab_capital', 'approvers', jsonb_build_array(:'appr'), 'signature_path', 'signatures/ab_capital/ps-test.png')) is not null as s0 \gset

-- A two-option proposal with its files, made by a quoter who is not an approver.
select at_as(:'quoter');
select id as p from hub_proposal_create(at_prop()) \gset
select hub_proposal_attach(:'p', 'Business Setup/' || :'p' || '/p1.pdf', 'Business Setup/' || :'p' || '/p1.docx') is not null as a0 \gset

-- ── signing is optional ──────────────────────────────────────────────
select at_check('an unsigned proposal can be sent', hub_proposal_can_send());
select at_as(null);
select at_check('a proposal is an AB Capital document', doc_company('hub_documents', :'p') = 'ab_capital');
select at_check('its signed files go under Business Setup/<id>/signed/', doc_sign_prefix('hub_documents', :'p') = 'Business Setup/' || :'p' || '/signed/');
select at_as(:'quoter');
select at_check('a non-approver cannot sign it', at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup'))$f$, :'p'), 'not an approver'));

-- ── an approver signs ────────────────────────────────────────────────
select at_as(:'appr');
select at_check('signed files outside the proposal''s own signed/ folder are refused',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Accounting'))$f$, :'p'), 'must be stored under')
  and at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('pdf_path', 'Business Setup/' || %L || '/p1.pdf')))$f$, :'p', :'p'), 'must be stored under'));
select at_check('the AB Capital approver signs the proposal',
  (select source_id = :'p'::uuid and company = 'ab_capital' and pdf_path = 'Business Setup/' || :'p' || '/signed/s.pdf' from doc_sign_record(at_sign('hub_documents', :'p', 'Business Setup'))));
select at_check('signing changes nothing on the row: the unsigned files stay',
  (select storage_path = 'Business Setup/' || :'p' || '/p1.pdf' and word_path = 'Business Setup/' || :'p' || '/p1.docx' from hub_documents where id = :'p'));

-- ── what keeps the signature ─────────────────────────────────────────
select at_as(:'quoter');
select at_check('the quoter sees the live signature', (select id is not null from doc_sign_live('hub_documents', :'p')));
select hub_proposal_choose(jsonb_build_object('quote_id', :'p', 'option', 1)) is not null as c1 \gset
select at_check('recording the client''s choice keeps the signature (lines and totals mirror the option)',
  (select id is not null from doc_sign_live('hub_documents', :'p')) and (select total_amount = 900 from hub_documents where id = :'p'));
select hub_proposal_saved(:'p', 'Proposals/Test') is not null as c2 \gset
select at_check('saving to OneDrive keeps it', (select id is not null from doc_sign_live('hub_documents', :'p')));
select hub_proposal_attach(:'p', 'Business Setup/' || :'p' || '/p1.pdf', 'Business Setup/' || :'p' || '/p1.docx') is not null as c3 \gset
select at_check('attaching the same files again keeps it', (select id is not null from doc_sign_live('hub_documents', :'p')));
select at_as(null);
update hub_documents set mail_claimed_at = now() where id = :'p';
update hub_documents set mail_sent_at = now(), mail_sent_to = 'pat@sample.example', mail_claimed_at = null where id = :'p';
update hub_documents set status = 'accepted' where id = :'p';
select at_check('the send marks and acceptance keep it', (select id is not null from doc_sign_live('hub_documents', :'p')));
update hub_documents set status = 'issued' where id = :'p';

-- ── new files end the signature ──────────────────────────────────────
select at_as(:'quoter');
select hub_proposal_attach(:'p', 'Business Setup/' || :'p' || '/p2.pdf', 'Business Setup/' || :'p' || '/p2.docx') is not null as e1 \gset
select at_check('new files (Retry) end the live signature, also for a non-approver',
  (select id is null from doc_sign_live('hub_documents', :'p'))
  and (select count(*) = 1 from document_signatures where source_id = :'p'::uuid and superseded_at is not null and superseded_reason is not null));
select at_check('the rebuilt, unsigned proposal can still be sent', hub_proposal_can_send());
select at_as(:'appr');
select at_check('the old stamp no longer signs: the approver must open it again',
  at_refused(format($f$select doc_sign_record(at_sign('hub_documents', %L, 'Business Setup', jsonb_build_object('seen', (select document_changed_at from document_signatures where source_id = %L::uuid order by signed_at desc limit 1))))$f$, :'p', :'p'), 'The document changed'));
select at_check('with the new stamp it signs again', (select id is not null from doc_sign_record(at_sign('hub_documents', :'p', 'Business Setup'))));
select at_check('one live signature, the old one kept as history',
  (select count(*) filter (where superseded_at is null) = 1 and count(*) = 2 from document_signatures where source_id = :'p'::uuid));

-- ── the edge function's reads ────────────────────────────────────────
-- proposal-mail-send reads the live signature with the service role after hub_proposal_can_send; the caller can read it too.
select at_as(:'quoter');
select at_check('a quoter who may send reads the live signature''s PDF path, under the proposal''s signed/ folder',
  (select pdf_path like 'Business Setup/' || :'p' || '/signed/%.pdf' from document_signatures where source_table = 'hub_documents' and source_id = :'p'::uuid and superseded_at is null));
select at_as(null);
