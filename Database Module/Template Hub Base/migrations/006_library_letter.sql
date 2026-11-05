-- =====================================================================
-- Template Hub Base - AB Capital engagement letters made from Company Templates    006
-- =====================================================================
-- A letter made directly from a client, or from a quote that need not be accepted. Business Setup's own flow is unchanged:
-- hub_document_create still needs an accepted quote. A quote in a case cannot be used, because the case tracks its documents.
-- Run after 005. Re-runnable. Undo with rollback/006_rollback.sql.
-- =====================================================================
create or replace function public.hub_library_letter_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; r hub_documents; v_parent uuid := nullif(p ->> 'parent_id', '')::uuid; v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
  v_lines jsonb := coalesce(p -> 'lines', '[]'::jsonb); v_fields jsonb := coalesce(p -> 'field_values', '{}'::jsonb); it jsonb; v_out jsonb := '[]'::jsonb;
  v_amt numeric; v_total numeric := 0; v_number text;
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
          array(select l ->> 'description' from jsonb_array_elements(v_out) l), v_out, 'none', 0, 0, v_total, 'AB Capital/Engagement Letter', v_fields)
  returning * into r;
  return r;
end $$;
revoke all on function public.hub_library_letter_create(jsonb) from public, anon;
grant execute on function public.hub_library_letter_create(jsonb) to authenticated;
