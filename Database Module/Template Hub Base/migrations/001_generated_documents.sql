-- =====================================================================
-- Template Hub Base - generated documents                          001
-- =====================================================================
-- Every quotation, engagement letter and mail draft made from the services in Services Base.
-- Run after Banking Base and Services Base. Re-runnable.
-- =====================================================================
create table if not exists public.hub_settings (key text primary key, value jsonb not null);
create table if not exists public.hub_number_counters (
  department text not null, kind text not null check (kind in ('quote','letter')), period text not null default 'all',
  last_serial int not null default 0, primary key (department, kind, period)
);
create table if not exists public.hub_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('quote','letter','mail')),
  department text not null,
  company text not null default 'AB Capital',
  document_number text,
  document_serial int,
  client_name text not null,
  contact_name text, contact_email text,
  services text[] not null default '{}',
  lines jsonb not null default '[]',
  vat_mode text not null default 'inclusive' check (vat_mode in ('inclusive','exclusive','none')),
  vat_rate numeric(5,2) not null default 5,
  vat_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  valid_until date, notes text,
  mail_subject text, mail_body text,
  storage_path text, local_path text,             -- where the generated file is kept
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists hub_documents_dept_idx on public.hub_documents (department, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['hub_settings','hub_number_counters','hub_documents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
grant select on public.hub_documents, public.hub_settings to authenticated;
drop policy if exists hub_set_read on public.hub_settings;
create policy hub_set_read on public.hub_settings for select to authenticated using (true);
drop policy if exists hub_doc_read on public.hub_documents;
create policy hub_doc_read on public.hub_documents for select to authenticated using (true);

-- Company details and the AML wording come from Banking settings, so bank details stay out of this public repo.
insert into public.hub_settings (key, value) select 'company', value from public.banking_settings where key = 'company' on conflict (key) do nothing;
insert into public.hub_settings (key, value)
select 'engagement_terms', jsonb_build_object(
  'fee_intro', t.value ->> 'fee_intro',
  'payment_terms', jsonb_build_array('{{vat_statement}}', 'We will commence the work once the agreed payment is received.'),
  'ab_responsibilities', jsonb_build_array('Carry out the services listed above with due care.', 'Keep the client informed of progress and of any information needed.'),
  'client_responsibilities', jsonb_build_array('Provide complete, true and current information and documents on time.', 'Inform AB Capital promptly of any change that affects the services.'),
  'limitations', 'The services are performed on the information the client provides. Decisions of government authorities, regulators, banks and other third parties rest with them, and AB Capital does not guarantee their outcome or timing. Government and third-party fees are payable by the client unless stated above.',
  'reps', t.value ->> 'reps')
from public.banking_settings t where t.key = 'engagement_terms'
on conflict (key) do nothing;

-- ── Creating documents ───────────────────────────────────────────────
-- Business Banking shares the serials of its own quotes and letters. Others: ABC/YYYY/MM/<code><Q|E>001.
create or replace function public.hub_next_number(p_department text, p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_serial int; v_on date := (now() at time zone 'Asia/Dubai')::date;
begin
  if p_department = 'Business Banking' then return banking_next_number(p_kind); end if;
  v_code := case p_department when 'Business Setup' then 'BS' when 'Accounting' then 'AC' when 'Tax Compliance' then 'TC' end;
  if v_code is null then raise exception 'Unknown department'; end if;
  insert into hub_number_counters (department, kind) values (p_department, p_kind) on conflict do nothing;
  update hub_number_counters set last_serial = last_serial + 1 where department = p_department and kind = p_kind and period = 'all' returning last_serial into v_serial;
  return 'ABC/' || to_char(v_on, 'YYYY') || '/' || to_char(v_on, 'MM') || '/' || v_code || case p_kind when 'quote' then 'Q' else 'E' end || lpad(v_serial::text, greatest(3, length(v_serial::text)), '0');
end $$;

-- The server works out VAT and total itself, so a figure on a document cannot disagree with its lines.
create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if nullif(trim(p ->> 'client_name'), '') is null then raise exception 'Enter the client name'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Choose at least one service'; end if;
  for it in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((it ->> 'amount')::numeric, -1) < 0 then raise exception 'Enter a fee for %', it ->> 'description'; end if;
    v_net := v_net + (it ->> 'amount')::numeric;
  end loop;
  if v_mode = 'exclusive' then v_vat := round(v_net * v_rate / 100, 2); v_total := v_net + v_vat;
  elsif v_mode = 'inclusive' then v_vat := round(v_net * v_rate / (100 + v_rate), 2); v_total := v_net;
  else v_total := v_net; end if;
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type); end if;
  insert into hub_documents (doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body)
  values (v_type, p ->> 'department', v_number, substring(v_number from '([0-9]+)$')::int, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), p -> 'lines', v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body')
  returning * into r;
  return r;
end $$;

create or replace function public.hub_document_attach(p_id uuid, p_storage text, p_local text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update hub_documents set storage_path = coalesce(p_storage, storage_path), local_path = coalesce(p_local, local_path) where id = p_id and created_by = auth.uid()
$$;

revoke all on function public.hub_next_number(text, text) from public, anon, authenticated;
revoke all on function public.hub_document_create(jsonb) from public, anon;
grant execute on function public.hub_document_create(jsonb) to authenticated;
revoke all on function public.hub_document_attach(uuid, text, text) from public, anon;
grant execute on function public.hub_document_attach(uuid, text, text) to authenticated;

do $do$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public, file_size_limit) values ('hub-documents', 'hub-documents', false, 26214400) on conflict (id) do update set public = false;
  drop policy if exists hub_docs_read on storage.objects;
  create policy hub_docs_read on storage.objects for select to authenticated using (bucket_id = 'hub-documents');
  drop policy if exists hub_docs_insert on storage.objects;
  create policy hub_docs_insert on storage.objects for insert to authenticated with check (bucket_id = 'hub-documents');
end $do$;
