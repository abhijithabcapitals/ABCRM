-- =====================================================================
-- Business Setup Base - leads, sharing the client link, ownership   014
-- =====================================================================
-- The functions behind the Leads screen (spec section 6): enter a lead, take it, create or link the client, share the
-- portal link, mark it lost, confirm or reassign the owner. Also lets a reviewer complete a client's form, lists cases
-- by view, closes a case when its last service closes, and keeps case documents inside Business Setup.
-- Run after 013. Re-runnable. Undo with rollback/013_019_rollback.sql.
-- hub_document_create is redefined from 013: run this file again whenever 004 or 013 is re-run.
-- =====================================================================

-- ── Reassignment requests (pattern of Banking Base 011) ──────────────
-- One pending request per case. The owner asks, a holder of setup.cases.approve decides.
create table if not exists public.business_setup_reassign_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.business_setup_cases(id),
  from_user uuid references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Refused', 'Cancelled')),
  created_at timestamptz not null default now(), created_by uuid default auth.uid(),
  responded_at timestamptz, responded_by uuid references public.profiles(id), response_note text
);
create unique index if not exists business_setup_reassign_one_pending on public.business_setup_reassign_requests (case_id) where status = 'Pending';
alter table public.business_setup_reassign_requests enable row level security;
drop policy if exists business_setup_reassign_read on public.business_setup_reassign_requests;
create policy business_setup_reassign_read on public.business_setup_reassign_requests for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_reassign_requests from anon, authenticated;
grant select on public.business_setup_reassign_requests to authenticated;

-- ── New lead ─────────────────────────────────────────────────────────
-- A client whose KYC is already done starts at Services (spec section 3); anyone else at Lead.
create or replace function public.business_setup_case_new(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := nullif(btrim(coalesce(p ->> 'lead_name', '')), ''); v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
        v_stage text := 'Lead'; v_id uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_name is null then raise exception 'Enter the lead name'; end if;
  if v_client is not null then
    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
    if exists (select 1 from business_setup_kyc_profiles where client_id = v_client and kyc_state = 'Done') then v_stage := 'Services'; end if;
  end if;
  insert into business_setup_cases (client_id, stage, source, lead_name, contact_person, phone, email, notes)
  values (v_client, v_stage, nullif(btrim(coalesce(p ->> 'source', '')), ''), v_name, nullif(btrim(coalesce(p ->> 'contact_person', '')), ''),
          nullif(btrim(coalesce(p ->> 'phone', '')), ''), nullif(btrim(coalesce(p ->> 'email', '')), ''), nullif(btrim(coalesce(p ->> 'notes', '')), ''))
  returning id into v_id;
  perform business_setup_audit('business_setup_cases', v_id::text, 'case_new', null, jsonb_build_object('stage', v_stage, 'lead_name', v_name, 'client_id', v_client));
  return v_id;
end $$;

-- ── Taking a case ────────────────────────────────────────────────────
-- Of two people taking one case, the row lock lets one win and tells the other who has it.
create or replace function public.business_setup_case_take(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.owner_id is not null then raise exception 'This case was already taken by %', business_setup_person_name(c.owner_id); end if;
  update business_setup_cases set owner_id = auth.uid() where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_take', null, jsonb_build_object('owner_id', auth.uid()));
  if c.stage = 'Assignment' then perform business_setup_case_set_stage(p_case, 'In service', 'The owner took the case'); end if;
end $$;

-- ── The client row ───────────────────────────────────────────────────
-- Creates the client from the lead fields through client_master_save, or links an existing one. A second call returns the
-- link already made, so a retry after a failed Share link never makes a second client.
create or replace function public.business_setup_case_link_client(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_client text := nullif(btrim(coalesce(p_client, '')), ''); r jsonb; v_data jsonb; v_dups text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.client_id is not null then
    if v_client is not null and v_client <> c.client_id then raise exception 'This case is already linked to client %', c.client_id; end if;
    return c.client_id;
  end if;
  if v_client is not null then
    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  else
    v_data := jsonb_strip_nulls(jsonb_build_object('Client Legal Name', c.lead_name, 'Primary Contact', c.contact_person, 'General Email', c.email, 'General Phone', c.phone));
    r := client_master_save(null, v_data, null, p_allow_duplicate);
    if not coalesce((r ->> 'ok')::boolean, false) then
      select string_agg((d ->> 'id') || ' ' || coalesce(d ->> 'name', '') || ' (same ' || (select string_agg(m, ', ') from jsonb_array_elements_text(d -> 'matches') m) || ')', '; ')
        into v_dups from jsonb_array_elements(r -> 'duplicates') d;
      raise exception 'A client like this already exists: %. Link that client, or confirm this is a new one.', coalesce(v_dups, 'see Client Master');
    end if;
    v_client := r ->> 'id';
  end if;
  update business_setup_cases set client_id = v_client where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_link_client', null, jsonb_build_object('client_id', v_client));
  return v_client;
end $$;

-- ── Share link ───────────────────────────────────────────────────────
-- Needs a client with an active login (issued with Settings > client login). Puts the client's open form on the case,
-- making one if the login has none and KYC is not done, and moves Lead to Contact, or to Services when KYC is done.
create or replace function public.business_setup_case_shared(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; f business_setup_onboarding_forms; v_acct uuid; v_done boolean; v_to text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.client_id is null then raise exception 'Link or create the client first'; end if;
  v_acct := business_setup_portal_account(c.client_id);
  if not exists (select 1 from client_portal_accounts where id = v_acct and status = 'active') then raise exception 'Issue an active client login first'; end if;
  v_done := exists (select 1 from business_setup_kyc_profiles where client_id = c.client_id and kyc_state = 'Done');
  select * into f from business_setup_onboarding_forms where client_id = c.client_id and status <> 'Validated' order by created_at desc limit 1 for update;
  if f.id is null and not v_done then
    perform business_setup_form_create(c.client_id, v_acct);
    select * into f from business_setup_onboarding_forms where client_id = c.client_id and status <> 'Validated' order by created_at desc limit 1 for update;
    if f.id is null then raise exception 'This client has no form to send'; end if;
  end if;
  if f.id is not null then
    if f.case_id is not null and f.case_id <> p_case then
      raise exception 'This client already has an open form on case %', (select case_number from business_setup_cases where id = f.case_id);
    end if;
    update business_setup_onboarding_forms set case_id = p_case where id = f.id and case_id is null;
  end if;
  if c.stage = 'Lead' then
    v_to := case when v_done then 'Services' when f.status in ('Submitted', 'In review') then 'Review' else 'Contact' end;
    perform business_setup_case_set_stage(p_case, v_to, 'The client link was shared');
  end if;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_shared', null, jsonb_build_object('client_id', c.client_id, 'form_id', f.id));
  perform business_setup_case_sync(p_case);
end $$;

-- ── Lost ─────────────────────────────────────────────────────────────
-- Refused with a net payment above zero or once the case reaches In service. The client's login is revoked only when
-- nothing else of theirs is open: the login is shared across the portal. This revoke is internal, so it does not need
-- setup.portal.manage; it does what business_setup_portal_login_status does.
create or replace function public.business_setup_case_lost(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_net numeric; v_acct uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_reason is null then raise exception 'Enter the reason this case is lost'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage = 'In service' then raise exception 'A case in service cannot be marked lost'; end if;
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) into v_net from business_setup_payments where case_id = p_case;
  if v_net > 0 then raise exception 'This case has a net payment of %: refund it before marking the case lost', v_net; end if;
  update business_setup_cases set lost_reason = v_reason where id = p_case;
  perform business_setup_case_set_stage(p_case, 'Lost', v_reason);
  if c.client_id is not null
     and not exists (select 1 from business_setup_cases where client_id = c.client_id and id <> p_case and stage not in ('Completed', 'Cancelled', 'Lost'))
     and not exists (select 1 from business_setup_services where client_id = c.client_id and status not in ('Completed', 'Cancelled'))
     and not exists (select 1 from banking_cases bc join banking_clients bk on bk.id = bc.client_id where bk.client_master_id = c.client_id and bc.outcome is null) then
    v_acct := business_setup_portal_account(c.client_id);
    update client_portal_accounts set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), failed_attempts = 0, locked_until = null where id = v_acct and status = 'active';
    if found then
      delete from client_portal_sessions where account_id = v_acct;
      perform business_setup_audit('client_portal_accounts', v_acct::text, 'login_revoke', null, jsonb_build_object('client_id', c.client_id, 'case_id', p_case));
    end if;
  end if;
end $$;

-- ── Owner confirms ───────────────────────────────────────────────────
create or replace function public.business_setup_case_confirm(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases;
begin
  perform business_setup_require('setup.access');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage <> 'Assignment' then raise exception 'Only a case at Assignment can be confirmed'; end if;
  if c.owner_id is null then raise exception 'This case has no owner yet: ask a manager to assign one'; end if;
  if c.owner_id <> auth.uid() and not business_setup_can('setup.cases.approve') then
    raise exception 'Only the owner (%) or a manager can confirm this case', business_setup_person_name(c.owner_id);
  end if;
  perform business_setup_case_set_stage(p_case, 'In service', 'Confirmed by ' || business_setup_person_name(auth.uid()));
end $$;

-- ── Direct change of owner, by an approver ───────────────────────────
create or replace function public.business_setup_case_assign(p_case uuid, p_to uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases;
begin
  perform business_setup_require('setup.cases.approve');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'Employee not found'; end if;
  update business_setup_cases set owner_id = p_to where id = p_case;
  -- A request made for the old owner no longer applies.
  update business_setup_reassign_requests set status = 'Cancelled', responded_at = now(), responded_by = auth.uid(), response_note = 'The case was assigned directly'
   where case_id = p_case and status = 'Pending';
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_assign', jsonb_build_object('owner_id', c.owner_id),
    jsonb_build_object('owner_id', p_to, 'note', nullif(btrim(coalesce(p_note, '')), '')));
end $$;

-- ── Reassignment requests ────────────────────────────────────────────
create or replace function public.business_setup_reassign_request(p_case uuid, p_to uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_id uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.owner_id is distinct from auth.uid() then raise exception 'Only the owner can ask for a reassignment: a manager can assign the case directly'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if p_to = c.owner_id then raise exception 'This case is already with that employee'; end if;
  if not exists (select 1 from profiles where id = p_to) then raise exception 'Employee not found'; end if;
  if v_reason is null then raise exception 'Enter the reason for the reassignment'; end if;
  if exists (select 1 from business_setup_reassign_requests where case_id = p_case and status = 'Pending') then raise exception 'A reassignment is already waiting for a manager'; end if;
  insert into business_setup_reassign_requests (case_id, from_user, to_user, reason) values (p_case, c.owner_id, p_to, v_reason) returning id into v_id;
  perform business_setup_audit('business_setup_cases', p_case::text, 'reassign_request', jsonb_build_object('owner_id', c.owner_id), jsonb_build_object('to_user', p_to, 'reason', v_reason));
  return v_id;
end $$;

create or replace function public.business_setup_reassign_respond(p_id uuid, p_approve boolean, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r business_setup_reassign_requests; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform business_setup_require('setup.cases.approve');
  select * into r from business_setup_reassign_requests where id = p_id for update;
  if r.id is null or r.status <> 'Pending' then raise exception 'This reassignment is no longer waiting'; end if;
  if p_approve and r.created_by is not distinct from auth.uid() then raise exception 'You cannot approve your own request: ask another manager'; end if;
  update business_setup_reassign_requests set status = case when p_approve then 'Approved' else 'Refused' end, responded_at = now(), responded_by = auth.uid(), response_note = v_note where id = p_id;
  if p_approve then
    update business_setup_cases set owner_id = r.to_user where id = r.case_id;
  end if;
  perform business_setup_audit('business_setup_cases', r.case_id::text, case when p_approve then 'reassign_approve' else 'reassign_refuse' end,
    jsonb_build_object('owner_id', r.from_user), jsonb_build_object('to_user', r.to_user, 'note', v_note));
end $$;

-- ── A reviewer completes the client's form ───────────────────────────
-- Only while the form is In review. Merges the given answers over the stored ones and audits old and new values.
create or replace function public.business_setup_form_staff_save(p_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms; v_old jsonb;
begin
  perform business_setup_require('setup.kyc.manage');
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'The form answers are not valid'; end if;
  select * into f from business_setup_onboarding_forms where id = p_id for update;
  if f.id is null then raise exception 'Form not found'; end if;
  if f.status <> 'In review' then raise exception 'Staff can complete a form only while it is In review'; end if;
  select coalesce(jsonb_object_agg(e.key, f.answers -> e.key) filter (where f.answers ? e.key), '{}'::jsonb) into v_old from jsonb_each(p_answers) e;
  update business_setup_onboarding_forms set answers = answers || p_answers, updated_at = now() where id = p_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_staff_save', jsonb_build_object('answers', v_old), jsonb_build_object('answers', p_answers));
end $$;

-- A document the reviewer holds for the client, in the same list as the client's own uploads. The file must already be in
-- storage at p_path. It is marked reviewed by the staff member and noted as staff-added, so it never looks client-sent.
create or replace function public.business_setup_form_doc_add(p_id uuid, p_kind text, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare f business_setup_onboarding_forms; v_kind text := nullif(btrim(coalesce(p_kind, '')), ''); v_path text := nullif(btrim(coalesce(p_path, '')), ''); v_id uuid;
begin
  perform business_setup_require('setup.kyc.manage');
  if v_kind is null then raise exception 'Choose the document kind'; end if;
  if v_path is null or v_path like '/%' or v_path like '%..%' then raise exception 'The file path is not valid'; end if;
  select * into f from business_setup_onboarding_forms where id = p_id for update;
  if f.id is null then raise exception 'Form not found'; end if;
  if f.status <> 'In review' then raise exception 'Staff can add documents only while the form is In review'; end if;
  insert into client_portal_documents (account_id, doc_type, note, file_name, storage_path, upload_complete, status, reviewed_by, reviewed_at, form_id)
  values (f.account_id, v_kind, 'Added by staff', regexp_replace(v_path, '^.*/', ''), v_path, true, 'validated', auth.uid(), now(), p_id) returning id into v_id;
  perform business_setup_audit('business_setup_onboarding_forms', p_id::text, 'form_doc_add', null, jsonb_build_object('document_id', v_id, 'doc_type', v_kind));
  return v_id;
end $$;

-- ── Case list ────────────────────────────────────────────────────────
-- leads: Lead, Contact, Review and Lost. documentation: Services, Documentation. cases: Assignment onward. all: everything.
-- Each row holds the case fields, the client name, the owner's name, the document checklist and any pending reassignment.
create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'leads' then array['Lead', 'Contact', 'Review', 'Lost']
    when 'documentation' then array['Services', 'Documentation']
    when 'cases' then array['Assignment', 'In service', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use leads, documentation, cases or all', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'docs', business_setup_case_docs(c.id),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages));
end $$;

-- ── Services close the case ──────────────────────────────────────────
-- When a service of a case's quote changes status, re-check the case: In service becomes Completed or Cancelled once every service is closed.
create or replace function public.business_setup_case_service_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid;
begin
  select case_id into v_case from hub_documents where id = new.quote_id;
  if v_case is not null then perform business_setup_case_sync(v_case); end if;
  return null;
end $$;
drop trigger if exists business_setup_case_service on public.business_setup_services;
create trigger business_setup_case_service after update of status on public.business_setup_services
  for each row when (new.quote_id is not null and new.status is distinct from old.status) execute function public.business_setup_case_service_trg();

-- ── Privileges ───────────────────────────────────────────────────────
revoke all on function public.business_setup_case_service_trg() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'business_setup_case_new(jsonb)', 'business_setup_case_take(uuid)', 'business_setup_case_link_client(uuid,text,boolean)', 'business_setup_case_shared(uuid)',
    'business_setup_case_lost(uuid,text)', 'business_setup_case_confirm(uuid)', 'business_setup_case_assign(uuid,uuid,text)',
    'business_setup_reassign_request(uuid,uuid,text)', 'business_setup_reassign_respond(uuid,boolean,text)',
    'business_setup_form_staff_save(uuid,jsonb)', 'business_setup_form_doc_add(uuid,text,text)', 'business_setup_case_list(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ── Creating documents ───────────────────────────────────────────────
-- As in 013, plus: a case_id is accepted only for a Business Setup document, and when both the document and the case
-- name a client they must be the same one. Other departments with no case_id behave exactly as before.

create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents; o hub_documents; v_id uuid := gen_random_uuid(); v_root uuid;
  v_client text := nullif(trim(p ->> 'client_id'), ''); v_revises uuid := nullif(p ->> 'revises_id', '')::uuid; v_template text := nullif(trim(p ->> 'template_key'), '');
  v_case uuid := nullif(p ->> 'case_id', '')::uuid; v_case_client text;
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
  end if;
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
  end loop;
  if v_mode = 'exclusive' then v_vat := round(v_net * v_rate / 100, 2); v_total := v_net + v_vat;
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
    -- It also stays in the old quote's case.
    if o.case_id is not null then
      if v_case is null then v_case := o.case_id;
      elsif v_case <> o.case_id then raise exception 'A revision must keep the case of the quote it replaces'; end if;
    end if;
  end if;
  if v_type = 'quote' then v_root := coalesce(o.root_quote_id, o.id, v_id); end if;
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type);
  elsif (p ->> 'parent_id') is not null then select document_number into v_number from hub_documents where id = (p ->> 'parent_id')::uuid;
  end if;
  insert into hub_documents (id, root_quote_id, parent_id, doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body, client_id, revises_id, template_key, case_id)
  values (v_id, v_root, (p ->> 'parent_id')::uuid, v_type, p ->> 'department', v_number, case when v_type in ('quote','letter') then hub_serial_of(p ->> 'department', v_type, v_number) end, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone', p ->> 'client_address', p ->> 'license_number', p ->> 'vat_trn',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), p -> 'lines', v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body', v_client, v_revises, v_template, v_case)
  returning * into r;
  if v_revises is not null then
    update hub_documents set status = 'superseded', status_at = now(), status_by = auth.uid(), status_reason = 'Revised by ' || r.document_number where id = v_revises;
  end if;
  return r;
end $$;
