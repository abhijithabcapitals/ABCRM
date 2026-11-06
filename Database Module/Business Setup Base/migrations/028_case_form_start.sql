-- =====================================================================
-- Business Setup Base - a client form started by staff dropping files   028
-- =====================================================================
-- Client Onboarding's Fields and documents panel takes a drag and drop of the client's files before any login is issued. A case with no
-- form gets one on the first drop: In review, taken by the person dropping, with no login, so the files are stored on it and the reader
-- fills its empty fields. When the login is issued later, 019's trigger joins this form and its files to the login.
-- Runs after 019. Re-runnable. Undo with rollback/028_rollback.sql.
-- =====================================================================

-- Returns the case's form id. A form the case already has is returned as it is. The client's open form (one per client, 009) is linked to the
-- case; one nobody can edit (no login, Draft or Submitted) is taken for review. Otherwise a new form is made.
create or replace function public.business_setup_case_form_start(p_case uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; f business_setup_onboarding_forms; v_id uuid;
begin
  perform business_setup_require('setup.kyc.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.client_id is null then raise exception 'Link the client to this case first'; end if;
  select id into v_id from business_setup_onboarding_forms where case_id = p_case order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;
  select * into f from business_setup_onboarding_forms where client_id = c.client_id and status <> 'Validated' for update;
  if f.id is not null then
    update business_setup_onboarding_forms set case_id = coalesce(case_id, p_case) where id = f.id;
    if f.account_id is null and f.status in ('Draft', 'Submitted') then
      update business_setup_onboarding_forms set status = 'In review', taken_by = auth.uid(), taken_at = now(), updated_at = now() where id = f.id;
    end if;
    v_id := f.id;
  else
    insert into business_setup_kyc_profiles (client_id) values (c.client_id) on conflict (client_id) do nothing;
    insert into business_setup_onboarding_forms (client_id, account_id, form_version, status, taken_by, taken_at, case_id)
    values (c.client_id, business_setup_portal_account(c.client_id), (select max(version) from business_setup_form_versions), 'In review', auth.uid(), now(), p_case)
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_onboarding_forms', v_id::text, 'form_staff_start', null, jsonb_build_object('case_id', p_case, 'client_id', c.client_id));
  perform business_setup_case_sync(p_case);
  return v_id;
end $$;
revoke all on function public.business_setup_case_form_start(uuid) from public, anon;
grant execute on function public.business_setup_case_form_start(uuid) to authenticated;
