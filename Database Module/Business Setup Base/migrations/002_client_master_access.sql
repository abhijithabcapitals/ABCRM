-- =====================================================================
-- Business Setup Base - Client Master access                        002
-- =====================================================================
-- Business Setup staff read and edit Client Master through Business Setup roles, without gaining any
-- Banking permission. Client Base 002 checks banking_can('kyc.view'/'kyc.manage'); this file widens exactly
-- those checks to "Banking right or Business Setup right".
--
-- Run after Client Base 002 and 003 and after 001_foundation. Client Base 002 recreates the policies and
-- functions below with banking_can only, so re-running it means re-running this file.
-- The bodies of client_master_save and client_lookup are copies of Client Base 002 with only the
-- permission check changed. Keep them in step with Client Base 002 when it changes.
-- =====================================================================

create or replace function public.client_master_can(p_permission text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select banking_can(p_permission) or business_setup_can(p_permission)
$$;
revoke all on function public.client_master_can(text) from public, anon;
grant execute on function public.client_master_can(text) to authenticated;

drop policy if exists client_master_read on public.client_master;
create policy client_master_read on public.client_master for select to authenticated using (client_master_can('kyc.view'));
drop policy if exists client_master_history_read on public.client_master_history;
create policy client_master_history_read on public.client_master_history for select to authenticated using (client_master_can('kyc.view'));

create or replace function public.client_master_save(p_id text, p_data jsonb, p_version integer default null, p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur client_master; merged jsonb; v_id text; dups jsonb; v_name text; k text; ch integer := 0;
begin
  if not client_master_can('kyc.manage') then raise exception 'You do not have permission to change the Client Master'; end if;
  if p_data::text ~* 'AE[0-9]{21}' then raise exception 'Store only the last 4 digits of an IBAN'; end if;
  if p_id is not null then
    select * into cur from client_master where client_id = p_id for update;
    if cur.client_id is null then raise exception 'Client % not found', p_id; end if;
    if p_version is not null and p_version <> cur.version then raise exception 'Someone else changed this client. Reopen it and try again.'; end if;
  end if;
  -- Blank incoming values never overwrite what is stored.
  select coalesce(cur.data, '{}'::jsonb) || coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into merged
    from jsonb_each(p_data) e where btrim(coalesce(e.value #>> '{}', '')) <> '';
  v_name := client_master_plain(merged ->> 'Client Legal Name');
  if v_name is null then raise exception 'Client Legal Name is required.'; end if;
  if client_master_plain(merged ->> 'Risk Level') in ('High', 'Review Required') and client_master_plain(merged ->> 'Risk Reason') is null then
    raise exception 'Risk Level is % - record the Risk Reason before saving.', client_master_plain(merged ->> 'Risk Level');
  end if;
  dups := client_master_duplicates(merged, p_id);
  if p_id is null then
    if jsonb_array_length(dups) > 0 and not p_allow_duplicate then return jsonb_build_object('ok', false, 'duplicates', dups); end if;
    v_id := 'CL' || lpad(nextval('client_master_seq')::text, 6, '0');
    merged := merged || jsonb_build_object('Client ID', v_id);
    insert into client_master (client_id, legal_name, data) values (v_id, v_name, merged);
    insert into client_master_history (client_id, action) values (v_id, case when jsonb_array_length(dups) > 0 then 'Created (duplicate override)' else 'Created' end);
    return jsonb_build_object('ok', true, 'id', v_id, 'duplicates', dups);
  end if;
  merged := merged || jsonb_build_object('Client ID', p_id);
  for k in select key from jsonb_each(merged) loop
    if k <> 'Last Updated' and (cur.data ->> k) is distinct from (merged ->> k) then
      insert into client_master_history (client_id, action, field, old_value, new_value) values (p_id, 'Updated', k, cur.data ->> k, merged ->> k);
      ch := ch + 1;
    end if;
  end loop;
  if ch = 0 then return jsonb_build_object('ok', true, 'id', p_id, 'unchanged', true); end if;
  update client_master set legal_name = v_name, data = merged, version = version + 1, updated_at = now(), updated_by = auth.uid() where client_id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'changes', ch);
end $$;

create or replace function public.client_lookup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select 1 as rank, m.client_id as ref, m.legal_name as name, client_master_plain(m.data ->> 'Client Legal Name') as legal_name, client_master_plain(m.data ->> 'Trade Name') as trade_name,
           client_master_plain(split_part(m.data ->> 'Primary Contact', ';', 1)) as contact, client_master_plain(m.data ->> 'General Email') as email, client_master_plain(m.data ->> 'General Phone') as phone,
           null::text as whatsapp, null::text as nationality, client_master_plain(m.data ->> 'Registered Address') as address, client_master_plain(m.data ->> 'Trade License Number') as license,
           client_master_plain(m.data ->> 'TRN') as trn, client_master_plain(m.data ->> 'License Issuing Authority') as authority, client_master_plain(m.data ->> 'Entity Type') as company_type, client_master_plain(m.data ->> 'Main Business Activity') as activity
      from client_master m where client_master_can('kyc.view')
    union all
    select 2, cl.client_master_id, cl.display_name, k.legal_name, k.trade_name, ld.contact_person, coalesce(k.company_email, ld.email), coalesce(k.company_phone, ld.mobile),
           ld.whatsapp, ld.nationality, k.registered_address, coalesce(cl.license_number, k.license_number, ld.license_number), k.vat_trn, coalesce(k.issuing_authority, ld.license_authority), coalesce(k.legal_structure, ld.company_type), coalesce(k.business_activity, ld.business_activity)
      from banking_clients cl
      left join banking_kyc_profiles k on k.client_id = cl.id and banking_can('kyc.view')
      left join lateral (select * from banking_leads l where l.client_id = cl.id order by l.lead_date desc limit 1) ld on banking_can('leads.view')
     where banking_can('cases.view')
    union all
    select 3, null, l.company_name, null, null, l.contact_person, l.email, l.mobile, l.whatsapp, l.nationality, null, l.license_number, null, l.license_authority, l.company_type, l.business_activity
      from banking_leads l where l.client_id is null and banking_can('leads.view')
    order by 1, 3
  ) t
$$;

revoke all on function public.client_master_save(text, jsonb, integer, boolean), public.client_lookup() from public, anon;
grant execute on function public.client_master_save(text, jsonb, integer, boolean), public.client_lookup() to authenticated;

-- Setup roles were once seeded into Banking's tables; they now live in business_setup_role_permissions.
delete from public.banking_role_permissions where role in ('SETUP_MANAGER', 'SETUP_EMPLOYEE');
