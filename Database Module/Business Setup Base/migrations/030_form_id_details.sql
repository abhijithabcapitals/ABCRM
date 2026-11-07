-- =====================================================================
-- Business Setup Base - the client's ID details and shareholder IDs reach KYC on validation   030
-- =====================================================================
-- Staff can now complete the client's Emirates ID, passport, nationality, date of birth and address on the form,
-- and every shareholder's Emirates ID and passport number. Validation copies them into KYC:
-- the client's into the KYC profile details (a value already held stays), each shareholder's into its new KYC partner.
-- Only business_setup_form_validate changes; the rest is 009 unchanged.
-- Runs after 009. Re-runnable. Undo with rollback/030_rollback.sql.
-- =====================================================================

create or replace function public.business_setup_form_validate(p_id uuid, p_contact jsonb, p_version integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f business_setup_onboarding_forms; m client_master; a jsonb; miss text[]; e jsonb; kid uuid;
  v_email text; v_phone text; v_old_email text; v_old_phone text; v_name text; v_data jsonb;
  k business_setup_kyc_profiles; v_new jsonb; v_key text; v_kept text[] := '{}';
begin
  perform business_setup_require('setup.kyc.manage');
  p_contact := coalesce(p_contact, '{}'::jsonb);
  select * into f from business_setup_onboarding_forms where id = p_id for update;
  if f.id is null then raise exception 'Form not found'; end if;
  if f.status = 'Validated' then raise exception 'This form was already validated by %', business_setup_person_name(f.reviewed_by); end if;
  if f.status not in ('Submitted', 'In review') then raise exception 'Only a submitted form can be validated'; end if;
  miss := business_setup_form_missing_items(p_id, true);
  if cardinality(miss) > 0 then raise exception 'Still missing: %', array_to_string(miss, ', '); end if;

  a := f.answers;
  select * into m from client_master where client_id = f.client_id for update;
  if p_version is not null and p_version <> m.version then raise exception 'Someone else changed this client. Reopen the form and try again.'; end if;
  v_old_email := client_master_plain(m.data ->> 'General Email');
  v_old_phone := client_master_plain(m.data ->> 'General Phone');
  v_email := nullif(btrim(coalesce(p_contact ->> 'email', '')), '');
  v_phone := nullif(btrim(coalesce(p_contact ->> 'phone', '')), '');
  if v_email is null then
    if v_old_email is not null and v_old_email <> btrim(a ->> 'email') then raise exception 'Client Master holds a different email: choose which to keep'; end if;
    v_email := btrim(a ->> 'email');
  end if;
  if v_phone is null then
    if v_old_phone is not null and v_old_phone <> btrim(a ->> 'phone') then raise exception 'Client Master holds a different phone: choose which to keep'; end if;
    v_phone := btrim(a ->> 'phone');
  end if;
  v_name := btrim(a ->> 'client_name');
  v_data := jsonb_build_object('Client Legal Name', coalesce(client_master_plain(m.data ->> 'Client Legal Name'), m.legal_name), 'General Email', v_email, 'General Phone', v_phone);
  if client_master_plain(split_part(coalesce(m.data ->> 'Primary Contact', ''), ';', 1)) is null then v_data := v_data || jsonb_build_object('Primary Contact', v_name); end if;
  perform client_master_save(f.client_id, v_data, null);

  -- The form fills what is empty. A value already held stays, and its name goes in the audit log for staff to compare.
  select * into k from business_setup_kyc_profiles where client_id = f.client_id;
  v_new := jsonb_strip_nulls(jsonb_build_object('company_status', a ->> 'company_status', 'business_activity', nullif(btrim(coalesce(a ->> 'activity', '')), ''), 'jurisdiction', nullif(btrim(coalesce(a ->> 'zone', '')), ''),
    'licence_number', nullif(btrim(coalesce(a ->> 'licence_number', '')), ''), 'licence_expiry', a ->> 'licence_expiry'));
  for v_key in select key from jsonb_each(v_new) loop
    if to_jsonb(k) ->> v_key is not null then
      if to_jsonb(k) ->> v_key <> v_new ->> v_key then v_kept := array_append(v_kept, v_key); end if;
      v_new := v_new - v_key;
    end if;
  end loop;
  perform business_setup_kyc_save(f.client_id, v_new || jsonb_build_object('details', jsonb_strip_nulls(jsonb_build_object('issuing_authority', coalesce(k.details ->> 'issuing_authority', a ->> 'issuing_authority'), 'services', a -> 'services',
    'emirates_id', coalesce(k.details ->> 'emirates_id', nullif(btrim(coalesce(a ->> 'emirates_id', '')), '')), 'emirates_id_expiry', coalesce(k.details ->> 'emirates_id_expiry', nullif(a ->> 'emirates_id_expiry', '')),
    'passport_number', coalesce(k.details ->> 'passport_number', nullif(btrim(coalesce(a ->> 'passport_number', '')), '')), 'passport_expiry', coalesce(k.details ->> 'passport_expiry', nullif(a ->> 'passport_expiry', '')),
    'nationality', coalesce(k.details ->> 'nationality', nullif(btrim(coalesce(a ->> 'nationality', '')), '')), 'date_of_birth', coalesce(k.details ->> 'date_of_birth', nullif(a ->> 'date_of_birth', '')),
    'address', coalesce(k.details ->> 'address', nullif(btrim(coalesce(a ->> 'address', '')), ''))))));
  select id into kid from business_setup_kyc_profiles where client_id = f.client_id;
  for e in select * from jsonb_array_elements(a -> 'partners') loop
    if nullif(btrim(coalesce(e ->> 'name', '')), '') is not null
       and not exists (select 1 from business_setup_kyc_partners p where p.kyc_id = kid and p.deleted_at is null and lower(p.full_name) = lower(btrim(e ->> 'name'))) then
      perform business_setup_partner_save(f.client_id, jsonb_build_object('full_name', e ->> 'name', 'nationality', e ->> 'nationality', 'share_percent', e ->> 'share', 'is_ubo', coalesce((e ->> 'ubo')::boolean, false),
        'emirates_id', nullif(btrim(coalesce(e ->> 'emirates_id', '')), ''), 'passport_number', nullif(btrim(coalesce(e ->> 'passport_number', '')), '')));
    end if;
  end loop;
  update business_setup_kyc_profiles set kyc_state = 'Done' where id = kid;
  update business_setup_onboarding_forms set status = 'Validated', reviewed_by = auth.uid(), reviewed_at = now(), return_note = null, updated_at = now() where id = p_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_validate', null, jsonb_build_object('client_id', f.client_id, 'kept', to_jsonb(v_kept)));
end $$;
