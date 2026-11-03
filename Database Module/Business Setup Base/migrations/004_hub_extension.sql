-- =====================================================================
-- Business Setup Base - extend the shared service documents        002
-- =====================================================================
-- Adds the client link, quote status and revision chain to hub_documents, receipt numbering, and the rule that a
-- Business Setup engagement letter needs an accepted quote. Other departments behave as before.
-- Run after Template Hub Base 001 and Business Setup Base 003. Re-runnable.
-- Template Hub Base 001 also defines hub_next_number, hub_numbering_status, hub_numbering_save and hub_document_create:
-- run this file again whenever that file is re-run, or its older versions replace these.
-- =====================================================================

-- ── Columns on hub_documents ─────────────────────────────────────────
alter table public.hub_documents add column if not exists client_id text references public.client_master(client_id);
alter table public.hub_documents add column if not exists status text not null default 'issued';
alter table public.hub_documents add column if not exists status_at timestamptz;
alter table public.hub_documents add column if not exists status_by uuid references public.profiles(id);
alter table public.hub_documents add column if not exists status_reason text;
alter table public.hub_documents add column if not exists revises_id uuid references public.hub_documents(id);
alter table public.hub_documents add column if not exists signed_at date;
alter table public.hub_documents add column if not exists signed_path text;
alter table public.hub_documents add column if not exists template_key text references public.business_setup_quote_templates(key);   -- Word template a Business Setup quote was made from
alter table public.hub_documents add column if not exists root_quote_id uuid references public.hub_documents(id);   -- first quote of a revision chain (own id when not a revision)
alter table public.hub_documents drop constraint if exists hub_documents_status_check;
alter table public.hub_documents add constraint hub_documents_status_check check (status in ('issued','accepted','rejected','superseded'));
create index if not exists hub_documents_client_idx on public.hub_documents (client_id) where client_id is not null;
create index if not exists hub_documents_revises_idx on public.hub_documents (revises_id) where revises_id is not null;

-- Fill the chain root for quotes made before this column existed (walks up revises_id).
with recursive up as (
  select id, id as root, revises_id from public.hub_documents where doc_type = 'quote' and root_quote_id is null
  union all
  select up.id, d.id, d.revises_id from up join public.hub_documents d on d.id = up.revises_id
)
update public.hub_documents h set root_quote_id = up.root from up where up.id = h.id and up.revises_id is null and h.root_quote_id is null;
-- Only one quote per revision chain can be accepted, even under concurrent calls.
create unique index if not exists hub_documents_one_accepted_per_root on public.hub_documents (root_quote_id)
  where status = 'accepted' and doc_type = 'quote' and root_quote_id is not null;

-- ── Counters and the receipt format ──────────────────────────────────
alter table public.hub_number_counters drop constraint if exists hub_number_counters_kind_check;
alter table public.hub_number_counters add constraint hub_number_counters_kind_check check (kind in ('quote','letter','receipt'));

-- Added only when absent, so a format edited on the Numbering page survives a re-run.
update public.hub_settings
   set value = jsonb_set(value, '{Business Setup,receipt}', '{"format":"ABC/{YYYY}/{MM}/BSR{SERIAL}","digits":3,"restart":"never"}'::jsonb)
 where key = 'document_numbering' and value ? 'Business Setup' and not ((value -> 'Business Setup') ? 'receipt');

create or replace function public.hub_next_number(p_department text, p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := (select value from hub_settings where key = 'document_numbering') -> p_department -> p_kind;
  v_on date := (now() at time zone 'Asia/Dubai')::date; v_period text; v_serial int; v_number text; v_used boolean;
begin
  if p_department = 'Business Banking' then return banking_next_number(p_kind); end if;
  if cfg is null then raise exception 'No numbering set for % %', p_department, p_kind; end if;
  v_period := banking_number_period(cfg ->> 'restart', v_on);
  insert into hub_number_counters (department, kind, period) values (p_department, p_kind, v_period) on conflict do nothing;
  select last_serial into v_serial from hub_number_counters where department = p_department and kind = p_kind and period = v_period for update;
  loop
    v_serial := v_serial + 1;
    v_number := banking_number_format(cfg ->> 'format', (cfg ->> 'digits')::int, v_serial, v_on);
    -- Receipts live in business_setup_receipts; quotes and letters in hub_documents.
    if p_kind = 'receipt' then v_used := exists (select 1 from business_setup_receipts where receipt_number = v_number);
    else v_used := exists (select 1 from hub_documents where document_number = v_number); end if;
    exit when not v_used;
  end loop;
  update hub_number_counters set last_serial = v_serial where department = p_department and kind = p_kind and period = v_period;
  return v_number;
end $$;

create or replace function public.hub_numbering_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_on date := (now() at time zone 'Asia/Dubai')::date; cfg jsonb := (select value from hub_settings where key = 'document_numbering');
  out jsonb := jsonb_build_object('can_manage', banking_can('settings.manage') or business_setup_can('setup.settings.manage')); d text; k text; c jsonb; n int;
begin
  for d in select jsonb_object_keys(cfg) loop
    -- Receipt appears only for a department whose setting has it.
    for k in select unnest(array['quote','letter'] || case when (cfg -> d) ? 'receipt' then array['receipt'] else array[]::text[] end) loop
      c := cfg -> d -> k;
      n := coalesce((select last_serial from hub_number_counters x where x.department = d and x.kind = k and x.period = banking_number_period(c ->> 'restart', v_on)), 0) + 1;
      out := jsonb_set(out, array[d], coalesce(out -> d, '{}'::jsonb) || jsonb_build_object(k, jsonb_build_object('format', c ->> 'format', 'digits', (c ->> 'digits')::int, 'restart', c ->> 'restart', 'next_serial', n, 'preview', banking_number_format(c ->> 'format', (c ->> 'digits')::int, n, v_on))));
    end loop;
  end loop;
  -- Business Banking reads its own numbering.
  return out || jsonb_build_object('Business Banking', (
    select jsonb_object_agg(z.kind, jsonb_build_object('format', z.cf ->> 'format', 'digits', (z.cf ->> 'digits')::int, 'restart', z.cf ->> 'restart', 'next_serial', z.nx, 'preview', banking_number_format(z.cf ->> 'format', (z.cf ->> 'digits')::int, z.nx, v_on)))
      from (select y.kind, y.cf, coalesce((select x.last_serial from banking_number_counters x where x.kind = y.kind and x.period = banking_number_period(y.cf ->> 'restart', v_on)), 0) + 1 as nx
              from (select u.kind, banking_setting('document_numbering') -> u.kind as cf from unnest(array['quote','letter']) as u(kind)) y) z));
end $$;

create or replace function public.hub_numbering_save(p_department text, p_kind text, p_format text, p_digits int, p_restart text, p_next int) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_period text;
begin
  -- Numbering is shared by every department: Banking rights as before, and Business Setup settings rights for Business Setup only.
  if not (p_department = 'Business Setup' and business_setup_can('setup.settings.manage')) then perform banking_require('settings.manage'); end if;
  if p_department = 'Business Banking' then perform banking_numbering_save(p_kind, p_format, p_digits, p_restart, p_next); return; end if;
  -- Receipt is accepted only where the department's setting already has it.
  if not (p_kind in ('quote','letter') or (p_kind = 'receipt' and coalesce(((select value from hub_settings where key = 'document_numbering') -> p_department) ? 'receipt', false))) then
    raise exception 'Unknown document kind';
  end if;
  if not exists (select 1 from service_departments where name = p_department) then raise exception 'Unknown department'; end if;
  if position('{SERIAL}' in coalesce(p_format, '')) = 0 then raise exception 'The format must contain {SERIAL}'; end if;
  if p_digits not between 1 and 8 then raise exception 'Digits must be between 1 and 8'; end if;
  if p_restart not in ('never','year','month') then raise exception 'Unknown restart rule'; end if;
  if p_next < 1 then raise exception 'The next number must be 1 or more'; end if;
  update hub_settings set value = jsonb_set(value, array[p_department, p_kind], jsonb_build_object('format', p_format, 'digits', p_digits, 'restart', p_restart)) where key = 'document_numbering';
  v_period := banking_number_period(p_restart, (now() at time zone 'Asia/Dubai')::date);
  insert into hub_number_counters (department, kind, period, last_serial) values (p_department, p_kind, v_period, p_next - 1)
  on conflict (department, kind, period) do update set last_serial = excluded.last_serial;
end $$;

-- ── Creating documents ───────────────────────────────────────────────
-- As in Template Hub Base 001, plus: client_id and revises_id, the accepted-quote rule for Business Setup letters,
-- and a revision that supersedes the old quote in the same transaction.
create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents; o hub_documents; v_id uuid := gen_random_uuid(); v_root uuid;
  v_client text := nullif(trim(p ->> 'client_id'), ''); v_revises uuid := nullif(p ->> 'revises_id', '')::uuid; v_template text := nullif(trim(p ->> 'template_key'), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- An engagement letter exists only as the next step of a generated quote, and takes everything from it.
  if v_type = 'letter' then
    select * into q from hub_documents where id = (p ->> 'parent_id')::uuid and doc_type = 'quote' for update;
    if q.id is null then raise exception 'Generate the quote first: an engagement letter comes from a quote'; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    if q.department = 'Business Setup' and q.status <> 'accepted' then raise exception 'Mark the quote as accepted first'; end if;
    p := jsonb_build_object('doc_type', 'letter', 'parent_id', q.id, 'department', q.department, 'client_name', q.client_name, 'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'client_address', q.client_address, 'license_number', q.license_number, 'vat_trn', q.vat_trn, 'services', to_jsonb(q.services), 'lines', q.lines, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate);
    v_mode := q.vat_mode; v_rate := q.vat_rate; v_client := q.client_id; v_revises := null;
  end if;
  if v_type <> 'quote' then v_revises := null; v_template := null; end if;
  if v_template is not null and not exists (select 1 from business_setup_quote_templates where key = v_template and active) then raise exception 'Unknown quote template %', v_template; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  if nullif(trim(p ->> 'client_name'), '') is null then raise exception 'Enter the client name'; end if;
  if v_type in ('quote','letter') then
    if nullif(trim(p ->> 'contact_name'), '') is null or nullif(trim(p ->> 'contact_email'), '') is null or nullif(trim(p ->> 'contact_phone'), '') is null or nullif(trim(p ->> 'client_address'), '') is null then
      raise exception 'Fill in the client details first';
    end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one service'; end if;
  for it in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((it ->> 'amount')::numeric, -1) < 0 then raise exception 'Enter a fee for %', it ->> 'description'; end if;
    v_net := v_net + (it ->> 'amount')::numeric;
  end loop;
  if v_mode = 'exclusive' then v_vat := round(v_net * v_rate / 100, 2); v_total := v_net + v_vat;
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
  end if;
  if v_type = 'quote' then v_root := coalesce(o.root_quote_id, o.id, v_id); end if;
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type);
  elsif (p ->> 'parent_id') is not null then select document_number into v_number from hub_documents where id = (p ->> 'parent_id')::uuid;
  end if;
  insert into hub_documents (id, root_quote_id, parent_id, doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body, client_id, revises_id, template_key)
  values (v_id, v_root, (p ->> 'parent_id')::uuid, v_type, p ->> 'department', v_number, case when v_type in ('quote','letter') then hub_serial_of(p ->> 'department', v_type, v_number) end, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone', p ->> 'client_address', p ->> 'license_number', p ->> 'vat_trn',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), p -> 'lines', v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body', v_client, v_revises, v_template)
  returning * into r;
  if v_revises is not null then
    update hub_documents set status = 'superseded', status_at = now(), status_by = auth.uid(), status_reason = 'Revised by ' || r.document_number where id = v_revises;
  end if;
  return r;
end $$;
