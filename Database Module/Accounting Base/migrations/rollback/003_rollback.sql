-- Undoes 003_payments_followups.sql. Destroys every payment, receipt and follow-up, and the Accounting rows in the voucher register,
-- so export them first. Roll back anything built on 003 before this.
-- Accounting.receipt is removed from hub_settings unconditionally, even if someone changed it: Task 10 saves the setting first.
-- Kept: the 'Payment recorded' and 'Follow-up logged' rows in accounting_job_events, and next_follow_up_on on jobs.
-- Kept: the 'receipt' kind on hub_number_counters (Business Setup receipt counters exist, so the check is not narrowed).
drop view if exists public.accounting_job_list;
drop function if exists public.accounting_client_options();
drop policy if exists hub_docs_accounting_receipts on storage.objects;
drop function if exists public.accounting_followup_add(jsonb);
drop function if exists public.accounting_receipt_attach(uuid, text);
drop function if exists public.accounting_payment_reverse(uuid, text);
drop function if exists public.accounting_payment_add(jsonb);
drop trigger if exists voucher_accounting_payment on public.accounting_payments;
drop trigger if exists voucher_accounting_receipt on public.accounting_receipts;
drop function if exists public.accounting_voucher_from_payment();
drop function if exists public.accounting_voucher_from_receipt();
drop table if exists public.accounting_followups;
drop table if exists public.accounting_receipts;
drop table if exists public.accounting_payments;
-- Voucher register: back to the four sources that existed before 003.
drop policy if exists voucher_register_accounting_only on public.voucher_register;
drop policy if exists voucher_register_read_accounting on public.voucher_register;
delete from public.voucher_register where source = 'accounting';
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking','hub','template','business_setup'));
-- Receipt numbering: remove the setting this migration added. Quote and every other key stay.
update public.hub_settings set value = value #- '{Accounting,receipt}' where key = 'document_numbering';
