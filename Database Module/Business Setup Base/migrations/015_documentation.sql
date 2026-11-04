-- =====================================================================
-- Business Setup Base - suggested fee amounts and per-item VAT   015
-- =====================================================================
-- Fee items may have no amount, carry a VAT rate (5 or 0), and three company items are added. Business Setup quotes
-- sum VAT line by line, from the fee item's rate read on the server. Other departments calculate exactly as before.
-- Run after 014. Re-runnable. Undo with rollback/013_019_rollback.sql.
-- hub_document_create is redefined from 014: run this file again whenever 004, 013 or 014 is re-run.
-- =====================================================================

-- ── Fee items ────────────────────────────────────────────────────────
-- default_amount may be empty (the >= 0 check stays; a null passes it). vat_rate is 5 or 0.
alter table public.business_setup_fee_items alter column default_amount drop not null;
alter table public.business_setup_fee_items add column if not exists vat_rate numeric(5,2) not null default 5 check (vat_rate in (0, 5));

-- Company services have no stored price. Re-runnable: an existing row keeps what was edited.
insert into public.business_setup_fee_items (grp, name, default_amount, sort_order) values
  ('Company', 'Company registration', null, 101),
  ('Company', 'Company renewal', null, 102),
  ('Company', 'Visa', null, 103)
on conflict (grp, name) do nothing;

-- Add or edit a fee item (p.id edits; otherwise group + name is the key). An empty default_amount means no stored amount.
create or replace function public.business_setup_fee_item_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_amount numeric; v_rate numeric;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
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
        sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::int, sort_order) else sort_order end
      where id = v_id;
    if not found then raise exception 'Fee item not found'; end if;
  else
    insert into business_setup_fee_items (grp, name, default_amount, vat_rate, service_item_id, active, sort_order)
    values (btrim(p ->> 'grp'), btrim(p ->> 'name'), v_amount, coalesce(v_rate, 5), nullif(p ->> 'service_item_id', '')::uuid,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::int, 0))
    on conflict (grp, name) do update set default_amount = case when p ? 'default_amount' then excluded.default_amount else business_setup_fee_items.default_amount end,
        vat_rate = case when p ? 'vat_rate' then excluded.vat_rate else business_setup_fee_items.vat_rate end,
        service_item_id = coalesce(excluded.service_item_id, business_setup_fee_items.service_item_id),
        active = excluded.active, sort_order = excluded.sort_order
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_fee_items', v_id::text, 'fee_item_save', null, jsonb_build_object('grp', p ->> 'grp', 'name', p ->> 'name'));
  return v_id;
end $$;
revoke all on function public.business_setup_fee_item_save(jsonb) from public, anon;
grant execute on function public.business_setup_fee_item_save(jsonb) to authenticated;

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
  v_bs_quote boolean := false; v_bs_letter boolean := false; v_lines jsonb := '[]'::jsonb; v_lr numeric; v_fid text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- An engagement letter exists only as the next step of a generated quote, and takes everything from it.
  if v_type = 'letter' then
    select * into q from hub_documents where id = (p ->> 'parent_id')::uuid and doc_type = 'quote' for update;
    if q.id is null then raise exception 'Generate the quote first: an engagement letter comes from a quote'; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    if q.department = 'Business Setup' and q.status <> 'accepted' then raise exception 'Mark the quote as accepted first'; end if;
    p := jsonb_build_object('doc_type', 'letter', 'parent_id', q.id, 'department', q.department, 'client_name', q.client_name, 'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'client_address', q.client_address, 'license_number', q.license_number, 'vat_trn', q.vat_trn, 'services', to_jsonb(q.services), 'lines', q.lines, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate);
    v_mode := q.vat_mode; v_rate := q.vat_rate; v_client := q.client_id; v_revises := null; v_case := q.case_id;
    v_bs_letter := q.department = 'Business Setup';
  end if;
  v_bs_quote := v_type = 'quote' and p ->> 'department' = 'Business Setup';
  -- Business Setup documents reach a client's login, so issuing one needs the department's right. A letter takes its department from its quote above.
  if p ->> 'department' = 'Business Setup' then perform business_setup_require('setup.quotes.manage'); end if;
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
  end if;
  return r;
end $$;
