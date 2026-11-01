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
-- One format per department and document type, set on the Numbering page. Business Banking keeps its own settings.
insert into public.hub_settings (key, value) values ('document_numbering', '{
  "Business Setup": {"quote": {"format":"ABC/{YYYY}/{MM}/BSQ{SERIAL}","digits":3,"restart":"never"}, "letter": {"format":"ABC/{YYYY}/{MM}/BSE{SERIAL}","digits":3,"restart":"never"}},
  "Accounting": {"quote": {"format":"ABC/{YYYY}/{MM}/ACQ{SERIAL}","digits":3,"restart":"never"}, "letter": {"format":"ABC/{YYYY}/{MM}/ACE{SERIAL}","digits":3,"restart":"never"}},
  "Tax Compliance": {"quote": {"format":"ABC/{YYYY}/{MM}/TCQ{SERIAL}","digits":3,"restart":"never"}, "letter": {"format":"ABC/{YYYY}/{MM}/TCE{SERIAL}","digits":3,"restart":"never"}}
}') on conflict (key) do nothing;
alter table public.hub_documents add column if not exists parent_id uuid references public.hub_documents(id);
alter table public.hub_documents add column if not exists contact_phone text;
alter table public.hub_documents add column if not exists client_address text;
alter table public.hub_documents add column if not exists license_number text;
alter table public.hub_documents add column if not exists vat_trn text;
create unique index if not exists hub_one_letter_per_quote on public.hub_documents (parent_id) where doc_type = 'letter';

create or replace function public.hub_next_number(p_department text, p_kind text) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cfg jsonb := (select value from hub_settings where key = 'document_numbering') -> p_department -> p_kind;
  v_on date := (now() at time zone 'Asia/Dubai')::date; v_period text; v_serial int; v_number text;
begin
  if p_department = 'Business Banking' then return banking_next_number(p_kind); end if;
  if cfg is null then raise exception 'No numbering set for % %', p_department, p_kind; end if;
  v_period := banking_number_period(cfg ->> 'restart', v_on);
  insert into hub_number_counters (department, kind, period) values (p_department, p_kind, v_period) on conflict do nothing;
  select last_serial into v_serial from hub_number_counters where department = p_department and kind = p_kind and period = v_period for update;
  loop
    v_serial := v_serial + 1;
    v_number := banking_number_format(cfg ->> 'format', (cfg ->> 'digits')::int, v_serial, v_on);
    exit when not exists (select 1 from hub_documents where document_number = v_number);
  end loop;
  update hub_number_counters set last_serial = v_serial where department = p_department and kind = p_kind and period = v_period;
  return v_number;
end $$;

-- Reads the serial out of a number through its format, so the two cannot disagree.
create or replace function public.hub_serial_of(p_department text, p_kind text, p_number text) returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare fmt text := case when p_department = 'Business Banking' then banking_setting('document_numbering') -> p_kind ->> 'format'
                         else (select value from hub_settings where key = 'document_numbering') -> p_department -> p_kind ->> 'format' end;
begin
  return substring(p_number from '^' || replace(replace(replace(regexp_replace(fmt, '([.+*?()\[\]^$|\\])', '\\\1', 'g'), '{YYYY}', '[0-9]{4}'), '{MM}', '[0-9]{2}'), '{SERIAL}', '([0-9]+)') || '$')::int;
end $$;

create or replace function public.hub_numbering_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_on date := (now() at time zone 'Asia/Dubai')::date; cfg jsonb := (select value from hub_settings where key = 'document_numbering');
  out jsonb := jsonb_build_object('can_manage', banking_can('settings.manage')); d text; k text; c jsonb; n int;
begin
  for d in select jsonb_object_keys(cfg) loop
    for k in select unnest(array['quote','letter']) loop
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
  perform banking_require('settings.manage');
  if p_department = 'Business Banking' then perform banking_numbering_save(p_kind, p_format, p_digits, p_restart, p_next); return; end if;
  if p_kind not in ('quote','letter') then raise exception 'Unknown document kind'; end if;
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

-- The server works out VAT and total itself, so a figure on a document cannot disagree with its lines.
create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- An engagement letter exists only as the next step of a generated quote, and takes everything from it.
  if v_type = 'letter' then
    select * into q from hub_documents where id = (p ->> 'parent_id')::uuid and doc_type = 'quote';
    if q.id is null then raise exception 'Generate the quote first: an engagement letter comes from a quote'; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    p := jsonb_build_object('doc_type', 'letter', 'parent_id', q.id, 'department', q.department, 'client_name', q.client_name, 'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'client_address', q.client_address, 'license_number', q.license_number, 'vat_trn', q.vat_trn, 'services', to_jsonb(q.services), 'lines', q.lines, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate);
    v_mode := q.vat_mode; v_rate := q.vat_rate;
  end if;
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
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type);
  elsif (p ->> 'parent_id') is not null then select document_number into v_number from hub_documents where id = (p ->> 'parent_id')::uuid;
  end if;
  insert into hub_documents (parent_id, doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body)
  values ((p ->> 'parent_id')::uuid, v_type, p ->> 'department', v_number, case when v_type in ('quote','letter') then hub_serial_of(p ->> 'department', v_type, v_number) end, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone', p ->> 'client_address', p ->> 'license_number', p ->> 'vat_trn',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), p -> 'lines', v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body')
  returning * into r;
  return r;
end $$;

create or replace function public.hub_document_attach(p_id uuid, p_storage text, p_local text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update hub_documents set storage_path = coalesce(p_storage, storage_path), local_path = coalesce(p_local, local_path) where id = p_id and created_by = auth.uid()
$$;

create or replace function public.hub_mail_update(p_id uuid, p_subject text, p_body text) returns void
language sql security definer set search_path = public, pg_temp as $$
  update hub_documents set mail_subject = p_subject, mail_body = p_body where id = p_id and doc_type = 'mail' and created_by = auth.uid()
$$;

revoke all on function public.hub_next_number(text, text) from public, anon, authenticated;
revoke all on function public.hub_serial_of(text, text, text) from public, anon, authenticated;
revoke all on function public.hub_numbering_status() from public, anon;
grant execute on function public.hub_numbering_status() to authenticated;
revoke all on function public.hub_numbering_save(text, text, text, int, text, int) from public, anon;
grant execute on function public.hub_numbering_save(text, text, text, int, text, int) to authenticated;
revoke all on function public.hub_mail_update(uuid, text, text) from public, anon;
grant execute on function public.hub_mail_update(uuid, text, text) to authenticated;
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
