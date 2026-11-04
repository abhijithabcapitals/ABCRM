-- =====================================================================
-- Business Setup Base - cases, stages and sync                       013
-- =====================================================================
-- A case is one client engagement: one lead, one quote revision chain and that quote's services. Its stage is moved
-- only by the functions below, in the same transaction as the event behind it (spec section 3). Adds case_id to
-- quotes and letters (hub_documents), payments and onboarding forms, the permissions for leads and case approval,
-- and gives every existing quote chain and form a case at the stage its records show.
-- Run after Business Setup Base 012. Re-runnable: the backfill only touches rows that have no case yet.
-- Undo with rollback/013_019_rollback.sql.
-- hub_document_create is defined by Template Hub Base 001 and Business Setup Base 004: run this file again whenever
-- either is re-run, or their older versions replace this one.
-- =====================================================================

-- ── Permissions ──────────────────────────────────────────────────────
-- 001 list plus setup.leads.manage (create and work leads) and setup.cases.approve (approve changes to a case).
create or replace function public.business_setup_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage',
    'setup.payments.manage', 'setup.payments.override', 'setup.services.manage', 'setup.services.override',
    'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'setup.settings.manage',
    'kyc.view', 'kyc.manage', 'setup.leads.manage', 'setup.cases.approve']
$$;

-- Added only when absent, so a role edited on the settings page keeps its choice on a re-run.
insert into public.business_setup_role_permissions (role, permission)
select r.role, p from (values
  ('ADMIN', array['setup.leads.manage', 'setup.cases.approve']),
  ('MANAGER', array['setup.leads.manage', 'setup.cases.approve']),
  ('SALES_EXECUTIVE', array['setup.leads.manage']),
  ('DOCUMENT_EXECUTIVE', array['setup.leads.manage'])
) as r(role, perms), unnest(r.perms) as p
on conflict (role, permission) do nothing;

-- ── The case table ───────────────────────────────────────────────────
create sequence if not exists public.business_setup_case_seq;
create table if not exists public.business_setup_cases (
  id uuid primary key default gen_random_uuid(),
  case_number text not null unique default ('BSC' || lpad(nextval('public.business_setup_case_seq')::text, 6, '0')),
  client_id text references public.client_master(client_id),   -- empty until the Share link makes the client row
  stage text not null default 'Lead' check (stage in ('Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service', 'Completed', 'Cancelled', 'Lost')),
  owner_id uuid references public.profiles(id),
  source text,
  bd_handover_id uuid unique,
  lead_name text,
  contact_person text,
  phone text,
  email text,
  notes text,
  lost_reason text,
  paid_override_reason text,
  invoice_override_reason text,
  created_at timestamptz not null default now(), created_by uuid,
  updated_at timestamptz not null default now(), updated_by uuid
);
create index if not exists business_setup_cases_client_idx on public.business_setup_cases (client_id) where client_id is not null;
create index if not exists business_setup_cases_stage_idx on public.business_setup_cases (stage);
create index if not exists business_setup_cases_owner_idx on public.business_setup_cases (owner_id) where owner_id is not null;

drop trigger if exists business_setup_cases_touch on public.business_setup_cases;
create trigger business_setup_cases_touch before insert or update on public.business_setup_cases
  for each row execute function public.business_setup_touch();

-- Read by anyone with module access. Writes only through functions (stage changes are audited by business_setup_case_set_stage).
alter table public.business_setup_cases enable row level security;
drop policy if exists business_setup_cases_read on public.business_setup_cases;
create policy business_setup_cases_read on public.business_setup_cases for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_cases from anon, authenticated;
grant select on public.business_setup_cases to authenticated;
revoke all on sequence public.business_setup_case_seq from anon, authenticated;

-- ── case_id on the records a case groups ─────────────────────────────
alter table public.hub_documents add column if not exists case_id uuid references public.business_setup_cases(id);
alter table public.business_setup_payments add column if not exists case_id uuid references public.business_setup_cases(id);
alter table public.business_setup_onboarding_forms add column if not exists case_id uuid references public.business_setup_cases(id);
create index if not exists hub_documents_case_idx on public.hub_documents (case_id) where case_id is not null;
create index if not exists business_setup_payments_case_idx on public.business_setup_payments (case_id) where case_id is not null;
create index if not exists business_setup_forms_case_idx on public.business_setup_onboarding_forms (case_id) where case_id is not null;

-- Payments stay append-only. The one allowed change is linking a row to a case when it has none (the backfill below).
create or replace function public.business_setup_payment_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and old.case_id is null and (to_jsonb(new) - 'case_id') = (to_jsonb(old) - 'case_id') then return new; end if;
  raise exception '% is append-only: add a new record instead of changing history', tg_table_name;
end $$;
drop trigger if exists business_setup_payments_immutable on public.business_setup_payments;
create trigger business_setup_payments_immutable before update or delete on public.business_setup_payments
  for each row execute function public.business_setup_payment_guard();

-- ── Moving a case ────────────────────────────────────────────────────
-- Internal: not callable from the API. Writes the audit entry for every stage change.
create or replace function public.business_setup_case_set_stage(p_case uuid, p_to text, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_from text;
begin
  select stage into v_from from business_setup_cases where id = p_case for update;
  if not found then raise exception 'Case not found'; end if;
  update business_setup_cases set stage = p_to where id = p_case;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_stage', jsonb_build_object('stage', v_from), jsonb_build_object('stage', p_to, 'note', p_note));
end $$;

-- What Documentation needs, worked out from the records (never stored). Internal.
-- In this phase "signed" is an accepted quote and the invoice is always met: later migrations redefine both.
create or replace function public.business_setup_case_docs(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_quote_total numeric; v_net numeric;
begin
  -- The accepted quote if there is one, else the newest quote that was not replaced.
  select total_amount into v_quote_total from hub_documents
   where case_id = p_case and doc_type = 'quote' and status <> 'superseded'
   order by (status = 'accepted') desc, created_at desc limit 1;
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) into v_net from business_setup_payments where case_id = p_case;
  return jsonb_build_object(
    'quote', v_quote_total is not null,
    'signed', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted'),
    'paid', coalesce(v_net > 0 or v_quote_total = 0, false),
    'letter', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'letter'),
    'invoice', true);
end $$;

-- Moves a case forward when its records say so, and never backward. Called by the triggers below.
--   Services -> Documentation   a quote that was not replaced exists
--   Documentation -> Assignment every item of business_setup_case_docs is met
--   In service -> Completed or Cancelled   every service is Completed or Cancelled; one Completed makes it Completed
-- Lead, Contact and Review follow the form; Assignment onward follow the owner and the checkpoints (later migrations).
create or replace function public.business_setup_case_sync(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage text; v_open int; v_done int; v_total int;
begin
  select stage into v_stage from business_setup_cases where id = p_case for update;
  if not found then return; end if;
  if v_stage = 'Services' and exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status <> 'superseded') then
    perform business_setup_case_set_stage(p_case, 'Documentation', 'A quote was issued');
    v_stage := 'Documentation';
  end if;
  if v_stage = 'Documentation' and not exists (select 1 from jsonb_each(business_setup_case_docs(p_case)) where value <> 'true'::jsonb) then
    perform business_setup_case_set_stage(p_case, 'Assignment', 'Quote, signature, payment, letter and invoice are in place');
    v_stage := 'Assignment';
  end if;
  if v_stage = 'In service' then
    select count(*), count(*) filter (where s.status not in ('Completed', 'Cancelled')), count(*) filter (where s.status = 'Completed') into v_total, v_open, v_done
      from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote');
    if v_total > 0 and v_open = 0 then
      perform business_setup_case_set_stage(p_case, case when v_done > 0 then 'Completed' else 'Cancelled' end, 'Every service is closed');
    end if;
  end if;
end $$;

-- ── Triggers ─────────────────────────────────────────────────────────
-- Forms: Submitted or In review -> Review, Returned -> Contact, Validated -> Services. Only a case still in Lead, Contact
-- or Review follows its form; a case already further on is left alone. Validating may also complete Services -> Documentation.
create or replace function public.business_setup_case_form_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_to text := case new.status when 'Submitted' then 'Review' when 'In review' then 'Review' when 'Returned' then 'Contact' when 'Validated' then 'Services' end;
        v_stage text;
begin
  if v_to is null then return null; end if;
  select stage into v_stage from business_setup_cases where id = new.case_id for update;
  if v_stage in ('Lead', 'Contact', 'Review') and v_stage <> v_to then
    perform business_setup_case_set_stage(new.case_id, v_to, 'Form ' || lower(new.status));
  end if;
  perform business_setup_case_sync(new.case_id);
  return null;
end $$;
drop trigger if exists business_setup_case_form on public.business_setup_onboarding_forms;
create trigger business_setup_case_form after update of status on public.business_setup_onboarding_forms
  for each row when (new.case_id is not null and new.status is distinct from old.status) execute function public.business_setup_case_form_trg();

-- Quotes and letters (hub_documents) and payments: re-check the case.
create or replace function public.business_setup_case_sync_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_case_sync(new.case_id);
  return null;
end $$;
drop trigger if exists business_setup_case_doc_ins on public.hub_documents;
create trigger business_setup_case_doc_ins after insert on public.hub_documents
  for each row when (new.case_id is not null) execute function public.business_setup_case_sync_trg();
drop trigger if exists business_setup_case_doc_status on public.hub_documents;
create trigger business_setup_case_doc_status after update of status on public.hub_documents
  for each row when (new.case_id is not null and new.status is distinct from old.status) execute function public.business_setup_case_sync_trg();
drop trigger if exists business_setup_case_payment on public.business_setup_payments;
create trigger business_setup_case_payment after insert on public.business_setup_payments
  for each row when (new.case_id is not null) execute function public.business_setup_case_sync_trg();

-- ── Creating documents ───────────────────────────────────────────────
-- As in Business Setup Base 004, plus case_id: taken from the request, inherited by a letter from its quote and by a
-- revision from the quote it replaces. Without a case_id every department behaves exactly as before.
create or replace function public.hub_document_create(p jsonb) returns public.hub_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents; o hub_documents; v_id uuid := gen_random_uuid(); v_root uuid;
  v_client text := nullif(trim(p ->> 'client_id'), ''); v_revises uuid := nullif(p ->> 'revises_id', '')::uuid; v_template text := nullif(trim(p ->> 'template_key'), '');
  v_case uuid := nullif(p ->> 'case_id', '')::uuid;
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

-- ── Privileges: internal functions are not callable from the API ─────
revoke all on function public.business_setup_case_set_stage(uuid, text, text), public.business_setup_case_docs(uuid), public.business_setup_case_sync(uuid),
  public.business_setup_case_form_trg(), public.business_setup_case_sync_trg(), public.business_setup_payment_guard() from public, anon, authenticated;

-- ── Backfill ─────────────────────────────────────────────────────────
-- Each Business Setup quote chain and each form without a case gets one, at the stage its records show:
--   every service closed -> Completed (one done) or Cancelled; any service started -> In service;
--   all Documentation items met -> Assignment; a quote that was not replaced -> Documentation;
--   a form: Validated -> Services, Submitted or In review -> Review, otherwise Contact; a client with nothing else -> Services.
-- Rows that already have a case are never touched, so running this again changes nothing.
do $$
declare r record; v_case uuid; v_new uuid[] := '{}'; v_stage text; v_total int; v_open int; v_done int; v_started int; v_form text;
begin
  -- A revision made after its chain got a case joins that case.
  update hub_documents d set case_id = root.case_id
    from hub_documents root
   where d.doc_type = 'quote' and d.department = 'Business Setup' and d.case_id is null and root.id = d.root_quote_id and root.case_id is not null;

  for r in select id, client_id, client_name, contact_name, contact_email, contact_phone from hub_documents
            where doc_type = 'quote' and department = 'Business Setup' and case_id is null and coalesce(root_quote_id, id) = id order by created_at, id loop
    insert into business_setup_cases (client_id, lead_name, contact_person, phone, email, source)
    values (r.client_id, r.client_name, r.contact_name, r.contact_phone, r.contact_email, 'Existing quote') returning id into v_case;
    v_new := v_new || v_case;
    update hub_documents set case_id = v_case where doc_type = 'quote' and (id = r.id or root_quote_id = r.id);
  end loop;
  -- A letter follows its quote; a payment follows the quote it was made against.
  update hub_documents l set case_id = q.case_id from hub_documents q
   where l.doc_type = 'letter' and l.department = 'Business Setup' and l.case_id is null and q.id = l.parent_id and q.case_id is not null;
  update business_setup_payments p set case_id = q.case_id from hub_documents q
   where p.case_id is null and q.id = p.quote_id and q.case_id is not null;

  -- A form joins the client's oldest case, or starts one.
  for r in select f.id, f.client_id, f.answers, m.legal_name from business_setup_onboarding_forms f join client_master m on m.client_id = f.client_id
            where f.case_id is null order by f.created_at, f.id loop
    v_case := (select id from business_setup_cases where client_id = r.client_id order by created_at, id limit 1);
    if v_case is null then
      insert into business_setup_cases (client_id, lead_name, phone, email, source)
      values (r.client_id, coalesce(nullif(r.answers ->> 'client_name', ''), r.legal_name), nullif(r.answers ->> 'phone', ''), nullif(r.answers ->> 'email', ''), 'Existing form') returning id into v_case;
      v_new := v_new || v_case;
    end if;
    update business_setup_onboarding_forms set case_id = v_case where id = r.id;
  end loop;

  -- Stage for the cases made just now only.
  foreach v_case in array v_new loop
    select count(*), count(*) filter (where s.status not in ('Completed', 'Cancelled')), count(*) filter (where s.status = 'Completed'), count(*) filter (where s.status <> 'Not started')
      into v_total, v_open, v_done, v_started
      from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = v_case and doc_type = 'quote');
    select status into v_form from business_setup_onboarding_forms where case_id = v_case order by created_at desc, id desc limit 1;
    v_stage := case
      when v_total > 0 and v_open = 0 then case when v_done > 0 then 'Completed' else 'Cancelled' end
      when v_started > 0 then 'In service'
      when not exists (select 1 from jsonb_each(business_setup_case_docs(v_case)) where value <> 'true'::jsonb) then 'Assignment'
      when exists (select 1 from hub_documents where case_id = v_case and doc_type = 'quote' and status <> 'superseded') then 'Documentation'
      when v_form = 'Validated' then 'Services'
      when v_form in ('Submitted', 'In review') then 'Review'
      when v_form is not null then 'Contact'
      when (select client_id from business_setup_cases where id = v_case) is not null then 'Services'
      else 'Lead' end;
    if v_stage <> 'Lead' then perform business_setup_case_set_stage(v_case, v_stage, 'Backfilled from existing records'); end if;
  end loop;
end $$;
