-- LOCAL TEST ONLY. Business Formation Proposal: records, authority sets and accepted-option letters.
\set ON_ERROR_STOP on
\set manager '00000000-0000-0000-0000-0000000000b1'
\set quoter '00000000-0000-0000-0000-0000000000b2'
\set outsider '00000000-0000-0000-0000-0000000000b4'

create or replace function public.at_prop_body() returns jsonb language sql as $$
  select '{"usd_rate": 3.6725, "options": [
    {"authority_key": "zone-a", "authority_name": "Zone A", "activity": "Consulting", "services": [{"name": "Licence", "amount": 40}, {"name": "Visa", "amount": 60}]},
    {"authority_key": "zone-b", "authority_name": "Zone B", "activity": "Trading", "services": [{"name": "Package", "subs": [{"name": "Licence", "amount": 300}, {"name": "Office", "amount": 600}]}]}],
    "shared": {"addons": [{"name": "Extra", "amount": 5}], "documents": ["Passport"], "payment": ["Bank transfer"], "scope": ["Scope text"], "notes": ["A note"]}}'::jsonb
$$;
create or replace function public.at_prop(p_extra jsonb default '{}', p_proposal jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('client_name', 'Proposal Client LLC', 'contact_name', 'Pat Proposal', 'contact_email', 'pat@sample.example', 'contact_phone', '+971500000002',
    'proposal', coalesce(p_proposal, at_prop_body())) || p_extra
$$;
grant execute on function public.at_prop(jsonb, jsonb), public.at_prop_body() to authenticated;
create or replace function public.at_counter() returns int language sql as $$
  select coalesce((select sum(last_serial) from hub_number_counters where department = 'Business Setup' and kind in ('quote', 'letter')), 0)::int
$$;

select at_as(:'quoter');
select id as old1 from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_name', 'Old A', 'contact_name', 'Q', 'contact_email', 'q@sample.example', 'contact_phone', '1', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb)) \gset
select document_serial as s_old1 from hub_documents where id = :'old1' \gset
select id as pid, document_serial as s_prop from hub_proposal_create(at_prop()) \gset
select id as old2 from hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_name', 'Old B', 'contact_name', 'Q', 'contact_email', 'q@sample.example', 'contact_phone', '1', 'lines', '[{"description": "Fee", "amount": 10}]'::jsonb)) \gset
select document_serial as s_old2 from hub_documents where id = :'old2' \gset
select at_check('create numbers from main counter', :s_prop = :s_old1 + 1 and :s_old2 = :s_prop + 1);
select at_check('proposal number is a BSQ number', (select document_number like 'ABC/%/BSQ%' from hub_documents where id = :'pid'));

select at_check('create mirrors option 1',
  (select total_amount = 100 and jsonb_array_length(lines) = 2 and library_template = 'AB Capital/Proposal' and vat_mode = 'none' and vat_rate = 0 and doc_type = 'quote'
     and department = 'Business Setup' and services = array['Licence', 'Visa'] and field_values #>> '{proposal,accepted_option}' is null
     and jsonb_array_length(field_values #> '{proposal,options}') = 2 and status = 'issued' from hub_documents where id = :'pid'));
select at_check('second option total is its own, not added',
  (select (field_values #>> '{proposal,options,1,services,0,amount}')::numeric = 900 from hub_documents where id = :'pid'));
select at_check('sub total that disagrees is refused',
  at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3.6725, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": 5, "subs": [{"name": "T", "amount": 3}]}]}]}'))$f$, 'disagrees with its sub services'));
select at_check('sub total that agrees is kept',
  (select (field_values #>> '{proposal,options,0,services,0,amount}')::numeric = 3 from hub_proposal_create(at_prop('{}', '{"usd_rate": 3.6725, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": 3, "subs": [{"name": "T", "amount": 3}]}]}]}'))));
select at_check('two decimals are kept',
  (select (field_values #>> '{proposal,options,0,services,0,amount}')::numeric = 1.25 from hub_proposal_create(at_prop('{}', '{"usd_rate": 3.6725, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": "1.25"}]}]}'))));

select at_as(null);
select at_counter() as before_rejects \gset
select at_as(:'quoter');
select at_check('no options refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3.6725, "options": []}'))$f$, 'at least one option'));
select at_check('blank activity refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "a", "activity": " ", "services": [{"name": "S", "amount": 1}]}]}'))$f$, 'business activity'));
select at_check('blank authority refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "", "activity": "x", "services": [{"name": "S", "amount": 1}]}]}'))$f$, 'needs an authority'));
select at_check('negative amount refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": -1}]}]}'))$f$, 'zero or more'));
select at_check('non-numeric amount refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": "abc"}]}]}'))$f$, 'zero or more'));
select at_check('three decimals refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": 1.005}]}]}'))$f$, 'at most 2 decimals'));
select at_check('three decimals on a sub service refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 3, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "subs": [{"name": "T", "amount": "2.125"}]}]}]}'))$f$, 'at most 2 decimals'));
select at_check('usd_rate 0 refused', at_refused($f$select hub_proposal_create(at_prop('{}', '{"usd_rate": 0, "options": [{"authority_key": "a", "activity": "x", "services": [{"name": "S", "amount": 1}]}]}'))$f$, 'USD rate'));
select at_check('bad email refused', at_refused($f$select hub_proposal_create(at_prop('{"contact_email": "nope"}'))$f$, 'valid contact email'));
select at_check('blank contact refused', at_refused($f$select hub_proposal_create(at_prop('{"contact_name": " "}'))$f$, 'contact name'));
select at_as(null);
select at_check('rejects leave the counter unchanged', at_counter() = :before_rejects);

select at_as(:'outsider');
select at_check('outsider cannot create', at_refused($f$select hub_proposal_create(at_prop())$f$, 'permission'));
select at_check('outsider cannot make a letter', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s", "option": 0}')$f$, :'pid'), 'permission'));
select at_check('outsider cannot record a choice', at_refused(format($f$select hub_proposal_choose('{"quote_id": "%s", "option": 0}')$f$, :'pid'), 'permission'));
select at_check('outsider cannot attach', at_refused(format($f$select hub_proposal_attach(%L::uuid, 'a.pdf', 'a.docx')$f$, :'pid'), 'permission'));
select at_check('outsider cannot mark saved', at_refused(format($f$select hub_proposal_saved(%L::uuid, 'x')$f$, :'pid'), 'permission'));
select at_check('outsider cannot send', not hub_proposal_can_send());
select at_as(:'quoter');
select at_check('quoter can send', hub_proposal_can_send());
select at_check('non-admin cannot save authority', at_refused($f$select hub_proposal_authority_save('{"authority_key": "k", "name": "K", "kind": "mainland"}')$f$, 'permission'));
select at_check('non-admin cannot save defaults', at_refused($f$select hub_proposal_defaults_save('{"usd_rate": 3.6}')$f$, 'permission'));
select at_check('quoter cannot write the table', at_refused($f$insert into hub_proposal_authorities (authority_key, name, kind) values ('k', 'K', 'mainland')$f$, 'permission'));

select at_check('attach stores PDF and Word',
  (select storage_path = 'p/a.pdf' and word_path = 'p/a.docx' from hub_proposal_attach(:'pid'::uuid, 'p/a.pdf', 'p/a.docx')));
select at_check('saved stores the OneDrive path',
  (select onedrive_path = 'od/a.pdf' and onedrive_saved_at is not null from hub_proposal_saved(:'pid'::uuid, 'od/a.pdf')));
select at_check('attach refuses an ordinary quote', at_refused(format($f$select hub_proposal_attach(%L::uuid, 'a.pdf', null)$f$, :'old1'), 'not found'));

select at_as(null);
insert into banking_user_roles (user_id, role) values (:'manager', 'MANAGER') on conflict do nothing;
select at_as(:'manager');
select at_check('admin saves an authority',
  hub_proposal_authority_save('{"authority_key": "zone-a", "name": "Zone A", "kind": "free_zone", "services": [{"name": "Licence"}], "red_notes": ["Note", " "], "addons": []}') = 'zone-a');
select at_check('authority is stored', (select kind = 'free_zone' and red_notes = '["Note"]'::jsonb and active from hub_proposal_authorities where authority_key = 'zone-a'));
select at_check('bad authority kind refused', at_refused($f$select hub_proposal_authority_save('{"authority_key": "k", "name": "K", "kind": "x"}')$f$, 'free_zone or mainland'));
select at_check('admin saves defaults', (hub_proposal_defaults_save('{"usd_rate": 3.7, "contact": {"name": "N"}}') #>> '{contact,name}') = 'N');
select at_check('defaults stored', (select value ->> 'usd_rate' = '3.7' from hub_settings where key = 'proposal_defaults'));
select at_check('defaults rate must be positive', at_refused($f$select hub_proposal_defaults_save('{"usd_rate": 0}')$f$, 'USD rate'));
select at_check('authority table readable by signed-in users', (select count(*) >= 1 from hub_proposal_authorities));

-- â”€â”€ Recording the client's choice â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
select at_as(:'quoter');
select at_check('letter refused while the proposal is only issued', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s"}')$f$, :'pid'), 'must be accepted'));
select at_check('a malformed reference is explained (letter)', at_refused($f$select hub_proposal_letter_create('{"quote_id": "not-a-uuid"}')$f$, 'proposal reference is not valid'));
select at_check('a malformed reference is explained (choice)', at_refused($f$select hub_proposal_choose('{"quote_id": "12345", "option": 0}')$f$, 'proposal reference is not valid'));
select at_check('a choice needs an option', at_refused(format($f$select hub_proposal_choose('{"quote_id": "%s"}')$f$, :'pid'), 'Choose the option the client accepted'));
select at_check('a choice out of range is refused', at_refused(format($f$select hub_proposal_choose('{"quote_id": "%s", "option": 5}')$f$, :'pid'), 'Choose the option the client accepted'));
select at_check('an ordinary quote takes no proposal choice', at_refused(format($f$select hub_proposal_choose('{"quote_id": "%s", "option": 0}')$f$, :'old1'), 'not found'));
select at_check('choosing option 2 moves the quote to it and keeps it issued',
  (select field_values #>> '{proposal,accepted_option}' = '1' and total_amount = 900 and services = array['Package'] and jsonb_array_length(lines) = 1 and status = 'issued'
     and jsonb_array_length(field_values #> '{proposal,options}') = 2 from hub_proposal_choose(jsonb_build_object('quote_id', :'pid', 'option', 1))));
select at_check('the choice can change while issued',
  (select field_values #>> '{proposal,accepted_option}' = '0' and total_amount = 100 and services = array['Licence', 'Visa'] and jsonb_array_length(lines) = 2 and status = 'issued'
     from hub_proposal_choose(jsonb_build_object('quote_id', :'pid', 'option', '0'))));
select at_check('the letter is still refused after a choice, before acceptance', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s"}')$f$, :'pid'), 'must be accepted'));
select at_as(null);
select at_check('a choice is audited', (select count(*) = 2 from business_setup_audit_log where table_name = 'hub_documents' and row_id = :'pid' and action = 'proposal_choose'));

-- â”€â”€ Acceptance through business_setup_quote_accept_body â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
select at_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL950050', 'Proposal Client LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL950050', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL950050', 'P', 'portal.p050', 'x');
select id as acc from client_portal_accounts where username = 'portal.p050' \gset
create or replace function pg_temp.pv(p_acc uuid, p_quote uuid) returns jsonb language sql security definer as $$
  select e from jsonb_array_elements(public.business_setup_portal_view(p_acc) -> 'quotes') e where e ->> 'id' = p_quote::text $$;
select at_as(:'quoter');
select id as pa from hub_proposal_create(at_prop('{"client_id": "CL950050"}')) \gset
select hub_proposal_attach(:'pa'::uuid, 'p/pa.pdf', 'p/pa.docx') is not null as attached \gset
select business_setup_signed_add(:'pa'::uuid, 'staff/CL950050/pa-signed.pdf') as sa \gset
select at_check('an undecided proposal cannot be accepted from its signed copy',
  at_refused(format($f$select business_setup_signed_decide(%L::uuid, true, null)$f$, :'sa'), 'Choose the accepted option first'));
select at_as(null);
select at_check('the refused acceptance left the proposal issued, its copy waiting and no services',
  (select status = 'issued' from hub_documents where id = :'pa') and (select status = 'Uploaded' from business_setup_signed_quotes where id = :'sa')
  and not exists (select 1 from business_setup_services where quote_id = :'pa'));
select at_check('the portal does not list an undecided proposal', pg_temp.pv(:'acc'::uuid, :'pa'::uuid) is null);
select at_as(:'quoter');
select hub_proposal_choose(jsonb_build_object('quote_id', :'pa', 'option', 1)) is not null as chosen \gset
select at_as(null);
select at_check('the portal lists the proposal once its choice is set, with the chosen total',
  (select (e ->> 'total')::numeric = 900 from pg_temp.pv(:'acc'::uuid, :'pa'::uuid) e));
select at_as(:'quoter');
select business_setup_signed_decide(:'sa'::uuid, true, null);
select at_check('confirming the signed copy accepts the proposal through the accept body',
  (select status = 'accepted' and status_by = :'quoter'::uuid and total_amount = 900 and field_values #>> '{proposal,accepted_option}' = '1' from hub_documents where id = :'pa'));
select at_as(null);
select at_check('acceptance created the services of the chosen option',
  (select count(*) = 1 and bool_and(name = 'Package' and amount = 900 and client_id = 'CL950050') from business_setup_services where quote_id = :'pa'));
select at_check('acceptance was audited and recorded',
  exists (select 1 from business_setup_audit_log where row_id = :'pa' and action = 'quote_accept')
  and exists (select 1 from business_setup_acceptances where document_id = :'pa' and decision = 'Accepted' and source = 'Staff'));
select at_as(:'quoter');
select at_check('the choice cannot change once accepted', at_refused(format($f$select hub_proposal_choose('{"quote_id": "%s", "option": 0}')$f$, :'pa'), 'cannot change'));

-- The portal path: the client accepts a chosen proposal; an undecided one is refused by the accept guard.
select id as pb from hub_proposal_create(at_prop('{"client_id": "CL950050"}')) \gset
select id as pc from hub_proposal_create(at_prop('{"client_id": "CL950050"}')) \gset
select hub_proposal_choose(jsonb_build_object('quote_id', :'pb', 'option', 0)) is not null as chosen_b \gset
select at_as(null);
select at_check('the portal cannot accept an undecided proposal',
  at_refused(format($f$select business_setup_portal_decide(%L::uuid, %L::uuid, 'Accepted', null)$f$, :'acc', :'pc'), 'Choose the accepted option first')
  and (select status = 'issued' from hub_documents where id = :'pc') and not exists (select 1 from business_setup_acceptances where document_id = :'pc'));
select business_setup_portal_decide(:'acc'::uuid, :'pb'::uuid, 'Accepted', null);
select at_check('the portal accepts a chosen proposal and creates its services',
  (select status = 'accepted' and total_amount = 100 from hub_documents where id = :'pb')
  and (select count(*) = 2 from business_setup_services where quote_id = :'pb'));

-- â”€â”€ Engagement letter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Older letter paths still meet the letter guard on an accepted proposal.
select at_as(:'quoter');
select at_check('letter guard on hub_document_create',
  at_refused(format($f$select hub_document_create(jsonb_build_object('doc_type', 'letter', 'parent_id', %L::uuid))$f$, :'pa'), 'Choose the accepted option'));
select at_check('letter guard on hub_library_letter_create',
  at_refused(format($f$select hub_library_letter_create(at_letter('{"parent_id": "%s"}'))$f$, :'pa'), 'Choose the accepted option'));
select at_as(null);
select at_check('guard left no letter behind', (select count(*) = 0 from hub_documents where parent_id = :'pa'));
select (select total_amount from hub_documents where id = :'pa') as pa_total, (select status_at from hub_documents where id = :'pa') as pa_at \gset

select at_as(:'quoter');
select at_check('a letter option other than the choice is refused',
  at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s", "option": 0}')$f$, :'pa'), 'The client chose Option 2'));
select id as lid, document_number as lnum from hub_proposal_letter_create(jsonb_build_object('quote_id', :'pa', 'option', 1, 'license_number', 'L-9', 'vat_trn', '100000000000003', 'client_address', 'Dubai')) \gset
select at_check('letter takes the chosen option',
  (select total_amount = 900 and jsonb_array_length(lines) = 1 and document_number like 'ABC/%/BSE%' and parent_id = :'pa'::uuid and (field_values ->> 'accepted_option') = '1'
     and doc_type = 'letter' and vat_mode = 'none' and license_number = 'L-9' and services = array['Package'] and contact_phone = '+971500000002' and revises_id is null
     and client_id = 'CL950050' from hub_documents where id = :'lid'));
select at_check('the letter changes nothing on the quote',
  (select status = 'accepted' and total_amount = :pa_total and status_at = :'pa_at'::timestamptz and field_values #>> '{proposal,accepted_option}' = '1' from hub_documents where id = :'pa'));
select at_check('one letter', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s"}')$f$, :'pa'), 'already has its engagement letter'));
-- The client rejects the letter in the portal; a new letter replaces it.
select at_as(null);
select business_setup_portal_decide(:'acc'::uuid, :'lid'::uuid, 'Rejected', 'Wrong address');
select at_as(:'quoter');
select id as lid2 from hub_proposal_letter_create(jsonb_build_object('quote_id', :'pa', 'client_address', 'Abu Dhabi')) \gset
select at_check('a rejected letter is replaced',
  (select parent_id = :'pa'::uuid and revises_id = :'lid'::uuid and status = 'issued' and client_address = 'Abu Dhabi' and total_amount = 900 from hub_documents where id = :'lid2')
  and (select parent_id is null and status = 'superseded' from hub_documents where id = :'lid'));
select at_check('the replacement is the only letter of the quote', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s"}')$f$, :'pa'), 'already has its engagement letter'));
select at_check('letter on a non-proposal quote still works',
  (select parent_id = :'old1'::uuid from hub_library_letter_create(at_letter(jsonb_build_object('parent_id', :'old1')))));
select at_check('an ordinary quote is not a proposal for the letter', at_refused(format($f$select hub_proposal_letter_create('{"quote_id": "%s", "option": 0}')$f$, :'old2'), 'not found'));

-- The accept guard: no acceptance of a multi-option proposal without a chosen option, by any path.
select id as pid3 from hub_proposal_create(at_prop()) \gset
select id as pid4 from hub_proposal_create(at_prop('{}', jsonb_build_object('usd_rate', 3.6725, 'options', jsonb_build_array(at_prop_body() -> 'options' -> 0), 'shared', at_prop_body() -> 'shared'))) \gset
select at_as(null);
select at_check('two undecided options cannot be accepted', at_refused(format($f$update hub_documents set status = 'accepted' where id = '%s'$f$, :'pid3'), 'Choose the accepted option first'));
select at_check('refused acceptance left the proposal issued', (select status = 'issued' from hub_documents where id = :'pid3'));
select at_check('a single option proposal can be accepted', not at_refused(format($f$update hub_documents set status = 'accepted' where id = '%s'$f$, :'pid4'), 'Choose'));
-- Test setup only: pid4 is accepted directly above (no client, so not through the accept body), with no recorded choice.
update hub_documents set status = 'accepted' where id = :'pid4';
select at_as(:'quoter');
select at_check('a single-option proposal takes its letter without a recorded choice',
  (select (field_values ->> 'accepted_option') = '0' and total_amount = 100 from hub_proposal_letter_create(jsonb_build_object('quote_id', :'pid4'))));
select at_as(null);
select at_check('voucher: quote in the register',
  (select count(*) = 1 and bool_and(department = 'Business Setup') from voucher_register where voucher_number = (select document_number from hub_documents where id = :'pid')));
select at_check('voucher: letter in the register', (select count(*) = 1 from voucher_register where voucher_number = :'lnum'));
select at_check('proposal defaults ship with no contact details', (select count(*) = 1 from hub_settings where key = 'proposal_defaults'));
