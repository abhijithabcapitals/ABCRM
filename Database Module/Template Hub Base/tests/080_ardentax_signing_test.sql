-- LOCAL TEST ONLY. Ardentax documents on the shared signing (011), as the ArdentTax tab uses it: an Ardentax approver signs, filing new
-- files (ardentax_document_attach, the tab's Generate again) ends the signature and the tab's explicit doc_sign_supersede then finds none,
-- a revision row starts unsigned while the earlier version keeps its own, and nothing here is needed for an unsigned document.
-- Uses at_sign from 060. People and documents are invented.
\set ON_ERROR_STOP on
\set admin  '00000000-0000-0000-0000-0000000000a1'
\set atappr '00000000-0000-0000-0000-0000000000a2'
\set member '00000000-0000-0000-0000-0000000000a3'
\set outsider '00000000-0000-0000-0000-0000000000a4'
\set d1 '00000000-0000-0000-0000-00000000a101'
\set d2 '00000000-0000-0000-0000-00000000a102'

select at_as(null);
insert into auth.users (id) values (:'admin'), (:'atappr'), (:'member'), (:'outsider') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  (:'admin', 'AX Admin', 'admin'), (:'atappr', 'AX Approver', 'member'), (:'member', 'AX Member', 'member'), (:'outsider', 'AX Outsider', 'member')
  on conflict (id) do nothing;
insert into public.member_tab_access (profile_id, tab_key) values (:'atappr', 'ardentax'), (:'member', 'ardentax') on conflict do nothing;
insert into ardentax_documents (id, request_id, doc_type, document_number, quote_type, client_name, details, word_path, pdf_path)
  values (:'d1', gen_random_uuid(), 'quote', 'AX-T-1', 'Standard', 'Sign Test LLC', '{}'::jsonb,
          'ArdentTax (ASP)/' || :'d1' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1/u.docx', 'ArdentTax (ASP)/' || :'d1' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1/u.pdf');

select at_as(:'admin');
select doc_sign_admin_save(jsonb_build_object('company', 'ardentax', 'approvers', jsonb_build_array(:'atappr'), 'signature_path', 'signatures/ardentax/ax-test.png')) is not null as s0 \gset

-- ── who sees the Sign control ────────────────────────────────────────
select at_as(:'atappr');
select at_check('the listed person is an Ardentax approver', doc_sign_can('ardentax'));
select at_as(:'member');
select at_check('a tab member who is not listed is not', not doc_sign_can('ardentax'));
select at_check('and still reads the change stamp the tab signs with', doc_changed_at('ardentax_documents', :'d1') is not null);
select at_as(:'outsider');
select at_check('someone without the tab gets no stamp', doc_changed_at('ardentax_documents', :'d1') is null);

-- ── signing ──────────────────────────────────────────────────────────
select at_as(:'member');
select at_check('a tab member cannot sign', at_refused(format($f$select doc_sign_record(at_sign('ardentax_documents', %L, 'ArdentTax (ASP)'))$f$, :'d1'), 'not an approver'));
select at_as(:'atappr');
select at_check('the approver signs, for Ardentax, under ArdentTax (ASP)/<id>/signed/',
  (select company = 'ardentax' and pdf_path = 'ArdentTax (ASP)/' || :'d1' || '/signed/s.pdf' from doc_sign_record(at_sign('ardentax_documents', :'d1', 'ArdentTax (ASP)'))));
select at_check('the row keeps its unsigned files', (select pdf_path like '%/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee1/u.pdf' from ardentax_documents where id = :'d1'));
select at_as(:'member');
select at_check('the tab member sees the live signature', (doc_sign_live('ardentax_documents', :'d1')).id is not null);
select at_check('a mail draft edit keeps it', (select count(*) = 1 from (select ardentax_mail_update(:'d1', 'pat@sample.example', '', 'S', 'B', true)) x) and (doc_sign_live('ardentax_documents', :'d1')).id is not null);
select at_check('a tab member cannot end it while the document is unchanged',
  at_refused(format($f$select doc_sign_supersede('ardentax_documents', %L, 'Generated again')$f$, :'d1'), 'not an approver'));

-- ── Generate again: attach, then the explicit supersede ──────────────
select count(*) as a1 from (select ardentax_document_attach(:'d1', 'ArdentTax (ASP)/' || :'d1' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2/u.docx',
                                'ArdentTax (ASP)/' || :'d1' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee2/u.pdf')) x \gset
select at_check('new files end the signature', doc_sign_live('ardentax_documents', :'d1') is null
  and (select superseded_reason = 'Document changed' from document_signatures where source_table = 'ardentax_documents' and source_id = :'d1'));
select at_check('the explicit supersede that follows finds none and is not refused', doc_sign_supersede('ardentax_documents', :'d1', 'Generated again') = false);

-- ── a revision is a new row ──────────────────────────────────────────
select at_as(:'atappr');
select doc_sign_record(at_sign('ardentax_documents', :'d1', 'ArdentTax (ASP)')) is not null as s1 \gset
select at_as(null);
insert into ardentax_documents (id, request_id, doc_type, document_number, version, revision_of, quote_type, client_name, details)
  values (:'d2', gen_random_uuid(), 'quote', 'AX-T-1', 2, :'d1', 'Standard', 'Sign Test LLC', '{}'::jsonb);
select at_as(:'member');
select count(*) as a2 from (select ardentax_document_attach(:'d2', 'ArdentTax (ASP)/' || :'d2' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee3/u.docx',
                                'ArdentTax (ASP)/' || :'d2' || '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee3/u.pdf')) x \gset
select at_check('the revision starts unsigned and its supersede finds none', doc_sign_live('ardentax_documents', :'d2') is null
  and doc_sign_supersede('ardentax_documents', :'d2', 'Revised') = false);
select at_check('the earlier version keeps its own signature', (doc_sign_live('ardentax_documents', :'d1')).id is not null);

-- ── no access ────────────────────────────────────────────────────────
select at_as(:'outsider');
select at_check('without the tab nothing is seen or ended',
  doc_sign_live('ardentax_documents', :'d1') is null
  and at_refused(format($f$select doc_sign_supersede('ardentax_documents', %L, 'x')$f$, :'d1'), 'not found'));
select at_as(null);
select at_check('and the signature is still live', exists (select 1 from document_signatures where source_table = 'ardentax_documents' and source_id = :'d1' and superseded_at is null));
