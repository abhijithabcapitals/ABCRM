-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, after 015 and 018 and before rollback/015_018_rollback.sql. Rows only phase 2 can make.
insert into public.business_setup_signed_quotes (quote_id, storage_path, source, status)
  select id, 'staff/CL990015/signed.pdf', 'Staff', 'Refused' from public.hub_documents where document_number = 'RB-015-Q';
-- An advance: a payment on the case, with no quote.
insert into public.business_setup_payments (client_id, case_id, paid_on, amount, type, note)
  select 'CL990015', id, current_date, 70, 'Payment', 'rollback-015-advance' from public.business_setup_cases where lead_name = 'rollback-015';
-- A hand-recorded invoice on the case.
insert into public.business_setup_invoices (client_id, invoice_number, issued_on, amount, source, case_id)
  select 'CL990015', 'RB-015', current_date, 10, 'manual', id from public.business_setup_cases where lead_name = 'rollback-015';
-- A fee item with no amount and a 0% rate.
insert into public.business_setup_fee_items (grp, name, default_amount, vat_rate, sort_order) values ('RB015', 'Empty amount', null, 0, 1);
-- Cases at the new stages (016): they must map back to Services, Assignment and Completed.
insert into public.business_setup_cases (stage, lead_name) values ('Onboarding', 'rollback-016-onboarding'), ('Pipeline', 'rollback-016-pipeline'), ('Completion', 'rollback-016-completion');
