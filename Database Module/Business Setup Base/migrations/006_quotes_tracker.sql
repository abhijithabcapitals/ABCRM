-- =====================================================================
-- Business Setup Base - quote lifecycle and service tracker            004
-- =====================================================================
-- Re-runnable. Runs after 003, 004 and 005. Accept, reject, link and sign change hub_documents through these
-- functions only; the tracker lines come from the accepted quote. No client data and no prices live in this file.
-- Each function writes one business_setup_audit_log row. Identity numbers never reach it.
-- =====================================================================

-- ── Tracker columns and rules ────────────────────────────────────────
alter table public.business_setup_services add column if not exists action text not null default 'New';
alter table public.business_setup_services add column if not exists owner_id uuid references public.profiles(id);
alter table public.business_setup_services add column if not exists start_date date;
alter table public.business_setup_services add column if not exists expiry_date date;
alter table public.business_setup_services add column if not exists started_at timestamptz;          -- first move to In progress
alter table public.business_setup_services add column if not exists output_details jsonb not null default '{}';   -- what staff recorded on completion
alter table public.business_setup_services add column if not exists historical boolean not null default false;     -- imported from the old workbooks
alter table public.business_setup_services add column if not exists locked boolean not null default false;        -- held by Accounts; enforced by the handover functions

-- The one list of statuses, used by the check below and by the tracker functions.
create or replace function public.business_setup_status_allowed(p_status text) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select p_status in ('Not started', 'In progress', 'Waiting on client', 'Waiting on government', 'Completed', 'Cancelled')
$$;
alter table public.business_setup_services drop constraint if exists business_setup_services_status_check;
alter table public.business_setup_services add constraint business_setup_services_status_check
  check (public.business_setup_status_allowed(status));
alter table public.business_setup_services drop constraint if exists business_setup_services_action_check;
alter table public.business_setup_services add constraint business_setup_services_action_check
  check (action in ('New','Renewal','Rectification','Cancellation'));
create index if not exists business_setup_services_quote_idx on public.business_setup_services (quote_id) where quote_id is not null;

-- ── Accept ───────────────────────────────────────────────────────────
-- Creates one tracker line per quote line. The root quote of the revision chain is locked first, and a partial
-- unique index (004) backs this up, so two people cannot both accept quotes of the same chain.
create or replace function public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
  v_root := coalesce(q.root_quote_id, q.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
    raise exception 'A quote in this revision chain is already accepted';
  end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
  kyc := business_setup_kyc_status(q.client_id);
  if (kyc ->> 'percent')::int < 100 then
    raise exception 'The client KYC is incomplete: missing %', (select string_agg(m, ', ') from jsonb_array_elements_text(kyc -> 'missing') m);
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;

  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(),
         status_reason = case when q.valid_until is not null and q.valid_until < v_today then 'Accepted after expiry' else null end
   where id = q.id;

  for ln in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
    v_name := coalesce(nullif(btrim(coalesce(ln ->> 'service_name', '')), ''), nullif(btrim(coalesce(ln ->> 'description', '')), ''));
    if v_name is null then raise exception 'Every quote line needs a service name'; end if;
    v_action := coalesce(nullif(btrim(coalesce(ln ->> 'action', '')), ''), 'New');
    if v_action not in ('New','Renewal','Rectification','Cancellation') then raise exception 'Unknown action % on a quote line', v_action; end if;
    v_renews := nullif(ln ->> 'renews_service_id', '')::uuid;
    if v_renews is not null and not exists (select 1 from business_setup_services where id = v_renews and client_id = q.client_id) then
      raise exception 'A renewal must link to an earlier service of the same client';
    end if;
    v_fee := nullif(ln ->> 'fee_item_id', '')::uuid;
    insert into business_setup_services (client_id, quote_id, fee_item_id, name, action, amount, renews_service_id)
    values (q.client_id, q.id, v_fee, v_name, v_action, nullif(ln ->> 'amount', '')::numeric, v_renews)
    returning id into v_svc;
    insert into business_setup_service_history (service_id, from_status, to_status, note)
    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);
    n := n + 1;
  end loop;

  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
end $$;

-- ── Reject ───────────────────────────────────────────────────────────
create or replace function public.business_setup_quote_reject(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be rejected'; end if;
  if v_reason is null then raise exception 'Give a reason for rejecting the quote'; end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be rejected (this one is %)', q.status; end if;
  update hub_documents set status = 'rejected', status_at = now(), status_by = auth.uid(), status_reason = v_reason where id = q.id;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_reject', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'reason', v_reason));
end $$;

-- ── Link an older quote to a client ──────────────────────────────────
create or replace function public.business_setup_quote_link(p_id uuid, p_client text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be linked to a client'; end if;
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
  if q.client_id is not null and q.client_id <> p_client then raise exception 'This quote is already linked to a different client'; end if;
  if q.client_id = p_client then return; end if;
  update hub_documents set client_id = p_client where id = q.id;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_link', null,
          jsonb_build_object('client_id', p_client, 'document_number', q.document_number));
end $$;

-- ── Record the signed engagement letter ──────────────────────────────
create or replace function public.business_setup_letter_sign(p_id uuid, p_date date, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l hub_documents; v_path text := nullif(btrim(coalesce(p_path, '')), '');
begin
  perform business_setup_require('setup.quotes.manage');
  select * into l from hub_documents where id = p_id for update;
  if l.id is null then raise exception 'Letter not found'; end if;
  if l.doc_type <> 'letter' or l.department <> 'Business Setup' then raise exception 'Only a Business Setup engagement letter can be signed'; end if;
  if p_date is null then raise exception 'Enter the date the letter was signed'; end if;
  if p_date > (now() at time zone 'Asia/Dubai')::date then raise exception 'The signing date cannot be in the future'; end if;
  if v_path is null then raise exception 'Attach the signed scan'; end if;
  update hub_documents set signed_at = p_date, signed_path = v_path where id = l.id;
  perform business_setup_audit('hub_documents', l.id::text, 'letter_sign', null,
          jsonb_build_object('client_id', l.client_id, 'document_number', l.document_number, 'signed_at', p_date));
end $$;

-- ── Payments seen by the start gate ──────────────────────────────────
-- Payments add, refunds and reversals take away. Used inside the functions below; not callable from the API.
create or replace function public.business_setup_net_paid(p_quote uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) from business_setup_payments where quote_id = p_quote
$$;

-- A service starts once its quote has a net payment above zero. A quote with a zero total needs none.
-- A holder of setup.services.override may start without one, giving a reason. Returns true when the override was used.
create or replace function public.business_setup_start_gate(p_quote uuid, p_reason text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_quote is null or coalesce((select total_amount from hub_documents where id = p_quote), 0) <= 0 or business_setup_net_paid(p_quote) > 0 then
    return false;
  end if;
  if not business_setup_can('setup.services.override') then raise exception 'A payment is needed before this service can start'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for starting without a payment'; end if;
  return true;
end $$;

-- ── Service tracker ──────────────────────────────────────────────────
-- p_status moves the service (null leaves it); p_fields changes only the keys present: owner_id, start_date, due_date,
-- expiry_date, notes. p_reason is the note on the status history; cancelling needs it. Payments are never touched.
-- Completing goes through business_setup_service_complete, which checks for an output file.
create or replace function public.business_setup_service_update(p_id uuid, p_status text, p_fields jsonb default '{}', p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s business_setup_services; v_status text; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); p jsonb := coalesce(p_fields, '{}'::jsonb);
  v_override boolean := false; changed text[];
begin
  perform business_setup_require('setup.services.manage');
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  v_status := s.status;
  if p_status is not null then
    v_status := btrim(p_status);
    if not business_setup_status_allowed(v_status) then
      raise exception 'Unknown status: use Not started, In progress, Waiting on client, Waiting on government, Completed or Cancelled';
    end if;
    if v_status = 'Completed' and s.status <> 'Completed' then raise exception 'Complete a service with the completion step, which needs an output file'; end if;
  end if;
  if v_status = 'Cancelled' and s.status <> 'Cancelled' and v_reason is null then raise exception 'Give a reason for cancelling the service'; end if;
  if nullif(p ->> 'owner_id', '') is not null and not exists (select 1 from profiles where id = (p ->> 'owner_id')::uuid) then
    raise exception 'Owner not found';
  end if;
  if v_status = 'In progress' and s.status <> 'In progress' and s.started_at is null then v_override := business_setup_start_gate(s.quote_id, v_reason); end if;
  update business_setup_services set
      owner_id     = case when p ? 'owner_id'     then nullif(p ->> 'owner_id', '')::uuid else owner_id end,
      status       = v_status,
      started_at   = case when v_status = 'In progress' and started_at is null then now() else started_at end,
      start_date   = case when p ? 'start_date'   then nullif(p ->> 'start_date', '')::date else start_date end,
      due_date     = case when p ? 'due_date'     then nullif(p ->> 'due_date', '')::date else due_date end,
      expiry_date  = case when p ? 'expiry_date'  then nullif(p ->> 'expiry_date', '')::date else expiry_date end,
      completed_at = case when v_status <> 'Completed' and s.status = 'Completed' then null else completed_at end,
      notes        = case when p ? 'notes'        then nullif(p ->> 'notes', '') else notes end
    where id = s.id;
  if v_status <> s.status then
    insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, s.status, v_status, v_reason);
  end if;
  select array_agg(key order by key) into changed from jsonb_object_keys(p) key;
  perform business_setup_audit('business_setup_services', s.id::text, 'service_update', null,
          jsonb_build_object('client_id', s.client_id, 'fields', to_jsonb(coalesce(changed, '{}')), 'from_status', s.status, 'to_status', v_status,
                             'start_override', v_override, 'reason', v_reason));
end $$;

-- Completes a service. It needs at least one uploaded output file; a holder of setup.services.override may complete without
-- one, giving a reason. p_output_details is kept on the service. With p_output_details.licence {number, issue_date, expiry_date,
-- authority} (a company registration), the licence goes to Client Master through client_master_save and the expiry to the service.
create or replace function public.business_setup_service_complete(p_id uuid, p_output_details jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s business_setup_services; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); d jsonb := coalesce(p_output_details, '{}'::jsonb);
  lic jsonb; v_expiry date; v_issue date; v_start_override boolean; v_no_output boolean;
begin
  perform business_setup_require('setup.services.manage');
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if s.status = 'Completed' then raise exception 'This service is already completed'; end if;
  if s.status = 'Cancelled' then raise exception 'A cancelled service cannot be completed'; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'The output details must be an object'; end if;
  v_no_output := not exists (select 1 from business_setup_documents where service_id = s.id and is_output);
  if v_no_output then
    if not business_setup_can('setup.services.override') then raise exception 'Upload at least one output file before completing this service'; end if;
    if v_reason is null then raise exception 'Give a reason for completing without an output file'; end if;
  end if;
  v_start_override := s.started_at is null and business_setup_start_gate(s.quote_id, v_reason);
  if d ? 'licence' then
    lic := d -> 'licence';
    if jsonb_typeof(lic) <> 'object' then raise exception 'The licence details must be an object'; end if;
    if nullif(btrim(coalesce(lic ->> 'number', '')), '') is null or nullif(btrim(coalesce(lic ->> 'authority', '')), '') is null
       or nullif(lic ->> 'issue_date', '') is null or nullif(lic ->> 'expiry_date', '') is null then
      raise exception 'Enter the licence number, issue date, expiry date and authority';
    end if;
    v_issue := (lic ->> 'issue_date')::date; v_expiry := (lic ->> 'expiry_date')::date;
    if v_expiry < v_issue then raise exception 'The licence expiry cannot be before its issue date'; end if;
    -- Client Master keeps UAE dates as DD/MM/YYYY.
    perform client_master_save(s.client_id, jsonb_build_object('Trade License Number', btrim(lic ->> 'number'), 'License Issuing Authority', btrim(lic ->> 'authority'),
            'License Issue Date', to_char(v_issue, 'DD/MM/YYYY'), 'License Expiry Date', to_char(v_expiry, 'DD/MM/YYYY')));
  end if;
  update business_setup_services set status = 'Completed', completed_at = now(), started_at = coalesce(started_at, now()),
      output_details = d, expiry_date = coalesce(v_expiry, expiry_date)
    where id = s.id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, s.status, 'Completed', v_reason);
  perform business_setup_audit('business_setup_services', s.id::text, 'service_complete', null,
          jsonb_build_object('client_id', s.client_id, 'from_status', s.status, 'without_output', v_no_output, 'start_override', v_start_override,
                             'detail_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(d) key), 'reason', v_reason));
end $$;

-- ── Quote templates ──────────────────────────────────────────────────
-- Add or edit a template (key identifies it). Only the keys present in p change on an existing template.
create or replace function public.business_setup_quote_template_save(p jsonb) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_key text;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
  v_key := lower(btrim(coalesce(p ->> 'key', '')));
  if v_key !~ '^[a-z0-9_]+$' then raise exception 'The template key may hold only letters, numbers and underscores'; end if;
  if p ? 'label' and nullif(btrim(coalesce(p ->> 'label', '')), '') is null then raise exception 'The template name is required'; end if;
  if p ? 'storage_file' and nullif(btrim(coalesce(p ->> 'storage_file', '')), '') is null then raise exception 'The template file is required'; end if;
  if not exists (select 1 from business_setup_quote_templates where key = v_key)
     and (nullif(btrim(coalesce(p ->> 'label', '')), '') is null or nullif(btrim(coalesce(p ->> 'storage_file', '')), '') is null) then
    raise exception 'A new template needs a name and a file';
  end if;
  if exists (select 1 from business_setup_quote_templates where key = v_key) then
    update business_setup_quote_templates set
        label        = case when p ? 'label'        then btrim(p ->> 'label') else label end,
        jurisdiction = case when p ? 'jurisdiction' then nullif(btrim(coalesce(p ->> 'jurisdiction', '')), '') else jurisdiction end,
        storage_file = case when p ? 'storage_file' then btrim(p ->> 'storage_file') else storage_file end,
        active       = case when p ? 'active'       then coalesce((p ->> 'active')::boolean, active) else active end
      where key = v_key;
  else
    insert into business_setup_quote_templates (key, label, jurisdiction, storage_file, active)
    values (v_key, btrim(p ->> 'label'), nullif(btrim(coalesce(p ->> 'jurisdiction', '')), ''), btrim(p ->> 'storage_file'), coalesce((p ->> 'active')::boolean, true));
  end if;
  perform business_setup_audit('business_setup_quote_templates', v_key, 'quote_template_save', null,
          jsonb_build_object('fields', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(p) key)));
  return v_key;
end $$;

revoke all on function public.business_setup_quote_accept(uuid, boolean), public.business_setup_quote_reject(uuid, text),
  public.business_setup_quote_link(uuid, text), public.business_setup_letter_sign(uuid, date, text),
  public.business_setup_service_update(uuid, text, jsonb, text), public.business_setup_service_complete(uuid, jsonb, text),
  public.business_setup_quote_template_save(jsonb), public.business_setup_status_allowed(text),
  public.business_setup_net_paid(uuid), public.business_setup_start_gate(uuid, text) from public, anon, authenticated;
grant execute on function public.business_setup_quote_accept(uuid, boolean), public.business_setup_quote_reject(uuid, text),
  public.business_setup_quote_link(uuid, text), public.business_setup_letter_sign(uuid, date, text),
  public.business_setup_service_update(uuid, text, jsonb, text), public.business_setup_service_complete(uuid, jsonb, text),
  public.business_setup_quote_template_save(jsonb), public.business_setup_status_allowed(text) to authenticated;
