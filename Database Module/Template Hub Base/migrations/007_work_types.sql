-- =====================================================================
-- Template Hub Base - AB Capital work types                         007
-- =====================================================================
-- A work type is an AB Capital row of hub_library_templates: fee rows and saved wording, with no file, because every
-- AB Capital document uses the built-in design. Ardentax still needs a file. Run after 006. Re-runnable.
-- Undo with rollback/007_rollback.sql.
-- =====================================================================
alter table public.hub_library_templates add column if not exists sections jsonb not null default '{}'::jsonb;

create or replace function public.hub_library_template_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text := btrim(coalesce(p ->> 'template_key', '')); v_company text := btrim(coalesce(p ->> 'company', ''));
  v_folder text := btrim(coalesce(p ->> 'folder', '')); v_name text := btrim(coalesce(p ->> 'name', ''));
  v_rows jsonb := coalesce(p -> 'fee_rows', '[]'::jsonb); v_rate numeric := nullif(btrim(coalesce(p ->> 'usd_rate', '')), '')::numeric;
  v_active boolean := coalesce((p ->> 'active')::boolean, true); v_sections jsonb := p -> 'sections';
begin
  if not hub_is_admin() then perform banking_require('settings.manage'); end if;
  if v_company not in ('AB Capital','Ardentax') then raise exception 'Company must be AB Capital or Ardentax'; end if;
  if v_folder = '' or v_name = '' then raise exception 'A template needs a folder and a name'; end if;
  if v_key <> v_company || '/' || v_folder || '/' || v_name then raise exception 'The template key must be Company/Folder/Name'; end if;
  if jsonb_typeof(v_rows) <> 'array' then raise exception 'Fee rows must be a list'; end if;
  if v_sections is not null and jsonb_typeof(v_sections) <> 'object' then raise exception 'Wording must be an object'; end if;
  if v_rate is not null and v_rate <= 0 then raise exception 'The USD rate must be more than zero'; end if;
  insert into hub_library_templates (template_key, company, folder, name, fee_rows, usd_rate, active, sections, updated_by, updated_at)
  values (v_key, v_company, v_folder, v_name, v_rows, v_rate, v_active, coalesce(v_sections, '{}'::jsonb), auth.uid(), now())
  on conflict (template_key) do update set company = excluded.company, folder = excluded.folder, name = excluded.name, fee_rows = excluded.fee_rows,
    usd_rate = excluded.usd_rate, active = excluded.active, sections = coalesce(v_sections, hub_library_templates.sections), updated_by = auth.uid(), updated_at = now();
  return v_key;
end $$;

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
  -- AB Capital documents use the built-in design, so a work type has no file.
  if v_file is null and t.company <> 'AB Capital' then raise exception 'The template file does not belong to this template'; end if;
  if v_file is not null and not exists (select 1 from hub_library_template_files where id = v_file and template_key = t.template_key) then
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

create or replace function public.hub_library_letter_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; r hub_documents; v_parent uuid := nullif(p ->> 'parent_id', '')::uuid; v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb); v_fields jsonb := coalesce(p -> 'field_values', '{}'::jsonb); it jsonb; v_out jsonb := '[]'::jsonb;
  v_amt numeric; v_total numeric := 0; v_number text; v_work text := nullif(btrim(coalesce(p ->> 'work_type', '')), '');
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  perform business_setup_require('setup.quotes.manage');
  if nullif(btrim(coalesce(p ->> 'client_name', '')), '') is null or nullif(btrim(coalesce(p ->> 'contact_name', '')), '') is null
     or nullif(btrim(coalesce(p ->> 'contact_email', '')), '') is null or nullif(btrim(coalesce(p ->> 'contact_phone', '')), '') is null then
    raise exception 'Fill in the client details first';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then raise exception 'Add at least one fee row'; end if;
  if jsonb_typeof(v_fields) <> 'object' then raise exception 'Field values must be an object'; end if;
  for it in select * from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(it) <> 'object' or nullif(btrim(coalesce(it ->> 'description', '')), '') is null then raise exception 'Each fee row needs a label'; end if;
    v_amt := nullif(btrim(coalesce(it ->> 'amount', '')), '')::numeric;
    if v_amt is null or v_amt < 0 then raise exception 'Enter a fee of zero or more for %', it ->> 'description'; end if;
    v_total := v_total + v_amt;
    v_out := v_out || jsonb_build_array(it || jsonb_build_object('amount', v_amt));
  end loop;
  if v_work is not null and not exists (select 1 from hub_library_templates where template_key = v_work and company = 'AB Capital') then raise exception 'Unknown work type'; end if;
  if v_parent is not null then
    select * into q from hub_documents where id = v_parent and doc_type = 'quote' and department = 'Business Setup' for update;
    if q.id is null then raise exception 'The quote was not found'; end if;
    if q.status not in ('issued', 'accepted') then raise exception 'Quote % is % and cannot have a letter', q.document_number, q.status; end if;
    if q.case_id is not null then raise exception 'Quote % belongs to a Business Setup case. Make its letter from the case.', q.document_number; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    v_client := coalesce(q.client_id, v_client);
  end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  v_number := hub_next_number('Business Setup', 'letter');
  insert into hub_documents (parent_id, doc_type, department, document_number, document_serial, client_id, client_name, contact_name, contact_email, contact_phone, client_address,
                             license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, library_template, field_values)
  values (v_parent, 'letter', 'Business Setup', v_number, hub_serial_of('Business Setup', 'letter', v_number), v_client, btrim(p ->> 'client_name'),
          btrim(p ->> 'contact_name'), btrim(p ->> 'contact_email'), btrim(p ->> 'contact_phone'), nullif(btrim(coalesce(p ->> 'client_address', '')), ''),
          nullif(btrim(coalesce(p ->> 'license_number', '')), ''), nullif(btrim(coalesce(p ->> 'vat_trn', '')), ''),
          array(select l ->> 'description' from jsonb_array_elements(v_out) l), v_out, 'none', 0, 0, v_total, coalesce(v_work, 'AB Capital/Engagement Letter'), v_fields)
  returning * into r;
  return r;
end $$;
