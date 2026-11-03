-- LOCAL TEST ONLY: the client portal read layer (client_portal_me, gallery path, admin list) on a throwaway cluster.
-- Prints FAIL lines and a summary. Run through tests/run-local.sh.
\set QUIET on
\pset tuples_only on
\pset format unaligned

create table public.t_result (n serial, name text, ok boolean, detail text);
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
-- the client's view of one case, by case reference
create function public.acc(p_account uuid, p_ref text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.client_portal_me(p_account) -> 'accounts') e where e ->> 'case_ref' = p_ref
$$;
-- one gallery card by id
create function public.card(p_account uuid, p_id text) returns jsonb language sql stable as $$
  select g from jsonb_array_elements(public.client_portal_me(p_account) -> 'gallery') g where g ->> 'id' = p_id
$$;
create function public.svc(p_account uuid, p_ref text) returns jsonb language sql stable as $$
  select e from jsonb_array_elements(public.client_portal_me(p_account) -> 'banking_services') e where e ->> 'case_ref' = p_ref
$$;
grant all on public.t_result to authenticated, anon, service_role;
grant usage on sequence public.t_result_n_seq to authenticated, anon, service_role;
grant execute on function public.ok(text, boolean, text), public.must_fail(text, text, text), public.acc(uuid, text), public.card(uuid, text), public.svc(uuid, text) to authenticated, anon, service_role;

-- ── seed: two clients, each with KYC (incl. fields a client must never see), a login, cases and accepted quotations ──
insert into public.profiles (id, full_name, role) values
  ('00000000-0000-0000-0000-00000000000a', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-000000000099', 'Staff Person', 'member');
insert into public.banking_partners (bank_code, bank_name) values ('TB1', 'Test Bank One'), ('TB2', 'Test Bank Two');
insert into public.banking_document_types (doc_code, doc_name, is_sensitive) values ('T_LIC', 'Trade licence', false), ('T_PASS', 'Partner passport', true);

insert into public.banking_clients (id, display_name, license_number, client_master_id) values
  ('a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'LIC-A', 'CL000901'),
  ('b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'LIC-B', null);
insert into public.client_master (client_id, legal_name, data) values
  ('CL000901', 'Alpha Trading LLC', jsonb_build_object('Client Legal Name', 'Alpha Trading LLC', 'Trade Name', 'Alpha', 'VAT Registered', 'Yes', 'TRN', '100000000000003',
     'VAT Filing Frequency', 'Quarterly', 'VAT Tax Period', 'Jan-Mar', 'Corporate Tax Registered', 'Yes', 'CT Registration Number', '200000000000003',
     'Financial Year End', '31/12/2026', 'CT Tax Period', '01/07/2025 - 30/06/2026', 'Risk Level', 'High', 'Risk Reason', 'internal reason', 'Tax Specialist', 'Some Staff', 'Account Manager', 'Other Staff',
     'Services Provided', 'Business Banking', 'Office Address', 'Office 1', 'General Email', 'master@alpha.test', 'Onboarding Completion %', '60%')),
  ('CL000902', 'Gamma Master Only', jsonb_build_object('Client Legal Name', 'Gamma Master Only', 'Trade License Number', 'LIC-G', 'General Email', 'g@gamma.test', 'Onboarding Completion %', '40%'));
insert into public.banking_kyc_profiles (client_id, legal_name, trade_name, license_number, license_issue_date, license_expiry_date, office_address, company_email, company_phone,
    source_of_funds, annual_turnover, expected_monthly_turnover, nature_of_business, reason_for_account) values
  ('a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'Alpha', 'LIC-A', '2024-01-02', '2027-01-01', 'Office 1', 'a@alpha.test', '0501',
    'SECRET-SOF', 123456789, 987654, 'SECRET-NATURE', 'SECRET-REASON'),
  ('b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'Beta', 'LIC-B', null, null, null, 'b@beta.test', null, 'B-SOF', 5, 5, null, null);

insert into public.client_portal_accounts (id, banking_client_id, display_name, username, password_hash) values
  ('aa000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-00000000000a', 'Alpha Trading LLC', 'alpha.user', 'x'),
  ('bb000000-0000-0000-0000-0000000000bb', 'b0000000-0000-0000-0000-00000000000b', 'Beta Services LLC', 'beta.user', 'x'),
  ('cc000000-0000-0000-0000-0000000000cc', null, 'Empty Client', 'empty.user', 'x'),
  ('dd000000-0000-0000-0000-0000000000dd', null, 'Gamma Master Only', 'gamma.user', 'x');
update public.client_portal_accounts set client_master_id = 'CL000902' where id = 'dd000000-0000-0000-0000-0000000000dd';

-- Alpha: OPEN (stage 8, bank One), OWN (approved, money), HIST (historical, no payments), IMPQ (imported quotation, no payments),
-- IMPP (imported quotation with a payment), SUP (superseded versions), NOQ (no quotation, one payment).
insert into public.banking_cases (id, case_ref, client_id, current_stage, outcome, is_historical, account_kind) values
  ('c1000000-0000-0000-0000-000000000001', 'T-OPEN', 'a0000000-0000-0000-0000-00000000000a', 8, null, false, 'Business'),
  ('c1000000-0000-0000-0000-000000000002', 'T-OWN',  'a0000000-0000-0000-0000-00000000000a', 17, 'Approved', false, 'Business'),
  ('c1000000-0000-0000-0000-000000000003', 'T-HIST', 'a0000000-0000-0000-0000-00000000000a', 17, 'Approved', true, 'Business'),
  ('c1000000-0000-0000-0000-000000000004', 'T-IMPQ', 'a0000000-0000-0000-0000-00000000000a', 5, null, false, 'Business'),
  ('c1000000-0000-0000-0000-000000000005', 'T-IMPP', 'a0000000-0000-0000-0000-00000000000a', 5, null, false, 'Business'),
  ('c1000000-0000-0000-0000-000000000006', 'T-SUP',  'a0000000-0000-0000-0000-00000000000a', 5, null, false, 'Business'),
  ('c1000000-0000-0000-0000-000000000007', 'T-NOQ',  'a0000000-0000-0000-0000-00000000000a', 3, null, false, 'Business'),
  ('c2000000-0000-0000-0000-000000000001', 'T-BETA', 'b0000000-0000-0000-0000-00000000000b', 4, null, false, 'Business');
set banking.internal = '1';  -- Banking Base only lets Select Bank set is_selected
insert into public.banking_bank_recommendations (case_id, bank_id, is_selected)
  select 'c1000000-0000-0000-0000-000000000001', id, true from public.banking_partners where bank_code = 'TB1';
insert into public.banking_bank_recommendations (case_id, bank_id, is_selected)
  select 'c1000000-0000-0000-0000-000000000002', id, true from public.banking_partners where bank_code = 'TB2';
reset banking.internal;

insert into public.banking_quotations (id, case_id, version, status, total_amount, direct_to_bank_total, is_imported) values
  ('e1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 1, 'Accepted', 1000, 200, false),
  ('e1000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000003', 1, 'Accepted', 777, 55, false),
  ('e1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000004', 1, 'Accepted', 888, 66, true),
  ('e1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 1, 'Accepted', 500, 0, true),
  ('e1000000-0000-0000-0000-000000000061', 'c1000000-0000-0000-0000-000000000006', 1, 'Superseded', 800, 0, false),
  ('e1000000-0000-0000-0000-000000000062', 'c1000000-0000-0000-0000-000000000006', 2, 'Accepted', 1200, 0, false),
  ('e2000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001', 1, 'Accepted', 3000, 0, false);

insert into public.banking_payments (id, case_id, quotation_id, txn_type, payment_date, amount, payment_method, reference_note, remarks, received_by_text) values
  ('f1000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'Payment', '2026-10-01', 600, 'Bank transfer', 'NOTE-HIDDEN', 'REMARK-HIDDEN', 'RECEIVER-HIDDEN'),
  ('f1000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'e1000000-0000-0000-0000-000000000002', 'Refund',  '2026-10-05', 100, 'Bank transfer', null, null, null),
  ('f1000000-0000-0000-0000-000000000005', 'c1000000-0000-0000-0000-000000000005', 'e1000000-0000-0000-0000-000000000005', 'Payment', '2026-10-02', 100, 'Cash', null, null, null),
  ('f1000000-0000-0000-0000-000000000007', 'c1000000-0000-0000-0000-000000000007', null, 'Payment', '2026-10-03', 250, 'Cash', null, null, null);
insert into public.banking_receipts (payment_id, receipt_number) values ('f1000000-0000-0000-0000-000000000001', 'RC-TEST-1');

insert into public.banking_client_accounts (client_id, case_id, bank_id, account_number, iban, account_name, opened_on, remarks)
  select 'a0000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', id, '0123456789', 'AE070331234567890123456', 'Alpha Trading LLC', '2026-09-20', 'REMARK-ACC'
    from public.banking_partners where bank_code = 'TB2';

-- documents: own plain (two versions), own sensitive, deleted, Beta's, plus generated ones
insert into public.banking_documents (id, client_id, document_type_id, title, current_version, deleted_at)
  select v.id::uuid, v.cl::uuid, t.id, v.title, 1, v.del::timestamptz
    from (values
      ('d1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-00000000000a', 'T_LIC',  'Alpha licence', null),
      ('d1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-00000000000a', 'T_PASS', 'Jane Doe scan', null),
      ('d1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-00000000000a', 'T_LIC',  'Old licence', '2026-10-10'),
      ('d2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-00000000000b', 'T_LIC',  'Beta licence', null)) v(id, cl, code, title, del)
    join public.banking_document_types t on t.doc_code = v.code;
insert into public.banking_document_versions (document_id, version, storage_path, file_name) values
  ('d1000000-0000-0000-0000-000000000001', 1, 'alpha/old.pdf', 'licence-old.pdf'),
  ('d1000000-0000-0000-0000-000000000001', 2, 'alpha/licence.pdf', 'licence.pdf'),
  ('d1000000-0000-0000-0000-000000000002', 1, 'alpha/passport.pdf', 'jane-doe-id-9931.pdf'),
  ('d1000000-0000-0000-0000-000000000003', 1, 'alpha/deleted.pdf', 'deleted.pdf'),
  ('d2000000-0000-0000-0000-000000000001', 1, 'beta/lic.pdf', 'beta-lic.pdf');
update public.banking_documents set current_version = 2 where id = 'd1000000-0000-0000-0000-000000000001';
-- storage_path is NOT NULL in Banking Base, so "no path" is the empty string here; the view treats null and '' alike
insert into public.banking_generated_documents (id, case_id, kind, quotation_id, document_number, file_name, storage_path) values
  ('9e000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000002', 'quote', 'e1000000-0000-0000-0000-000000000002', 'QT-1', 'quote.pdf', 'alpha/quote.pdf'),
  ('9e000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002', 'letter', null, 'EL-1', 'letter.pdf', '');
-- generated files of quotations and letters that have not gone out, or were withdrawn, next to ones that have
insert into public.banking_quotations (id, case_id, version, status, total_amount, direct_to_bank_total, is_imported) values
  ('e1000000-0000-0000-0000-000000000063', 'c1000000-0000-0000-0000-000000000006', 3, 'Draft', 1, 0, false),
  ('e1000000-0000-0000-0000-000000000064', 'c1000000-0000-0000-0000-000000000006', 4, 'Approval Required', 1, 0, false),
  ('e1000000-0000-0000-0000-000000000065', 'c1000000-0000-0000-0000-000000000006', 5, 'Issued', 1, 0, false);
insert into public.banking_engagement_letters (id, case_id, quotation_id, version, status) values
  ('e3000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000062', 1, 'Draft'),
  ('e3000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000062', 2, 'Cancelled'),
  ('e3000000-0000-0000-0000-000000000003', 'c1000000-0000-0000-0000-000000000006', 'e1000000-0000-0000-0000-000000000062', 3, 'Sent to Client');
insert into public.banking_generated_documents (id, case_id, kind, quotation_id, letter_id, document_number, file_name, storage_path) values
  ('9e000000-0000-0000-0000-000000000011', 'c1000000-0000-0000-0000-000000000006', 'quote', 'e1000000-0000-0000-0000-000000000063', null, 'QT-DRAFT', 'quote-draft.pdf', 'alpha/quote-draft.pdf'),
  ('9e000000-0000-0000-0000-000000000012', 'c1000000-0000-0000-0000-000000000006', 'quote', 'e1000000-0000-0000-0000-000000000064', null, 'QT-APPROVAL', 'quote-approval.pdf', 'alpha/quote-approval.pdf'),
  ('9e000000-0000-0000-0000-000000000013', 'c1000000-0000-0000-0000-000000000006', 'quote', 'e1000000-0000-0000-0000-000000000065', null, 'QT-ISSUED', 'quote-issued.pdf', 'alpha/quote-issued.pdf'),
  ('9e000000-0000-0000-0000-000000000021', 'c1000000-0000-0000-0000-000000000006', 'letter', null, 'e3000000-0000-0000-0000-000000000001', 'EL-DRAFT', 'letter-draft.pdf', 'alpha/letter-draft.pdf'),
  ('9e000000-0000-0000-0000-000000000022', 'c1000000-0000-0000-0000-000000000006', 'letter', null, 'e3000000-0000-0000-0000-000000000002', 'EL-CANCELLED', 'letter-cancelled.pdf', 'alpha/letter-cancelled.pdf'),
  ('9e000000-0000-0000-0000-000000000023', 'c1000000-0000-0000-0000-000000000006', 'letter', null, 'e3000000-0000-0000-0000-000000000003', 'EL-SENT', 'letter-sent.pdf', 'alpha/letter-sent.pdf');

-- ── case in stage 8, record keys, nothing internal ──
select public.ok('open case: stage 8 and bank name',
  (select e ->> 'current_stage' = '8' and e ->> 'bank' = 'Test Bank One' from (select public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-OPEN') e) x));
select public.ok('banking_services lists every case of the client', (select jsonb_array_length(public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'banking_services') = 7));
select public.ok('record has the four missing keys',
  (select r ? 'license_issue_date' and r ? 'office_address' and r ? 'company_email' and r ? 'company_phone'
      and r ->> 'license_issue_date' = '2024-01-02' and r ->> 'office_address' = 'Office 1' and r ->> 'company_email' = 'a@alpha.test'
   from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'record' r) x));
select public.ok('existing keys kept',
  (select m ?& array['username', 'display_name', 'record', 'services', 'master_services', 'documents'] and m -> 'record' ? 'email' and m -> 'record' ? 'phone'
   from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') m) x));
select public.ok('has_master true when a Client Master row exists', (select (public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') ->> 'has_master')::boolean));
select public.ok('has_master false without one', (select not (public.client_portal_me('bb000000-0000-0000-0000-0000000000bb') ->> 'has_master')::boolean));
select public.ok('no risk or source-of-funds text anywhere in the output',
  (select t !~* 'risk|source_of_funds|source of funds|SECRET|turnover|Tax Specialist|Account Manager|Some Staff|Other Staff|internal reason'
   from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')::text t) x),
  (select left(public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')::text, 400)));

-- ── amounts ──
select public.ok('own case: payable 1000, paid 500, balance 500, direct 200, not hidden',
  (select (e ->> 'payable')::numeric = 1000 and (e ->> 'paid')::numeric = 500 and (e ->> 'balance')::numeric = 500
      and (e ->> 'direct_to_bank')::numeric = 200 and e ->> 'hidden' = 'false' from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-OWN') e) x));
select public.ok('ledger lines: two, with receipt number on the first',
  (select jsonb_array_length(e -> 'lines') = 2 and e -> 'lines' -> 0 ->> 'receipt_number' = 'RC-TEST-1' and (e -> 'lines' -> 0 ->> 'amount')::numeric = 600
      and (e -> 'lines' -> 1 ->> 'amount')::numeric = -100 and e -> 'lines' -> 0 ?& array['payment_date', 'payment_ref', 'txn_type', 'amount', 'payment_method', 'receipt_number']
   from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-OWN') e) x));
select public.ok('historical, no payments: hidden, every amount and the lines are null',
  (select e ->> 'hidden' = 'true' and e -> 'payable' = 'null'::jsonb and e -> 'paid' = 'null'::jsonb and e -> 'balance' = 'null'::jsonb
      and e -> 'lines' = 'null'::jsonb and e -> 'direct_to_bank' = 'null'::jsonb from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-HIST') e) x),
  (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-HIST')::text));
select public.ok('hidden case leaks no amount from its quotation', (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-HIST')::text !~ '777|55'));
select public.ok('imported quotation, no payments: hidden',
  (select e ->> 'hidden' = 'true' and e -> 'payable' = 'null'::jsonb from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-IMPQ') e) x));
select public.ok('imported quotation with a payment: not hidden',
  (select e ->> 'hidden' = 'false' and (e ->> 'payable')::numeric = 500 and (e ->> 'paid')::numeric = 100 and (e ->> 'balance')::numeric = 400
   from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-IMPP') e) x));
select public.ok('payable uses the latest Accepted version',
  (select (e ->> 'payable')::numeric = 1200 and (e ->> 'paid')::numeric = 0 from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-SUP') e) x));
select public.ok('no quotation: payable and balance null, paid shown',
  (select e -> 'payable' = 'null'::jsonb and e -> 'balance' = 'null'::jsonb and (e ->> 'paid')::numeric = 250 and e ->> 'hidden' = 'false'
   from (select public.acc('aa000000-0000-0000-0000-0000000000aa', 'T-NOQ') e) x));
select public.ok('ledger text holds no internal column or value',
  (select t !~* 'remarks|received_by|reference_note|import_row_id|NOTE-HIDDEN|REMARK-HIDDEN|RECEIVER-HIDDEN|commission|approved'
   from (select (public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'accounts')::text t) x));

-- ── the opened account ──
select public.ok('IBAN masked to the last four',
  (select e -> 'account' ->> 'iban_masked' = repeat(chr(8226), 4) || '3456' and e -> 'account' ->> 'bank' = 'Test Bank Two' and e -> 'account' ->> 'account_name' = 'Alpha Trading LLC' and e -> 'account' ->> 'opened_on' = '2026-09-20'
   from (select public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-OWN') e) x),
  (select public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-OWN')::text));
select public.ok('no full IBAN or account number anywhere',
  (select t !~ 'AE070331234567890123456|0123456789|REMARK-ACC' from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')::text t) x));
select public.ok('banking_services carries is_historical',
  (select public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-HIST') -> 'is_historical' = 'true'::jsonb and public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-OPEN') -> 'is_historical' = 'false'::jsonb));
select public.ok('open case has no account', (select e -> 'account' = 'null'::jsonb from (select public.svc('aa000000-0000-0000-0000-0000000000aa', 'T-OPEN') e) x));

-- ── filing record ──
select public.ok('filing_record: tax keys, Client ID, legal name; no staff names or risk',
  (select f ->> 'TRN' = '100000000000003' and f ->> 'Client ID' = 'CL000901' and f ->> 'client_id' = 'CL000901' and f ->> 'Client Legal Name' = 'Alpha Trading LLC'
      and f ->> 'CT Registration Number' = '200000000000003' and f ->> 'Financial Year End' = '31/12/2026' and f ->> 'CT Tax Period' = '01/07/2025 - 30/06/2026' and not (f ? 'Risk Level') and not (f ? 'Tax Specialist') and not (f ? 'Account Manager')
   from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'filing_record' f) x));
select public.ok('filing_record null without a Client Master row', (select public.client_portal_me('bb000000-0000-0000-0000-0000000000bb') -> 'filing_record' = 'null'::jsonb));

-- ── gallery ──
select public.ok('own plain doc opens and shows the latest version file',
  (select g ->> 'can_open' = 'true' and g ->> 'sensitive' = 'false' and g ->> 'source' = 'kyc' and g ->> 'file_name' = 'licence.pdf' and g ->> 'doc_type' = 'Trade licence'
   from (select public.card('aa000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-000000000001') g) x));
select public.ok('path function returns the latest storage_path and file name',
  (select p ->> 'storage_path' = 'alpha/licence.pdf' and p ->> 'file_name' = 'licence.pdf' from (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd1000000-0000-0000-0000-000000000001') p) x));
select public.ok('sensitive doc: flagged, cannot open',
  (select g ->> 'sensitive' = 'true' and g ->> 'can_open' = 'false' from (select public.card('aa000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-000000000002') g) x));
select public.ok('sensitive doc: title and file name are null, the type stays',
  (select g -> 'title' = 'null'::jsonb and g -> 'file_name' = 'null'::jsonb and g ->> 'doc_type' = 'Partner passport' from (select public.card('aa000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-000000000002') g) x));
select public.ok('sensitive doc: the name appears nowhere in the whole output',
  (select t !~* 'jane|doe|9931' from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')::text t) x));
select public.ok('sensitive doc: path function returns null', (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd1000000-0000-0000-0000-000000000002') is null));
select public.ok('deleted doc absent from gallery', (select public.card('aa000000-0000-0000-0000-0000000000aa', 'd1000000-0000-0000-0000-000000000003') is null));
select public.ok('deleted doc: path function returns null', (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd1000000-0000-0000-0000-000000000003') is null));
select public.ok('Beta doc: path null for Alpha, set for Beta',
  (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd2000000-0000-0000-0000-000000000001') is null
      and public.client_portal_gallery_path('bb000000-0000-0000-0000-0000000000bb', 'kyc', 'd2000000-0000-0000-0000-000000000001') ->> 'storage_path' = 'beta/lic.pdf'));
select public.ok('Beta doc absent from Alpha gallery', (select public.card('aa000000-0000-0000-0000-0000000000aa', 'd2000000-0000-0000-0000-000000000001') is null));
select public.ok('Alpha''s accounts and generated documents are absent from Beta''s output',
  (select jsonb_array_length(m -> 'accounts') = 1 and m -> 'accounts' -> 0 ->> 'case_ref' = 'T-BETA'
      and not exists (select 1 from jsonb_array_elements(m -> 'gallery') g where g ->> 'source' = 'generated')
      and m::text !~ 'T-OWN|T-OPEN|RC-TEST-1|QT-|EL-|quote|letter'
   from (select public.client_portal_me('bb000000-0000-0000-0000-0000000000bb') m) x),
  (select public.client_portal_me('bb000000-0000-0000-0000-0000000000bb')::text));
select public.ok('generated doc with a path opens',
  (select g ->> 'source' = 'generated' and g ->> 'can_open' = 'true' from (select public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000001') g) x));
select public.ok('generated doc path function works, and refuses another client',
  (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000001') ->> 'storage_path' = 'alpha/quote.pdf'
      and public.client_portal_gallery_path('bb000000-0000-0000-0000-0000000000bb', 'generated', '9e000000-0000-0000-0000-000000000001') is null));
select public.ok('generated doc without a path cannot open, path function null',
  (select g ->> 'can_open' = 'false' from (select public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000002') g) x)
  and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000002') is null);
select public.ok('generated: draft and approval-required quotations absent from the gallery',
  (select public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000011') is null and public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000012') is null));
select public.ok('generated: draft and approval-required quotations have no path',
  (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000011') is null
      and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000012') is null));
select public.ok('generated: draft and cancelled letters absent from the gallery',
  (select public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000021') is null and public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000022') is null));
select public.ok('generated: draft and cancelled letters have no path',
  (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000021') is null
      and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000022') is null));
select public.ok('generated: no unissued number or file name anywhere in the output',
  (select t !~ 'QT-DRAFT|QT-APPROVAL|EL-DRAFT|EL-CANCELLED|quote-draft|quote-approval|letter-draft|letter-cancelled' from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')::text t) x));
select public.ok('generated: an issued quotation and a sent letter appear and open',
  (select public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000013') ->> 'can_open' = 'true' and public.card('aa000000-0000-0000-0000-0000000000aa', '9e000000-0000-0000-0000-000000000023') ->> 'can_open' = 'true'
      and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000013') ->> 'storage_path' = 'alpha/quote-issued.pdf'
      and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'generated', '9e000000-0000-0000-0000-000000000023') ->> 'storage_path' = 'alpha/letter-sent.pdf'));
select public.ok('unknown source returns null', (select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'other', 'd1000000-0000-0000-0000-000000000001') is null));
select public.ok('gallery output holds no storage path',
  (select t !~ 'alpha/|beta/|storage_path' from (select (public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'gallery')::text t) x));

-- ── changes: latest non-superseded request per field ──
insert into public.client_portal_change_requests (account_id, field_key, old_value, new_value, status, review_note, created_at) values
  ('aa000000-0000-0000-0000-0000000000aa', 'trade_name', 'Alpha', 'Alpha One', 'superseded', null, now() - interval '3 days'),
  ('aa000000-0000-0000-0000-0000000000aa', 'trade_name', 'Alpha', 'Alpha Two', 'rejected', 'Please send the licence', now() - interval '2 days'),
  ('aa000000-0000-0000-0000-0000000000aa', 'company_phone', '0501', '0502', 'pending', 'internal-only note', now() - interval '1 day'),
  ('aa000000-0000-0000-0000-0000000000aa', 'website', null, 'a.test', 'superseded', null, now()),
  ('bb000000-0000-0000-0000-0000000000bb', 'trade_name', 'Beta', 'Beta Two', 'pending', null, now());
select public.ok('changes: one per field, superseded skipped, own account only',
  (select jsonb_array_length(c) = 2 and c @> '[{"field_key":"trade_name","new_value":"Alpha Two","status":"rejected","review_note":"Please send the licence"}]'
      and c @> '[{"field_key":"company_phone","new_value":"0502","status":"pending"}]' and not (c::text like '%website%') and not (c::text like '%Beta Two%')
   from (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'changes' c) x),
  (select (public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'changes')::text));
select public.ok('changes: a note is shown only for a rejected request', (select (public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') -> 'changes')::text not like '%internal-only%'));
select public.must_fail('only one open request per field', $$insert into public.client_portal_change_requests (account_id, field_key, new_value) values ('aa000000-0000-0000-0000-0000000000aa', 'company_phone', 'x')$$, 'duplicate');

-- ── nothing at all ──
select public.ok('account with no KYC or case: empty arrays, no error',
  (select m -> 'banking_services' = '[]'::jsonb and m -> 'accounts' = '[]'::jsonb and m -> 'gallery' = '[]'::jsonb and m -> 'changes' = '[]'::jsonb and m -> 'filing_record' = 'null'::jsonb
      and m -> 'has_master' = 'false'::jsonb from (select public.client_portal_me('cc000000-0000-0000-0000-0000000000cc') m) x),
  (select public.client_portal_me('cc000000-0000-0000-0000-0000000000cc')::text));
select public.ok('master-only client: record from the Client Master, filing record present',
  (select m -> 'record' ->> 'company_email' = 'g@gamma.test' and m -> 'filing_record' ->> 'Client ID' = 'CL000902' and m -> 'banking_services' = '[]'::jsonb
   from (select public.client_portal_me('dd000000-0000-0000-0000-0000000000dd') m) x));

-- ── execute rights and table rights ──
set role authenticated;
select public.must_fail('authenticated cannot call client_portal_me', $$select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')$$, 'permission denied');
select public.must_fail('authenticated cannot call the gallery path', $$select public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd1000000-0000-0000-0000-000000000001')$$, 'permission denied');
select public.must_fail('change requests unreadable by the browser role', $$select * from public.client_portal_change_requests$$, 'permission denied');
reset role;
set role anon;
select public.must_fail('anon cannot call client_portal_me', $$select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa')$$, 'permission denied');
reset role;
set role service_role;
select public.ok('service_role can call both', (select public.client_portal_me('aa000000-0000-0000-0000-0000000000aa') is not null and public.client_portal_gallery_path('aa000000-0000-0000-0000-0000000000aa', 'kyc', 'd1000000-0000-0000-0000-000000000001') is not null));
reset role;

-- ── admin list ──
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', false) as _ \gset
select public.must_fail('non-admin refused', $$select public.client_portal_admin_clients()$$, 'Admins only');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false) as _ \gset
select public.ok('admin list: three clients and one unlinked account, existing and new columns on every row',
  (select jsonb_array_length(l) = 4 and (select bool_and(r ?& array['banking_client_id', 'client_master_id', 'display_name', 'license_number', 'account_id', 'username', 'status', 'last_login_at',
        'lines', 'kyc_percent', 'email', 'phone', 'pending_edits', 'unlinked']) from jsonb_array_elements(l) r)
   from (select public.client_portal_admin_clients() l) x),
  (select public.client_portal_admin_clients()::text));
select public.ok('admin list: every client appears, with or without an account',
  (select count(*) filter (where r ->> 'display_name' = 'Alpha Trading LLC' and r ->> 'username' = 'alpha.user') = 1
      and count(*) filter (where r ->> 'display_name' = 'Gamma Master Only' and r ->> 'username' = 'gamma.user') = 1
      and count(*) filter (where r ->> 'display_name' = 'Beta Services LLC') = 1
   from jsonb_array_elements(public.client_portal_admin_clients()) r));
select public.ok('admin list: lines, kyc percent, contact and pending edits',
  (select r -> 'lines' = '["Business Banking"]'::jsonb and (r ->> 'kyc_percent') is not null and r ->> 'email' = 'a@alpha.test' and r ->> 'phone' = '0501' and (r ->> 'pending_edits')::int = 1
   from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'display_name' = 'Alpha Trading LLC'));
select public.ok('admin list: master-only row has no lines and takes the master percent and email',
  (select r -> 'lines' = '[]'::jsonb and (r ->> 'kyc_percent')::int = 40 and r ->> 'email' = 'g@gamma.test' and (r ->> 'pending_edits')::int = 0
   from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'display_name' = 'Gamma Master Only'));
select public.ok('admin list: an account with neither link shows as unlinked, every other row does not',
  (select count(*) filter (where (r ->> 'unlinked')::boolean) = 1
      and count(*) filter (where (r ->> 'unlinked')::boolean and r ->> 'username' = 'empty.user' and r ->> 'status' = 'active' and r ->> 'account_id' = 'cc000000-0000-0000-0000-0000000000cc'
                             and r -> 'banking_client_id' = 'null'::jsonb and r -> 'client_master_id' = 'null'::jsonb and r -> 'lines' = '[]'::jsonb and r -> 'kyc_percent' = 'null'::jsonb) = 1
   from jsonb_array_elements(public.client_portal_admin_clients()) r),
  (select public.client_portal_admin_clients()::text));
select public.client_portal_admin_set_status('cc000000-0000-0000-0000-0000000000cc', false);
select public.ok('admin list: an unlinked account can be revoked and stays listed',
  (select r ->> 'status' = 'revoked' and (r ->> 'unlinked')::boolean from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'username' = 'empty.user'));
select public.client_portal_admin_set_status('cc000000-0000-0000-0000-0000000000cc', true);
select public.ok('admin list: ... and restored', (select r ->> 'status' = 'active' from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'username' = 'empty.user'));
reset role;
-- the real way an account loses its links: its banking client is deleted and the foreign key nulls the link
insert into public.banking_clients (id, display_name, license_number) values ('e0000000-0000-0000-0000-00000000000e', 'Orphan Co', 'LIC-O');
insert into public.client_portal_accounts (id, banking_client_id, display_name, username, password_hash) values
  ('ee000000-0000-0000-0000-0000000000ee', 'e0000000-0000-0000-0000-00000000000e', 'Orphan Co', 'orphan.user', 'x');
delete from public.banking_clients where id = 'e0000000-0000-0000-0000-00000000000e';
set role authenticated;
select public.ok('admin list: an account orphaned by a deleted client still appears, unlinked',
  (select count(*) = 1 and bool_and((r ->> 'unlinked')::boolean and r ->> 'display_name' = 'Orphan Co' and r ->> 'status' = 'active')
   from jsonb_array_elements(public.client_portal_admin_clients()) r where r ->> 'username' = 'orphan.user'));
reset role;

\echo === FAILURES ===
select n || ' FAIL ' || name || ' :: ' || coalesce(detail, '') from public.t_result where not ok order by n;
\echo === SUMMARY ===
select count(*) filter (where ok) || ' passed, ' || count(*) filter (where not ok) || ' failed' from public.t_result;
