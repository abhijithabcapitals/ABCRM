-- =====================================================================
-- Business Development - lead workflow                             012
-- =====================================================================
-- The BD workflow from the lead pool to the departments that deliver the work:
--
--   All Leads (every source, tagged) -> a person assigns the lead to themself -> Prospect
--   -> Contact -> Convinced -> Received Documents -> Done KYC
--   -> Quote & Engagement Sent (quotation and engagement letter mailed)
--   -> Converted (the client's payment receipt is recorded)
--   -> transferred as a new lead/job to Business Banking, Business Setup and/or Accounting.
--
-- What this migration does
--   1. Pipeline stages: adds the six workflow stages, renames WON_PENDING_ONBOARDING to "Converted",
--      deactivates the ten old open stages and maps every lead in them to the nearest new stage.
--   2. Lead pool: a lead may be unassigned; anyone with a BD role sees unassigned leads and can claim one
--      (bd_assign_lead). Managers and team leaders assign to anyone.
--   3. Quote & engagement: bd_record_quote_sent logs the mail and moves the lead to Quote & Engagement Sent.
--   4. Conversion: bd_payment_receipts (receipt file in hub-documents under "Business Development/receipts/"),
--      bd_department_transfers, and bd_convert_lead, which records the receipt, accepts the quoted services,
--      marks the lead won (bd_mark_lead_won) and creates the department records:
--        Business Banking -> banking_leads (status New)
--        Business Setup   -> business_setup_cases (stage Lead)
--        Accounting       -> accounting_jobs (To Do, one per service)
--   5. bd_lead_ui_json also returns the quote, receipts and transfers.
--
-- Run after 001-011 and after the Banking, Business Setup and Accounting base migrations.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ── 1. Pipeline stages ───────────────────────────────────────────────

-- stage_order is unique, so park the old open stages out of the way first.
update public.bd_pipeline_stages set stage_order = stage_order + 1000, is_active = false, updated_at = now()
where stage_code in ('NEW_LEAD', 'CONTACT_PENDING', 'FIRST_CONTACT_ATTEMPTED', 'CONTACT_ESTABLISHED',
                     'REQUIREMENT_IDENTIFIED', 'QUALIFIED', 'PROPOSAL_PREPARATION', 'PROPOSAL_SENT',
                     'NEGOTIATION', 'VERBAL_CONFIRMATION')
  and stage_order < 1000;
update public.bd_pipeline_stages set stage_order = stage_order + 1000
where stage_code in ('WON_PENDING_ONBOARDING', 'ONBOARDING_COMPLETED') and stage_order < 1000;

insert into public.bd_pipeline_stages (stage_code, stage_name, stage_order, progress_weight, default_probability,
                                       is_terminal, is_active, required_fields)
values
  ('PROSPECT',               'Prospect',                1,  12.50,  5, false, true, '[]'),
  ('CONTACT',                'Contact',                 2,  25.00, 15, false, true, '["discussion_logged"]'),
  ('CONVINCED',              'Convinced',               3,  37.50, 35, false, true, '["discussion_logged", "service_added", "next_step"]'),
  ('DOCUMENTS_RECEIVED',     'Received Documents',      4,  50.00, 50, false, true, '["service_added", "next_step"]'),
  ('KYC_DONE',               'Done KYC',                5,  62.50, 65, false, true, '["service_added", "next_step"]'),
  ('QUOTE_SENT',             'Quote & Engagement Sent', 6,  75.00, 80, false, true, '["proposed_fee", "quote_recorded"]'),
  ('WON_PENDING_ONBOARDING', 'Converted',               7,  87.50, 100, false, true, '["mark_won_only"]'),
  ('ONBOARDING_COMPLETED',   'Onboarding Completed',    8, 100.00, 100, true,  true, '["complete_onboarding_only"]')
on conflict (stage_code) do update set
  stage_name = excluded.stage_name, stage_order = excluded.stage_order, progress_weight = excluded.progress_weight,
  default_probability = excluded.default_probability, is_terminal = excluded.is_terminal, is_active = true,
  required_fields = excluded.required_fields, updated_at = now();

-- Map leads in the old stages. History records the move (append-only table; the lead's creator is the actor).
with map(old_code, new_code) as (values
  ('NEW_LEAD', 'PROSPECT'), ('CONTACT_PENDING', 'PROSPECT'),
  ('FIRST_CONTACT_ATTEMPTED', 'CONTACT'), ('CONTACT_ESTABLISHED', 'CONTACT'),
  ('REQUIREMENT_IDENTIFIED', 'CONVINCED'), ('QUALIFIED', 'CONVINCED'),
  ('PROPOSAL_PREPARATION', 'KYC_DONE'),
  ('PROPOSAL_SENT', 'QUOTE_SENT'), ('NEGOTIATION', 'QUOTE_SENT'), ('VERBAL_CONFIRMATION', 'QUOTE_SENT')),
moved as (
  update public.bd_leads l set stage_id = n.id, updated_at = now()
  from map m
  join public.bd_pipeline_stages o on o.stage_code = m.old_code
  join public.bd_pipeline_stages n on n.stage_code = m.new_code
  where l.stage_id = o.id
  returning l.id, l.status, l.created_by, o.id as from_stage, n.id as to_stage)
insert into public.bd_lead_stage_history (lead_id, from_stage_id, to_stage_id, from_status, to_status,
                                          changed_by_user_id, reason, transition_metadata)
select id, from_stage, to_stage, status, status, created_by, 'Workflow stage mapping (migration 012)',
       jsonb_build_object('migration', '012_bd_lead_workflow')
from moved;

-- ── 2. Service catalog: bank account opening routes to Business Banking ─
-- (quote columns are added in section 3; mapped Quote & Engagement Sent leads get quote_sent_at there)

insert into public.bd_service_catalog (service_code, service_name, service_category, default_billing_frequency, sort_order)
select 'BANK_ACCOUNT_OPENING', 'Bank Account Opening', 'Banking', 'One-time',
       coalesce((select max(sort_order) from public.bd_service_catalog), 0) + 1
where not exists (select 1 from public.bd_service_catalog where service_code = 'BANK_ACCOUNT_OPENING' or service_name = 'Bank Account Opening');

-- ── 3. Lead pool: unassigned leads ───────────────────────────────────

alter table public.bd_leads alter column assigned_to_user_id drop not null;

-- Quote & engagement details on the lead
alter table public.bd_leads add column if not exists quote_reference       varchar(100);
alter table public.bd_leads add column if not exists engagement_reference  varchar(100);
alter table public.bd_leads add column if not exists quote_sent_at         timestamptz;
alter table public.bd_leads add column if not exists quote_sent_to         varchar(255);

-- Leads mapped from Proposal Sent / Negotiation / Verbal Confirmation already sent their proposal: they can be
-- converted without recording the quote again.
update public.bd_leads l set quote_sent_at = coalesce(l.proposal_sent_at, l.updated_at)
from public.bd_pipeline_stages s
where s.id = l.stage_id and s.stage_code = 'QUOTE_SENT' and l.quote_sent_at is null;

-- Anyone with a BD role sees the unassigned pool, so they can claim a lead.
create or replace function public.bd_can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.bd_leads l
    where l.id = p_lead_id
      and (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'marketing_executive',
                                        'onboarding_executive', 'management', 'read_only')
           or l.assigned_to_user_id = auth.uid() or l.acquired_by_user_id = auth.uid()
           or (l.assigned_to_user_id is null and public.bd_current_role() is not null)))
$$;

-- Claim or assign a lead. Without p_user the caller takes it. Sales and marketing executives may only take an
-- unassigned lead for themselves; managers and team leaders assign or reassign to anyone.
create or replace function public.bd_assign_lead(p_lead_id uuid, p_user uuid default null, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_target uuid := coalesce(p_user, auth.uid());
  v_role text := public.bd_current_role();
begin
  if auth.uid() is null or v_role is null then raise exception 'Sign in with a Business Development role to assign leads.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.id is null then raise exception 'Lead not found.'; end if;
  if v_lead.status not in ('Open', 'On Hold') then raise exception 'Only an active lead can be assigned.'; end if;
  if v_lead.assigned_to_user_id is not distinct from v_target then return public.bd_lead_ui_json(p_lead_id); end if;
  if not public.bd_is_manager() then
    if v_role not in ('sales_executive', 'marketing_executive') then
      raise exception 'Your Business Development role cannot take leads.';
    end if;
    if v_target <> auth.uid() then raise exception 'Only a manager or team leader can assign a lead to someone else.'; end if;
    if v_lead.assigned_to_user_id is not null then
      raise exception 'This lead is already assigned. Ask a manager to reassign it.';
    end if;
  end if;
  if not exists (select 1 from public.profiles where id = v_target) then raise exception 'Select a valid employee.'; end if;

  update public.bd_leads set assigned_to_user_id = v_target, updated_by = auth.uid(), last_activity_at = now()
  where id = p_lead_id;
  insert into public.bd_lead_assignment_history (lead_id, previous_owner_user_id, new_owner_user_id, changed_by_user_id,
                                                 assignment_reason)
  values (p_lead_id, v_lead.assigned_to_user_id, v_target, auth.uid(),
          coalesce(nullif(btrim(p_reason), ''), case when v_target = auth.uid() then 'Taken from the lead pool' else 'Assigned' end));
  -- open follow-ups move to the new owner
  insert into public.bd_followup_history (followup_id, action, previous_assignee_id, new_assignee_id, reason, changed_by_user_id)
  select f.id, 'Reassigned', f.assigned_to_user_id, v_target, 'Lead assigned', auth.uid()
  from public.bd_followups f
  where f.lead_id = p_lead_id and f.status in ('Scheduled', 'Rescheduled') and f.assigned_to_user_id <> v_target;
  update public.bd_followups set assigned_to_user_id = v_target, updated_at = now()
  where lead_id = p_lead_id and status in ('Scheduled', 'Rescheduled') and assigned_to_user_id <> v_target;
  perform public.bd_audit('bd_leads', p_lead_id, 'Assign', jsonb_build_object('owner', v_lead.assigned_to_user_id),
                          jsonb_build_object('owner', v_target), p_reason);
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- ── 4. Create lead: starts at Prospect; may go to the pool unassigned ─

create or replace function public.bd_create_lead(p_lead jsonb, p_activity jsonb, p_followup jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text := public.bd_current_role();
  v_type text := initcap(coalesce(nullif(p_lead->>'lead_type', ''), 'company'));
  v_name text := btrim(coalesce(p_lead->>'name', ''));
  v_mobile text := nullif(btrim(p_lead->>'mobile'), '');
  v_email text := nullif(btrim(p_lead->>'email'), '');
  v_acq uuid := nullif(p_lead->>'acquired_by', '')::uuid;
  v_owner uuid := nullif(p_lead->>'current_owner', '')::uuid;   -- null: the lead goes to the unassigned pool
  v_detail text := nullif(btrim(p_lead->>'source_detail'), '');
  v_campaign_name text := nullif(btrim(p_lead->>'campaign_name'), '');
  v_interest text := nullif(btrim(p_lead->>'initial_service_interest'), '');
  v_summary text := btrim(coalesce(p_activity->>'summary', p_lead->>'initial_summary', ''));
  v_next timestamptz := nullif(p_followup->>'planned_at', '')::timestamptz;
  v_occurred timestamptz := coalesce(nullif(p_activity->>'occurred_at', '')::timestamptz, now());
  v_channel text := coalesce(nullif(p_activity->>'channel', ''), 'Other');
  v_source public.bd_lead_sources;
  v_campaign uuid;
  v_dup boolean;
  v_key text;
  v_lead public.bd_leads;
  v_disc uuid;
begin
  if auth.uid() is null or v_role is null then
    raise exception 'Sign in and request a Business Development role before creating leads.';
  end if;
  if v_role not in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive') then
    raise exception 'Your Business Development role cannot create leads.';
  end if;
  if v_acq is null then
    raise exception 'Select the employee who acquired the lead.';
  end if;
  if not public.bd_is_manager() and (v_acq <> auth.uid() or (v_owner is not null and v_owner <> auth.uid())) then
    raise exception 'Only a manager or team leader can assign a lead to another employee.';
  end if;
  if v_name = '' or (nullif(regexp_replace(coalesce(v_mobile, ''), '\D', '', 'g'), '') is null and v_email is null) then
    raise exception 'A prospect name and at least one contact method are required.';
  end if;
  if v_email is not null and v_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if not public.bd_is_meaningful(v_summary) then
    raise exception 'Enter a meaningful initial discussion summary.';
  end if;
  if v_next is null then
    raise exception 'A next follow-up date is required for an active lead.';
  end if;

  select * into v_source from public.bd_lead_sources
  where is_active and (source_name = coalesce(p_lead->>'source', 'Other') or source_code = p_lead->>'source');
  if not found then raise exception 'Select a valid lead source.'; end if;
  if v_source.requires_referrer and v_detail is null then
    raise exception 'Enter the referrer in Source detail for % leads.', v_source.source_name;
  end if;
  if v_campaign_name is not null then
    select id into v_campaign from public.bd_campaigns where lower(campaign_name) = lower(v_campaign_name);
    if v_campaign is null then  -- first lead for a campaign typed in the UI creates the campaign record
      insert into public.bd_campaigns (campaign_code, campaign_name, channel, campaign_status, campaign_owner_user_id)
      values ('CMP-' || to_char(now() at time zone 'Asia/Dubai', 'YYYY') || '-' || lpad(nextval('public.bd_campaign_number_seq')::text, 4, '0'),
              v_campaign_name,
              case v_source.source_code when 'META_ADS' then 'Meta' when 'GOOGLE_ADS' then 'Google'
                                        when 'INSTAGRAM' then 'Instagram' when 'LINKEDIN' then 'LinkedIn'
                                        when 'EMAIL' then 'Email' else 'Other' end,
              'Active', auth.uid())
      returning id into v_campaign;
      perform public.bd_audit('bd_campaigns', v_campaign, 'Create', null, jsonb_build_object('campaign_name', v_campaign_name));
    end if;
  elsif v_source.requires_campaign then
    raise exception 'Enter the campaign name for % leads.', v_source.source_name;
  end if;

  -- duplicate check, serialized per contact key so two people cannot create the same lead at once
  for v_key in
    select k from unnest(array[
      case when v_mobile is not null then 'mobile:' || right(regexp_replace(v_mobile, '\D', '', 'g'), 9) end,
      case when v_email is not null then 'email:' || lower(v_email) end,
      'name:' || v_type || ':' || lower(regexp_replace(v_name, '\s+', ' ', 'g'))]) k
    where k is not null order by k
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_key, 0));
  end loop;
  select exists (
    select 1 from public.bd_leads e
    where e.archived_at is null
      and ((v_mobile is not null and right(e.mobile_normalized, 9) = right(nullif(regexp_replace(v_mobile, '\D', '', 'g'), ''), 9))
        or (v_email is not null and e.email_normalized = lower(v_email))
        or (e.lead_type = v_type and lower(regexp_replace(btrim(e.prospect_name), '\s+', ' ', 'g'))
                                     = lower(regexp_replace(v_name, '\s+', ' ', 'g'))))) into v_dup;
  if v_dup and not coalesce((p_lead->>'duplicate_exception')::boolean, false) then
    raise exception 'A possible matching lead already exists. Review the matching record before continuing.';
  end if;
  if v_dup and not public.bd_is_manager() then
    raise exception 'Only a manager can approve a duplicate-lead exception.';
  end if;

  insert into public.bd_leads (
    lead_type, prospect_name, company_name, primary_contact_name, mobile_number, email, whatsapp_number,
    country, emirate, website, source_id, source_detail, campaign_id, referrer_name,
    acquired_by_user_id, assigned_to_user_id, stage_id, status, priority, initial_service_interest,
    initial_discussion_summary, acquired_on, estimated_budget, budget_currency, internal_notes,
    duplicate_override, first_contact_at, last_activity_at, created_by, updated_by)
  values (
    v_type, v_name, case when v_type = 'Company' then v_name end, nullif(btrim(p_lead->>'contact_name'), ''),
    v_mobile, v_email, nullif(btrim(p_lead->>'whatsapp'), ''),
    nullif(btrim(p_lead->>'country'), ''), nullif(btrim(p_lead->>'emirate'), ''), nullif(btrim(p_lead->>'website'), ''),
    v_source.id, v_detail, v_campaign, case when v_source.requires_referrer then v_detail end,
    v_acq, v_owner, (select id from public.bd_pipeline_stages where stage_code = 'PROSPECT'), 'Open',
    case coalesce(p_lead->>'priority', 'Medium') when 'Medium' then 'Normal' else p_lead->>'priority' end,
    case when v_interest is not null then jsonb_build_array(v_interest) end,
    v_summary, coalesce(nullif(p_lead->>'acquired_at', '')::date, (now() at time zone 'Asia/Dubai')::date),
    nullif(p_lead->>'estimated_budget', '')::numeric, coalesce(nullif(p_lead->>'budget_currency', ''), 'AED'),
    nullif(btrim(p_lead->>'notes'), ''), v_dup, v_occurred, v_occurred, auth.uid(), auth.uid())
  returning * into v_lead;

  perform public.bd_stage_history(v_lead, null, null, case when v_owner is null then 'Lead created in the pool' else 'Lead created' end);
  if v_owner is not null then
    insert into public.bd_lead_assignment_history (lead_id, previous_owner_user_id, new_owner_user_id, changed_by_user_id, assignment_reason)
    values (v_lead.id, null, v_owner, auth.uid(), 'Assigned at creation');
  end if;

  insert into public.bd_discussions (
    lead_id, occurred_at, channel, channel_detail, direction, contact_person, outcome, requirement_summary,
    discussion_summary, services_discussed, client_interest_level, agreed_next_action, next_followup_at, recorded_by)
  values (
    v_lead.id, v_occurred, public.bd_channel_code(v_channel), v_channel,
    initcap(coalesce(nullif(p_activity->>'direction', ''), 'outbound')),
    coalesce(nullif(btrim(p_activity->>'contact_person'), ''), v_name), 'Contacted',
    coalesce(nullif(btrim(p_activity->>'requirement'), ''), v_interest, 'Not yet identified'),
    v_summary,
    coalesce(array(select jsonb_array_elements_text(coalesce(p_activity->'services_discussed', '[]'::jsonb))), '{}'),
    coalesce(nullif(p_activity->>'interest_level', ''), 'Unknown'),
    coalesce(nullif(btrim(p_activity->>'next_action'), ''), 'Follow up with prospect'), v_next, auth.uid())
  returning id into v_disc;

  -- a pool lead's first follow-up sits with its creator until someone takes the lead
  insert into public.bd_followups (lead_id, discussion_id, assigned_to_user_id, followup_type, channel_detail,
                                   scheduled_at, objective, next_action, created_by)
  values (v_lead.id, v_disc, coalesce(v_owner, auth.uid()),
          case public.bd_channel_code(coalesce(nullif(p_followup->>'channel', ''), v_channel))
            when 'Social' then 'Other' else public.bd_channel_code(coalesce(nullif(p_followup->>'channel', ''), v_channel)) end,
          coalesce(nullif(p_followup->>'channel', ''), v_channel), v_next,
          coalesce(nullif(btrim(p_followup->>'objective'), ''), 'Follow up on initial discussion'),
          'Follow up on initial discussion', auth.uid());
  perform public.bd_refresh_next_followup(v_lead.id);

  perform public.bd_audit('bd_leads', v_lead.id, 'Create', null, to_jsonb(v_lead),
                          case when v_dup then 'Duplicate exception approved' end);
  return public.bd_lead_ui_json(v_lead.id);
end $$;

-- ── 5. Stage change: new stage rules ─────────────────────────────────

create or replace function public.bd_change_stage(p_lead_id uuid, p_stage text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_from public.bd_pipeline_stages;
  v_to public.bd_pipeline_stages;
  v_req text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to change this lead.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status <> 'Open' then raise exception 'Only an active lead can change stage.'; end if;
  if v_lead.assigned_to_user_id is null then raise exception 'Assign the lead to someone before moving it through the pipeline.'; end if;
  select * into v_to from public.bd_pipeline_stages where is_active and (stage_name = p_stage or stage_code = p_stage);
  if not found then raise exception 'Select a valid pipeline stage.'; end if;
  if v_to.id = v_lead.stage_id then return public.bd_lead_ui_json(p_lead_id); end if;
  if v_to.stage_code = 'WON_PENDING_ONBOARDING' then
    raise exception 'Record the client''s payment receipt to convert this lead.';
  end if;
  if v_to.stage_code = 'ONBOARDING_COMPLETED' then
    raise exception 'Complete the onboarding handover before marking onboarding complete.';
  end if;
  for v_req in select jsonb_array_elements_text(v_to.required_fields) loop
    if v_req = 'service_added' and v_lead.initial_service_interest is null and not exists (
         select 1 from public.bd_lead_services s where s.lead_id = p_lead_id and s.service_status <> 'Rejected') then
      raise exception 'Add a service interest before moving this lead to %.', v_to.stage_name;
    elsif v_req = 'next_step' and v_lead.next_followup_at is null and nullif(btrim(v_lead.no_followup_reason), '') is null then
      raise exception 'Set the next follow-up date or document why no follow-up is required.';
    elsif v_req = 'proposed_fee' and not exists (
         select 1 from public.bd_lead_services s where s.lead_id = p_lead_id and s.proposed_fee_amount is not null) then
      raise exception 'Add a proposed fee to at least one service before advancing to %.', v_to.stage_name;
    elsif v_req = 'discussion_logged' and not exists (select 1 from public.bd_discussions d where d.lead_id = p_lead_id) then
      raise exception 'Log a discussion before moving this lead to %.', v_to.stage_name;
    elsif v_req = 'quote_recorded' and v_lead.quote_sent_at is null then
      raise exception 'Use Send quote & engagement to record the mail before moving this lead to %.', v_to.stage_name;
    elsif v_req = 'quotation_sent' and not exists (
         select 1 from public.bd_quotations q where q.lead_id = p_lead_id and q.status in ('Sent', 'Accepted')) then
      raise exception 'Send a quotation before moving this lead to %.', v_to.stage_name;
    end if;
  end loop;

  select * into v_from from public.bd_pipeline_stages where id = v_lead.stage_id;
  update public.bd_leads set
    stage_id = v_to.id,
    qualified_at = case when v_to.stage_code in ('CONVINCED', 'DOCUMENTS_RECEIVED', 'KYC_DONE', 'QUOTE_SENT')
                        then coalesce(qualified_at, now()) else qualified_at end,
    proposal_sent_at = case when v_to.stage_code = 'QUOTE_SENT' then coalesce(proposal_sent_at, now()) else proposal_sent_at end,
    updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_stage_history(v_lead, v_from.id, 'Open', p_reason);
  perform public.bd_audit('bd_leads', p_lead_id, 'Stage Change', jsonb_build_object('stage', v_from.stage_code),
                          jsonb_build_object('stage', v_to.stage_code), p_reason);
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- Reopen now defaults to Contact (Contact Established is retired).
create or replace function public.bd_reopen_lead(p_lead_id uuid, p_reason text, p_stage text default 'CONTACT')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_prev_status text;
  v_prev_stage uuid;
  v_to public.bd_pipeline_stages;
begin
  if not public.bd_is_manager() then raise exception 'Only a BD manager can reopen a lead.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A reason is required to reopen a lead.'; end if;
  select * into v_to from public.bd_pipeline_stages
  where is_active and not is_terminal and stage_code not in ('WON_PENDING_ONBOARDING')
    and (stage_name = p_stage or stage_code = p_stage);
  if not found then raise exception 'Select an open pipeline stage to reopen into.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status = 'Open' then raise exception 'This lead is already open.'; end if;
  if v_lead.converted_client_id is not null then raise exception 'A lead converted to a client cannot be reopened.'; end if;
  if exists (select 1 from public.bd_department_transfers t where t.lead_id = p_lead_id) then
    raise exception 'This lead was already transferred to a department and cannot be reopened.';
  end if;
  v_prev_status := v_lead.status;
  v_prev_stage := v_lead.stage_id;
  update public.bd_onboarding_handovers set status = 'Cancelled', updated_at = now()
  where lead_id = p_lead_id and status <> 'Cancelled';
  update public.bd_leads set status = 'Open', stage_id = v_to.id, won_at = null, lost_at = null, lost_reason_id = null,
    lost_notes = null, closing_user_id = null, hold_until = null, onboarding_status = 'Not Started',
    onboarding_handover_id = null, updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_stage_history(v_lead, v_prev_stage, v_prev_status, 'Reopened: ' || p_reason);
  perform public.bd_audit('bd_leads', p_lead_id, 'Reopen', jsonb_build_object('status', v_prev_status),
                          jsonb_build_object('status', 'Open', 'stage', v_to.stage_code), p_reason);
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- ── 6. Quote & engagement sent ───────────────────────────────────────
-- p: { quote_reference, engagement_reference, sent_to, sent_at, summary, next_followup_at }
-- The mail itself is sent from the user's mailbox; this records it on the lead and moves the stage.

create or replace function public.bd_record_quote_sent(p_lead_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_from public.bd_pipeline_stages;
  v_to public.bd_pipeline_stages;
  v_quote text := nullif(btrim(p->>'quote_reference'), '');
  v_engagement text := nullif(btrim(p->>'engagement_reference'), '');
  v_to_email text := nullif(btrim(p->>'sent_to'), '');
  v_sent timestamptz := coalesce(nullif(p->>'sent_at', '')::timestamptz, now());
  v_next timestamptz := nullif(p->>'next_followup_at', '')::timestamptz;
  v_summary text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to change this lead.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status <> 'Open' then raise exception 'Only an active lead can be sent a quote.'; end if;
  if v_lead.assigned_to_user_id is null then raise exception 'Assign the lead to someone first.'; end if;
  if v_quote is null or v_engagement is null then raise exception 'Enter the quotation and engagement letter references.'; end if;
  if v_to_email is null or v_to_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter the email address the quote was sent to.';
  end if;
  if not exists (select 1 from public.bd_lead_services s where s.lead_id = p_lead_id and s.proposed_fee_amount is not null
                 and s.service_status <> 'Rejected') then
    raise exception 'Add a proposed fee to at least one service before sending the quote.';
  end if;
  if v_next is null then raise exception 'Set the date to follow up on the quote.'; end if;

  v_summary := coalesce(nullif(btrim(p->>'summary'), ''),
    format('Quotation %s and engagement letter %s sent to %s.', v_quote, v_engagement, v_to_email));
  if length(v_summary) < 10 then v_summary := v_summary || ' (quote sent)'; end if;

  insert into public.bd_discussions (lead_id, occurred_at, channel, channel_detail, direction, contact_person, outcome,
    requirement_summary, discussion_summary, services_discussed, client_interest_level, agreed_next_action,
    next_followup_at, external_reference, recorded_by)
  values (p_lead_id, v_sent, 'Email', 'Email', 'Outbound', coalesce(v_lead.primary_contact_name, v_lead.prospect_name),
    'Quote sent', 'Quotation and engagement letter', v_summary,
    coalesce(array(select c.service_name from public.bd_lead_services s join public.bd_service_catalog c on c.id = s.service_id
                   where s.lead_id = p_lead_id and s.service_status <> 'Rejected'), '{}'),
    'Interested', 'Follow up on the quote and collect payment', v_next, left(v_quote || ' / ' || v_engagement, 255), auth.uid());

  insert into public.bd_followups (lead_id, assigned_to_user_id, followup_type, channel_detail, scheduled_at, objective,
                                   next_action, created_by)
  values (p_lead_id, v_lead.assigned_to_user_id, 'Email', 'Email', v_next, 'Follow up on quote & engagement letter',
          'Confirm acceptance and collect payment receipt', auth.uid());

  update public.bd_lead_services set service_status = 'Quoted', updated_at = now()
  where lead_id = p_lead_id and proposed_fee_amount is not null and service_status in ('Identifying', 'Interested');

  select * into v_from from public.bd_pipeline_stages where id = v_lead.stage_id;
  select * into v_to from public.bd_pipeline_stages where stage_code = 'QUOTE_SENT';
  update public.bd_leads set quote_reference = v_quote, engagement_reference = v_engagement, quote_sent_to = v_to_email,
    quote_sent_at = v_sent, stage_id = v_to.id, proposal_sent_at = coalesce(proposal_sent_at, v_sent),
    qualified_at = coalesce(qualified_at, v_sent), last_activity_at = now(), updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_refresh_next_followup(p_lead_id);
  if v_from.id is distinct from v_to.id then
    perform public.bd_stage_history(v_lead, v_from.id, 'Open', 'Quote & engagement sent');
  end if;
  perform public.bd_audit('bd_leads', p_lead_id, 'Stage Change', jsonb_build_object('stage', v_from.stage_code),
                          jsonb_build_object('stage', 'QUOTE_SENT', 'quote', v_quote, 'engagement', v_engagement, 'sent_to', v_to_email));
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- ── 7. Receipts and department transfers ─────────────────────────────

create table if not exists public.bd_payment_receipts (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null references public.bd_leads(id),
  amount         numeric(18,2) not null check (amount > 0),
  currency_code  char(3) not null default 'AED' check (currency_code ~ '^[A-Z]{3}$'),
  received_on    date not null,
  reference      varchar(255),
  file_path      text not null check (file_path like 'Business Development/receipts/%'),
  file_name      varchar(255),
  recorded_by    uuid not null references public.profiles(id),
  created_at     timestamptz not null default now()
);
create index if not exists bd_payment_receipts_lead_idx on public.bd_payment_receipts (lead_id);

create table if not exists public.bd_department_transfers (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.bd_leads(id),
  department    varchar(30) not null check (department in ('business_banking', 'business_setup', 'accounting')),
  target_table  varchar(60) not null,
  target_id     uuid not null,
  target_ref    varchar(60),
  owner_user_id uuid references public.profiles(id),
  services      text[] not null default '{}',
  transferred_by uuid not null references public.profiles(id),
  transferred_at timestamptz not null default now()
);
create index if not exists bd_department_transfers_lead_idx on public.bd_department_transfers (lead_id);

alter table public.bd_payment_receipts enable row level security;
alter table public.bd_department_transfers enable row level security;
revoke all on public.bd_payment_receipts, public.bd_department_transfers from anon;
revoke insert, update, delete on public.bd_payment_receipts, public.bd_department_transfers from authenticated;
grant select on public.bd_payment_receipts, public.bd_department_transfers to authenticated;
drop policy if exists bd_payment_receipts_read on public.bd_payment_receipts;
create policy bd_payment_receipts_read on public.bd_payment_receipts for select to authenticated
  using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_department_transfers_read on public.bd_department_transfers;
create policy bd_department_transfers_read on public.bd_department_transfers for select to authenticated
  using (public.bd_can_view_lead(lead_id));

-- Receipt files: BD users upload under "Business Development/receipts/<lead id>/"; only BD roles read them.
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists bd_receipts_insert on storage.objects';
    execute $p$create policy bd_receipts_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'hub-documents' and name like 'Business Development/receipts/%'
                  and public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'))$p$;
    execute 'drop policy if exists bd_receipts_read on storage.objects';
    execute $p$create policy bd_receipts_read on storage.objects as restrictive for select to authenticated
      using (bucket_id <> 'hub-documents' or name not like 'Business Development/receipts/%' or public.bd_current_role() is not null)$p$;
  end if;
end $$;

-- ── 8. Convert ───────────────────────────────────────────────────────
-- p: {
--   receipt: { amount, currency, received_on, reference, file_path, file_name },
--   accepted_services: [{ id, final_agreed_fee }],            -- the services the client paid for
--   confirmation_contact, handover_notes, idempotency_key,
--   transfers: [{ department: business_banking|business_setup|accounting, owner: uuid|null, services: [service names] }]
-- }

create or replace function public.bd_convert_lead(p_lead_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_r jsonb := coalesce(p->'receipt', '{}'::jsonb);
  v_amount numeric := nullif(v_r->>'amount', '')::numeric;
  v_path text := nullif(btrim(v_r->>'file_path'), '');
  v_svc jsonb;
  v_t jsonb;
  v_dept text;
  v_owner uuid;
  v_services text[];
  v_name text;
  v_notes text;
  v_target uuid;
  v_ref text;
  v_handover uuid;
  v_fee numeric;
  v_job_id uuid;
  v_job_no text;
  v_job_status text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to convert this lead.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status <> 'Open' then raise exception 'Only an active lead can be converted.'; end if;
  if v_lead.quote_sent_at is null then raise exception 'Send the quote & engagement letter before converting.'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount on the payment receipt.'; end if;
  if v_path is null or v_path not like 'Business Development/receipts/' || p_lead_id::text || '/%' then
    raise exception 'Upload the client''s payment receipt.';
  end if;
  if jsonb_typeof(p->'transfers') is distinct from 'array' or jsonb_array_length(p->'transfers') = 0 then
    raise exception 'Choose at least one department to transfer the lead to.';
  end if;

  -- the services the client paid for become Accepted with their agreed fee
  for v_svc in select * from jsonb_array_elements(coalesce(p->'accepted_services', '[]'::jsonb)) loop
    v_fee := nullif(v_svc->>'final_agreed_fee', '')::numeric;
    if v_fee is null or v_fee < 0 then raise exception 'Enter the agreed fee for each accepted service.'; end if;
    update public.bd_lead_services set service_status = 'Accepted', final_agreed_fee_amount = v_fee,
      billing_frequency = coalesce(billing_frequency, 'One-time'), accepted_at = coalesce(accepted_at, now()), updated_at = now()
    where id = (v_svc->>'id')::uuid and lead_id = p_lead_id and service_status <> 'Rejected';
    if not found then raise exception 'A selected service does not belong to this lead.'; end if;
  end loop;

  insert into public.bd_payment_receipts (lead_id, amount, currency_code, received_on, reference, file_path, file_name, recorded_by)
  values (p_lead_id, v_amount, coalesce(nullif(v_r->>'currency', ''), 'AED'),
          coalesce(nullif(v_r->>'received_on', '')::date, (now() at time zone 'Asia/Dubai')::date),
          nullif(btrim(v_r->>'reference'), ''), v_path, nullif(btrim(v_r->>'file_name'), ''), auth.uid());

  -- won + onboarding handover (checks the accepted services and the handover fields)
  perform public.bd_mark_lead_won(p_lead_id, jsonb_build_object(
    'confirmation_contact', p->>'confirmation_contact',
    'handover_notes', p->>'handover_notes',
    'agreement_reference', concat_ws(' / ', v_lead.quote_reference, v_lead.engagement_reference),
    'onboarding_queue', (select string_agg(case t->>'department' when 'business_banking' then 'Business Banking'
                                            when 'business_setup' then 'Business Setup' else 'Accounting' end, ', ')
                         from jsonb_array_elements(p->'transfers') t),
    'onboarding_owner', null,
    'idempotency_key', p->>'idempotency_key'));
  select onboarding_handover_id into v_handover from public.bd_leads where id = p_lead_id;

  v_name := v_lead.prospect_name;
  v_notes := concat_ws(E'\n',
    format('From Business Development lead %s (converted %s).', v_lead.lead_number, to_char(now() at time zone 'Asia/Dubai', 'DD Mon YYYY')),
    nullif(btrim(p->>'handover_notes'), ''),
    format('Payment received: %s %s%s.', coalesce(nullif(v_r->>'currency', ''), 'AED'), v_amount,
           coalesce(' (ref ' || nullif(btrim(v_r->>'reference'), '') || ')', '')));

  for v_t in select * from jsonb_array_elements(p->'transfers') loop
    v_dept := v_t->>'department';
    v_owner := nullif(v_t->>'owner', '')::uuid;
    v_services := coalesce(array(select jsonb_array_elements_text(coalesce(v_t->'services', '[]'::jsonb))), '{}');
    if v_dept not in ('business_banking', 'business_setup', 'accounting') then raise exception 'Unknown department %.', v_dept; end if;
    if v_owner is not null and not exists (select 1 from public.profiles where id = v_owner) then
      raise exception 'Select a valid lead owner for each department.';
    end if;
    if exists (select 1 from public.bd_department_transfers where lead_id = p_lead_id and department = v_dept) then
      continue;  -- a retried request does not create a second record
    end if;

    if v_dept = 'business_banking' then
      insert into public.banking_leads (company_name, contact_person, mobile, whatsapp, email, lead_source, assigned_to,
                                        initial_notes, follow_up_date, status, priority)
      values (coalesce(v_lead.company_name, v_name), v_lead.primary_contact_name,
              nullif(btrim(coalesce(v_lead.mobile_country_code || ' ', '') || coalesce(v_lead.mobile_number, '')), ''),
              v_lead.whatsapp_number, v_lead.email, 'Business Development', v_owner,
              concat_ws(E'\n', v_notes, case when cardinality(v_services) > 0 then 'Services: ' || array_to_string(v_services, ', ') end),
              ((now() at time zone 'Asia/Dubai')::date + 1), 'New',
              case v_lead.priority when 'Normal' then 'Medium' else v_lead.priority end)
      returning id, lead_ref into v_target, v_ref;
      insert into public.bd_department_transfers (lead_id, department, target_table, target_id, target_ref, owner_user_id, services, transferred_by)
      values (p_lead_id, v_dept, 'banking_leads', v_target, v_ref, v_owner, v_services, auth.uid());

    elsif v_dept = 'business_setup' then
      insert into public.business_setup_cases (stage, owner_id, source, bd_handover_id, lead_name, contact_person, phone, email,
                                               notes, created_by, updated_by)
      values ('Lead', v_owner, 'Business Development', v_handover, v_name, v_lead.primary_contact_name,
              nullif(btrim(coalesce(v_lead.mobile_country_code || ' ', '') || coalesce(v_lead.mobile_number, '')), ''),
              v_lead.email,
              concat_ws(E'\n', v_notes, case when cardinality(v_services) > 0 then 'Services: ' || array_to_string(v_services, ', ') end),
              auth.uid(), auth.uid())
      returning id, case_number into v_target, v_ref;
      perform public.business_setup_audit('business_setup_cases', v_target::text, 'case_new', null,
        jsonb_build_object('stage', 'Lead', 'lead_name', v_name, 'bd_lead', v_lead.lead_number, 'owner_id', v_owner));
      insert into public.bd_department_transfers (lead_id, department, target_table, target_id, target_ref, owner_user_id, services, transferred_by)
      values (p_lead_id, v_dept, 'business_setup_cases', v_target, v_ref, v_owner, v_services, auth.uid());

    else  -- accounting: one job per service, at the agreed fee
      if cardinality(v_services) = 0 then raise exception 'Choose the services Accounting will deliver.'; end if;
      for v_ref in select unnest(v_services) loop
        select s.final_agreed_fee_amount into v_fee
        from public.bd_lead_services s join public.bd_service_catalog c on c.id = s.service_id
        where s.lead_id = p_lead_id and c.service_name = v_ref and s.service_status = 'Accepted'
        order by s.created_at limit 1;
        insert into public.accounting_jobs (client_name, service_name, is_new_client, assignee_ids, fee_amount, remarks)
        values (v_name, v_ref, true, case when v_owner is not null then array[v_owner] else '{}'::uuid[] end, v_fee, v_notes)
        returning id, job_number, work_status into v_job_id, v_job_no, v_job_status;
        perform public.accounting_job_event(v_job_id, 'Created', null, v_job_status, 'From Business Development ' || v_lead.lead_number);
        insert into public.bd_department_transfers (lead_id, department, target_table, target_id, target_ref, owner_user_id, services, transferred_by)
        values (p_lead_id, v_dept, 'accounting_jobs', v_job_id, v_job_no, v_owner, array[v_ref], auth.uid());
      end loop;
    end if;
  end loop;

  update public.bd_onboarding_handovers set status = 'Accepted', accepted_at = coalesce(accepted_at, now()), updated_at = now()
  where id = v_handover and status = 'Pending';
  update public.bd_leads set onboarding_status = 'In Progress' where id = p_lead_id;
  perform public.bd_audit('bd_leads', p_lead_id, 'Convert', null,
    jsonb_build_object('receipt_amount', v_amount, 'transfers', p->'transfers'), 'Payment receipt recorded');
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- ── 9. UI JSON: quote, receipts and transfers ────────────────────────

do $$ begin
  if to_regprocedure('public.bd_lead_ui_core(uuid)') is null then
    alter function public.bd_lead_ui_json(uuid) rename to bd_lead_ui_core;
  end if;
end $$;

create or replace function public.bd_lead_ui_json(p_lead_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select core || jsonb_build_object(
    'quote_reference', l.quote_reference, 'engagement_reference', l.engagement_reference,
    'quote_sent_at', l.quote_sent_at, 'quote_sent_to', l.quote_sent_to,
    'unassigned', l.assigned_to_user_id is null,
    'bd_payment_receipts', coalesce((
      select jsonb_agg(jsonb_build_object('id', r.id, 'amount', case when public.bd_can_view_commercials() then r.amount end,
        'currency', r.currency_code, 'received_on', r.received_on, 'reference', r.reference, 'file_path', r.file_path,
        'file_name', r.file_name, 'recorded_by', r.recorded_by, 'created_at', r.created_at) order by r.created_at)
      from public.bd_payment_receipts r where r.lead_id = l.id), '[]'::jsonb),
    'bd_department_transfers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'department', t.department, 'target_table', t.target_table,
        'target_id', t.target_id, 'target_ref', t.target_ref, 'owner', t.owner_user_id, 'services', to_jsonb(t.services),
        'transferred_at', t.transferred_at) order by t.transferred_at)
      from public.bd_department_transfers t where t.lead_id = l.id), '[]'::jsonb))
  from (select public.bd_lead_ui_core(p_lead_id) as core) x
  join public.bd_leads l on l.id = p_lead_id
  where x.core is not null
$$;

-- ── 10. Function grants ──────────────────────────────────────────────

do $$
declare f text;
begin
  foreach f in array array['bd_assign_lead(uuid, uuid, text)', 'bd_record_quote_sent(uuid, jsonb)', 'bd_convert_lead(uuid, jsonb)',
                           'bd_lead_ui_json(uuid)', 'bd_create_lead(jsonb, jsonb, jsonb)', 'bd_change_stage(uuid, text, text)',
                           'bd_reopen_lead(uuid, text, text)', 'bd_can_view_lead(uuid)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  revoke all on function public.bd_lead_ui_core(uuid) from public, anon, authenticated;
end $$;
