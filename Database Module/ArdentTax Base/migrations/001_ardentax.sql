-- =====================================================================
-- ArdentTax Base - quotations and engagement letters of the ArdentTax (ASP) tab    001
-- =====================================================================
-- One row per document version. Numbers come from the shared hub_next_number under its row lock, and every version
-- shows in the Voucher Register. Run after Services, Template Hub, Voucher, HR, Admin and Business Setup. Idempotent.
-- Undo with rollback/001_rollback.sql.
-- =====================================================================

-- ── Department and numbering ─────────────────────────────────────────
insert into public.service_departments (name, crm_tab, sort_order) values ('ArdentTax (ASP)', 'ArdentTax (ASP)', 5) on conflict (name) do nothing;
update public.hub_settings set value = value || '{"ArdentTax (ASP)": {"quote": {"format":"Ardentax/{YYYY}/{MM}/ADTQ{SERIAL}","digits":3,"restart":"never"}, "letter": {"format":"Ardentax/{YYYY}/{MM}/ADTE{SERIAL}","digits":3,"restart":"never"}}}'::jsonb
 where key = 'document_numbering' and not (value ? 'ArdentTax (ASP)');

-- The Email sheet's default text and signature. Editable later without a release.
insert into public.hub_settings (key, value) values ('ardentax_mail', jsonb_build_object(
  'subject', 'Ardentax E-Invoicing (ASP) Proposal - {CLIENT}',
  'body', $ardentax$Dear {POC_FIRST},

Thank you for your time and for sharing your e-invoicing requirements with us.

Please find attached our commercial proposal for UAE e-invoicing (ASP) services for {CLIENT}. The proposal covers the {TIER} package for up to {VOLUME} invoices per year at AED {ANNUAL} per year, with a Year 1 total of {TOTAL} (excluding VAT).

As the UAE e-invoicing mandate requires every business to appoint an Accredited Service Provider before go-live, we recommend confirming early so there is enough time for onboarding, integration and testing.

Please review the proposal and let us know if you have any questions. Once you are happy to proceed, kindly sign and return a copy and we will begin onboarding.$ardentax$,
  'signature_html', $ardentax$<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1f2937">
<p style="margin:16px 0 0">Regards</p>
<p style="margin:12px 0 0;line-height:1.35"><b>Bharat Bajaj</b><br>
CEO<br>
AB Capital Services FZC<br>
FTA Approved Tax Agency | TAAN 20053252<br>
<a href="https://www.abcapital.ae" style="color:#1f3a5f">www.abcapital.ae</a> | <a href="mailto:info@abcapital.ae" style="color:#1f3a5f">info@abcapital.ae</a></p>
<p style="margin:14px 0 0"><img src="cid:ardentax-banner" width="640" height="213" alt="Bharat Bajaj, Co-Founder, Ardentax IT Solutions" style="display:block;border:0;width:640px;max-width:100%;height:auto"></p>
</div>$ardentax$
)) on conflict (key) do nothing;

-- ── Documents ────────────────────────────────────────────────────────
create table if not exists public.ardentax_documents (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  doc_type text not null check (doc_type in ('quote','letter')),
  document_number text not null,
  document_serial int,
  version int not null default 1,
  revision_of uuid references public.ardentax_documents(id),
  source_quote_id uuid references public.ardentax_documents(id),
  quote_type text not null check (quote_type in ('Standard','Custom')),
  client_name text not null,
  selected_package text,
  volume numeric(18,2),
  one_time numeric(18,2) not null default 0,
  annual numeric(18,2) not null default 0,
  year1_total numeric(18,2) not null default 0,
  details jsonb not null,
  word_path text,
  pdf_path text,
  mail_to text, mail_cc text, mail_subject text, mail_body text,
  mail_attach_word boolean not null default false,
  mail_sent_at timestamptz,
  mail_sent_by uuid,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (document_number, version)
);
create index if not exists ardentax_documents_created_idx on public.ardentax_documents (created_at desc);
alter table public.ardentax_documents enable row level security;
revoke all on public.ardentax_documents from public, anon, authenticated;
grant select on public.ardentax_documents to authenticated;

create or replace function public.ardentax_can() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select admin_is() or 'ardentax' = any(my_tabs())
$$;
revoke all on function public.ardentax_can() from public, anon;
grant execute on function public.ardentax_can() to authenticated;

drop policy if exists ardentax_documents_read on public.ardentax_documents;
create policy ardentax_documents_read on public.ardentax_documents for select to authenticated using (public.ardentax_can());

-- A number, or 0 for blank or text such as "Free".
create or replace function public.ardentax_num(v jsonb) returns numeric
language sql immutable set search_path = public, pg_temp as $$
  select case
    when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric
    when jsonb_typeof(v) = 'string' and btrim(v #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then btrim(v #>> '{}')::numeric
    else 0 end
$$;

-- The same totals as computeQuote in Template Module/ardentax/logic/quoteModel.js; both are tested with one fixture file.
create or replace function public.ardentax_totals(d jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_one numeric := 0; v_annual numeric := 0; k text; r jsonb; v_fee numeric; it jsonb;
  v_tier text := case d ->> 'selected' when 'Emerging' then 'E' when 'Established' then 'S' when 'Corporate' then 'C' end;
  v_options boolean := coalesce((d -> 'options' ->> 'showOptions')::boolean, false);
begin
  if d ->> 'quoteType' = 'Custom' then
    for it in select * from jsonb_array_elements(coalesce(d -> 'custom' -> 'items', '[]')) loop
      if btrim(coalesce(it ->> 'title', '')) = '' then continue; end if;
      if it ->> 'type' = 'One-time' then v_one := v_one + ardentax_num(it -> 'fee'); end if;
      if it ->> 'type' = 'Annual' then v_annual := v_annual + ardentax_num(it -> 'fee'); end if;
    end loop;
  else
    foreach k in array array['ONB','SUP','FULL','GAP','TRN','ANN','ENT','CMP','X1','X2'] loop
      r := d -> 'rows' -> k;
      if r is null or not coalesce((r ->> 'inc')::boolean, false) then continue; end if;
      v_fee := ardentax_num(r -> 'fee');
      if k = 'ANN' and btrim(coalesce(r ->> 'fee', '')) = '' then v_fee := ardentax_num(d -> 'tiers' -> v_tier -> 'year'); end if;
      if r ->> 'type' = 'One-time' and not (v_options and k in ('SUP','FULL')) then v_one := v_one + v_fee; end if;
      if r ->> 'type' = 'Annual' then v_annual := v_annual + v_fee; end if;
    end loop;
  end if;
  return jsonb_build_object('one_time', v_one, 'annual', v_annual, 'year1', v_one + v_annual);
end $$;
grant execute on function public.ardentax_totals(jsonb) to authenticated;

-- Checks and figures shared by create and revise.
create or replace function public.ardentax_prepare(d jsonb, p_totals jsonb) returns jsonb
language plpgsql stable set search_path = public, pg_temp as $$
declare t jsonb := ardentax_totals(d); k text;
  v_tier text := case d ->> 'selected' when 'Emerging' then 'E' when 'Established' then 'S' when 'Corporate' then 'C' end;
  v_custom boolean := d ->> 'quoteType' = 'Custom';
begin
  if btrim(coalesce(d -> 'client' ->> 'legal', '')) = '' then raise exception 'Enter the client name'; end if;
  if p_totals is not null then
    foreach k in array array['one_time','annual','year1'] loop
      if abs(ardentax_num(p_totals -> k) - ardentax_num(t -> k)) >= 0.005 then raise exception 'The totals do not match: % is % on screen and % here', k, p_totals ->> k, t ->> k; end if;
    end loop;
  end if;
  return t || jsonb_build_object(
    'quote_type', case when v_custom then 'Custom' else 'Standard' end,
    'selected_package', case when v_custom then 'Custom' else d ->> 'selected' end,
    'volume', case when v_custom then ardentax_num(d -> 'custom' -> 'volume') else ardentax_num(d -> 'tiers' -> v_tier -> 'docs') end);
end $$;

create or replace function public.ardentax_document_create(p jsonb) returns public.ardentax_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_request uuid := (p ->> 'request_id')::uuid; v_quote uuid := (p ->> 'source_quote_id')::uuid;
  d jsonb := p -> 'details'; q ardentax_documents; r ardentax_documents; t jsonb; v_number text;
begin
  if auth.uid() is null or not ardentax_can() then raise exception 'No access to the ArdentTax tab'; end if;
  if v_type is null or v_type not in ('quote','letter') then raise exception 'Unknown document type'; end if;
  if v_request is null then raise exception 'A request id is needed'; end if;
  -- The same request twice, from a double click or a retry, gets the same document and uses no number.
  perform pg_advisory_xact_lock(hashtext('ardentax:' || v_request::text));
  select * into r from ardentax_documents where request_id = v_request;
  if r.id is not null then return r; end if;
  if v_quote is not null then
    select * into q from ardentax_documents where id = v_quote and doc_type = 'quote';
    if q.id is null then raise exception 'Choose a quote for this engagement letter'; end if;
    perform pg_advisory_xact_lock(hashtext('ardentax:' || q.document_number));
    if exists (select 1 from ardentax_documents l join ardentax_documents s on s.id = l.source_quote_id where l.doc_type = 'letter' and s.document_number = q.document_number) then
      raise exception 'Quote % already has its engagement letter', q.document_number;
    end if;
    if d is null then d := jsonb_set(q.details, '{docType}', '"letter"'); end if;
  end if;
  if d is null then raise exception 'The document details are missing'; end if;
  t := ardentax_prepare(d, p -> 'totals');
  v_number := hub_next_number('ArdentTax (ASP)', v_type);
  insert into ardentax_documents (request_id, doc_type, document_number, document_serial, source_quote_id, quote_type, client_name, selected_package, volume, one_time, annual, year1_total, details, mail_to, mail_cc, mail_subject, mail_body)
  values (v_request, v_type, v_number, hub_serial_of('ArdentTax (ASP)', v_type, v_number), v_quote, t ->> 'quote_type', btrim(d -> 'client' ->> 'legal'), t ->> 'selected_package', (t ->> 'volume')::numeric,
          (t ->> 'one_time')::numeric, (t ->> 'annual')::numeric, (t ->> 'year1')::numeric, d, p ->> 'mail_to', p ->> 'mail_cc', p ->> 'mail_subject', p ->> 'mail_body')
  returning * into r;
  return r;
end $$;

-- A revision keeps the number. p takes request_id, details, totals and the mail fields.
create or replace function public.ardentax_document_revise(p_id uuid, p jsonb) returns public.ardentax_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  b ardentax_documents; r ardentax_documents; t jsonb; v_request uuid := (p ->> 'request_id')::uuid; d jsonb := p -> 'details'; v_version int;
begin
  if auth.uid() is null or not ardentax_can() then raise exception 'No access to the ArdentTax tab'; end if;
  if v_request is null then raise exception 'A request id is needed'; end if;
  perform pg_advisory_xact_lock(hashtext('ardentax:' || v_request::text));
  select * into r from ardentax_documents where request_id = v_request;
  if r.id is not null then return r; end if;
  select * into b from ardentax_documents where id = p_id;
  if b.id is null then raise exception 'Document not found'; end if;
  perform pg_advisory_xact_lock(hashtext('ardentax:' || b.document_number));
  if d is null then raise exception 'The document details are missing'; end if;
  t := ardentax_prepare(d, p -> 'totals');
  select max(version) + 1 into v_version from ardentax_documents where document_number = b.document_number;
  insert into ardentax_documents (request_id, doc_type, document_number, document_serial, version, revision_of, source_quote_id, quote_type, client_name, selected_package, volume, one_time, annual, year1_total, details, mail_to, mail_cc, mail_subject, mail_body)
  values (v_request, b.doc_type, b.document_number, b.document_serial, v_version, b.id, b.source_quote_id, t ->> 'quote_type', btrim(d -> 'client' ->> 'legal'), t ->> 'selected_package', (t ->> 'volume')::numeric,
          (t ->> 'one_time')::numeric, (t ->> 'annual')::numeric, (t ->> 'year1')::numeric, d, p ->> 'mail_to', p ->> 'mail_cc', p ->> 'mail_subject', p ->> 'mail_body')
  returning * into r;
  return r;
end $$;

create or replace function public.ardentax_document_attach(p_id uuid, p_word text, p_pdf text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_prefix text := 'ArdentTax (ASP)/' || p_id::text || '/';
begin
  if auth.uid() is null or not ardentax_can() then raise exception 'No access to the ArdentTax tab'; end if;
  if left(p_word, length(v_prefix)) <> v_prefix or left(p_pdf, length(v_prefix)) <> v_prefix then raise exception 'That file path does not belong to this document'; end if;
  update ardentax_documents set word_path = p_word, pdf_path = p_pdf where id = p_id;
  if not found then raise exception 'Document not found'; end if;
end $$;

create or replace function public.ardentax_mail_update(p_id uuid, p_to text, p_cc text, p_subject text, p_body text, p_attach_word boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not ardentax_can() then raise exception 'No access to the ArdentTax tab'; end if;
  update ardentax_documents set mail_to = p_to, mail_cc = p_cc, mail_subject = p_subject, mail_body = p_body, mail_attach_word = coalesce(p_attach_word, false) where id = p_id;
  if not found then raise exception 'Document not found'; end if;
end $$;

-- Only the mail function, after the mail server has accepted the message.
create or replace function public.ardentax_mail_sent(p_id uuid, p_user uuid) returns timestamptz
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_at timestamptz := now();
begin
  update ardentax_documents set mail_sent_at = v_at, mail_sent_by = p_user where id = p_id;
  if not found then raise exception 'Document not found'; end if;
  return v_at;
end $$;

revoke all on function public.ardentax_num(jsonb) from public, anon;
revoke all on function public.ardentax_prepare(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.ardentax_document_create(jsonb) from public, anon;
revoke all on function public.ardentax_document_revise(uuid, jsonb) from public, anon;
revoke all on function public.ardentax_document_attach(uuid, text, text) from public, anon;
revoke all on function public.ardentax_mail_update(uuid, text, text, text, text, boolean) from public, anon;
revoke all on function public.ardentax_mail_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ardentax_num(jsonb) to authenticated;
grant execute on function public.ardentax_document_create(jsonb) to authenticated;
grant execute on function public.ardentax_document_revise(uuid, jsonb) to authenticated;
grant execute on function public.ardentax_document_attach(uuid, text, text) to authenticated;
grant execute on function public.ardentax_mail_update(uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.ardentax_mail_sent(uuid, uuid) to service_role;

-- ── Voucher Register ─────────────────────────────────────────────────
-- Other modules reset this check too, so each keeps the full list of sources.
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking','hub','template','business_setup','accounting','ardentax'));
drop policy if exists voucher_register_read_ardentax on public.voucher_register;
create policy voucher_register_read_ardentax on public.voucher_register for select to authenticated using (source = 'ardentax');

create or replace function public.voucher_from_ardentax() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into voucher_register (voucher_type, voucher_number, version, serial, company, department, source, source_id, client_name, issued_on, amount, status, storage_path, created_by, created_at)
  values (case new.doc_type when 'quote' then 'Quotation' else 'Engagement Letter' end, new.document_number, new.version, new.document_serial, 'Ardentax', 'ArdentTax (ASP)', 'ardentax', new.id, new.client_name,
          (new.created_at at time zone 'Asia/Dubai')::date, new.year1_total, case when new.mail_sent_at is not null then 'Sent' when new.word_path is null then 'File pending' else 'Generated' end, new.word_path, new.created_by, new.created_at)
  on conflict (source, voucher_type, source_id) do update set storage_path = excluded.storage_path, status = excluded.status;
  return new;
end $$;
revoke all on function public.voucher_from_ardentax() from public, anon, authenticated;
drop trigger if exists voucher_ardentax on public.ardentax_documents;
create trigger voucher_ardentax after insert or update on public.ardentax_documents for each row execute function public.voucher_from_ardentax();

-- ── Files ────────────────────────────────────────────────────────────
-- hub_docs_read lets any signed-in user read the whole hub-documents bucket. These keep ArdentTax files to the tab's users.
-- storage.objects is owned by supabase_storage_admin on live, so the release checks these policies were created.
do $do$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists hub_docs_ardentax_read on storage.objects;
  create policy hub_docs_ardentax_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'hub-documents' or name not like 'ArdentTax (ASP)/%' or public.ardentax_can());
  drop policy if exists hub_docs_ardentax_insert on storage.objects;
  create policy hub_docs_ardentax_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'hub-documents' or name not like 'ArdentTax (ASP)/%' or public.ardentax_can());
end $do$;
