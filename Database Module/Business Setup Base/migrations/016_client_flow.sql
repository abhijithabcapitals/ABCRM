-- =====================================================================
-- Business Setup Base - client flow stages   016
-- =====================================================================
-- Cases move to the stages of the client flow (spec 2026-11-05, sections 3, 4 and 6):
--   Lead, Review, Onboarding, Pipeline, Completion, With Accounts, Completed, Cancelled, Lost.
-- Existing cases map once: Contact to Lead; Services and Documentation to Onboarding; Assignment and In service to Pipeline. The rest stay.
-- Onboarding holds eight items (business_setup_case_docs): fields, documents, quote, login, quote_accepted, letter, letter_accepted, invoice.
-- When all are met the case moves to Pipeline by itself. A payment blocks nothing: docs also carries balance, for display only.
-- Acceptance records (business_setup_acceptances, below) back quote_accepted and letter_accepted; login is true for an active portal account only;
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
--   login              the client has an active portal account (a revoked one does not count)
--   quote_accepted     the case has an accepted quote (a quote becomes accepted only on an Accepted acceptance row or a Confirmed signed copy, see quote_accept_body)
--   letter             a letter exists on the accepted quote
--   letter_accepted    that letter has an Accepted acceptance row
--   invoice            an invoice is recorded on the case's live quote, or the Invoice override was given (a revision clears the override)
--   balance            the accepted quote's total (else the newest live quote's) less the case's net payments. Display only: never blocks a move
create or replace function public.business_setup_case_docs(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_form text; v_fields boolean; v_letter boolean; v_total numeric;
begin
  select * into c from business_setup_cases where id = p_case;
  select status into v_form from business_setup_onboarding_forms where case_id = p_case order by created_at desc limit 1;
  v_fields := case when v_form is not null then v_form = 'Validated'
                   else coalesce(c.client_id is not null and exists (select 1 from business_setup_kyc_profiles k where k.client_id = c.client_id and k.kyc_state = 'Done'), false) end;
  -- A letter the client rejected, or that a new one replaced, is not the letter.
  v_letter := exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id where l.case_id = p_case and l.doc_type = 'letter' and l.status not in ('rejected', 'superseded') and lq.status = 'accepted');
  select total_amount into v_total from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')
   order by (status = 'accepted') desc, created_at desc limit 1;
  return jsonb_build_object(
    'fields', v_fields,
    'documents', v_fields,
    'quote', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')),
    'login', c.client_id is not null and exists (select 1 from client_portal_accounts a where a.id = business_setup_portal_account(c.client_id) and a.status = 'active'),
    'quote_accepted', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted'),
    'letter', v_letter,
    'letter_accepted', exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id join business_setup_acceptances a on a.document_id = l.id
                                where l.case_id = p_case and l.doc_type = 'letter' and l.status not in ('rejected', 'superseded') and lq.status = 'accepted' and a.kind = 'Letter' and a.decision = 'Accepted'),
    -- Only an invoice on the live quote (issued or accepted, not replaced or rejected) meets the item, so a revision needs its own invoice or a new waiver.
    'invoice', coalesce(c.invoice_override_reason is not null, false) or exists (select 1 from business_setup_invoices i
                 where i.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote' and status in ('issued', 'accepted'))),
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
  if new.case_id is null then return null; end if;   -- a form with no case is left alone
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
                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter' and l.status not in ('rejected', 'superseded'))),
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
                           and not exists (select 1 from hub_documents q where q.case_id = c.id and q.doc_type = 'quote' and q.status not in ('superseded', 'rejected'))),
    -- Client flow figures (spec section 12). The two old form figures above stay for the Dashboard Module until Task 8.
    'client_inputs', (select count(*) from business_setup_onboarding_forms f where f.status = 'Submitted'),
    -- Issued and not decided. Each revision is its own document, so no acceptance row on the document means no decision on the current revision.
    'awaiting_client', (select count(*) from hub_documents d where d.department = 'Business Setup' and d.doc_type in ('quote', 'letter') and d.status = 'issued'
                         and not exists (select 1 from business_setup_acceptances a where a.document_id = d.id)),
    'payment_claims', (select count(*) from business_setup_payment_claims where status = 'Pending'),
    'at_completion', (select count(*) from business_setup_cases where stage = 'Completion')
  ) || business_setup_dash_handover();
end $$;

-- ── The client's login for a client (redefines 010's, same signature) ──
-- An active account wins over a revoked one, then the lowest id, so the answer never depends on row order. A client can have two accounts when one hangs off the
-- client record and one off the Banking record.
create or replace function public.business_setup_portal_account(p_client text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from client_portal_accounts a
   where a.client_master_id = p_client
      or a.banking_client_id in (select b.id from banking_clients b where b.client_master_id = p_client)
   order by (a.status = 'active') desc, a.id
   limit 1
$$;
revoke all on function public.business_setup_portal_account(text) from public, anon, authenticated;

-- ── Acceptance records ───────────────────────────────────────────────
-- One row per decision on a quote or an engagement letter, never changed or deleted. A revised quote is a new document, so it has no row until the client
-- (or staff, from a signed copy) decides again: nothing is cleared, the new revision simply starts without a decision. `revision` is the document's place in
-- its quote chain (0 for the first quote; a letter takes its quote's). The portal records Portal rows (account_id and username of the login, checked by
-- business_setup_portal_decide in 018); staff confirming a signed copy records Staff rows with signed_quote_id.
create table if not exists public.business_setup_acceptances (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.hub_documents(id),
  kind text not null check (kind in ('Quote', 'Letter')),
  revision int not null check (revision >= 0),
  decision text not null check (decision in ('Accepted', 'Rejected')),
  note text,
  source text not null check (source in ('Portal', 'Staff')),
  account_id uuid,   -- no foreign key: deleting a login must not be blocked by (or alter) an append-only record
  username text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  signed_quote_id uuid references public.business_setup_signed_quotes(id),
  check ((source = 'Portal') = (account_id is not null)),
  check ((source = 'Staff') = (signed_quote_id is not null)),
  check (decision = 'Accepted' or nullif(btrim(coalesce(note, '')), '') is not null)
);
create unique index if not exists business_setup_acceptances_one_accepted on public.business_setup_acceptances (document_id) where decision = 'Accepted';
create unique index if not exists business_setup_acceptances_one_portal on public.business_setup_acceptances (document_id) where source = 'Portal';
alter table public.business_setup_acceptances enable row level security;
drop policy if exists business_setup_acceptances_read on public.business_setup_acceptances;
create policy business_setup_acceptances_read on public.business_setup_acceptances for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_acceptances from anon, authenticated;
grant select on public.business_setup_acceptances to authenticated;
create or replace function public.business_setup_acceptances_immutable() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'Acceptance records cannot be changed or removed';
end $$;
revoke all on function public.business_setup_acceptances_immutable() from public, anon, authenticated;
drop trigger if exists business_setup_acceptances_immutable on public.business_setup_acceptances;
create trigger business_setup_acceptances_immutable before update or delete on public.business_setup_acceptances
  for each row execute function public.business_setup_acceptances_immutable();

-- A document's place in its quote chain: how many quotes it replaced. A letter takes the place of its quote. Internal.
create or replace function public.business_setup_doc_revision(p_doc uuid) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  with recursive d as (select * from hub_documents where id = p_doc),
  up as (
    select h.id, h.revises_id, 0 as n from hub_documents h where h.id = (select case when doc_type = 'letter' then parent_id else id end from d)
    union all
    select h.id, h.revises_id, up.n + 1 from up join hub_documents h on h.id = up.revises_id),
  -- A letter issued again after a rejection points at the one it replaced (revises_id): one more revision for each.
  lt as (
    select h.id, h.revises_id, 0 as n from d join hub_documents h on h.id = d.revises_id where d.doc_type = 'letter'
    union all
    select h.id, h.revises_id, lt.n + 1 from lt join hub_documents h on h.id = lt.revises_id)
  select coalesce((select max(n) from up), 0)
       + (select case when d.doc_type = 'letter' and d.revises_id is not null then 1 else 0 end from d)
       + coalesce((select max(n) from lt), 0)
$$;
revoke all on function public.business_setup_doc_revision(uuid) from public, anon, authenticated;

-- ── Accepting a quote ────────────────────────────────────────────────
-- The accept logic of 015, split in two: the body has no rights check and serves staff (through the wrapper below) and the client's own Accept (through
-- business_setup_portal_decide in 018, which has checked the login instead). The one change: a quote is accepted on a Confirmed signed copy as before, or on an
-- Accepted acceptance row.
create or replace function public.business_setup_quote_accept_body(p_id uuid, p_allow_expired boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  select * into q from hub_documents where id = p_id;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
  v_root := coalesce(q.root_quote_id, q.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
    raise exception 'A quote in this revision chain is already accepted';
  end if;
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and cannot take an accepted quote', lower((select stage from business_setup_cases where id = q.case_id));
  end if;
  if q.case_id is not null and exists (select 1 from hub_documents where case_id = q.case_id and doc_type = 'quote' and status = 'accepted' and id <> q.id) then
    raise exception 'Another quote of this case is already accepted: a case holds one quote and its revisions';
  end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
  -- KYC already done (validated here, or marked Done in the old records) is not asked for again. The percentage needs a signed-in member of staff
  -- (business_setup_kyc_status checks the right), so a client accepting from the portal, who has none, is told to contact us instead.
  if not exists (select 1 from business_setup_kyc_profiles where client_id = q.client_id and kyc_state = 'Done') then
    if auth.uid() is null then raise exception 'Your details are not complete yet. Please contact AB Capital Services FZE.'; end if;
    kyc := business_setup_kyc_status(q.client_id);
    if (kyc ->> 'percent')::int < 100 then
      raise exception 'The client KYC is incomplete: missing %', (select string_agg(m, ', ') from jsonb_array_elements_text(kyc -> 'missing') m);
    end if;
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;
  if not exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Confirmed')
     and not exists (select 1 from business_setup_acceptances where document_id = q.id and kind = 'Quote' and decision = 'Accepted') then
    raise exception 'This quote has not been accepted by the client or confirmed from a signed copy yet';
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
    -- A line for a cost (its fee item is not a service) stays on the quote and creates no service.
    if v_fee is not null and not coalesce((select is_service from business_setup_fee_items where id = v_fee), true) then continue; end if;
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
create or replace function public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.quotes.manage');
  return business_setup_quote_accept_body(p_id, p_allow_expired);
end $$;
revoke all on function public.business_setup_quote_accept_body(uuid, boolean) from public, anon, authenticated;
revoke all on function public.business_setup_quote_accept(uuid, boolean) from public, anon;
grant execute on function public.business_setup_quote_accept(uuid, boolean) to authenticated;

-- ── Staff signed copies, for quotes and for letters ──────────────────
-- business_setup_signed_quotes is keyed on hub_documents, which also holds letters, so a letter takes its signed copy in the same table with kind Letter.
-- Confirming a copy writes an acceptance row with source Staff and signed_quote_id: for a quote it also accepts the quote (and creates its services),
-- for a letter it records the letter's acceptance and nothing else.
create or replace function public.business_setup_signed_add(p_quote uuid, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; pq hub_documents; v_path text := nullif(btrim(coalesce(p_path, '')), ''); v_prefix text; v_id uuid; v_kind text;
begin
  perform business_setup_require('setup.quotes.manage');
  if v_path is null then raise exception 'Enter the file path'; end if;
  select * into q from hub_documents where id = p_quote for update;
  if q.id is null or q.doc_type not in ('quote', 'letter') or q.department <> 'Business Setup' then raise exception 'Quote not found'; end if;
  v_kind := case q.doc_type when 'letter' then 'Letter' else 'Quote' end;
  if v_kind = 'Quote' then
    if q.status <> 'issued' then raise exception 'Only an issued quote can take a signed copy (this one is %)', q.status; end if;
  else
    select * into pq from hub_documents where id = q.parent_id;
    if pq.id is null or pq.status <> 'accepted' then raise exception 'The quote must be accepted before its letter can take a signed copy'; end if;
    if exists (select 1 from business_setup_acceptances where document_id = q.id and decision = 'Accepted') then raise exception 'This letter is already accepted'; end if;
  end if;
  if q.client_id is null then raise exception 'Link this quote to a client before adding its signed copy'; end if;
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is closed and its quote cannot take a signed copy';
  end if;
  v_prefix := 'staff/' || q.client_id || '/';
  if not coalesce(left(v_path, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_path, '/')) or '' = any (string_to_array(v_path, '/')) then
    raise exception 'The file path must be under staff/%/ and cannot contain .. or empty parts', q.client_id;
  end if;
  if exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Uploaded') then
    raise exception 'A signed copy of this quote is already waiting for review: confirm or refuse it first';
  end if;
  begin
    insert into business_setup_signed_quotes (quote_id, storage_path, source, status, kind) values (q.id, v_path, 'Staff', 'Uploaded', v_kind) returning id into v_id;
  exception when unique_violation then raise exception 'A signed copy is already stored at that path';
  end;
  perform business_setup_audit('business_setup_signed_quotes', v_id::text, 'signed_add', null, jsonb_build_object('quote_id', q.id, 'source', 'Staff', 'kind', v_kind));
  return v_id;
end $$;

create or replace function public.business_setup_signed_decide(p_id uuid, p_confirm boolean, p_note text, p_allow_expired boolean default false) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare s business_setup_signed_quotes; q hub_documents; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_root uuid;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into s from business_setup_signed_quotes where id = p_id;
  if s.id is null then raise exception 'Signed copy not found'; end if;
  select * into q from hub_documents where id = s.quote_id;
  -- Lock the chain root and the document first, as an accept and a revision do, so none of them can deadlock.
  v_root := coalesce((select coalesce(r.root_quote_id, r.id) from hub_documents r where r.id = case when q.doc_type = 'letter' then q.parent_id else q.id end), q.id);
  perform 1 from hub_documents where id = v_root for update;
  perform 1 from hub_documents where id = q.id for update;
  select * into s from business_setup_signed_quotes where id = p_id for update;
  if s.status <> 'Uploaded' then raise exception 'This signed copy has already been %', lower(s.status); end if;
  if p_confirm is null then raise exception 'Choose to confirm or refuse the signed copy'; end if;
  if p_confirm then
    update business_setup_signed_quotes set status = 'Confirmed', note = v_note, decided_at = now(), decided_by = auth.uid() where id = s.id;
    if s.kind = 'Letter' then
      if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
        raise exception 'This case is closed and its letter cannot be accepted';
      end if;
      if not exists (select 1 from hub_documents where id = q.parent_id and status = 'accepted') then raise exception 'The quote of this letter is no longer accepted'; end if;
      if exists (select 1 from business_setup_acceptances where document_id = q.id and decision = 'Accepted') then raise exception 'This letter is already accepted'; end if;
    else
      perform business_setup_quote_accept_body(q.id, coalesce(p_allow_expired, false));
    end if;
    insert into business_setup_acceptances (document_id, kind, revision, decision, note, source, signed_quote_id)
    values (q.id, s.kind, business_setup_doc_revision(q.id), 'Accepted', v_note, 'Staff', s.id);
  else
    if v_note is null then raise exception 'Tell the client why the signed copy is refused'; end if;
    update business_setup_signed_quotes set status = 'Refused', note = v_note, decided_at = now(), decided_by = auth.uid() where id = s.id;
  end if;
  perform business_setup_audit('business_setup_signed_quotes', s.id::text, 'signed_decide', jsonb_build_object('status', s.status),
          jsonb_build_object('quote_id', q.id, 'kind', s.kind, 'confirmed', p_confirm, 'note', v_note));
end $$;
revoke all on function public.business_setup_signed_add(uuid, text), public.business_setup_signed_decide(uuid, boolean, text, boolean) from public, anon;
grant execute on function public.business_setup_signed_add(uuid, text), public.business_setup_signed_decide(uuid, boolean, text, boolean) to authenticated;

-- ── Re-checking a case when its login or KYC changes ─────────────────
-- A case waiting only on the login or on KYC never saw a change, because only forms, documents and payments re-checked it. Both triggers re-check
-- the Business Setup cases of the client at Onboarding and touch nothing else, so Banking and the other departments use the login table as before.
create or replace function public.business_setup_case_client_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text; v_case uuid;
begin
  if tg_table_name = 'client_portal_accounts' then v_client := business_setup_portal_client(new.id);
  else v_client := new.client_id; end if;
  if v_client is null then return null; end if;
  for v_case in select id from business_setup_cases where client_id = v_client and stage = 'Onboarding' loop
    perform business_setup_case_sync(v_case);
  end loop;
  return null;
end $$;
revoke all on function public.business_setup_case_client_trg() from public, anon, authenticated;
drop trigger if exists business_setup_case_login on public.client_portal_accounts;
create trigger business_setup_case_login after insert or update of status, client_master_id, banking_client_id on public.client_portal_accounts
  for each row execute function public.business_setup_case_client_trg();
drop trigger if exists business_setup_case_kyc on public.business_setup_kyc_profiles;
create trigger business_setup_case_kyc after insert or update of kyc_state on public.business_setup_kyc_profiles
  for each row execute function public.business_setup_case_client_trg();

-- A decision on a document re-checks its case.
create or replace function public.business_setup_case_acceptance_trg() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_case uuid;
begin
  select case_id into v_case from hub_documents where id = new.document_id;
  if v_case is not null then perform business_setup_case_sync(v_case); end if;
  return null;
end $$;
revoke all on function public.business_setup_case_acceptance_trg() from public, anon, authenticated;
drop trigger if exists business_setup_case_acceptance on public.business_setup_acceptances;
create trigger business_setup_case_acceptance after insert on public.business_setup_acceptances
  for each row execute function public.business_setup_case_acceptance_trg();

-- ── Payment claims (spec section 7) ──────────────────────────────────
-- A client says "I have paid" against one invoice of theirs. The claim belongs to that invoice and to the invoice's case, and changes no balance: only
-- business_setup_payment_add with claim_id turns it into a payment (and a receipt voucher) and marks it Confirmed, in the same transaction. Staff may also
-- Refuse it with a note the client can read. A claim is written by the portal function in 018 and decided by staff functions; the table is read-only through
-- the API. Once decided it cannot change or go. One Pending claim per invoice at a time. proof_path is the client's own upload (client_portal_documents).
create table if not exists public.business_setup_payment_claims (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.business_setup_cases(id),
  account_id uuid not null references public.client_portal_accounts(id),
  invoice_id uuid not null references public.business_setup_invoices(id),
  amount numeric(18,2) not null check (amount > 0),
  paid_on date not null,
  reference text,
  proof_path text,
  status text not null default 'Pending' check (status in ('Pending', 'Confirmed', 'Refused')),
  decided_by uuid,   -- no foreign key: a profile that goes must not be blocked by, or change, the record
  decided_at timestamptz,
  note text,
  payment_id uuid references public.business_setup_payments(id),
  created_at timestamptz not null default now(),
  check ((status = 'Pending') = (decided_at is null)),
  check ((status = 'Confirmed') = (payment_id is not null)),
  check (status <> 'Refused' or nullif(btrim(coalesce(note, '')), '') is not null)
);
create unique index if not exists business_setup_payment_claims_one_pending on public.business_setup_payment_claims (invoice_id) where status = 'Pending';
create index if not exists business_setup_payment_claims_case_idx on public.business_setup_payment_claims (case_id);
create index if not exists business_setup_payment_claims_account_idx on public.business_setup_payment_claims (account_id);
alter table public.business_setup_payment_claims enable row level security;
drop policy if exists business_setup_payment_claims_read on public.business_setup_payment_claims;
create policy business_setup_payment_claims_read on public.business_setup_payment_claims for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_payment_claims from anon, authenticated;
grant select on public.business_setup_payment_claims to authenticated;
create or replace function public.business_setup_payment_claims_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then raise exception 'A payment claim cannot be removed'; end if;
  if old.status <> 'Pending' then raise exception 'A payment claim that was decided cannot be changed'; end if;
  if new.id <> old.id or new.case_id <> old.case_id or new.account_id <> old.account_id or new.invoice_id <> old.invoice_id or new.amount <> old.amount
     or new.paid_on <> old.paid_on or new.reference is distinct from old.reference or new.proof_path is distinct from old.proof_path or new.created_at <> old.created_at then
    raise exception 'What the client claimed cannot be changed';
  end if;
  return new;
end $$;
revoke all on function public.business_setup_payment_claims_guard() from public, anon, authenticated;
drop trigger if exists business_setup_payment_claims_guard on public.business_setup_payment_claims;
create trigger business_setup_payment_claims_guard before update or delete on public.business_setup_payment_claims
  for each row execute function public.business_setup_payment_claims_guard();

-- Record a payment and its receipt, on a case or on an accepted quote (p: case_id or quote_id, amount, paid_on, method, reference,
-- note, override_reason, and claim_id). Redefined from 015 for claim_id: with it the payment confirms that Pending payment claim, in the same transaction.
-- The claim is locked first, before the quote and the case; it must be Pending and belong to the same case. Nothing else changes, so the overpayment rule
-- applies to a claim as to any payment. On a case the payment follows the case's accepted quote when there is one; before that quote_id stays empty,
-- and the money counts toward the quote once it is accepted. The overpayment check applies once a quote is accepted.
create or replace function public.business_setup_payment_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; c business_setup_cases; v_today date := (now() at time zone 'Asia/Dubai')::date; v_amount numeric; v_on date;
  v_case uuid; v_quote uuid; v_client text;
  cl business_setup_payment_claims; v_claim uuid;
  v_outstanding numeric; v_over boolean := false; v_reason text; v_note text; v_pay uuid; v_rec uuid; v_number text;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  begin
    v_case := nullif(p ->> 'case_id', '')::uuid; v_quote := nullif(p ->> 'quote_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The case or quote is not valid';
  end;
  begin
    v_claim := nullif(p ->> 'claim_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The payment claim is not valid';
  end;
  if v_claim is not null then
    select * into cl from business_setup_payment_claims where id = v_claim for update;
    if cl.id is null then raise exception 'Payment claim not found'; end if;
    if cl.status <> 'Pending' then raise exception 'This payment claim has already been decided'; end if;
    if v_case is null and v_quote is null then v_case := cl.case_id; end if;
  end if;
  if v_case is null and v_quote is null then raise exception 'Choose the case or the quote this payment is for'; end if;
  -- A case pays its accepted quote. The quote is locked before the case, the order an accept uses.
  if v_quote is null then
    select id into v_quote from hub_documents where case_id = v_case and doc_type = 'quote' and department = 'Business Setup' and status = 'accepted' limit 1;
  end if;
  if v_quote is not null then
    select * into q from hub_documents where id = v_quote for update;
    if q.id is null then raise exception 'Quote not found'; end if;
    if q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
      raise exception 'A payment can be recorded only against an accepted Business Setup quote';
    end if;
    if v_case is null then v_case := q.case_id;
    elsif q.case_id is distinct from v_case then raise exception 'This quote does not belong to that case'; end if;
  end if;
  if cl.id is not null and cl.case_id is distinct from v_case then raise exception 'This payment claim belongs to another case'; end if;
  if v_case is not null then
    select * into c from business_setup_cases where id = v_case for update;
    if c.id is null then raise exception 'Case not found'; end if;
    if c.stage = 'Lost' then raise exception 'This case is lost and takes no payment'; end if;
    v_client := c.client_id;
    if v_client is null then raise exception 'Link a client to this case before recording a payment'; end if;
    if q.id is not null and q.client_id is not null and q.client_id <> v_client then raise exception 'The client of this quote does not match the client of the case'; end if;
  else
    v_client := q.client_id;
    if v_client is null then raise exception 'Link this quote to a client before recording a payment'; end if;
  end if;
  if q.id is not null and business_setup_quote_locked(q.id) then
    raise exception 'This quote is locked because Accounts holds it: no payment can be recorded';
  end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount above zero with at most two decimals';
  end if;
  v_on := coalesce(nullif(p ->> 'paid_on', '')::date, v_today);
  if v_on > v_today then raise exception 'The payment date cannot be in the future'; end if;

  v_reason := nullif(btrim(coalesce(p ->> 'override_reason', '')), '');
  if q.id is not null then
    v_outstanding := coalesce(q.total_amount, 0) - business_setup_net_paid(q.id);
    v_over := v_amount > v_outstanding;
    if v_over then
      if not business_setup_can('setup.payments.override') then
        raise exception 'This payment is above the balance of %: ask someone who may accept an overpayment', to_char(v_outstanding, 'FM999,999,999,990.00');
      end if;
      if v_reason is null then raise exception 'Give a reason for accepting a payment above the balance'; end if;
    end if;
  end if;
  v_note := nullif(btrim(coalesce(p ->> 'note', '')), '');
  if v_over then v_note := concat_ws(E'\n', v_note, 'Above the balance: ' || v_reason); end if;

  insert into business_setup_payments (client_id, quote_id, case_id, paid_on, amount, method, reference, type, note)
  values (v_client, q.id, v_case, v_on, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Payment', v_note)
  returning id into v_pay;
  v_number := hub_next_number('Business Setup', 'receipt');
  insert into business_setup_receipts (payment_id, receipt_number) values (v_pay, v_number) returning id into v_rec;
  if cl.id is not null then
    update business_setup_payment_claims set status = 'Confirmed', payment_id = v_pay, decided_by = auth.uid(), decided_at = now() where id = cl.id;
    perform business_setup_audit('business_setup_payment_claims', cl.id::text, 'claim_confirm', jsonb_build_object('status', 'Pending'),
            jsonb_build_object('status', 'Confirmed', 'payment_id', v_pay, 'case_id', v_case, 'claimed', cl.amount, 'recorded', v_amount));
  end if;

  perform business_setup_audit('business_setup_payments', v_pay::text, 'payment_add', null,
          jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'amount', v_amount, 'receipt_number', v_number,
                             'overpayment', v_over, 'reason', case when v_over then v_reason end));
  return jsonb_build_object('payment_id', v_pay, 'receipt_id', v_rec, 'receipt_number', v_number);
end $$;
revoke all on function public.business_setup_payment_add(jsonb) from public, anon;
grant execute on function public.business_setup_payment_add(jsonb) to authenticated;

-- Refuse a claim, with a note the client can read. Staff with setup.payments.manage. A decided claim cannot be decided again.
create or replace function public.business_setup_claim_refuse(p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare cl business_setup_payment_claims; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  perform business_setup_require('setup.payments.manage');
  if v_note is null then raise exception 'Tell the client why this claim is refused'; end if;
  select * into cl from business_setup_payment_claims where id = p_id for update;
  if cl.id is null then raise exception 'Payment claim not found'; end if;
  if cl.status <> 'Pending' then raise exception 'This payment claim has already been decided'; end if;
  update business_setup_payment_claims set status = 'Refused', note = v_note, decided_by = auth.uid(), decided_at = now() where id = cl.id;
  perform business_setup_audit('business_setup_payment_claims', cl.id::text, 'claim_refuse', jsonb_build_object('status', 'Pending'),
          jsonb_build_object('status', 'Refused', 'case_id', cl.case_id, 'note', v_note));
end $$;
revoke all on function public.business_setup_claim_refuse(uuid, text) from public, anon;
grant execute on function public.business_setup_claim_refuse(uuid, text) to authenticated;


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


-- ── Zoho invoices published to the client login (client flow Task 5) ──
-- One invoice number once per quote. The rule lived only in business_setup_invoice_record (015); now that the zoho-books function also writes
-- invoices, the table holds it. The index is partial (a row without a number, or without a quote, is never compared) and matches the function's
-- rule: the number is trimmed and compared without regard to case.
-- If the live table already holds the same number twice on one quote the index cannot be built. This block says so in a plain sentence and builds
-- nothing, so no row is touched or guessed. Fix those rows by hand, then run this file again. The same check, as a read-only query that lists them:
-- scripts/check_invoice_duplicates.sql (run it before the release).
do $$
declare n int;
begin
  if to_regclass('public.business_setup_invoices_quote_number_uq') is null then
    select count(*) into n from (select 1 from public.business_setup_invoices where quote_id is not null and invoice_number is not null
                                  group by quote_id, lower(btrim(invoice_number)) having count(*) > 1) d;
    if n > 0 then
      raise exception '% quote(s) hold the same invoice number more than once in business_setup_invoices. Remove or renumber the duplicate rows, then run this file again. List them with scripts/check_invoice_duplicates.sql.', n;
    end if;
  end if;
end $$;
create unique index if not exists business_setup_invoices_quote_number_uq
  on public.business_setup_invoices (quote_id, lower(btrim(invoice_number))) where invoice_number is not null;

-- Stores the invoice that the zoho-books function has read from Zoho and filed under <client>/invoice/. Only the service role can call it, and the function
-- checks the staff member's right first (business_setup_can setup.quotes.manage, through the user's own session), so there is no business_setup_require here.
-- Keys: quote_id, invoice_number, invoice_date (optional, default today), amount, file_path, zoho_id, published_by (optional, the staff member's id).
-- A repeat with the same zoho_id returns the same row. A row made without a file by the Zoho read-back gets this file and nothing else changes.
-- The row is inserted with source 'zoho', so business_setup_case_invoice runs business_setup_case_sync, as for a hand-recorded invoice.
create or replace function public.business_setup_invoice_publish(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; c business_setup_cases; i business_setup_invoices; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_quote uuid; v_case uuid; v_client text; v_number text; v_on date; v_amount numeric; v_path text; v_prefix text; v_zoho text; v_by uuid; v_id uuid;
begin
  p := coalesce(p, '{}'::jsonb);
  begin
    v_quote := nullif(p ->> 'quote_id', '')::uuid; v_by := nullif(p ->> 'published_by', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'The quote is not valid';
  end;
  if v_quote is null then raise exception 'Choose the quote this invoice is for'; end if;
  v_zoho := nullif(btrim(coalesce(p ->> 'zoho_id', '')), '');
  if v_zoho is null then raise exception 'The Zoho invoice is missing'; end if;
  v_number := nullif(btrim(coalesce(p ->> 'invoice_number', '')), '');
  if v_number is null then raise exception 'Enter the invoice number'; end if;
  if length(v_number) > 60 then raise exception 'The invoice number is too long'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount < 0 or v_amount >= 10000000000000000 then
    raise exception 'Enter an amount of zero or more';
  end if;
  v_amount := round(v_amount, 2);
  begin
    v_on := coalesce(nullif(p ->> 'invoice_date', '')::date, v_today);
  exception when others then
    raise exception 'Enter a valid invoice date';
  end;
  v_path := nullif(btrim(coalesce(p ->> 'file_path', '')), '');
  if v_path is null then raise exception 'The invoice file is missing'; end if;

  select * into q from hub_documents where id = v_quote for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
    raise exception 'An invoice can be published only for an accepted Business Setup quote';
  end if;
  v_case := q.case_id; v_client := q.client_id;
  if v_case is not null then
    select * into c from business_setup_cases where id = v_case for update;
    if c.stage = 'Lost' then raise exception 'This case is lost and takes no invoice'; end if;
    if c.client_id is not null and v_client is not null and c.client_id <> v_client then raise exception 'The client of this quote does not match the client of the case'; end if;
    v_client := coalesce(v_client, c.client_id);
  end if;
  if v_client is null then raise exception 'Link this quote to a client before publishing an invoice'; end if;
  if business_setup_quote_locked(q.id) then
    raise exception 'This quote is with Accounts. It can be changed only if Accounts reverts it.';
  end if;
  v_prefix := v_client || '/invoice/';
  if not coalesce(left(v_path, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_path, '/')) or '' = any (string_to_array(v_path, '/'))
     or cardinality(string_to_array(v_path, '/')) <> 3 then
    raise exception 'The file path must be under % and cannot contain .. or empty parts', v_prefix;
  end if;

  select * into i from business_setup_invoices where zoho_id = v_zoho for update;
  if i.id is not null then
    if i.quote_id is distinct from q.id then raise exception 'This Zoho invoice is already published for another quote'; end if;
    if i.file_path is null then
      update business_setup_invoices set file_path = v_path, case_id = coalesce(case_id, v_case), created_by = coalesce(created_by, v_by) where id = i.id;
      perform business_setup_audit('business_setup_invoices', i.id::text, 'invoice_publish', null,
              jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'invoice_number', i.invoice_number, 'zoho_id', v_zoho, 'published_by', v_by, 'has_file', true, 'completed', true));
    end if;
    return i.id;
  end if;
  if exists (select 1 from business_setup_invoices where quote_id = q.id and lower(btrim(invoice_number)) = lower(v_number)) then
    raise exception 'Invoice % is already recorded on this quote', v_number;
  end if;

  insert into business_setup_invoices (client_id, quote_id, case_id, invoice_number, issued_on, amount, file_path, source, zoho_id, created_by)
  values (v_client, q.id, v_case, v_number, v_on, v_amount, v_path, 'zoho', v_zoho, v_by)
  returning id into v_id;
  perform business_setup_audit('business_setup_invoices', v_id::text, 'invoice_publish', null,
          jsonb_build_object('client_id', v_client, 'quote_id', q.id, 'case_id', v_case, 'invoice_number', v_number, 'amount', v_amount, 'zoho_id', v_zoho, 'published_by', v_by, 'has_file', true));
  return v_id;
end $$;
revoke all on function public.business_setup_invoice_publish(jsonb) from public, anon, authenticated;
grant execute on function public.business_setup_invoice_publish(jsonb) to service_role;

-- ── Form list carries the case ───────────────────────────────────────
-- Same as 009's, plus case_id, so a screen can open the form of one case when a client has more than one open case.
create or replace function public.business_setup_form_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'client_id', f.client_id, 'case_id', f.case_id, 'legal_name', m.legal_name, 'status', f.status, 'submitted_at', f.submitted_at,
             'taken_by', case when f.taken_by is not null then business_setup_person_name(f.taken_by) end, 'return_note', f.return_note,
             'missing', to_jsonb(business_setup_form_missing_items(f.id, true))) order by f.submitted_at nulls last, f.created_at), '[]'::jsonb)
    from business_setup_onboarding_forms f join client_master m on m.client_id = f.client_id
   where p_status is null or f.status = p_status);
end $$;
