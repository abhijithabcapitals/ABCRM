-- =====================================================================
-- CRM Business Development (BD) backend - seed data                002
-- APPLIED 29/10/2026 to Supabase pnnakrhfzyxudjaghoxx as migration bd_002_seed.
-- =====================================================================
-- Sources, stages and lost reasons are the initial records named in
-- docs/BD_BACKEND_SPEC.md. Services are the Client Module "Services
-- Provided" options with their DataBase folder (Client Module config.json),
-- plus E-Invoicing Services from the BD UI. Display names match the BD UI
-- wording (stages, sources, lost reasons); codes are the spec's.
-- Upserts by code, so it is safe to re-run; edits made later in the app to
-- names / order / active flags are overwritten only for these codes.
--
-- progress_weight: evenly spaced by stage order (placeholder, review it).
-- default_probability: left NULL on purpose - the spec asks for configured
-- forecast probabilities, and none have been agreed yet.
-- =====================================================================

insert into public.bd_lead_sources (source_code, source_name, source_category, requires_campaign, requires_referrer, sort_order)
values
  ('COLD_CALL',         'Cold Call',         'Direct',   false, false,  10),
  ('WHATSAPP',          'WhatsApp',          'Direct',   false, false,  20),
  ('META_ADS',          'Meta Ads',          'Paid',     true,  false,  30),
  ('GOOGLE_ADS',        'Google Ads',        'Paid',     true,  false,  40),
  ('INSTAGRAM',         'Instagram',         'Organic',  false, false,  50),
  ('DIRECT',            'Direct',            'Direct',   false, false,  60),
  ('CAMPAIGN',          'Campaign',          'Paid',     true,  false,  70),
  ('THIRD_PARTY',       'Third Party',       'Referral', false, true,   80),
  ('EMPLOYEE_REFERRAL', 'Employee Referral', 'Referral', false, true,   90),
  ('CLIENT_REFERRAL',   'Client Referral',   'Referral', false, true,  100),
  ('WEBSITE',           'Website',           'Organic',  false, false, 110),
  ('LINKEDIN',          'LinkedIn',          'Organic',  false, false, 120),
  ('EMAIL',             'Email',             'Direct',   false, false, 130),
  ('NETWORKING',        'Networking / Event', 'Direct',   false, false, 140),
  ('WALK_IN',           'Walk-in',           'Direct',   false, false, 150),
  ('OTHER',             'Other',             'Other',    false, false, 160)
on conflict (source_code) do update set
  source_name = excluded.source_name, source_category = excluded.source_category,
  requires_campaign = excluded.requires_campaign, requires_referrer = excluded.requires_referrer,
  sort_order = excluded.sort_order, updated_at = now();

insert into public.bd_pipeline_stages (stage_code, stage_name, stage_order, progress_weight, is_terminal, required_fields)
values
  ('NEW_LEAD',                'New Lead',                 1,   8.33, false, '[]'),
  ('CONTACT_PENDING',         'Contact Pending',          2,  16.67, false, '[]'),
  ('FIRST_CONTACT_ATTEMPTED', 'First Contact Attempted',  3,  25.00, false, '["discussion_logged"]'),
  ('CONTACT_ESTABLISHED',     'Contact Established',      4,  33.33, false, '["discussion_logged"]'),
  ('REQUIREMENT_IDENTIFIED',  'Requirement Identified',   5,  41.67, false, '["service_added"]'),
  ('QUALIFIED',               'Qualified',                6,  50.00, false, '["service_added", "next_step"]'),
  ('PROPOSAL_PREPARATION',    'Proposal / Quotation Preparation', 7, 58.33, false, '["service_added", "next_step"]'),
  ('PROPOSAL_SENT',           'Proposal Sent',            8,  66.67, false, '["proposed_fee", "next_step"]'),
  ('NEGOTIATION',             'Follow-up / Negotiation',  9,  75.00, false, '["proposed_fee", "next_step"]'),
  ('VERBAL_CONFIRMATION',     'Verbal Confirmation',     10,  83.33, false, '["proposed_fee", "next_step"]'),
  ('WON_PENDING_ONBOARDING',  'Won — Pending Onboarding', 11, 91.67, false, '["mark_won_only"]'),
  ('ONBOARDING_COMPLETED',    'Onboarding Completed',    12, 100.00, true,  '["complete_onboarding_only"]')
on conflict (stage_code) do update set
  stage_name = excluded.stage_name, stage_order = excluded.stage_order, progress_weight = excluded.progress_weight,
  is_terminal = excluded.is_terminal, required_fields = excluded.required_fields, updated_at = now();

insert into public.bd_lost_reasons (reason_code, reason_name, requires_notes, sort_order)
values
  ('PRICE_TOO_HIGH',        'Price Too High',        false, 10),
  ('NO_RESPONSE',           'No Response',           false, 20),
  ('COMPETITOR_SELECTED',   'Competitor Selected',   true,  30),
  ('SERVICE_NOT_REQUIRED',  'Service Not Required',  false, 40),
  ('BUDGET_UNAVAILABLE',    'Budget Not Available',  false, 50),
  ('TIMING_DEFERRED',       'Timing / Deferred',     false, 60),
  ('REQUIREMENTS_NOT_MET',  'Unable to Meet Requirements', false, 70),
  ('DUPLICATE_LEAD',        'Duplicate Lead',        false, 80),
  ('OTHER',                 'Other',                 true,  90)
on conflict (reason_code) do update set
  reason_name = excluded.reason_name, requires_notes = excluded.requires_notes, sort_order = excluded.sort_order;

insert into public.bd_service_catalog (service_code, service_name, service_category, default_billing_frequency, database_folder, sort_order)
values
  ('BOOKKEEPING',             'Bookkeeping',                 'Accounting',     'Monthly',  '1. Accounting Clients',        10),
  ('ACCOUNTING',              'Accounting',                  'Accounting',     'Monthly',  '1. Accounting Clients',        20),
  ('VAT_REGISTRATION',        'VAT Registration',            'VAT',            'One-time', '3. VAT Clients',               30),
  ('VAT_RETURN_FILING',       'VAT Return Filing',           'VAT',            'Quarterly','3. VAT Clients',               40),
  ('CT_REGISTRATION',         'Corporate Tax Registration',  'Corporate Tax',  'One-time', '2. Corporate Tax',             50),
  ('CT_RETURN',               'Corporate Tax Return',        'Corporate Tax',  'Annual',   '2. Corporate Tax',             60),
  ('CT_ADVISORY',             'Corporate Tax Advisory',      'Corporate Tax',  null,       '2. Corporate Tax',             70),
  ('TAX_PLANNING',            'Tax Planning',                'Corporate Tax',  null,       '2. Corporate Tax',             80),
  ('FINANCIAL_STATEMENTS',    'Financial Statements',        'Accounting',     'Annual',   '1. Accounting Clients',        90),
  ('AUDIT',                   'Audit',                       'Audit',          'Annual',   '4. Audit Clients',            100),
  ('REVIEW',                  'Review',                      'Audit',          'Annual',   '4. Audit Clients',            110),
  ('INTERNAL_AUDIT',          'Internal Audit',              'Audit',          null,       '4. Audit Clients',            120),
  ('PAYROLL',                 'Payroll',                     'Payroll',        'Monthly',  '1. Accounting Clients',       130),
  ('WPS',                     'WPS',                         'Payroll',        'Monthly',  '1. Accounting Clients',       140),
  ('MANAGEMENT_ACCOUNTS',     'Management Accounts',         'Accounting',     'Monthly',  '1. Accounting Clients',       150),
  ('BUDGETING',               'Budgeting',                   'Accounting',     null,       '1. Accounting Clients',       160),
  ('CASH_FLOW_REPORTING',     'Cash Flow Reporting',         'Accounting',     null,       '1. Accounting Clients',       170),
  ('ESR_COMPLIANCE',          'ESR/Related Compliance',      'Compliance',     null,       '5. Others\Other',             180),
  ('UBO_COMPLIANCE',          'UBO Compliance',              'Compliance',     null,       '5. Others\Other',             190),
  ('AML_KYC_COMPLIANCE',      'AML/KYC Compliance',          'Compliance',     null,       '5. Others\Other',             200),
  ('ACCOUNTING_SOFTWARE_SETUP','Accounting Software Setup',  'Accounting',     'One-time', '1. Accounting Clients',       210),
  ('ERP_SUPPORT',             'ERP Support',                 'Accounting',     null,       '1. Accounting Clients',       220),
  ('COMPANY_FORMATION',       'Company Formation',           'Corporate',      'One-time', '5. Others\Company Formation', 230),
  ('COMPANY_CLOSURE',         'Company Closure/Liquidation', 'Corporate',      'One-time', '5. Others\Other',             240),
  ('VAT_DEREGISTRATION',      'VAT Deregistration',          'VAT',            'One-time', '3. VAT Clients',              250),
  ('TAX_DEREGISTRATION',      'Tax Deregistration',          'Corporate Tax',  'One-time', '2. Corporate Tax',            260),
  ('OTHER_ADVISORY',          'Other Advisory',              'Advisory',       null,       '5. Others\Other',             270),
  -- extra from the BD UI; not a Client Module service yet, so it has no DataBase folder
  ('E_INVOICING',             'E-Invoicing Services',        'Compliance',     null,       null,                          280)
on conflict (service_code) do update set
  service_name = excluded.service_name, service_category = excluded.service_category,
  default_billing_frequency = excluded.default_billing_frequency, database_folder = excluded.database_folder,
  sort_order = excluded.sort_order, updated_at = now();
