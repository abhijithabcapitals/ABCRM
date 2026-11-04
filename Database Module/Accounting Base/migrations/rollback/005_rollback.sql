-- Undoes 005_job_fee_vat.sql: the job list view, accounting_payment_add and accounting_job_link_document go back to
-- their 003 and 002 definitions, then the two 005 helper functions are dropped. Nothing else is touched.
-- Payments recorded against a fee plus VAT stay as they are. Safe to run twice.
begin;

create or replace view public.accounting_job_list with (security_invoker = true) as
select x.*,
  case
    when not x.payment_tracked and x.fee_amount is null then 'Not tracked'
    when x.fee_amount is null and x.invoice_amount is null then 'No fee'
    when x.balance < 0 then 'Overpaid'
    when x.balance = 0 then 'Settled'
    when x.paid_total > 0 then 'Part paid'
    when x.invoice_number is not null then 'Invoiced'
    else 'Not invoiced'
  end as payment_status,
  (x.work_status = 'Completed' and x.invoice_number is null and not (not x.payment_tracked and x.fee_amount is null)) as needs_invoice,
  coalesce(x.work_status = 'Completed' and x.balance > 0, false) as follow_up_listed,
  coalesce(x.work_status = 'Completed' and x.balance > 0
           and (x.next_follow_up_on is null or x.next_follow_up_on <= public.accounting_dubai_date()), false) as follow_up_due
from (
  select j.*,
         coalesce(j.invoice_amount, j.fee_amount) as amount_due,
         coalesce(pp.total, 0) as paid_total,
         coalesce(j.invoice_amount, j.fee_amount) - coalesce(pp.total, 0) as balance
    from public.accounting_jobs j
    left join lateral (select sum(amount) as total from public.accounting_payments where job_id = j.id) pp on true
) x;

create or replace function public.accounting_payment_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  j accounting_jobs; v_today date := accounting_dubai_date(); v_amount numeric; v_on date; v_method text;
  v_due numeric; v_paid numeric; v_pay uuid; v_rec uuid; v_number text; v_ref text;
begin
  perform banking_require('accounts.review');
  p := coalesce(p, '{}'::jsonb);
  select * into j from accounting_jobs where id = nullif(p ->> 'job_id', '')::uuid for update;   -- two payments cannot both pass the balance check
  if j.id is null then raise exception 'Job not found'; end if;
  v_due := coalesce(j.invoice_amount, j.fee_amount);
  if v_due is null then raise exception 'Enter the fee on this job before recording a payment'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount above zero with at most two decimals';
  end if;
  v_on := coalesce(nullif(p ->> 'paid_on', '')::date, v_today);
  if v_on > v_today then raise exception 'The payment date cannot be in the future'; end if;
  v_method := nullif(btrim(coalesce(p ->> 'method', '')), '');
  if v_method is null or v_method not in ('Bank transfer','Cash','Cheque','Card','Other') then raise exception 'Choose the payment method'; end if;
  select coalesce(sum(amount), 0) into v_paid from accounting_payments where job_id = j.id;
  if v_amount > v_due - v_paid then
    raise exception 'This payment is above the balance of %', to_char(v_due - v_paid, 'FM999,999,999,990.00');
  end if;
  v_ref := nullif(btrim(coalesce(p ->> 'reference', '')), '');

  insert into accounting_payments (job_id, paid_on, amount, method, reference, note)
  values (j.id, v_on, v_amount, v_method, v_ref, nullif(btrim(coalesce(p ->> 'note', '')), ''))
  returning id into v_pay;
  v_number := hub_next_number('Accounting', 'receipt');
  insert into accounting_receipts (payment_id, receipt_number) values (v_pay, v_number) returning id into v_rec;
  perform accounting_job_event(j.id, 'Payment recorded', null, v_amount::text, v_number);
  return jsonb_build_object('payment_id', v_pay, 'receipt_id', v_rec, 'receipt_number', v_number,
                            'amount', v_amount, 'paid_on', v_on, 'method', v_method, 'reference', v_ref);
end $$;

create or replace function public.accounting_job_link_document(p_job uuid, p_kind text, p_doc uuid, p_use_quote_total boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare j accounting_jobs; d hub_documents; v_fee numeric;
begin
  perform banking_require('accounts.review');
  if p_kind is null or p_kind not in ('quote','letter') then raise exception 'The document must be a quote or a letter'; end if;
  select * into j from accounting_jobs where id = p_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  select * into d from hub_documents where id = p_doc;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.doc_type <> p_kind then raise exception 'This document is not a %', p_kind; end if;
  if p_kind = 'letter' then
    update accounting_jobs set letter_id = p_doc, updated_at = clock_timestamp() where id = p_job;
    perform accounting_job_event(p_job, 'Letter linked', j.letter_id::text, p_doc::text, null);
    return;
  end if;
  v_fee := case when coalesce(p_use_quote_total, false) or j.fee_amount is null then coalesce(nullif(d.total_amount, 0), j.fee_amount) else j.fee_amount end;
  update accounting_jobs set quote_id = p_doc, fee_amount = v_fee, payment_tracked = payment_tracked or v_fee is not null, updated_at = clock_timestamp() where id = p_job;
  perform accounting_job_event(p_job, 'Quote linked', j.quote_id::text, p_doc::text, null);
  if v_fee is distinct from j.fee_amount then perform accounting_job_event(p_job, 'Fee changed', j.fee_amount::text, v_fee::text, 'From the quote total'); end if;
end $$;

-- The view and functions above no longer use these.
drop function if exists public.accounting_quote_vat_mode(uuid);
drop function if exists public.accounting_fee_with_vat(numeric, uuid);

commit;
