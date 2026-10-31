-- LOCAL TEST ONLY: runs the module's business rules as signed-in users on a throwaway cluster.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-00000000000b', 'Manager', 'member'),
  ('00000000-0000-0000-0000-00000000000c', 'Sales', 'member'),
  ('00000000-0000-0000-0000-00000000000d', 'Docs', 'member'),
  ('00000000-0000-0000-0000-00000000000e', 'Finance', 'member'),
  ('00000000-0000-0000-0000-00000000000f', 'Banker', 'member'),
  ('00000000-0000-0000-0000-000000000099', 'Outsider', 'member');
insert into public.banking_user_roles values
  ('00000000-0000-0000-0000-00000000000b', 'MANAGER'), ('00000000-0000-0000-0000-00000000000c', 'SALES_EXECUTIVE'),
  ('00000000-0000-0000-0000-00000000000d', 'DOCUMENT_EXECUTIVE'), ('00000000-0000-0000-0000-00000000000e', 'FINANCE'),
  ('00000000-0000-0000-0000-00000000000f', 'BANKING_EXECUTIVE');

create table public.t_result (n serial, name text, ok boolean, detail text);
create table public.t_ids (k text primary key, v text);
grant all on public.t_result, public.t_ids to authenticated;
grant usage on sequence public.t_result_n_seq to authenticated;

create function public.as_user(c text) returns void language sql as $$
  select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || c, false)
$$;
create function public.ok(p_name text, p_ok boolean, p_detail text default null) returns void language sql as $$
  insert into public.t_result (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail)
$$;
create function public.must_fail(p_name text, p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
    perform public.ok(p_name, false, 'no error raised');
  exception when others then
    perform public.ok(p_name, sqlerrm ilike '%' || p_like || '%', sqlerrm);
  end;
end $$;
create function public.id(p text) returns uuid language sql stable as $$ select v::uuid from public.t_ids where k = p $$;
create function public.keep(p text, v anyelement) returns void language sql as $$
  insert into public.t_ids values (p, v::text) on conflict (k) do update set v = excluded.v
$$;
grant execute on all functions in schema public to authenticated;

set role authenticated;

-- ── Access ──
select public.as_user('99');
select public.ok('outsider sees no leads', (select count(*) = 0 from public.banking_leads));
select public.must_fail('outsider cannot add a lead', $$insert into public.banking_leads (company_name) values ('X')$$, 'row-level security');
select public.must_fail('outsider cannot use dashboard', $$select public.banking_dashboard()$$, 'permission');
select public.ok('outsider has no permissions', public.banking_my_access() -> 'permissions' = '[]'::jsonb);
select public.as_user('0a');
select public.ok('CRM admin has access', (public.banking_my_access() ->> 'role') = 'ADMIN' and jsonb_array_length(public.banking_my_access() -> 'permissions') > 20);

-- ── Masters from seed ──
select public.ok('12 brief banks plus Mashreq and SIB', (select count(*) from public.banking_partners) = 14);
select public.ok('checklists unverified by default', not exists (select 1 from public.banking_checklist_templates where verification_status <> 'Unverified'));
select public.ok('standard list has 16 items', (select count(*) from public.banking_checklist_items i join public.banking_checklist_templates t on t.id = i.template_id where t.template_code = 'STANDARD') = 16);
select public.ok('ADCB list has 9 items', (select count(*) from public.banking_checklist_items i join public.banking_checklist_templates t on t.id = i.template_id where t.template_code = 'ADCB') = 9);
select public.ok('FAB list has 18 items', (select count(*) from public.banking_checklist_items i join public.banking_checklist_templates t on t.id = i.template_id where t.template_code = 'FAB') = 18);
select public.ok('default fee and Home Ejari seeded', public.banking_setting('default_service_fee')::text = '2000' and (select default_fee from public.banking_supplementary_services where service_code = 'HOME_EJARI') = 1000);

-- ── Leads, conversion, no duplicate client ──
select public.as_user('0c');
insert into public.banking_leads (company_name, contact_person, nationality, lead_source, license_number) values ('Test Trading L.L.C', 'Asha', 'Indian', 'Referral', 'LIC1');
select public.keep('lead1', (select id from public.banking_leads where company_name = 'Test Trading L.L.C'));
select public.keep('case1', (public.banking_convert_lead(public.id('lead1')) ->> 'case_id'));
insert into public.banking_leads (company_name, contact_person) values ('TEST TRADING LLC', 'Asha');
select public.keep('lead2', (select id from public.banking_leads where company_name = 'TEST TRADING LLC'));
select public.keep('conv2', (public.banking_convert_lead(public.id('lead2'))::text));
select public.ok('second lead reuses the client', (select count(*) from public.banking_clients) = 1 and (select v from public.t_ids where k = 'conv2')::jsonb ->> 'existing_client' = 'true');
select public.ok('one client has two cases', (select count(*) from public.banking_cases) = 2);
select public.must_fail('lead converts only once', format($$select public.banking_convert_lead(%L)$$, public.id('lead1')), 'already converted');
select public.must_fail('stage cannot be set directly', format($$update public.banking_cases set current_stage = 17 where id = %L$$, public.id('case1')), 'stage tracker');

-- ── KYC ──
select public.as_user('0d');
select public.keep('kyc', (select id from public.banking_kyc_profiles limit 1));
update public.banking_kyc_profiles set trade_name = 'Partial save works' where id = public.id('kyc');
select public.ok('partial KYC saved', (select completion_percent between 1 and 99 from public.banking_kyc_profiles where id = public.id('kyc')));
insert into public.banking_kyc_shareholders (kyc_profile_id, full_name, nationality, passport_number) values (public.id('kyc'), 'Partner Two', 'Russian', 'P123');
select public.ok('partner count', (select count(*) from public.banking_kyc_shareholders) = 2);
select public.as_user('0c');
select public.ok('sales cannot read passports', (select count(*) = 0 from public.banking_kyc_shareholders));
select public.ok('log masks passport', not exists (select 1 from public.banking_activity_logs where new_data ->> 'passport_number' = 'P123'));
reset role;
select public.ok('log masks passport (owner view)', not exists (select 1 from public.banking_activity_logs where new_data ->> 'passport_number' = 'P123'));
set role authenticated;

-- ── Bank options and checklist engine ──
select public.as_user('0c');
insert into public.banking_bank_recommendations (case_id, bank_id, scheme_id, internal_recommendation)
select public.id('case1'), id, null, 'Option' from public.banking_partners where bank_code in ('RAKBANK','MBANK','ADCB');
select public.keep('r_rak', (select r.id from public.banking_bank_recommendations r join public.banking_partners b on b.id = r.bank_id where b.bank_code = 'RAKBANK'));
select public.keep('r_m', (select r.id from public.banking_bank_recommendations r join public.banking_partners b on b.id = r.bank_id where b.bank_code = 'MBANK'));
select public.must_fail('selection only by function', format($$update public.banking_bank_recommendations set is_selected = true where id = %L$$, public.id('r_rak')), 'Select Bank');
select public.ok('comparison lists 3 options', jsonb_array_length(public.banking_compare(public.id('case1'))) = 3);
select public.ok('nationality gives advisory flag for review', (select bool_or((e ->> 'level') = 'Enhanced Due Diligence') from jsonb_array_elements(public.banking_case_flags(public.id('case1')) -> 'risk') e));
select public.must_fail('quote needs a selected bank', format($$select public.banking_quote_create(%L)$$, public.id('case1')), 'Select a bank');
select public.ok('RAK checklist: 3 company + 3 per partner x2', public.banking_select_bank(public.id('case1'), public.id('r_rak')) = 9);
select public.must_fail('change of bank needs a reason', format($$select public.banking_select_bank(%L, %L)$$, public.id('case1'), public.id('r_m')), 'reason');
select public.ok('M Bank falls back to standard list', public.banking_select_bank(public.id('case1'), public.id('r_m'), 'Client prefers') >= 16);
select public.as_user('0d');
select public.ok('old checklist kept, not current', (select count(*) from public.banking_case_checklists where is_current = false) = 9);
select public.ok('unknown condition is To Confirm', (select count(*) from public.banking_case_checklists where is_current and condition_state = 'To Confirm') >= 4);
update public.banking_kyc_profiles set is_free_zone = false where id = public.id('kyc');
select public.as_user('0d');
select public.ok('regenerate gives lines', public.banking_regenerate_checklist(public.id('case1')) > 0);
select public.ok('free zone false removes incumbency', not exists (select 1 from public.banking_case_checklists where is_current and condition_key = 'free_zone'));

-- ── Documents ──
select public.keep('cl', (select id from public.banking_case_checklists where is_current and requirement_label like 'Trade License%' limit 1));
select public.must_fail('cannot verify before upload', format($$select public.banking_checklist_set_status(%L, 'Verified')$$, public.id('cl')), 'Upload the document');
select public.keep('doc', public.banking_document_add_version(public.id('cl'), 'c/x/a.pdf', 'a.pdf', 'application/pdf', 10, 'sha', current_date + 100));
select public.ok('upload gives Received, not Verified', (select status from public.banking_case_checklists where id = public.id('cl')) = 'Received');
select public.as_user('0c');
select public.must_fail('sales cannot verify', format($$select public.banking_checklist_set_status(%L, 'Verified')$$, public.id('cl')), 'permission');
select public.as_user('0d');
select public.banking_checklist_set_status(public.id('cl'), 'Verified');
select public.ok('verified records who', (select verified_by is not null and verified_version = 1 from public.banking_case_checklists where id = public.id('cl')));
select public.banking_document_add_version(public.id('cl'), 'c/x/b.pdf', 'b.pdf', 'application/pdf', 10, 'sha2');
select public.ok('new version needs verifying again', (select status = 'Received' and verified_by is null from public.banking_case_checklists where id = public.id('cl')) and (select count(*) from public.banking_document_versions where document_id = public.id('doc')) = 2);
select public.banking_checklist_set_status(public.id('cl'), 'Verified');
select public.must_fail('rejecting needs remarks', format($$select public.banking_checklist_set_status(%L, 'Rejected')$$, public.id('cl')), 'Remarks');
select public.must_fail('expired document cannot be verified', format($$select public.banking_checklist_set_status(%L, 'Verified', null, current_date - 1)$$, public.id('cl')), 'expired');

-- ── Quotation pricing ──
select public.as_user('0c');
select public.keep('q', public.banking_quote_create(public.id('case1')));
select public.ok('default fee 2000', (select total_amount from public.banking_quotations where id = public.id('q')) = 2000);
select public.must_fail('only one live quote', format($$select public.banking_quote_create(%L)$$, public.id('case1')), 'live quotation');
select public.keep('he', (select id from public.banking_supplementary_services where service_code = 'HOME_EJARI'));
select public.must_fail('override without reason refused', format($$select public.banking_quote_save(%L, '{}', %L)$$, public.id('q'), jsonb_build_array(jsonb_build_object('item_type','Service Fee','description','S','unit_amount',1500,'default_amount',2000))), 'reason');
select public.banking_quote_save(public.id('q'), '{"initial_deposit_memo":5000,"minimum_balance_memo":25000}', jsonb_build_array(
  jsonb_build_object('item_type','Bank Fee','description','Bank','unit_amount',300),
  jsonb_build_object('item_type','Service Fee','description','Service','unit_amount',2000,'default_amount',2000),
  jsonb_build_object('item_type','Supplementary','description','Home Ejari','unit_amount',1000,'service_id',public.id('he')),
  jsonb_build_object('item_type','Discount','description','Disc','unit_amount',100)));
select public.ok('total = bank + service + supplementary - discount', (select total_amount from public.banking_quotations where id = public.id('q')) = 3200);
select public.ok('deposit and balance stay out of total', (select initial_deposit_memo = 5000 and total_amount < 5000 from public.banking_quotations where id = public.id('q')));
select public.ok('VAT inclusive is on AB fees only: 2900*5/105', (select vat_amount from public.banking_quotations where id = public.id('q')) = 138.10);
select public.banking_quote_save(public.id('q'), '{"vat_mode":"exclusive"}', (select jsonb_agg(jsonb_build_object('item_type',item_type,'description',description,'unit_amount',unit_amount,'service_id',service_id,'default_amount',default_amount)) from public.banking_quotation_items where quotation_id = public.id('q')));
select public.ok('VAT exclusive adds 5% of 2900', (select vat_amount = 145 and total_amount = 3345 from public.banking_quotations where id = public.id('q')));
select public.banking_quote_save(public.id('q'), '{"vat_mode":"inclusive"}', jsonb_build_array(
  jsonb_build_object('item_type','Bank Fee','description','Bank direct','unit_amount',300,'collected_through_ab',false),
  jsonb_build_object('item_type','Service Fee','description','Service','unit_amount',2000,'default_amount',2000)));
select public.ok('bank fee paid directly is a memo outside total', (select total_amount = 2000 and direct_to_bank_total = 300 from public.banking_quotations where id = public.id('q')));
select public.banking_quote_save(public.id('q'), '{}', jsonb_build_array(
  jsonb_build_object('item_type','Service Fee','description','Service','unit_amount',1000,'default_amount',2000,'override_reason','Negotiated'),
  jsonb_build_object('item_type','Supplementary','description','Home Ejari','unit_amount',1000,'service_id',public.id('he'))));
select public.ok('big fee cut waits for approval', (select status = 'Approval Required' from public.banking_quotations where id = public.id('q')));
select public.must_fail('cannot issue unapproved', format($$select public.banking_quote_action(%L, 'issue')$$, public.id('q')), 'approve');
select public.must_fail('sales cannot approve pricing', format($$select public.banking_quote_action(%L, 'approve')$$, public.id('q')), 'permission');
select public.as_user('0b');
select public.banking_quote_action(public.id('q'), 'approve', 'OK');
select public.as_user('0c');
select public.must_fail('letter needs an accepted quote', format($$select public.banking_letter_generate(%L)$$, public.id('case1')), 'permission');
select public.banking_quote_action(public.id('q'), 'issue');
select public.banking_quote_action(public.id('q'), 'send');
select public.keep('q2', public.banking_quote_revise(public.id('q'), 'Client asked'));
select public.ok('revision keeps old version', (select status from public.banking_quotations where id = public.id('q')) = 'Superseded' and (select version from public.banking_quotations where id = public.id('q2')) = 2);
select public.must_fail('history items protected from API', format($$delete from public.banking_quotation_items where quotation_id = %L$$, public.id('q')), 'permission denied');
select public.banking_quote_action(public.id('q2'), 'issue');
select public.banking_quote_action(public.id('q2'), 'accept');
select public.ok('Home Ejari made a task and tracker on accept', (select count(*) from public.banking_service_deliverables where case_id = public.id('case1')) = 1 and (select count(*) from public.banking_tasks where task_type = 'Home Ejari Issuance') = 1);
select public.ok('total 2000', (select total_amount from public.banking_quotations where id = public.id('q2')) = 2000);

-- ── Payments ──
select public.must_fail('sales cannot post payment', format($$select public.banking_payment_add(%L, current_date, 500, 'Cash')$$, public.id('case1')), 'permission');
select public.as_user('0e');
select public.must_fail('payment needs amount above zero', format($$select public.banking_payment_add(%L, current_date, 0, 'Cash')$$, public.id('case1')), 'above zero');
select public.must_fail('future payment refused', format($$select public.banking_payment_add(%L, current_date + 1, 5, 'Cash')$$, public.id('case1')), 'future');
select public.keep('p1', (public.banking_payment_add(public.id('case1'), '2026-10-01', 500, 'Bank Transfer', null, '500 BT 01/10 BT 500 24/10') ->> 'payment_id'));
select public.keep('p2', (public.banking_payment_add(public.id('case1'), '2026-10-24', 500, 'Bank Transfer') ->> 'payment_id'));
select public.ok('each payment has a receipt', (select count(*) from public.banking_receipts) = 2);
select public.ok('outstanding = total - received', (public.banking_case_finance(public.id('case1')) ->> 'outstanding')::numeric = 1000);
select public.ok('paid percent', (public.banking_case_finance(public.id('case1')) ->> 'paid_percent')::numeric = 50);
select public.must_fail('payment cannot be edited', format($$update public.banking_payments set amount = 1 where id = %L$$, public.id('p1')), 'permission denied');
reset role;
select public.must_fail('even owner cannot edit ledger', format($$update public.banking_payments set amount = 1 where id = %L$$, public.id('p1')), 'append-only');
select public.must_fail('even owner cannot delete history', $$delete from public.banking_activity_logs$$, 'append-only');
set role authenticated;
select public.keep('p3', (public.banking_payment_add(public.id('case1'), current_date, 100, 'Cash') ->> 'payment_id'));
select public.banking_payment_counter(public.id('p3'), 'Reversal', current_date, 'Keyed twice');
select public.ok('reversal nets to zero', (public.banking_case_finance(public.id('case1')) ->> 'received')::numeric = 1000);
select public.must_fail('cannot reverse twice', format($$select public.banking_payment_counter(%L, 'Reversal', current_date, 'x')$$, public.id('p3')), 'already');
select public.must_fail('refund capped', format($$select public.banking_payment_counter(%L, 'Refund', current_date, 'x', 900)$$, public.id('p1')), 'exceed');
select public.banking_payment_counter(public.id('p2'), 'Refund', current_date, 'Part refund', 200);
select public.ok('refund lowers received', (public.banking_case_finance(public.id('case1')) ->> 'received')::numeric = 800 and (public.banking_case_finance(public.id('case1')) ->> 'refunds')::numeric = 200);

-- ── Agreement and application gates ──
select public.as_user('0f');
select public.must_fail('application needs signed letter', format($$select public.banking_application_open(%L)$$, public.id('case1')), 'signed');
select public.must_fail('banker cannot override', format($$select public.banking_application_open(%L, 'Because')$$, public.id('case1')), 'permission');
select public.as_user('0b');
select public.keep('el', public.banking_letter_generate(public.id('case1')));
select public.ok('letter links accepted quote', (select quotation_id = public.id('q2') from public.banking_engagement_letters where id = public.id('el')));
select public.ok('letter snapshot has bank', (select content ->> 'bank' = 'M Bank' from public.banking_engagement_letters where id = public.id('el')));
select public.must_fail('signing needs the signed file', format($$select public.banking_letter_action(%L, 'sign')$$, public.id('el')), 'Upload');
select public.banking_letter_action(public.id('el'), 'send');
select public.banking_letter_action(public.id('el'), 'sign', 'c/el/signed.pdf', current_date, 'Asha');
select public.must_fail('signed quote cannot be revised', format($$select public.banking_quote_revise(%L, 'x')$$, public.id('q2')), 'signed');
select public.keep('app', public.banking_application_open(public.id('case1')));
select public.ok('application links signed letter', (select engagement_letter_id = public.id('el') from public.banking_applications where id = public.id('app')));
select public.must_fail('only one active application', format($$select public.banking_application_open(%L)$$, public.id('case1')), 'already');

-- ── Stage tracker ──
select public.must_fail('stage 15 blocked by unverified docs', format($$select public.banking_move_stage(%L, 15)$$, public.id('case1')), 'documents_verified');
select public.as_user('0d');
update public.banking_kyc_profiles set legal_name='T',license_number='L',license_expiry_date=current_date+90,issuing_authority='A',legal_structure='LLC',business_activity='B',registered_address='R',office_address='O',company_email='e',company_phone='p',nature_of_business='N',source_of_funds='S',expected_monthly_turnover=1,countries_of_transactions='UAE',reason_for_account='R',business_description='B' where id = public.id('kyc');
select public.as_user('0b');
select public.banking_move_stage(public.id('case1'), 14, 'Agreement signed');
select public.must_fail('moving back needs remarks', format($$select public.banking_move_stage(%L, 5)$$, public.id('case1')), 'Remarks');
select public.as_user('0c');
select public.must_fail('sales cannot override gate', format($$select public.banking_move_stage(%L, 15, null, 'just because')$$, public.id('case1')), 'workflow.override');
select public.as_user('0b');
select public.banking_move_stage(public.id('case1'), 15, null, 'Director instruction');
select public.ok('override recorded with unmet gates', (select is_override and unmet_gates is not null from public.banking_case_stage_history where to_stage = 15 and case_id = public.id('case1') limit 1));
select public.banking_move_stage(public.id('case1'), 14, 'Back to prepare');

-- ── Application status ──
select public.as_user('0f');
select public.must_fail('submission blocked by gates', format($$select public.banking_application_set_status(%L, 'Submitted to Bank')$$, public.id('app')), 'not yet met');
select public.must_fail('cannot open account before approval', format($$select public.banking_application_set_status(%L, 'Account Opened')$$, public.id('app')), 'after the bank has approved');
select public.must_fail('cannot approve before submission', format($$select public.banking_application_set_status(%L, 'Approved')$$, public.id('app')), 'with the bank');
select public.as_user('0d');
select public.banking_checklist_set_status(id, case when coalesce(i.is_information, false) then 'Verified' else 'Not Applicable' end, 'Test: not needed') from public.banking_case_checklists c left join lateral (select is_information from public.banking_document_types d where d.id = c.document_type_id) i on true where c.is_current and c.status <> 'Verified' and c.case_id = public.id('case1');
select public.as_user('0f');
select public.banking_application_update(public.id('app'), '{"form_prepared":true,"submission_method":"Digital Application"}');
select public.banking_application_set_status(public.id('app'), 'Ready for Submission');
select public.banking_application_set_status(public.id('app'), 'Submitted to Bank', 'Sent', current_date + 3);
select public.ok('submitted does not mean opened', (select outcome is null and current_stage = 15 from public.banking_cases where id = public.id('case1')));
select public.as_user('0b');
select public.must_fail('bank cannot change after submission', format($$select public.banking_select_bank(%L, %L, 'Change')$$, public.id('case1'), public.id('r_rak')), 'already with the bank');
select public.as_user('0f');
select public.banking_application_set_status(public.id('app'), 'Bank Review');
select public.must_fail('rejection needs remarks', format($$select public.banking_application_set_status(%L, 'Rejected')$$, public.id('app')), 'Remarks');
select public.banking_application_set_status(public.id('app'), 'Approved');
select public.ok('approved is not opened', (select status = 'Approved' from public.banking_applications where id = public.id('app')) and (select current_stage = 17 from public.banking_cases where id = public.id('case1')));
select public.banking_application_set_status(public.id('app'), 'Account Opened');
select public.ok('opened completes the case', (select current_stage = 18 and outcome = 'Approved' from public.banking_cases where id = public.id('case1')));
select public.ok('status history complete', (select count(*) from public.banking_application_status_history where application_id = public.id('app')) = 6);

-- ── Excel import ──
select public.as_user('0b');
insert into public.banking_excel_imports (file_name, sheets) values ('Banking Working sheet.xlsx', '{Monthly Bank Account}');
select public.keep('imp', (select id from public.banking_excel_imports));
insert into public.banking_excel_import_rows (import_id, source_sheet, source_row, raw, mapped, cell_colour, suggested_status, confidence, duplicate_key, payment_note, decision) values
 (public.id('imp'), 'Monthly Bank Account', 4, '{"NAME":"Old Co LLC"}', '{"company":"Old Co LLC","bank_raw":"RAK","nationality":"Indian","fee":1600,"rm_fee":500,"status_raw":"APPROVED","lead_date":"2024-08-01","referrer":"Bharat"}', 'FF08EC4F', 'Approved', 'High', 'OLD|RAK|2024-08', '500 BT 01/10 BT 500 24/10', 'Approved'),
 (public.id('imp'), 'Monthly Bank Account', 5, '{"NAME":"Old Co LLC"}', '{"company":"Old Co LLC","bank_raw":"RAK","status_raw":"APPROVED","lead_date":"2024-08-01"}', null, 'Approved', 'High', 'OLD|RAK|2024-08', null, 'Approved'),
 (public.id('imp'), 'Monthly Bank Account', 6, '{"NAME":"Other Co"}', '{"company":"Other Co","bank_raw":"POS MACHINE","status_raw":"WIP"}', null, 'Document Collection', 'Low', 'OTHER|POS|', null, 'Approved'),
 (public.id('imp'), 'Monthly Bank Account', 7, '{"NAME":"Red Co"}', '{"company":"Red Co","bank_raw":"ENBD","status_raw":"WIP","home_ejari":true}', 'FFFF0000', null, 'Low', 'RED|ENBD|', null, 'Approved');
select public.ok('import commit counts', (public.banking_import_commit(public.id('imp')) ->> 'committed')::int = 1);
select public.ok('duplicate row flagged, not created', (select error like '%Already imported%' from public.banking_excel_import_rows where source_row = 5));
select public.ok('unknown bank flagged', (select error like '%Bank not recognised%' from public.banking_excel_import_rows where source_row = 6));
select public.ok('red row without status waits for a person', (select error like '%Choose a status%' from public.banking_excel_import_rows where source_row = 7));
select public.ok('imported case is historical with source row', (select c.is_historical and l.source_row = 4 from public.banking_cases c join public.banking_leads l on l.id = c.lead_id where l.source_sheet = 'Monthly Bank Account'));
select public.keep('row4', (select id from public.banking_excel_import_rows where source_row = 4));
select public.ok('payments not created without review', (select count(*) from public.banking_payments where import_row_id = public.id('row4')) = 0);
select public.as_user('0a');
select public.must_fail('payment needs a date', format($$select public.banking_import_post_payments(%L, %L)$$, public.id('row4'), '[{"amount":500}]'), 'date');
select public.ok('reviewed note posts separate payments', public.banking_import_post_payments(public.id('row4'), '[{"amount":500,"date":"2024-10-01","method":"Bank Transfer"},{"amount":500,"date":"2024-10-24","method":"Bank Transfer"}]') = 2);
select public.ok('outstanding on imported row', (public.banking_case_finance((select case_id from public.banking_excel_import_rows where id = public.id('row4'))) ->> 'outstanding')::numeric = 600);
select public.as_user('0c');
select public.ok('commission hidden from sales', (select count(*) = 0 from public.banking_commissions));
select public.as_user('0e');
select public.ok('commission visible to finance', (select count(*) = 1 from public.banking_commissions));

-- ── Guided flow additions ──
select public.as_user('0b');
select public.keep('case3', public.banking_new_case((select client_id from public.banking_cases where id = public.id('case1')), null, 'New', 'Business', null, 4));
select public.ok('catalogue lists banks with plans', (select count(*) from jsonb_array_elements(public.banking_plan_catalogue(public.id('case3')))) = 14 and exists (select 1 from jsonb_array_elements(public.banking_plan_catalogue(public.id('case3'))) e where jsonb_array_length(e -> 'plans') > 0));
select public.ok('choose plan creates option and checklist', public.banking_choose_plan(public.id('case3'), (select id from public.banking_partners where bank_code = 'ADCB'), (select s.id from public.banking_schemes s join public.banking_partners b on b.id = s.bank_id where b.bank_code = 'ADCB' limit 1)) > 0);
select public.as_user('0d');
select public.keep('kdoc', public.banking_kyc_add_document((select client_id from public.banking_cases where id = public.id('case3')), 'MOA', null, 'x/y.pdf', 'y.pdf', 'application/pdf', 1, 'z'));
select public.ok('checklist reuses KYC upload as Received', public.banking_regenerate_checklist(public.id('case3')) > 0);
select public.ok('reused file still needs verifying', (select status = 'Received' and verified_by is null from public.banking_case_checklists where case_id = public.id('case3') and is_current and document_id = public.id('kdoc')));
select public.as_user('0c');
select public.must_fail('sales cannot add KYC file', format($$select public.banking_kyc_add_document(%L, 'MOA', null, 'a', 'b', 'c', 1, 'd')$$, (select client_id from public.banking_cases where id = public.id('case3'))), 'permission');

-- ── Assistant, dashboard, reports ──
select public.as_user('0b');
select public.ok('assistant queues, changes no status', public.banking_ai_refresh(public.id('case1')) >= 0 and (select status = 'Account Opened' from public.banking_applications where id = public.id('app')));
select public.ok('dashboard counts from records', (public.banking_dashboard() -> 'cards' ->> 'approved')::int = 2);
select public.ok('dashboard finance for manager', (public.banking_dashboard() -> 'finance' ->> 'refunds')::numeric = 200);
select public.as_user('0c');
select public.ok('dashboard hides finance from sales', public.banking_dashboard() -> 'finance' = 'null'::jsonb);
select public.must_fail('finance report refused for sales', $$select public.banking_report('ab_revenue')$$, 'permission');
select public.as_user('0a');
select public.ok('step counts add up to all cases', (select sum((e ->> 'total')::int) from jsonb_array_elements(public.banking_dashboard() -> 'charts' -> 'by_step') e) = (select count(*) from public.banking_cases));
select public.ok('every report runs', (select bool_and(jsonb_typeof(public.banking_report(n)) = 'array') from unnest(array['leads_received','lead_sources','conversion_rate','lost_leads','employee_performance','quotations_issued','quotation_conversion','applications_by_bank','applications_by_scheme','under_process','accounts_opened','rejected','returned','approval_rate','average_processing','quotation_value','bank_fees','ab_revenue','supplementary_revenue','payments_received','outstanding','refunds','pending_documents','overdue_followups','pending_agreements','pending_appointments','awaiting_bank','cases_by_employee']) n));
select public.must_fail('unknown report refused', $$select public.banking_report('nope')$$, 'Unknown report');
select public.ok('case list', (public.banking_case_list() ->> 'total')::int = 3);
select public.ok('timeline has entries', jsonb_array_length(public.banking_case_timeline(public.id('case1'))) > 5);
select public.ok('activity log populated', (select count(*) > 20 from public.banking_activity_logs));

reset role;
\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
