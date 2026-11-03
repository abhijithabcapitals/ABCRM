-- =====================================================================
-- Accounting Base - payments, receipts, follow-ups and the job list     003
-- =====================================================================
-- Run after 002 and Voucher Base. Recording a payment writes its receipt in the same transaction, numbered from the
-- shared Template Hub counter. A mistake is fixed by a reversal row, never an edit.
-- Reads need accounts.review; every write goes through a function below, no table grants a write.
-- Audit trail triggers are attached by the live audit-trail-attach job, so none are added here.
-- Idempotent: safe to re-run. Undo with rollback/003_rollback.sql.
-- =====================================================================

-- ── Tables ───────────────────────────────────────────────────────────
create table if not exists public.accounting_payments (       -- append-only
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.accounting_jobs(id),
  paid_on date not null,
  amount numeric(18,2) not null,                             -- negative on a reversal
  method text not null check (method in ('Bank transfer','Cash','Cheque','Card','Other')),
  reference text,
  note text,                                                 -- the reason, on a reversal
  reverses_id uuid references public.accounting_payments(id),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((reverses_id is null and amount > 0) or (reverses_id is not null and amount < 0))
);
alter table public.accounting_payments add column if not exists note text;
create index if not exists accounting_payments_job_idx on public.accounting_payments (job_id);
create unique index if not exists accounting_payments_one_reversal on public.accounting_payments (reverses_id) where reverses_id is not null;
drop trigger if exists accounting_payments_immutable on public.accounting_payments;
create trigger accounting_payments_immutable before update or delete on public.accounting_payments for each row execute function public.banking_append_only();

create table if not exists public.accounting_receipts (       -- not append-only: the file path is attached later
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.accounting_payments(id),
  receipt_number text not null unique,
  issued_on date not null default public.accounting_dubai_date(),
  storage_path text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

create table if not exists public.accounting_followups (      -- append-only
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.accounting_jobs(id),
  contacted_on date not null,
  channel text not null,
  note text not null,
  next_follow_up_on date,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists accounting_followups_job_idx on public.accounting_followups (job_id, created_at);
drop trigger if exists accounting_followups_immutable on public.accounting_followups;
create trigger accounting_followups_immutable before update or delete on public.accounting_followups for each row execute function public.banking_append_only();

-- ── Access ───────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['accounting_payments','accounting_receipts','accounting_followups'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.banking_can(''accounts.review''))', t || '_read', t);
  end loop;
end $$;

-- hub_docs_read lets any signed-in user read the whole hub-documents bucket. This restrictive policy keeps receipt files
-- to accounts.review, as voucher_register_accounting_only does for their rows. storage.objects is owned by
-- supabase_storage_admin on live, so Task 10 Step 1 confirms the policy was created.
drop policy if exists hub_docs_accounting_receipts on storage.objects;
create policy hub_docs_accounting_receipts on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'hub-documents' or name not like 'Accounting/receipts/%' or public.banking_can('accounts.review'));

-- ── Receipt counters ─────────────────────────────────────────────────
-- hub_next_number keeps its serial per department and kind. The kind check allowed quote and letter only; Business Setup
-- already widened it on live, so this keeps all three.
alter table public.hub_number_counters drop constraint if exists hub_number_counters_kind_check;
alter table public.hub_number_counters add constraint hub_number_counters_kind_check check (kind in ('quote','letter','receipt'));

-- ── Voucher register: receipts register themselves ───────────────────
-- Other modules reset this check too, so each keeps the full list of sources.
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking','hub','template','business_setup','accounting'));
drop policy if exists voucher_register_read_accounting on public.voucher_register;
create policy voucher_register_read_accounting on public.voucher_register for select to authenticated
  using (source = 'accounting' and public.banking_can('accounts.review'));
-- voucher_register_read lets anyone with payments.view see every Receipt. This restrictive policy keeps Accounting receipts
-- to accounts.review, whatever the permissive ones allow.
drop policy if exists voucher_register_accounting_only on public.voucher_register;
create policy voucher_register_accounting_only on public.voucher_register as restrictive for select to authenticated
  using (source <> 'accounting' or public.banking_can('accounts.review'));

create or replace function public.accounting_voucher_from_receipt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p accounting_payments; j accounting_jobs;
begin
  select * into p from accounting_payments where id = new.payment_id;
  select * into j from accounting_jobs where id = p.job_id;
  insert into voucher_register (voucher_type, voucher_number, serial, department, source, source_id, client_name, issued_on, amount, status, storage_path, created_by)
  values ('Receipt', new.receipt_number, voucher_serial(new.receipt_number), 'Accounting', 'accounting', new.payment_id,
          j.client_name, p.paid_on, p.amount, 'Valid', new.storage_path, new.created_by)
  on conflict (source, voucher_type, source_id) do nothing;
  return new;
end $$;

-- A reversal marks the original receipt; the row stays.
create or replace function public.accounting_voucher_from_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reverses_id is not null then
    update voucher_register set status = 'Reversed'
     where source = 'accounting' and voucher_type = 'Receipt' and source_id = new.reverses_id;
  end if;
  return new;
end $$;

drop trigger if exists voucher_accounting_receipt on public.accounting_receipts;
create trigger voucher_accounting_receipt after insert on public.accounting_receipts
  for each row execute function public.accounting_voucher_from_receipt();
drop trigger if exists voucher_accounting_payment on public.accounting_payments;
create trigger voucher_accounting_payment after insert on public.accounting_payments
  for each row execute function public.accounting_voucher_from_payment();

-- ── Receipt numbering ────────────────────────────────────────────────
-- Adds Accounting.receipt only when absent. Every other key is kept as it is.
update public.hub_settings
   set value = value || jsonb_build_object('Accounting', coalesce(value -> 'Accounting', '{}'::jsonb)
         || jsonb_build_object('receipt', jsonb_build_object('digits', 3, 'format', 'ABC/{YYYY}/{MM}/ACR{SERIAL}', 'restart', 'never')))
 where key = 'document_numbering' and (value #> '{Accounting,receipt}') is null;

-- ── Record a payment and its receipt ─────────────────────────────────
-- p: job_id, amount, paid_on (default today, Asia/Dubai), method, reference, note.
-- The job needs a fee or an invoice, and the payment cannot exceed the balance. An advance on an unfinished job is allowed.
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

-- ── Reverse a payment ────────────────────────────────────────────────
-- Adds a negative row for the same amount. The payment and its receipt stay; the receipt shows as Reversed.
-- Only a payment can be reversed, and only once.
create or replace function public.accounting_payment_reverse(p_payment uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare o accounting_payments; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform banking_require('accounts.review');
  select * into o from accounting_payments where id = p_payment;
  if o.id is null then raise exception 'Payment not found'; end if;
  if o.reverses_id is not null then raise exception 'A reversal cannot be reversed: record the payment again instead'; end if;
  if v_reason is null then raise exception 'Give a reason for the reversal'; end if;
  perform 1 from accounting_jobs where id = o.job_id for update;     -- same lock as recording
  if exists (select 1 from accounting_payments where reverses_id = o.id) then raise exception 'This payment already has a reversal'; end if;
  insert into accounting_payments (job_id, paid_on, amount, method, reference, note, reverses_id)
  values (o.job_id, accounting_dubai_date(), -o.amount, o.method, o.reference, v_reason, o.id);
  perform accounting_job_event(o.job_id, 'Payment reversed', o.amount::text, null, v_reason);
end $$;

-- ── Receipt file ─────────────────────────────────────────────────────
-- Records where the generated receipt file is stored, on the receipt and in the voucher register.
create or replace function public.accounting_receipt_attach(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r accounting_receipts; v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform banking_require('accounts.review');
  select * into r from accounting_receipts where id = p_id;
  if r.id is null then raise exception 'Receipt not found'; end if;
  if v_path is null then raise exception 'A file path is required'; end if;
  update accounting_receipts set storage_path = v_path where id = r.id;
  update voucher_register set storage_path = v_path where source = 'accounting' and voucher_type = 'Receipt' and source_id = r.payment_id;
end $$;

-- ── Follow-ups ───────────────────────────────────────────────────────
-- p: job_id, contacted_on (default today), channel, note, next_follow_up_on (optional, not in the past).
-- The job keeps the latest next date. The job's version stamp is not moved, so a follow-up never blocks an edit.
create or replace function public.accounting_followup_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_today date := accounting_dubai_date(); v_job uuid := nullif(p ->> 'job_id', '')::uuid;
  v_on date := coalesce(nullif(p ->> 'contacted_on', '')::date, accounting_dubai_date());
  v_next date := nullif(p ->> 'next_follow_up_on', '')::date;
  v_channel text := nullif(btrim(coalesce(p ->> 'channel', '')), ''); v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
  v_id uuid; j accounting_jobs;
begin
  perform banking_require('accounts.review');
  select * into j from accounting_jobs where id = v_job for update;
  if j.id is null then raise exception 'Job not found'; end if;
  if v_on > v_today then raise exception 'The contact date cannot be in the future'; end if;
  if v_channel is null then raise exception 'Choose how the client was contacted (channel)'; end if;
  if v_note is null then raise exception 'Add a note saying what was said'; end if;
  if v_next is not null and v_next < v_today then raise exception 'The next follow-up date cannot be in the past'; end if;
  insert into accounting_followups (job_id, contacted_on, channel, note, next_follow_up_on)
  values (j.id, v_on, v_channel, v_note, v_next) returning id into v_id;
  update accounting_jobs set next_follow_up_on = v_next where id = j.id;
  perform accounting_job_event(j.id, 'Follow-up logged', null, v_next::text, v_channel || ': ' || v_note);
  return v_id;
end $$;

-- ── Client options ───────────────────────────────────────────────────
-- client_lookup returns Client Master rows only under kyc.view, which ACCOUNTS does not hold. This gives accounts.review the
-- client master alone, under the same keys as client_lookup rank 1 rows.
create or replace function public.accounting_client_options() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('accounts.review');
  return (select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select 1 as rank, m.client_id as ref, m.legal_name as name, client_master_plain(m.data ->> 'Client Legal Name') as legal_name, client_master_plain(m.data ->> 'Trade Name') as trade_name,
           client_master_plain(split_part(m.data ->> 'Primary Contact', ';', 1)) as contact, client_master_plain(m.data ->> 'General Email') as email, client_master_plain(m.data ->> 'General Phone') as phone,
           client_master_plain(m.data ->> 'Registered Address') as address, client_master_plain(m.data ->> 'Trade License Number') as license, client_master_plain(m.data ->> 'TRN') as trn
      from client_master m order by m.legal_name, m.client_id
  ) t);
end $$;

-- ── Job list ─────────────────────────────────────────────────────────
-- Amount due, payments, balance and payment status, worked out in one place so the list, the Follow-ups tab and the badge agree.
-- security_invoker: the table policies decide who sees rows. Replaced, not dropped, so anything built on its row type keeps working. The job columns come first through j.*,
-- so a new column on accounting_jobs needs the view dropped and created again.
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
revoke all on public.accounting_job_list from anon, authenticated;
grant select on public.accounting_job_list to authenticated;

-- ── Who may run what ─────────────────────────────────────────────────
revoke all on function public.accounting_voucher_from_receipt(), public.accounting_voucher_from_payment() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['accounting_payment_add(jsonb)','accounting_payment_reverse(uuid,text)','accounting_receipt_attach(uuid,text)','accounting_followup_add(jsonb)','accounting_client_options()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
