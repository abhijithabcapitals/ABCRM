-- =====================================================================
-- Template Hub Base - Company Library templates and generated documents    004
-- =====================================================================
-- Staff fill a Word template from the Company Library and get a numbered document.
--   AB Capital documents stay doc_type 'quote' in Business Setup (BSQ numbers, Voucher Register, engagement letter step).
--   Ardentax documents are doc_type 'library' in the department 'Ardentax Documents' (ADTD numbers, own counter).
-- hub_numbering_status and hub_numbering_save are the live text from Template Hub 004_hub_admin with 'document' added; hub_doc_read hides
-- library rows from people without the ArdentTax tab. Run after Business Setup 001-014, ArdentTax 001 and Template Hub 003.
-- Re-runnable. Undo with rollback/005_rollback.sql.
-- =====================================================================

-- ── Columns, checks and numbering ────────────────────────────────────
alter table public.hub_documents add column if not exists library_template text;       -- Company Library template key
alter table public.hub_documents add column if not exists library_file_id bigint;      -- the template file the document was rendered from
alter table public.hub_documents add column if not exists field_values jsonb;          -- what staff typed, so a document can be rebuilt

alter table public.hub_documents drop constraint if exists hub_documents_doc_type_check;
alter table public.hub_documents add constraint hub_documents_doc_type_check check (doc_type in ('quote','letter','mail','library'));
alter table public.hub_number_counters drop constraint if exists hub_number_counters_kind_check;
alter table public.hub_number_counters add constraint hub_number_counters_kind_check check (kind in ('quote','letter','receipt','document'));

insert into public.service_departments (name, crm_tab, sort_order) values ('Ardentax Documents', 'Ardentax Documents', 6) on conflict (name) do nothing;
-- Added only when absent, so a format edited on the Numbering page survives a re-run.
update public.hub_settings
   set value = value || '{"Ardentax Documents": {"document": {"format":"Ardentax/{YYYY}/{MM}/ADTD{SERIAL}","digits":3,"restart":"never"}}}'::jsonb
 where key = 'document_numbering' and not (value ? 'Ardentax Documents');

-- ── Templates and their files ────────────────────────────────────────
create table if not exists public.hub_library_templates (
  template_key text primary key,                                       -- <Company>/<Folder>/<Name>
  company text not null check (company in ('AB Capital','Ardentax')),
  folder text not null,
  name text not null,
  fee_rows jsonb not null default '[]'::jsonb,
  usd_rate numeric,
  active boolean not null default true,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
create table if not exists public.hub_library_template_files (
  id bigint generated always as identity primary key,
  template_key text not null references public.hub_library_templates(template_key),
  file_name text not null,
  storage_path text not null,
  uploaded_by uuid default auth.uid(),
  uploaded_at timestamptz not null default now()
);
create index if not exists hub_library_template_files_idx on public.hub_library_template_files (template_key, id desc);
alter table public.hub_documents drop constraint if exists hub_documents_library_file_fk;
alter table public.hub_documents add constraint hub_documents_library_file_fk foreign key (library_file_id) references public.hub_library_template_files(id);

alter table public.hub_library_templates enable row level security;
alter table public.hub_library_template_files enable row level security;
revoke all on public.hub_library_templates, public.hub_library_template_files from public, anon, authenticated;
grant select on public.hub_library_templates, public.hub_library_template_files to authenticated;
drop policy if exists hub_library_templates_read on public.hub_library_templates;
create policy hub_library_templates_read on public.hub_library_templates for select to authenticated using (company <> 'Ardentax' or public.ardentax_can());
drop policy if exists hub_library_template_files_read on public.hub_library_template_files;
create policy hub_library_template_files_read on public.hub_library_template_files for select to authenticated
  using (exists (select 1 from public.hub_library_templates t where t.template_key = hub_library_template_files.template_key and (t.company <> 'Ardentax' or public.ardentax_can())));

-- Library rows of Ardentax are for the ArdentTax tab only. AB Capital library documents are ordinary quotes.
drop policy if exists hub_doc_read on public.hub_documents;
create policy hub_doc_read on public.hub_documents for select to authenticated using (doc_type <> 'library' or public.ardentax_can());

-- ── Numbering: 'document' behaves like 'receipt' ─────────────────────
-- Text of Business Setup 004, except: the kinds read are those the department's setting has (so a department with only
-- 'document' works), and 'document' is one of them.
create or replace function public.hub_numbering_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_on date := (now() at time zone 'Asia/Dubai')::date; cfg jsonb := (select value from hub_settings where key = 'document_numbering');
  out jsonb := jsonb_build_object('can_manage', hub_is_admin() or banking_can('settings.manage') or business_setup_can('setup.settings.manage')); d text; k text; c jsonb; n int;
begin
  for d in select jsonb_object_keys(cfg) loop
    for k in select unnest(array['quote','letter','receipt','document']) loop
      continue when not ((cfg -> d) ? k);
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
declare v_period text; v_cfg jsonb;
begin
  -- Numbering is shared by every department: Banking rights as before, and Business Setup settings rights for Business Setup only.
  if not (hub_is_admin() or (p_department = 'Business Setup' and business_setup_can('setup.settings.manage'))) then perform banking_require('settings.manage'); end if;
  if p_department = 'Business Banking' then perform banking_numbering_save(p_kind, p_format, p_digits, p_restart, p_next); return; end if;
  -- Receipt and document are accepted only where the department's setting already has them. A department with a setting
  -- takes only the kinds it has; one without a setting keeps the earlier rule (quote and letter).
  v_cfg := (select value from hub_settings where key = 'document_numbering') -> p_department;
  if not (case when v_cfg is null then p_kind in ('quote','letter') else p_kind in ('quote','letter','receipt','document') and v_cfg ? p_kind end) then
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

-- ── Functions ────────────────────────────────────────────────────────
create or replace function public.hub_library_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('ab', coalesce(business_setup_can('setup.quotes.manage'), false), 'ardentax', coalesce(ardentax_can(), false), 'manage', coalesce(hub_is_admin() or banking_can('settings.manage'), false))
$$;

create or replace function public.hub_library_template_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := btrim(coalesce(p ->> 'template_key', '')); v_company text := btrim(coalesce(p ->> 'company', ''));
  v_folder text := btrim(coalesce(p ->> 'folder', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_rows jsonb := coalesce(p -> 'fee_rows', '[]'::jsonb); v_rate numeric := nullif(btrim(coalesce(p ->> 'usd_rate', '')), '')::numeric;
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
begin
  if not hub_is_admin() then perform banking_require('settings.manage'); end if;
  if v_company not in ('AB Capital','Ardentax') then raise exception 'Company must be AB Capital or Ardentax'; end if;
  if v_folder = '' or v_name = '' then raise exception 'A template needs a folder and a name'; end if;
  if v_key <> v_company || '/' || v_folder || '/' || v_name then raise exception 'The template key must be Company/Folder/Name'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Fee rows must be a list'; end if;
  if v_rate is not null and v_rate <= 0 then raise exception 'The USD rate must be more than zero'; end if;
  insert into hub_library_templates (template_key, company, folder, name, fee_rows, usd_rate, active, updated_by, updated_at)
  values (v_key, v_company, v_folder, v_name, v_rows, v_rate, v_active, auth.uid(), now())
  on conflict (template_key) do update set company = excluded.company, folder = excluded.folder, name = excluded.name, fee_rows = excluded.fee_rows,
    usd_rate = excluded.usd_rate, active = excluded.active, updated_by = auth.uid(), updated_at = now();
  return v_key;
end $$;

create or replace function public.hub_library_template_upload(p_key text, p_name text, p_path text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare t hub_library_templates; v_id bigint;
begin
  if not hub_is_admin() then perform banking_require('settings.manage'); end if;
  select * into t from hub_library_templates where template_key = p_key;
  if t.template_key is null then raise exception 'Unknown template %', p_key; end if;
  if coalesce(p_name, '') !~* '\.docx$' or coalesce(p_path, '') not like 'library-templates/%' then raise exception 'A library template must be an uploaded Word (.docx) file'; end if;
  -- The folder carries the storage rule: Ardentax files stay under library-templates/Ardentax/.
  if p_path not like 'library-templates/' || t.company || '/%' then raise exception 'The file must be stored under library-templates/%/', t.company; end if;
  insert into hub_library_template_files (template_key, file_name, storage_path) values (p_key, p_name, p_path) returning id into v_id;
  return v_id;
end $$;

-- One call takes the number and writes the row. AB Capital goes through hub_document_create, so it keeps that function's
-- checks (setup.quotes.manage, client details, client exists). Ardentax needs ardentax_can().
create or replace function public.hub_library_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t hub_library_templates; r hub_documents; v_file bigint; v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb); it jsonb; v_out jsonb := '[]'::jsonb;
  v_amt numeric; v_total numeric := 0; v_fields jsonb := coalesce(p -> 'field_values', '{}'::jsonb); v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
  v_number text; v_id uuid := gen_random_uuid();
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into t from hub_library_templates where template_key = p ->> 'template_key';
  if t.template_key is null then raise exception 'Unknown template'; end if;
  if not t.active then raise exception 'This template is retired'; end if;
  v_file := nullif(p ->> 'file_id', '')::bigint;
  if v_file is null or not exists (select 1 from hub_library_template_files where id = v_file and template_key = t.template_key) then
    raise exception 'The template file does not belong to this template';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'Fee rows must be a list'; end if;
  if jsonb_typeof(v_fields) <> 'object' then raise exception 'Field values must be an object'; end if;

  if t.company = 'AB Capital' then
    r := hub_document_create(jsonb_build_object(
      'doc_type', 'quote', 'department', 'Business Setup', 'vat_mode', 'none', 'client_id', v_client,
      'client_name', p ->> 'client_name', 'contact_name', p ->> 'contact_name', 'contact_email', p ->> 'contact_email', 'contact_phone', p ->> 'contact_phone',
      'client_address', p ->> 'client_address', 'lines', v_lines,
      'services', (select coalesce(jsonb_agg(l ->> 'description'), '[]'::jsonb) from jsonb_array_elements(v_lines) l where nullif(btrim(coalesce(l ->> 'description', '')), '') is not null)));
    update hub_documents set library_template = t.template_key, library_file_id = v_file, field_values = v_fields where id = r.id returning * into r;
    return r;
  end if;

  if not ardentax_can() then raise exception 'You do not have access to Ardentax documents'; end if;
  if nullif(btrim(coalesce(p ->> 'client_name', '')), '') is null then raise exception 'Enter the client name'; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  for it in select * from jsonb_array_elements(v_lines) loop
    v_amt := coalesce(nullif(btrim(coalesce(it ->> 'amount', '')), '')::numeric, 0);
    if v_amt < 0 then raise exception 'Enter a fee of zero or more for %', it ->> 'description'; end if;
    v_total := v_total + v_amt;
    v_out := v_out || jsonb_build_array(it || jsonb_build_object('amount', v_amt));
  end loop;
  v_number := hub_next_number('Ardentax Documents', 'document');
  insert into hub_documents (id, doc_type, department, company, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, client_id,
                             services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, library_file_id, field_values)
  values (v_id, 'library', 'Ardentax Documents', 'Ardentax', v_number, hub_serial_of('Ardentax Documents', 'document', v_number), btrim(p ->> 'client_name'),
          nullif(btrim(coalesce(p ->> 'contact_name', '')), ''), nullif(btrim(coalesce(p ->> 'contact_email', '')), ''), nullif(btrim(coalesce(p ->> 'contact_phone', '')), ''),
          nullif(btrim(coalesce(p ->> 'client_address', '')), ''), v_client,
          array(select l ->> 'description' from jsonb_array_elements(v_out) l where nullif(btrim(coalesce(l ->> 'description', '')), '') is not null),
          v_out, 'none', 0, 0, v_total, t.template_key, v_file, v_fields)
  returning * into r;
  return r;
end $$;

revoke all on function public.hub_numbering_status() from public, anon;
grant execute on function public.hub_numbering_status() to authenticated;
revoke all on function public.hub_numbering_save(text, text, text, int, text, int) from public, anon;
grant execute on function public.hub_numbering_save(text, text, text, int, text, int) to authenticated;
revoke all on function public.hub_library_my_access(), public.hub_library_template_save(jsonb), public.hub_library_template_upload(text, text, text), public.hub_library_create(jsonb) from public, anon;
grant execute on function public.hub_library_my_access(), public.hub_library_template_save(jsonb), public.hub_library_template_upload(text, text, text), public.hub_library_create(jsonb) to authenticated;

-- ── Files ────────────────────────────────────────────────────────────
-- Same pattern as hub_docs_ardentax_* in ArdentTax 001. storage.objects is owned by supabase_storage_admin on live,
-- so the release checks these policies were created.
do $do$
begin
  if to_regclass('storage.objects') is null then return; end if;
  drop policy if exists hub_docs_library_ardentax_read on storage.objects;
  create policy hub_docs_library_ardentax_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'hub-documents' or (name not like 'Ardentax Documents/%' and name not like 'library-templates/Ardentax/%') or public.ardentax_can());
  drop policy if exists hub_docs_library_ardentax_insert on storage.objects;
  create policy hub_docs_library_ardentax_insert on storage.objects as restrictive for insert to authenticated
    with check (bucket_id <> 'hub-documents' or (name not like 'Ardentax Documents/%' and name not like 'library-templates/Ardentax/%') or public.ardentax_can());
end $do$;
