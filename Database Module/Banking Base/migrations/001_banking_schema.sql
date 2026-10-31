-- =====================================================================
-- Banking Base - schema                                            001
-- =====================================================================
-- Business Banking (bank account opening) module for AB Capital Services FZE.
-- Target: PostgreSQL 15+ (the CRM Supabase project). Idempotent: safe to re-run.
--
-- Reused CRM entities:
--   public.profiles   CRM users (auth). Stand-in only in the local test stub.
--   Client Master     Client Module CSV, IDs CL000001 (text, on this PC only). Postgres cannot
--                     reach it, so banking_clients is a thin cross-reference, NOT a second
--                     master: it holds a name/licence key for de-duplication and client_master_id.
-- Timestamps: TIMESTAMPTZ. Money: NUMERIC(18,2) in AED. Never float.
-- =====================================================================

create extension if not exists pgcrypto;

-- ── Reference number sequences ───────────────────────────────────────
create sequence if not exists public.banking_lead_seq;
create sequence if not exists public.banking_case_seq;
create sequence if not exists public.banking_quote_seq;
create sequence if not exists public.banking_payment_seq;
create sequence if not exists public.banking_receipt_seq;
create sequence if not exists public.banking_letter_seq;
create sequence if not exists public.banking_application_seq;
create sequence if not exists public.banking_task_seq;

create or replace function public.banking_ref(prefix text, seq regclass, width int default 6)
returns text language sql volatile set search_path = public, pg_temp as $$
  select prefix || '-' || lpad(nextval(seq)::text, width, '0')
$$;

-- Name key for duplicate detection: upper-case, no punctuation, no legal-form suffixes.
create or replace function public.banking_name_key(p text)
returns text language sql immutable set search_path = public, pg_temp as $$
  select nullif(trim(regexp_replace(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9 ]', ' ', 'g'),
    '\m(LLC|L L C|FZE|FZCO|FZC|FZ|DMCC|SOC|SP|CO|COMPANY|LTD|LIMITED|OPC|SPC|EST|ESTABLISHMENT)\M|\s+', ' ', 'g')), '')
$$;

-- ── Access control ───────────────────────────────────────────────────
create table if not exists public.banking_user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role    text not null check (role in ('ADMIN','MANAGER','SALES_EXECUTIVE','DOCUMENT_EXECUTIVE','FINANCE','BANKING_EXECUTIVE','READ_ONLY'))
);
create table if not exists public.banking_role_permissions (
  role       text not null,
  permission text not null,
  allowed    boolean not null default true,
  primary key (role, permission)
);
create table if not exists public.banking_user_permissions (   -- per-user override of the role
  user_id    uuid not null references public.profiles(id) on delete cascade,
  permission text not null,
  allowed    boolean not null,
  primary key (user_id, permission)
);

-- ── Masters ──────────────────────────────────────────────────────────
create table if not exists public.banking_partners (
  id uuid primary key default gen_random_uuid(),
  bank_code text not null unique,
  bank_name text not null unique,
  aliases text[] not null default '{}',          -- spellings seen in the Excel history
  logo_url text, website text, contact_person text,
  submission_method text, appointment_required boolean, digital_application boolean,
  general_processing_time text,                  -- free text: never a promise
  internal_remarks text,
  is_active boolean not null default true
);
create table if not exists public.banking_relationship_managers (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banking_partners(id),
  full_name text not null, email text, mobile text, branch text, remarks text,
  is_active boolean not null default true
);
create table if not exists public.banking_schemes (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banking_partners(id),
  scheme_name text not null,
  account_type text,
  is_active boolean not null default true,
  current_version int not null default 0,
  unique (bank_id, scheme_name)
);
create table if not exists public.banking_scheme_versions (    -- append-only
  id uuid primary key default gen_random_uuid(),
  scheme_id uuid not null references public.banking_schemes(id),
  version int not null,
  minimum_balance numeric(18,2), initial_deposit numeric(18,2), monthly_fee numeric(18,2),
  minimum_average_balance numeric(18,2), below_balance_fee numeric(18,2),
  eligibility_conditions text, supported_activities text, nationality_restrictions text,
  physical_office_required boolean, non_resident_eligible boolean, client_visit_required boolean,
  processing_time text, description text, internal_notes text,
  valid_from date, valid_until date,
  source text, last_verified_date date, reviewer text,
  verification_status text not null default 'Unverified' check (verification_status in ('Unverified','Verified','Expired')),
  unique (scheme_id, version)
);
create table if not exists public.banking_pricing (            -- new row per change; old rows kept
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  account_opening_fee numeric(18,2) not null default 0,
  initial_deposit numeric(18,2),                 -- client's money at the bank, never revenue
  minimum_balance numeric(18,2),                 -- client's money at the bank, never revenue
  other_bank_charges numeric(18,2) not null default 0,
  bank_fee_collected_by_ab boolean not null default true,
  service_fee numeric(18,2),                     -- null: use the settings default
  service_fee_min numeric(18,2), service_fee_max numeric(18,2),
  effective_date date not null default current_date,
  expiry_date date,
  source text, remarks text
);
create table if not exists public.banking_supplementary_services (
  id uuid primary key default gen_random_uuid(),
  service_code text not null unique, service_name text not null,
  default_fee numeric(18,2) not null check (default_fee >= 0),
  creates_task_type text, is_active boolean not null default true
);
create table if not exists public.banking_document_types (
  id uuid primary key default gen_random_uuid(),
  doc_code text not null unique, doc_name text not null,
  has_expiry boolean not null default false,
  is_sensitive boolean not null default false,
  is_information boolean not null default false,  -- e.g. Email ID: a data item, not a file
  is_active boolean not null default true
);
create table if not exists public.banking_checklist_templates (
  id uuid primary key default gen_random_uuid(),
  template_code text not null,
  version int not null default 1,
  template_name text not null,
  bank_id uuid references public.banking_partners(id),     -- null: standard template
  scheme_id uuid references public.banking_schemes(id),
  account_kind text not null default 'Business' check (account_kind in ('Business','Personal')),
  uses_standard boolean not null default false,
  internal_notes text,
  source text, last_verified_date date, reviewer text,
  verification_status text not null default 'Unverified' check (verification_status in ('Unverified','Verified','Expired')),
  is_active boolean not null default true,
  unique (template_code, version)
);
create table if not exists public.banking_checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.banking_checklist_templates(id),
  document_type_id uuid not null references public.banking_document_types(id),
  requirement_label text,
  per_shareholder boolean not null default false,
  condition_key text,                            -- see banking_condition_applies()
  is_mandatory boolean not null default true,
  internal_note text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (template_id, document_type_id, condition_key)
);
create table if not exists public.banking_eligibility_notes (  -- internal notes, advisory only
  id uuid primary key default gen_random_uuid(),
  bank_id uuid references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  note_type text not null check (note_type in ('Nationality','Activity','Office','General')),
  match_values text[] not null default '{}',     -- e.g. nationalities the note concerns
  note text not null,
  source text, last_verified_date date, reviewer text, version int not null default 1,
  verification_status text not null default 'Unverified' check (verification_status in ('Unverified','Verified','Expired')),
  is_active boolean not null default true
);
create table if not exists public.banking_risk_rules (          -- from the Setup Guide risk deck; flags for review only
  id uuid primary key default gen_random_uuid(),
  rule_type text not null check (rule_type in ('Nationality','Activity','Structure')),
  match_values text[] not null,
  risk_level text not null check (risk_level in ('Low','Enhanced Due Diligence')),
  requirement text,
  source text, last_verified_date date, reviewer text,
  verification_status text not null default 'Unverified' check (verification_status in ('Unverified','Verified','Expired')),
  is_active boolean not null default true
);
create table if not exists public.banking_settings (
  key text primary key, value jsonb not null, description text
);

-- ── Clients, leads, cases ────────────────────────────────────────────
create table if not exists public.banking_clients (             -- cross-reference, see header
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  name_key text generated always as (public.banking_name_key(display_name)) stored,
  license_number text,
  client_type text not null default 'Company' check (client_type in ('Company','Individual')),
  client_master_id varchar(20) check (client_master_id is null or client_master_id ~ '^CL[0-9]{6}$'),
  link_status text not null default 'Pending Client Master' check (link_status in ('Pending Client Master','Linked'))
);
create index if not exists banking_clients_name_idx on public.banking_clients (name_key);
create unique index if not exists banking_clients_master_uq on public.banking_clients (client_master_id) where client_master_id is not null;

create table if not exists public.banking_leads (
  id uuid primary key default gen_random_uuid(),
  lead_ref text not null unique default public.banking_ref('BL', 'public.banking_lead_seq'),
  lead_date date not null default current_date,
  company_name text not null, contact_person text, mobile text, whatsapp text, email text,
  nationality text, company_type text, business_activity text,
  license_authority text, license_number text,
  lead_source text not null default 'Other',
  assigned_to uuid references public.profiles(id),
  initial_notes text,
  follow_up_date date,
  status text not null default 'New' check (status in ('New','Contacted','Interested','Follow-up Required','Bank Options Shared','Potential Client','Quotation Sent','Negotiation','Converted','Lost','Not Interested','Unreachable')),
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Urgent')),
  client_id uuid references public.banking_clients(id),
  converted_at timestamptz,
  source_sheet text, source_row int
);
create index if not exists banking_leads_status_idx on public.banking_leads (status);
create index if not exists banking_leads_followup_idx on public.banking_leads (follow_up_date);
create index if not exists banking_leads_assigned_idx on public.banking_leads (assigned_to);

create table if not exists public.banking_cases (
  id uuid primary key default gen_random_uuid(),
  case_ref text not null unique default public.banking_ref('BC', 'public.banking_case_seq'),
  client_id uuid not null references public.banking_clients(id),
  lead_id uuid references public.banking_leads(id),
  title text,
  account_kind text not null default 'Business' check (account_kind in ('Business','Personal')),
  current_stage smallint not null default 1 check (current_stage between 1 and 17),
  outcome text check (outcome in ('Approved','Rejected','Returned','Cancelled','Closed')),
  assigned_to uuid references public.profiles(id),
  is_historical boolean not null default false,
  legacy_status text
);
create index if not exists banking_cases_client_idx on public.banking_cases (client_id);
create index if not exists banking_cases_stage_idx on public.banking_cases (current_stage);
create index if not exists banking_cases_assigned_idx on public.banking_cases (assigned_to);

create table if not exists public.banking_case_parties (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  party_role text not null default 'Primary Contact',
  full_name text not null, mobile text, email text, remarks text
);
create table if not exists public.banking_case_stage_history ( -- append-only
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  from_stage smallint, to_stage smallint not null,
  responsible uuid references public.profiles(id),
  remarks text, is_override boolean not null default false, unmet_gates jsonb
);
create index if not exists banking_stage_hist_case_idx on public.banking_case_stage_history (case_id);

-- ── General KYC (reusable across cases of a client) ──────────────────
create table if not exists public.banking_kyc_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null unique references public.banking_clients(id),
  legal_name text, trade_name text, license_number text, license_issue_date date, license_expiry_date date,
  issuing_authority text, legal_structure text, business_activity text,
  registered_address text, office_address text, office_type text, office_ejari_available boolean,
  website text, company_email text, company_phone text, vat_trn text, annual_turnover numeric(18,2),
  expected_monthly_transactions text, countries_of_operation text, main_suppliers text, main_customers text,
  business_description text,
  nature_of_business text, source_of_funds text, expected_transaction_volume text, expected_monthly_turnover numeric(18,2),
  countries_of_transactions text, cash_transaction_expectations text, international_requirements text, reason_for_account text,
  -- facts the checklist engine reads; null means not known yet
  is_free_zone boolean, is_existing_company boolean, has_corporate_shareholder boolean,
  vat_registered boolean, goaml_required boolean, imports_exports boolean, is_trading boolean,
  has_physical_office boolean, is_freelance_or_trader_no_office boolean, is_self_employed boolean, is_employed boolean,
  completion_percent int not null default 0
);
create table if not exists public.banking_kyc_shareholders (
  id uuid primary key default gen_random_uuid(),
  kyc_profile_id uuid not null references public.banking_kyc_profiles(id),
  full_name text not null, nationality text, ownership_percent numeric(6,2) check (ownership_percent is null or ownership_percent between 0 and 100),
  passport_number text, passport_expiry date, emirates_id text, visa_status text,
  residential_address text, country_of_residence text, mobile text, email text,
  shareholder_type text not null default 'Individual' check (shareholder_type in ('Individual','Corporate')),
  is_ubo boolean not null default false,
  deleted_at timestamptz
);
create index if not exists banking_kyc_sh_profile_idx on public.banking_kyc_shareholders (kyc_profile_id);

-- ── Bank selection ───────────────────────────────────────────────────
create table if not exists public.banking_bank_recommendations (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  bank_id uuid not null references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  scheme_version_id uuid references public.banking_scheme_versions(id),
  internal_recommendation text, remarks text,
  presented_at timestamptz, presented_by uuid references public.profiles(id),
  client_response text,
  is_preferred boolean not null default false,
  is_selected boolean not null default false,
  selected_at timestamptz, deselected_at timestamptz, deselect_reason text
);
create unique index if not exists banking_reco_one_selected on public.banking_bank_recommendations (case_id) where is_selected;
create index if not exists banking_reco_case_idx on public.banking_bank_recommendations (case_id);

-- ── Documents ────────────────────────────────────────────────────────
create table if not exists public.banking_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.banking_clients(id),
  case_id uuid references public.banking_cases(id),
  document_type_id uuid references public.banking_document_types(id),
  shareholder_id uuid references public.banking_kyc_shareholders(id),
  title text not null,
  current_version int not null default 0,
  expiry_date date,
  deleted_at timestamptz
);
create index if not exists banking_docs_client_idx on public.banking_documents (client_id, document_type_id);
create table if not exists public.banking_document_versions (  -- append-only
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.banking_documents(id),
  version int not null,
  storage_path text not null, file_name text not null, mime_type text, size_bytes bigint, sha256 text,
  expiry_date date, remarks text,
  unique (document_id, version)
);
create table if not exists public.banking_kyc_documents (
  kyc_profile_id uuid not null references public.banking_kyc_profiles(id),
  document_id uuid not null references public.banking_documents(id),
  primary key (kyc_profile_id, document_id)
);
create table if not exists public.banking_case_checklists (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  recommendation_id uuid references public.banking_bank_recommendations(id),
  bank_id uuid references public.banking_partners(id),
  template_id uuid references public.banking_checklist_templates(id),
  template_version int,
  item_id uuid references public.banking_checklist_items(id),
  document_type_id uuid references public.banking_document_types(id),
  shareholder_id uuid references public.banking_kyc_shareholders(id),
  requirement_label text not null,
  is_mandatory boolean not null default true,
  condition_key text,
  condition_state text not null default 'Applies' check (condition_state in ('Applies','To Confirm')),
  status text not null default 'Not Requested' check (status in ('Not Requested','Requested','Received','Under Review','Verified','Rejected','Resubmission Required','Not Applicable')),
  document_id uuid references public.banking_documents(id),
  verified_version int,
  verified_by uuid references public.profiles(id), verified_at timestamptz,
  review_remarks text,
  expiry_date date,
  internal_note text,
  is_current boolean not null default true,
  sort_order int not null default 0
);
create index if not exists banking_cl_case_idx on public.banking_case_checklists (case_id, is_current);

-- ── Commercial ───────────────────────────────────────────────────────
create table if not exists public.banking_quotations (
  id uuid primary key default gen_random_uuid(),
  quotation_number text not null default public.banking_ref('BQ', 'public.banking_quote_seq'),
  version int not null default 1,
  supersedes_id uuid references public.banking_quotations(id),
  case_id uuid not null references public.banking_cases(id),
  recommendation_id uuid references public.banking_bank_recommendations(id),
  bank_id uuid references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  status text not null default 'Draft' check (status in ('Draft','Approval Required','Issued','Sent','Accepted','Rejected','Expired','Superseded')),
  quotation_date date not null default current_date,
  valid_until date,
  payment_terms text, remarks text,
  vat_mode text not null default 'inclusive' check (vat_mode in ('inclusive','exclusive','none')),
  vat_rate numeric(5,2) not null default 5,
  bank_fee_total numeric(18,2) not null default 0,
  service_fee_total numeric(18,2) not null default 0,
  supplementary_total numeric(18,2) not null default 0,
  discount_total numeric(18,2) not null default 0,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,   -- what the client pays through AB Capital
  direct_to_bank_total numeric(18,2) not null default 0, -- memo, excluded from total
  initial_deposit_memo numeric(18,2), minimum_balance_memo numeric(18,2), -- memo, never revenue
  needs_approval boolean not null default false, approval_reason text,
  approved_by uuid references public.profiles(id), approved_at timestamptz,
  prepared_by uuid references public.profiles(id),
  sent_at timestamptz, accepted_at timestamptz, rejected_at timestamptz, decision_remarks text,
  is_imported boolean not null default false,
  unique (quotation_number, version)
);
create index if not exists banking_quotes_case_idx on public.banking_quotations (case_id);
create unique index if not exists banking_quote_one_accepted on public.banking_quotations (case_id) where status = 'Accepted';

create table if not exists public.banking_quotation_items (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.banking_quotations(id),
  item_type text not null check (item_type in ('Bank Fee','Service Fee','Supplementary','Discount')),
  description text not null,
  quantity numeric(10,2) not null default 1,
  unit_amount numeric(18,2) not null check (unit_amount >= 0),
  amount numeric(18,2) generated always as (round(quantity * unit_amount, 2)) stored,
  payable_to text not null default 'AB Capital' check (payable_to in ('AB Capital','Bank')),
  collected_through_ab boolean not null default true,
  service_id uuid references public.banking_supplementary_services(id),
  default_amount numeric(18,2),                    -- catalogue value when the line was added
  override_reason text,
  sort_order int not null default 0
);
create table if not exists public.banking_payments (           -- append-only ledger
  id uuid primary key default gen_random_uuid(),
  payment_ref text not null unique default public.banking_ref('BP', 'public.banking_payment_seq'),
  case_id uuid not null references public.banking_cases(id),
  quotation_id uuid references public.banking_quotations(id),
  txn_type text not null default 'Payment' check (txn_type in ('Payment','Refund','Reversal','Adjustment')),
  payment_date date not null,
  amount numeric(18,2) not null check (amount <> 0),
  signed_amount numeric(18,2) generated always as (case when txn_type in ('Refund','Reversal') then -abs(amount) else amount end) stored,
  payment_method text,
  transaction_reference text, reference_note text, description text,
  received_by uuid references public.profiles(id),
  received_by_text text,
  reverses_payment_id uuid references public.banking_payments(id),
  document_path text,
  remarks text,
  import_row_id uuid
);
create index if not exists banking_pay_case_idx on public.banking_payments (case_id);
create index if not exists banking_pay_date_idx on public.banking_payments (payment_date);
create table if not exists public.banking_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default public.banking_ref('RC', 'public.banking_receipt_seq'),
  payment_id uuid not null unique references public.banking_payments(id),
  issued_on date not null default current_date
);
create table if not exists public.banking_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.banking_payments(id), -- the Refund ledger line
  original_payment_id uuid references public.banking_payments(id),
  reason text not null,
  approved_by uuid references public.profiles(id)
);
create table if not exists public.banking_engagement_letters (
  id uuid primary key default gen_random_uuid(),
  letter_number text not null unique default public.banking_ref('EL', 'public.banking_letter_seq'),
  case_id uuid not null references public.banking_cases(id),
  quotation_id uuid not null references public.banking_quotations(id),
  version int not null default 1,
  status text not null default 'Draft' check (status in ('Not Generated','Draft','Sent to Client','Awaiting Signature','Signed','Rejected','Cancelled')),
  letter_date date not null default current_date,
  content jsonb not null default '{}',             -- snapshot of the merged data
  signed_document_path text, signed_at date, signatory_name text,
  sent_at timestamptz, remarks text
);
create index if not exists banking_el_case_idx on public.banking_engagement_letters (case_id);

-- ── Application processing ───────────────────────────────────────────
create table if not exists public.banking_applications (
  id uuid primary key default gen_random_uuid(),
  application_ref text not null unique default public.banking_ref('BA', 'public.banking_application_seq'),
  case_id uuid not null references public.banking_cases(id),
  recommendation_id uuid references public.banking_bank_recommendations(id),
  bank_id uuid references public.banking_partners(id),
  scheme_id uuid references public.banking_schemes(id),
  engagement_letter_id uuid references public.banking_engagement_letters(id),
  override_justification text,
  application_date date default current_date,
  assigned_to uuid references public.profiles(id),
  relationship_manager_id uuid references public.banking_relationship_managers(id),
  relationship_manager_text text,
  submission_method text check (submission_method in ('Direct Bank Submission by AB Capital','Bank Appointment – Client Visits Bank','Digital Application','Other')),
  bank_reference text, submission_date date, appointment_date timestamptz, appointment_location text,
  bank_remarks text, internal_remarks text,
  form_prepared boolean not null default false,
  status text not null default 'Not Started' check (status in ('Not Started','Document Collection','Documents Under Review','Documents Completed','Application Preparation','Ready for Submission','Submitted to Bank','Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank','Approved','Account Opened','Rejected','Returned','Cancelled','On Hold')),
  status_date timestamptz not null default now(),
  next_follow_up date,
  is_active boolean not null default true,
  historical_date date                             -- Excel "OPENING DATE"; meaning varies by row
);
create unique index if not exists banking_app_one_active on public.banking_applications (case_id) where is_active;
create index if not exists banking_app_status_idx on public.banking_applications (status);
create index if not exists banking_app_bank_idx on public.banking_applications (bank_id);
create table if not exists public.banking_commissions (        -- from Excel "RM FEES"; finance only
  application_id uuid primary key references public.banking_applications(id),
  amount numeric(18,2) not null, source text
);
create table if not exists public.banking_application_status_history ( -- append-only
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.banking_applications(id),
  previous_status text, new_status text not null,
  remarks text, supporting_document_path text, next_follow_up date, is_override boolean not null default false
);
create index if not exists banking_app_hist_idx on public.banking_application_status_history (application_id);
create table if not exists public.banking_appointments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  application_id uuid references public.banking_applications(id),
  appointment_at timestamptz not null, location text,
  relationship_manager_text text, attendees text,
  status text not null default 'Scheduled' check (status in ('Scheduled','Completed','Rescheduled','Cancelled','No Show')),
  remarks text
);
create index if not exists banking_appt_when_idx on public.banking_appointments (appointment_at);

-- ── Follow-up, tasks, services ───────────────────────────────────────
create table if not exists public.banking_communications (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  lead_id uuid references public.banking_leads(id),
  client_id uuid references public.banking_clients(id),
  case_id uuid references public.banking_cases(id),
  channel text not null check (channel in ('Phone Call','WhatsApp','Email','In Person','Bank Relationship Manager','Other')),
  contact_person text, summary text not null, outcome text, next_action text,
  follow_up_date date, follow_up_done boolean not null default false,
  assigned_to uuid references public.profiles(id), attachment_path text,
  check (lead_id is not null or client_id is not null or case_id is not null)
);
create index if not exists banking_comm_case_idx on public.banking_communications (case_id);
create index if not exists banking_comm_lead_idx on public.banking_communications (lead_id);
create index if not exists banking_comm_follow_idx on public.banking_communications (follow_up_date) where not follow_up_done;
create table if not exists public.banking_tasks (
  id uuid primary key default gen_random_uuid(),
  task_ref text not null unique default public.banking_ref('BT', 'public.banking_task_seq'),
  case_id uuid references public.banking_cases(id),
  lead_id uuid references public.banking_leads(id),
  task_type text not null,
  title text,
  assigned_to uuid references public.profiles(id),
  priority text not null default 'Medium' check (priority in ('Low','Medium','High','Urgent')),
  due_date date,
  status text not null default 'Open' check (status in ('Open','In Progress','Completed','Cancelled')),
  remarks text, completed_at timestamptz
);
create index if not exists banking_task_assigned_idx on public.banking_tasks (assigned_to, status);
create index if not exists banking_task_case_idx on public.banking_tasks (case_id);
create table if not exists public.banking_service_deliverables (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.banking_cases(id),
  service_id uuid not null references public.banking_supplementary_services(id),
  quotation_item_id uuid references public.banking_quotation_items(id),
  task_id uuid references public.banking_tasks(id),
  document_id uuid references public.banking_documents(id),
  application_id uuid references public.banking_applications(id),
  status text not null default 'Pending' check (status in ('Pending','In Progress','Issued','Completed','Cancelled')),
  issued_on date, completed_on date, remarks text
);
create index if not exists banking_deliv_case_idx on public.banking_service_deliverables (case_id);

-- ── Excel import ─────────────────────────────────────────────────────
create table if not exists public.banking_excel_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null, file_sha256 text,
  sheets text[] not null default '{}', column_mapping jsonb,
  status text not null default 'Staged' check (status in ('Staged','Committed','Partly Committed','Cancelled')),
  total_rows int not null default 0, committed_rows int not null default 0, skipped_rows int not null default 0, error_rows int not null default 0
);
create table if not exists public.banking_excel_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.banking_excel_imports(id),
  source_sheet text not null, source_row int not null,
  month_label text,
  raw jsonb not null,                              -- the row exactly as read
  mapped jsonb not null default '{}',
  cell_colour text, colour_meaning text,
  suggested_status text, confidence text check (confidence in ('High','Medium','Low')),
  issues text[] not null default '{}',
  duplicate_key text, duplicate_of uuid references public.banking_excel_import_rows(id),
  payment_note text,
  payment_candidates jsonb not null default '[]',
  payment_review text not null default 'Pending' check (payment_review in ('Not Needed','Pending','Reviewed')),
  decision text not null default 'Pending' check (decision in ('Pending','Approved','Skipped','Committed','Error')),
  decided_status text, error text,
  client_id uuid references public.banking_clients(id), lead_id uuid references public.banking_leads(id),
  case_id uuid references public.banking_cases(id), application_id uuid references public.banking_applications(id),
  unique (import_id, source_sheet, source_row)
);
create index if not exists banking_imp_rows_decision_idx on public.banking_excel_import_rows (import_id, decision);
create index if not exists banking_imp_rows_dup_idx on public.banking_excel_import_rows (duplicate_key);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'banking_payments_import_row_fk') then
    alter table public.banking_payments add constraint banking_payments_import_row_fk
      foreign key (import_row_id) references public.banking_excel_import_rows(id);
  end if;
end $$;

-- ── AI review queue: every suggestion waits for a person ─────────────
create table if not exists public.banking_ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.banking_cases(id),
  document_id uuid references public.banking_documents(id),
  capability text not null,
  engine text not null,                            -- 'rules', 'docai', ...
  payload jsonb not null,
  status text not null default 'Pending Review' check (status in ('Pending Review','Accepted','Rejected')),
  reviewed_by uuid references public.profiles(id), reviewed_at timestamptz, review_note text
);
create index if not exists banking_ai_case_idx on public.banking_ai_suggestions (case_id, status);

-- ── Activity log (append-only) ───────────────────────────────────────
create table if not exists public.banking_activity_logs (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor uuid,
  case_id uuid,
  entity_table text not null, entity_id text,
  action text not null,
  old_data jsonb, new_data jsonb,
  note text
);
create index if not exists banking_log_case_idx on public.banking_activity_logs (case_id, occurred_at desc);
create index if not exists banking_log_entity_idx on public.banking_activity_logs (entity_table, entity_id);

-- ── Audit columns, triggers and RLS, applied to every table ──────────
create or replace function public.banking_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := coalesce(new.created_at, now());
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create or replace function public.banking_audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  masked text[] := array['passport_number','emirates_id','passport_expiry','residential_address','transaction_reference'];
  k text;
begin
  foreach k in array masked loop
    if o ? k then o := o || jsonb_build_object(k, '***'); end if;
    if n ? k then n := n || jsonb_build_object(k, '***'); end if;
  end loop;
  insert into banking_activity_logs (actor, case_id, entity_table, entity_id, action, old_data, new_data)
  values (auth.uid(),
          case when tg_table_name = 'banking_cases' then (coalesce(n, o) ->> 'id')::uuid else nullif(coalesce(n, o) ->> 'case_id', '')::uuid end,
          tg_table_name, coalesce(n, o) ->> 'id', tg_op,
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(e.key, e.value) from jsonb_each(o) e where (n -> e.key) is distinct from e.value and e.key not in ('updated_at','updated_by')) else o end,
          case when tg_op = 'UPDATE' then (select jsonb_object_agg(e.key, e.value) from jsonb_each(n) e where (o -> e.key) is distinct from e.value and e.key not in ('updated_at','updated_by')) else n end);
  return coalesce(new, old);
end $$;

create or replace function public.banking_append_only() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception '% is append-only: add a new record instead of changing history', tg_table_name;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'banking_partners','banking_relationship_managers','banking_schemes','banking_scheme_versions','banking_pricing',
    'banking_supplementary_services','banking_document_types','banking_checklist_templates','banking_checklist_items',
    'banking_eligibility_notes','banking_risk_rules','banking_settings','banking_clients','banking_leads','banking_cases',
    'banking_case_parties','banking_case_stage_history','banking_kyc_profiles','banking_kyc_shareholders',
    'banking_bank_recommendations','banking_documents','banking_document_versions','banking_kyc_documents',
    'banking_case_checklists','banking_quotations','banking_quotation_items','banking_payments','banking_receipts',
    'banking_refunds','banking_engagement_letters','banking_applications','banking_commissions','banking_application_status_history',
    'banking_appointments','banking_communications','banking_tasks','banking_service_deliverables',
    'banking_excel_imports','banking_excel_import_rows','banking_ai_suggestions','banking_user_roles','banking_role_permissions','banking_user_permissions']
  loop
    execute format('alter table public.%I add column if not exists created_at timestamptz not null default now(), add column if not exists created_by uuid, add column if not exists updated_at timestamptz not null default now(), add column if not exists updated_by uuid', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.banking_touch()', t || '_touch', t);
    execute format('alter table public.%I enable row level security', t);
    if t not in ('banking_excel_import_rows') then
      execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.banking_audit()', t || '_audit', t);
    end if;
  end loop;
  foreach t in array array['banking_scheme_versions','banking_case_stage_history','banking_document_versions','banking_payments','banking_receipts','banking_refunds','banking_application_status_history','banking_activity_logs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.banking_append_only()', t || '_immutable', t);
  end loop;
end $$;
alter table public.banking_activity_logs enable row level security;

-- Masters keep their row when something refers to it: soft-delete, not delete.
do $$
declare t text;
begin
  foreach t in array array['banking_partners','banking_schemes','banking_document_types','banking_supplementary_services'] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', t);
  end loop;
end $$;

-- Permission check. CRM admins always pass; a per-user row beats the role.
create or replace function public.banking_can(p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(
    (select true from profiles where id = auth.uid() and role = 'admin'),
    (select allowed from banking_user_permissions where user_id = auth.uid() and permission = p_permission),
    (select rp.allowed from banking_user_roles ur join banking_role_permissions rp on rp.role = ur.role
      where ur.user_id = auth.uid() and rp.permission = p_permission),
    false)
$$;

do $$
declare
  rec record;
  rules text[][] := array[
    -- table, read permission, write permission (null: functions only)
    ['banking_partners','app.access','masters.manage'],
    ['banking_relationship_managers','app.access','masters.manage'],
    ['banking_schemes','app.access','masters.manage'],
    ['banking_scheme_versions','app.access','masters.manage'],
    ['banking_pricing','app.access','pricing.manage'],
    ['banking_supplementary_services','app.access','pricing.manage'],
    ['banking_document_types','app.access','masters.manage'],
    ['banking_checklist_templates','app.access','masters.manage'],
    ['banking_checklist_items','app.access','masters.manage'],
    ['banking_eligibility_notes','app.access','masters.manage'],
    ['banking_risk_rules','app.access','masters.manage'],
    ['banking_settings','app.access','settings.manage'],
    ['banking_clients','app.access','cases.manage'],
    ['banking_leads','leads.view','leads.manage'],
    ['banking_cases','cases.view','cases.manage'],
    ['banking_case_parties','cases.view','cases.manage'],
    ['banking_case_stage_history','cases.view',null],
    ['banking_kyc_profiles','kyc.view','kyc.manage'],
    ['banking_kyc_shareholders','kyc.sensitive','kyc.manage'],
    ['banking_kyc_documents','kyc.view','kyc.manage'],
    ['banking_bank_recommendations','cases.view','cases.manage'],
    ['banking_documents','docs.view','docs.manage'],
    ['banking_document_versions','docs.view','docs.manage'],
    ['banking_case_checklists','docs.view',null],
    ['banking_quotations','quotes.view',null],
    ['banking_quotation_items','quotes.view',null],
    ['banking_payments','payments.view',null],
    ['banking_receipts','payments.view',null],
    ['banking_refunds','payments.view',null],
    ['banking_engagement_letters','agreements.view',null],
    ['banking_applications','apps.view',null],
    ['banking_application_status_history','apps.view',null],
    ['banking_commissions','reports.finance','reports.finance'],
    ['banking_appointments','apps.view','apps.manage'],
    ['banking_communications','comms.view','comms.manage'],
    ['banking_tasks','tasks.view','tasks.manage'],
    ['banking_service_deliverables','cases.view','cases.manage'],
    ['banking_excel_imports','imports.manage','imports.manage'],
    ['banking_excel_import_rows','imports.manage','imports.manage'],
    ['banking_ai_suggestions','cases.view',null],
    ['banking_user_roles','app.access','settings.manage'],
    ['banking_role_permissions','app.access','settings.manage'],
    ['banking_user_permissions','app.access','settings.manage'],
    ['banking_activity_logs','audit.view',null]
  ];
  i int;
  t text; r text; w text;
begin
  for i in 1 .. array_length(rules, 1) loop
    t := rules[i][1]; r := rules[i][2]; w := rules[i][3];
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.banking_can(%L))', t || '_read', t, r);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    -- Supabase default privileges include TRUNCATE, which bypasses RLS: start from nothing.
    execute format('revoke all on public.%I from anon, authenticated', t);
    if w is not null then
      execute format('create policy %I on public.%I for all to authenticated using (public.banking_can(%L)) with check (public.banking_can(%L))', t || '_write', t, w, w);
      execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    else
      execute format('grant select on public.%I to authenticated', t);
      execute format('revoke insert, update, delete on public.%I from authenticated', t);
    end if;
  end loop;
end $$;
do $$
declare q text;
begin
  foreach q in array array['banking_lead_seq','banking_case_seq','banking_quote_seq','banking_payment_seq','banking_receipt_seq','banking_letter_seq','banking_application_seq','banking_task_seq'] loop
    execute format('revoke all on sequence public.%I from anon, authenticated', q);
    execute format('grant usage on sequence public.%I to authenticated', q);
  end loop;
end $$;
