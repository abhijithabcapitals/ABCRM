-- =====================================================================
-- Business Setup Base - client form and validation                     009
-- =====================================================================
-- Re-runnable. Runs after 001 to 008 and Client Base 003. A client login creates one form. The client fills it in
-- through the portal; staff take it, return it or validate it. Typed values reach Client Master only on validation.
-- Re-running Client Base 003 resets client_inputs_can, so re-running it means re-running this file.
-- =====================================================================

create table if not exists public.business_setup_form_versions (
  version int primary key,
  definition jsonb not null,
  created_at timestamptz not null default now()
);
insert into public.business_setup_form_versions (version, definition) values (1, $json${
  "version": 1,
  "sections": [
    {"key": "contact", "title": "Contact", "fields": [
      {"key": "client_name", "label": "Client name", "type": "text", "required": true},
      {"key": "phone", "label": "Phone", "type": "tel", "required": true},
      {"key": "email", "label": "Email", "type": "email", "required": true}]},
    {"key": "request", "title": "Request", "fields": [
      {"key": "services", "label": "Services wanted", "type": "multi", "required": true, "options": ["Company registration", "Company deregistration", "Visa", "AML", "Ejari", "Emirates ID", "Tenancy contract", "Utility bill", "Passport", "KYC", "Renewal", "Other"]},
      {"key": "company_status", "label": "Company status", "type": "choice", "required": true, "options": ["New", "Existing"]},
      {"key": "activity", "label": "Proposed or current business activity", "type": "text", "required": true},
      {"key": "zone", "label": "Preferred zone", "type": "text"}]},
    {"key": "existing", "title": "Existing company", "show_when": {"company_status": "Existing"}, "fields": [
      {"key": "licence_number", "label": "Licence number", "type": "text", "required": true},
      {"key": "licence_expiry", "label": "Licence expiry", "type": "date", "required": true},
      {"key": "issuing_authority", "label": "Issuing authority", "type": "text", "required": true}]},
    {"key": "partners", "title": "Partners", "type": "repeat", "required": true, "fields": [
      {"key": "name", "label": "Name", "type": "text", "required": true},
      {"key": "nationality", "label": "Nationality", "type": "text", "required": true},
      {"key": "share", "label": "Share %", "type": "number"},
      {"key": "ubo", "label": "Ultimate beneficial owner", "type": "boolean"}]}
  ],
  "documents": [
    {"group": "Current documents", "types": [{"type": "Passport", "required": true}, {"type": "Emirates visa"}, {"type": "Emirates ID"}]},
    {"group": "Address proof", "one_of": true, "required": true, "types": [{"type": "Ejari"}, {"type": "Bank statement"}, {"type": "Utility bill"}]},
    {"group": "Renewal documents", "show_when": {"services_has": "Renewal"}, "types": [{"type": "Old visa"}, {"type": "Old Emirates ID"}, {"type": "Other"}]}
  ]
}$json$::jsonb)
on conflict (version) do nothing;

create table if not exists public.business_setup_onboarding_forms (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  account_id uuid not null references public.client_portal_accounts(id),
  form_version int not null references public.business_setup_form_versions(version),
  answers jsonb not null default '{}',
  status text not null default 'Draft' check (status in ('Draft', 'Submitted', 'In review', 'Returned', 'Validated')),
  submitted_at timestamptz,
  taken_by uuid references public.profiles(id),
  taken_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  return_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists business_setup_one_open_form on public.business_setup_onboarding_forms (client_id) where status <> 'Validated';
create index if not exists business_setup_forms_account_idx on public.business_setup_onboarding_forms (account_id);
alter table public.client_portal_documents add column if not exists form_id uuid references public.business_setup_onboarding_forms(id);
create index if not exists client_portal_documents_form on public.client_portal_documents (form_id) where form_id is not null;

alter table public.business_setup_form_versions enable row level security;
alter table public.business_setup_onboarding_forms enable row level security;
drop policy if exists business_setup_form_versions_read on public.business_setup_form_versions;
create policy business_setup_form_versions_read on public.business_setup_form_versions for select to authenticated using (public.business_setup_can('setup.access'));
drop policy if exists business_setup_forms_read on public.business_setup_onboarding_forms;
create policy business_setup_forms_read on public.business_setup_onboarding_forms for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_form_versions, public.business_setup_onboarding_forms from anon, authenticated;
grant select on public.business_setup_form_versions, public.business_setup_onboarding_forms to authenticated;

-- ── A login creates the form ─────────────────────────────────────────
-- A client whose KYC is already done (imported from the old CRM, or validated before) has nothing to fill in.
create or replace function public.business_setup_form_for_account() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text := new.client_master_id;
begin
  if v_client is null and new.banking_client_id is not null then
    select client_master_id into v_client from banking_clients where id = new.banking_client_id;
  end if;
  if v_client is null then return new; end if;
  insert into business_setup_kyc_profiles (client_id) values (v_client) on conflict (client_id) do nothing;
  if exists (select 1 from business_setup_kyc_profiles where client_id = v_client and kyc_state = 'Done')
     or exists (select 1 from business_setup_onboarding_forms where client_id = v_client) then
    return new;
  end if;
  insert into business_setup_onboarding_forms (client_id, account_id, form_version)
  values (v_client, new.id, (select max(version) from business_setup_form_versions));
  return new;
end $$;
drop trigger if exists business_setup_form_on_account on public.client_portal_accounts;
create trigger business_setup_form_on_account after insert on public.client_portal_accounts
  for each row execute function public.business_setup_form_for_account();

-- ── What is still missing ────────────────────────────────────────────
-- p_validated false: a document counts once uploaded and not rejected (what submitting needs).
-- p_validated true: a document counts only once validated (what staff validation needs).
create or replace function public.business_setup_form_missing_items(p_id uuid, p_validated boolean) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a jsonb; miss text[] := '{}'; v_has boolean;
begin
  select answers into a from business_setup_onboarding_forms where id = p_id;
  if a is null then raise exception 'Form not found'; end if;
  if nullif(btrim(coalesce(a ->> 'client_name', '')), '') is null then miss := miss || 'Client name'::text; end if;
  if nullif(btrim(coalesce(a ->> 'phone', '')), '') is null then miss := miss || 'Phone'::text; end if;
  if nullif(btrim(coalesce(a ->> 'email', '')), '') is null then miss := miss || 'Email'::text; end if;
  if jsonb_typeof(a -> 'services') is distinct from 'array' or jsonb_array_length(a -> 'services') = 0 then miss := miss || 'Services wanted'::text; end if;
  if coalesce(a ->> 'company_status', '') not in ('New', 'Existing') then miss := miss || 'Company status'::text; end if;
  if nullif(btrim(coalesce(a ->> 'activity', '')), '') is null then miss := miss || 'Business activity'::text; end if;
  if a ->> 'company_status' = 'Existing' then
    if nullif(btrim(coalesce(a ->> 'licence_number', '')), '') is null then miss := miss || 'Licence number'::text; end if;
    if coalesce(a ->> 'licence_expiry', '') !~ '^\d{4}-\d{2}-\d{2}$' then miss := miss || 'Licence expiry'::text; end if;
    if nullif(btrim(coalesce(a ->> 'issuing_authority', '')), '') is null then miss := miss || 'Issuing authority'::text; end if;
  end if;
  v_has := jsonb_typeof(a -> 'partners') = 'array' and exists (select 1 from jsonb_array_elements(a -> 'partners') e
             where nullif(btrim(coalesce(e ->> 'name', '')), '') is not null and nullif(btrim(coalesce(e ->> 'nationality', '')), '') is not null);
  if not coalesce(v_has, false) then miss := miss || 'Partner'::text; end if;
  if not exists (select 1 from client_portal_documents d where d.form_id = p_id and d.upload_complete and d.doc_type = 'Passport'
                  and (case when p_validated then d.status = 'validated' else d.status <> 'rejected' end)) then
    miss := miss || 'Passport'::text;
  end if;
  if not exists (select 1 from client_portal_documents d where d.form_id = p_id and d.upload_complete and d.doc_type in ('Ejari', 'Bank statement', 'Utility bill')
                  and (case when p_validated then d.status = 'validated' else d.status <> 'rejected' end)) then
    miss := miss || 'Address proof'::text;
  end if;
  return miss;
end $$;

-- ── Called by the client-portal Edge Function only ───────────────────
create or replace function public.business_setup_form_get(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', f.id, 'status', f.status, 'answers', f.answers, 'return_note', case when f.status = 'Returned' then f.return_note end,
           'submitted_at', f.submitted_at, 'definition', v.definition,
           'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name, 'status', d.status,
                            'review_note', case when d.status = 'rejected' then d.review_note end) order by d.uploaded_at), '[]'::jsonb)
                           from client_portal_documents d where d.form_id = f.id and d.upload_complete))
    from business_setup_onboarding_forms f join business_setup_form_versions v on v.version = f.form_version
   where f.account_id = p_account order by f.created_at desc limit 1
$$;

create or replace function public.business_setup_form_save(p_account uuid, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms;
begin
  select * into f from business_setup_onboarding_forms where account_id = p_account order by created_at desc limit 1 for update;
  if f.id is null then raise exception 'There is no form for this login'; end if;
  if f.status not in ('Draft', 'Returned') then raise exception 'This form has been submitted and cannot be changed'; end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'The form answers are not valid'; end if;
  update business_setup_onboarding_forms set answers = p_answers, updated_at = now() where id = f.id;
  return business_setup_form_get(p_account);
end $$;

create or replace function public.business_setup_form_submit(p_account uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms; miss text[];
begin
  select * into f from business_setup_onboarding_forms where account_id = p_account order by created_at desc limit 1 for update;
  if f.id is null then raise exception 'There is no form for this login'; end if;
  if f.status not in ('Draft', 'Returned') then raise exception 'This form has already been submitted'; end if;
  miss := business_setup_form_missing_items(f.id, false);
  if cardinality(miss) > 0 then raise exception 'Please complete: %', array_to_string(miss, ', '); end if;
  update business_setup_onboarding_forms set status = 'Submitted', submitted_at = now(), return_note = null, taken_by = null, taken_at = null, updated_at = now() where id = f.id;
  perform business_setup_audit('business_setup_onboarding_forms', f.id::text, 'form_submit', null, jsonb_build_object('client_id', f.client_id));
  return business_setup_form_get(p_account);
end $$;

-- ── Staff ────────────────────────────────────────────────────────────
create or replace function public.business_setup_person_name(p_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select coalesce(to_jsonb(p) ->> 'full_name', to_jsonb(p) ->> 'email') from profiles p where p.id = p_id), 'someone else')
$$;

create or replace function public.business_setup_form_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'client_id', f.client_id, 'legal_name', m.legal_name, 'status', f.status, 'submitted_at', f.submitted_at,
             'taken_by', case when f.taken_by is not null then business_setup_person_name(f.taken_by) end, 'return_note', f.return_note,
             'missing', to_jsonb(business_setup_form_missing_items(f.id, true))) order by f.submitted_at nulls last, f.created_at), '[]'::jsonb)
    from business_setup_onboarding_forms f join client_master m on m.client_id = f.client_id
   where p_status is null or f.status = p_status);
end $$;

create or replace function public.business_setup_form_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms; m client_master;
begin
  perform business_setup_require('setup.access');
  select * into f from business_setup_onboarding_forms where id = p_id;
  if f.id is null then raise exception 'Form not found'; end if;
  select * into m from client_master where client_id = f.client_id;
  return jsonb_build_object('id', f.id, 'client_id', f.client_id, 'legal_name', m.legal_name, 'status', f.status, 'answers', f.answers, 'return_note', f.return_note,
    'submitted_at', f.submitted_at, 'taken_by', case when f.taken_by is not null then business_setup_person_name(f.taken_by) end,
    'master_version', m.version, 'master_email', client_master_plain(m.data ->> 'General Email'), 'master_phone', client_master_plain(m.data ->> 'General Phone'),
    'missing', to_jsonb(business_setup_form_missing_items(f.id, true)),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'doc_type', d.doc_type, 'file_name', d.file_name, 'status', d.status, 'review_note', d.review_note,
                     'upload_complete', d.upload_complete, 'assigned_to', d.assigned_to) order by d.uploaded_at), '[]'::jsonb)
                    from client_portal_documents d where d.form_id = f.id));
end $$;

-- Of two people clicking together, one gets the form and the other is told who has it.
create or replace function public.business_setup_form_take(p_id uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms;
begin
  perform business_setup_require('setup.kyc.manage');
  select * into f from business_setup_onboarding_forms where id = p_id for update;
  if f.id is null then raise exception 'Form not found'; end if;
  if f.status = 'In review' then raise exception 'This form is already taken by %', business_setup_person_name(f.taken_by); end if;
  if f.status <> 'Submitted' then raise exception 'Only a submitted form can be taken'; end if;
  update business_setup_onboarding_forms set status = 'In review', taken_by = auth.uid(), taken_at = now(), updated_at = now() where id = p_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_take', null, jsonb_build_object('client_id', f.client_id));
end $$;

create or replace function public.business_setup_form_return(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform business_setup_require('setup.kyc.manage');
  if v_note is null then raise exception 'Write a note telling the client what to fix'; end if;
  select * into f from business_setup_onboarding_forms where id = p_id for update;
  if f.id is null then raise exception 'Form not found'; end if;
  if f.status not in ('Submitted', 'In review') then raise exception 'Only a submitted form can be returned'; end if;
  update business_setup_onboarding_forms set status = 'Returned', return_note = v_note, updated_at = now() where id = p_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_return', null, jsonb_build_object('client_id', f.client_id, 'note', v_note));
end $$;

-- One transaction: contact to Client Master, KYC profile and partners, KYC done.
-- p_contact holds staff's choice of email and phone; without one, the form's value is used unless Client Master already differs.
create or replace function public.business_setup_form_validate(p_id uuid, p_contact jsonb, p_version integer) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f business_setup_onboarding_forms; m client_master; a jsonb; miss text[]; e jsonb; kid uuid;
  v_email text; v_phone text; v_old_email text; v_old_phone text; v_name text; v_data jsonb;
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

  perform business_setup_kyc_save(f.client_id, jsonb_build_object('company_status', a ->> 'company_status', 'business_activity', a ->> 'activity', 'jurisdiction', a ->> 'zone',
    'licence_number', a ->> 'licence_number', 'licence_expiry', a ->> 'licence_expiry', 'details', jsonb_strip_nulls(jsonb_build_object('issuing_authority', a ->> 'issuing_authority', 'services', a -> 'services'))));
  select id into kid from business_setup_kyc_profiles where client_id = f.client_id;
  for e in select * from jsonb_array_elements(a -> 'partners') loop
    if nullif(btrim(coalesce(e ->> 'name', '')), '') is not null
       and not exists (select 1 from business_setup_kyc_partners p where p.kyc_id = kid and p.deleted_at is null and lower(p.full_name) = lower(btrim(e ->> 'name'))) then
      perform business_setup_partner_save(f.client_id, jsonb_build_object('full_name', e ->> 'name', 'nationality', e ->> 'nationality', 'share_percent', e ->> 'share', 'is_ubo', coalesce((e ->> 'ubo')::boolean, false)));
    end if;
  end loop;
  update business_setup_kyc_profiles set kyc_state = 'Done' where id = kid;
  update business_setup_onboarding_forms set status = 'Validated', reviewed_by = auth.uid(), reviewed_at = now(), return_note = null, updated_at = now() where id = p_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_validate', null, jsonb_build_object('client_id', f.client_id));
end $$;

create or replace function public.business_setup_form_missing(p_id uuid) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return business_setup_form_missing_items(p_id, true);
end $$;

-- Setup staff who validate forms also review the uploaded documents, as in Client Inputs.
create or replace function public.client_inputs_can() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select client_portal_is_admin() or business_setup_can('setup.kyc.manage') or exists (select 1 from member_tab_access where profile_id = auth.uid() and tab_key = 'clients')
$$;

create or replace function public.business_setup_dash_forms() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from business_setup_onboarding_forms where status in ('Submitted', 'In review')
$$;

revoke all on function public.business_setup_form_for_account(), public.business_setup_form_missing_items(uuid, boolean), public.business_setup_person_name(uuid),
  public.business_setup_form_get(uuid), public.business_setup_form_save(uuid, jsonb), public.business_setup_form_submit(uuid),
  public.business_setup_form_list(text), public.business_setup_form_detail(uuid), public.business_setup_form_take(uuid), public.business_setup_form_return(uuid, text),
  public.business_setup_form_validate(uuid, jsonb, integer), public.business_setup_form_missing(uuid), public.business_setup_dash_forms() from public, anon, authenticated;
grant execute on function public.business_setup_form_get(uuid), public.business_setup_form_save(uuid, jsonb), public.business_setup_form_submit(uuid) to service_role;
grant execute on function public.business_setup_form_list(text), public.business_setup_form_detail(uuid), public.business_setup_form_take(uuid), public.business_setup_form_return(uuid, text),
  public.business_setup_form_validate(uuid, jsonb, integer), public.business_setup_form_missing(uuid) to authenticated;
