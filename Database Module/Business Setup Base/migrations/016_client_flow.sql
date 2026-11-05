-- =====================================================================
-- Business Setup Base - client flow stages   016
-- =====================================================================
-- Cases move to the stages of the client flow (spec 2026-11-05, sections 3, 4 and 6):
--   Lead, Review, Onboarding, Pipeline, Completion, With Accounts, Completed, Cancelled, Lost.
-- Existing cases map once: Contact to Lead; Services and Documentation to Onboarding; Assignment and In service to Pipeline. The rest stay.
-- Onboarding holds eight items (business_setup_case_docs): fields, documents, quote, login, quote_accepted, letter, letter_accepted, invoice.
-- When all are met the case moves to Pipeline by itself. A payment blocks nothing: docs also carries balance, for display only.
-- Until the acceptance records exist (a later migration) login is true when the client has a portal account and letter_accepted when a letter exists;
-- fields and documents are true when the case's form is Validated, or KYC is Done and the case has no form.
-- A service whose quote belongs to a case starts without a payment (start gate). A case reaches Lost only before Pipeline.
-- Apply this file in a single transaction (the stage check, the mapping and the functions must land together).
-- Run after 015 and before 018. Re-runnable: the stage mapping touches only rows still on an old stage. It redefines functions from 006, 013, 014 and 015:
-- run this file again whenever 006, 013, 014 or 015 is re-run.
-- Undo with rollback/015_018_rollback.sql (phase 2 only, with 015 and 018) or rollback/013_019_rollback.sql (every case migration).
-- =====================================================================

-- ── Stages: replace the check, then map the rows ─────────────────────
-- One statement, so a failure leaves the old check and old stages in place. The mapped rows keep their updated_at (the touch trigger is paused),
-- and each mapping is audited as case_stage_map with the old stage.
do $$
declare r record;
begin
  alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
  alter table public.business_setup_cases disable trigger business_setup_cases_touch;
  for r in select id, stage from public.business_setup_cases where stage in ('Contact', 'Services', 'Documentation', 'Assignment', 'In service') loop
    perform public.business_setup_audit('business_setup_cases', r.id::text, 'case_stage_map', jsonb_build_object('stage', r.stage),
      jsonb_build_object('stage', case r.stage when 'Contact' then 'Lead' when 'Services' then 'Onboarding' when 'Documentation' then 'Onboarding' else 'Pipeline' end,
                         'note', 'Client flow stages'));
  end loop;
  update public.business_setup_cases set stage = case stage when 'Contact' then 'Lead' when 'Services' then 'Onboarding' when 'Documentation' then 'Onboarding' else 'Pipeline' end
   where stage in ('Contact', 'Services', 'Documentation', 'Assignment', 'In service');
  alter table public.business_setup_cases enable trigger business_setup_cases_touch;
  alter table public.business_setup_cases add constraint business_setup_cases_stage_check
    check (stage in ('Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'));
end $$;
alter table public.business_setup_cases alter column stage set default 'Lead';

-- ── What Onboarding needs, worked out from the records (never stored). Internal ──
--   fields, documents  the case's newest form is Validated; a case with no form counts when its client's KYC is Done
--   quote              a quote that was neither replaced nor rejected exists
--   login              the client has a portal account (a later migration replaces this with the issued login)
--   quote_accepted     the case has an accepted quote
--   letter             a letter exists on the accepted quote
--   letter_accepted    a letter exists (a later migration replaces this with the acceptance record)
--   invoice            an invoice is recorded for the case (or a quote of it), or the Invoice override was given
--   balance            the accepted quote's total (else the newest live quote's) less the case's net payments. Display only: never blocks a move
create or replace function public.business_setup_case_docs(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_form text; v_fields boolean; v_letter boolean; v_total numeric;
begin
  select * into c from business_setup_cases where id = p_case;
  select status into v_form from business_setup_onboarding_forms where case_id = p_case order by created_at desc limit 1;
  v_fields := case when v_form is not null then v_form = 'Validated'
                   else coalesce(c.client_id is not null and exists (select 1 from business_setup_kyc_profiles k where k.client_id = c.client_id and k.kyc_state = 'Done'), false) end;
  v_letter := exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id where l.case_id = p_case and l.doc_type = 'letter' and lq.status = 'accepted');
  select total_amount into v_total from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')
   order by (status = 'accepted') desc, created_at desc limit 1;
  return jsonb_build_object(
    'fields', v_fields,
    'documents', v_fields,
    'quote', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')),
    'login', c.client_id is not null and business_setup_portal_account(c.client_id) is not null,
    'quote_accepted', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted'),
    'letter', v_letter,
    'letter_accepted', v_letter,
    'invoice', coalesce(c.invoice_override_reason is not null, false) or exists (select 1 from business_setup_invoices i where i.case_id = p_case
                 or i.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote')),
    'balance', coalesce(v_total, 0) - business_setup_case_net_paid(p_case));
end $$;
revoke all on function public.business_setup_case_docs(uuid) from public, anon, authenticated;

-- ── Moving a case forward when its records say so, never backward. Internal ──
--   Onboarding -> Pipeline       every item of case_docs except balance is met
--   Pipeline -> Completion       every service of the case's quotes is Completed or Cancelled, with at least one Completed
--   Pipeline -> Cancelled        every such service is Cancelled
-- Lead and Review follow the form (trigger below) and the owner's move to Onboarding. Completion, With Accounts and Completed follow the quote's handover (trigger below).
create or replace function public.business_setup_case_sync(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_stage text; v_open int; v_done int; v_total int; v_docs jsonb; v_hand text;
begin
  select stage into v_stage from business_setup_cases where id = p_case for update;
  if not found then return; end if;
  if v_stage = 'Onboarding' then
    v_docs := business_setup_case_docs(p_case);
    if not exists (select 1 from unnest(array['fields', 'documents', 'quote', 'login', 'quote_accepted', 'letter', 'letter_accepted', 'invoice']) k
                    where coalesce(v_docs -> k, 'false'::jsonb) <> 'true'::jsonb) then
      perform business_setup_case_set_stage(p_case, 'Pipeline', 'Every onboarding item is met');
      v_stage := 'Pipeline';
    end if;
  end if;
  if v_stage = 'Pipeline' then
    select count(*), count(*) filter (where s.status not in ('Completed', 'Cancelled')), count(*) filter (where s.status = 'Completed') into v_total, v_open, v_done
      from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote');
    if v_total > 0 and v_open = 0 then
      perform business_setup_case_set_stage(p_case, case when v_done > 0 then 'Completion' else 'Cancelled' end, 'Every service is closed');
      v_stage := case when v_done > 0 then 'Completion' else 'Cancelled' end;
    end if;
  end if;
  -- The handover of the case's accepted quote (011) drives Completion onward: With Accounts when sent, Completed when Accounts closes it,
  -- back to Completion when Accounts reverts it.
  if v_stage in ('Completion', 'With Accounts') then
    select h.status into v_hand from business_setup_handovers h join hub_documents q on q.id = h.quote_id
     where q.case_id = p_case and q.doc_type = 'quote' and q.status = 'accepted' order by h.sent_at desc nulls last limit 1;
    if v_hand = 'Closed' then
      perform business_setup_case_set_stage(p_case, 'Completed', 'Accounts validated the handover');
    elsif v_hand = 'With Accounts' and v_stage = 'Completion' then
      perform business_setup_case_set_stage(p_case, 'With Accounts', 'Sent to Accounts');
    elsif v_hand = 'Reverted' and v_stage = 'With Accounts' then
      perform business_setup_case_set_stage(p_case, 'Completion', 'Accounts reverted the handover');
    end if;
  end if;
end $$;
revoke all on function public.business_setup_case_sync(uuid) from public, anon, authenticated;

-- ── Forms ────────────────────────────────────────────────────────────
-- Submitted or In review puts a Lead on Review; Returned puts a Review back to Lead. Validated moves no stage by itself: it meets the Fields and
-- Documents items, so the case is re-checked. A case already at Onboarding or later is left alone.
create or replace function public.business_setup_case_form_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_to text := case new.status when 'Submitted' then 'Review' when 'In review' then 'Review' when 'Returned' then 'Lead' end;
        v_stage text;
begin
  select stage into v_stage from business_setup_cases where id = new.case_id for update;
  if v_to is not null and v_stage in ('Lead', 'Review') and v_stage <> v_to then
    perform business_setup_case_set_stage(new.case_id, v_to, 'Form ' || lower(new.status));
  end if;
  perform business_setup_case_sync(new.case_id);
  return null;
end $$;
revoke all on function public.business_setup_case_form_trg() from public, anon, authenticated;

-- ── Handover to Accounts drives the stage ────────────────────────────
create or replace function public.business_setup_case_handover_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid;
begin
  select case_id into v_case from hub_documents where id = new.quote_id;
  if v_case is not null then perform business_setup_case_sync(v_case); end if;
  return null;
end $$;
revoke all on function public.business_setup_case_handover_trg() from public, anon, authenticated;
drop trigger if exists business_setup_case_handover on public.business_setup_handovers;
create trigger business_setup_case_handover after insert or update of status on public.business_setup_handovers
  for each row execute function public.business_setup_case_handover_trg();

-- ── The start gate ───────────────────────────────────────────────────
-- A service starts once its quote has a net payment above zero, as in 006, except that a quote belonging to a case needs no payment: the case moved
-- to Pipeline without one, and the balance stays visible. A quote with no case, or a zero total, behaves as before. Returns true when the override was used.
create or replace function public.business_setup_start_gate(p_quote uuid, p_reason text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_quote is null or coalesce((select total_amount from hub_documents where id = p_quote), 0) <= 0 or business_setup_net_paid(p_quote) > 0
     or exists (select 1 from hub_documents where id = p_quote and case_id is not null) then
    return false;
  end if;
  if not business_setup_can('setup.services.override') then raise exception 'A payment is needed before this service can start'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for starting without a payment'; end if;
  return true;
end $$;
revoke all on function public.business_setup_start_gate(uuid, text) from public, anon, authenticated;

-- ── New lead ─────────────────────────────────────────────────────────
-- As in 014, except a case always starts at Lead: only the owner's move (or a submitted form) takes it on, whatever the client's KYC.
create or replace function public.business_setup_case_new(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := nullif(btrim(coalesce(p ->> 'lead_name', '')), ''); v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');
        v_stage text := 'Lead'; v_id uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_name is null then raise exception 'Enter the lead name'; end if;
  if v_client is not null then
    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  end if;
  insert into business_setup_cases (client_id, stage, source, lead_name, contact_person, phone, email, notes)
  values (v_client, v_stage, nullif(btrim(coalesce(p ->> 'source', '')), ''), v_name, nullif(btrim(coalesce(p ->> 'contact_person', '')), ''),
          nullif(btrim(coalesce(p ->> 'phone', '')), ''), nullif(btrim(coalesce(p ->> 'email', '')), ''), nullif(btrim(coalesce(p ->> 'notes', '')), ''))
  returning id into v_id;
  perform business_setup_audit('business_setup_cases', v_id::text, 'case_new', null, jsonb_build_object('stage', v_stage, 'lead_name', v_name, 'client_id', v_client));
  return v_id;
end $$;

-- ── Taking a case ────────────────────────────────────────────────────
-- As in 014, without the Assignment step: a case in Pipeline with no owner takes one here and is then re-checked, so a case whose services are
-- all closed does not wait for a service change that never comes.
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
  if c.stage = 'Pipeline' then perform business_setup_case_sync(p_case); end if;
end $$;

-- ── Share link ───────────────────────────────────────────────────────
-- As in 014. A Lead stays a Lead while the client fills in the form and goes to Review when the form is already submitted. It never goes to Onboarding
-- here: only the owner's move does that, even when the client's KYC is done.
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
    -- A form on a case that is Lost, Completed or Cancelled is free: it moves to this case.
    if f.case_id is not null and f.case_id <> p_case
       and (select stage from business_setup_cases where id = f.case_id) not in ('Completed', 'Cancelled', 'Lost') then
      raise exception 'This client already has an open form on case %', (select case_number from business_setup_cases where id = f.case_id);
    end if;
    update business_setup_onboarding_forms set case_id = p_case where id = f.id and case_id is distinct from p_case;
  end if;
  if c.stage = 'Lead' then
    v_to := case when f.status in ('Submitted', 'In review') then 'Review' else 'Lead' end;
    if v_to <> 'Lead' then perform business_setup_case_set_stage(p_case, v_to, 'The client link was shared'); end if;
  end if;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_shared', null, jsonb_build_object('client_id', c.client_id, 'form_id', f.id));
  perform business_setup_case_sync(p_case);
end $$;

-- ── Moving to Client Onboarding ──────────────────────────────────────
-- The owner (or a holder of setup.cases.approve) moves a Lead or Review case to Onboarding. The duplicate-checked client step runs first: staff
-- create the client or link an existing one, and a likely duplicate is refused until they link it or confirm it is new. Returns the client id.
create or replace function public.business_setup_case_move_to_onboarding(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_client text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage not in ('Lead', 'Review') then raise exception 'Only a lead or a case in review can move to Client Onboarding'; end if;
  if c.owner_id is null then raise exception 'Assign the lead before moving it.'; end if;
  if c.owner_id <> auth.uid() and not business_setup_can('setup.cases.approve') then
    raise exception 'Only the owner (%) or a manager can move this case to Client Onboarding', business_setup_person_name(c.owner_id);
  end if;
  v_client := business_setup_case_link_client_body(p_case, p_client, p_allow_duplicate);
  perform business_setup_case_set_stage(p_case, 'Onboarding', 'Moved to Client Onboarding by ' || business_setup_person_name(auth.uid()));
  perform business_setup_case_sync(p_case);
  return v_client;
end $$;
revoke all on function public.business_setup_case_move_to_onboarding(uuid, text, boolean) from public, anon;
grant execute on function public.business_setup_case_move_to_onboarding(uuid, text, boolean) to authenticated;

-- The Assignment step is gone: a case moves to Pipeline by itself, so there is nothing for an owner to confirm.
create or replace function public.business_setup_case_confirm(p_case uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  raise exception 'There is nothing to confirm: a case moves to Pipeline by itself once its onboarding items are met';
end $$;

-- ── Lost ─────────────────────────────────────────────────────────────
-- As in 015, except the stage rule: a case can reach Lost only before Pipeline (Lead, Review or Onboarding). Still refused with a net payment above
-- zero and with an accepted quote.
create or replace function public.business_setup_case_lost(p_case uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_net numeric; v_acct uuid; q hub_documents; v_sid uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_reason is null then raise exception 'Enter the reason this case is lost'; end if;
  perform 1 from hub_documents where case_id = p_case and doc_type = 'quote' order by (root_quote_id is not null), id for update;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage in ('Pipeline', 'Completion', 'With Accounts') then raise exception 'A case in Pipeline or later cannot be marked lost: cancel its services instead'; end if;
  if exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted') then
    raise exception 'This case has an accepted quote and cannot be marked lost: cancel its services instead';
  end if;
  v_net := business_setup_case_net_paid(p_case);
  if v_net > 0 then raise exception 'This case has a net payment of %: refund it before marking the case lost', v_net; end if;
  -- Lost rejects every issued quote, so it cannot pass a quote that Accounts holds.
  if exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'issued' and business_setup_quote_locked(id)) then
    raise exception 'A quote of this case is locked because Accounts holds it: the case cannot be marked lost';
  end if;
  update business_setup_cases set lost_reason = v_reason where id = p_case;
  perform business_setup_case_set_stage(p_case, 'Lost', v_reason);
  for q in select * from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'issued' loop
    update hub_documents set status = 'rejected', status_at = now(), status_by = auth.uid(), status_reason = 'Case marked lost: ' || v_reason where id = q.id;
    perform business_setup_audit('hub_documents', q.id::text, 'quote_reject_by_lost', jsonb_build_object('status', 'issued'),
            jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'case_id', p_case, 'reason', v_reason));
    for v_sid in update business_setup_signed_quotes set status = 'Refused', note = 'This case was closed, so this signed copy no longer applies',
           decided_at = now(), decided_by = auth.uid() where quote_id = q.id and status = 'Uploaded' returning id loop
      perform business_setup_audit('business_setup_signed_quotes', v_sid::text, 'signed_refused_by_lost', jsonb_build_object('status', 'Uploaded'), jsonb_build_object('quote_id', q.id, 'case_id', p_case));
    end loop;
  end loop;
  if c.client_id is not null
     and not exists (select 1 from business_setup_cases where client_id = c.client_id and id <> p_case and stage not in ('Completed', 'Cancelled', 'Lost'))
     and not exists (select 1 from business_setup_services where client_id = c.client_id)
     and not exists (select 1 from banking_cases bc join banking_clients bk on bk.id = bc.client_id where bk.client_master_id = c.client_id) then
    v_acct := business_setup_portal_account(c.client_id);
    update client_portal_accounts set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), failed_attempts = 0, locked_until = null where id = v_acct and status = 'active';
    if found then
      delete from client_portal_sessions where account_id = v_acct;
      perform business_setup_audit('client_portal_accounts', v_acct::text, 'login_revoke', null, jsonb_build_object('client_id', c.client_id, 'case_id', p_case));
    end if;
  end if;
end $$;

-- ── Case list ────────────────────────────────────────────────────────
-- Views (open cases unless said otherwise):
--   assigned    my cases at Lead or Review
--   leads       every case at Lead or Review
--   inputs      cases at Lead or Review whose form is Submitted or In review
--   onboarding  Onboarding        pipeline  Pipeline        completion  Completion and With Accounts        closed  Lost
-- documentation, cases and all are kept for the screens that still use them (replaced when the new tabs land): Onboarding; Pipeline onward; everything.
-- Each row holds the case fields, the client name, the owner's name, the checklist (case_docs), the referrer's name and any pending reassignment.
-- referred_by_name reads a referred_by column once a later migration adds one; until then it is null.
create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'assigned' then array['Lead', 'Review']
    when 'leads' then array['Lead', 'Review']
    when 'inputs' then array['Lead', 'Review']
    when 'onboarding' then array['Onboarding']
    when 'pipeline' then array['Pipeline']
    when 'completion' then array['Completion', 'With Accounts']
    when 'closed' then array['Lost']
    when 'documentation' then array['Onboarding']
    when 'cases' then array['Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use assigned, leads, inputs, onboarding, pipeline, completion or closed', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'referred_by_name', case when (to_jsonb(c) ->> 'referred_by') is not null then business_setup_person_name((to_jsonb(c) ->> 'referred_by')::uuid) end,
      'docs', business_setup_case_docs(c.id),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))));
end $$;

-- ── Dashboard figures ────────────────────────────────────────────────
-- As in 014. Every top-level key stays (Dashboard Module/services/summaryApi.js reads them). pipeline counts the six open stages, in the new names.
-- pending_after_kyc counts cases at Onboarding with no quote yet (what a case at Services was).
create or replace function public.business_setup_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_exp jsonb; v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai';
        v_done_total int; v_done_month int; v_recv numeric;
begin
  perform business_setup_require('setup.access');
  v_exp := business_setup_expiries();
  -- One expression for both outstanding and receivables.
  select coalesce(sum(greatest(q.total_amount - business_setup_net_paid(q.id), 0)), 0) into v_recv from hub_documents q
   where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted';
  select count(*), count(*) filter (where t.at >= v_month) into v_done_total, v_done_month
    from (select coalesce(
                   (select max(a.occurred_at) from business_setup_audit_log a
                     where a.table_name = 'business_setup_cases' and a.row_id = c.id::text and a.action = 'case_stage' and a.new_data ->> 'stage' = 'Completed'),
                   (select max(s.completed_at) from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = c.id and doc_type = 'quote')),
                   c.updated_at) as at
            from business_setup_cases c where c.stage = 'Completed') t;
  return jsonb_build_object(
    'forms_waiting', business_setup_dash_forms(),
    'open_quotes', (select count(*) from hub_documents where department = 'Business Setup' and doc_type = 'quote' and status = 'issued'),
    'accepted_without_letter', (select count(*) from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')),
    'outstanding', v_recv,
    'active_services', (select count(*) from business_setup_services where status not in ('Completed', 'Cancelled') and not historical),
    'expiries', jsonb_build_object('upcoming', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Upcoming'),
                                   'past', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Past date')),
    'processes_pending', (select count(*) from business_setup_services s
                           where s.status not in ('Completed', 'Cancelled') and not s.historical
                             and exists (select 1 from hub_documents q where q.id = s.quote_id and q.case_id is not null)),
    'receivables', v_recv,
    'advances', (select coalesce(sum(case when p.type = 'Payment' then p.amount else -p.amount end), 0) from business_setup_payments p
                  where p.case_id is not null
                    and not exists (select 1 from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
                                       and (q.case_id = p.case_id or q.id = p.quote_id))),
    'cases_completed_month', v_done_month,
    'cases_completed_total', v_done_total,
    'pipeline', (select jsonb_object_agg(st, (select count(*) from business_setup_cases c where c.stage = st))
                   from unnest(array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts']) st),
    'forms_to_review', business_setup_dash_forms(),
    'pending_after_kyc', (select count(*) from business_setup_cases c where c.stage = 'Onboarding'
                           and not exists (select 1 from hub_documents q where q.case_id = c.id and q.doc_type = 'quote' and q.status not in ('superseded', 'rejected')))
  ) || business_setup_dash_handover();
end $$;

-- ── Privileges ───────────────────────────────────────────────────────
-- Internal functions (case_docs, case_sync, form_trg, start_gate) were revoked beside their definitions above. The functions below are callable by
-- signed-in users and never by anon.
do $$
declare f text;
begin
  foreach f in array array[
    'business_setup_case_new(jsonb)', 'business_setup_case_take(uuid)', 'business_setup_case_shared(uuid)', 'business_setup_case_confirm(uuid)',
    'business_setup_case_lost(uuid,text)', 'business_setup_case_list(text)', 'business_setup_dashboard()',
    'business_setup_case_move_to_onboarding(uuid,text,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
