-- Undoes 015_zoho_accounting.sql. Re-runnable.
-- Rows with department 'Accounting' or source_table 'accounting_jobs' in zoho_documents must be removed first.
-- Any left behind are not checked by the restored rules (they are added NOT VALID, so this file does not fail),
-- but they would stay as rows the narrower rules do not allow, and any later edit to one of them would be refused.
-- Invoices already recorded on jobs by the function stay on the jobs and in their history.
drop function if exists public.accounting_zoho_invoice_fill(uuid, text, date, numeric, uuid);
alter table public.zoho_documents drop constraint if exists zoho_documents_department_check;
alter table public.zoho_documents add constraint zoho_documents_department_check
  check (department in ('Business Setup', 'Banking')) not valid;
alter table public.zoho_documents drop constraint if exists zoho_documents_source_table_check;
alter table public.zoho_documents add constraint zoho_documents_source_table_check
  check (source_table in ('hub_documents', 'banking_quotations')) not valid;
