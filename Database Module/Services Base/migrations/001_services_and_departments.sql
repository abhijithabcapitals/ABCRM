-- =====================================================================
-- Services Base - services and the departments that handle them    001
-- =====================================================================
-- service_departments lists the departments; service_categories maps each service group to one;
-- service_items lists the services. Re-runnable: rows edited later are not overwritten.
-- =====================================================================
create table if not exists public.service_departments (
  name text primary key,
  crm_tab text not null,
  sort_order int not null default 0
);
insert into public.service_departments (name, crm_tab, sort_order) values
  ('Business Setup', 'Business Setup', 1), ('Accounting', 'Accounting', 2), ('Tax Compliance', 'Tax Compliance', 3), ('Business Banking', 'Business Banking', 4)
on conflict (name) do nothing;
create table if not exists public.service_categories (
  id uuid primary key default gen_random_uuid(),
  sort_order int not null unique,
  name text not null unique,
  department text not null references public.service_departments(name),
  focus text,
  limitation text,                                -- extra wording for the engagement letter
  is_active boolean not null default true
);
create table if not exists public.service_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.service_categories(id),
  name text not null,
  sort_order int not null default 0,
  is_active boolean not null default true,
  unique (category_id, name)
);
do $$
declare t text;
begin
  foreach t in array array['service_departments','service_categories','service_items'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;

create or replace function pg_temp.seed_services(p_order int, p_name text, p_dept text, p_focus text, p_limitation text, p_services text[]) returns void
language plpgsql as $$
declare c uuid; s text; n int := 0;
begin
  insert into public.service_categories (sort_order, name, department, focus, limitation) values (p_order, p_name, p_dept, p_focus, p_limitation)
  on conflict (name) do nothing;
  select id into c from public.service_categories where name = p_name;
  foreach s in array p_services loop
    n := n + 1;
    insert into public.service_items (category_id, name, sort_order) values (c, s, n) on conflict do nothing;
  end loop;
end $$;

select pg_temp.seed_services(1, 'Company Formation & Business Setup', 'Business Setup', 'Mainland, Free Zone and Offshore Company Formation', null, array['UAE Mainland Company Formation','UAE Free Zone Company Formation','Offshore Company Formation','Dubai Company Formation','Sharjah Company Formation','Abu Dhabi Company Formation','Other Emirates Company Formation','Commercial Licence','Professional Licence','Industrial Licence','Trading Licence','Freelance Permit','Branch Office Establishment','Company Structure Advisory','Business Activity Selection','Trade Licence Issuance','Trade Licence Renewal','Trade Licence Amendment','Shareholder and Partner Amendments','Company Name Reservation','Memorandum of Association (MOA) Preparation','Establishment Card Processing','Office and Flexi-Desk Arrangements','Company Relocation and Restructuring']);
select pg_temp.seed_services(2, 'Corporate Banking & Financial Services', 'Business Banking', 'Corporate Bank Accounts, Business Loans and Banking Solutions', 'Bank account opening, financing and merchant facilities are decided solely by the bank or provider.', array['Corporate Bank Account Opening','Personal Bank Account Opening','UAE Business Banking Solutions','International Business Banking Assistance','Offshore Bank Account Assistance','Bank Account Application Preparation','Bank KYC Documentation','Bank Compliance Documentation','Bank Account Reapplication Assistance','Banking Relationship Management','Merchant Account Assistance','Payment Gateway Assistance','Business Loan Assistance','Working Capital Finance Assistance','Banking Solutions Advisory']);
select pg_temp.seed_services(3, 'Accounting & Bookkeeping', 'Accounting', 'Accounting, Bookkeeping, MIS and Financial Statements', null, array['Accounting Services','Bookkeeping Services','Monthly Bookkeeping','Quarterly Bookkeeping','Annual Accounting','Financial Statement Preparation','Profit & Loss Account Preparation','Balance Sheet Preparation','Cash Flow Statements','Bank Reconciliation','Accounts Payable Management','Accounts Receivable Management','General Ledger Maintenance','Fixed Asset Register Maintenance','Management Accounts','Monthly MIS Reporting','Financial Reporting','Financial Consolidation Assistance','Accounting Software Setup','Accounting System Implementation','Historical Accounting Cleanup','Outsourced Accounting','Part-Time CFO Services']);
select pg_temp.seed_services(4, 'UAE Corporate Tax Services', 'Tax Compliance', 'Corporate Tax Registration, Filing and Advisory', 'The client remains responsible for its tax position. Decisions rest with the Federal Tax Authority.', array['Corporate Tax Registration','Corporate Tax Deregistration','Corporate Tax Return Preparation','Corporate Tax Return Filing','Corporate Tax Advisory','Corporate Tax Planning','Corporate Tax Impact Assessment','Corporate Tax Compliance Review','Small Business Relief Assessment','Free Zone Corporate Tax Advisory','Qualifying Free Zone Person Assessment','Tax Grouping Advisory','Related Party and Connected Person Analysis','Transfer Pricing Documentation Assistance','Tax Computation','Tax Reconciliation','Tax Health Checks','Corporate Tax Audit Support','Voluntary Disclosure Assistance','FTA Tax Correspondence Assistance']);
select pg_temp.seed_services(5, 'UAE VAT Services', 'Tax Compliance', 'VAT Registration, Filing and Compliance', 'The client remains responsible for its tax position. Decisions rest with the Federal Tax Authority.', array['VAT Registration','VAT Deregistration','VAT Return Preparation','VAT Return Filing','VAT Refund Assistance','VAT Compliance Review','VAT Health Check','VAT Advisory','VAT Planning','VAT Reconciliation','Input VAT Review','Output VAT Review','VAT Group Registration','VAT Group Deregistration','VAT Voluntary Disclosure','VAT Penalty Reconsideration Assistance','VAT Record-Keeping','VAT Accounting Implementation','VAT Training and Consultation']);
select pg_temp.seed_services(6, 'Audit & Assurance Services', 'Accounting', 'Internal Audit, External Audit and Assurance', 'Audit execution and signing are undertaken by appropriately licensed and qualified audit professionals.', array['External Audit Coordination','Statutory Audit Assistance','Internal Audit','Financial Audit','Operational Audit','Compliance Audit','Internal Control Review','Financial Statement Audit Support','Audit Preparation','Audit Documentation','Financial Due Diligence','Audit Coordination with Approved Auditors','Audit Report Assistance']);
select pg_temp.seed_services(7, 'UAE E-Invoicing Services', 'Tax Compliance', 'E-Invoicing, ASP Services and Implementation', null, array['E-Invoicing Applicability Assessment','E-Invoicing Readiness Assessment','Revenue Threshold Assessment','E-Invoicing Deadline Assessment','Business Transaction Mapping','B2B and B2G Transaction Assessment','Existing Invoicing System Assessment','ERP and Accounting Software Compatibility','VAT Tax Code Mapping','E-Invoicing Implementation','ASP Onboarding','E-Invoicing System Integration','E-Invoicing Compliance Advisory','E-Invoicing Training','E-Invoicing Ongoing Support']);
select pg_temp.seed_services(8, 'PRO, Visa & Immigration Services', 'Business Setup', 'PRO, Visas, Immigration and Government Services', 'Visa, permit and government approvals are decided solely by the relevant authority.', array['Investor Visa Processing','Partner Visa Processing','Employment Visa Processing','Employee Visa Renewal','Family Visa Processing','Dependent Visa Processing','Golden Visa Assistance','Emirates ID Processing','Medical Fitness Coordination','Visa Cancellation','Establishment Card Processing','Immigration File Opening','Labour File Registration','Labour Contract Processing','Work Permit Assistance','PRO Services','Government Document Processing']);
select pg_temp.seed_services(10, 'Company Liquidation & Corporate Changes', 'Business Setup', 'Company Liquidation, Closure and Amendments', null, array['Mainland Company Liquidation','Free Zone Company Liquidation','Offshore Company Liquidation','Trade Licence Cancellation','VAT Deregistration','Corporate Tax Deregistration','Establishment Card Cancellation','Visa Cancellation','Employee Clearance','Shareholder Amendments','Director Amendments','Company Name Amendments','Business Activity Amendments','Company Restructuring','Company Migration Assistance']);
select pg_temp.seed_services(11, 'Business Advisory & Consultancy', 'Accounting', 'Business Plans, Feasibility Studies and CFO Services', 'Forecasts and advice rest on information available at the time. They are not a guarantee of results or regulated investment advice.', array['Business Consultancy','Business Plan Preparation','Feasibility Studies','Financial Feasibility Analysis','Business Valuation Assistance','Financial Forecasting','Cash Flow Forecasting','Budget Preparation','Financial Management Advisory','Corporate Finance Advisory','Business Expansion Advisory','Investment Advisory Support','Business Performance Analysis','Management Consultancy','Strategic Business Planning','Outsourced CFO Advisory']);
select pg_temp.seed_services(9, 'Corporate Secretarial & Compliance Services', 'Business Setup', 'AML/CFT, UBO and Corporate Governance', null, array['Company Secretary Services','Corporate Governance Advisory','Board Resolution Preparation','Shareholder Resolution Preparation','Statutory Documentation','Corporate Record Maintenance','Director and Shareholder Changes','Beneficial Ownership (UBO) Compliance','AML/CFT Compliance Support','Economic Substance Compliance Assessment','Regulatory Compliance Advisory','Annual Compliance Calendar Management']);
select pg_temp.seed_services(12, 'Tax Residency & International Business Services', 'Tax Compliance', 'Tax Residency Certificates and International Tax Advisory', 'Tax residency certificates are decided by the issuing authority. Foreign law matters may need local advisers.', array['UAE Tax Residency Certificate Assistance','Individual Tax Residency Assistance','Corporate Tax Residency Assistance','International Tax Advisory','Cross-Border Business Structuring','International Company Formation Assistance','Offshore Corporate Structuring','Double Tax Treaty Advisory','International Business Expansion Support']);
