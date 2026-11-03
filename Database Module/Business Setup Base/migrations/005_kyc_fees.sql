-- =====================================================================
-- Business Setup Base - KYC, partner and fee-item functions            003
-- =====================================================================
-- Re-runnable. Runs after 003 and 004. Tables stay read-only through the API; these functions write.
-- Identity values (name, contact, email, phone, licence number and authority) stay in client_master and are only
-- read from there for the completeness check. No prices live in this file: the fee list is a private seed (007).
-- =====================================================================

-- Partners are never hard-deleted: a delete stamps deleted_at and readers stop seeing the row.
alter table public.business_setup_kyc_partners add column if not exists deleted_at timestamptz;
drop policy if exists business_setup_kyc_partners_read on public.business_setup_kyc_partners;
create policy business_setup_kyc_partners_read on public.business_setup_kyc_partners for select to authenticated
  using (public.business_setup_can('setup.kyc.sensitive') and deleted_at is null);

-- Copy of a jsonb with the identity numbers replaced, for the audit log.
create or replace function public.business_setup_mask(p jsonb) returns jsonb
language sql immutable set search_path = pg_catalog as $$
  select coalesce(jsonb_object_agg(e.key,
           case when e.key in ('passport_number','passport_expiry','emirates_id') and btrim(coalesce(e.value #>> '{}', '')) <> '' then to_jsonb('***'::text) else e.value end), '{}'::jsonb)
    from jsonb_each(coalesce(p, '{}'::jsonb)) e
$$;

-- Completeness of a client's KYC against spec 5.1: {percent, missing[]}.
create or replace function public.business_setup_kyc_status(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m client_master; k business_setup_kyc_profiles;
  existing boolean; miss text[] := '{}'; total int := 7; partner_ok boolean;
begin
  perform business_setup_require('setup.access');
  select * into m from client_master where client_id = p_client;
  if m.client_id is null then raise exception 'Client % not found', p_client; end if;
  select * into k from business_setup_kyc_profiles where client_id = p_client;
  existing := k.company_status = 'Existing';

  if client_master_plain(m.data ->> 'Client Legal Name') is null and client_master_plain(m.legal_name) is null then miss := array_append(miss, 'client name'::text); end if;
  if client_master_plain(split_part(coalesce(m.data ->> 'Primary Contact', ''), ';', 1)) is null then miss := array_append(miss, 'contact person'::text); end if;
  if client_master_plain(m.data ->> 'General Email') is null then miss := array_append(miss, 'email'::text); end if;
  if client_master_plain(m.data ->> 'General Phone') is null then miss := array_append(miss, 'phone'::text); end if;
  if nullif(btrim(coalesce(k.business_activity, '')), '') is null then miss := array_append(miss, 'business activity'::text); end if;
  if k.company_status is null then miss := array_append(miss, 'company status'::text); end if;
  select exists (select 1 from business_setup_kyc_partners
                  where kyc_id = k.id and deleted_at is null
                    and nullif(btrim(full_name), '') is not null and nullif(btrim(coalesce(nationality, '')), '') is not null) into partner_ok;
  if not coalesce(partner_ok, false) then miss := array_append(miss, 'partner'::text); end if;

  if existing then
    total := total + 3;
    if coalesce(nullif(btrim(coalesce(k.licence_number, '')), ''), client_master_plain(m.data ->> 'Trade License Number')) is null then miss := array_append(miss, 'licence number'::text); end if;
    if k.licence_expiry is null then miss := array_append(miss, 'licence expiry'::text); end if;
    if coalesce(nullif(btrim(coalesce(k.details ->> 'issuing_authority', '')), ''), client_master_plain(m.data ->> 'License Issuing Authority')) is null then miss := array_append(miss, 'issuing authority'::text); end if;
  end if;
  return jsonb_build_object('percent', round(100.0 * (total - cardinality(miss)) / total)::int, 'missing', to_jsonb(miss));
end $$;

-- Save the KYC profile. Only the keys present in p change; details is merged.
create or replace function public.business_setup_kyc_save(p_client text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k business_setup_kyc_profiles; changed text[];
begin
  perform business_setup_require('setup.kyc.manage');
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
  p := coalesce(p, '{}'::jsonb);
  if p ? 'company_status' and nullif(p ->> 'company_status', '') is not null and (p ->> 'company_status') not in ('New', 'Existing') then
    raise exception 'The company status must be New or Existing';
  end if;
  insert into business_setup_kyc_profiles (client_id) values (p_client) on conflict (client_id) do nothing;
  select * into k from business_setup_kyc_profiles where client_id = p_client for update;
  update business_setup_kyc_profiles set
      company_status    = case when p ? 'company_status'    then nullif(p ->> 'company_status', '')    else company_status end,
      business_activity = case when p ? 'business_activity' then nullif(p ->> 'business_activity', '') else business_activity end,
      jurisdiction      = case when p ? 'jurisdiction'      then nullif(p ->> 'jurisdiction', '')      else jurisdiction end,
      licence_number    = case when p ? 'licence_number'    then nullif(p ->> 'licence_number', '')    else licence_number end,
      licence_expiry    = case when p ? 'licence_expiry'    then nullif(p ->> 'licence_expiry', '')::date else licence_expiry end,
      details           = case when jsonb_typeof(p -> 'details') = 'object' then details || (p -> 'details') else details end
    where id = k.id;
  select array_agg(key order by key) into changed from jsonb_object_keys(p) key;
  perform business_setup_audit('business_setup_kyc_profiles', k.id::text, 'kyc_save', null,
    jsonb_build_object('client_id', p_client, 'fields', to_jsonb(coalesce(changed, '{}'))));
  return business_setup_kyc_status(p_client);
end $$;

-- Add or edit a partner (p.id edits). Identity numbers are stored, never written to the audit log;
-- free-form details are logged by key name only.
create or replace function public.business_setup_partner_save(p_client text, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  kid uuid; pid uuid; cur business_setup_kyc_partners;
begin
  perform business_setup_require('setup.kyc.manage');
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
  p := coalesce(p, '{}'::jsonb);
  insert into business_setup_kyc_profiles (client_id) values (p_client) on conflict (client_id) do nothing;
  select id into kid from business_setup_kyc_profiles where client_id = p_client;
  if nullif(p ->> 'id', '') is null then
    if nullif(btrim(coalesce(p ->> 'full_name', '')), '') is null then raise exception 'The partner name is required'; end if;
    insert into business_setup_kyc_partners (kyc_id, full_name, nationality, share_percent, is_shareholder, is_ubo, passport_number, passport_expiry, emirates_id, details)
    values (kid, btrim(p ->> 'full_name'), nullif(p ->> 'nationality', ''), nullif(p ->> 'share_percent', '')::numeric,
            coalesce((p ->> 'is_shareholder')::boolean, true), coalesce((p ->> 'is_ubo')::boolean, false),
            nullif(p ->> 'passport_number', ''), nullif(p ->> 'passport_expiry', '')::date, nullif(p ->> 'emirates_id', ''),
            case when jsonb_typeof(p -> 'details') = 'object' then p -> 'details' else '{}'::jsonb end)
    returning id into pid;
  else
    pid := (p ->> 'id')::uuid;
    select * into cur from business_setup_kyc_partners where id = pid and kyc_id = kid and deleted_at is null for update;
    if cur.id is null then raise exception 'Partner not found'; end if;
    if p ? 'full_name' and nullif(btrim(coalesce(p ->> 'full_name', '')), '') is null then raise exception 'The partner name is required'; end if;
    update business_setup_kyc_partners set
        full_name       = case when p ? 'full_name'       then btrim(p ->> 'full_name') else full_name end,
        nationality     = case when p ? 'nationality'     then nullif(p ->> 'nationality', '') else nationality end,
        share_percent   = case when p ? 'share_percent'   then nullif(p ->> 'share_percent', '')::numeric else share_percent end,
        is_shareholder  = case when p ? 'is_shareholder'  then coalesce((p ->> 'is_shareholder')::boolean, is_shareholder) else is_shareholder end,
        is_ubo          = case when p ? 'is_ubo'          then coalesce((p ->> 'is_ubo')::boolean, is_ubo) else is_ubo end,
        passport_number = case when p ? 'passport_number' then nullif(p ->> 'passport_number', '') else passport_number end,
        passport_expiry = case when p ? 'passport_expiry' then nullif(p ->> 'passport_expiry', '')::date else passport_expiry end,
        emirates_id     = case when p ? 'emirates_id'     then nullif(p ->> 'emirates_id', '') else emirates_id end,
        details         = case when jsonb_typeof(p -> 'details') = 'object' then details || (p -> 'details') else details end
      where id = pid;
  end if;
  perform business_setup_audit('business_setup_kyc_partners', pid::text, case when nullif(p ->> 'id', '') is null then 'partner_add' else 'partner_edit' end, null,
            jsonb_build_object('client_id', p_client) || business_setup_mask(p - 'id' - 'details')
              || case when jsonb_typeof(p -> 'details') = 'object' then jsonb_build_object('details_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(p -> 'details') key)) else '{}'::jsonb end);
  return pid;
end $$;

-- Soft delete: the row stays with deleted_at set.
create or replace function public.business_setup_partner_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client text;
begin
  perform business_setup_require('setup.kyc.manage');
  update business_setup_kyc_partners pt set deleted_at = now()
    from business_setup_kyc_profiles k
   where pt.id = p_id and pt.deleted_at is null and k.id = pt.kyc_id
  returning k.client_id into v_client;
  if v_client is null then raise exception 'Partner not found'; end if;
  perform business_setup_audit('business_setup_kyc_partners', p_id::text, 'partner_delete', null, jsonb_build_object('client_id', v_client));
end $$;

-- Add or edit a fee item (p.id edits; otherwise group + name is the key).
create or replace function public.business_setup_fee_item_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_amount numeric;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
  v_amount := coalesce(nullif(p ->> 'default_amount', '')::numeric, 0);
  if v_amount < 0 then raise exception 'The fee amount cannot be negative'; end if;
  if nullif(btrim(coalesce(p ->> 'grp', '')), '') is null then raise exception 'The fee group is required'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'The fee name is required'; end if;
  if nullif(p ->> 'id', '') is not null then
    v_id := (p ->> 'id')::uuid;
    update business_setup_fee_items set
        grp = btrim(p ->> 'grp'), name = btrim(p ->> 'name'),
        default_amount = case when p ? 'default_amount' then v_amount else default_amount end,
        service_item_id = case when p ? 'service_item_id' then nullif(p ->> 'service_item_id', '')::uuid else service_item_id end,
        active = case when p ? 'active' then coalesce((p ->> 'active')::boolean, active) else active end,
        sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::int, sort_order) else sort_order end
      where id = v_id;
    if not found then raise exception 'Fee item not found'; end if;
  else
    insert into business_setup_fee_items (grp, name, default_amount, service_item_id, active, sort_order)
    values (btrim(p ->> 'grp'), btrim(p ->> 'name'), v_amount, nullif(p ->> 'service_item_id', '')::uuid,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::int, 0))
    on conflict (grp, name) do update set default_amount = case when p ? 'default_amount' then excluded.default_amount else business_setup_fee_items.default_amount end,
        service_item_id = coalesce(excluded.service_item_id, business_setup_fee_items.service_item_id),
        active = excluded.active, sort_order = excluded.sort_order
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_fee_items', v_id::text, 'fee_item_save', null, jsonb_build_object('grp', p ->> 'grp', 'name', p ->> 'name'));
  return v_id;
end $$;

revoke all on function public.business_setup_kyc_status(text), public.business_setup_kyc_save(text, jsonb),
  public.business_setup_partner_save(text, jsonb), public.business_setup_partner_delete(uuid),
  public.business_setup_fee_item_save(jsonb) from public, anon;
grant execute on function public.business_setup_kyc_status(text), public.business_setup_kyc_save(text, jsonb),
  public.business_setup_partner_save(text, jsonb), public.business_setup_partner_delete(uuid),
  public.business_setup_fee_item_save(jsonb) to authenticated;
