-- =====================================================================
-- Banking Base - workflow functions                                003
-- =====================================================================
-- Every state change with a business rule goes through a function here. Tables holding workflow
-- state (quotations, payments, checklists, letters, applications) are read-only to the API.
-- Idempotent: safe to re-run.
-- =====================================================================

create or replace function public.banking_require(p_permission text) returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not banking_can(p_permission) then
    raise exception 'You do not have the "%" permission for Business Banking', p_permission using errcode = '42501';
  end if;
end $$;

create or replace function public.banking_setting(p_key text) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select value from banking_settings where key = p_key
$$;

-- Stage changes and bank selection only through functions, even for users allowed to edit the row.
create or replace function public.banking_guard_case() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if (new.current_stage is distinct from old.current_stage or new.outcome is distinct from old.outcome)
     and current_setting('banking.internal', true) is distinct from '1' then
    raise exception 'Use the stage tracker to change a case stage';
  end if;
  return new;
end $$;
drop trigger if exists banking_cases_guard on public.banking_cases;
create trigger banking_cases_guard before update on public.banking_cases for each row execute function public.banking_guard_case();

create or replace function public.banking_guard_reco() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if new.is_selected is distinct from coalesce(old.is_selected, false) and current_setting('banking.internal', true) is distinct from '1' then
    raise exception 'Use Select Bank to choose the bank';
  end if;
  return new;
end $$;
drop trigger if exists banking_reco_guard on public.banking_bank_recommendations;
create trigger banking_reco_guard before insert or update on public.banking_bank_recommendations for each row execute function public.banking_guard_reco();

-- ── Access ───────────────────────────────────────────────────────────
create or replace function public.banking_my_access() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'role', coalesce((select role from banking_user_roles where user_id = auth.uid()), case when (select role from profiles where id = auth.uid()) = 'admin' then 'ADMIN' end),
    'permissions', coalesce((select jsonb_agg(distinct p.permission) from banking_role_permissions p where banking_can(p.permission)), '[]'::jsonb))
$$;

-- ── Clients and conversion ───────────────────────────────────────────
create or replace function public.banking_find_clients(p_name text, p_license text default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(c) order by c.display_name), '[]'::jsonb)
  from (select id, display_name, license_number, client_master_id, link_status,
               (select count(*) from banking_cases x where x.client_id = bc.id) as cases
          from banking_clients bc
         where banking_can('app.access')
           and (name_key = banking_name_key(p_name)
             or (nullif(trim(p_license), '') is not null and license_number = trim(p_license))
             or (length(banking_name_key(p_name)) >= 4 and name_key like banking_name_key(p_name) || '%'))
         limit 20) c
$$;

create or replace function public.banking_get_or_create_client(p_name text, p_license text, p_master text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_key text := banking_name_key(p_name);
begin
  if v_key is null then raise exception 'A client or company name is required'; end if;
  select id into v_id from banking_clients where client_master_id = nullif(p_master, '') limit 1;
  if v_id is null and nullif(trim(p_license), '') is not null then
    select id into v_id from banking_clients where license_number = trim(p_license) limit 1;
  end if;
  if v_id is null then select id into v_id from banking_clients where name_key = v_key order by created_at limit 1; end if;
  if v_id is null then
    insert into banking_clients (display_name, license_number, client_master_id, link_status)
    values (trim(p_name), nullif(trim(p_license), ''), nullif(p_master, ''), case when nullif(p_master, '') is null then 'Pending Client Master' else 'Linked' end)
    returning id into v_id;
  elsif nullif(p_master, '') is not null then
    update banking_clients set client_master_id = p_master, link_status = 'Linked' where id = v_id and client_master_id is null;
  end if;
  return v_id;
end $$;
revoke all on function public.banking_get_or_create_client(text, text, text) from public, anon, authenticated;

create or replace function public.banking_link_client_master(p_client uuid, p_master text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('cases.manage');
  if p_master !~ '^CL[0-9]{6}$' then raise exception 'Client Master ID must look like CL000001'; end if;
  update banking_clients set client_master_id = p_master, link_status = 'Linked' where id = p_client;
end $$;

create or replace function public.banking_new_case(p_client uuid, p_lead uuid default null, p_title text default null, p_kind text default 'Business', p_assigned uuid default null, p_stage int default 1)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid;
begin
  perform banking_require('cases.manage');
  insert into banking_cases (client_id, lead_id, title, account_kind, assigned_to, current_stage)
  values (p_client, p_lead, p_title, coalesce(p_kind, 'Business'), coalesce(p_assigned, auth.uid()), p_stage) returning id into v_case;
  insert into banking_case_stage_history (case_id, to_stage, responsible, remarks) values (v_case, p_stage, coalesce(p_assigned, auth.uid()), 'Case opened');
  insert into banking_kyc_profiles (client_id, legal_name)
  select p_client, display_name from banking_clients where id = p_client on conflict (client_id) do nothing;
  return v_case;
end $$;

-- One client can have many cases: an existing client is reused, never duplicated.
create or replace function public.banking_convert_lead(p_lead uuid, p_client uuid default null, p_master text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_leads; v_client uuid; v_case uuid; v_existing boolean;
begin
  perform banking_require('leads.manage');
  perform banking_require('cases.manage');
  select * into l from banking_leads where id = p_lead for update;
  if l.id is null then raise exception 'Lead not found'; end if;
  if l.status = 'Converted' then raise exception 'Lead % is already converted', l.lead_ref; end if;
  v_existing := p_client is not null or exists (select 1 from banking_clients where name_key = banking_name_key(l.company_name) or (nullif(l.license_number, '') is not null and license_number = l.license_number));
  v_client := coalesce(p_client, banking_get_or_create_client(l.company_name, l.license_number, p_master));
  v_case := banking_new_case(v_client, l.id, null, 'Business', l.assigned_to, 4);
  update banking_leads set status = 'Converted', converted_at = now(), client_id = v_client where id = p_lead;
  if l.contact_person is not null then
    insert into banking_case_parties (case_id, full_name, mobile, email) values (v_case, l.contact_person, coalesce(l.mobile, l.whatsapp), l.email);
  end if;
  update banking_kyc_profiles set business_activity = coalesce(business_activity, l.business_activity),
         license_number = coalesce(license_number, l.license_number), issuing_authority = coalesce(issuing_authority, l.license_authority),
         legal_structure = coalesce(legal_structure, l.company_type)
   where client_id = v_client;
  if l.nationality is not null and not exists (select 1 from banking_kyc_shareholders s join banking_kyc_profiles k on k.id = s.kyc_profile_id where k.client_id = v_client) and l.contact_person is not null then
    insert into banking_kyc_shareholders (kyc_profile_id, full_name, nationality, mobile, email)
    select id, l.contact_person, l.nationality, l.mobile, l.email from banking_kyc_profiles where client_id = v_client;
  end if;
  return jsonb_build_object('case_id', v_case, 'client_id', v_client, 'existing_client', v_existing);
end $$;

-- ── KYC completeness ─────────────────────────────────────────────────
create or replace function public.banking_kyc_percent() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare
  j jsonb := to_jsonb(new);
  f text[] := array['legal_name','license_number','license_expiry_date','issuing_authority','legal_structure','business_activity','registered_address','office_address','company_email','company_phone','nature_of_business','source_of_funds','expected_monthly_turnover','countries_of_transactions','reason_for_account','business_description'];
  k text; n int := 0;
begin
  foreach k in array f loop
    if nullif(j ->> k, '') is not null then n := n + 1; end if;
  end loop;
  new.completion_percent := round(100.0 * n / array_length(f, 1));
  return new;
end $$;
drop trigger if exists banking_kyc_percent on public.banking_kyc_profiles;
create trigger banking_kyc_percent before insert or update on public.banking_kyc_profiles for each row execute function public.banking_kyc_percent();

-- ── Checklist engine ─────────────────────────────────────────────────
-- true = applies, false = does not, null = not known yet (listed as "To Confirm").
create or replace function public.banking_condition_applies(k public.banking_kyc_profiles, p_key text) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select case p_key
    when 'free_zone' then k.is_free_zone
    when 'existing_company' then k.is_existing_company
    when 'imports_exports' then k.imports_exports
    when 'goaml_required' then k.goaml_required
    when 'vat_registered' then coalesce(k.vat_registered, case when nullif(k.vat_trn, '') is not null then true end)
    when 'corporate_shareholder' then coalesce(k.has_corporate_shareholder,
       case when exists (select 1 from banking_kyc_shareholders s where s.kyc_profile_id = k.id and s.shareholder_type = 'Corporate' and s.deleted_at is null) then true end)
    when 'corporate_shareholder_ubo_resident' then case when k.has_corporate_shareholder is false then false else
       case when exists (select 1 from banking_kyc_shareholders s where s.kyc_profile_id = k.id and s.is_ubo and upper(s.country_of_residence) in ('UAE','UNITED ARAB EMIRATES') and s.deleted_at is null) then true end end
    when 'employed' then k.is_employed
    when 'self_employed' then k.is_self_employed
    else null end
$$;

create or replace function public.banking_generate_checklist(p_case uuid, p_reco uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c banking_cases; r banking_bank_recommendations; k banking_kyc_profiles; t banking_checklist_templates;
  src uuid; it record; sh record; v_state boolean; v_doc banking_documents; n int := 0; v_label text;
begin
  select * into c from banking_cases where id = p_case;
  select * into r from banking_bank_recommendations where id = p_reco;
  select * into k from banking_kyc_profiles where client_id = c.client_id;
  update banking_case_checklists set is_current = false where case_id = p_case and is_current;

  if c.account_kind = 'Personal' then
    select * into t from banking_checklist_templates where template_code = 'NON_RESIDENT_PERSONAL' and is_active order by version desc limit 1;
  elsif k.is_freelance_or_trader_no_office and exists (select 1 from banking_checklist_templates where template_code = 'ADIB_NO_OFFICE' and bank_id = r.bank_id) then
    select * into t from banking_checklist_templates where template_code = 'ADIB_NO_OFFICE' and is_active order by version desc limit 1;
  else
    select * into t from banking_checklist_templates
     where bank_id = r.bank_id and is_active and account_kind = 'Business' and template_code <> 'ADIB_NO_OFFICE'
       and (scheme_id is null or scheme_id = r.scheme_id)
     order by scheme_id nulls last, version desc limit 1;
  end if;
  if t.id is null then
    select * into t from banking_checklist_templates where template_code = 'STANDARD' and is_active order by version desc limit 1;
  end if;
  if t.id is null then raise exception 'No active document checklist is configured for this bank'; end if;
  src := t.id;
  if t.uses_standard then
    select id into src from banking_checklist_templates where template_code = 'STANDARD' and is_active order by version desc limit 1;
  end if;

  for it in
    select i.*, d.doc_name, d.has_expiry from banking_checklist_items i join banking_document_types d on d.id = i.document_type_id
     where i.template_id = src and i.is_active order by i.sort_order
  loop
    v_state := true;
    if it.condition_key is not null then
      v_state := banking_condition_applies(k, it.condition_key);
      if v_state is false then continue; end if;
    end if;
    for sh in
      select s.id, s.full_name from banking_kyc_shareholders s
       where it.per_shareholder and s.kyc_profile_id = k.id and s.deleted_at is null
      union all
      select null, null where not it.per_shareholder
         or not exists (select 1 from banking_kyc_shareholders s where s.kyc_profile_id = k.id and s.deleted_at is null)
    loop
      v_label := coalesce(it.requirement_label, it.doc_name) ||
        case when sh.full_name is not null then ' – ' || sh.full_name when it.per_shareholder then ' – all partners' else '' end;
      -- KYC reuse: link the newest matching file, but it must be verified again for this bank.
      select d.* into v_doc from banking_documents d
       where d.client_id = c.client_id and d.document_type_id = it.document_type_id and d.deleted_at is null
         and d.current_version > 0 and (sh.id is null or d.shareholder_id = sh.id)
         and (d.expiry_date is null or d.expiry_date >= current_date)
       order by d.updated_at desc limit 1;
      insert into banking_case_checklists (case_id, recommendation_id, bank_id, template_id, template_version, item_id, document_type_id, shareholder_id,
             requirement_label, is_mandatory, condition_key, condition_state, status, document_id, expiry_date, sort_order)
      values (p_case, p_reco, r.bank_id, t.id, t.version, it.id, it.document_type_id, sh.id, v_label, it.is_mandatory, it.condition_key,
             case when v_state is null then 'To Confirm' else 'Applies' end,
             case when v_doc.id is not null then 'Received' else 'Not Requested' end, v_doc.id, v_doc.expiry_date, it.sort_order);
      v_doc := null;
      n := n + 1;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.banking_generate_checklist(uuid, uuid) from public, anon, authenticated;

create or replace function public.banking_regenerate_checklist(p_case uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reco uuid;
begin
  perform banking_require('docs.manage');
  select id into v_reco from banking_bank_recommendations where case_id = p_case and is_selected;
  if v_reco is null then raise exception 'Select a bank first'; end if;
  return banking_generate_checklist(p_case, v_reco);
end $$;

-- A client may change bank before submission; earlier selections and checklists stay on record.
create or replace function public.banking_select_bank(p_case uuid, p_reco uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_old uuid; a banking_applications;
begin
  perform banking_require('cases.manage');
  if not exists (select 1 from banking_bank_recommendations where id = p_reco and case_id = p_case) then raise exception 'That option does not belong to this case'; end if;
  select * into a from banking_applications where case_id = p_case and is_active;
  if a.id is not null and a.status in ('Submitted to Bank','Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank','Approved','Account Opened') then
    raise exception 'Application % is already with the bank; close it before changing bank', a.application_ref;
  end if;
  select id into v_old from banking_bank_recommendations where case_id = p_case and is_selected;
  if v_old = p_reco then return 0; end if;
  if v_old is not null and nullif(trim(p_reason), '') is null then raise exception 'Give a reason for changing the selected bank'; end if;
  perform set_config('banking.internal', '1', true);
  update banking_bank_recommendations set is_selected = false, deselected_at = now(), deselect_reason = p_reason where id = v_old;
  update banking_bank_recommendations set is_selected = true, is_preferred = true, selected_at = now(), deselected_at = null, deselect_reason = null where id = p_reco;
  if a.id is not null then
    insert into banking_application_status_history (application_id, previous_status, new_status, remarks) values (a.id, a.status, 'Cancelled', 'Client changed bank: ' || coalesce(p_reason, ''));
    update banking_applications set status = 'Cancelled', is_active = false, status_date = now() where id = a.id;
  end if;
  perform set_config('banking.internal', '', true);
  return banking_generate_checklist(p_case, p_reco);
end $$;

create or replace function public.banking_document_add_version(p_checklist uuid, p_path text, p_file text, p_mime text, p_size bigint, p_sha text, p_expiry date default null, p_remarks text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_case_checklists; c banking_cases; v_doc uuid; v_ver int; k uuid;
begin
  perform banking_require('docs.manage');
  select * into l from banking_case_checklists where id = p_checklist for update;
  if l.id is null then raise exception 'Checklist line not found'; end if;
  select * into c from banking_cases where id = l.case_id;
  v_doc := l.document_id;
  if v_doc is null then
    insert into banking_documents (client_id, case_id, document_type_id, shareholder_id, title)
    values (c.client_id, c.id, l.document_type_id, l.shareholder_id, l.requirement_label) returning id into v_doc;
    select id into k from banking_kyc_profiles where client_id = c.client_id;
    if k is not null then insert into banking_kyc_documents (kyc_profile_id, document_id) values (k, v_doc) on conflict do nothing; end if;
  end if;
  update banking_documents set current_version = current_version + 1, expiry_date = coalesce(p_expiry, expiry_date) where id = v_doc returning current_version into v_ver;
  insert into banking_document_versions (document_id, version, storage_path, file_name, mime_type, size_bytes, sha256, expiry_date, remarks)
  values (v_doc, v_ver, p_path, p_file, p_mime, p_size, p_sha, p_expiry, p_remarks);
  -- An upload never verifies a document.
  update banking_case_checklists set document_id = v_doc, status = 'Received', expiry_date = coalesce(p_expiry, expiry_date),
         verified_by = null, verified_at = null, verified_version = null where id = p_checklist;
  return v_doc;
end $$;

create or replace function public.banking_checklist_set_status(p_checklist uuid, p_status text, p_remarks text default null, p_expiry date default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_case_checklists; v_info boolean; v_ver int;
begin
  perform banking_require('docs.manage');
  select * into l from banking_case_checklists where id = p_checklist for update;
  if l.id is null then raise exception 'Checklist line not found'; end if;
  select is_information into v_info from banking_document_types where id = l.document_type_id;
  select current_version into v_ver from banking_documents where id = l.document_id;
  if p_status = 'Verified' then
    perform banking_require('docs.verify');
    if coalesce(v_ver, 0) = 0 and not coalesce(v_info, false) then raise exception 'Upload the document before verifying it'; end if;
    if coalesce(v_info, false) and coalesce(v_ver, 0) = 0 and nullif(trim(p_remarks), '') is null then raise exception 'Record the information received in the remarks'; end if;
    if coalesce(p_expiry, l.expiry_date) < current_date then raise exception 'This document has expired (%)', coalesce(p_expiry, l.expiry_date); end if;
  end if;
  if p_status in ('Rejected','Resubmission Required','Not Applicable') and nullif(trim(p_remarks), '') is null then raise exception 'Remarks are required for status %', p_status; end if;
  update banking_case_checklists set status = p_status, review_remarks = coalesce(p_remarks, review_remarks),
         expiry_date = coalesce(p_expiry, expiry_date),
         verified_by = case when p_status = 'Verified' then auth.uid() end,
         verified_at = case when p_status = 'Verified' then now() end,
         verified_version = case when p_status = 'Verified' then v_ver end,
         condition_state = case when p_status = 'Not Applicable' then condition_state else 'Applies' end
   where id = p_checklist;
  if p_expiry is not null and l.document_id is not null then update banking_documents set expiry_date = p_expiry where id = l.document_id; end if;
end $$;

-- ── Finance ──────────────────────────────────────────────────────────
create or replace function public.banking_current_quote(p_case uuid) returns public.banking_quotations
language sql stable security definer set search_path = public, pg_temp as $$
  select q.* from banking_quotations q where q.case_id = p_case and q.status not in ('Superseded')
   order by (q.status = 'Accepted') desc, q.created_at desc limit 1
$$;

create or replace function public.banking_case_finance(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with q as (select * from banking_current_quote(p_case)), p as (
    select coalesce(sum(signed_amount), 0) received,
           coalesce(sum(abs(amount)) filter (where txn_type = 'Refund'), 0) refunds
      from banking_payments where case_id = p_case)
  select case when banking_can('payments.view') or banking_can('quotes.view') then jsonb_build_object(
    'total', coalesce((select total_amount from q where id is not null), 0),
    'bank_fees', coalesce((select bank_fee_total from q where id is not null), 0),
    'service_fees', coalesce((select service_fee_total from q where id is not null), 0),
    'supplementary', coalesce((select supplementary_total from q where id is not null), 0),
    'discount', coalesce((select discount_total from q where id is not null), 0),
    'vat', coalesce((select vat_amount from q where id is not null), 0),
    'quote_status', (select status from q where id is not null),
    'received', p.received, 'refunds', p.refunds,
    'outstanding', coalesce((select total_amount from q where id is not null), 0) - p.received,
    'paid_percent', case when coalesce((select total_amount from q where id is not null), 0) > 0
        then round(100 * p.received / (select total_amount from q where id is not null)) else 0 end) end
  from p
$$;

-- ── Quotations ───────────────────────────────────────────────────────
-- Bank fee and supplementary lines keep their own totals. VAT applies only to AB Capital's charges;
-- a bank fee is a pass-through. A line paid directly to the bank is a memo outside the total.
create or replace function public.banking_quote_recalc(p_quote uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q banking_quotations; v_bank numeric; v_direct numeric; v_svc numeric; v_supp numeric; v_disc numeric; v_net numeric; v_vat numeric := 0; v_total numeric;
begin
  select * into q from banking_quotations where id = p_quote;
  select coalesce(sum(amount) filter (where item_type = 'Bank Fee' and collected_through_ab), 0),
         coalesce(sum(amount) filter (where item_type = 'Bank Fee' and not collected_through_ab), 0),
         coalesce(sum(amount) filter (where item_type = 'Service Fee'), 0),
         coalesce(sum(amount) filter (where item_type = 'Supplementary'), 0),
         coalesce(sum(amount) filter (where item_type = 'Discount'), 0)
    into v_bank, v_direct, v_svc, v_supp, v_disc from banking_quotation_items where quotation_id = p_quote;
  if v_disc > v_svc + v_supp then raise exception 'The discount cannot exceed AB Capital''s fees'; end if;
  v_net := v_svc + v_supp - v_disc;
  if q.vat_mode = 'exclusive' then v_vat := round(v_net * q.vat_rate / 100, 2); v_total := v_bank + v_net + v_vat;
  elsif q.vat_mode = 'inclusive' then v_vat := round(v_net * q.vat_rate / (100 + q.vat_rate), 2); v_total := v_bank + v_net;
  else v_total := v_bank + v_net; end if;
  update banking_quotations set bank_fee_total = v_bank + v_direct, direct_to_bank_total = v_direct, service_fee_total = v_svc,
         supplementary_total = v_supp, discount_total = v_disc, vat_amount = v_vat, total_amount = v_total where id = p_quote;
end $$;
revoke all on function public.banking_quote_recalc(uuid) from public, anon, authenticated;

-- Latest pricing row in force for this bank and scheme.
create or replace function public.banking_price_for(p_bank uuid, p_scheme uuid) returns public.banking_pricing
language sql stable security definer set search_path = public, pg_temp as $$
  select * from banking_pricing where bank_id = p_bank and (scheme_id = p_scheme or scheme_id is null)
     and effective_date <= current_date and (expiry_date is null or expiry_date >= current_date)
   order by scheme_id nulls last, effective_date desc, created_at desc limit 1
$$;

create or replace function public.banking_quote_create(p_case uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r banking_bank_recommendations; pr banking_pricing; v_q uuid; v_vat jsonb := banking_setting('vat'); v_fee numeric; b text; s text;
begin
  perform banking_require('quotes.manage');
  select * into r from banking_bank_recommendations where case_id = p_case and is_selected;
  if r.id is null then raise exception 'Select a bank before preparing a quotation'; end if;
  if exists (select 1 from banking_quotations where case_id = p_case and status in ('Draft','Approval Required','Issued','Sent','Accepted')) then
    raise exception 'This case already has a live quotation. Revise it instead.';
  end if;
  pr := banking_price_for(r.bank_id, r.scheme_id);
  v_fee := coalesce(pr.service_fee, (banking_setting('default_service_fee'))::text::numeric, 0);
  select bank_name into b from banking_partners where id = r.bank_id;
  select scheme_name into s from banking_schemes where id = r.scheme_id;
  insert into banking_quotations (case_id, recommendation_id, bank_id, scheme_id, prepared_by, valid_until, vat_mode, vat_rate, initial_deposit_memo, minimum_balance_memo)
  values (p_case, r.id, r.bank_id, r.scheme_id, auth.uid(), current_date + coalesce((banking_setting('quotation_validity_days'))::text::int, 15),
          coalesce(v_vat ->> 'mode', 'inclusive'), coalesce((v_vat ->> 'rate')::numeric, 5), pr.initial_deposit, pr.minimum_balance)
  returning id into v_q;
  if coalesce(pr.account_opening_fee, 0) + coalesce(pr.other_bank_charges, 0) > 0 then
    insert into banking_quotation_items (quotation_id, item_type, description, unit_amount, payable_to, collected_through_ab, sort_order)
    values (v_q, 'Bank Fee', 'Bank account opening fee – ' || b, coalesce(pr.account_opening_fee, 0) + coalesce(pr.other_bank_charges, 0), 'Bank', coalesce(pr.bank_fee_collected_by_ab, true), 10);
  end if;
  insert into banking_quotation_items (quotation_id, item_type, description, unit_amount, default_amount, sort_order)
  values (v_q, 'Service Fee', 'Bank account opening service – ' || b || coalesce(' (' || s || ')', ''), v_fee, v_fee, 20);
  perform banking_quote_recalc(v_q);
  return v_q;
end $$;

-- Replaces all lines of a draft. A fee below default or a large discount waits for approval.
create or replace function public.banking_quote_save(p_quote uuid, p_fields jsonb, p_items jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q banking_quotations; it jsonb; n int := 0; v_limit numeric; v_svc numeric; v_def numeric; v_disc numeric; v_reason text; v_home numeric;
begin
  perform banking_require('quotes.manage');
  select * into q from banking_quotations where id = p_quote for update;
  if q.status not in ('Draft','Approval Required') then raise exception 'Only a draft can be edited. Revise the quotation instead.'; end if;
  update banking_quotations set
    valid_until = coalesce((p_fields ->> 'valid_until')::date, valid_until),
    quotation_date = coalesce((p_fields ->> 'quotation_date')::date, quotation_date),
    payment_terms = coalesce(p_fields ->> 'payment_terms', payment_terms),
    remarks = coalesce(p_fields ->> 'remarks', remarks),
    vat_mode = coalesce(p_fields ->> 'vat_mode', vat_mode),
    vat_rate = coalesce((p_fields ->> 'vat_rate')::numeric, vat_rate),
    initial_deposit_memo = case when p_fields ? 'initial_deposit_memo' then (p_fields ->> 'initial_deposit_memo')::numeric else initial_deposit_memo end,
    minimum_balance_memo = case when p_fields ? 'minimum_balance_memo' then (p_fields ->> 'minimum_balance_memo')::numeric else minimum_balance_memo end
  where id = p_quote;
  delete from banking_quotation_items where quotation_id = p_quote;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    n := n + 1;
    v_def := (it ->> 'default_amount')::numeric;
    if it ->> 'service_id' is not null and v_def is null then
      select default_fee into v_def from banking_supplementary_services where id = (it ->> 'service_id')::uuid;
    end if;
    if v_def is not null and (it ->> 'unit_amount')::numeric <> v_def and nullif(trim(it ->> 'override_reason'), '') is null then
      raise exception 'Give a reason for changing "%" from its default of AED %', it ->> 'description', v_def;
    end if;
    insert into banking_quotation_items (quotation_id, item_type, description, quantity, unit_amount, payable_to, collected_through_ab, service_id, default_amount, override_reason, sort_order)
    values (p_quote, it ->> 'item_type', it ->> 'description', coalesce((it ->> 'quantity')::numeric, 1), (it ->> 'unit_amount')::numeric,
            coalesce(it ->> 'payable_to', case when it ->> 'item_type' = 'Bank Fee' then 'Bank' else 'AB Capital' end),
            coalesce((it ->> 'collected_through_ab')::boolean, true), (it ->> 'service_id')::uuid, v_def, it ->> 'override_reason', n * 10);
  end loop;
  perform banking_quote_recalc(p_quote);
  v_limit := coalesce((banking_setting('discount_approval_percent'))::text::numeric, 10);
  select coalesce(sum(amount) filter (where item_type = 'Service Fee'), 0), coalesce(sum(default_amount) filter (where item_type = 'Service Fee'), 0), coalesce(sum(amount) filter (where item_type = 'Discount'), 0)
    into v_svc, v_def, v_disc from banking_quotation_items where quotation_id = p_quote;
  if v_def > 0 and v_svc < v_def * (1 - v_limit / 100) then v_reason := 'Service fee below default by more than ' || v_limit || '%'; end if;
  if v_svc > 0 and v_disc > v_svc * v_limit / 100 then v_reason := coalesce(v_reason || '; ', '') || 'Discount above ' || v_limit || '% of the service fee'; end if;
  update banking_quotations set needs_approval = v_reason is not null, approval_reason = v_reason, approved_by = null, approved_at = null,
         status = case when v_reason is not null then 'Approval Required' else 'Draft' end where id = p_quote;
end $$;

create or replace function public.banking_quote_action(p_quote uuid, p_action text, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q banking_quotations; v_items int; it record; v_task uuid; v_case banking_cases; v_type text;
begin
  select * into q from banking_quotations where id = p_quote for update;
  if q.id is null then raise exception 'Quotation not found'; end if;
  if p_action = 'approve' then
    perform banking_require('pricing.approve');
    if q.status <> 'Approval Required' then raise exception 'This quotation is not waiting for approval'; end if;
    update banking_quotations set status = 'Draft', needs_approval = false, approved_by = auth.uid(), approved_at = now(), decision_remarks = p_remarks where id = p_quote;
    return;
  end if;
  perform banking_require('quotes.manage');
  case p_action
  when 'issue' then
    if q.status = 'Approval Required' then raise exception 'A manager must approve this pricing first: %', q.approval_reason; end if;
    if q.status <> 'Draft' then raise exception 'Only a draft can be issued'; end if;
    select count(*) into v_items from banking_quotation_items where quotation_id = p_quote;
    if v_items = 0 then raise exception 'Add at least one line'; end if;
    update banking_quotations set status = 'Issued' where id = p_quote;
  when 'send' then
    if q.status not in ('Issued','Sent') then raise exception 'Issue the quotation before sending it'; end if;
    update banking_quotations set status = 'Sent', sent_at = now() where id = p_quote;
    update banking_leads set status = 'Quotation Sent' where id = (select lead_id from banking_cases where id = q.case_id) and status <> 'Converted';
  when 'accept' then
    if q.status not in ('Issued','Sent') then raise exception 'Only an issued quotation can be accepted'; end if;
    if q.valid_until < current_date then raise exception 'This quotation expired on %. Revise it.', q.valid_until; end if;
    update banking_quotations set status = 'Accepted', accepted_at = now(), decision_remarks = p_remarks where id = p_quote;
    select * into v_case from banking_cases where id = q.case_id;
    -- A selected service gets its own task and tracking record.
    for it in select i.id, i.service_id, s.creates_task_type, s.service_name from banking_quotation_items i join banking_supplementary_services s on s.id = i.service_id where i.quotation_id = p_quote loop
      if not exists (select 1 from banking_service_deliverables where case_id = q.case_id and service_id = it.service_id and status <> 'Cancelled') then
        insert into banking_tasks (case_id, task_type, title, assigned_to, priority)
        values (q.case_id, coalesce(it.creates_task_type, it.service_name), it.service_name || ' – ' || v_case.case_ref, v_case.assigned_to, 'Medium') returning id into v_task;
        insert into banking_service_deliverables (case_id, service_id, quotation_item_id, task_id) values (q.case_id, it.service_id, it.id, v_task);
      end if;
    end loop;
  when 'reject' then
    if q.status not in ('Issued','Sent') then raise exception 'Only an issued quotation can be rejected'; end if;
    update banking_quotations set status = 'Rejected', rejected_at = now(), decision_remarks = p_remarks where id = p_quote;
  when 'expire' then
    if q.status not in ('Draft','Approval Required','Issued','Sent') then raise exception 'This quotation cannot be expired'; end if;
    update banking_quotations set status = 'Expired', decision_remarks = p_remarks where id = p_quote;
  else raise exception 'Unknown quotation action %', p_action;
  end case;
end $$;

create or replace function public.banking_quote_revise(p_quote uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q banking_quotations; v_new uuid;
begin
  perform banking_require('quotes.manage');
  select * into q from banking_quotations where id = p_quote for update;
  if q.status = 'Superseded' then raise exception 'A newer version of this quotation exists'; end if;
  if nullif(trim(p_reason), '') is null then raise exception 'Give a reason for the revision'; end if;
  if exists (select 1 from banking_engagement_letters where quotation_id = p_quote and status = 'Signed') then
    raise exception 'A signed engagement letter rests on this quotation; it cannot be revised';
  end if;
  update banking_quotations set status = 'Superseded', decision_remarks = p_reason where id = p_quote;
  update banking_engagement_letters set status = 'Cancelled', remarks = 'Quotation revised' where quotation_id = p_quote and status <> 'Cancelled';
  insert into banking_quotations (quotation_number, version, supersedes_id, case_id, recommendation_id, bank_id, scheme_id, payment_terms, remarks, vat_mode, vat_rate, valid_until, initial_deposit_memo, minimum_balance_memo, prepared_by)
  select quotation_number, version + 1, id, case_id,
         coalesce((select id from banking_bank_recommendations r where r.case_id = q.case_id and r.is_selected), recommendation_id),
         coalesce((select bank_id from banking_bank_recommendations r where r.case_id = q.case_id and r.is_selected), bank_id),
         coalesce((select scheme_id from banking_bank_recommendations r where r.case_id = q.case_id and r.is_selected), scheme_id),
         payment_terms, remarks, vat_mode, vat_rate,
         current_date + coalesce((banking_setting('quotation_validity_days'))::text::int, 15), initial_deposit_memo, minimum_balance_memo, auth.uid()
    from banking_quotations where id = p_quote returning id into v_new;
  insert into banking_quotation_items (quotation_id, item_type, description, quantity, unit_amount, payable_to, collected_through_ab, service_id, default_amount, override_reason, sort_order)
  select v_new, item_type, description, quantity, unit_amount, payable_to, collected_through_ab, service_id, default_amount, override_reason, sort_order
    from banking_quotation_items where quotation_id = p_quote;
  perform banking_quote_recalc(v_new);
  return v_new;
end $$;

-- ── Payments: a ledger. Mistakes are reversed, never edited. ─────────
create or replace function public.banking_payment_add(p_case uuid, p_date date, p_amount numeric, p_method text, p_reference text default null, p_note text default null, p_description text default null, p_remarks text default null, p_path text default null, p_received_by uuid default null, p_import_row uuid default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_ref text; v_rc text; q banking_quotations;
begin
  perform banking_require('payments.manage');
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero'; end if;
  if p_date is null then raise exception 'Enter the payment date'; end if;
  if p_date > current_date then raise exception 'A payment date cannot be in the future'; end if;
  q := banking_current_quote(p_case);
  insert into banking_payments (case_id, quotation_id, payment_date, amount, payment_method, transaction_reference, reference_note, description, remarks, document_path, received_by, import_row_id)
  values (p_case, q.id, p_date, p_amount, p_method, p_reference, p_note, p_description, p_remarks, p_path, coalesce(p_received_by, auth.uid()), p_import_row)
  returning id, payment_ref into v_id, v_ref;
  insert into banking_receipts (payment_id) values (v_id) returning receipt_number into v_rc;
  return jsonb_build_object('payment_id', v_id, 'payment_ref', v_ref, 'receipt_number', v_rc);
end $$;

create or replace function public.banking_payment_counter(p_payment uuid, p_type text, p_date date, p_reason text, p_amount numeric default null, p_method text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare o banking_payments; v_id uuid; v_used numeric; v_amount numeric;
begin
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  select * into o from banking_payments where id = p_payment;
  if o.id is null or o.txn_type <> 'Payment' then raise exception 'Choose an original payment'; end if;
  select coalesce(sum(abs(amount)), 0) into v_used from banking_payments where reverses_payment_id = p_payment;
  if p_type = 'Reversal' then
    perform banking_require('payments.manage');
    if v_used > 0 then raise exception 'This payment already has a refund or reversal'; end if;
    v_amount := o.amount;
  elsif p_type = 'Refund' then
    perform banking_require('payments.refund');
    v_amount := coalesce(p_amount, o.amount - v_used);
    if v_amount <= 0 or v_amount > o.amount - v_used then raise exception 'Refund cannot exceed the unrefunded amount of AED %', o.amount - v_used; end if;
  else raise exception 'Unknown type %', p_type;
  end if;
  insert into banking_payments (case_id, quotation_id, txn_type, payment_date, amount, payment_method, description, remarks, received_by, reverses_payment_id)
  values (o.case_id, o.quotation_id, p_type, coalesce(p_date, current_date), v_amount, coalesce(p_method, o.payment_method), p_type || ' of ' || o.payment_ref, p_reason, auth.uid(), o.id)
  returning id into v_id;
  if p_type = 'Refund' then insert into banking_refunds (payment_id, original_payment_id, reason, approved_by) values (v_id, o.id, p_reason, auth.uid()); end if;
  return v_id;
end $$;

create or replace function public.banking_payment_adjust(p_case uuid, p_date date, p_amount numeric, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform banking_require('payments.refund');
  if nullif(trim(p_reason), '') is null then raise exception 'A reason is required'; end if;
  insert into banking_payments (case_id, quotation_id, txn_type, payment_date, amount, description, remarks, received_by)
  values (p_case, (banking_current_quote(p_case)).id, 'Adjustment', coalesce(p_date, current_date), p_amount, 'Adjustment', p_reason, auth.uid()) returning id into v_id;
  return v_id;
end $$;

-- ── Engagement letters ───────────────────────────────────────────────
create or replace function public.banking_letter_generate(p_case uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q banking_quotations; c banking_cases; v_id uuid; v_ver int; content jsonb;
begin
  perform banking_require('agreements.manage');
  select * into q from banking_quotations where case_id = p_case and status = 'Accepted';
  if q.id is null then raise exception 'The client must accept a quotation before an engagement letter is generated'; end if;
  if exists (select 1 from banking_engagement_letters where case_id = p_case and quotation_id = q.id and status = 'Signed') then raise exception 'A signed letter already exists for this quotation'; end if;
  select * into c from banking_cases where id = p_case;
  update banking_engagement_letters set status = 'Cancelled', remarks = 'Replaced by a new draft' where case_id = p_case and status in ('Draft','Sent to Client','Awaiting Signature');
  select coalesce(max(version), 0) + 1 into v_ver from banking_engagement_letters where case_id = p_case;
  select jsonb_build_object('case_ref', c.case_ref, 'client', cl.display_name, 'client_master_id', cl.client_master_id,
           'address', k.registered_address, 'bank', b.bank_name, 'scheme', s.scheme_name,
           'quotation_number', q.quotation_number, 'quotation_version', q.version, 'total', q.total_amount, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate,
           'payment_terms', q.payment_terms,
           'items', (select jsonb_agg(jsonb_build_object('type', i.item_type, 'description', i.description, 'amount', i.amount, 'payable_to', i.payable_to, 'collected', i.collected_through_ab) order by i.sort_order) from banking_quotation_items i where i.quotation_id = q.id),
           'terms', banking_setting('engagement_terms'), 'company', banking_setting('company'))
    into content
    from banking_clients cl left join banking_kyc_profiles k on k.client_id = cl.id
    left join banking_partners b on b.id = q.bank_id left join banking_schemes s on s.id = q.scheme_id
   where cl.id = c.client_id;
  insert into banking_engagement_letters (case_id, quotation_id, version, content) values (p_case, q.id, v_ver, content) returning id into v_id;
  return v_id;
end $$;

create or replace function public.banking_letter_action(p_letter uuid, p_action text, p_path text default null, p_signed_at date default null, p_signatory text default null, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare l banking_engagement_letters;
begin
  perform banking_require('agreements.manage');
  select * into l from banking_engagement_letters where id = p_letter for update;
  if l.id is null then raise exception 'Letter not found'; end if;
  if l.status in ('Signed','Cancelled') and p_action <> 'cancel' then raise exception 'This letter is %', l.status; end if;
  case p_action
  when 'send' then update banking_engagement_letters set status = 'Awaiting Signature', sent_at = now(), remarks = p_remarks where id = p_letter;
  when 'sign' then
    if nullif(p_path, '') is null then raise exception 'Upload the signed document first'; end if;
    if p_signed_at is null then raise exception 'Enter the signature date'; end if;
    update banking_engagement_letters set status = 'Signed', signed_document_path = p_path, signed_at = p_signed_at, signatory_name = p_signatory, remarks = p_remarks where id = p_letter;
  when 'reject' then update banking_engagement_letters set status = 'Rejected', remarks = p_remarks where id = p_letter;
  when 'cancel' then
    if l.status = 'Signed' and nullif(trim(p_remarks), '') is null then raise exception 'Give a reason for cancelling a signed letter'; end if;
    update banking_engagement_letters set status = 'Cancelled', remarks = p_remarks where id = p_letter;
  else raise exception 'Unknown letter action %', p_action;
  end case;
end $$;

-- ── Gates (the Processing Checklist) ─────────────────────────────────
create or replace function public.banking_gate_status(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c banking_cases; k banking_kyc_profiles; f jsonb; v_req int; v_rec int; v_ver int; a banking_applications; v_selected boolean; v_scheme boolean; v_quote boolean; v_signed boolean; v_pay boolean; v_pay_needed boolean;
begin
  select * into c from banking_cases where id = p_case;
  select * into k from banking_kyc_profiles where client_id = c.client_id;
  select * into a from banking_applications where case_id = p_case and is_active;
  select count(*) > 0, coalesce(bool_or(scheme_id is not null), false) into v_selected, v_scheme from banking_bank_recommendations where case_id = p_case and is_selected;
  select count(*), count(*) filter (where status in ('Received','Under Review','Verified')), count(*) filter (where status = 'Verified')
    into v_req, v_rec, v_ver from banking_case_checklists
   where case_id = p_case and is_current and is_mandatory and status <> 'Not Applicable';
  v_quote := exists (select 1 from banking_quotations where case_id = p_case and status = 'Accepted');
  v_signed := exists (select 1 from banking_engagement_letters where case_id = p_case and status = 'Signed');
  f := banking_case_finance_internal(p_case);
  v_pay_needed := coalesce((banking_setting('require_payment_before_submission'))::text::boolean, true);
  v_pay := not v_pay_needed or coalesce((f ->> 'received')::numeric, 0) > 0;
  return jsonb_build_object(
    'kyc_completed', coalesce(k.completion_percent, 0) >= 100,
    'bank_selected', v_selected,
    'scheme_selected', v_scheme,
    'documents_received', v_req > 0 and v_rec = v_req,
    'documents_verified', v_req > 0 and v_ver = v_req,
    'quotation_accepted', v_quote,
    'payment_received', v_pay,
    'letter_signed', v_signed,
    'form_prepared', coalesce(a.form_prepared, false),
    'submitted', a.status in ('Submitted to Bank','Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank','Approved','Account Opened'));
end $$;

create or replace function public.banking_case_finance_internal(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('received', coalesce(sum(signed_amount), 0)) from banking_payments where case_id = p_case
$$;
revoke all on function public.banking_case_finance_internal(uuid) from public, anon, authenticated;

-- Which gates must hold to enter a stage.
create or replace function public.banking_stage_gates(p_stage int) returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select case
    when p_stage in (5, 6) then array['kyc_completed']
    when p_stage between 7 and 11 then array['kyc_completed','bank_selected']
    when p_stage in (12, 13) then array['kyc_completed','bank_selected','quotation_accepted']
    when p_stage = 14 then array['kyc_completed','bank_selected','quotation_accepted','letter_signed']
    when p_stage = 15 then array['kyc_completed','bank_selected','quotation_accepted','letter_signed','documents_verified','payment_received','form_prepared']
    when p_stage >= 16 then array['kyc_completed','bank_selected','quotation_accepted','letter_signed','documents_verified','payment_received','form_prepared','submitted']
    else '{}'::text[] end
$$;

create or replace function public.banking_move_stage(p_case uuid, p_to int, p_remarks text default null, p_override text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c banking_cases; g jsonb; unmet text[]; v_is_override boolean := false;
begin
  perform banking_require('cases.manage');
  select * into c from banking_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if p_to not between 1 and 18 then raise exception 'Unknown stage'; end if;
  if p_to = c.current_stage then return; end if;
  if p_to < c.current_stage and nullif(trim(p_remarks), '') is null then raise exception 'Remarks are required to move a case backward'; end if;
  if p_to > c.current_stage then
    g := banking_gate_status(p_case);
    select array_agg(x) into unmet from unnest(banking_stage_gates(p_to)) x where not coalesce((g ->> x)::boolean, false);
    if unmet is not null then
      if nullif(trim(p_override), '') is null then
        raise exception 'Cannot move to stage %: not yet met: %', p_to, array_to_string(unmet, ', ') using hint = 'An authorised user can override with a justification';
      end if;
      perform banking_require('workflow.override');
      v_is_override := true;
    end if;
  end if;
  perform set_config('banking.internal', '1', true);
  update banking_cases set current_stage = p_to where id = p_case;
  perform set_config('banking.internal', '', true);
  insert into banking_case_stage_history (case_id, from_stage, to_stage, responsible, remarks, is_override, unmet_gates)
  values (p_case, c.current_stage, p_to, coalesce(c.assigned_to, auth.uid()), coalesce(p_override, p_remarks), v_is_override, to_jsonb(unmet));
end $$;

-- ── Applications ─────────────────────────────────────────────────────
create or replace function public.banking_application_open(p_case uuid, p_override text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare r banking_bank_recommendations; l banking_engagement_letters; v_id uuid; c banking_cases;
begin
  perform banking_require('apps.manage');
  select * into c from banking_cases where id = p_case;
  select * into r from banking_bank_recommendations where case_id = p_case and is_selected;
  if r.id is null then raise exception 'Select a bank first'; end if;
  if exists (select 1 from banking_applications where case_id = p_case and is_active) then raise exception 'This case already has an active application'; end if;
  select * into l from banking_engagement_letters where case_id = p_case and status = 'Signed' order by version desc limit 1;
  if l.id is null then
    if nullif(trim(p_override), '') is null then raise exception 'The engagement letter must be signed first. An authorised user can override with a justification.'; end if;
    perform banking_require('workflow.override');
  end if;
  insert into banking_applications (case_id, recommendation_id, bank_id, scheme_id, engagement_letter_id, override_justification, assigned_to, status)
  values (p_case, r.id, r.bank_id, r.scheme_id, l.id, p_override, c.assigned_to, 'Document Collection') returning id into v_id;
  insert into banking_application_status_history (application_id, previous_status, new_status, remarks, is_override)
  values (v_id, 'Not Started', 'Document Collection', coalesce(p_override, 'Application workspace opened'), p_override is not null);
  return v_id;
end $$;

create or replace function public.banking_application_update(p_app uuid, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('apps.manage');
  update banking_applications set
    assigned_to = case when p ? 'assigned_to' then (p ->> 'assigned_to')::uuid else assigned_to end,
    relationship_manager_id = case when p ? 'relationship_manager_id' then (p ->> 'relationship_manager_id')::uuid else relationship_manager_id end,
    relationship_manager_text = case when p ? 'relationship_manager_text' then p ->> 'relationship_manager_text' else relationship_manager_text end,
    submission_method = case when p ? 'submission_method' then nullif(p ->> 'submission_method', '') else submission_method end,
    bank_reference = case when p ? 'bank_reference' then p ->> 'bank_reference' else bank_reference end,
    application_date = case when p ? 'application_date' then (p ->> 'application_date')::date else application_date end,
    submission_date = case when p ? 'submission_date' then (p ->> 'submission_date')::date else submission_date end,
    appointment_location = case when p ? 'appointment_location' then p ->> 'appointment_location' else appointment_location end,
    bank_remarks = case when p ? 'bank_remarks' then p ->> 'bank_remarks' else bank_remarks end,
    internal_remarks = case when p ? 'internal_remarks' then p ->> 'internal_remarks' else internal_remarks end,
    form_prepared = case when p ? 'form_prepared' then (p ->> 'form_prepared')::boolean else form_prepared end,
    next_follow_up = case when p ? 'next_follow_up' then (p ->> 'next_follow_up')::date else next_follow_up end
  where id = p_app;
  if not found then raise exception 'Application not found'; end if;
end $$;

create or replace function public.banking_application_set_status(p_app uuid, p_status text, p_remarks text default null, p_next date default null, p_path text default null, p_override text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare a banking_applications; g jsonb; unmet text[]; v_is_override boolean := false; v_outcome text; v_stage int;
begin
  perform banking_require('apps.manage');
  select * into a from banking_applications where id = p_app for update;
  if a.id is null then raise exception 'Application not found'; end if;
  if a.status = p_status then raise exception 'The application is already %', p_status; end if;
  if p_status in ('Rejected','Returned','Cancelled','On Hold','Additional Documents Requested','Resubmission Required') and nullif(trim(p_remarks), '') is null then
    raise exception 'Remarks are required for status %', p_status;
  end if;
  -- Bank approval and account opening are separate events; opening is never inferred.
  if p_status = 'Account Opened' and a.status <> 'Approved' and nullif(trim(p_override), '') is null then
    raise exception 'An account can only be marked opened after the bank has approved it';
  end if;
  if p_status = 'Approved' and a.status not in ('Submitted to Bank','Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank') and nullif(trim(p_override), '') is null then
    raise exception 'Only an application with the bank can be approved';
  end if;
  if p_status in ('Ready for Submission','Submitted to Bank') then
    g := banking_gate_status(a.case_id);
    select array_agg(x) into unmet from unnest(banking_stage_gates(15)) x
     where not coalesce((g ->> x)::boolean, false) and not (x = 'letter_signed' and a.override_justification is not null);
    if unmet is not null and nullif(trim(p_override), '') is null then
      raise exception 'Cannot move to "%": not yet met: %', p_status, array_to_string(unmet, ', ');
    end if;
  end if;
  if nullif(trim(p_override), '') is not null then
    perform banking_require('workflow.override');
    v_is_override := true;
  end if;
  update banking_applications set status = p_status, status_date = now(), next_follow_up = coalesce(p_next, next_follow_up),
         submission_date = case when p_status = 'Submitted to Bank' then coalesce(submission_date, current_date) else submission_date end,
         is_active = p_status not in ('Rejected','Returned','Cancelled')
   where id = p_app;
  insert into banking_application_status_history (application_id, previous_status, new_status, remarks, supporting_document_path, next_follow_up, is_override)
  values (p_app, a.status, p_status, coalesce(p_override, p_remarks), p_path, p_next, v_is_override);
  v_outcome := case p_status when 'Approved' then 'Approved' when 'Account Opened' then 'Approved' when 'Rejected' then 'Rejected' when 'Returned' then 'Returned' when 'Cancelled' then 'Cancelled' end;
  v_stage := case when p_status = 'Account Opened' then 18
                  when p_status in ('Approved','Rejected','Returned') then 17
                  when p_status in ('Bank Review','Additional Documents Requested','Resubmission Required','Client Visited Bank') then 16
                  when p_status in ('Submitted to Bank','Appointment Scheduled') then 15 end;
  perform set_config('banking.internal', '1', true);
  update banking_cases set outcome = coalesce(v_outcome, case when outcome in ('Returned') then null else outcome end) where id = a.case_id;
  if v_stage is not null then
    insert into banking_case_stage_history (case_id, from_stage, to_stage, responsible, remarks, is_override)
    select id, current_stage, v_stage, assigned_to, 'Application status: ' || p_status, v_is_override from banking_cases where id = a.case_id and current_stage <> v_stage;
    update banking_cases set current_stage = v_stage where id = a.case_id;
  end if;
  perform set_config('banking.internal', '', true);
end $$;

-- ── Comparison and advisory flags ────────────────────────────────────
-- Considerations for staff to read. Nothing here approves or rejects anybody.
create or replace function public.banking_case_flags(p_case uuid, p_bank uuid default null) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select * from banking_cases where id = p_case),
  k as (select p.* from banking_kyc_profiles p join c on c.client_id = p.client_id),
  nat as (select distinct upper(trim(s.nationality)) n from banking_kyc_shareholders s join k on k.id = s.kyc_profile_id where s.deleted_at is null and s.nationality is not null
          union select upper(trim(l.nationality)) from banking_leads l join c on c.lead_id = l.id where l.nationality is not null)
  select case when banking_can('cases.view') then jsonb_build_object(
    'risk', coalesce((select jsonb_agg(jsonb_build_object('level', r.risk_level, 'requirement', r.requirement, 'match', n.n, 'source', r.source, 'verification', r.verification_status))
       from banking_risk_rules r join nat n on n.n = any(r.match_values) where r.is_active), '[]'::jsonb),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('type', e.note_type, 'note', e.note, 'verification', e.verification_status, 'last_verified', e.last_verified_date,
          'relevant', e.note_type = 'General' or cardinality(e.match_values) = 0
             or exists (select 1 from nat where nat.n = any(e.match_values))
             or (e.note_type = 'Activity' and exists (select 1 from k where k.is_trading or upper(coalesce(k.business_activity, '')) like '%TRADING%'))))
       from banking_eligibility_notes e where e.is_active and (e.bank_id = p_bank)), '[]'::jsonb),
    'disclaimer', 'Internal notes, not current bank policy. Approval is decided only by the bank.') end
$$;

create or replace function public.banking_compare(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(x) order by x.is_selected desc, x.created_at), '[]'::jsonb) from (
    select r.id, r.created_at, r.bank_id, r.scheme_id, r.is_selected, r.is_preferred, r.internal_recommendation, r.remarks, r.client_response,
           r.presented_at, r.selected_at, r.deselected_at, r.deselect_reason,
           (select full_name from profiles where id = r.presented_by) presented_by_name,
           b.bank_name, b.appointment_required, b.general_processing_time, s.scheme_name, s.account_type,
           to_jsonb(v) - 'id' - 'scheme_id' as scheme_version,
           to_jsonb(banking_price_for(r.bank_id, r.scheme_id)) as pricing,
           (select count(*) from banking_checklist_items i join banking_checklist_templates t on t.id = i.template_id
             where i.is_active and t.is_active and t.template_code = case when coalesce(t2.uses_standard, true) then 'STANDARD' else t2.template_code end) required_documents,
           banking_case_flags(p_case, r.bank_id) flags
      from banking_bank_recommendations r
      join banking_partners b on b.id = r.bank_id
      left join banking_schemes s on s.id = r.scheme_id
      left join lateral (select * from banking_scheme_versions sv where sv.scheme_id = s.id order by sv.version desc limit 1) v on true
      left join lateral (select * from banking_checklist_templates t where t.bank_id = r.bank_id and t.is_active and t.template_code <> 'ADIB_NO_OFFICE' order by t.version desc limit 1) t2 on true
     where r.case_id = p_case and banking_can('cases.view')) x
$$;

create or replace function public.banking_scheme_save(p_scheme uuid, p jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v int;
begin
  perform banking_require('masters.manage');
  update banking_schemes set current_version = current_version + 1 where id = p_scheme returning current_version into v;
  if v is null then raise exception 'Scheme not found'; end if;
  insert into banking_scheme_versions (scheme_id, version, minimum_balance, initial_deposit, monthly_fee, minimum_average_balance, below_balance_fee, eligibility_conditions, supported_activities, nationality_restrictions, physical_office_required, non_resident_eligible, client_visit_required, processing_time, description, internal_notes, valid_from, valid_until, source, last_verified_date, reviewer, verification_status)
  select p_scheme, v, (p->>'minimum_balance')::numeric, (p->>'initial_deposit')::numeric, (p->>'monthly_fee')::numeric, (p->>'minimum_average_balance')::numeric, (p->>'below_balance_fee')::numeric, p->>'eligibility_conditions', p->>'supported_activities', p->>'nationality_restrictions', (p->>'physical_office_required')::boolean, (p->>'non_resident_eligible')::boolean, (p->>'client_visit_required')::boolean, p->>'processing_time', p->>'description', p->>'internal_notes', (p->>'valid_from')::date, (p->>'valid_until')::date, p->>'source', (p->>'last_verified_date')::date, p->>'reviewer', coalesce(p->>'verification_status', 'Unverified');
  return v;
end $$;

-- Delete a bank only if nothing refers to it; otherwise it is deactivated.
create or replace function public.banking_partner_remove(p_bank uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform banking_require('masters.manage');
  if exists (select 1 from banking_bank_recommendations where bank_id = p_bank) or exists (select 1 from banking_applications where bank_id = p_bank) or exists (select 1 from banking_quotations where bank_id = p_bank) then
    update banking_partners set is_active = false where id = p_bank;
    return 'deactivated';
  end if;
  update banking_partners set is_active = false, deleted_at = now() where id = p_bank;
  return 'deleted';
end $$;

-- ── Timeline ─────────────────────────────────────────────────────────
create or replace function public.banking_case_timeline(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.at desc), '[]'::jsonb) from (
    select h.created_at at, 'Stage' kind, 'Stage ' || coalesce(h.from_stage::text, '–') || ' → ' || h.to_stage || coalesce(': ' || h.remarks, '') as summary, (select full_name from profiles where id = h.created_by) who
      from banking_case_stage_history h where h.case_id = p_case and banking_can('cases.view')
    union all select c.occurred_at, c.channel, c.summary || coalesce(' — ' || c.outcome, ''), (select full_name from profiles where id = c.created_by)
      from banking_communications c where c.case_id = p_case and banking_can('comms.view')
    union all select ash.created_at, 'Application', coalesce(ash.previous_status, '') || ' → ' || ash.new_status || coalesce(': ' || ash.remarks, ''), (select full_name from profiles where id = ash.created_by)
      from banking_application_status_history ash join banking_applications a on a.id = ash.application_id where a.case_id = p_case and banking_can('apps.view')
    union all select p.created_at, p.txn_type, 'AED ' || p.amount || ' ' || coalesce(p.payment_method, '') || ' (' || p.payment_ref || ')', (select full_name from profiles where id = p.created_by)
      from banking_payments p where p.case_id = p_case and banking_can('payments.view')
    union all select q.created_at, 'Quotation', q.quotation_number || ' v' || q.version || ' ' || q.status || ' AED ' || q.total_amount, (select full_name from profiles where id = q.created_by)
      from banking_quotations q where q.case_id = p_case and banking_can('quotes.view')
    union all select l.created_at, 'Agreement', l.letter_number || ' v' || l.version || ' ' || l.status, (select full_name from profiles where id = l.created_by)
      from banking_engagement_letters l where l.case_id = p_case and banking_can('agreements.view')
  ) t
$$;

-- ── Rule-based assistant: fills the review queue; a person decides ───
create or replace function public.banking_ai_refresh(p_case uuid) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare n int := 0; rec record; c banking_cases;
begin
  perform banking_require('cases.view');
  select * into c from banking_cases where id = p_case;
  -- missing documents
  for rec in select requirement_label from banking_case_checklists where case_id = p_case and is_current and is_mandatory and status in ('Not Requested','Requested','Rejected','Resubmission Required') loop
    if not exists (select 1 from banking_ai_suggestions where case_id = p_case and capability = 'missing_document' and payload ->> 'label' = rec.requirement_label and status = 'Pending Review') then
      insert into banking_ai_suggestions (case_id, capability, engine, payload) values (p_case, 'missing_document', 'rules', jsonb_build_object('label', rec.requirement_label, 'task_type', 'Document Collection', 'suggestion', 'Follow up for: ' || rec.requirement_label));
      n := n + 1;
    end if;
  end loop;
  -- expiring documents
  for rec in select requirement_label, expiry_date from banking_case_checklists where case_id = p_case and is_current and expiry_date between current_date and current_date + 30 loop
    if not exists (select 1 from banking_ai_suggestions where case_id = p_case and capability = 'expiry_alert' and payload ->> 'label' = rec.requirement_label and status = 'Pending Review') then
      insert into banking_ai_suggestions (case_id, capability, engine, payload) values (p_case, 'expiry_alert', 'rules', jsonb_build_object('label', rec.requirement_label, 'expiry', rec.expiry_date, 'task_type', 'Document Collection', 'suggestion', rec.requirement_label || ' expires on ' || rec.expiry_date));
      n := n + 1;
    end if;
  end loop;
  -- possible duplicate clients
  for rec in select o.id, o.display_name from banking_clients o join banking_clients me on me.id = c.client_id
     where o.id <> me.id and (banking_similarity_key(o.name_key) = banking_similarity_key(me.name_key)) loop
    if not exists (select 1 from banking_ai_suggestions where case_id = p_case and capability = 'duplicate_client' and payload ->> 'client_id' = rec.id::text) then
      insert into banking_ai_suggestions (case_id, capability, engine, payload) values (p_case, 'duplicate_client', 'rules', jsonb_build_object('client_id', rec.id, 'suggestion', 'Possible duplicate client: ' || rec.display_name));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.banking_similarity_key(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select left(regexp_replace(coalesce(p, ''), '\s', '', 'g'), 12)
$$;

-- Accepting only records the decision and, where relevant, opens a task. It never verifies,
-- approves, rejects, sends or posts anything.
create or replace function public.banking_ai_review(p_id uuid, p_accept boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s banking_ai_suggestions;
begin
  perform banking_require('tasks.manage');
  update banking_ai_suggestions set status = case when p_accept then 'Accepted' else 'Rejected' end, reviewed_by = auth.uid(), reviewed_at = now(), review_note = p_note
   where id = p_id and status = 'Pending Review' returning * into s;
  if s.id is null then raise exception 'That suggestion is already reviewed'; end if;
  if p_accept and s.payload ? 'task_type' then
    insert into banking_tasks (case_id, task_type, title, assigned_to, due_date)
    select s.case_id, s.payload ->> 'task_type', s.payload ->> 'suggestion', assigned_to, current_date + 2 from banking_cases where id = s.case_id;
  end if;
end $$;

-- ── Excel migration: committing approved rows ────────────────────────
create or replace function public.banking_import_commit(p_import uuid, p_limit int default 100) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  rw banking_excel_import_rows; m jsonb; v_client uuid; v_lead uuid; v_case uuid; v_app uuid; v_reco uuid; v_quote uuid; v_bank uuid; v_svc uuid;
  v_status text; v_stage int; v_outcome text; n int := 0; e int := 0; v_fee numeric; v_month date;
begin
  perform banking_require('imports.manage');
  perform set_config('banking.internal', '1', true);
  for rw in select * from banking_excel_import_rows where import_id = p_import and decision = 'Approved' order by source_sheet, source_row limit p_limit loop
    begin
      m := rw.mapped;
      if exists (select 1 from banking_excel_import_rows x where x.duplicate_key = rw.duplicate_key and x.decision = 'Committed' and x.id <> rw.id) and not coalesce((m ->> 'allow_duplicate')::boolean, false) then
        raise exception 'Already imported from an earlier row with the same company, bank and month';
      end if;
      v_status := coalesce(rw.decided_status, rw.suggested_status);
      if v_status is null then raise exception 'Choose a status for this row'; end if;
      v_client := banking_get_or_create_client(m ->> 'company', m ->> 'license', null);
      select id into v_bank from banking_partners where upper(m ->> 'bank_raw') = any(aliases) or upper(bank_name) = upper(m ->> 'bank_raw') or bank_code = upper(m ->> 'bank_resolved') limit 1;
      if v_bank is null then raise exception 'Bank not recognised: %', m ->> 'bank_raw'; end if;
      v_month := (m ->> 'lead_date')::date;
      insert into banking_leads (lead_date, company_name, contact_person, mobile, whatsapp, email, license_number, nationality, lead_source, status, client_id, converted_at, source_sheet, source_row, initial_notes)
      values (coalesce(v_month, current_date), m ->> 'company', m ->> 'contact', m ->> 'mobile', m ->> 'whatsapp', m ->> 'email', m ->> 'license', m ->> 'nationality', coalesce(m ->> 'lead_source', 'Third Party'), 'Converted', v_client, now(), rw.source_sheet, rw.source_row,
              'Imported. Referred by: ' || coalesce(m ->> 'referrer', '–'))
      returning id into v_lead;
      v_stage := case v_status when 'Account Opened' then 18 when 'Approved' then 17 when 'Rejected' then 17 when 'Returned' then 17 when 'Cancelled' then 17 when 'Submitted to Bank' then 15 when 'Appointment Scheduled' then 15 when 'Bank Review' then 16 when 'Additional Documents Requested' then 16 when 'Resubmission Required' then 16 when 'Client Visited Bank' then 16 when 'Application Preparation' then 14 when 'Ready for Submission' then 14 else 8 end;
      v_outcome := case v_status when 'Account Opened' then 'Approved' when 'Approved' then 'Approved' when 'Rejected' then 'Rejected' when 'Returned' then 'Returned' when 'Cancelled' then 'Cancelled' end;
      insert into banking_cases (client_id, lead_id, account_kind, current_stage, outcome, is_historical, legacy_status, title, created_at)
      values (v_client, v_lead, coalesce(m ->> 'account_kind', 'Business'), v_stage, v_outcome, true, m ->> 'status_raw', 'Historical: ' || (m ->> 'bank_raw'), coalesce(v_month::timestamptz, now()))
      returning id into v_case;
      insert into banking_kyc_profiles (client_id, legal_name) select v_client, m ->> 'company' on conflict (client_id) do nothing;
      insert into banking_case_stage_history (case_id, to_stage, remarks) values (v_case, v_stage, 'Imported from ' || rw.source_sheet || ' row ' || rw.source_row);
      if m ->> 'referrer' is not null then insert into banking_case_parties (case_id, party_role, full_name) values (v_case, 'Referred By', m ->> 'referrer'); end if;
      insert into banking_bank_recommendations (case_id, bank_id, is_selected, is_preferred, selected_at, remarks)
      values (v_case, v_bank, true, true, now(), 'Imported from Excel') returning id into v_reco;
      v_fee := (m ->> 'fee')::numeric;
      if v_fee is not null and v_fee > 0 then
        insert into banking_quotations (case_id, recommendation_id, bank_id, status, vat_mode, is_imported, quotation_date, accepted_at, remarks)
        values (v_case, v_reco, v_bank, 'Accepted', 'none', true, coalesce(v_month, current_date), now(), 'Imported fee from Excel. VAT treatment not recorded in the source.') returning id into v_quote;
        insert into banking_quotation_items (quotation_id, item_type, description, unit_amount) values (v_quote, 'Service Fee', 'Historical fee as recorded in Excel', v_fee);
        perform banking_quote_recalc(v_quote);
      end if;
      insert into banking_applications (case_id, recommendation_id, bank_id, status, is_active, relationship_manager_text, historical_date, internal_remarks, application_date)
      values (v_case, v_reco, v_bank, v_status, v_status not in ('Rejected','Returned','Cancelled'), m ->> 'rm', (m ->> 'date')::date, m ->> 'remarks', coalesce(v_month, current_date))
      returning id into v_app;
      insert into banking_application_status_history (application_id, new_status, remarks) values (v_app, v_status, 'Imported. Excel status: ' || coalesce(m ->> 'status_raw', '–') || '; colour: ' || coalesce(rw.cell_colour, 'none'));
      if (m ->> 'rm_fee')::numeric is not null then insert into banking_commissions (application_id, amount, source) values (v_app, (m ->> 'rm_fee')::numeric, 'Excel RM FEES'); end if;
      if coalesce((m ->> 'home_ejari')::boolean, false) then
        select id into v_svc from banking_supplementary_services where service_code = 'HOME_EJARI';
        insert into banking_service_deliverables (case_id, service_id, application_id, remarks) values (v_case, v_svc, v_app, 'Mentioned in Excel: ' || coalesce(rw.payment_note, ''));
      end if;
      update banking_excel_import_rows set decision = 'Committed', error = null, client_id = v_client, lead_id = v_lead, case_id = v_case, application_id = v_app where id = rw.id;
      n := n + 1;
    exception when others then
      update banking_excel_import_rows set decision = 'Error', error = sqlerrm where id = rw.id;
      e := e + 1;
    end;
  end loop;
  perform set_config('banking.internal', '', true);
  update banking_excel_imports i set
    committed_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Committed'),
    skipped_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Skipped'),
    error_rows = (select count(*) from banking_excel_import_rows r where r.import_id = i.id and r.decision = 'Error'),
    status = case when exists (select 1 from banking_excel_import_rows r where r.import_id = i.id and r.decision in ('Pending','Approved','Error')) then 'Partly Committed' else 'Committed' end
   where i.id = p_import;
  return jsonb_build_object('committed', n, 'errors', e);
end $$;

-- A person confirms each transaction from the note. Date and amount must be supplied; never invented.
create or replace function public.banking_import_post_payments(p_row uuid, p_payments jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare rw banking_excel_import_rows; it jsonb; n int := 0;
begin
  perform banking_require('imports.manage');
  perform banking_require('payments.manage');
  select * into rw from banking_excel_import_rows where id = p_row for update;
  if rw.case_id is null then raise exception 'Commit the row before posting its payments'; end if;
  if rw.payment_review = 'Reviewed' then raise exception 'These payment notes are already reviewed'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    perform banking_payment_add(rw.case_id, (it ->> 'date')::date, (it ->> 'amount')::numeric, it ->> 'method', null, rw.payment_note,
       'Historical payment', 'From ' || rw.source_sheet || ' row ' || rw.source_row, null, null, rw.id);
    n := n + 1;
  end loop;
  update banking_excel_import_rows set payment_review = 'Reviewed' where id = p_row;
  return n;
end $$;

-- ── Dashboard ────────────────────────────────────────────────────────
create or replace function public.banking_dashboard(p_from date default null, p_to date default null, p_bank uuid default null, p_employee uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare j jsonb; v_fin boolean := banking_can('reports.finance'); f jsonb := null;
begin
  perform banking_require('dashboard.view');
  with l as (select * from banking_leads where (p_from is null or lead_date >= p_from) and (p_to is null or lead_date <= p_to) and (p_employee is null or assigned_to = p_employee)),
  c as (select * from banking_cases x where (p_employee is null or x.assigned_to = p_employee)
          and (p_from is null or x.created_at::date >= p_from) and (p_to is null or x.created_at::date <= p_to)
          and (p_bank is null or exists (select 1 from banking_bank_recommendations r where r.case_id = x.id and r.is_selected and r.bank_id = p_bank))),
  a as (select ap.* from banking_applications ap join c on c.id = ap.case_id),
  q as (select qt.* from banking_quotations qt join c on c.id = qt.case_id where qt.status <> 'Superseded')
  select jsonb_build_object(
    'cards', jsonb_build_object(
      'total_leads', (select count(*) from l),
      'new_leads', (select count(*) from l where status = 'New'),
      'contacted', (select count(*) from l where status = 'Contacted'),
      'interested', (select count(*) from l where status = 'Interested'),
      'potential', (select count(*) from l where status = 'Potential Client'),
      'quotations_issued', (select count(*) from q where status in ('Issued','Sent','Accepted','Rejected','Expired')),
      'offers_accepted', (select count(*) from q where status = 'Accepted'),
      'agreements_pending', (select count(*) from q where status = 'Accepted' and not is_imported and not exists (select 1 from banking_engagement_letters e where e.quotation_id = q.id and e.status = 'Signed')),
      'documents_pending', (select count(distinct cl.case_id) from banking_case_checklists cl join c on c.id = cl.case_id where cl.is_current and cl.is_mandatory and cl.status not in ('Verified','Not Applicable') and c.outcome is null),
      'ready_for_submission', (select count(*) from a where status = 'Ready for Submission'),
      'submitted', (select count(*) from a where status = 'Submitted to Bank'),
      'under_review', (select count(*) from a where status in ('Bank Review','Additional Documents Requested','Resubmission Required','Appointment Scheduled','Client Visited Bank')),
      'approved', (select count(*) from a where status in ('Approved','Account Opened')),
      'rejected', (select count(*) from a where status = 'Rejected'),
      'returned', (select count(*) from a where status = 'Returned'),
      'cancelled', (select count(*) from a where status = 'Cancelled')),
    'charts', jsonb_build_object(
      'monthly_leads', (select coalesce(jsonb_agg(jsonb_build_object('label', m, 'value', n) order by m), '[]'::jsonb) from (select to_char(lead_date, 'YYYY-MM') m, count(*) n from l group by 1) t),
      'monthly_conversions', (select coalesce(jsonb_agg(jsonb_build_object('label', m, 'value', n) order by m), '[]'::jsonb) from (select to_char(lead_date, 'YYYY-MM') m, count(*) n from l where status = 'Converted' group by 1) t),
      'bank_applications', (select coalesce(jsonb_agg(jsonb_build_object('label', bank, 'value', n, 'approved', ok, 'rejected', decided - ok, 'rate', case when decided > 0 then round(100.0 * ok / decided) end) order by n desc), '[]'::jsonb) from (
          select b.bank_name bank, count(*) n, count(*) filter (where a.status in ('Approved','Account Opened')) ok,
                 count(*) filter (where a.status in ('Approved','Account Opened','Rejected')) decided
            from a join banking_partners b on b.id = a.bank_id group by 1) t),
      'employee_performance', (select coalesce(jsonb_agg(jsonb_build_object('label', who, 'value', n, 'approved', ok) order by n desc), '[]'::jsonb) from (
          select coalesce(p.full_name, 'Unassigned') who, count(*) n, count(*) filter (where c.outcome = 'Approved') ok from c left join profiles p on p.id = c.assigned_to group by 1) t),
      'lead_sources', (select coalesce(jsonb_agg(jsonb_build_object('label', lead_source, 'value', n, 'converted', ok) order by n desc), '[]'::jsonb) from (select lead_source, count(*) n, count(*) filter (where status = 'Converted') ok from l group by 1) t),
      'by_step', (select coalesce(jsonb_agg(jsonb_build_object('step', current_stage, 'total', n, 'open', o) order by current_stage), '[]'::jsonb) from (select current_stage, count(*) n, count(*) filter (where outcome is null) o from c group by 1) t),
      'pending_by_stage', (select coalesce(jsonb_agg(jsonb_build_object('stage', current_stage, 'value', n) order by current_stage), '[]'::jsonb) from (select current_stage, count(*) n from c where outcome is null and not is_historical group by 1) t)),
    'alerts', jsonb_build_object(
      'lead_followups', (select count(*) from banking_leads where follow_up_date <= current_date and status not in ('Converted','Lost','Not Interested')),
      'quotes_waiting', (select count(*) from q where status in ('Issued','Sent')),
      'payments_overdue', (select count(*) from (select q.id from q where q.status = 'Accepted' and not q.is_imported and q.total_amount > (select coalesce(sum(signed_amount), 0) from banking_payments p where p.case_id = q.case_id)) t),
      'documents_pending', (select count(*) from banking_case_checklists cl join c on c.id = cl.case_id where cl.is_current and cl.is_mandatory and cl.status in ('Not Requested','Requested','Rejected','Resubmission Required') and c.outcome is null),
      'agreements_unsigned', (select count(*) from banking_engagement_letters e join c on c.id = e.case_id where e.status in ('Draft','Sent to Client','Awaiting Signature')),
      'appointments', (select count(*) from banking_appointments ap join c on c.id = ap.case_id where ap.status = 'Scheduled' and ap.appointment_at >= now()),
      'bank_response', (select count(*) from a where status in ('Submitted to Bank','Bank Review') and is_active),
      'comm_followups', (select count(*) from banking_communications where not follow_up_done and follow_up_date <= current_date),
      'tasks_overdue', (select count(*) from banking_tasks where status in ('Open','In Progress') and due_date < current_date),
      'import_review', (select count(*) from banking_excel_import_rows where decision = 'Pending'))
  ) into j;
  if v_fin then
    with c as (select * from banking_cases x where (p_employee is null or x.assigned_to = p_employee)
             and (p_from is null or x.created_at::date >= p_from) and (p_to is null or x.created_at::date <= p_to)
             and (p_bank is null or exists (select 1 from banking_bank_recommendations r where r.case_id = x.id and r.is_selected and r.bank_id = p_bank))),
    q as (select qt.* from banking_quotations qt join c on c.id = qt.case_id where qt.status = 'Accepted'),
    allq as (select qt.* from banking_quotations qt join c on c.id = qt.case_id where qt.status not in ('Superseded','Draft','Approval Required','Rejected','Expired')),
    p as (select pm.* from banking_payments pm join c on c.id = pm.case_id)
    select jsonb_build_object(
      'quotation_value', (select coalesce(sum(total_amount), 0) from allq),
      'service_fees', (select coalesce(sum(service_fee_total - discount_total), 0) from q),
      'bank_fees', (select coalesce(sum(bank_fee_total), 0) from q),
      'collected', (select coalesce(sum(signed_amount), 0) from p),
      'outstanding', (select coalesce(sum(greatest(q.total_amount - (select coalesce(sum(signed_amount), 0) from p where p.case_id = q.case_id), 0)), 0) from q),
      'advance_received', (select coalesce(sum(signed_amount), 0) from p where p.txn_type = 'Payment' and p.id = (select p2.id from banking_payments p2 where p2.case_id = p.case_id and p2.txn_type = 'Payment' order by p2.payment_date, p2.created_at limit 1)),
      'part_payments', (select count(*) from (select case_id from p where txn_type = 'Payment' group by 1 having count(*) > 1) t),
      'refunds', (select coalesce(sum(abs(amount)), 0) from p where txn_type = 'Refund'),
      'home_ejari_revenue', (select coalesce(sum(i.amount), 0) from banking_quotation_items i join q on q.id = i.quotation_id join banking_supplementary_services s on s.id = i.service_id where s.service_code = 'HOME_EJARI'),
      'monthly_revenue', (select coalesce(jsonb_agg(jsonb_build_object('label', m, 'value', v) order by m), '[]'::jsonb) from (select to_char(payment_date, 'YYYY-MM') m, sum(signed_amount) v from p group by 1) t)
    ) into f;
  end if;
  return j || jsonb_build_object('finance', f);
end $$;

-- ── Reports ──────────────────────────────────────────────────────────
create or replace function public.banking_report(p_name text, p_from date default null, p_to date default null, p_bank uuid default null, p_employee uuid default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb; v_group text := p_name;
begin
  if p_name in ('quotation_value','bank_fees','ab_revenue','supplementary_revenue','payments_received','outstanding','refunds') then
    perform banking_require('reports.finance');
  else
    perform banking_require('reports.view');
  end if;
  with base as (
    select c.id, c.case_ref, cl.display_name client, c.current_stage stage, c.outcome, c.created_at::date opened, p.full_name employee, c.assigned_to,
           b.bank_name bank, rc.bank_id, s.scheme_name scheme, a.status app_status, a.status_date, a.submission_date, a.application_ref, c.is_historical,
           q.total_amount quote_total, q.bank_fee_total, q.service_fee_total - q.discount_total as ab_fee, q.supplementary_total, q.status quote_status,
           coalesce((select sum(signed_amount) from banking_payments x where x.case_id = c.id), 0) received
      from banking_cases c join banking_clients cl on cl.id = c.client_id
      left join profiles p on p.id = c.assigned_to
      left join banking_bank_recommendations rc on rc.case_id = c.id and rc.is_selected
      left join banking_partners b on b.id = rc.bank_id
      left join banking_schemes s on s.id = rc.scheme_id
      left join lateral (select * from banking_applications ap where ap.case_id = c.id order by ap.is_active desc, ap.created_at desc limit 1) a on true
      left join lateral (select * from banking_current_quote(c.id)) q on true
     where (p_from is null or c.created_at::date >= p_from) and (p_to is null or c.created_at::date <= p_to)
       and (p_bank is null or rc.bank_id = p_bank) and (p_employee is null or c.assigned_to = p_employee)
       and (p_status is null or a.status = p_status or c.outcome = p_status)
  ), leads as (
    select l.*, p.full_name employee from banking_leads l left join profiles p on p.id = l.assigned_to
     where (p_from is null or l.lead_date >= p_from) and (p_to is null or l.lead_date <= p_to) and (p_employee is null or l.assigned_to = p_employee) and (p_status is null or l.status = p_status)
  )
  select case v_group
    when 'leads_received' then (select jsonb_agg(jsonb_build_object('Lead', lead_ref, 'Date', lead_date, 'Company', company_name, 'Source', lead_source, 'Status', status, 'Employee', employee) order by lead_date desc) from leads)
    when 'lead_sources' then (select jsonb_agg(jsonb_build_object('Source', lead_source, 'Leads', n, 'Converted', ok, 'Conversion %', case when n > 0 then round(100.0 * ok / n) end) order by n desc) from (select lead_source, count(*) n, count(*) filter (where status = 'Converted') ok from leads group by 1) t)
    when 'conversion_rate' then (select jsonb_agg(jsonb_build_object('Month', m, 'Leads', n, 'Converted', ok, 'Conversion %', case when n > 0 then round(100.0 * ok / n) end) order by m) from (select to_char(lead_date, 'YYYY-MM') m, count(*) n, count(*) filter (where status = 'Converted') ok from leads group by 1) t)
    when 'lost_leads' then (select jsonb_agg(jsonb_build_object('Lead', lead_ref, 'Company', company_name, 'Status', status, 'Source', lead_source, 'Employee', employee, 'Notes', initial_notes)) from leads where status in ('Lost','Not Interested','Unreachable'))
    when 'employee_performance' then (select jsonb_agg(jsonb_build_object('Employee', e, 'Cases', n, 'Approved', ok, 'Rejected', rj, 'Open', op) order by n desc) from (select coalesce(employee, 'Unassigned') e, count(*) n, count(*) filter (where outcome = 'Approved') ok, count(*) filter (where outcome = 'Rejected') rj, count(*) filter (where outcome is null) op from base group by 1) t)
    when 'quotations_issued' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Status', quote_status, 'Total', quote_total)) from base where quote_status is not null)
    when 'quotation_conversion' then (select jsonb_agg(jsonb_build_object('Status', status, 'Count', n)) from (select q.status, count(*) n from banking_quotations q join base on base.id = q.case_id where not q.is_imported group by 1) t)
    when 'applications_by_bank' then (select jsonb_agg(jsonb_build_object('Bank', bank, 'Applications', n, 'Approved', ok, 'Rejected', rj, 'Returned', rt, 'Approval %', case when ok + rj > 0 then round(100.0 * ok / (ok + rj)) end) order by n desc) from (select coalesce(bank, '–') bank, count(*) n, count(*) filter (where app_status in ('Approved','Account Opened')) ok, count(*) filter (where app_status = 'Rejected') rj, count(*) filter (where app_status = 'Returned') rt from base where application_ref is not null group by 1) t)
    when 'applications_by_scheme' then (select jsonb_agg(jsonb_build_object('Bank', bank, 'Scheme', scheme, 'Applications', n) order by n desc) from (select bank, coalesce(scheme, 'Not recorded') scheme, count(*) n from base where application_ref is not null group by 1, 2) t)
    when 'under_process' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Status', app_status, 'Since', status_date::date, 'Employee', employee)) from base where app_status is not null and app_status not in ('Account Opened','Approved','Rejected','Returned','Cancelled'))
    when 'accounts_opened' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Status', app_status, 'Date', status_date::date)) from base where app_status in ('Account Opened','Approved'))
    when 'rejected' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Date', status_date::date, 'Employee', employee)) from base where app_status = 'Rejected')
    when 'returned' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Date', status_date::date, 'Employee', employee)) from base where app_status = 'Returned')
    when 'approval_rate' then (select jsonb_agg(jsonb_build_object('Approved', ok, 'Rejected', rj, 'Approval %', case when ok + rj > 0 then round(100.0 * ok / (ok + rj)) end)) from (select count(*) filter (where app_status in ('Approved','Account Opened')) ok, count(*) filter (where app_status = 'Rejected') rj from base) t)
    when 'average_processing' then (select jsonb_agg(jsonb_build_object('Bank', bank, 'Completed', n, 'Average days', d) order by d) from (select bank, count(*) n, round(avg(status_date::date - coalesce(submission_date, opened))) d from base where app_status in ('Approved','Account Opened') and not is_historical group by 1) t)
    when 'quotation_value' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Status', quote_status, 'Total', quote_total)) from base where quote_total is not null)
    when 'bank_fees' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Bank fees', bank_fee_total)) from base where coalesce(bank_fee_total, 0) > 0)
    when 'ab_revenue' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'AB Capital fee (net of discount)', ab_fee, 'Quote status', quote_status)) from base where quote_status = 'Accepted')
    when 'supplementary_revenue' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Supplementary', supplementary_total)) from base where coalesce(supplementary_total, 0) > 0 and quote_status = 'Accepted')
    when 'payments_received' then (select jsonb_agg(jsonb_build_object('Payment', pm.payment_ref, 'Date', pm.payment_date, 'Case', base.case_ref, 'Client', base.client, 'Type', pm.txn_type, 'Amount', pm.signed_amount, 'Method', pm.payment_method) order by pm.payment_date desc) from banking_payments pm join base on base.id = pm.case_id)
    when 'outstanding' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Total', quote_total, 'Received', received, 'Outstanding', quote_total - received)) from base where quote_status = 'Accepted' and quote_total > received)
    when 'refunds' then (select jsonb_agg(jsonb_build_object('Payment', pm.payment_ref, 'Date', pm.payment_date, 'Case', base.case_ref, 'Client', base.client, 'Amount', pm.amount, 'Reason', pm.remarks)) from banking_payments pm join base on base.id = pm.case_id where pm.txn_type = 'Refund')
    when 'pending_documents' then (select jsonb_agg(jsonb_build_object('Case', base.case_ref, 'Client', base.client, 'Document', cl.requirement_label, 'Status', cl.status, 'Employee', base.employee)) from banking_case_checklists cl join base on base.id = cl.case_id where cl.is_current and cl.is_mandatory and cl.status not in ('Verified','Not Applicable'))
    when 'overdue_followups' then (select jsonb_agg(jsonb_build_object('Due', d, 'Type', k, 'Subject', s, 'Employee', e) order by d) from (
        select follow_up_date d, 'Lead' k, company_name s, employee e from leads where follow_up_date < current_date and status not in ('Converted','Lost','Not Interested')
        union all select cm.follow_up_date, 'Communication', cm.next_action, p.full_name from banking_communications cm left join profiles p on p.id = cm.assigned_to where not cm.follow_up_done and cm.follow_up_date < current_date) t)
    when 'pending_agreements' then (select jsonb_agg(jsonb_build_object('Letter', e.letter_number, 'Case', base.case_ref, 'Client', base.client, 'Status', e.status, 'Date', e.letter_date)) from banking_engagement_letters e join base on base.id = e.case_id where e.status in ('Draft','Sent to Client','Awaiting Signature'))
    when 'pending_appointments' then (select jsonb_agg(jsonb_build_object('When', ap.appointment_at, 'Case', base.case_ref, 'Client', base.client, 'Bank', base.bank, 'Location', ap.location)) from banking_appointments ap join base on base.id = ap.case_id where ap.status = 'Scheduled')
    when 'awaiting_bank' then (select jsonb_agg(jsonb_build_object('Case', case_ref, 'Client', client, 'Bank', bank, 'Status', app_status, 'Since', status_date::date)) from base where app_status in ('Submitted to Bank','Bank Review'))
    when 'cases_by_employee' then (select jsonb_agg(jsonb_build_object('Employee', e, 'Open cases', n, 'Open tasks', t2) order by n desc) from (select coalesce(employee, 'Unassigned') e, count(*) n, (select count(*) from banking_tasks t where t.assigned_to = b.assigned_to and t.status in ('Open','In Progress')) t2 from base b where outcome is null group by 1, b.assigned_to) t)
    else null end into r;
  if r is null and v_group not in ('leads_received','lead_sources','conversion_rate','lost_leads','employee_performance','quotations_issued','quotation_conversion','applications_by_bank','applications_by_scheme','under_process','accounts_opened','rejected','returned','approval_rate','average_processing','quotation_value','bank_fees','ab_revenue','supplementary_revenue','payments_received','outstanding','refunds','pending_documents','overdue_followups','pending_agreements','pending_appointments','awaiting_bank','cases_by_employee') then
    raise exception 'Unknown report %', p_name;
  end if;
  return coalesce(r, '[]'::jsonb);
end $$;

-- Case list with money and status, for the Cases page.
create or replace function public.banking_case_list(p_search text default null, p_limit int default 100, p_offset int default 0, p_include_historical boolean default false) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('total', (select count(*) from banking_cases c join banking_clients cl on cl.id = c.client_id where banking_can('cases.view') and (p_include_historical or not c.is_historical) and (p_search is null or cl.display_name ilike '%' || p_search || '%' or c.case_ref ilike '%' || p_search || '%')),
   'rows', coalesce((select jsonb_agg(row_to_json(t)) from (
    select c.id, c.case_ref, c.current_stage, c.outcome, c.is_historical, c.legacy_status, cl.id client_id, cl.display_name client, cl.client_master_id, cl.link_status, p.full_name employee,
           b.bank_name bank, a.status app_status, q.total_amount total,
           coalesce((select sum(signed_amount) from banking_payments x where x.case_id = c.id), 0) received
      from banking_cases c join banking_clients cl on cl.id = c.client_id
      left join profiles p on p.id = c.assigned_to
      left join banking_bank_recommendations rc on rc.case_id = c.id and rc.is_selected
      left join banking_partners b on b.id = rc.bank_id
      left join lateral (select * from banking_applications ap where ap.case_id = c.id order by ap.is_active desc, ap.created_at desc limit 1) a on true
      left join lateral (select * from banking_current_quote(c.id)) q on true
     where banking_can('cases.view') and (p_include_historical or not c.is_historical) and (p_search is null or cl.display_name ilike '%' || p_search || '%' or c.case_ref ilike '%' || p_search || '%')
     order by c.created_at desc limit p_limit offset p_offset) t), '[]'::jsonb))
$$;

-- ── Plan picker: every active bank with its plans, charges and internal notes for this case ──
create or replace function public.banking_plan_catalogue(p_case uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'bank_id', b.id, 'bank_name', b.bank_name, 'website', b.website, 'appointment_required', b.appointment_required, 'digital_application', b.digital_application, 'processing_time', b.general_processing_time,
    'bank_pricing', to_jsonb(banking_price_for(b.id, null)),
    'flags', banking_case_flags(p_case, b.id),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('scheme_id', s.id, 'scheme_name', s.scheme_name, 'account_type', s.account_type, 'version', to_jsonb(v), 'pricing', to_jsonb(banking_price_for(b.id, s.id))) order by coalesce(v.minimum_average_balance, 0), s.scheme_name), '[]'::jsonb)
        from banking_schemes s left join lateral (select * from banking_scheme_versions sv where sv.scheme_id = s.id order by sv.version desc limit 1) v on true
       where s.bank_id = b.id and s.is_active and s.deleted_at is null)
  ) order by b.bank_name), '[]'::jsonb)
  from banking_partners b where b.is_active and b.deleted_at is null and banking_can('cases.view')
$$;

-- Selects a bank and plan in one step; adds the option if it was not on the shortlist.
create or replace function public.banking_choose_plan(p_case uuid, p_bank uuid, p_scheme uuid default null, p_reason text default null) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_reco uuid; v_ver uuid;
begin
  perform banking_require('cases.manage');
  select id into v_reco from banking_bank_recommendations where case_id = p_case and bank_id = p_bank and scheme_id is not distinct from p_scheme limit 1;
  if v_reco is null then
    select id into v_ver from banking_scheme_versions where scheme_id = p_scheme order by version desc limit 1;
    insert into banking_bank_recommendations (case_id, bank_id, scheme_id, scheme_version_id, presented_at, presented_by)
    values (p_case, p_bank, p_scheme, v_ver, now(), auth.uid()) returning id into v_reco;
  end if;
  return banking_select_bank(p_case, v_reco, p_reason);
end $$;

-- A KYC file received before any bank is chosen. The checklist links it later; it is never verified here.
create or replace function public.banking_kyc_add_document(p_client uuid, p_doc_code text, p_shareholder uuid, p_path text, p_file text, p_mime text, p_size bigint, p_sha text, p_expiry date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_type banking_document_types; v_doc uuid; k uuid;
begin
  perform banking_require('docs.manage');
  select * into v_type from banking_document_types where doc_code = p_doc_code;
  if v_type.id is null then raise exception 'Choose a document type for %', p_file; end if;
  insert into banking_documents (client_id, document_type_id, shareholder_id, title, current_version, expiry_date)
  values (p_client, v_type.id, p_shareholder, v_type.doc_name, 1, p_expiry) returning id into v_doc;
  insert into banking_document_versions (document_id, version, storage_path, file_name, mime_type, size_bytes, sha256, expiry_date)
  values (v_doc, 1, p_path, p_file, p_mime, p_size, p_sha, p_expiry);
  select id into k from banking_kyc_profiles where client_id = p_client;
  if k is not null then insert into banking_kyc_documents (kyc_profile_id, document_id) values (k, v_doc) on conflict do nothing; end if;
  return v_doc;
end $$;

-- ── Function access ──────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'banking\_%') loop
    execute format('revoke all on function %s from public, anon', f.sig);
    if f.proname not in ('banking_get_or_create_client','banking_generate_checklist','banking_quote_recalc','banking_case_finance_internal','banking_touch','banking_audit','banking_append_only','banking_guard_case','banking_guard_reco','banking_kyc_percent') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
end $$;
-- Trigger-context helpers are invoked by the definer functions, which run as the owner.
grant execute on function public.banking_touch() to authenticated;
grant execute on function public.banking_audit() to authenticated;
grant execute on function public.banking_append_only() to authenticated;
grant execute on function public.banking_guard_case() to authenticated;
grant execute on function public.banking_guard_reco() to authenticated;
grant execute on function public.banking_kyc_percent() to authenticated;
