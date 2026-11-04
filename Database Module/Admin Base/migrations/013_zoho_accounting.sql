-- =====================================================================
-- Admin Base - Zoho invoices for Accounting jobs                    013
-- =====================================================================
-- Order: Accounting Base 002 (accounting_jobs, accounting_job_events) and Admin Base 005 (zoho_documents) come first.
-- Widens the department and source checks on zoho_documents to take Accounting jobs, and adds the one function that
-- records a Zoho invoice on a job. The zoho-books function calls it with the service role; nobody else can.
-- The function keeps the job's rules in one place: it never replaces an invoice number already on the job, it fills
-- a job only when it is Completed and the invoice has a number, a date and an amount above zero, and it writes one
-- "Invoice recorded" history entry. It returns {"result": "recorded" | "same" | "different" | "refused"}, plus
-- "number" (the number already on the job) when different.
-- Re-runnable. Undo: rollback/013_zoho_accounting_rollback.sql
-- =====================================================================
alter table public.zoho_documents drop constraint if exists zoho_documents_department_check;
alter table public.zoho_documents add constraint zoho_documents_department_check
  check (department in ('Business Setup', 'Banking', 'Accounting'));
alter table public.zoho_documents drop constraint if exists zoho_documents_source_table_check;
alter table public.zoho_documents add constraint zoho_documents_source_table_check
  check (source_table in ('hub_documents', 'banking_quotations', 'accounting_jobs'));

create or replace function public.accounting_zoho_invoice_fill(p_job uuid, p_number text, p_date date, p_amount numeric, p_by uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; v_no text := nullif(trim(p_number), '');
begin
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if j.invoice_number is not null then
    if j.invoice_number = v_no then return jsonb_build_object('result', 'same'); end if;
    return jsonb_build_object('result', 'different', 'number', j.invoice_number);
  end if;
  if j.work_status <> 'Completed' or v_no is null or p_date is null or p_amount is null or p_amount <= 0 then
    return jsonb_build_object('result', 'refused');
  end if;
  update accounting_jobs set invoice_number = v_no, invoice_date = p_date, invoice_amount = p_amount,
         invoiced_by = p_by, invoiced_at = clock_timestamp(), payment_tracked = true, updated_at = clock_timestamp()
   where id = p_job;
  insert into accounting_job_events (job_id, event, from_value, to_value, remarks, created_by)
    values (p_job, 'Invoice recorded', null, v_no, p_amount::text || ' (Zoho)', p_by);
  return jsonb_build_object('result', 'recorded');
end $$;

revoke all on function public.accounting_zoho_invoice_fill(uuid, text, date, numeric, uuid) from public, anon, authenticated;
grant execute on function public.accounting_zoho_invoice_fill(uuid, text, date, numeric, uuid) to service_role;
