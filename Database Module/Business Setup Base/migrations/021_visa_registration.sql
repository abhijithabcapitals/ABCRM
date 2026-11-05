-- =====================================================================
-- Business Setup Base - Visa Registration records from a sheet         021
-- =====================================================================
-- Re-runnable. Runs after 020. Each row is one person's visa under one company, captured as written. It adds a visa
-- record and a Visa Registration service, and marks the company as a Visa Registration client on the Clients list
-- and in Client Master. A company not yet in Client Master is added. KYC state is left as it is.
-- No login is issued and nothing is sent. No client data lives in this file.
-- =====================================================================

create or replace function public.business_setup_visa_sheet_apply(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb; v_client text; v_name text; v_person text; v_issue date; v_expiry date; v_update text; v_status text; res jsonb;
  touched text[] := '{}'; c text; m client_master; cur text; v_new int := 0; v_visas int := 0; v_services int := 0; n int;
  k_service text := 'Visa Registration';
begin
  perform business_setup_require('setup.import.manage');
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be a list'; end if;
  for e in select x from jsonb_array_elements(p_rows) x loop
    v_name := nullif(btrim(e ->> 'company'), '');
    v_person := nullif(btrim(e ->> 'person'), '');
    if v_name is null or v_person is null or nullif(e ->> 'source_key', '') is null then raise exception 'A row needs a company, a person and a key'; end if;
    v_client := nullif(e ->> 'client_id', '');
    if v_client is null then v_client := business_setup_import_exact(v_name); end if;
    if v_client is null then
      if exists (select 1 from client_master where business_setup_name_key(legal_name) = business_setup_name_key(v_name)) then
        raise exception 'More than one client is named %: give the row a client_id', v_name;
      end if;
      res := client_master_save(null, jsonb_build_object('Client Legal Name', v_name), null, true);
      v_client := res ->> 'id';
      v_new := v_new + 1;
    elsif not exists (select 1 from client_master where client_id = v_client) then
      raise exception 'Client % not found', v_client;
    end if;
    touched := array_append(touched, v_client);
    insert into business_setup_kyc_profiles (client_id, client_status) values (v_client, 'Active') on conflict (client_id) do nothing;
    v_issue := (e ->> 'issue_date')::date;
    v_expiry := (e ->> 'expiry_date')::date;
    v_update := nullif(btrim(e ->> 'update'), '');
    insert into business_setup_visas (client_id, person_name, occupation, issue_date, expiry_date, status, source, source_key)
    values (v_client, v_person, nullif(btrim(e ->> 'occupation'), ''), v_issue, v_expiry, v_update, 'visa_sheet', e ->> 'source_key')
    on conflict (source_key) do nothing;
    get diagnostics n = row_count;
    v_visas := v_visas + n;
    v_status := case when lower(coalesce(v_update, '')) in ('on going', 're-applying') then 'In progress' when v_issue is null then 'Not started' else 'Completed' end;
    insert into business_setup_services (client_id, name, status, historical, notes, completed_at, created_at, source_key)
    values (v_client, k_service, v_status, v_status = 'Completed', concat_ws('; ', v_person, nullif(btrim(e ->> 'occupation'), ''), 'From the visa sheet: ' || v_update),
            case when v_status = 'Completed' then v_issue::timestamptz end, coalesce(v_issue::timestamptz, now()), 'visa_sheet:' || (e ->> 'source_key'))
    on conflict (source_key) where source_key is not null do nothing;
    get diagnostics n = row_count;
    v_services := v_services + n;
  end loop;
  foreach c in array (select coalesce(array_agg(distinct t), '{}') from unnest(touched) t) loop
    update business_setup_kyc_profiles k set licence_extras = k.licence_extras
        || jsonb_build_object('service', case when nullif(btrim(k.licence_extras ->> 'service'), '') is null then k_service
                                              when k.licence_extras ->> 'service' ~* '\yVisa Registration\y' then k.licence_extras ->> 'service'
                                              else (k.licence_extras ->> 'service') || ', ' || k_service end)
        || case when nullif(btrim(k.licence_extras ->> 'visa'), '') is null
                then jsonb_build_object('visa', (select count(*) from business_setup_visas v where v.client_id = c) || ' Visa') else '{}'::jsonb end
      where k.client_id = c;
    select * into m from client_master where client_id = c for update;
    cur := client_master_plain(m.data ->> 'Services Provided');
    if coalesce(cur, '') !~* '\yVisa Registration\y' then
      perform client_master_save(c, jsonb_build_object('Client Legal Name', coalesce(client_master_plain(m.data ->> 'Client Legal Name'), m.legal_name),
                                                       'Services Provided', concat_ws('; ', nullif(btrim(cur), ''), k_service)), null, true);
    end if;
  end loop;
  perform business_setup_audit('business_setup_visas', 'visa_sheet', 'visa_sheet_apply', null, jsonb_build_object('visas', v_visas, 'services', v_services, 'new_clients', v_new));
  return jsonb_build_object('visas', v_visas, 'services', v_services, 'new_clients', v_new, 'clients', cardinality(array(select distinct t from unnest(touched) t)));
end $$;

revoke all on function public.business_setup_visa_sheet_apply(jsonb) from public, anon, authenticated;
grant execute on function public.business_setup_visa_sheet_apply(jsonb) to authenticated;
