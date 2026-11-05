-- LOCAL TEST ONLY. Accounting quote and agreement: numbers, totals, rejects, acceptance, approval, signature protection. All amounts are invented.
\set ON_ERROR_STOP on
\set plain '00000000-0000-0000-0000-0000000000c1'
\set admin '00000000-0000-0000-0000-0000000000c2'
\set hubmgr '00000000-0000-0000-0000-0000000000c3'
\set appr1 '00000000-0000-0000-0000-0000000000c4'
\set appr2 '00000000-0000-0000-0000-0000000000c5'
\set admin2 '00000000-0000-0000-0000-0000000000c6'

select at_as(null);
insert into auth.users (id) values (:'plain'), (:'admin'), (:'hubmgr'), (:'appr1'), (:'appr2'), (:'admin2') on conflict do nothing;
insert into public.profiles (id, full_name, role) values
  (:'plain', 'AC Plain', 'member'), (:'admin', 'AC Admin', 'admin'), (:'hubmgr', 'AC Hub Manager', 'member'),
  (:'appr1', 'AC Approver One', 'member'), (:'appr2', 'AC Approver Two', 'member'), (:'admin2', 'AC Admin Two', 'admin') on conflict (id) do nothing;
insert into public.banking_user_roles (user_id, role) values (:'hubmgr', 'MANAGER') on conflict do nothing;
grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

select at_check('the defaults setting is seeded with the agreed shape and no wording or contact',
  (select value -> 'approvers' = '[]'::jsonb and value ->> 'signature_path' is null and value ->> 'signature_uploaded_at' is null and value ->> 'signature_uploaded_by' is null
      and value #> '{standard,scope_notes}' = '[]'::jsonb and value #> '{standard,fee_notes}' = '[]'::jsonb and value #> '{standard,please_note}' = '[]'::jsonb
      and value #>> '{standard,billing,monthly}' = '' and value #>> '{standard,billing,commencement}' = ''
      and value #>> '{contact,name}' = '' and value #>> '{contact,email}' = '' and value #>> '{contact,phone}' = '' and value #>> '{contact,website}' = ''
    from hub_settings where key = 'accounting_proposal_defaults'));
select at_check('the package table starts empty', (select count(*) = 0 from hub_accounting_packages));

-- A request for a quote; p_options is the list of options, p_extra is merged over the request.
create or replace function public.at_acq(p_options jsonb default null, p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('client_name', 'Acct Test Client LLC', 'contact_name', 'Ann Test', 'contact_email', 'ann@sample.example', 'contact_phone', '+971500000009',
    'quote', jsonb_build_object('options', coalesce(p_options, jsonb_build_array(jsonb_build_object('package_key', 'pkg-a', 'name', 'Package A', 'description', 'Test package', 'notes', jsonb_build_array('note one'),
      'services', jsonb_build_array(jsonb_build_object('name', 'Bookkeeping', 'basis', 'month', 'amount', 100), jsonb_build_object('name', 'Setup', 'basis', 'once', 'amount', 500))))),
      'shared', jsonb_build_object('scope', jsonb_build_array('scope line'), 'payment', jsonb_build_array(), 'notes', jsonb_build_array()))) || p_extra
$$;
grant execute on function public.at_acq(jsonb, jsonb) to authenticated;

create or replace function public.at_aga(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('address', jsonb_build_array('Office 1', 'Dubai'), 'attention', '', 'signatory_name', 'Sam Signer', 'signatory_title', 'Director',
    'notices_email', 'notices@sample.example', 'scope_sentence', 'Accounting services', 'schedule1', jsonb_build_array(jsonb_build_object('name', 'Bookkeeping', 'description', 'Monthly books')),
    'schedule2', jsonb_build_array(jsonb_build_object('description', 'Bookkeeping', 'fee', 'AED 100/- + VAT per month')), 'billing', 'Monthly') || p_extra
$$;
grant execute on function public.at_aga(jsonb) to authenticated;

create or replace function public.at_old_quote(p_name text) returns uuid language sql as $$
  select id from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Accounting', 'vat_mode', 'none', 'client_name', p_name, 'contact_name', 'Old',
    'contact_email', 'old@sample.example', 'contact_phone', '1', 'client_address', 'Dubai', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb))
$$;
grant execute on function public.at_old_quote(text) to authenticated;

-- ── numbers ──────────────────────────────────────────────────────────
select at_as(:'plain');
select at_old_quote('Old Acct One') as old1 \gset
select id as new1, document_number as new1_no, document_serial as new1_serial from hub_acct_quote_create(at_acq()) \gset
select at_old_quote('Old Acct Two') as old2 \gset
select at_check('a new quote takes the next ACQ between two old Accounting quotes, no gap, no repeat',
  (select (select document_serial from hub_documents where id = :'old1') + 1 = :new1_serial
      and :new1_serial + 1 = (select document_serial from hub_documents where id = :'old2')
      and :'new1_no' like 'ABC/%/ACQ%'));
select at_check('the quote row is an Accounting quote with exclusive VAT of 0',
  (select doc_type = 'quote' and department = 'Accounting' and library_template = 'AB Capital/Accounting Quote' and vat_mode = 'exclusive' and vat_amount = 0
      and status = 'issued' and field_values #>> '{quote,accepted_option}' is null and created_by = :'plain'::uuid from hub_documents where id = :'new1'));

-- ── mirrors option 1, and never adds different bases ─────────────────
select id as two_opts from hub_acct_quote_create(at_acq('[
  {"name": "Gold", "services": [{"name": "Books", "basis": "month", "amount": 100}, {"name": "VAT filing", "basis": "quarter", "amount": 40}, {"name": "Setup", "basis": "once", "amount": 500}]},
  {"name": "Silver", "services": [{"name": "Books", "basis": "quarter", "amount": 70}, {"name": "Audit", "basis": "year", "amount": 900}, {"name": "Payroll", "basis": "included"}]}]')) \gset
select at_check('two options: lines, services and total mirror Option 1; total is the monthly figure only',
  (select total_amount = 100 and services = array['Books', 'VAT filing', 'Setup'] and jsonb_array_length(lines) = 3 and lines -> 0 ->> 'description' = 'Books'
      and (lines -> 1 ->> 'basis') = 'quarter' from hub_documents where id = :'two_opts'));
select at_check('no cross sums: monthly 100 plus once 500 gives 100 (first quote)', (select total_amount = 100 from hub_documents where id = :'new1'));
select at_check('no monthly: the first of quarter, year, once is the total',
  (select total_amount = 70 from hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "once", "amount": 5}, {"name": "T", "basis": "quarter", "amount": 70}, {"name": "U", "basis": "year", "amount": 300}]}]')))
  and (select total_amount = 300 from hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "once", "amount": 5}, {"name": "U", "basis": "year", "amount": 300}]}]')))
  and (select total_amount = 5 from hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "once", "amount": 5}]}]'))));
select at_check('no service with an amount gives 0, and the sub services give the amount',
  (select total_amount = 0 and lines -> 0 ->> 'amount' is null from hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "included"}, {"name": "T", "basis": "na"}, {"name": "V", "basis": "separate"}]}]')))
  and (select total_amount = 60 and (field_values #>> '{quote,options,0,services,0,amount}')::numeric = 60 from hub_acct_quote_create(
        at_acq('[{"name": "A", "services": [{"name": "S", "basis": "month", "subs": [{"name": "s1", "amount": 25}, {"name": "s2", "amount": 35}]}]}]'))));

-- ── rejects ──────────────────────────────────────────────────────────
select count(*) as docs_before, max(document_serial) filter (where doc_type = 'quote') as serial_before from hub_documents where department = 'Accounting' \gset
select at_check('no options is refused', at_refused($f$select hub_acct_quote_create(at_acq('[]'))$f$, 'at least one option'));
select at_check('blank package name is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": " ", "services": [{"name": "S", "basis": "once", "amount": 1}]}]'))$f$, 'package name'));
select at_check('no services is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": []}]'))$f$, 'at least one service'));
select at_check('unknown basis is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "weekly", "amount": 1}]}]'))$f$, 'Unknown fee basis'));
select at_check('month with no amount is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "month"}]}]'))$f$, 'needs an amount'));
select at_check('included with an amount is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "included", "amount": 5}]}]'))$f$, 'carries no amount'));
select at_check('separate with sub services is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "separate", "subs": [{"name": "x", "amount": 1}]}]}]'))$f$, 'carries no amount'));
select at_check('negative amount is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "once", "amount": -1}]}]'))$f$, 'zero or more'));
select at_check('non-numeric amount is refused', at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "once", "amount": "abc"}]}]'))$f$, 'valid amount'));
select at_check('sub services that disagree with the amount are refused',
  at_refused($f$select hub_acct_quote_create(at_acq('[{"name": "A", "services": [{"name": "S", "basis": "month", "amount": 50, "subs": [{"name": "x", "amount": 20}, {"name": "y", "amount": 20}]}]}]'))$f$, 'do not add up'));
select at_check('bad email is refused', at_refused($f$select hub_acct_quote_create(at_acq(null, '{"contact_email": "not-an-email"}'))$f$, 'valid email'));
select at_check('blank contact is refused', at_refused($f$select hub_acct_quote_create(at_acq(null, '{"contact_name": " "}'))$f$, 'contact person'));
select at_check('blank client is refused', at_refused($f$select hub_acct_quote_create(at_acq(null, '{"client_name": ""}'))$f$, 'client name'));
select at_check('unknown client code is refused', at_refused($f$select hub_acct_quote_create(at_acq(null, '{"client_id": "NOPE"}'))$f$, 'Unknown client'));
select at_check('rejected requests took no number and left no row',
  (select count(*) = :docs_before and max(document_serial) filter (where doc_type = 'quote') = :serial_before from hub_documents where department = 'Accounting'));
select at_as(null);
select at_check('signed-out is refused', at_refused($f$select hub_acct_quote_create(at_acq())$f$, 'Sign in'));
select at_as(:'plain');

-- ── accept ───────────────────────────────────────────────────────────
select at_check('accept option 2 sets status and re-mirrors lines, services and total',
  (select accepted_ok from (select status = 'accepted' and status_at is not null and status_by = :'plain'::uuid and field_values #>> '{quote,accepted_option}' = '1'
      and total_amount = 70 and services = array['Books', 'Audit', 'Payroll'] and lines -> 2 ->> 'basis' = 'included' as accepted_ok from hub_acct_accept(:'two_opts', 1)) x));
select at_as(null);
select at_check('the Voucher Register amount follows the accepted option (70 for option 2)',
  (select amount = 70 from voucher_register where source = 'hub' and voucher_type = 'Quotation' and source_id = :'two_opts'));
select at_as(:'plain');
select at_check('accept can change the option while there is no agreement',
  (select total_amount = 100 and field_values #>> '{quote,accepted_option}' = '0' from hub_acct_accept(:'two_opts', 0)));
select at_as(null);
select at_check('and the Voucher Register amount follows it back (100 for option 1)',
  (select amount = 100 from voucher_register where source = 'hub' and voucher_type = 'Quotation' and source_id = :'two_opts'));
select at_as(:'plain');
select at_check('out-of-range option raises', at_refused(format($f$select hub_acct_accept(%L, 2)$f$, :'two_opts'), 'does not exist') and at_refused(format($f$select hub_acct_accept(%L, -1)$f$, :'two_opts'), 'does not exist'));
select at_check('accept on an old quote or an unknown id raises', at_refused(format($f$select hub_acct_accept(%L, 0)$f$, :'old1'), 'not found'));

-- ── agreement needs acceptance ───────────────────────────────────────
select at_check('agreement on an unaccepted quote raises',
  at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga()))$f$, :'new1'), 'Accept an option'));
select at_check('agreement needs the signatory, address and a valid notices email',
  at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga('{"signatory_name": ""}')))$f$, :'two_opts'), 'signatory')
  and at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga('{"address": []}')))$f$, :'two_opts'), 'address')
  and at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga('{"notices_email": "x"}')))$f$, :'two_opts'), 'email'));
select at_old_quote('Old Acct Three') as old3 \gset
select id as old_letter, document_number as old_letter_no, document_serial as old_letter_serial from hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', :'old3')) \gset
select id as ag1, document_number as ag1_no, document_serial as ag1_serial from hub_acct_agreement_create(jsonb_build_object('quote_id', :'two_opts', 'agreement', at_aga())) \gset
select at_check('the agreement takes the next ACE after the old letter, is a letter under the quote, and copies the accepted option',
  (select :ag1_serial = :old_letter_serial + 1 and :'ag1_no' like 'ABC/%/ACE%' and doc_type = 'letter' and department = 'Accounting' and parent_id = :'two_opts'::uuid
      and library_template = 'AB Capital/Accounting Agreement' and total_amount = 100 and vat_mode = 'exclusive' and vat_amount = 0 and agreement_changed_at is not null
      and field_values #>> '{agreement,attention}' = 'The Management' and field_values #>> '{agreement,accepted_option}' = '0'
      and (field_values #>> '{agreement,effective_months}')::int = 12 and (field_values #>> '{agreement,notice_days}')::int = 30
      and client_address = E'Office 1\nDubai' and created_by = :'plain'::uuid from hub_documents where id = :'ag1'));
select at_check('a second agreement on the same quote raises',
  at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga()))$f$, :'two_opts'), 'already has'));
select at_check('the accepted option cannot change once the agreement exists', at_refused(format($f$select hub_acct_accept(%L, 1)$f$, :'two_opts'), 'already has its agreement'));

-- ── a rejected agreement ─────────────────────────────────────────────
select id as q_rej from hub_acct_quote_create(at_acq()) \gset
select hub_acct_accept(:'q_rej', 0) is not null as x_rej \gset
select id as ag_rej, document_number as ag_rej_no from hub_acct_agreement_create(jsonb_build_object('quote_id', :'q_rej', 'agreement', at_aga())) \gset
select at_as(null);
update hub_documents set status = 'rejected' where id = :'ag_rej';
select at_as(:'plain');
select at_check('after a rejected agreement a new one is refused by name, not by the raw unique index error',
  at_refused(format($f$select hub_acct_agreement_create(jsonb_build_object('quote_id', %L::uuid, 'agreement', at_aga()))$f$, :'q_rej'),
             format('Agreement %s was rejected. Ask an admin to remove it before making a new one.', :'ag_rej_no')));

-- ── letter guard ─────────────────────────────────────────────────────
-- A quote made here has no address, so the old route would stop at its own address check. Give them one so the guard itself is what answers.
select at_as(null);
update hub_documents set client_address = 'Dubai' where id = :'new1' or id = :'two_opts';
select at_as(:'plain');
select at_check('the old letter route on an Accounting quote from here raises',
  at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'new1'), 'Use the Accounting agreement'));
select id as q_acc from hub_acct_quote_create(at_acq()) \gset
select hub_acct_accept(:'q_acc', 0) is not null as accepted \gset
select at_as(null);
update hub_documents set client_address = 'Dubai' where id = :'q_acc';
select at_as(:'plain');
select at_check('and on an accepted quote that has no agreement yet',
  at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'q_acc'), 'Use the Accounting agreement'));
select at_check('the refused letters took no ACE number', (select count(*) = 0 from hub_documents where doc_type = 'letter' and parent_id in (:'new1'::uuid, :'q_acc'::uuid)));
select at_check('letters on old Accounting quotes still work', (select doc_type = 'letter' and library_template is null and document_number = :'old_letter_no' from hub_documents where id = :'old_letter'));

-- ── can send, before approval ────────────────────────────────────────
select at_check('quote without a PDF cannot be sent', not hub_acct_can_send(:'new1'));
select at_check('unknown id cannot be sent', not hub_acct_can_send(gen_random_uuid()));
select at_check('attach records the PDF and the Word path', (select storage_path = 'hub-documents/q1.pdf' and word_path = 'hub-documents/q1.docx' from hub_acct_attach(:'new1', 'hub-documents/q1.pdf', 'hub-documents/q1.docx')));
select at_check('quote with a PDF can be sent', hub_acct_can_send(:'new1'));
select hub_acct_attach(:'ag1', 'Accounting/ag1-draft.pdf', 'Accounting/ag1-draft.docx') is not null as attached \gset
select at_check('unapproved agreement with a PDF cannot be sent', (select storage_path = 'Accounting/ag1-draft.pdf' from hub_documents where id = :'ag1') and not hub_acct_can_send(:'ag1'));
select at_check('OneDrive and signed records are kept',
  (select onedrive_path = 'Proposals/Test' and onedrive_saved_at is not null from hub_acct_saved(:'new1', 'Proposals/Test'))
  and (select signed_at = date '2026-11-06' and signed_path = 'Accounting/signed/q1.pdf' from hub_acct_signed(:'new1', date '2026-11-06', 'Accounting/signed/q1.pdf'))
  and at_refused(format($f$select hub_acct_signed(%L, null, 'x')$f$, :'new1'), 'date'));
select at_check('an unapproved agreement cannot record a signed copy',
  at_refused(format($f$select hub_acct_signed(%L, date '2026-11-06', 'Accounting/signed/ag1.pdf')$f$, :'ag1'), 'is not approved, so no signed copy can be recorded')
  and (select signed_at is null and signed_path is null from hub_documents where id = :'ag1'));
select at_check('a quote still needs no approval to record its signed copy', (select signed_path = 'Accounting/signed/q1.pdf' from hub_documents where id = :'new1'));

-- ── mail drafts: any staff member may change them ────────────────────
select id as mail1 from hub_document_create(jsonb_build_object('doc_type', 'mail', 'parent_id', :'new1', 'department', 'Accounting', 'client_name', 'Acct Test Client LLC',
  'lines', '[{"description": "Fee", "amount": 0}]'::jsonb, 'mail_subject', 'Quote', 'mail_body', 'Body')) \gset
select id as mail_old from hub_document_create(jsonb_build_object('doc_type', 'mail', 'parent_id', :'old1', 'department', 'Accounting', 'client_name', 'Old Acct One',
  'lines', '[{"description": "Fee", "amount": 0}]'::jsonb, 'mail_subject', 'Old', 'mail_body', 'Old')) \gset
select at_as(:'appr2');
select count(*) >= 0 as m0 from (select hub_mail_update(:'mail1', 'Lost', 'Lost')) x \gset
select at_check('the old hub_mail_update silently changes nothing for someone other than the creator', (select mail_subject = 'Quote' from hub_documents where id = :'mail1'));
select count(*) >= 0 as m1 from (select hub_acct_mail_update(:'mail1', 'Quote changed', 'Body changed')) x \gset
select at_check('hub_acct_mail_update lets another staff member change the Accounting mail draft',
  (select mail_subject = 'Quote changed' and mail_body = 'Body changed' from hub_documents where id = :'mail1'));
select at_check('a mail under an old quote, a non-mail row and an unknown id are refused by name',
  at_refused(format($f$select hub_acct_mail_update(%L, 's', 'b')$f$, :'mail_old'), 'mail draft of this Accounting document was not found')
  and at_refused(format($f$select hub_acct_mail_update(%L, 's', 'b')$f$, :'new1'), 'was not found')
  and at_refused(format($f$select hub_acct_mail_update(%L, 's', 'b')$f$, gen_random_uuid()), 'was not found')
  and (select mail_subject = 'Old' from hub_documents where id = :'mail_old'));
select at_as(null);
select at_check('a signed-out caller cannot change a mail draft', at_refused(format($f$select hub_acct_mail_update(%L, 's', 'b')$f$, :'mail1'), 'Sign in'));
select at_as(:'plain');

-- ── approve rights ───────────────────────────────────────────────────
select at_as(:'admin');
select at_check('empty list: a CRM administrator can approve', hub_acct_can_approve());
select at_as(:'hubmgr');
select at_check('empty list: a manager who is a Hub admin cannot approve', hub_is_admin() and not hub_acct_can_approve());
select at_check('a Hub-admin manager cannot approve an agreement', at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', now())$f$, :'ag1'), 'not an approver'));
select at_as(:'plain');
select at_check('empty list: a plain user cannot approve', not hub_acct_can_approve());
select at_as(null);
select at_check('signed out cannot approve', not hub_acct_can_approve());

-- ── admin only ───────────────────────────────────────────────────────
select at_as(:'hubmgr');
select at_check('a Hub-admin manager fails on hub_acct_admin_save', at_refused($f$select hub_acct_admin_save('{"approvers": []}')$f$, 'administrator'));
select at_check('a Hub-admin manager passes on hub_acct_package_save and hub_acct_defaults_save',
  hub_acct_package_save('{"package_key": "pkg-test", "name": "Test package", "services": [{"name": "S", "basis": "month", "amount": 1}], "notes": ["n"], "schedule1": [{"name": "S", "description": "d"}]}') = 'pkg-test'
  and (hub_acct_defaults_save('{"standard": {"scope_notes": ["a", " "], "fee_notes": [], "please_note": [], "billing": {"monthly": "m", "quarterly": "q", "commencement": "c"}},
                                 "contact": {"name": "Contact", "phone": "1", "email": "e@sample.example", "website": "w.example"}}') -> 'standard' -> 'scope_notes') = '["a"]'::jsonb);
select at_check('the defaults save keeps the approvers and signature keys',
  (select value ? 'approvers' and value ? 'signature_path' and value #>> '{contact,name}' = 'Contact' from hub_settings where key = 'accounting_proposal_defaults'));
select at_as(:'plain');
select at_check('a plain user fails on package and defaults saves',
  at_refused($f$select hub_acct_package_save('{"package_key": "pkg-x", "name": "X"}')$f$, 'administrator') and at_refused($f$select hub_acct_defaults_save('{"standard": {}, "contact": {}}')$f$, 'administrator'));
select at_check('packages are readable by any signed-in user', (select count(*) = 1 from hub_accounting_packages where package_key = 'pkg-test'));
select at_as(:'admin');
select at_check('a CRM administrator passes on hub_acct_admin_save and bad approvers are refused',
  at_refused($f$select hub_acct_admin_save('{"approvers": ["not-a-uuid"]}')$f$, 'known user')
  and at_refused($f$select hub_acct_admin_save('{"signature_path": "somewhere/else.png"}')$f$, 'accounting-signature/')
  and (hub_acct_admin_save(jsonb_build_object('approvers', jsonb_build_array(:'admin'))) -> 'approvers') = jsonb_build_array(:'admin'));

-- ── no image ─────────────────────────────────────────────────────────
select at_check('approve with no signature_path raises Upload the signature first',
  at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', now())$f$, :'ag1'), 'Upload the signature first'));
select hub_acct_admin_save(jsonb_build_object('approvers', jsonb_build_array(:'appr1', :'appr2'), 'signature_path', 'accounting-signature/test-sig.png')) is not null as x3 \gset
select at_check('the signature record keeps the date and the uploader',
  (select value ->> 'signature_path' = 'accounting-signature/test-sig.png' and value ->> 'signature_uploaded_by' = :'admin' and value ->> 'signature_uploaded_at' is not null
     from hub_settings where key = 'accounting_proposal_defaults'));

-- ── list members, non-members, self approval ─────────────────────────
select at_as(:'plain');
select at_check('list in place: a non-member cannot approve, even the creator', not hub_acct_can_approve());
select at_as(:'admin');
select at_check('list in place: an administrator not on the list cannot approve', not hub_acct_can_approve());
select at_as(:'plain');
select at_check('a non-member is refused on approve', at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', now())$f$, :'ag1'), 'not an approver'));

-- An agreement created by approver one, on a new quote.
select at_as(:'appr1');
select id as q_self from hub_acct_quote_create(at_acq()) \gset
select hub_acct_accept(:'q_self', 0) is not null as x1 \gset
select id as ag_self, agreement_changed_at as ag_self_changed from hub_acct_agreement_create(jsonb_build_object('quote_id', :'q_self', 'agreement', at_aga())) \gset
select at_check('list member passes can_approve', hub_acct_can_approve());
select at_check('self approval: the creator fails when another approver exists',
  at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', %L::timestamptz)$f$, :'ag_self', :'ag_self_changed'), 'cannot approve an agreement they created'));
select at_check('and nothing was recorded', (select approved_by is null and approved_at is null from hub_documents where id = :'ag_self'));

-- ── stale approval ───────────────────────────────────────────────────
select at_as(:'appr2');
select at_check('stale approval: a p_seen older than agreement_changed_at raises',
  at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', %L::timestamptz - interval '1 second')$f$, :'ag_self', :'ag_self_changed'), 'The agreement changed')
  and at_refused(format($f$select hub_acct_approve(%L, 'a.pdf', 'a.docx', null)$f$, :'ag_self'), 'The agreement changed'));
select at_check('and nothing is recorded', (select approved_by is null and approved_at is null and storage_path is null from hub_documents where id = :'ag_self'));
select at_check('approve needs both files', at_refused(format($f$select hub_acct_approve(%L, '', 'a.docx', %L::timestamptz)$f$, :'ag_self', :'ag_self_changed'), 'files are needed'));

-- ── approve, and the files swap ──────────────────────────────────────
select hub_acct_attach(:'ag_self', 'Accounting/self-draft.pdf', 'Accounting/self-draft.docx') is not null as x2 \gset
select at_check('another approver approves: approval and the file swap are recorded together, the draft goes to file_history',
  (select approved_by = :'appr2'::uuid and approved_at is not null and storage_path = 'Accounting/self-signed.pdf' and word_path = 'Accounting/self-signed.docx'
      and field_values #>> '{file_history,0,storage_path}' = 'Accounting/self-draft.pdf' and field_values #>> '{file_history,0,word_path}' = 'Accounting/self-draft.docx'
      from hub_acct_approve(:'ag_self', 'Accounting/self-signed.pdf', 'Accounting/self-signed.docx', :'ag_self_changed')));
select at_check('an approved agreement can be sent', hub_acct_can_send(:'ag_self'));
select at_check('approving twice raises and approved files cannot be replaced',
  at_refused(format($f$select hub_acct_approve(%L, 'x.pdf', 'x.docx', now())$f$, :'ag_self'), 'already approved')
  and at_refused(format($f$select hub_acct_attach(%L, 'x.pdf', 'x.docx')$f$, :'ag_self'), 'cannot be replaced'));

-- ── edit clears ──────────────────────────────────────────────────────
select at_as(:'plain');
select at_check('editing clears the approval, sets agreement_changed_at, and pushes the old paths to file_history',
  (select approved_by is null and approved_at is null and storage_path is null and word_path is null and agreement_changed_at > :'ag_self_changed'::timestamptz
      and field_values #>> '{agreement,signatory_name}' = 'Pat Changed' and field_values #>> '{agreement,accepted_option}' = '0'
      and jsonb_array_length(field_values -> 'file_history') = 2 and field_values #>> '{file_history,1,storage_path}' = 'Accounting/self-signed.pdf'
      and field_values #>> '{file_history,1,approved_by}' = :'appr2' from hub_acct_agreement_update(:'ag_self', at_aga('{"signatory_name": "Pat Changed", "accepted_option": 5}'))));
select at_check('an edited agreement cannot be sent', not hub_acct_can_send(:'ag_self'));
select at_check('editing needs valid details', at_refused(format($f$select hub_acct_agreement_update(%L, at_aga('{"address": []}'))$f$, :'ag_self'), 'address'));

-- ── sole approver ────────────────────────────────────────────────────
select at_as(:'admin');
select hub_acct_admin_save(jsonb_build_object('approvers', jsonb_build_array(:'appr1'))) is not null as x4 \gset
select at_as(:'appr1');
select at_check('self approval: the creator passes when sole approver',
  (select approved_by = :'appr1'::uuid and storage_path = 'Accounting/self2.pdf' from hub_acct_approve(:'ag_self'::uuid, 'Accounting/self2.pdf', 'Accounting/self2.docx', (select date_trunc('milliseconds', agreement_changed_at) from hub_documents where id = :'ag_self'))));

-- ── empty list: the creator administrator is refused while another administrator exists ──
select at_as(:'admin');
select hub_acct_admin_save('{"approvers": []}') is not null as x5 \gset
select id as q_adm from hub_acct_quote_create(at_acq()) \gset
select hub_acct_accept(:'q_adm', 0) is not null as x6 \gset
select id as ag_adm, agreement_changed_at as ag_adm_changed from hub_acct_agreement_create(jsonb_build_object('quote_id', :'q_adm', 'agreement', at_aga())) \gset
select at_check('empty list: an administrator cannot approve the agreement they created while another administrator exists',
  at_refused(format($f$select hub_acct_approve(%L, 'p.pdf', 'p.docx', %L::timestamptz)$f$, :'ag_adm', :'ag_adm_changed'), 'cannot approve an agreement they created'));
select at_as(:'admin2');
select at_check('empty list: another administrator approves it',
  (select approved_by = :'admin2'::uuid from hub_acct_approve(:'ag_adm', 'p.pdf', 'p.docx', :'ag_adm_changed')));

-- ── approved files stay put ──────────────────────────────────────────
select at_as(:'admin');
select at_check('the creator cannot point an approved agreement at another PDF through hub_document_attach',
  at_refused(format($f$select hub_document_attach(%L, 'Accounting/evil.pdf', null)$f$, :'ag_adm'), 'Approved files cannot be replaced'));
select at_check('nor through hub_acct_attach',
  at_refused(format($f$select hub_acct_attach(%L, 'Accounting/evil.pdf', 'Accounting/evil.docx')$f$, :'ag_adm'), 'cannot be replaced'));
select at_check('and the approved files are unchanged', (select storage_path = 'p.pdf' and word_path = 'p.docx' and approved_at is not null from hub_documents where id = :'ag_adm'));
select count(*) >= 0 as la from (select hub_document_attach(:'ag_adm', null, 'C:/office/copy.pdf')) x \gset
select at_check('hub_document_attach may still record the office copy without touching the PDF',
  (select local_path = 'C:/office/copy.pdf' and storage_path = 'p.pdf' from hub_documents where id = :'ag_adm'));
select at_as(:'plain');
select count(*) >= 0 as qa from (select hub_document_attach(:'new1', 'hub-documents/q1b.pdf', null)) x \gset
select at_check('a quote (never approved) can still be re-attached by its creator', (select storage_path = 'hub-documents/q1b.pdf' from hub_documents where id = :'new1'));
select at_as(:'admin');
select at_check('an edit still clears the approval and the files in one statement',
  (select approved_at is null and storage_path is null and word_path is null from hub_acct_agreement_update(:'ag_adm', at_aga())));
select date_trunc('milliseconds', agreement_changed_at) as ag_adm_changed2 from hub_documents where id = :'ag_adm' \gset
select hub_acct_attach(:'ag_adm', 'Accounting/adm-draft.pdf', 'Accounting/adm-draft.docx') is not null as x8 \gset
select at_as(:'admin2');
select at_check('and approve still swaps the files in',
  (select approved_by = :'admin2'::uuid and storage_path = 'Accounting/adm2.pdf' and word_path = 'Accounting/adm2.docx'
     from hub_acct_approve(:'ag_adm', 'Accounting/adm2.pdf', 'Accounting/adm2.docx', :'ag_adm_changed2')));
select at_check('the approving flag does not outlast the approval', coalesce(current_setting('hub_acct.approving', true), '') <> 'on');

-- ── signed agreements ────────────────────────────────────────────────
select at_check('an approved agreement records its signed copy',
  (select signed_at = date '2026-11-06' from hub_acct_signed(:'ag_adm', date '2026-11-06', 'Accounting/signed/adm.pdf')));
select at_check('a signed agreement cannot be edited',
  at_refused(format($f$select hub_acct_agreement_update(%L, at_aga())$f$, :'ag_adm'), 'is signed and cannot be edited')
  and (select approved_at is not null and storage_path = 'Accounting/adm2.pdf' from hub_documents where id = :'ag_adm'));

-- ── signature protection in the bucket ───────────────────────────────
select at_as(null);
insert into storage.buckets (id, name) values ('hub-documents', 'hub-documents') on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('hub-documents', 'Accounting/quotes/other.docx');
select at_as(:'admin');
select hub_acct_admin_save(jsonb_build_object('approvers', jsonb_build_array(:'appr1', :'appr2'))) is not null as x7 \gset
select at_as(:'plain');
select at_check('a non-admin cannot add under accounting-signature/',
  at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/forged.png')$f$, 'row-level security'));
select at_as(:'appr1');
select at_check('an approver who is not an administrator cannot add under accounting-signature/ either',
  at_refused($f$insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/forged.png')$f$, 'row-level security'));
select at_as(:'admin');
insert into storage.objects (bucket_id, name) values ('hub-documents', 'accounting-signature/test-sig.png');
select at_check('an administrator can add under accounting-signature/', true);
select at_as(:'plain');
select at_check('a non-approver reads no row under accounting-signature/, and other hub-documents paths stay readable',
  (select count(*) = 0 from storage.objects where bucket_id = 'hub-documents' and name like 'accounting-signature/%')
  and (select count(*) = 1 from storage.objects where bucket_id = 'hub-documents' and name = 'Accounting/quotes/other.docx'));
select at_as(:'admin');
select at_check('an administrator who is not an approver does not read it', (select count(*) = 0 from storage.objects where name like 'accounting-signature/%'));
select at_as(:'appr2');
select at_check('an approver reads the row', (select count(*) = 1 from storage.objects where bucket_id = 'hub-documents' and name = 'accounting-signature/test-sig.png'));
select at_as(:'hubmgr');
select at_as(:'plain');
update storage.objects set name = 'accounting-signature/moved.png' where name = 'Accounting/quotes/other.docx';
delete from storage.objects where name like 'accounting-signature/%';
select at_as(null);
select at_check('a non-admin could not rename a file into the prefix or delete the image',
  (select count(*) = 1 from storage.objects where name = 'Accounting/quotes/other.docx') and (select count(*) = 1 from storage.objects where name = 'accounting-signature/test-sig.png')
  and (select count(*) = 0 from storage.objects where name = 'accounting-signature/moved.png'));
select at_as(:'admin');
select at_check('an administrator is not blocked by the update and delete policies',
  (select count(*) = 2 from pg_policies where policyname in ('hub_docs_accounting_signature_update', 'hub_docs_accounting_signature_delete') and permissive = 'RESTRICTIVE' and qual like '%admin_is%'));
select at_as(:'hubmgr');
select at_check('a Hub-admin manager who is not an approver does not read it', (select count(*) = 0 from storage.objects where name like 'accounting-signature/%'));
select at_as(null);
