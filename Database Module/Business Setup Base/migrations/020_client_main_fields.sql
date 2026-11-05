-- =====================================================================
-- Business Setup Base - main fields on the Clients list                020
-- =====================================================================
-- Re-runnable. Runs after 014. The department's main fields are service, zone, licence number, issue date, expiry
-- date, shareholder, manager and visa. Whatever a client lacks is listed so staff can complete it later.
-- They live on the KYC profile: its columns where it has them, licence_extras for the rest.
-- These are separate functions, so 015's later change to business_setup_client_list does not touch them.
-- No client data lives in this file.
-- =====================================================================

create or replace function public.business_setup_client_main_fields() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (
    with ids as (
      select client_id from business_setup_kyc_profiles
      union select client_id from business_setup_services
      union select client_id from hub_documents where department = 'Business Setup' and doc_type = 'quote' and client_id is not null
    ), v as (
      select ids.client_id,
             nullif(btrim(k.licence_extras ->> 'service'), '') as service, nullif(btrim(k.jurisdiction), '') as zone, nullif(btrim(k.licence_number), '') as licence_number,
             nullif(btrim(k.licence_extras ->> 'licence_issue'), '') as licence_date, k.licence_expiry,
             nullif(btrim(k.licence_extras ->> 'shareholder'), '') as shareholder, nullif(btrim(k.licence_extras ->> 'manager'), '') as manager,
             nullif(btrim(k.licence_extras ->> 'visa'), '') as visa, coalesce((k.licence_extras ->> 'dates_to_check')::boolean, false) as dates_to_check
        from ids join client_master m on m.client_id = ids.client_id
        left join business_setup_kyc_profiles k on k.client_id = ids.client_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'client_id', client_id, 'service', service, 'zone', zone, 'licence_number', licence_number, 'licence_date', licence_date, 'licence_expiry', licence_expiry,
             'shareholder', shareholder, 'manager', manager, 'visa', visa, 'dates_to_check', dates_to_check,
             'missing', to_jsonb(array_remove(array[
               case when service is null then 'Service' end, case when zone is null then 'Zone' end, case when licence_number is null then 'Licence number' end,
               case when licence_date is null then 'Issue date' end, case when licence_expiry is null then 'Expiry date' end, case when shareholder is null then 'Shareholder' end,
               case when manager is null then 'Manager' end, case when visa is null then 'Visa' end], null)))), '[]'::jsonb)
      from v);
end $$;

-- Saves the keys it is given; an empty value clears that field. Licence details also go to Client Master, where a value is given.
create or replace function public.business_setup_client_main_save(p_client text, p jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m client_master; k business_setup_kyc_profiles; x jsonb; fill jsonb := '{}'; v_issue date; v_expiry date;
  f text; old_state jsonb;
begin
  perform business_setup_require('setup.kyc.manage');
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'Nothing to save'; end if;
  select * into m from client_master where client_id = p_client for update;
  if m.client_id is null then raise exception 'Client % not found', p_client; end if;
  begin
    v_issue := nullif(btrim(p ->> 'licence_date'), '')::date;
    v_expiry := nullif(btrim(p ->> 'licence_expiry'), '')::date;
  exception when others then raise exception 'Enter dates as a real date';
  end;
  insert into business_setup_kyc_profiles (client_id) values (p_client) on conflict (client_id) do nothing;
  select * into k from business_setup_kyc_profiles where client_id = p_client for update;
  old_state := jsonb_build_object('jurisdiction', k.jurisdiction, 'licence_number', k.licence_number, 'licence_expiry', k.licence_expiry, 'licence_extras', k.licence_extras);
  x := k.licence_extras;
  foreach f in array array['service', 'shareholder', 'manager', 'visa'] loop
    if p ? f then x := case when nullif(btrim(p ->> f), '') is null then x - f else x || jsonb_build_object(f, btrim(p ->> f)) end; end if;
  end loop;
  if p ? 'licence_date' then x := case when v_issue is null then x - 'licence_issue' else x || jsonb_build_object('licence_issue', to_char(v_issue, 'YYYY-MM-DD')) end; end if;
  -- Staff have looked at the dates once they save either of them.
  if p ? 'licence_date' or p ? 'licence_expiry' then x := x - 'dates_to_check'; end if;
  update business_setup_kyc_profiles set
      jurisdiction = case when p ? 'zone' then nullif(btrim(p ->> 'zone'), '') else jurisdiction end,
      licence_number = case when p ? 'licence_number' then nullif(btrim(p ->> 'licence_number'), '') else licence_number end,
      licence_expiry = case when p ? 'licence_expiry' then v_expiry else licence_expiry end,
      licence_extras = x
    where id = k.id;
  if nullif(btrim(p ->> 'licence_number'), '') is not null then fill := fill || jsonb_build_object('Trade License Number', btrim(p ->> 'licence_number')); end if;
  if v_issue is not null then fill := fill || jsonb_build_object('License Issue Date', to_char(v_issue, 'DD/MM/YYYY')); end if;
  if v_expiry is not null then fill := fill || jsonb_build_object('License Expiry Date', to_char(v_expiry, 'DD/MM/YYYY')); end if;
  if nullif(btrim(p ->> 'zone'), '') is not null then fill := fill || jsonb_build_object('License Issuing Authority', btrim(p ->> 'zone')); end if;
  if fill <> '{}'::jsonb then
    perform client_master_save(p_client, fill || jsonb_build_object('Client Legal Name', coalesce(client_master_plain(m.data ->> 'Client Legal Name'), m.legal_name)), null);
  end if;
  perform business_setup_audit('business_setup_kyc_profiles', k.id::text, 'client_main_save', old_state, p);
end $$;

revoke all on function public.business_setup_client_main_fields(), public.business_setup_client_main_save(text, jsonb) from public, anon, authenticated;
grant execute on function public.business_setup_client_main_fields(), public.business_setup_client_main_save(text, jsonb) to authenticated;
