-- =====================================================================
-- Business Setup Base - service checklists    022
-- =====================================================================
-- Spec 2026-11-05 service work. Lists are templates: accepting a quote copies a list onto each service, so later edits leave running services unchanged.
-- Staff work items in any order. A Mandatory item needs a manager's sign-off, and completing the service needs each one signed off or Not Applicable.
-- Progress is worked out, never typed: Completed over all items except Not Applicable. Every item change goes to business_setup_service_history.
-- The seed comes from docs/2026-11-05-business-setup-service-checklists.md through scripts/build_checkpoints.py. It adds rows, and changes no existing row.
-- Existing services get no checklist and keep their simple statuses. It redefines functions from 006, 017, 018 and 019: run this file again whenever those are re-run.
-- Run after 019. Re-runnable. Undo with rollback/022_rollback.sql.
-- =====================================================================

create table if not exists public.business_setup_checkpoint_sets (
  id uuid primary key default gen_random_uuid(),
  department text not null default 'Business Setup',
  category text not null,
  name text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  unique (department, name)
);
create table if not exists public.business_setup_checkpoint_steps (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.business_setup_checkpoint_sets(id) on delete cascade,
  sort_order int not null,
  label text not null,
  stage text,
  requirement text not null default 'Mandatory' check (requirement in ('Mandatory', 'Optional'))
);
create index if not exists business_setup_checkpoint_steps_set_idx on public.business_setup_checkpoint_steps (set_id, sort_order);
alter table public.business_setup_fee_items add column if not exists checkpoint_set_id uuid references public.business_setup_checkpoint_sets(id);

create table if not exists public.business_setup_service_checkpoints (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.business_setup_services(id),
  sort_order int not null,
  label text not null,
  stage text,
  requirement text not null check (requirement in ('Mandatory', 'Optional')),
  status text not null default 'Not Started' check (status in ('Not Started', 'In Progress', 'Pending Client', 'Pending Authority', 'On Hold', 'Completed', 'Not Applicable', 'Reopened')),
  reason text,
  assigned_to uuid references public.profiles(id),
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  verified_at timestamptz,
  verified_by uuid,
  updated_at timestamptz not null default now(),
  unique (service_id, sort_order)
);

-- The service's people and dates. owner_id (already on the table) is the assigned employee.
alter table public.business_setup_services add column if not exists reviewer_id uuid references public.profiles(id);
alter table public.business_setup_services add column if not exists priority text not null default 'Normal';
alter table public.business_setup_services drop constraint if exists business_setup_services_priority_check;
alter table public.business_setup_services add constraint business_setup_services_priority_check check (priority in ('Low', 'Normal', 'High', 'Urgent'));
alter table public.business_setup_services add column if not exists authority text;
alter table public.business_setup_services add column if not exists expected_completion date;
-- An attachment is an ordinary document of the client, linked to its item.
alter table public.business_setup_documents add column if not exists checkpoint_id uuid references public.business_setup_service_checkpoints(id);

alter table public.business_setup_checkpoint_sets enable row level security;
alter table public.business_setup_checkpoint_steps enable row level security;
alter table public.business_setup_service_checkpoints enable row level security;
revoke all on public.business_setup_checkpoint_sets, public.business_setup_checkpoint_steps, public.business_setup_service_checkpoints from public, anon, authenticated;

-- ── The seed ─────────────────────────────────────────────────────────
-- A list already there is left alone, so an edit survives a re-run.
do $do$
declare r jsonb; st jsonb; v_set uuid; n int;
begin
  for r in select value from jsonb_array_elements($seed$[{"c":"Company Formation","n":"Mainland Company Formation","s":[{"l":"Client requirements received","r":"Mandatory"},{"l":"Business activity confirmed","r":"Mandatory"},{"l":"Legal structure confirmed","r":"Mandatory"},{"l":"Trade name selected","r":"Mandatory"},{"l":"Shareholder details collected","r":"Mandatory"},{"l":"Passport / Emirates ID collected","r":"Mandatory"},{"l":"Initial approval obtained","r":"Mandatory"},{"l":"External approvals obtained (if applicable)","r":"Optional"},{"l":"MOA prepared","r":"Mandatory"},{"l":"MOA signed","r":"Mandatory"},{"l":"Office / Ejari requirements completed (if applicable)","r":"Optional"},{"l":"License application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Trade license issued","r":"Mandatory"},{"l":"MOA and incorporation documents received","r":"Mandatory"},{"l":"Final documents delivered to client","r":"Mandatory"}]},{"c":"Company Formation","n":"Free Zone Company Formation","s":[{"l":"Free Zone selected","r":"Mandatory"},{"l":"Business activity confirmed","r":"Mandatory"},{"l":"License type selected","r":"Mandatory"},{"l":"Shareholder details collected","r":"Mandatory"},{"l":"Passport and KYC documents collected","r":"Mandatory"},{"l":"Trade name approved","r":"Mandatory"},{"l":"Initial approval received","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Office / flexi-desk package selected","r":"Mandatory"},{"l":"Incorporation documents signed","r":"Mandatory"},{"l":"Payment completed","r":"Mandatory"},{"l":"Trade license issued","r":"Mandatory"},{"l":"Establishment card processed (if applicable)","r":"Optional"},{"l":"Incorporation documents delivered","r":"Mandatory"}]},{"c":"Company Formation","n":"Offshore Company Formation","s":[{"l":"Jurisdiction selected","r":"Mandatory"},{"l":"Company structure confirmed","r":"Mandatory"},{"l":"Shareholder details collected","r":"Mandatory"},{"l":"Director details collected","r":"Mandatory"},{"l":"Registered agent selected","r":"Mandatory"},{"l":"KYC documents collected","r":"Mandatory"},{"l":"Name availability checked","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Compliance verification completed","r":"Mandatory"},{"l":"Incorporation fees paid","r":"Mandatory"},{"l":"Certificate of Incorporation received","r":"Mandatory"},{"l":"Memorandum and Articles received","r":"Mandatory"},{"l":"Share certificates received (if applicable)","r":"Optional"},{"l":"Corporate documents delivered","r":"Mandatory"}]},{"c":"Company Formation","n":"Branch Office Registration","s":[{"l":"Parent company documents collected","r":"Mandatory"},{"l":"Parent company license verified","r":"Mandatory"},{"l":"Board resolution collected","r":"Mandatory"},{"l":"Branch activity confirmed","r":"Mandatory"},{"l":"Manager details collected","r":"Mandatory"},{"l":"Name approval obtained","r":"Mandatory"},{"l":"Regulatory approvals obtained","r":"Mandatory"},{"l":"Branch application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Branch license issued","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Company Formation","n":"Freelancer Permit / License","s":[{"l":"Activity confirmed","r":"Mandatory"},{"l":"Jurisdiction selected","r":"Mandatory"},{"l":"Passport collected","r":"Mandatory"},{"l":"Photograph collected","r":"Mandatory"},{"l":"Qualification documents collected (if required)","r":"Optional"},{"l":"Application submitted","r":"Mandatory"},{"l":"Approval received","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Freelancer permit issued","r":"Mandatory"},{"l":"Visa requirements addressed (if applicable)","r":"Optional"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Trade License & Approvals","n":"Trade License Renewal","s":[{"l":"Existing license collected","r":"Mandatory"},{"l":"Expiry date verified","r":"Mandatory"},{"l":"Client renewal confirmation received","r":"Mandatory"},{"l":"Shareholder details checked","r":"Mandatory"},{"l":"Business activities verified","r":"Mandatory"},{"l":"Ejari / office documents checked (if applicable)","r":"Optional"},{"l":"External approvals obtained (if applicable)","r":"Optional"},{"l":"Outstanding fines checked","r":"Mandatory"},{"l":"Renewal quotation approved","r":"Mandatory"},{"l":"Payment received","r":"Mandatory"},{"l":"Renewal application submitted","r":"Mandatory"},{"l":"Renewed license received","r":"Mandatory"},{"l":"New expiry date updated","r":"Mandatory"},{"l":"License delivered to client","r":"Mandatory"}]},{"c":"Trade License & Approvals","n":"Trade License Amendment","s":[{"l":"Amendment requirement received","r":"Mandatory"},{"l":"Existing license reviewed","r":"Mandatory"},{"l":"Amendment type confirmed","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Shareholder approval obtained","r":"Mandatory"},{"l":"MOA amendment prepared (if applicable)","r":"Optional"},{"l":"Authority approval obtained","r":"Mandatory"},{"l":"Amendment application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Amended license received","r":"Mandatory"},{"l":"Updated documents delivered","r":"Mandatory"}]},{"c":"Trade License & Approvals","n":"Business Activity Addition / Removal","s":[{"l":"Existing activities reviewed","r":"Mandatory"},{"l":"New activity confirmed","r":"Mandatory"},{"l":"Activity eligibility checked","r":"Mandatory"},{"l":"External approvals identified","r":"Mandatory"},{"l":"Client approval obtained","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Authority approval received","r":"Mandatory"},{"l":"Updated license received","r":"Mandatory"},{"l":"Client notified","r":"Mandatory"}]},{"c":"Trade License & Approvals","n":"Trade Name Change","s":[{"l":"New name options received","r":"Mandatory"},{"l":"Name availability checked","r":"Mandatory"},{"l":"Name approval obtained","r":"Mandatory"},{"l":"Shareholder resolution obtained","r":"Mandatory"},{"l":"MOA amendment prepared (if applicable)","r":"Optional"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Updated license received","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Trade License & Approvals","n":"Initial Approval & Government Approvals","s":[{"l":"Business activity confirmed","r":"Mandatory"},{"l":"Jurisdiction confirmed","r":"Mandatory"},{"l":"Required authority identified","r":"Mandatory"},{"l":"Documents collected","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Additional information submitted (if requested)","r":"Optional"},{"l":"Approval received","r":"Mandatory"},{"l":"Approval certificate delivered","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Investor / Partner Visa","s":[{"l":"Passport collected","r":"Mandatory"},{"l":"Photograph collected","r":"Mandatory"},{"l":"Trade license verified","r":"Mandatory"},{"l":"Establishment card verified","r":"Mandatory"},{"l":"Entry permit application submitted","r":"Mandatory"},{"l":"Entry permit approved","r":"Mandatory"},{"l":"Status change completed (if applicable)","r":"Optional"},{"l":"Medical fitness completed","r":"Mandatory"},{"l":"Medical result received","r":"Mandatory"},{"l":"Emirates ID application submitted","r":"Mandatory"},{"l":"Biometrics completed (if applicable)","r":"Optional"},{"l":"Health insurance completed (if required)","r":"Optional"},{"l":"Residence visa issued","r":"Mandatory"},{"l":"Emirates ID delivered","r":"Mandatory"},{"l":"Visa expiry recorded","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Employment Visa","s":[{"l":"Employee documents collected","r":"Mandatory"},{"l":"Passport verified","r":"Mandatory"},{"l":"Photograph collected","r":"Mandatory"},{"l":"Work permit application submitted","r":"Mandatory"},{"l":"Work permit approved","r":"Mandatory"},{"l":"Employment contract processed","r":"Mandatory"},{"l":"Entry permit issued","r":"Mandatory"},{"l":"Status change completed (if applicable)","r":"Optional"},{"l":"Medical fitness completed","r":"Mandatory"},{"l":"Emirates ID application submitted","r":"Mandatory"},{"l":"Biometrics completed (if applicable)","r":"Optional"},{"l":"Insurance completed (if required)","r":"Optional"},{"l":"Residence visa issued","r":"Mandatory"},{"l":"Employee documents delivered","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Family / Dependent Visa","s":[{"l":"Sponsor eligibility verified","r":"Mandatory"},{"l":"Sponsor documents collected","r":"Mandatory"},{"l":"Dependent passport collected","r":"Mandatory"},{"l":"Photograph collected","r":"Mandatory"},{"l":"Relationship proof collected","r":"Mandatory"},{"l":"Attested documents verified (if applicable)","r":"Optional"},{"l":"Entry permit submitted","r":"Mandatory"},{"l":"Entry permit approved","r":"Mandatory"},{"l":"Status change completed (if applicable)","r":"Optional"},{"l":"Medical fitness completed (where applicable)","r":"Optional"},{"l":"Emirates ID submitted","r":"Mandatory"},{"l":"Insurance completed (if required)","r":"Optional"},{"l":"Residence visa issued","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Visa Renewal","s":[{"l":"Existing visa collected","r":"Mandatory"},{"l":"Expiry date verified","r":"Mandatory"},{"l":"Passport validity checked","r":"Mandatory"},{"l":"Sponsor documents verified","r":"Mandatory"},{"l":"Medical fitness completed (where applicable)","r":"Optional"},{"l":"Emirates ID renewal submitted","r":"Mandatory"},{"l":"Insurance completed (if required)","r":"Optional"},{"l":"Renewal application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Renewed residence visa received","r":"Mandatory"},{"l":"New expiry date updated","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Visa Cancellation","s":[{"l":"Cancellation request received","r":"Mandatory"},{"l":"Visa holder details verified","r":"Mandatory"},{"l":"Sponsor approval obtained","r":"Mandatory"},{"l":"Outstanding obligations checked","r":"Mandatory"},{"l":"Cancellation application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Cancellation approved","r":"Mandatory"},{"l":"Cancellation document received","r":"Mandatory"},{"l":"Client notified","r":"Mandatory"},{"l":"Record updated","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Emirates ID Application / Renewal","s":[{"l":"Applicant details collected","r":"Mandatory"},{"l":"Passport collected","r":"Mandatory"},{"l":"Photograph collected","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Biometrics completed (if required)","r":"Optional"},{"l":"Application approved","r":"Mandatory"},{"l":"Emirates ID issued","r":"Mandatory"},{"l":"Card delivered","r":"Mandatory"},{"l":"Expiry date updated","r":"Mandatory"}]},{"c":"Visa & Immigration","n":"Golden Visa Assistance","s":[{"l":"Eligibility assessed","r":"Mandatory"},{"l":"Relevant category confirmed","r":"Mandatory"},{"l":"Supporting documents collected","r":"Mandatory"},{"l":"Qualification / investment evidence verified","r":"Mandatory"},{"l":"Nomination application submitted (if applicable)","r":"Optional"},{"l":"Nomination approved","r":"Mandatory"},{"l":"Medical fitness completed","r":"Mandatory"},{"l":"Emirates ID application submitted","r":"Mandatory"},{"l":"Insurance completed (if required)","r":"Optional"},{"l":"Residence visa issued","r":"Mandatory"},{"l":"Final documents delivered","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"Establishment Card – New / Renewal","s":[{"l":"Trade license collected","r":"Mandatory"},{"l":"Shareholder details verified","r":"Mandatory"},{"l":"Authorized signatory details collected","r":"Mandatory"},{"l":"Passport / Emirates ID collected","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Establishment card issued","r":"Mandatory"},{"l":"Card uploaded to CRM","r":"Mandatory"},{"l":"Expiry date updated","r":"Mandatory"},{"l":"Card delivered to client","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"Immigration File Opening","s":[{"l":"Trade license verified","r":"Mandatory"},{"l":"Company documents collected","r":"Mandatory"},{"l":"Authorized signatory verified","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Immigration file approved","r":"Mandatory"},{"l":"Establishment details recorded","r":"Mandatory"},{"l":"Confirmation delivered","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"MOHRE Registration / Labour File Opening","s":[{"l":"Trade license verified","r":"Mandatory"},{"l":"Establishment details collected","r":"Mandatory"},{"l":"Authorized signatory verified","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"MOHRE establishment registration completed","r":"Mandatory"},{"l":"Labour file number received","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"Work Permit Processing","s":[{"l":"Employee details collected","r":"Mandatory"},{"l":"Passport and photograph collected","r":"Mandatory"},{"l":"Employer details verified","r":"Mandatory"},{"l":"Job title and contract details confirmed","r":"Mandatory"},{"l":"Work permit application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Additional approvals obtained (if required)","r":"Optional"},{"l":"Work permit approved","r":"Mandatory"},{"l":"Employment contract processed","r":"Mandatory"},{"l":"Confirmation delivered","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"Document Attestation","s":[{"l":"Document received","r":"Mandatory"},{"l":"Document type identified","r":"Mandatory"},{"l":"Country of origin confirmed","r":"Mandatory"},{"l":"Required attestation route identified","r":"Mandatory"},{"l":"Notarisation completed (if required)","r":"Optional"},{"l":"Foreign affairs attestation completed (if required)","r":"Optional"},{"l":"UAE mission attestation completed (if required)","r":"Optional"},{"l":"UAE MOFA attestation completed (if required)","r":"Optional"},{"l":"Translation completed (if required)","r":"Optional"},{"l":"Attested document delivered","r":"Mandatory"}]},{"c":"PRO & Government Services","n":"Government Document Processing / NOC","s":[{"l":"Client request received","r":"Mandatory"},{"l":"Document requirement identified","r":"Mandatory"},{"l":"Supporting documents collected","r":"Mandatory"},{"l":"Draft prepared","r":"Mandatory"},{"l":"Client approval obtained","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Approval received","r":"Mandatory"},{"l":"Final document delivered","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"Shareholder Addition / Removal","s":[{"l":"Amendment request received","r":"Mandatory"},{"l":"Existing ownership structure verified","r":"Mandatory"},{"l":"New shareholder KYC collected","r":"Mandatory"},{"l":"Share transfer / allocation details confirmed","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Resolution signed","r":"Mandatory"},{"l":"Regulatory approval obtained","r":"Mandatory"},{"l":"MOA amended","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Updated license received","r":"Mandatory"},{"l":"Ownership records updated","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"Share Transfer","s":[{"l":"Share transfer request received","r":"Mandatory"},{"l":"Existing shareholding verified","r":"Mandatory"},{"l":"Buyer / transferee KYC collected","r":"Mandatory"},{"l":"Transfer percentage confirmed","r":"Mandatory"},{"l":"Transfer agreement prepared","r":"Mandatory"},{"l":"Shareholder approval obtained","r":"Mandatory"},{"l":"Authority approval obtained","r":"Mandatory"},{"l":"MOA / constitutional documents amended","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Updated license / share register received","r":"Mandatory"},{"l":"Final documents delivered","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"Manager Appointment / Removal","s":[{"l":"Amendment request received","r":"Mandatory"},{"l":"New manager details collected","r":"Mandatory"},{"l":"Passport / Emirates ID collected","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Resolution signed","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Authority approval received","r":"Mandatory"},{"l":"Updated license / MOA received","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"Registered Address Change","s":[{"l":"Address change request received","r":"Mandatory"},{"l":"New address confirmed","r":"Mandatory"},{"l":"Tenancy contract collected","r":"Mandatory"},{"l":"Ejari obtained (if applicable)","r":"Optional"},{"l":"Required NOC obtained","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Authority approval received","r":"Mandatory"},{"l":"Updated license received","r":"Mandatory"},{"l":"Records updated","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"MOA / AOA Amendment","s":[{"l":"Amendment requirement identified","r":"Mandatory"},{"l":"Existing MOA / AOA collected","r":"Mandatory"},{"l":"Proposed changes confirmed","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Revised document drafted","r":"Mandatory"},{"l":"Legal review completed","r":"Mandatory"},{"l":"Documents signed / notarised (if required)","r":"Optional"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Amended document received","r":"Mandatory"},{"l":"Final copy delivered","r":"Mandatory"}]},{"c":"Corporate Amendments & Restructuring","n":"Share Capital Amendment","s":[{"l":"Existing capital structure verified","r":"Mandatory"},{"l":"Proposed capital change confirmed","r":"Mandatory"},{"l":"Shareholder resolution obtained","r":"Mandatory"},{"l":"Capital allocation details prepared","r":"Mandatory"},{"l":"Supporting financial evidence collected (if required)","r":"Optional"},{"l":"MOA amended","r":"Mandatory"},{"l":"Authority approval obtained","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Updated license / documents received","r":"Mandatory"},{"l":"Records updated","r":"Mandatory"}]},{"c":"Corporate Compliance","n":"UBO Registration / Update","s":[{"l":"Company license collected","r":"Mandatory"},{"l":"Shareholder structure collected","r":"Mandatory"},{"l":"Ownership chain reviewed","r":"Mandatory"},{"l":"Ultimate beneficial owners identified","r":"Mandatory"},{"l":"UBO information collected","r":"Mandatory"},{"l":"Supporting KYC documents collected","r":"Mandatory"},{"l":"UBO declaration prepared","r":"Mandatory"},{"l":"Client verification obtained","r":"Mandatory"},{"l":"Required filing submitted","r":"Mandatory"},{"l":"Filing acknowledgement received","r":"Mandatory"},{"l":"UBO register updated","r":"Mandatory"},{"l":"Evidence uploaded to CRM","r":"Mandatory"}]},{"c":"Corporate Compliance","n":"AML / CFT Compliance Assistance","s":[{"l":"Business activity reviewed","r":"Mandatory"},{"l":"AML applicability assessed","r":"Mandatory"},{"l":"Risk assessment conducted","r":"Mandatory"},{"l":"Customer risk categories identified","r":"Mandatory"},{"l":"KYC documents reviewed","r":"Mandatory"},{"l":"Beneficial ownership verified","r":"Mandatory"},{"l":"AML policies prepared / reviewed","r":"Mandatory"},{"l":"Internal procedures established","r":"Mandatory"},{"l":"Staff training completed (if included)","r":"Optional"},{"l":"Reporting obligations reviewed","r":"Mandatory"},{"l":"Compliance records updated","r":"Mandatory"},{"l":"Periodic review date scheduled","r":"Mandatory"}]},{"c":"Corporate Compliance","n":"Corporate Governance Support","s":[{"l":"Company structure reviewed","r":"Mandatory"},{"l":"Shareholder records collected","r":"Mandatory"},{"l":"Director / manager details verified","r":"Mandatory"},{"l":"Existing governance documents reviewed","r":"Mandatory"},{"l":"Missing documents identified","r":"Mandatory"},{"l":"Required resolutions prepared","r":"Mandatory"},{"l":"Statutory registers updated","r":"Mandatory"},{"l":"Governance documentation completed","r":"Mandatory"},{"l":"Final review completed","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Corporate Compliance","n":"Corporate Compliance Calendar Setup","s":[{"l":"Client license and entity details collected","r":"Mandatory"},{"l":"Applicable compliance obligations identified","r":"Mandatory"},{"l":"License expiry recorded","r":"Mandatory"},{"l":"Visa expiry recorded","r":"Mandatory"},{"l":"Tax deadlines coordinated with Tax Department","r":"Mandatory"},{"l":"UBO / AML obligations assessed","r":"Mandatory"},{"l":"Other regulatory deadlines recorded","r":"Mandatory"},{"l":"Responsible employees assigned","r":"Mandatory"},{"l":"Reminders configured","r":"Mandatory"},{"l":"Calendar verified","r":"Mandatory"}]},{"c":"Office & Facility Services","n":"Ejari Registration","s":[{"l":"Property details collected","r":"Mandatory"},{"l":"Tenancy contract received","r":"Mandatory"},{"l":"Landlord details verified","r":"Mandatory"},{"l":"Tenant details verified","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Ejari application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Ejari certificate issued","r":"Mandatory"},{"l":"Certificate delivered","r":"Mandatory"},{"l":"Expiry date updated","r":"Mandatory"}]},{"c":"Office & Facility Services","n":"Ejari Renewal","s":[{"l":"Existing Ejari collected","r":"Mandatory"},{"l":"Expiry date checked","r":"Mandatory"},{"l":"Updated tenancy contract received","r":"Mandatory"},{"l":"Landlord / tenant details verified","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Renewal application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Renewed Ejari received","r":"Mandatory"},{"l":"Expiry date updated","r":"Mandatory"},{"l":"Certificate delivered","r":"Mandatory"}]},{"c":"Office & Facility Services","n":"Office / Flexi-Desk Arrangement","s":[{"l":"Client requirements received","r":"Mandatory"},{"l":"Jurisdiction confirmed","r":"Mandatory"},{"l":"Office requirements identified","r":"Mandatory"},{"l":"Available packages shortlisted","r":"Mandatory"},{"l":"Quotation issued","r":"Mandatory"},{"l":"Client approval received","r":"Mandatory"},{"l":"Agreement prepared","r":"Mandatory"},{"l":"Agreement signed","r":"Mandatory"},{"l":"Payment completed","r":"Mandatory"},{"l":"Office allocation confirmed","r":"Mandatory"},{"l":"Supporting documents delivered","r":"Mandatory"}]},{"c":"Business Banking","n":"Corporate Bank Account Opening","s":[{"l":"Client banking requirement received","r":"Mandatory"},{"l":"Business activity reviewed","r":"Mandatory"},{"l":"Suitable banks shortlisted","r":"Mandatory"},{"l":"Bank eligibility assessed","r":"Mandatory"},{"l":"Company documents collected","r":"Mandatory"},{"l":"Shareholder KYC collected","r":"Mandatory"},{"l":"Business profile prepared","r":"Mandatory"},{"l":"Expected transaction details collected","r":"Mandatory"},{"l":"Source of funds documents collected","r":"Mandatory"},{"l":"Bank application prepared","r":"Mandatory"},{"l":"Client approval obtained","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Bank KYC completed","r":"Mandatory"},{"l":"Additional queries addressed","r":"Mandatory"},{"l":"Bank approval received","r":"Mandatory"},{"l":"Account details received","r":"Mandatory"},{"l":"Client notified","r":"Mandatory"}]},{"c":"Business Banking","n":"Merchant Account / Payment Gateway","s":[{"l":"Client requirement received","r":"Mandatory"},{"l":"Business model reviewed","r":"Mandatory"},{"l":"Payment provider shortlisted","r":"Mandatory"},{"l":"License and KYC documents collected","r":"Mandatory"},{"l":"Website / business details reviewed","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Compliance queries addressed","r":"Mandatory"},{"l":"Approval received","r":"Mandatory"},{"l":"Merchant account activated","r":"Mandatory"},{"l":"Credentials delivered securely","r":"Mandatory"}]},{"c":"Liquidation & Company Closure","n":"Mainland Company Liquidation","s":[{"l":"Closure request received","r":"Mandatory"},{"l":"License and company details verified","r":"Mandatory"},{"l":"Outstanding liabilities reviewed","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Resolution signed","r":"Mandatory"},{"l":"Liquidator appointed (where required)","r":"Optional"},{"l":"Closure application submitted","r":"Mandatory"},{"l":"Public notice completed (where required)","r":"Optional"},{"l":"Employee / labour obligations cleared","r":"Mandatory"},{"l":"Visa cancellations completed","r":"Mandatory"},{"l":"Government dues cleared","r":"Mandatory"},{"l":"Tax deregistration requirements reviewed","r":"Mandatory"},{"l":"Liquidation report received (where required)","r":"Optional"},{"l":"Final cancellation application submitted","r":"Mandatory"},{"l":"License cancellation certificate received","r":"Mandatory"},{"l":"Final documents delivered","r":"Mandatory"}]},{"c":"Liquidation & Company Closure","n":"Free Zone Company Closure","s":[{"l":"Closure request received","r":"Mandatory"},{"l":"Free Zone requirements verified","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Resolution signed","r":"Mandatory"},{"l":"Employee and visa obligations reviewed","r":"Mandatory"},{"l":"Outstanding dues checked","r":"Mandatory"},{"l":"Lease / facility obligations cleared","r":"Mandatory"},{"l":"Closure application submitted","r":"Mandatory"},{"l":"Government fees paid","r":"Mandatory"},{"l":"Clearance obtained","r":"Mandatory"},{"l":"License cancellation approved","r":"Mandatory"},{"l":"Closure certificate received","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]},{"c":"Liquidation & Company Closure","n":"Offshore Company Closure","s":[{"l":"Closure request received","r":"Mandatory"},{"l":"Jurisdiction requirements checked","r":"Mandatory"},{"l":"Company records reviewed","r":"Mandatory"},{"l":"Shareholder resolution prepared","r":"Mandatory"},{"l":"Outstanding liabilities reviewed","r":"Mandatory"},{"l":"Registered agent contacted","r":"Mandatory"},{"l":"Required filings completed","r":"Mandatory"},{"l":"Closure fees paid","r":"Mandatory"},{"l":"Deregistration application submitted","r":"Mandatory"},{"l":"Closure confirmation received","r":"Mandatory"},{"l":"Final documents delivered","r":"Mandatory"}]},{"c":"Additional Business Support Services","n":"Trademark Registration Assistance","s":[{"l":"Trademark requirement received","r":"Mandatory"},{"l":"Trademark name / logo collected","r":"Mandatory"},{"l":"Classification identified","r":"Mandatory"},{"l":"Preliminary search conducted","r":"Mandatory"},{"l":"Applicant details collected","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Examination / publication tracked","r":"Mandatory"},{"l":"Objections addressed (if applicable)","r":"Optional"},{"l":"Registration approved","r":"Mandatory"},{"l":"Certificate received","r":"Mandatory"},{"l":"Certificate delivered","r":"Mandatory"}]},{"c":"Additional Business Support Services","n":"Customs Registration","s":[{"l":"Import / export requirements received","r":"Mandatory"},{"l":"Business license verified","r":"Mandatory"},{"l":"Authorized signatory details collected","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Customs registration submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Additional requirements addressed","r":"Mandatory"},{"l":"Customs code received","r":"Mandatory"},{"l":"Registration details delivered","r":"Mandatory"}]},{"c":"Additional Business Support Services","n":"Chamber of Commerce Registration","s":[{"l":"License verified","r":"Mandatory"},{"l":"Company details collected","r":"Mandatory"},{"l":"Required documents collected","r":"Mandatory"},{"l":"Application prepared","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Membership approved","r":"Mandatory"},{"l":"Certificate received","r":"Mandatory"},{"l":"Expiry / renewal details recorded","r":"Mandatory"}]},{"c":"Additional Business Support Services","n":"Import / Export Code Assistance","s":[{"l":"Business activity verified","r":"Mandatory"},{"l":"Import / export requirements reviewed","r":"Mandatory"},{"l":"Customs authority identified","r":"Mandatory"},{"l":"Company documents collected","r":"Mandatory"},{"l":"Application submitted","r":"Mandatory"},{"l":"Fees paid","r":"Mandatory"},{"l":"Registration approved","r":"Mandatory"},{"l":"Code received","r":"Mandatory"},{"l":"Documents delivered","r":"Mandatory"}]}]$seed$::jsonb) loop
    if exists (select 1 from public.business_setup_checkpoint_sets where department = 'Business Setup' and name = r ->> 'n') then continue; end if;
    insert into public.business_setup_checkpoint_sets (category, name) values (r ->> 'c', r ->> 'n') returning id into v_set;
    n := 0;
    for st in select value from jsonb_array_elements(r -> 's') loop
      n := n + 1;
      insert into public.business_setup_checkpoint_steps (set_id, sort_order, label, requirement) values (v_set, n, st ->> 'l', st ->> 'r');
    end loop;
    insert into public.business_setup_fee_items (grp, name, default_amount, active, is_service, vat_rate, checkpoint_set_id)
    values (r ->> 'c', r ->> 'n', null, true, true, 5, v_set)
    on conflict (grp, name) do update set checkpoint_set_id = excluded.checkpoint_set_id where public.business_setup_fee_items.checkpoint_set_id is null;
  end loop;
end $do$;

-- ── Internal ─────────────────────────────────────────────────────────
create or replace function public.business_setup_checkpoints_copy(p_service uuid, p_fee uuid) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into business_setup_service_checkpoints (service_id, sort_order, label, stage, requirement)
  select p_service, st.sort_order, st.label, st.stage, st.requirement
    from business_setup_fee_items f join business_setup_checkpoint_sets cs on cs.id = f.checkpoint_set_id and cs.active
    join business_setup_checkpoint_steps st on st.set_id = cs.id
   where f.id = p_fee
  on conflict (service_id, sort_order) do nothing
$$;

-- Null when the service has no checklist, or nothing on it applies but is cancelled: screens then show its status alone.
create or replace function public.business_setup_service_progress(p_service uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select case when count(*) = 0 then null else coalesce(floor(100.0 * count(*) filter (where status = 'Completed') / nullif(count(*) filter (where status <> 'Not Applicable'), 0))::int, 0) end
    from business_setup_service_checkpoints where service_id = p_service
$$;

-- Who may work a service: its assigned employee, an item's assignee, the case owner, or a manager.
create or replace function public.business_setup_service_can_work(p_service uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select business_setup_can('setup.cases.approve')
      or exists (select 1 from business_setup_services s where s.id = p_service and s.owner_id = auth.uid())
      or exists (select 1 from business_setup_service_checkpoints x where x.service_id = p_service and x.assigned_to = auth.uid())
      or exists (select 1 from business_setup_services s join hub_documents q on q.id = s.quote_id join business_setup_cases c on c.id = q.case_id where s.id = p_service and c.owner_id = auth.uid())
$$;

-- The checks every item change shares. The service row is locked first, then the item.
create or replace function public.business_setup_checkpoint_open(p_id uuid) returns public.business_setup_service_checkpoints
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints; s business_setup_services;
begin
  select * into x from business_setup_service_checkpoints where id = p_id;
  if x.id is null then raise exception 'That item was not found'; end if;
  select * into s from business_setup_services where id = x.service_id for update;
  if not business_setup_service_can_work(s.id) then raise exception 'Only the people working on this service or a manager can change it'; end if;
  if s.status = 'Cancelled' then raise exception 'This service was cancelled, so its items cannot change'; end if;
  if s.status = 'Completed' then raise exception 'This service is confirmed. Ask a manager to reopen it first'; end if;
  if s.locked then raise exception 'This service is with Accounts, so its items cannot change'; end if;
  select * into x from business_setup_service_checkpoints where id = p_id for update;
  return x;
end $$;

revoke all on function public.business_setup_checkpoints_copy(uuid, uuid), public.business_setup_service_progress(uuid), public.business_setup_service_can_work(uuid), public.business_setup_checkpoint_open(uuid) from public, anon, authenticated;

-- ── Working an item ──────────────────────────────────────────────────
create or replace function public.business_setup_checkpoint_set(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints; s business_setup_services; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  x := business_setup_checkpoint_open(p_id);
  if p_status is null or p_status not in ('Not Started', 'In Progress', 'Pending Client', 'Pending Authority', 'On Hold', 'Completed', 'Not Applicable', 'Reopened') then raise exception 'Choose a status'; end if;
  if p_status = x.status then return; end if;
  if p_status = 'Reopened' then
    if x.status <> 'Completed' then raise exception 'Only a completed item can be reopened'; end if;
    if v_note is null then raise exception 'Say why you are reopening this item'; end if;
  elsif x.verified_at is not null then raise exception 'This item has been signed off. Reopen it first';
  end if;
  if p_status = 'Not Applicable' and v_note is null then raise exception 'Give a reason why this item does not apply'; end if;
  update business_setup_service_checkpoints set
      status = p_status,
      reason = case when p_status in ('Not Applicable', 'Reopened') then v_note else reason end,
      started_at = case when p_status not in ('Not Started', 'Not Applicable') then coalesce(started_at, now()) else started_at end,
      completed_at = case when p_status = 'Completed' then now() end,
      completed_by = case when p_status = 'Completed' then auth.uid() end,
      verified_at = null, verified_by = null, updated_at = now()
   where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, p_status, x.label || coalesce(': ' || v_note, ''));
  -- The first work on an item starts the service.
  select * into s from business_setup_services where id = x.service_id;
  if s.status = 'Not started' and p_status not in ('Not Started', 'Not Applicable') then
    update business_setup_services set status = 'In progress', started_at = coalesce(started_at, now()) where id = s.id;
    insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, 'Not started', 'In progress', 'First work on its checklist');
  end if;
end $$;

create or replace function public.business_setup_checkpoint_assign(p_id uuid, p_user uuid, p_due date) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  x := business_setup_checkpoint_open(p_id);
  if p_user is not null and not exists (select 1 from profiles where id = p_user) then raise exception 'That person was not found'; end if;
  update business_setup_service_checkpoints set assigned_to = p_user, due_date = p_due, updated_at = now() where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': assigned to ' || coalesce(business_setup_person_name(p_user), 'nobody') || coalesce(', due ' || p_due::text, ''));
end $$;

-- A manager signs off a completed Mandatory item.
create or replace function public.business_setup_checkpoint_verify(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  perform business_setup_require('setup.cases.approve');
  x := business_setup_checkpoint_open(p_id);
  if x.requirement <> 'Mandatory' then raise exception 'Only a Mandatory item needs a sign-off'; end if;
  if x.status <> 'Completed' then raise exception 'This item is not completed, so it cannot be signed off'; end if;
  if x.verified_at is not null then return; end if;
  update business_setup_service_checkpoints set verified_at = now(), verified_by = auth.uid(), updated_at = now() where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': signed off');
end $$;

create or replace function public.business_setup_service_verify_all(p_service uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; n int := 0;
begin
  perform business_setup_require('setup.cases.approve');
  for r in select id from business_setup_service_checkpoints where service_id = p_service and requirement = 'Mandatory' and status = 'Completed' and verified_at is null order by sort_order loop
    perform business_setup_checkpoint_verify(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A manager reopens a confirmed service with a note. The case returns to Pipeline.
create or replace function public.business_setup_service_reopen(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_services; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_case uuid; v_stage text;
begin
  perform business_setup_require('setup.cases.approve');
  if v_note is null then raise exception 'Say why you are reopening this service'; end if;
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if s.status <> 'Completed' then raise exception 'Only a confirmed service can be reopened'; end if;
  select q.case_id into v_case from hub_documents q where q.id = s.quote_id;
  select stage into v_stage from business_setup_cases where id = v_case for update;
  if v_stage = 'With Accounts' or s.locked then raise exception 'This service is with Accounts, so it cannot be reopened'; end if;
  if v_stage = 'Completed' then raise exception 'This case is closed, so its services cannot be reopened'; end if;
  update business_setup_services set status = 'In progress', completed_at = null where id = p_id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (p_id, 'Completed', 'In progress', 'Reopened: ' || v_note);
  if v_stage = 'Completion' then perform business_setup_case_set_stage(v_case, 'Pipeline', 'Service reopened: ' || v_note); end if;
end $$;

create or replace function public.business_setup_service_details_save(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_services; v_priority text := coalesce(nullif(p ->> 'priority', ''), 'Normal');
begin
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if not business_setup_service_can_work(p_id) then raise exception 'Only the people working on this service or a manager can change it'; end if;
  if v_priority not in ('Low', 'Normal', 'High', 'Urgent') then raise exception 'Choose a priority'; end if;
  update business_setup_services set owner_id = nullif(p ->> 'owner_id', '')::uuid, reviewer_id = nullif(p ->> 'reviewer_id', '')::uuid, priority = v_priority,
         authority = nullif(btrim(coalesce(p ->> 'authority', '')), ''), expected_completion = nullif(p ->> 'expected_completion', '')::date where id = p_id;
  perform business_setup_audit('business_setup_services', p_id::text, 'service_details_save', null, p);
end $$;

-- Links an uploaded document of the client to an item.
create or replace function public.business_setup_checkpoint_file_link(p_id uuid, p_document uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare x business_setup_service_checkpoints;
begin
  x := business_setup_checkpoint_open(p_id);
  update business_setup_documents d set checkpoint_id = p_id from business_setup_services s where s.id = x.service_id and d.id = p_document and d.client_id = s.client_id;
  if not found then raise exception 'That document was not found for this client'; end if;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (x.service_id, x.status, x.status, x.label || ': file attached');
end $$;

-- ── Reading ──────────────────────────────────────────────────────────
create or replace function public.business_setup_service_checklist(p_service uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s business_setup_services;
begin
  perform business_setup_require('setup.access');
  select * into s from business_setup_services where id = p_service;
  if s.id is null then raise exception 'Service not found'; end if;
  return jsonb_build_object('service', to_jsonb(s) || jsonb_build_object('owner_name', business_setup_person_name(s.owner_id), 'reviewer_name', business_setup_person_name(s.reviewer_id)),
    'progress', business_setup_service_progress(p_service),
    'can_work', business_setup_service_can_work(p_service),
    'can_verify', business_setup_can('setup.cases.approve'),
    'outputs', (select count(*) from business_setup_documents d where d.service_id = p_service and d.is_output),
    'pending_approval', (select count(*) from business_setup_service_checkpoints x where x.service_id = p_service and x.requirement = 'Mandatory' and x.status = 'Completed' and x.verified_at is null),
    'next_action', (select x.label from business_setup_service_checkpoints x where x.service_id = p_service and x.status not in ('Completed', 'Not Applicable') order by x.requirement = 'Optional', x.sort_order limit 1),
    'items', (select coalesce(jsonb_agg(to_jsonb(x) || jsonb_build_object('assignee_name', business_setup_person_name(x.assigned_to), 'verified_by_name', business_setup_person_name(x.verified_by),
                 'pending_approval', x.requirement = 'Mandatory' and x.status = 'Completed' and x.verified_at is null,
                 'overdue', x.due_date is not null and x.due_date < (now() at time zone 'Asia/Dubai')::date and x.status not in ('Completed', 'Not Applicable'),
                 'files', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'storage_path', d.storage_path)), '[]'::jsonb) from business_setup_documents d where d.checkpoint_id = x.id)) order by x.sort_order), '[]'::jsonb)
                from business_setup_service_checkpoints x where x.service_id = p_service));
end $$;

-- The lists, for Services & Fees.
create or replace function public.business_setup_checkpoint_lists() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', cs.id, 'department', cs.department, 'category', cs.category, 'name', cs.name, 'active', cs.active,
      'steps', (select coalesce(jsonb_agg(jsonb_build_object('label', st.label, 'stage', st.stage, 'requirement', st.requirement) order by st.sort_order), '[]'::jsonb) from business_setup_checkpoint_steps st where st.set_id = cs.id)) order by cs.category, cs.name), '[]'::jsonb)
    from business_setup_checkpoint_sets cs);
end $$;

-- Saves a list and its steps. Running services keep their own copy.
create or replace function public.business_setup_checkpoint_list_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_name text := nullif(btrim(coalesce(p ->> 'name', '')), ''); v_cat text := nullif(btrim(coalesce(p ->> 'category', '')), ''); v_dep text := coalesce(nullif(btrim(coalesce(p ->> 'department', '')), ''), 'Business Setup');
        st jsonb; n int := 0;
begin
  perform business_setup_require('setup.fees.manage');
  if v_name is null or v_cat is null then raise exception 'Enter the service name and category'; end if;
  if jsonb_typeof(p -> 'steps') is distinct from 'array' or jsonb_array_length(p -> 'steps') = 0 then raise exception 'A list needs at least one step'; end if;
  for st in select value from jsonb_array_elements(p -> 'steps') loop
    if nullif(btrim(coalesce(st ->> 'label', '')), '') is null then raise exception 'Every step needs a label'; end if;
    if coalesce(st ->> 'requirement', 'Mandatory') not in ('Mandatory', 'Optional') then raise exception 'A step is Mandatory or Optional'; end if;
  end loop;
  if v_id is null then
    insert into business_setup_checkpoint_sets (department, category, name, active, updated_by) values (v_dep, v_cat, v_name, coalesce((p ->> 'active')::boolean, true), auth.uid()) returning id into v_id;
  else
    update business_setup_checkpoint_sets set department = v_dep, category = v_cat, name = v_name, active = coalesce((p ->> 'active')::boolean, active), updated_at = now(), updated_by = auth.uid() where id = v_id;
    if not found then raise exception 'That list was not found'; end if;
    delete from business_setup_checkpoint_steps where set_id = v_id;
  end if;
  for st in select value from jsonb_array_elements(p -> 'steps') loop
    n := n + 1;
    insert into business_setup_checkpoint_steps (set_id, sort_order, label, stage, requirement) values (v_id, n, btrim(st ->> 'label'), nullif(btrim(coalesce(st ->> 'stage', '')), ''), coalesce(st ->> 'requirement', 'Mandatory'));
  end loop;
  perform business_setup_audit('business_setup_checkpoint_sets', v_id::text, 'checkpoint_list_save', null, jsonb_build_object('name', v_name, 'steps', n));
  return v_id;
end $$;

revoke all on function public.business_setup_checkpoint_set(uuid, text, text), public.business_setup_checkpoint_assign(uuid, uuid, date), public.business_setup_checkpoint_verify(uuid), public.business_setup_service_verify_all(uuid),
  public.business_setup_service_reopen(uuid, text), public.business_setup_service_details_save(uuid, jsonb), public.business_setup_checkpoint_file_link(uuid, uuid), public.business_setup_service_checklist(uuid),
  public.business_setup_checkpoint_lists(), public.business_setup_checkpoint_list_save(jsonb) from public, anon;
grant execute on function public.business_setup_checkpoint_set(uuid, text, text), public.business_setup_checkpoint_assign(uuid, uuid, date), public.business_setup_checkpoint_verify(uuid), public.business_setup_service_verify_all(uuid),
  public.business_setup_service_reopen(uuid, text), public.business_setup_service_details_save(uuid, jsonb), public.business_setup_checkpoint_file_link(uuid, uuid), public.business_setup_service_checklist(uuid),
  public.business_setup_checkpoint_lists(), public.business_setup_checkpoint_list_save(jsonb) to authenticated;

-- ── As in 017, and the list is copied onto each new service ──
create or replace function public.business_setup_quote_accept_body(p_id uuid, p_allow_expired boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  select * into q from hub_documents where id = p_id;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
  v_root := coalesce(q.root_quote_id, q.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
    raise exception 'A quote in this revision chain is already accepted';
  end if;
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and cannot take an accepted quote', lower((select stage from business_setup_cases where id = q.case_id));
  end if;
  if q.case_id is not null and exists (select 1 from hub_documents where case_id = q.case_id and doc_type = 'quote' and status = 'accepted' and id <> q.id) then
    raise exception 'Another quote of this case is already accepted: a case holds one quote and its revisions';
  end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
  -- The KYC is finished when it is marked Done or nothing is missing. A client accepting from the portal is not told what staff still have to fill in.
  if not business_setup_kyc_finished(q.client_id) then
    if auth.uid() is null then raise exception 'Your details are not complete yet. Please contact AB Capital Services FZE.'; end if;
    raise exception 'The client KYC is incomplete: missing %', array_to_string(business_setup_kyc_missing(q.client_id), ', ');
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;
  if not exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Confirmed')
     and not exists (select 1 from business_setup_acceptances where document_id = q.id and kind = 'Quote' and decision = 'Accepted') then
    raise exception 'This quote has not been accepted by the client or confirmed from a signed copy yet';
  end if;

  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(),
         status_reason = case when q.valid_until is not null and q.valid_until < v_today then 'Accepted after expiry' else null end
   where id = q.id;

  for ln in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
    v_name := coalesce(nullif(btrim(coalesce(ln ->> 'service_name', '')), ''), nullif(btrim(coalesce(ln ->> 'description', '')), ''));
    if v_name is null then raise exception 'Every quote line needs a service name'; end if;
    v_action := coalesce(nullif(btrim(coalesce(ln ->> 'action', '')), ''), 'New');
    if v_action not in ('New','Renewal','Rectification','Cancellation') then raise exception 'Unknown action % on a quote line', v_action; end if;
    v_renews := nullif(ln ->> 'renews_service_id', '')::uuid;
    if v_renews is not null and not exists (select 1 from business_setup_services where id = v_renews and client_id = q.client_id) then
      raise exception 'A renewal must link to an earlier service of the same client';
    end if;
    v_fee := nullif(ln ->> 'fee_item_id', '')::uuid;
    -- A line for a cost (its fee item is not a service) stays on the quote and creates no service.
    if v_fee is not null and not coalesce((select is_service from business_setup_fee_items where id = v_fee), true) then continue; end if;
    insert into business_setup_services (client_id, quote_id, fee_item_id, name, action, amount, renews_service_id)
    values (q.client_id, q.id, v_fee, v_name, v_action, nullif(ln ->> 'amount', '')::numeric, v_renews)
    returning id into v_svc;
    insert into business_setup_service_history (service_id, from_status, to_status, note)
    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);
    -- The list is copied now, so later edits to it leave this service unchanged. The case owner starts as the assigned employee.
    perform business_setup_checkpoints_copy(v_svc, v_fee);
    update business_setup_services set owner_id = coalesce(owner_id, (select c.owner_id from business_setup_cases c where c.id = q.case_id)) where id = v_svc;
    n := n + 1;
  end loop;

  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
end $$;

-- ── As in 006, and a checklist must be finished first ──
create or replace function public.business_setup_service_complete(p_id uuid, p_output_details jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s business_setup_services; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); d jsonb := coalesce(p_output_details, '{}'::jsonb);
  lic jsonb; v_expiry date; v_issue date; v_start_override boolean; v_no_output boolean; v_open text;
begin
  perform business_setup_require('setup.services.manage');
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if s.status = 'Completed' then raise exception 'This service is already completed'; end if;
  if s.status = 'Cancelled' then raise exception 'A cancelled service cannot be completed'; end if;
  -- A service with a checklist: every Mandatory item signed off or Not Applicable. What is left open and Optional is closed as not needed.
  select string_agg(x.label, ', ' order by x.sort_order) into v_open from business_setup_service_checkpoints x
   where x.service_id = s.id and x.requirement = 'Mandatory' and x.status <> 'Not Applicable' and x.verified_at is null;
  if v_open is not null then raise exception 'These items still need to be done and signed off: %', v_open; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'The output details must be an object'; end if;
  v_no_output := not exists (select 1 from business_setup_documents where service_id = s.id and is_output);
  if v_no_output then
    if not business_setup_can('setup.services.override') then raise exception 'Upload at least one output file before completing this service'; end if;
    if v_reason is null then raise exception 'Give a reason for completing without an output file'; end if;
  end if;
  v_start_override := s.started_at is null and business_setup_start_gate(s.quote_id, v_reason);
  if d ? 'licence' then
    lic := d -> 'licence';
    if jsonb_typeof(lic) <> 'object' then raise exception 'The licence details must be an object'; end if;
    if nullif(btrim(coalesce(lic ->> 'number', '')), '') is null or nullif(btrim(coalesce(lic ->> 'authority', '')), '') is null
       or nullif(lic ->> 'issue_date', '') is null or nullif(lic ->> 'expiry_date', '') is null then
      raise exception 'Enter the licence number, issue date, expiry date and authority';
    end if;
    v_issue := (lic ->> 'issue_date')::date; v_expiry := (lic ->> 'expiry_date')::date;
    if v_expiry < v_issue then raise exception 'The licence expiry cannot be before its issue date'; end if;
    -- Client Master keeps UAE dates as DD/MM/YYYY.
    perform client_master_save(s.client_id, jsonb_build_object('Trade License Number', btrim(lic ->> 'number'), 'License Issuing Authority', btrim(lic ->> 'authority'),
            'License Issue Date', to_char(v_issue, 'DD/MM/YYYY'), 'License Expiry Date', to_char(v_expiry, 'DD/MM/YYYY')));
  end if;
  update business_setup_services set status = 'Completed', completed_at = now(), started_at = coalesce(started_at, now()),
      output_details = d, expiry_date = coalesce(v_expiry, expiry_date)
    where id = s.id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, s.status, 'Completed', v_reason);
  perform business_setup_audit('business_setup_services', s.id::text, 'service_complete', null,
          jsonb_build_object('client_id', s.client_id, 'from_status', s.status, 'without_output', v_no_output, 'start_override', v_start_override,
                             'detail_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(d) key), 'reason', v_reason));
  update business_setup_service_checkpoints set status = 'Not Applicable', reason = 'Not needed', updated_at = now()
   where service_id = s.id and requirement = 'Optional' and status <> 'Completed' and status <> 'Not Applicable';
end $$;

-- ── As in 019, plus each service's progress and the money, for Pipeline and Completion ──
create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'assigned' then array['Lead', 'Review']
    when 'leads' then array['Lead', 'Review']
    when 'inputs' then array['Lead', 'Review']
    when 'onboarding' then array['Onboarding']
    when 'pipeline' then array['Pipeline']
    when 'completion' then array['Completion', 'With Accounts']
    when 'closed' then array['Lost']
    when 'documentation' then array['Onboarding']
    when 'cases' then array['Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use assigned, leads, inputs, onboarding, pipeline, completion or closed', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'referred_by_name', case when (to_jsonb(c) ->> 'referred_by') is not null then business_setup_person_name((to_jsonb(c) ->> 'referred_by')::uuid) end,
      'docs', business_setup_case_docs(c.id),
      'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'status', s.status, 'progress', business_setup_service_progress(s.id), 'next_due', (select min(x.due_date) from business_setup_service_checkpoints x where x.service_id = s.id and x.status not in ('Completed', 'Not Applicable'))) order by s.created_at), '[]'::jsonb)
                     from business_setup_services s where s.quote_id in (select q.id from hub_documents q where q.case_id = c.id and q.doc_type = 'quote')),
      'quote_total', (select q.total_amount from hub_documents q where q.case_id = c.id and q.doc_type = 'quote' and q.status = 'accepted' limit 1),
      'net_paid', business_setup_case_net_paid(c.id),
      'invoices', (select count(*) from business_setup_invoices i where i.case_id = c.id),
      'claims_pending', (select count(*) from business_setup_payment_claims cl where cl.case_id = c.id and cl.status = 'Pending'),
      'intake_pending', exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null),
      'form_id', (select f.id from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'form_status', (select f.status from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))
          or exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null)));
end $$;

-- ── As in 018, plus each service's items and progress. Labels and statuses only ──
create or replace function public.business_setup_portal_view(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'progress', business_setup_service_progress(s.id),
             'items', (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'status', x.status) order by x.sort_order), '[]'::jsonb) from business_setup_service_checkpoints x where x.service_id = s.id), 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client and not s.historical),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'total', q.total_amount,
                  'net_paid', case when q.status in ('issued', 'accepted') then business_setup_net_paid(q.id) end, 'outstanding', case when q.status in ('issued', 'accepted') then greatest(q.total_amount - business_setup_net_paid(q.id), 0) end, 'has_file', q.storage_path is not null,
                  'closed', exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'signed', (select jsonb_build_object('status', s.status, 'date', s.created_at::date, 'note', case when s.status = 'Refused' then s.note end)
                               from business_setup_signed_quotes s where s.quote_id = q.id order by s.created_at desc limit 1),
                  'expired', q.status = 'issued' and q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date,
                  'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                 from business_setup_acceptances a where a.document_id = q.id order by a.created_at desc limit 1),
                  'can_decide', q.status = 'issued' and not (q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date)
                                and not exists (select 1 from business_setup_acceptances a where a.document_id = q.id)
                                and not exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'signed_at', l.signed_at, 'has_file', l.storage_path is not null,
                                      'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                                     from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                                      'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                                    and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')))
                               from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter' and l.status <> 'superseded' order by l.created_at desc limit 1)) order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q
                where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'date', y.paid_on, 'amount', y.amount, 'type', y.type, 'reference', y.reference,
                    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'has_file', r.storage_path is not null) order by y.paid_on desc, y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = v_client),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.issued_on, 'amount', i.amount, 'has_file', i.file_path is not null,
                    'claim_pending', exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending'),
                    -- The rule of business_setup_portal_claim_add, so the screen shows a state instead of a button that fails: the invoice belongs to a case that is not Lost, and no claim waits.
                    -- Nothing owed, no button: the case's balance (as business_setup_case_docs: the accepted or newest live quote's total less net payments) is above zero.
                    'can_claim', coalesce((select cs.stage <> 'Lost'
                                                  and coalesce((select t.total_amount from hub_documents t where t.case_id = cs.id and t.doc_type = 'quote' and t.status not in ('superseded', 'rejected')
                                                                 order by (t.status = 'accepted') desc, t.created_at desc limit 1), 0) - business_setup_case_net_paid(cs.id) > 0
                                             from business_setup_cases cs where cs.id = coalesce(i.case_id, (select q.case_id from hub_documents q where q.id = i.quote_id))), false)
                                 and not exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending')) order by i.issued_on desc), '[]'::jsonb)
                   from business_setup_invoices i where i.client_id = v_client),
    'claims', business_setup_portal_claims(p_account),
    'letters', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'has_file', l.storage_path is not null,
                    'quote_id', q.id, 'quote_number', q.document_number,
                    'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                   from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                    'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                  and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled'))) order by l.created_at desc), '[]'::jsonb)
                  from hub_documents l join hub_documents q on q.id = l.parent_id
                 where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')
                   and l.doc_type = 'letter' and l.status <> 'superseded'),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'date', d.created_at::date) order by d.created_at desc), '[]'::jsonb)
                    from business_setup_documents d where d.client_id = v_client and d.is_output and d.client_visible));
end $$;
