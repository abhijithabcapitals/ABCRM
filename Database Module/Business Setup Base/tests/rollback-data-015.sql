-- LOCAL TEST ONLY. Run by run-local.sh with ROLLBACK_TEST=1, after 015 and 018 and before rollback/015_018_rollback.sql. Rows only phase 2 can make.
insert into public.business_setup_signed_quotes (quote_id, storage_path, source, status)
  select id, 'staff/CL990015/signed.pdf', 'Staff', 'Refused' from public.hub_documents where document_number = 'RB-015-Q';
-- An acceptance row (016) and a login-sync trigger target: both go with the rollback.
insert into public.business_setup_acceptances (document_id, kind, revision, decision, source, signed_quote_id)
  select q.id, 'Quote', 0, 'Accepted', 'Staff', s.id from public.hub_documents q join public.business_setup_signed_quotes s on s.quote_id = q.id where q.document_number = 'RB-015-Q' limit 1;
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
-- A login and a payment claim on the invoice above (016, 018): the claim table goes with the rollback.
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, email) values ('CL990015', 'RB', 'rb.portal015', 'x', 'rb@x.ae');
insert into public.business_setup_payment_claims (case_id, account_id, invoice_id, amount, paid_on)
  select i.case_id, a.id, i.id, 5, current_date from public.business_setup_invoices i, public.client_portal_accounts a where i.invoice_number = 'RB-015' and a.username = 'rb.portal015';
