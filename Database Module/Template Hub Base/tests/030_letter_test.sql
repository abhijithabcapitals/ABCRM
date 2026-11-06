-- LOCAL TEST ONLY. Engagement letters from Company Templates.
\set ON_ERROR_STOP on
\set quoter '00000000-0000-0000-0000-0000000000b2'
\set outsider '00000000-0000-0000-0000-0000000000b4'

create or replace function public.at_letter(p_extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('client_name', 'Letter Client LLC', 'contact_name', 'Lee Letter', 'contact_email', 'lee@sample.example', 'contact_phone', '+971500000001',
    'license_number', 'L-1', 'vat_trn', '100000000000003', 'field_values', '{"date": "2026-11-05"}'::jsonb,
    'lines', '[{"description": "Formation", "amount": 1000}, {"description": "Visa", "amount": "250.50"}]'::jsonb) || p_extra
$$;
grant execute on function public.at_letter(jsonb) to authenticated;

select at_as(null);
select coalesce(max(document_serial), 0) as last_letter from hub_documents where department = 'Business Setup' and doc_type = 'letter' \gset

select at_as(:'quoter');
select at_check('direct letter takes the next BSE number and needs no quote',
  (select document_number like 'ABC/%/BSE%' and document_serial = :last_letter + 1 and parent_id is null and doc_type = 'letter' and vat_mode = 'none'
     and library_template = 'AB Capital/Engagement Letter' and license_number = 'L-1' from hub_library_letter_create(at_letter())));
select at_check('total is recalculated from lines',
  (select total_amount = 1250.50 from hub_library_letter_create(at_letter('{"total_amount": 5}'))));

select at_as(null);
select document_number as direct_number from hub_documents where doc_type = 'letter' and library_template = 'AB Capital/Engagement Letter' order by created_at limit 1 \gset
select at_check('letter appears in the Voucher Register',
  (select count(*) = 1 and bool_and(voucher_type = 'Engagement Letter' and department = 'Business Setup') from voucher_register where voucher_number = :'direct_number'));

select at_as(:'quoter');
select id as q1 from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_name', 'Q Client', 'contact_name', 'Q', 'contact_email', 'q@sample.example', 'contact_phone', '1', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb)) \gset
select at_check('letter from an issued quote sets parent_id and needs no acceptance',
  (select parent_id = :'q1'::uuid from hub_library_letter_create(at_letter(jsonb_build_object('parent_id', :'q1')))));
select at_check('second letter for a quote is refused',
  at_refused(format($f$select hub_library_letter_create(at_letter('{"parent_id": "%s"}'))$f$, :'q1'), 'already has'));
select at_check('Business Setup letter through hub_document_create still needs an accepted quote',
  (select count(*) = 1 from (select id from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_name', 'Q2', 'contact_name', 'Q', 'contact_email', 'q@sample.example', 'contact_phone', '1', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb))) x));
select id as q2 from hub_documents where client_name = 'Q2' \gset
select at_check('hub_document_create refuses an unaccepted quote',
  at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'q2'), 'accepted first')
  or at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'q2'), 'Confirm the signed quote first'));

select at_as(null);
update hub_documents set status = 'rejected', status_at = now() where id = :'q2';
select at_as(:'quoter');
select at_check('rejected quote is refused',
  at_refused(format($f$select hub_library_letter_create(at_letter('{"parent_id": "%s"}'))$f$, :'q2'), 'cannot have a letter'));

select id as q3 from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_name', 'Q3', 'contact_name', 'Q', 'contact_email', 'q@sample.example', 'contact_phone', '1', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb)) \gset
select at_as(null);
insert into business_setup_cases (lead_name) values ('Letter case');
update hub_documents set case_id = (select id from business_setup_cases where lead_name = 'Letter case') where id = :'q3';
select at_as(:'quoter');
select at_check('quote in a case is refused',
  at_refused(format($f$select hub_library_letter_create(at_letter('{"parent_id": "%s"}'))$f$, :'q3'), 'belongs to a Business Setup case'));

select at_check('missing contact is refused', at_refused($f$select hub_library_letter_create(at_letter('{"contact_phone": ""}'))$f$, 'client details'));
select at_check('no lines is refused', at_refused($f$select hub_library_letter_create(at_letter('{"lines": []}'))$f$, 'at least one'));
select at_check('blank fee is refused', at_refused($f$select hub_library_letter_create(at_letter('{"lines": [{"description": "X", "amount": ""}]}'))$f$, 'zero or more'));
select at_check('unknown client is refused', at_refused($f$select hub_library_letter_create(at_letter('{"client_id": "NOPE"}'))$f$, 'Unknown client'));

select at_as(:'outsider');
select at_check('outsider is refused', at_refused($f$select hub_library_letter_create(at_letter())$f$, 'permission'));
select at_as(null);
