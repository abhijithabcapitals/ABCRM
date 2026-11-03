-- =====================================================================
-- Business Setup Base - payments and receipts                          007
-- =====================================================================
-- Re-runnable. Runs after 003, 004, 006 and Voucher Base. Recording a payment writes its receipt in the same
-- transaction, numbered from the shared Template Hub counter. A mistake is fixed by a reversal entry, never an edit.
-- Each function writes one business_setup_audit_log row. No client data and no amounts live in this file.
-- =====================================================================

-- ── Voucher register: receipts register themselves ───────────────────
-- Voucher Base 002 resets this check on each run, so this migration sets it again after it.
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking', 'hub', 'template', 'business_setup'));
drop policy if exists voucher_register_read_business_setup on public.voucher_register;
create policy voucher_register_read_business_setup on public.voucher_register for select to authenticated
  using (source = 'business_setup' and public.business_setup_can('setup.access'));

create or replace function public.voucher_from_business_setup_receipt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p business_setup_payments;
begin
  select * into p from business_setup_payments where id = new.payment_id;
  insert into voucher_register (voucher_type, voucher_number, serial, department, source, source_id, client_name, issued_on, amount, status, storage_path, local_path, created_by)
  values ('Receipt', new.receipt_number, voucher_serial(new.receipt_number), 'Business Setup', 'business_setup', new.payment_id,
          (select legal_name from client_master where client_id = p.client_id), p.paid_on, p.amount, 'Valid', new.storage_path, new.local_path, new.created_by)
  on conflict (source, voucher_type, source_id) do nothing;
  return new;
end $$;

-- A reversal marks the original receipt; the row stays.
create or replace function public.voucher_from_business_setup_payment() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.type = 'Reversal' and new.reverses_id is not null then
    update voucher_register set status = 'Reversed'
     where source = 'business_setup' and voucher_type = 'Receipt' and source_id = new.reverses_id;
  end if;
  return new;
end $$;

drop trigger if exists voucher_business_setup_receipt on public.business_setup_receipts;
create trigger voucher_business_setup_receipt after insert on public.business_setup_receipts
  for each row execute function public.voucher_from_business_setup_receipt();
drop trigger if exists voucher_business_setup_payment on public.business_setup_payments;
create trigger voucher_business_setup_payment after insert on public.business_setup_payments
  for each row execute function public.voucher_from_business_setup_payment();

-- Same as Voucher Base 002, plus Business Setup receipts: the PC location goes to the receipt row.
create or replace function public.voucher_set_local(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v voucher_register;
begin
  select * into v from voucher_register where id = p_id for update;
  if v.id is null or not (v.source in ('hub', 'template')
     or (v.source = 'business_setup' and business_setup_can('setup.access'))
     or (v.voucher_type = 'Receipt' and v.source = 'banking' and banking_can('payments.view'))
     or (v.voucher_type = 'Quotation' and banking_can('quotes.view'))
     or (v.voucher_type = 'Engagement Letter' and banking_can('agreements.view'))) then raise exception 'Record not found'; end if;
  if coalesce(p_path, '') = '' then raise exception 'Path is required'; end if;
  if v.local_path is not null then return; end if;
  if v.source = 'hub' then update hub_documents set local_path = p_path where id = v.source_id;
  elsif v.source = 'banking' then update banking_generated_documents set local_path = p_path where storage_path = v.storage_path;
  elsif v.source = 'business_setup' then update business_setup_receipts set local_path = p_path where payment_id = v.source_id; end if;
  update voucher_register set local_path = p_path where id = p_id;
end $$;

-- ── Quote lock ───────────────────────────────────────────────────────
-- True when Accounts holds any service of the quote. Task 7 (handover) extends this one function; payments only ask it.
-- Used inside the functions below; not callable from the API.
create or replace function public.business_setup_quote_locked(p_quote uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from business_setup_services where quote_id = p_quote and locked)
$$;

-- ── Balance ──────────────────────────────────────────────────────────
create or replace function public.business_setup_quote_balance(p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_total numeric; v_paid numeric;
begin
  perform business_setup_require('setup.access');
  select total_amount into v_total from hub_documents where id = p_quote and doc_type = 'quote' and department = 'Business Setup';
  if not found then raise exception 'Quote not found'; end if;
  v_paid := business_setup_net_paid(p_quote);
  return jsonb_build_object('total', v_total, 'net_paid', v_paid, 'outstanding', v_total - v_paid);
end $$;

-- ── Record a payment and its receipt ─────────────────────────────────
-- p: quote_id, amount, paid_on (default today, Asia/Dubai), method, reference, note, override_reason.
-- Above the outstanding balance it is refused, unless the user holds setup.payments.override and gives override_reason.
create or replace function public.business_setup_payment_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_today date := (now() at time zone 'Asia/Dubai')::date; v_amount numeric; v_on date;
  v_outstanding numeric; v_over boolean; v_reason text; v_note text; v_pay uuid; v_rec uuid; v_number text;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
    raise exception 'A payment can be recorded only against an accepted Business Setup quote';
  end if;
  if q.client_id is null then raise exception 'Link this quote to a client before recording a payment'; end if;
  if business_setup_quote_locked(q.id) then
    raise exception 'This quote is locked because Accounts holds it: no payment can be recorded';
  end if;
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

  v_outstanding := coalesce(q.total_amount, 0) - business_setup_net_paid(q.id);
  v_over := v_amount > v_outstanding;
  v_reason := nullif(btrim(coalesce(p ->> 'override_reason', '')), '');
  if v_over then
    if not business_setup_can('setup.payments.override') then
      raise exception 'This payment is above the balance of %: ask someone who may accept an overpayment', to_char(v_outstanding, 'FM999,999,999,990.00');
    end if;
    if v_reason is null then raise exception 'Give a reason for accepting a payment above the balance'; end if;
  end if;
  v_note := nullif(btrim(coalesce(p ->> 'note', '')), '');
  if v_over then v_note := concat_ws(E'\n', v_note, 'Above the balance: ' || v_reason); end if;

  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, note)
  values (q.client_id, q.id, v_on, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Payment', v_note)
  returning id into v_pay;
  v_number := hub_next_number('Business Setup', 'receipt');
  insert into business_setup_receipts (payment_id, receipt_number) values (v_pay, v_number) returning id into v_rec;

  perform business_setup_audit('business_setup_payments', v_pay::text, 'payment_add', null,
          jsonb_build_object('client_id', q.client_id, 'quote_id', q.id, 'amount', v_amount, 'receipt_number', v_number,
                             'overpayment', v_over, 'reason', case when v_over then v_reason end));
  return jsonb_build_object('payment_id', v_pay, 'receipt_id', v_rec, 'receipt_number', v_number);
end $$;

-- ── Reverse a payment ────────────────────────────────────────────────
-- Adds a Reversal entry for the same amount; the payment and its receipt stay, the receipt shows as Reversed.
-- Only a Payment can be reversed, and only once. Services already started stay as they are.
create or replace function public.business_setup_payment_reverse(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o business_setup_payments; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_rev uuid;
begin
  perform business_setup_require('setup.payments.manage');
  select * into o from business_setup_payments where id = p_id;
  if o.id is null then raise exception 'Payment not found'; end if;
  if o.type <> 'Payment' then raise exception 'Only a payment can have a reversal: a refund or a reversal cannot be reversed'; end if;
  if v_reason is null then raise exception 'Give a reason for the reversal'; end if;
  if o.quote_id is not null then
    perform 1 from hub_documents where id = o.quote_id for update;   -- same lock as recording, so the balance cannot move underneath
    if business_setup_quote_locked(o.quote_id) then
      raise exception 'This quote is locked because Accounts holds it: no payment can be reversed';
    end if;
  end if;
  if exists (select 1 from business_setup_payments where reverses_id = o.id) then raise exception 'This payment already has a reversal'; end if;

  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, reverses_id, note)
  values (o.client_id, o.quote_id, (now() at time zone 'Asia/Dubai')::date, o.amount, o.method, o.reference, 'Reversal', o.id, v_reason)
  returning id into v_rev;
  perform business_setup_audit('business_setup_payments', v_rev::text, 'payment_reverse', null,
          jsonb_build_object('client_id', o.client_id, 'quote_id', o.quote_id, 'amount', o.amount, 'reverses_id', o.id, 'reason', v_reason));
  return jsonb_build_object('reversal_id', v_rev, 'payment_id', o.id);
end $$;

-- ── Refund ───────────────────────────────────────────────────────────
-- Money really returned, as opposed to a reversal, which says the payment never happened. Up to the net paid on the quote.
create or replace function public.business_setup_refund_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; v_amount numeric; v_reason text; v_id uuid; v_net numeric;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid for update;
  if q.id is null or q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.client_id is null then raise exception 'Quote not found'; end if;
  if business_setup_quote_locked(q.id) then raise exception 'This quote is locked because Accounts holds it: no refund can be recorded'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'Enter an amount above zero with at most two decimals'; end if;
  v_reason := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  if v_reason is null then raise exception 'Give a reason for the refund'; end if;
  v_net := business_setup_net_paid(q.id);
  if v_amount > v_net then raise exception 'This refund is above the % paid on the quote', to_char(v_net, 'FM999,999,999,990.00'); end if;
  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, note)
  values (q.client_id, q.id, (now() at time zone 'Asia/Dubai')::date, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Refund', v_reason)
  returning id into v_id;
  perform business_setup_audit('business_setup_payments', v_id::text, 'refund_add', null, jsonb_build_object('client_id', q.client_id, 'quote_id', q.id, 'amount', v_amount, 'reason', v_reason));
  return v_id;
end $$;

-- ── Receipt file ─────────────────────────────────────────────────────
-- Records where the generated receipt file is stored, on the receipt and in the voucher register.
create or replace function public.business_setup_receipt_attach(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r business_setup_receipts; v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform business_setup_require('setup.payments.manage');
  select * into r from business_setup_receipts where id = p_id;
  if r.id is null then raise exception 'Receipt not found'; end if;
  if v_path is null then raise exception 'A file path is required'; end if;
  update business_setup_receipts set storage_path = v_path where id = r.id;
  update voucher_register set storage_path = v_path where source = 'business_setup' and voucher_type = 'Receipt' and source_id = r.payment_id;
  perform business_setup_audit('business_setup_receipts', r.id::text, 'receipt_attach', null,
          jsonb_build_object('receipt_number', r.receipt_number));
end $$;

revoke all on function public.business_setup_payment_add(jsonb), public.business_setup_payment_reverse(uuid, text), public.business_setup_receipt_attach(uuid, text), public.business_setup_refund_add(jsonb),
  public.business_setup_quote_balance(uuid), public.business_setup_quote_locked(uuid),
  public.voucher_from_business_setup_receipt(), public.voucher_from_business_setup_payment() from public, anon, authenticated;
grant execute on function public.business_setup_payment_add(jsonb), public.business_setup_payment_reverse(uuid, text), public.business_setup_receipt_attach(uuid, text), public.business_setup_refund_add(jsonb),
  public.business_setup_quote_balance(uuid) to authenticated;
