-- =====================================================================
-- Business Setup Base - suggested fee amounts and per-item VAT   015
-- =====================================================================
-- Fee items may have no amount, carry a VAT rate (5 or 0) and say whether they are a service (is_service). Business Setup quotes
-- sum VAT line by line, from the fee item's rate read on the server. Other departments calculate exactly as before.
-- A quote is accepted only on a confirmed signed copy, a payment can be recorded on a case before any quote, and the engagement
-- letter waits for an accepted quote only: a payment blocks nothing, and there is no paid override. A quote line whose fee item is not a
-- service (a cost passed on to the client) is billed but creates no service when the quote is accepted.
-- Run after 014. Re-runnable. Undo with rollback/015_018_rollback.sql (phase 2 only, with 018) or rollback/013_019_rollback.sql (every case migration).
-- hub_document_create is redefined from 014 and business_setup_client_list from 008: run this file again whenever 004, 008, 013 or 014 is re-run.
-- Documentation holds four items: quote, signed (accepted), letter and invoice. A hand-recorded invoice meets the Invoice item, or the Invoice override does (case_docs, below).
-- =====================================================================

-- ── Fee items ────────────────────────────────────────────────────────
-- default_amount may be empty (the >= 0 check stays; a null passes it). vat_rate is 5 or 0.
alter table public.business_setup_fee_items alter column default_amount drop not null;
alter table public.business_setup_fee_items add column if not exists vat_rate numeric(5,2) not null default 5 check (vat_rate in (0, 5));

-- is_service: false for a fee item that is only a cost billed to the client (it creates no service when a quote is accepted). Every item that
-- exists when the column is first added is set to false, which matches the 24 items of the first release; the update runs only on that first run,
-- so running this file again never flips a row added or edited later.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'business_setup_fee_items' and column_name = 'is_service') then
    alter table public.business_setup_fee_items add column is_service boolean not null default true;
    update public.business_setup_fee_items set is_service = false;
  end if;
end $$;

-- Add or edit a fee item (p.id edits; otherwise group + name is the key). An empty default_amount means no stored amount.
create or replace function public.business_setup_fee_item_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_amount numeric; v_rate numeric; v_svc boolean;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
  -- is_service: true for a service, false for a cost billed to the client. Left as it is when the key is absent.
  if p ? 'is_service' then
    begin v_svc := (p ->> 'is_service')::boolean; exception when others then v_svc := null; end;
    if v_svc is null then raise exception 'Say whether the fee item is a service: yes or no'; end if;
  end if;
  v_amount := nullif(btrim(coalesce(p ->> 'default_amount', '')), '')::numeric;
  if v_amount < 0 then raise exception 'The fee amount cannot be negative'; end if;
  v_rate := nullif(btrim(coalesce(p ->> 'vat_rate', '')), '')::numeric;
  if p ? 'vat_rate' and (v_rate is null or v_rate not in (0, 5)) then raise exception 'The VAT rate must be 0 or 5'; end if;
  if nullif(btrim(coalesce(p ->> 'grp', '')), '') is null then raise exception 'The fee group is required'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'The fee name is required'; end if;
  if nullif(p ->> 'id', '') is not null then
    v_id := (p ->> 'id')::uuid;
    update business_setup_fee_items set
        grp = btrim(p ->> 'grp'), name = btrim(p ->> 'name'),
        default_amount = case when p ? 'default_amount' then v_amount else default_amount end,
        vat_rate = case when p ? 'vat_rate' then v_rate else vat_rate end,
        service_item_id = case when p ? 'service_item_id' then nullif(p ->> 'service_item_id', '')::uuid else service_item_id end,
        active = case when p ? 'active' then coalesce((p ->> 'active')::boolean, active) else active end,
        sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::int, sort_order) else sort_order end,
        is_service = coalesce(v_svc, is_service)
      where id = v_id;
    if not found then raise exception 'Fee item not found'; end if;
  else
    insert into business_setup_fee_items (grp, name, default_amount, vat_rate, service_item_id, active, sort_order, is_service)
    values (btrim(p ->> 'grp'), btrim(p ->> 'name'), v_amount, coalesce(v_rate, 5), nullif(p ->> 'service_item_id', '')::uuid,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::int, 0), coalesce(v_svc, true))
    on conflict (grp, name) do update set default_amount = case when p ? 'default_amount' then excluded.default_amount else business_setup_fee_items.default_amount end,
        vat_rate = case when p ? 'vat_rate' then excluded.vat_rate else business_setup_fee_items.vat_rate end,
        service_item_id = coalesce(excluded.service_item_id, business_setup_fee_items.service_item_id),
        active = excluded.active, sort_order = excluded.sort_order, is_service = case when p ? 'is_service' then excluded.is_service else business_setup_fee_items.is_service end
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_fee_items', v_id::text, 'fee_item_save', null, jsonb_build_object('grp', p ->> 'grp', 'name', p ->> 'name'));
  return v_id;
end $$;
revoke all on function public.business_setup_fee_item_save(jsonb) from public, anon;
grant execute on function public.business_setup_fee_item_save(jsonb) to authenticated;

-- ── Signed copies of quotes ──────────────────────────────────────────
-- The client (or staff for them) uploads the signed quote; staff confirm it, which accepts the quote, or refuse it with a note the
-- client can read. Legacy rows stand for quotes accepted before signed copies were required: no file, honestly empty path.
create table if not exists public.business_setup_signed_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.hub_documents(id),
  storage_path text,
  source text not null check (source in ('Client', 'Staff', 'Legacy')),
  status text not null check (status in ('Uploaded', 'Confirmed', 'Refused')),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  decided_at timestamptz,
  decided_by uuid,
  check ((source = 'Legacy') = (storage_path is null)),
  check (source <> 'Legacy' or status = 'Confirmed')
);
create unique index if not exists business_setup_signed_path_uq on public.business_setup_signed_quotes (storage_path) where storage_path is not null;
create unique index if not exists business_setup_signed_one_open on public.business_setup_signed_quotes (quote_id) where status = 'Uploaded';
create unique index if not exists business_setup_signed_one_confirmed on public.business_setup_signed_quotes (quote_id) where status = 'Confirmed';
alter table public.business_setup_signed_quotes enable row level security;
drop policy if exists business_setup_signed_read on public.business_setup_signed_quotes;
create policy business_setup_signed_read on public.business_setup_signed_quotes for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_signed_quotes from anon, authenticated;
grant select on public.business_setup_signed_quotes to authenticated;

-- A quote accepted before this migration counts as signed. No file is invented for it.
insert into public.business_setup_signed_quotes (quote_id, source, status, note, decided_at)
select q.id, 'Legacy', 'Confirmed', 'Accepted before signed copies were required', now()
  from public.hub_documents q
 where q.doc_type = 'quote' and q.department = 'Business Setup' and q.status = 'accepted'
   and not exists (select 1 from public.business_setup_signed_quotes s where s.quote_id = q.id and s.status = 'Confirmed');

-- Staff add a signed copy for the client. The file is already in storage under staff/<client>/ (the staff upload policy of 014).
create or replace function public.business_setup_signed_add(p_quote uuid, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; v_path text := nullif(btrim(coalesce(p_path, '')), ''); v_prefix text; v_id uuid;
begin
  perform business_setup_require('setup.quotes.manage');
  if v_path is null then raise exception 'Enter the file path'; end if;
  select * into q from hub_documents where id = p_quote for update;
  if q.id is null or q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Quote not found'; end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can take a signed copy (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before adding its signed copy'; end if;
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is closed and its quote cannot take a signed copy';
  end if;
  v_prefix := 'staff/' || q.client_id || '/';
  if not coalesce(left(v_path, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_path, '/')) or '' = any (string_to_array(v_path, '/')) then
    raise exception 'The file path must be under staff/%/ and cannot contain .. or empty parts', q.client_id;
  end if;
  if exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Uploaded') then
    raise exception 'A signed copy of this quote is already waiting for review: confirm or refuse it first';
  end if;
  begin
    insert into business_setup_signed_quotes (quote_id, storage_path, source, status) values (q.id, v_path, 'Staff', 'Uploaded') returning id into v_id;
  exception when unique_violation then raise exception 'A signed copy is already stored at that path';
  end;
  perform business_setup_audit('business_setup_signed_quotes', v_id::text, 'signed_add', null, jsonb_build_object('quote_id', q.id, 'source', 'Staff'));
  return v_id;
end $$;

-- Where a signed copy is stored, for staff to open it. A legacy row has no file.
create or replace function public.business_setup_signed_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare s business_setup_signed_quotes;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into s from business_setup_signed_quotes where id = p_id;
  if s.id is null then raise exception 'Signed copy not found'; end if;
  if s.storage_path is null then raise exception 'This quote was accepted before signed copies were kept: there is no file'; end if;
  return jsonb_build_object('path', s.storage_path, 'file_name', regexp_replace(s.storage_path, '^.*/', ''));
end $$;

-- Confirm (which accepts the quote and creates its services) or refuse with a note the client can read.
-- Locks the chain root and the quote first, as an accept and a revision do, so none of them can deadlock.
create or replace function public.business_setup_signed_decide(p_id uuid, p_confirm boolean, p_note text, p_allow_expired boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_signed_quotes; q hub_documents; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform business_setup_require('setup.quotes.manage');
  select * into s from business_setup_signed_quotes where id = p_id;
  if s.id is null then raise exception 'Signed copy not found'; end if;
  select * into q from hub_documents where id = s.quote_id;
  perform 1 from hub_documents where id = coalesce(q.root_quote_id, q.id) for update;
  perform 1 from hub_documents where id = q.id for update;
  select * into s from business_setup_signed_quotes where id = p_id for update;
  if s.status <> 'Uploaded' then raise exception 'This signed copy has already been %', lower(s.status); end if;
  if p_confirm is null then raise exception 'Choose to confirm or refuse the signed copy'; end if;
  if p_confirm then
    update business_setup_signed_quotes set status = 'Confirmed', note = v_note, decided_at = now(), decided_by = auth.uid() where id = s.id;
    perform business_setup_quote_accept(q.id, coalesce(p_allow_expired, false));
  else
    if v_note is null then raise exception 'Tell the client why the signed copy is refused'; end if;
    update business_setup_signed_quotes set status = 'Refused', note = v_note, decided_at = now(), decided_by = auth.uid() where id = s.id;
  end if;
  perform business_setup_audit('business_setup_signed_quotes', s.id::text, 'signed_decide', jsonb_build_object('status', s.status),
          jsonb_build_object('quote_id', q.id, 'confirmed', p_confirm, 'note', v_note));
end $$;
revoke all on function public.business_setup_signed_add(uuid, text), public.business_setup_signed_file(uuid), public.business_setup_signed_decide(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.business_setup_signed_add(uuid, text), public.business_setup_signed_file(uuid), public.business_setup_signed_decide(uuid, boolean, text, boolean) to authenticated;

-- ── Accepting a quote ────────────────────────────────────────────────
-- As in 014, plus: refused without a confirmed signed copy. The check comes last, so every earlier refusal keeps its own message.
create or replace function public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  perform business_setup_require('setup.quotes.manage');
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
  kyc := business_setup_kyc_status(q.client_id);
  -- KYC already done (validated here, or marked Done in the old records) is not asked for again.
  if (kyc ->> 'percent')::int < 100 and not exists (select 1 from business_setup_kyc_profiles where client_id = q.client_id and kyc_state = 'Done') then
    raise exception 'The client KYC is incomplete: missing %', (select string_agg(m, ', ') from jsonb_array_elements_text(kyc -> 'missing') m);
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;
  if not exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Confirmed') then
    raise exception 'The signed copy of this quote is not confirmed yet: add it and confirm it first';
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
    n := n + 1;
  end loop;

  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
end $$;
revoke all on function public.business_setup_quote_accept(uuid, boolean) from public, anon;
grant execute on function public.business_setup_quote_accept(uuid, boolean) to authenticated;

-- ── Payment by case ──────────────────────────────────────────────────
-- Net paid on a case: Payment less Refund and Reversal over every payment row carrying the case. The one place the sum is written
-- for a case (business_setup_net_paid still answers for a quote, and gives the same figure for a quote in a case: 014's quote-side sum takes
-- case_id OR a quote of the case, and the fill trigger plus 013's backfill give every such payment a case_id). Tests 090 compares the two
-- across an advance, a refund and a reversal, and must keep passing if either sum changes.
create or replace function public.business_setup_case_net_paid(p_case uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) from business_setup_payments where case_id = p_case
$$;
revoke all on function public.business_setup_case_net_paid(uuid) from public, anon, authenticated;

-- What Documentation needs, worked out from the records. Internal.
--   signed  the case's accepted quote has a Confirmed signed copy (a legacy row counts for a quote accepted before 015)
--   invoice an invoice is recorded for the case (or for a quote of it), or the Invoice override was given
create or replace function public.business_setup_case_docs(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_inv_override boolean;
begin
  select invoice_override_reason is not null into v_inv_override from business_setup_cases where id = p_case;
  return jsonb_build_object(
    'quote', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status <> 'superseded'),
    'signed', exists (select 1 from hub_documents q join business_setup_signed_quotes s on s.quote_id = q.id and s.status = 'Confirmed'
                       where q.case_id = p_case and q.doc_type = 'quote' and q.status = 'accepted'),
    -- a letter counts only on the accepted quote (one made before the gate on a superseded or rejected quote does not satisfy it). case_sync moves forward only, so a backfilled case already past Documentation stays where it is.
    'letter', exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id where l.case_id = p_case and l.doc_type = 'letter' and lq.status = 'accepted'),
    'invoice', coalesce(v_inv_override, false) or exists (select 1 from business_setup_invoices i where i.case_id = p_case
                 or i.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote')));
end $$;
revoke all on function public.business_setup_case_docs(uuid) from public, anon, authenticated;

-- The Paid item and its override are gone: a payment blocks nothing. Dropped here so a database that ran an earlier copy of this file loses it too.
drop function if exists public.business_setup_case_paid_override(uuid, text);

-- ── Invoices recorded by hand ────────────────────────────────────────
-- business_setup_invoices comes from 010 (the portal's Invoices section reads it by client_id). A hand-recorded invoice also names its
-- case and who recorded it. Rows with no case (Zoho, when it is connected) are unchanged and move no case. Nothing writes through the API.
alter table public.business_setup_invoices add column if not exists case_id uuid references public.business_setup_cases(id);
alter table public.business_setup_invoices add column if not exists created_by uuid;
create index if not exists business_setup_invoices_case_idx on public.business_setup_invoices (case_id) where case_id is not null;

-- Records an invoice made outside the CRM against an accepted Business Setup quote, by case or by quote. Keys: case_id, quote_id,
-- invoice_number, invoice_date (default today), amount, file_path (optional, under <client>/invoice/). A quote may have several invoices
-- but not the same number twice. The quote is locked before the case, the order a payment uses.
create or replace function public.business_setup_invoice_record(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; c business_setup_cases; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_case uuid; v_quote uuid; v_client text; v_number text; v_on date; v_amount numeric; v_path text; v_prefix text; v_id uuid;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  begin
    v_case := nullif(p ->> 'case_id', '')::uuid; v_quote := nullif(p ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The case or quote is not valid';
  end;
  if v_case is null and v_quote is null then raise exception 'Choose the case or the quote this invoice is for'; end if;
  v_number := nullif(btrim(coalesce(p ->> 'invoice_number', '')), '');
  if v_number is null then raise exception 'Enter the invoice number'; end if;
  if length(v_number) > 60 then raise exception 'The invoice number is too long'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount < 0 or v_amount >= 10000000000000000 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount of zero or more with at most two decimals';
  end if;
  begin
    v_on := coalesce(nullif(p ->> 'invoice_date', '')::date, v_today);
  exception when others then
    raise exception 'Enter a valid invoice date';
  end;
  if v_on > v_today then raise exception 'The invoice date cannot be in the future'; end if;
  v_path := nullif(btrim(coalesce(p ->> 'file_path', '')), '');

  -- A case invoices its accepted quote.
  if v_quote is null then
    select id into v_quote from hub_documents where case_id = v_case and doc_type = 'quote' and department = 'Business Setup' and status = 'accepted' order by created_at desc limit 1;
  end if;
  if v_quote is not null then
    select * into q from hub_documents where id = v_quote for update;
    if q.id is null then raise exception 'Quote not found'; end if;
    if v_case is null then v_case := q.case_id;
    elsif q.case_id is distinct from v_case then raise exception 'This quote does not belong to that case'; end if;
  end if;
  -- Only a Lost case refuses an invoice: a Completed or Cancelled one may still be billed late, as it may still take a payment.
  if v_case is not null then
    select * into c from business_setup_cases where id = v_case for update;
    if c.id is null then raise exception 'Case not found'; end if;
    if c.stage = 'Lost' then raise exception 'This case is lost and takes no invoice'; end if;
    v_client := c.client_id;
    if v_client is null then raise exception 'Link a client to this case before recording an invoice'; end if;
    if q.id is not null and q.client_id is not null and q.client_id <> v_client then raise exception 'The client of this quote does not match the client of the case'; end if;
  else
    v_client := q.client_id;
    if v_client is null then raise exception 'Link this quote to a client before recording an invoice'; end if;
  end if;
  if q.id is null or q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
    raise exception 'An invoice can be recorded only against an accepted Business Setup quote';
  end if;
  if business_setup_quote_locked(q.id) then
    raise exception 'This quote is with Accounts. It can be changed only if Accounts reverts it.';
  end if;
  -- The file, if any, is already in storage under <client>/invoice/ (exact prefix, never a pattern match).
  if v_path is not null then
    v_prefix := v_client || '/invoice/';
    if not coalesce(left(v_path, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_path, '/')) or '' = any (string_to_array(v_path, '/')) then
      raise exception 'The file path must be under % and cannot contain .. or empty parts', v_prefix;
    end if;
  end if;
  if exists (select 1 from business_setup_invoices where quote_id = q.id and lower(btrim(invoice_number)) = lower(v_number)) then
    raise exception 'Invoice % is already recorded on this quote', v_number;
  end if;

  insert into business_setup_invoices (client_id, quote_id, case_id, invoice_number, issued_on, amount, file_path, source, created_by)
  values (v_client, q.id, v_case, v_number, v_on, v_amount, v_path, 'Manual', auth.uid())
  returning id into v_id;
  perform business_setup_audit('business_setup_invoices', v_id::text, 'invoice_record', null,
          jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'invoice_number', v_number, 'amount', v_amount, 'has_file', v_path is not null));
  return v_id;
end $$;
revoke all on function public.business_setup_invoice_record(jsonb) from public, anon;
grant execute on function public.business_setup_invoice_record(jsonb) to authenticated;

-- A recorded invoice may complete Documentation: re-check the case (the invoice's own, or the case of its quote).
create or replace function public.business_setup_invoice_sync_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid := new.case_id;
begin
  if v_case is null and new.quote_id is not null then select case_id into v_case from hub_documents where id = new.quote_id; end if;
  if v_case is not null then perform business_setup_case_sync(v_case); end if;
  return null;
end $$;
revoke all on function public.business_setup_invoice_sync_trg() from public, anon, authenticated;
drop trigger if exists business_setup_case_invoice on public.business_setup_invoices;
create trigger business_setup_case_invoice after insert on public.business_setup_invoices
  for each row execute function public.business_setup_invoice_sync_trg();

-- Invoice files: finance holds setup.payments.manage but not the rights 008's policy asks for, so one INSERT-only policy lets them upload
-- to business-setup-documents, and only to <client>/invoice/<file> for a client that exists (exact parts, never a pattern match).
create or replace function public.business_setup_invoice_upload_ok(p_bucket text, p_path text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_bucket = 'business-setup-documents' and p_path is not null
                  and cardinality(string_to_array(p_path, '/')) = 3
                  and split_part(p_path, '/', 2) = 'invoice'
                  and not ('..' = any (string_to_array(p_path, '/'))) and not ('' = any (string_to_array(p_path, '/')))
                  and exists (select 1 from client_master cm where cm.client_id = split_part(p_path, '/', 1))
                  and public.business_setup_can('setup.payments.manage'), false)
$$;
revoke all on function public.business_setup_invoice_upload_ok(text, text) from public, anon;
grant execute on function public.business_setup_invoice_upload_ok(text, text) to authenticated;
drop policy if exists business_setup_invoice_upload on storage.objects;
create policy business_setup_invoice_upload on storage.objects for insert to authenticated
  with check (public.business_setup_invoice_upload_ok(bucket_id, name));

-- Waives the Invoice item for a case, with a reason (the invoice is made outside the CRM). Moves the case on if it was the last item.
create or replace function public.business_setup_case_invoice_override(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform business_setup_require('setup.payments.override');
  if v_reason is null then raise exception 'Give a reason for waiving the invoice'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Lost', 'Cancelled', 'Completed') then raise exception 'This case is % and cannot take an invoice override', lower(c.stage); end if;
  if c.invoice_override_reason is not null then raise exception 'The invoice has already been waived for this case'; end if;
  update business_setup_cases set invoice_override_reason = v_reason where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_invoice_override', null, jsonb_build_object('reason', v_reason));
  perform business_setup_case_sync(p_case);
end $$;
revoke all on function public.business_setup_case_invoice_override(uuid, text) from public, anon;
grant execute on function public.business_setup_case_invoice_override(uuid, text) to authenticated;

-- ── Client list: KYC missing items ───────────────────────────────────
-- As in 008, plus kyc_missing: the items business_setup_kyc_status names, the same list the workspace Overview reads. It is worked out only
-- for a client with no stored state (null otherwise): a stored state is the label, so those clients cost nothing extra. The list and the
-- Overview then work out the KYC label with one rule (logic/kyc.js, kycLabel) instead of the list testing the stored state alone.
create or replace function public.business_setup_client_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (
    with ids as (
      select client_id from business_setup_kyc_profiles
      union select client_id from business_setup_services
      union select client_id from hub_documents where department = 'Business Setup' and doc_type = 'quote' and client_id is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'client_id', m.client_id, 'legal_name', m.legal_name, 'client_status', k.client_status, 'kyc_state', k.kyc_state,
             'kyc_missing', case when k.kyc_state is null then coalesce(business_setup_kyc_status(m.client_id) -> 'missing', '[]'::jsonb) end,
             'active_services', (select count(*) from business_setup_services s where s.client_id = m.client_id and s.status not in ('Completed', 'Cancelled') and not s.historical),
             'balance', (select coalesce(sum(q.total_amount - business_setup_net_paid(q.id)), 0) from hub_documents q
                          where q.client_id = m.client_id and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status = 'accepted'),
             'missing_contact', client_master_plain(m.data ->> 'General Email') is null or client_master_plain(m.data ->> 'General Phone') is null)
             order by m.legal_name), '[]'::jsonb)
      from ids join client_master m on m.client_id = ids.client_id
      left join business_setup_kyc_profiles k on k.client_id = m.client_id);
end $$;

-- A case's quote and letter numbers and files, for the Documentation page of a case with no client yet (read-only, so staff can tell
-- which case it is before linking a client). The client workspace cannot be loaded without a client.
create or replace function public.business_setup_case_documents(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'document_number', d.document_number, 'status', d.status, 'total_amount', d.total_amount,
                          'storage_path', d.storage_path, 'created_at', d.created_at, 'parent_id', d.parent_id) order by d.created_at)
                     from hub_documents d where d.case_id = p_case and d.department = 'Business Setup' and d.doc_type in ('quote', 'letter')), '[]'::jsonb);
end $$;
revoke all on function public.business_setup_case_documents(uuid) from public, anon;
grant execute on function public.business_setup_case_documents(uuid) to authenticated;

-- Marking a case lost, as in 014, with the shared net-paid sum. Its issued quotes are rejected and their waiting signed copies refused, each audited,
-- so a client who keeps a login (other work) no longer sees a dead quote as waiting. Quotes are locked before the case, roots first: the order an accept and a payment use.
create or replace function public.business_setup_case_lost(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_net numeric; v_acct uuid; q hub_documents; v_sid uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_reason is null then raise exception 'Enter the reason this case is lost'; end if;
  perform 1 from hub_documents where case_id = p_case and doc_type = 'quote' order by (root_quote_id is not null), id for update;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage = 'In service' then raise exception 'A case in service cannot be marked lost'; end if;
  if exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted') then
    raise exception 'This case has an accepted quote and cannot be marked lost: cancel its services instead';
  end if;
  v_net := business_setup_case_net_paid(p_case);
  if v_net > 0 then raise exception 'This case has a net payment of %: refund it before marking the case lost', v_net; end if;
  -- Lost rejects every issued quote, so it cannot pass a quote that Accounts holds.
  if exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'issued' and business_setup_quote_locked(id)) then
    raise exception 'A quote of this case is locked because Accounts holds it: the case cannot be marked lost';
  end if;
  update business_setup_cases set lost_reason = v_reason where id = p_case;
  perform business_setup_case_set_stage(p_case, 'Lost', v_reason);
  for q in select * from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'issued' loop
    update hub_documents set status = 'rejected', status_at = now(), status_by = auth.uid(), status_reason = 'Case marked lost: ' || v_reason where id = q.id;
    perform business_setup_audit('hub_documents', q.id::text, 'quote_reject_by_lost', jsonb_build_object('status', 'issued'),
            jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'case_id', p_case, 'reason', v_reason));
    for v_sid in update business_setup_signed_quotes set status = 'Refused', note = 'This case was closed, so this signed copy no longer applies',
           decided_at = now(), decided_by = auth.uid() where quote_id = q.id and status = 'Uploaded' returning id loop
      perform business_setup_audit('business_setup_signed_quotes', v_sid::text, 'signed_refused_by_lost', jsonb_build_object('status', 'Uploaded'), jsonb_build_object('quote_id', q.id, 'case_id', p_case));
    end loop;
  end loop;
  if c.client_id is not null
     and not exists (select 1 from business_setup_cases where client_id = c.client_id and id <> p_case and stage not in ('Completed', 'Cancelled', 'Lost'))
     and not exists (select 1 from business_setup_services where client_id = c.client_id)
     and not exists (select 1 from banking_cases bc join banking_clients bk on bk.id = bc.client_id where bk.client_master_id = c.client_id) then
    v_acct := business_setup_portal_account(c.client_id);
    update client_portal_accounts set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), failed_attempts = 0, locked_until = null where id = v_acct and status = 'active';
    if found then
      delete from client_portal_sessions where account_id = v_acct;
      perform business_setup_audit('client_portal_accounts', v_acct::text, 'login_revoke', null, jsonb_build_object('client_id', c.client_id, 'case_id', p_case));
    end if;
  end if;
end $$;
revoke all on function public.business_setup_case_lost(uuid, text) from public, anon;
grant execute on function public.business_setup_case_lost(uuid, text) to authenticated;

-- Record a payment and its receipt, on a case or on an accepted quote (p: case_id or quote_id, amount, paid_on, method, reference,
-- note, override_reason). On a case the payment follows the case's accepted quote when there is one; before that quote_id stays empty,
-- and the money counts toward the quote once it is accepted. The overpayment check applies once a quote is accepted.
create or replace function public.business_setup_payment_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; c business_setup_cases; v_today date := (now() at time zone 'Asia/Dubai')::date; v_amount numeric; v_on date;
  v_case uuid; v_quote uuid; v_client text;
  v_outstanding numeric; v_over boolean := false; v_reason text; v_note text; v_pay uuid; v_rec uuid; v_number text;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  begin
    v_case := nullif(p ->> 'case_id', '')::uuid; v_quote := nullif(p ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The case or quote is not valid';
  end;
  if v_case is null and v_quote is null then raise exception 'Choose the case or the quote this payment is for'; end if;
  -- A case pays its accepted quote. The quote is locked before the case, the order an accept uses.
  if v_quote is null then
    select id into v_quote from hub_documents where case_id = v_case and doc_type = 'quote' and department = 'Business Setup' and status = 'accepted' limit 1;
  end if;
  if v_quote is not null then
    select * into q from hub_documents where id = v_quote for update;
    if q.id is null then raise exception 'Quote not found'; end if;
    if q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
      raise exception 'A payment can be recorded only against an accepted Business Setup quote';
    end if;
    if v_case is null then v_case := q.case_id;
    elsif q.case_id is distinct from v_case then raise exception 'This quote does not belong to that case'; end if;
  end if;
  if v_case is not null then
    select * into c from business_setup_cases where id = v_case for update;
    if c.id is null then raise exception 'Case not found'; end if;
    if c.stage = 'Lost' then raise exception 'This case is lost and takes no payment'; end if;
    v_client := c.client_id;
    if v_client is null then raise exception 'Link a client to this case before recording a payment'; end if;
    if q.id is not null and q.client_id is not null and q.client_id <> v_client then raise exception 'The client of this quote does not match the client of the case'; end if;
  else
    v_client := q.client_id;
    if v_client is null then raise exception 'Link this quote to a client before recording a payment'; end if;
  end if;
  if q.id is not null and business_setup_quote_locked(q.id) then
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

  v_reason := nullif(btrim(coalesce(p ->> 'override_reason', '')), '');
  if q.id is not null then
    v_outstanding := coalesce(q.total_amount, 0) - business_setup_net_paid(q.id);
    v_over := v_amount > v_outstanding;
    if v_over then
      if not business_setup_can('setup.payments.override') then
        raise exception 'This payment is above the balance of %: ask someone who may accept an overpayment', to_char(v_outstanding, 'FM999,999,999,990.00');
      end if;
      if v_reason is null then raise exception 'Give a reason for accepting a payment above the balance'; end if;
    end if;
  end if;
  v_note := nullif(btrim(coalesce(p ->> 'note', '')), '');
  if v_over then v_note := concat_ws(E'\n', v_note, 'Above the balance: ' || v_reason); end if;

  insert into business_setup_payments (client_id, quote_id, case_id, paid_on, amount, method, reference, type, note)
  values (v_client, q.id, v_case, v_on, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Payment', v_note)
  returning id into v_pay;
  v_number := hub_next_number('Business Setup', 'receipt');
  insert into business_setup_receipts (payment_id, receipt_number) values (v_pay, v_number) returning id into v_rec;

  perform business_setup_audit('business_setup_payments', v_pay::text, 'payment_add', null,
          jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'amount', v_amount, 'receipt_number', v_number,
                             'overpayment', v_over, 'reason', case when v_over then v_reason end));
  return jsonb_build_object('payment_id', v_pay, 'receipt_id', v_rec, 'receipt_number', v_number);
end $$;

-- Reversing a payment, as in 007, plus the case on the reversal, so a payment recorded on a case before its quote is taken away
-- from the same case. The quote (if any) is locked first, else the case.
create or replace function public.business_setup_payment_reverse(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  o business_setup_payments; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_rev uuid; v_net numeric;
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
  if o.case_id is not null then
    -- The case's accepted quote is locked before the case (the order payment_add uses), so a send to Accounts cannot slip in between the check and the insert.
    perform 1 from hub_documents where case_id = o.case_id and doc_type = 'quote' and status = 'accepted' for update;
    perform 1 from business_setup_cases where id = o.case_id for update;
    -- An advance has no quote on its row, but the case's accepted quote may be with Accounts.
    if business_setup_case_locked(o.case_id) then raise exception 'This quote is locked because Accounts holds it: no payment can be reversed'; end if;
  end if;
  if exists (select 1 from business_setup_payments where reverses_id = o.id) then raise exception 'This payment already has a reversal'; end if;
  -- The locks above hold the balance still. A reversal may not take net paid below zero, counted in the payment's own bucket: the case when it has
  -- one (every quote and advance of the case share it), else its quote.
  v_net := case when o.case_id is not null then business_setup_case_net_paid(o.case_id) else business_setup_net_paid(o.quote_id) end;
  if o.amount > v_net then
    if exists (select 1 from business_setup_payments where type = 'Refund' and (case when o.case_id is not null then case_id = o.case_id else quote_id = o.quote_id end)) then
      raise exception 'This payment cannot be reversed: part of the money was refunded, so only % is left to reverse', to_char(greatest(v_net, 0), 'FM999,999,999,990.00');
    end if;
    raise exception 'This payment cannot be reversed: it would take the net paid below zero (only % is left)', to_char(greatest(v_net, 0), 'FM999,999,999,990.00');
  end if;

  insert into business_setup_payments (client_id, quote_id, case_id, paid_on, amount, method, reference, type, reverses_id, note)
  values (o.client_id, o.quote_id, o.case_id, (now() at time zone 'Asia/Dubai')::date, o.amount, o.method, o.reference, 'Reversal', o.id, v_reason)
  returning id into v_rev;
  perform business_setup_audit('business_setup_payments', v_rev::text, 'payment_reverse', null,
          jsonb_build_object('client_id', o.client_id, 'quote_id', o.quote_id, 'case_id', o.case_id, 'amount', o.amount, 'reverses_id', o.id, 'reason', v_reason));
  return jsonb_build_object('reversal_id', v_rev, 'payment_id', o.id);
end $$;
revoke all on function public.business_setup_payment_add(jsonb), public.business_setup_payment_reverse(uuid, text) from public, anon;
grant execute on function public.business_setup_payment_add(jsonb), public.business_setup_payment_reverse(uuid, text) to authenticated;

-- ── Refund by case ───────────────────────────────────────────────────
-- Refund as in 007 (money really returned, no receipt), on a case or on a quote (p: case_id or quote_id, amount, method, reference, reason).
-- Capped by what the case (or the quote) has net paid. quote_id stays empty when the case has no accepted quote, so an advance can be
-- returned and the case can then be marked lost. Refused while Accounts holds the case's accepted quote.
create or replace function public.business_setup_refund_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; c business_setup_cases; v_case uuid; v_quote uuid; v_client text; v_amount numeric; v_reason text; v_id uuid; v_net numeric;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  begin
    v_case := nullif(p ->> 'case_id', '')::uuid; v_quote := nullif(p ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The case or quote is not valid';
  end;
  if v_case is null and v_quote is null then raise exception 'Choose the case or the quote this refund is for'; end if;
  if v_quote is null then
    select id into v_quote from hub_documents where case_id = v_case and doc_type = 'quote' and department = 'Business Setup' and status = 'accepted' limit 1;
  end if;
  if v_quote is not null then
    select * into q from hub_documents where id = v_quote for update;
    if q.id is null or q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.client_id is null then raise exception 'Quote not found'; end if;
    if v_case is null then v_case := q.case_id;
    elsif q.case_id is distinct from v_case then raise exception 'This quote does not belong to that case'; end if;
  end if;
  if v_case is not null then
    select * into c from business_setup_cases where id = v_case for update;
    if c.id is null then raise exception 'Case not found'; end if;
    v_client := c.client_id;
    if v_client is null then raise exception 'Link a client to this case before recording a refund'; end if;
    if business_setup_case_locked(v_case) then raise exception 'This quote is locked because Accounts holds it: no refund can be recorded'; end if;
    v_net := business_setup_case_net_paid(v_case);
  else
    v_client := q.client_id;
    v_net := business_setup_net_paid(q.id);
  end if;
  if q.id is not null and business_setup_quote_locked(q.id) then raise exception 'This quote is locked because Accounts holds it: no refund can be recorded'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'Enter an amount above zero with at most two decimals'; end if;
  v_reason := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  if v_reason is null then raise exception 'Give a reason for the refund'; end if;
  if v_amount > v_net then raise exception 'This refund is above the % paid on the %', to_char(v_net, 'FM999,999,999,990.00'), case when v_case is null then 'quote' else 'case' end; end if;
  insert into business_setup_payments (client_id, quote_id, case_id, paid_on, amount, method, reference, type, note)
  values (v_client, q.id, v_case, (now() at time zone 'Asia/Dubai')::date, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Refund', v_reason)
  returning id into v_id;
  perform business_setup_audit('business_setup_payments', v_id::text, 'refund_add', null, jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'amount', v_amount, 'reason', v_reason));
  return v_id;
end $$;
revoke all on function public.business_setup_refund_add(jsonb) from public, anon;
grant execute on function public.business_setup_refund_add(jsonb) to authenticated;

-- ── The Accounts lock reaches advances ───────────────────────────────
-- A payment recorded before the quote was accepted has no quote_id. It belongs to the case, so it is locked, and shown to Accounts,
-- with the case's accepted quote (011 only looked at quote_id).
create or replace function public.business_setup_case_locked(p_case uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from hub_documents q where q.case_id = p_case and q.doc_type = 'quote' and q.status = 'accepted' and business_setup_quote_locked(q.id))
$$;
revoke all on function public.business_setup_case_locked(uuid) from public, anon, authenticated;

create or replace function public.business_setup_child_lock() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_locked boolean := false;
begin
  if tg_table_name = 'business_setup_payments' then
    v_locked := (new.quote_id is not null and business_setup_quote_locked(new.quote_id)) or (new.case_id is not null and business_setup_case_locked(new.case_id));
  elsif tg_table_name = 'business_setup_receipts' then
    v_locked := exists (select 1 from business_setup_payments y where y.id = new.payment_id
                         and ((y.quote_id is not null and business_setup_quote_locked(y.quote_id)) or (y.case_id is not null and business_setup_case_locked(y.case_id))));
  elsif tg_table_name = 'business_setup_documents' then
    v_locked := new.service_id is not null and exists (select 1 from business_setup_services s where s.id = new.service_id and s.locked);
  end if;
  if v_locked then raise exception 'This quote is with Accounts. It can be changed only if Accounts reverts it.'; end if;
  return new;
end $$;
revoke all on function public.business_setup_child_lock() from public, anon, authenticated;

create or replace function public.business_setup_accounts_queue() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('accounts.review');
  return (select coalesce(jsonb_agg(jsonb_build_object('quote_id', q.id, 'number', q.document_number, 'client_id', q.client_id, 'client_name', m.legal_name,
             'status', h.status, 'sent_at', h.sent_at, 'reviewed_at', h.reviewed_at, 'remarks', h.remarks, 'total', q.total_amount, 'net_paid', business_setup_net_paid(q.id),
             'outstanding', q.total_amount - business_setup_net_paid(q.id),
             'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'action', s.action, 'status', s.status, 'completed_at', s.completed_at) order by s.name), '[]'::jsonb) from business_setup_services s where s.quote_id = q.id),
             'payments', (select coalesce(jsonb_agg(jsonb_build_object('date', y.paid_on, 'amount', y.amount, 'type', y.type, 'method', y.method, 'reference', y.reference, 'receipt_number', r.receipt_number, 'receipt_path', r.storage_path) order by y.paid_on), '[]'::jsonb)
                            from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id
                           where y.quote_id = q.id or (q.case_id is not null and y.case_id = q.case_id)),
             'outputs', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'storage_path', d.storage_path) order by d.created_at), '[]'::jsonb)
                           from business_setup_documents d join business_setup_services s on s.id = d.service_id where s.quote_id = q.id and d.is_output))
             order by (h.status = 'With Accounts') desc, coalesce(h.reviewed_at, h.sent_at) desc), '[]'::jsonb)
    from business_setup_handovers h join hub_documents q on q.id = h.quote_id left join client_master m on m.client_id = q.client_id
   where h.status in ('With Accounts', 'Closed'));
end $$;
revoke all on function public.business_setup_accounts_queue() from public, anon;
grant execute on function public.business_setup_accounts_queue() to authenticated;

-- ── Rejecting a quote ────────────────────────────────────────────────
-- As in 006, plus: a signed copy waiting for review on the quote is refused, with a note and an audit entry.
create or replace function public.business_setup_quote_reject(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_sid uuid;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be rejected'; end if;
  if v_reason is null then raise exception 'Give a reason for rejecting the quote'; end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be rejected (this one is %)', q.status; end if;
  update hub_documents set status = 'rejected', status_at = now(), status_by = auth.uid(), status_reason = v_reason where id = q.id;
  for v_sid in update business_setup_signed_quotes set status = 'Refused', note = 'This quote was rejected, so this signed copy no longer applies',
         decided_at = now(), decided_by = auth.uid() where quote_id = q.id and status = 'Uploaded' returning id loop
    perform business_setup_audit('business_setup_signed_quotes', v_sid::text, 'signed_refused_by_reject', jsonb_build_object('status', 'Uploaded'), jsonb_build_object('quote_id', q.id));
  end loop;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_reject', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'reason', v_reason));
end $$;
revoke all on function public.business_setup_quote_reject(uuid, text) from public, anon;
grant execute on function public.business_setup_quote_reject(uuid, text) to authenticated;

-- ── Linking a client when money arrives ──────────────────────────────
-- The duplicate-checked step of Share link, shared by two doors: business_setup_case_link_client (lead rights) and
-- business_setup_case_link_client_for_payment (payment rights, for Finance). Neither issues a login. Internal body, no rights check.
create or replace function public.business_setup_case_link_client_body(p_case uuid, p_client text, p_allow_duplicate boolean) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_client text := nullif(btrim(coalesce(p_client, '')), ''); r jsonb; v_data jsonb; v_dups text;
begin
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.client_id is not null then
    if v_client is not null and v_client <> c.client_id then raise exception 'This case is already linked to client %', c.client_id; end if;
    return c.client_id;
  end if;
  if v_client is not null then
    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  else
    v_data := jsonb_strip_nulls(jsonb_build_object('Client Legal Name', c.lead_name, 'Primary Contact', c.contact_person, 'General Email', c.email, 'General Phone', c.phone));
    r := client_master_save(null, v_data, null, p_allow_duplicate);
    if not coalesce((r ->> 'ok')::boolean, false) then
      select string_agg((d ->> 'id') || ' ' || coalesce(d ->> 'name', '') || ' (same ' || (select string_agg(m, ', ') from jsonb_array_elements_text(d -> 'matches') m) || ')', '; ')
        into v_dups from jsonb_array_elements(r -> 'duplicates') d;
      raise exception 'A client like this already exists: %. Link that client, or confirm this is a new one.', coalesce(v_dups, 'see Client Master');
    end if;
    v_client := r ->> 'id';
  end if;
  update business_setup_cases set client_id = v_client where id = p_case;
  -- The case's quotes and letters that have no client follow it, so the quote can then be accepted.
  update hub_documents set client_id = v_client where case_id = p_case and client_id is null;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_link_client', null, jsonb_build_object('client_id', v_client));
  return v_client;
end $$;
revoke all on function public.business_setup_case_link_client_body(uuid, text, boolean) from public, anon, authenticated;

create or replace function public.business_setup_case_link_client(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.leads.manage');
  return business_setup_case_link_client_body(p_case, p_client, p_allow_duplicate);
end $$;
revoke all on function public.business_setup_case_link_client(uuid, text, boolean) from public, anon;
grant execute on function public.business_setup_case_link_client(uuid, text, boolean) to authenticated;

-- Creating the client goes through client_master_save, which asks client_master_can('kyc.manage'), a right Finance does not hold. This door
-- sets a flag for the length of this one call (tied to the current transaction id and cleared straight after), and client_master_can honours
-- it for kyc.manage only when the caller also holds setup.payments.manage. The flag cannot be set from the API: only SQL run inside the
-- database can call set_config, and the API reaches the database only through the functions granted to it.
create or replace function public.client_master_can(p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select banking_can(p_permission) or business_setup_can(p_permission)
      or (p_permission = 'kyc.manage' and current_setting('bs.pay_link', true) = pg_current_xact_id()::text and business_setup_can('setup.payments.manage'))
$$;
revoke all on function public.client_master_can(text) from public, anon;
grant execute on function public.client_master_can(text) to authenticated;

create or replace function public.business_setup_case_link_client_for_payment(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text;
begin
  perform business_setup_require('setup.payments.manage');
  -- This door only creates the client from the case. Linking an existing client, or confirming a duplicate, can attach a quote to another client's portal.
  if nullif(btrim(coalesce(p_client, '')), '') is not null then raise exception 'A payment cannot link an existing client: ask a manager or Sales to link it'; end if;
  if coalesce(p_allow_duplicate, false) then raise exception 'A payment cannot confirm a duplicate client: ask a manager or Sales to link it'; end if;
  perform set_config('bs.pay_link', pg_current_xact_id()::text, true);
  v_client := business_setup_case_link_client_body(p_case, p_client, p_allow_duplicate);
  perform set_config('bs.pay_link', '', true);
  return v_client;
end $$;
revoke all on function public.business_setup_case_link_client_for_payment(uuid, text, boolean) from public, anon;
grant execute on function public.business_setup_case_link_client_for_payment(uuid, text, boolean) to authenticated;

-- ── Creating documents ───────────────────────────────────────────────
-- As in 014, plus line VAT for a Business Setup quote (with or without a case): the mode is stored as exclusive, each line's
-- rate is read from its fee item (5 with none) and stamped on the line, and VAT is the sum of round(amount * rate / 100, 2).
-- A Business Setup letter takes the VAT and total stored on its quote. Every other department and document type is unchanged.

create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents; o hub_documents; v_id uuid := gen_random_uuid(); v_root uuid;
  v_client text := nullif(trim(p ->> 'client_id'), ''); v_revises uuid := nullif(p ->> 'revises_id', '')::uuid; v_template text := nullif(trim(p ->> 'template_key'), '');
  v_case uuid := nullif(p ->> 'case_id', '')::uuid; v_case_client text;
  v_bs_quote boolean := false; v_bs_letter boolean := false; v_lines jsonb := '[]'::jsonb; v_lr numeric; v_fid text; v_docs jsonb; v_sid uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- An engagement letter exists only as the next step of a generated quote, and takes everything from it.
  if v_type = 'letter' then
    select * into q from hub_documents where id = (p ->> 'parent_id')::uuid and doc_type = 'quote' for update;
    if q.id is null then raise exception 'Generate the quote first: an engagement letter comes from a quote'; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    if q.department = 'Business Setup' and q.status <> 'accepted' then raise exception 'Confirm the signed quote first'; end if;
    p := jsonb_build_object('doc_type', 'letter', 'parent_id', q.id, 'department', q.department, 'client_name', q.client_name, 'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'client_address', q.client_address, 'license_number', q.license_number, 'vat_trn', q.vat_trn, 'services', to_jsonb(q.services), 'lines', q.lines, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate);
    v_mode := q.vat_mode; v_rate := q.vat_rate; v_client := q.client_id; v_revises := null; v_case := q.case_id;
    v_bs_letter := q.department = 'Business Setup';
  end if;
  v_bs_quote := v_type = 'quote' and p ->> 'department' = 'Business Setup';
  -- Business Setup documents reach a client's login, so issuing one needs the department's right. A letter takes its department from its quote above.
  if p ->> 'department' = 'Business Setup' then perform business_setup_require('setup.quotes.manage'); end if;
  -- A Business Setup letter waits for the signed quote only; a payment is not needed. A quote in a case reads this from the case; a quote
  -- with no case reads its own signed copy. After the right is checked, so a caller without it learns nothing about the quote.
  if v_type = 'letter' and q.department = 'Business Setup' then
    if q.case_id is not null then v_docs := business_setup_case_docs(q.case_id);
    else v_docs := jsonb_build_object('signed', exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Confirmed'));
    end if;
    if not (v_docs ->> 'signed')::boolean then raise exception 'Confirm the signed copy of the quote before the engagement letter'; end if;
  end if;
  if v_type <> 'quote' then v_revises := null; v_template := null; end if;
  if v_template is not null and not exists (select 1 from business_setup_quote_templates where key = v_template and active) then raise exception 'Unknown quote template %', v_template; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  if v_case is not null and not exists (select 1 from business_setup_cases where id = v_case) then raise exception 'Unknown case'; end if;
  if v_case is not null then
    if p ->> 'department' is distinct from 'Business Setup' then raise exception 'Only a Business Setup document can belong to a case'; end if;
    select client_id into v_case_client from business_setup_cases where id = v_case;
    if v_client is not null and v_case_client is not null and v_client <> v_case_client then raise exception 'This client does not match the client of the case'; end if;
    -- A case is one lead, one quote and its revisions. A new quote is allowed only when every earlier quote of the case was rejected
    -- or replaced by a revision (a replaced quote is not live: Q1 revised to Q2 and Q2 rejected leaves nothing live).
    if v_type = 'quote' and v_revises is null then
      perform 1 from business_setup_cases where id = v_case for update;
      if exists (select 1 from hub_documents where case_id = v_case and doc_type = 'quote' and status not in ('rejected', 'superseded')) then
        raise exception 'This case already has a quote: revise that quote, or open a new case';
      end if;
    end if;
  end if;
  if nullif(trim(p ->> 'client_name'), '') is null then raise exception 'Enter the client name'; end if;
  if v_type in ('quote','letter') then
    if nullif(trim(p ->> 'contact_name'), '') is null or nullif(trim(p ->> 'contact_email'), '') is null or nullif(trim(p ->> 'contact_phone'), '') is null or (nullif(trim(p ->> 'client_address'), '') is null and p ->> 'department' <> 'Business Setup') then
      raise exception 'Fill in the client details first';
    end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one service'; end if;
  for it in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((it ->> 'amount')::numeric, -1) < 0 then raise exception 'Enter a fee for %', it ->> 'description'; end if;
    v_net := v_net + (it ->> 'amount')::numeric;
    if v_bs_quote then
      -- The rate comes from the fee item on the server (5 when there is none); whatever the browser sent is replaced.
      v_fid := nullif(btrim(coalesce(it ->> 'fee_item_id', '')), '');
      if v_fid is null then v_lr := 5;
      else
        if v_fid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'The fee item on a line is not valid'; end if;
        select vat_rate into v_lr from business_setup_fee_items where id = v_fid::uuid;
        if not found then raise exception 'Unknown fee item'; end if;
        v_lr := trim_scale(v_lr);
      end if;
      v_vat := v_vat + round((it ->> 'amount')::numeric * v_lr / 100, 2);
      it := it || jsonb_build_object('vat_rate', v_lr);
    end if;
    v_lines := v_lines || jsonb_build_array(it);
  end loop;
  if v_bs_quote then v_mode := 'exclusive'; v_rate := 5; v_total := v_net + v_vat;
  elsif v_bs_letter then v_vat := q.vat_amount; v_total := q.total_amount;   -- a letter inherits its quote's stored amounts
  elsif v_mode = 'exclusive' then v_vat := round(v_net * v_rate / 100, 2); v_total := v_net + v_vat;
  elsif v_mode = 'inclusive' then v_vat := round(v_net * v_rate / (100 + v_rate), 2); v_total := v_net;
  else v_total := v_net; end if;
  -- A revision replaces an issued quote of the same department; the chain root and the old quote stay locked until this transaction ends.
  if v_revises is not null then
    -- Lock order is root first, then the quote (same as business_setup_quote_accept), so a revise and an accept on a
    -- non-root member of one chain cannot deadlock. The root is found unlocked, then the quote is read again locked.
    select * into o from hub_documents where id = v_revises and doc_type = 'quote';
    if o.id is not null then perform 1 from hub_documents where id = coalesce(o.root_quote_id, o.id) for update; end if;
    select * into o from hub_documents where id = v_revises and doc_type = 'quote' for update;
    if o.id is null then raise exception 'The quote to revise was not found'; end if;
    if o.department is distinct from p ->> 'department' then raise exception 'A revision must be for the same department as the quote it replaces'; end if;
    if o.status <> 'issued' then raise exception 'Only an issued quote can be revised'; end if;
    -- The revision stays with the old quote's client; a different client is refused.
    if o.client_id is not null then
      if v_client is null then v_client := o.client_id;
      elsif v_client <> o.client_id then raise exception 'A revision must keep the client of the quote it replaces'; end if;
    end if;
    -- A quote outside every case cannot bring its revision into one: that would start a second chain in the case.
    if o.case_id is null and v_case is not null then raise exception 'This quote is not in a case, so its revision cannot be put in one'; end if;
    -- It also stays in the old quote's case.
    if o.case_id is not null then
      if v_case is null then v_case := o.case_id;
      elsif v_case <> o.case_id then raise exception 'A revision must keep the case of the quote it replaces'; end if;
    end if;
  end if;
  -- The case may have closed meanwhile, or the document inherits it from its quote or revision: no new document in a closed case.
  if v_case is not null and (select stage from business_setup_cases where id = v_case) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and takes no new documents', lower((select stage from business_setup_cases where id = v_case));
  end if;
  if v_type = 'quote' then v_root := coalesce(o.root_quote_id, o.id, v_id); end if;
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type);
  elsif (p ->> 'parent_id') is not null then select document_number into v_number from hub_documents where id = (p ->> 'parent_id')::uuid;
  end if;
  insert into hub_documents (id, root_quote_id, parent_id, doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body, client_id, revises_id, template_key, case_id)
  values (v_id, v_root, (p ->> 'parent_id')::uuid, v_type, p ->> 'department', v_number, case when v_type in ('quote','letter') then hub_serial_of(p ->> 'department', v_type, v_number) end, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone', p ->> 'client_address', p ->> 'license_number', p ->> 'vat_trn',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), case when v_bs_quote then v_lines else p -> 'lines' end, v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body', v_client, v_revises, v_template, v_case)
  returning * into r;
  if v_revises is not null then
    update hub_documents set status = 'superseded', status_at = now(), status_by = auth.uid(), status_reason = 'Revised by ' || r.document_number where id = v_revises;
    -- A signed copy uploaded for the quote just replaced no longer applies.
    for v_sid in update business_setup_signed_quotes set status = 'Refused', note = 'This quote was revised, so this signed copy no longer applies: sign the new quote',
           decided_at = now(), decided_by = auth.uid() where quote_id = v_revises and status = 'Uploaded' returning id loop
      perform business_setup_audit('business_setup_signed_quotes', v_sid::text, 'signed_refused_by_revision', jsonb_build_object('status', 'Uploaded'), jsonb_build_object('quote_id', v_revises, 'revised_by', r.document_number));
    end loop;
  end if;
  return r;
end $$;
