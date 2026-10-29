-- =====================================================================
-- CRM Business Development (BD) backend - UI API layer             003
-- =====================================================================
-- APPLIED 29/10/2026 to Supabase pnnakrhfzyxudjaghoxx as migration bd_003_ui_api. Idempotent: safe to re-run.
-- Run after 001 and 002. Idempotent. Target: the CRM Supabase project
-- (needs auth.uid() and the `authenticated` role, which Supabase provides).
--
-- The BD UI (Main Module/src/components/BusinessDevelopment.jsx) talks to
-- Supabase directly. These SECURITY DEFINER functions keep the UI's call
-- names and payloads (ported from the retired Main Module/db/
-- business_development.sql) but read and write the spec schema from 001:
--
--   bd_ui_leads()                             leads + services, discussions, follow-ups, handover, in UI shape
--   bd_create_lead(lead, activity, followup)  quick capture: lead + first discussion + follow-up + stage history
--   bd_log_activity(activity)                 discussion (+ follow-up when a date is given)
--   bd_create_followup(followup)
--   bd_complete_followup(id, completion)
--   bd_save_service(service)                  add / edit a service opportunity (was a direct table write)
--   bd_change_stage(lead_id, stage)           stage change + history (was a direct table write)
--   bd_mark_lead_won(lead_id, handover)       Won + onboarding handover, one transaction, retry-safe
--   bd_mark_lead_lost(lead_id, reason, notes)
--   bd_reopen_lead(lead_id, reason, stage)    managers only (no UI yet)
--
-- Writes go only through these functions: row-level security gives the
-- `authenticated` role read access and no direct insert/update/delete on
-- BD data tables. UI vocabulary (status 'active', priority 'Medium',
-- channel 'Phone Call', billing 'one_time' ...) is translated here.
-- =====================================================================

-- ── 1. Roles and permissions ─────────────────────────────────────────

-- Every CRM profile gets a BD role: CRM admins -> super_admin, everyone else -> sales_executive
insert into public.bd_user_roles (user_id, role)
select p.id, case when p.role = 'admin' then 'super_admin' else 'sales_executive' end
from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.bd_sync_user_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.role = 'admin' then
    insert into public.bd_user_roles (user_id, role) values (new.id, 'super_admin')
    on conflict (user_id) do update set role = 'super_admin', updated_at = now();
  elsif tg_op = 'UPDATE' then
    if old.role = 'admin' then
      update public.bd_user_roles set role = 'sales_executive', updated_at = now()
      where user_id = new.id and role = 'super_admin';
    end if;
  else
    insert into public.bd_user_roles (user_id, role) values (new.id, 'sales_executive')
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;
drop trigger if exists bd_profiles_role_sync_insert on public.profiles;
create trigger bd_profiles_role_sync_insert after insert on public.profiles
  for each row execute function public.bd_sync_user_role();
drop trigger if exists bd_profiles_role_sync_update on public.profiles;
create trigger bd_profiles_role_sync_update after update of role on public.profiles
  for each row execute function public.bd_sync_user_role();

create or replace function public.bd_current_role(p_user_id uuid default auth.uid())
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when p_user_id is distinct from auth.uid()
      and not exists (select 1 from public.bd_user_roles r where r.user_id = auth.uid() and r.role = 'super_admin')
      and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then null
    else coalesce(
      (select r.role from public.bd_user_roles r where r.user_id = p_user_id),
      (select case when p.role = 'admin' then 'super_admin' end from public.profiles p where p.id = p_user_id))
  end
$$;

create or replace function public.bd_is_manager()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader'), false)
$$;

create or replace function public.bd_can_view_commercials()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select r.can_view_commercials from public.bd_user_roles r where r.user_id = auth.uid()),
                  public.bd_current_role() = 'super_admin', false)
$$;

create or replace function public.bd_can_view_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.bd_leads l
    where l.id = p_lead_id
      and (public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'marketing_executive',
                                        'onboarding_executive', 'management', 'read_only')
           or l.assigned_to_user_id = auth.uid() or l.acquired_by_user_id = auth.uid()))
$$;

create or replace function public.bd_can_edit_lead(p_lead_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select auth.uid() is not null and exists (
    select 1 from public.bd_leads l
    where l.id = p_lead_id
      and (public.bd_is_manager()
           or (public.bd_current_role() in ('sales_executive', 'marketing_executive')
               and (l.assigned_to_user_id = auth.uid() or l.acquired_by_user_id = auth.uid()))))
$$;

-- ── 2. Vocabulary: UI value <-> stored value ─────────────────────────

create or replace function public.bd_ui_status(p text) returns text language sql immutable as $$
  select case p when 'Open' then 'active' else lower(replace(p, ' ', '_')) end
$$;

create or replace function public.bd_channel_code(p text) returns text language sql immutable as $$
  select case
    when p in ('Call', 'Phone Call') then 'Call'
    when p = 'WhatsApp' then 'WhatsApp'
    when p = 'Email' then 'Email'
    when p in ('Meeting', 'Face-to-Face Meeting', 'Video Meeting') then 'Meeting'
    when p in ('Social', 'Instagram / Social Media') then 'Social'
    else 'Other' end
$$;

create or replace function public.bd_billing_code(p text) returns text language sql immutable as $$
  select case lower(coalesce(p, ''))
    when 'one_time' then 'One-time' when 'one-time' then 'One-time'
    when 'monthly' then 'Monthly' when 'quarterly' then 'Quarterly'
    when 'annually' then 'Annual' when 'annual' then 'Annual'
    when 'other' then 'Other' else null end
$$;

create or replace function public.bd_ui_billing(p text) returns text language sql immutable as $$
  select case p when 'One-time' then 'one_time' when 'Annual' then 'annually' else lower(p) end
$$;

-- Rejects empty and generic notes such as "Called client"
create or replace function public.bd_is_meaningful(p text, p_min integer default 20)
returns boolean language sql immutable as $$
  select length(btrim(coalesce(p, ''))) >= p_min
     and lower(btrim(p)) not in ('called client', 'called customer', 'followed up', 'spoke to client',
                                 'no answer', 'sent email', 'call back', 'will follow up', 'discussed')
$$;

-- ── 3. Internal helpers ──────────────────────────────────────────────

create sequence if not exists public.bd_campaign_number_seq;

create or replace function public.bd_audit(p_entity text, p_id uuid, p_action text,
                                           p_prev jsonb default null, p_new jsonb default null, p_reason text default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.bd_audit_logs (entity_type, entity_id, action, changed_by_user_id, previous_values, new_values, reason,
                                    request_reference)
  values (p_entity, p_id, p_action, auth.uid(), p_prev, p_new, p_reason,
          nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id')
$$;

-- The lead's next follow-up is always the earliest open follow-up
create or replace function public.bd_refresh_next_followup(p_lead_id uuid)
returns timestamptz language sql security definer set search_path = public, pg_temp as $$
  update public.bd_leads l
  set next_followup_at = (select min(f.scheduled_at) from public.bd_followups f
                          where f.lead_id = l.id and f.status in ('Scheduled', 'Rescheduled'))
  where l.id = p_lead_id
  returning next_followup_at
$$;

create or replace function public.bd_stage_history(p_lead public.bd_leads, p_from uuid, p_from_status text,
                                                   p_reason text, p_meta jsonb default null)
returns void language sql security definer set search_path = public, pg_temp as $$
  insert into public.bd_lead_stage_history (lead_id, from_stage_id, to_stage_id, from_status, to_status,
                                            changed_by_user_id, reason, duration_in_previous_stage_seconds,
                                            transition_metadata)
  select p_lead.id, p_from, p_lead.stage_id, p_from_status, p_lead.status, auth.uid(), p_reason,
         (select extract(epoch from now() - max(h.changed_at))::bigint
          from public.bd_lead_stage_history h where h.lead_id = p_lead.id),
         p_meta
$$;

create or replace function public.bd_close_open_followups(p_lead_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.bd_followup_history (followup_id, action, previous_scheduled_at, reason, changed_by_user_id)
  select f.id, 'Cancelled', f.scheduled_at, p_reason, auth.uid()
  from public.bd_followups f where f.lead_id = p_lead_id and f.status in ('Scheduled', 'Rescheduled');
  update public.bd_followups set status = 'Cancelled', updated_at = now()
  where lead_id = p_lead_id and status in ('Scheduled', 'Rescheduled');
  perform public.bd_refresh_next_followup(p_lead_id);
end $$;

-- One lead in the shape the UI reads (column names of the retired UI schema)
create or replace function public.bd_lead_ui_json(p_lead_id uuid)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with c as (select public.bd_can_view_commercials() as ok)
  select jsonb_build_object(
    'id', l.id, 'lead_id', l.lead_number, 'lead_number', l.lead_number,
    'lead_type', lower(l.lead_type), 'name', l.prospect_name, 'company_name', l.company_name,
    'contact_name', l.primary_contact_name, 'designation', l.designation,
    'mobile', nullif(btrim(coalesce(l.mobile_country_code || ' ', '') || coalesce(l.mobile_number, '')), ''),
    'email', l.email, 'whatsapp', l.whatsapp_number, 'country', l.country, 'emirate', l.emirate,
    'website', l.website, 'source', s.source_name, 'source_code', s.source_code, 'source_detail', l.source_detail,
    'campaign_name', cp.campaign_name, 'referrer_name', l.referrer_name,
    'acquired_by', l.acquired_by_user_id, 'current_owner', l.assigned_to_user_id, 'closed_by', l.closing_user_id,
    'acquired_at', l.acquired_on, 'case_opened_at', l.case_opened_at
  ) || jsonb_build_object(  -- split: a function call takes at most 100 arguments
    'initial_service_interest', l.initial_service_interest ->> 0, 'initial_summary', l.initial_discussion_summary,
    'next_followup_at', l.next_followup_at, 'no_followup_reason', l.no_followup_reason,
    'estimated_budget', case when c.ok then l.estimated_budget end, 'budget_currency', l.budget_currency,
    'priority', case l.priority when 'Normal' then 'Medium' else l.priority end,
    'notes', l.internal_notes, 'stage', st.stage_name, 'stage_code', st.stage_code,
    'progress_weight', st.progress_weight, 'status', public.bd_ui_status(l.status),
    'duplicate_exception', l.duplicate_override, 'won_at', l.won_at,
    'won_value', case when c.ok then wv.total end, 'won_currency', wv.currency,
    'lost_at', l.lost_at, 'lost_reason', lr.reason_name, 'lost_notes', l.lost_notes,
    'hold_until', l.hold_until, 'converted_client_id', l.converted_client_id,
    'onboarding_status', l.onboarding_status,
    'created_by', l.created_by, 'created_at', l.created_at, 'updated_at', l.updated_at,
    'bd_lead_services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sv.id, 'lead_id', sv.lead_id, 'service_name', cat.service_name, 'service_code', cat.service_code,
        'service_category', cat.service_category, 'requirements', sv.scope_description,
        'quantity_scope', sv.quantity_scope, 'billing_frequency', public.bd_ui_billing(sv.billing_frequency),
        'currency', sv.currency_code,
        'client_budget', case when c.ok then sv.client_budget_amount end,
        'initial_estimated_fee', case when c.ok then sv.estimated_fee_amount end,
        'proposed_fee', case when c.ok then sv.proposed_fee_amount end,
        'final_agreed_fee', case when c.ok then sv.final_agreed_fee_amount end,
        'discount', case when c.ok then sv.discount_amount end,
        'quotation_reference', sv.quotation_reference, 'status', public.bd_ui_status(sv.service_status),
        'expected_start_date', sv.expected_start_date, 'expected_closing_date', sv.expected_close_date,
        'notes', sv.notes, 'created_at', sv.created_at, 'updated_at', sv.updated_at) order by sv.created_at)
      from public.bd_lead_services sv join public.bd_service_catalog cat on cat.id = sv.service_id
      where sv.lead_id = l.id), '[]'::jsonb),
    'bd_lead_activities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'lead_id', d.lead_id, 'occurred_at', d.occurred_at, 'channel', coalesce(d.channel_detail, d.channel),
        'direction', lower(d.direction), 'contact_person', d.contact_person, 'summary', d.discussion_summary,
        'requirement', d.requirement_summary, 'services_discussed', to_jsonb(d.services_discussed),
        'interest_level', d.client_interest_level, 'objections', d.objections, 'next_action', d.agreed_next_action,
        'next_followup_at', d.next_followup_at, 'no_followup_reason', d.no_followup_reason,
        'external_reference', d.external_reference, 'recorded_by', d.recorded_by, 'created_at', d.created_at)
        order by d.occurred_at desc)
      from public.bd_discussions d where d.lead_id = l.id), '[]'::jsonb),
    'bd_lead_followups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'lead_id', f.lead_id, 'service_id', f.lead_service_id, 'planned_at', f.scheduled_at,
        'channel', coalesce(f.channel_detail, f.followup_type), 'assigned_to', f.assigned_to_user_id,
        'objective', f.objective, 'previous_outcome', f.previous_outcome, 'next_action', f.next_action,
        'status', lower(f.status), 'completed_at', f.completed_at, 'discussion_summary', f.completion_summary,
        'next_followup_at', f.next_followup_at, 'created_at', f.created_at, 'updated_at', f.updated_at)
        order by f.scheduled_at)
      from public.bd_followups f where f.lead_id = l.id), '[]'::jsonb),
    'bd_onboarding_handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'lead_id', h.lead_id, 'handover_number', h.handover_number,
        'confirmation_contact', h.confirmation_contact, 'agreement_reference', h.agreement_reference,
        'handover_notes', h.handover_notes, 'onboarding_owner', h.assigned_onboarding_user_id,
        'onboarding_queue', h.onboarding_queue, 'status', public.bd_ui_status(h.status),
        'client_master_id', h.client_id, 'handed_over_by', h.handed_over_by, 'handed_over_at', h.handed_over_at,
        'completed_at', h.completed_at) order by h.created_at desc)
      from public.bd_onboarding_handovers h where h.lead_id = l.id and h.status <> 'Cancelled'), '[]'::jsonb))
  from public.bd_leads l
  cross join c
  join public.bd_lead_sources s on s.id = l.source_id
  join public.bd_pipeline_stages st on st.id = l.stage_id
  left join public.bd_campaigns cp on cp.id = l.campaign_id
  left join public.bd_lost_reasons lr on lr.id = l.lost_reason_id
  left join lateral (
    select case when count(distinct sv.currency_code) = 1 then sum(sv.final_agreed_fee_amount) end as total,
           case when count(distinct sv.currency_code) = 1 then min(sv.currency_code) end as currency
    from public.bd_lead_services sv
    where sv.lead_id = l.id and sv.service_status = 'Accepted' and sv.final_agreed_fee_amount is not null) wv on true
  where l.id = p_lead_id and public.bd_can_view_lead(p_lead_id)
$$;

-- ── 4. Read: the UI's lead list ──────────────────────────────────────

create or replace function public.bd_ui_leads(p_limit integer default 500)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(public.bd_lead_ui_json(x.id) order by x.created_at desc), '[]'::jsonb)
  from (select l.id, l.created_at from public.bd_leads l
        where l.archived_at is null and public.bd_can_view_lead(l.id)
        order by l.created_at desc limit least(greatest(coalesce(p_limit, 500), 1), 2000)) x
$$;

-- ── 5. Create lead (quick capture) ───────────────────────────────────

create or replace function public.bd_create_lead(p_lead jsonb, p_activity jsonb, p_followup jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role text := public.bd_current_role();
  v_type text := initcap(coalesce(nullif(p_lead->>'lead_type', ''), 'company'));
  v_name text := btrim(coalesce(p_lead->>'name', ''));
  v_mobile text := nullif(btrim(p_lead->>'mobile'), '');
  v_email text := nullif(btrim(p_lead->>'email'), '');
  v_acq uuid := nullif(p_lead->>'acquired_by', '')::uuid;
  v_owner uuid := nullif(p_lead->>'current_owner', '')::uuid;
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
  if v_acq is null or v_owner is null then
    raise exception 'Select the employee who acquired the lead and its current owner.';
  end if;
  if not public.bd_is_manager() and (v_acq <> auth.uid() or v_owner <> auth.uid()) then
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
    v_acq, v_owner, (select id from public.bd_pipeline_stages where stage_code = 'NEW_LEAD'), 'Open',
    case coalesce(p_lead->>'priority', 'Medium') when 'Medium' then 'Normal' else p_lead->>'priority' end,
    case when v_interest is not null then jsonb_build_array(v_interest) end,
    v_summary, coalesce(nullif(p_lead->>'acquired_at', '')::date, (now() at time zone 'Asia/Dubai')::date),
    nullif(p_lead->>'estimated_budget', '')::numeric, coalesce(nullif(p_lead->>'budget_currency', ''), 'AED'),
    nullif(btrim(p_lead->>'notes'), ''), v_dup, v_occurred, v_occurred, auth.uid(), auth.uid())
  returning * into v_lead;

  perform public.bd_stage_history(v_lead, null, null, 'Lead created');

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

  insert into public.bd_followups (lead_id, discussion_id, assigned_to_user_id, followup_type, channel_detail,
                                   scheduled_at, objective, next_action, created_by)
  values (v_lead.id, v_disc, v_owner,
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

-- ── 6. Discussions and follow-ups ────────────────────────────────────

create or replace function public.bd_log_activity(p_activity jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_next timestamptz := nullif(p_activity->>'next_followup_at', '')::timestamptz;
  v_reason text := nullif(btrim(p_activity->>'no_followup_reason'), '');
  v_channel text := coalesce(nullif(p_activity->>'channel', ''), 'Other');
  v_action text := nullif(btrim(p_activity->>'next_action'), '');
  v_occurred timestamptz := coalesce(nullif(p_activity->>'occurred_at', '')::timestamptz, now());
  v_disc uuid;
begin
  if not public.bd_can_edit_lead((p_activity->>'lead_id')::uuid) then
    raise exception 'You do not have permission to log activity for this lead.';
  end if;
  select * into v_lead from public.bd_leads where id = (p_activity->>'lead_id')::uuid for update;
  if v_lead.status <> 'Open' then raise exception 'Activity can only be logged for an active lead.'; end if;
  if not public.bd_is_meaningful(p_activity->>'summary') then raise exception 'Enter a meaningful discussion summary.'; end if;
  if v_action is null then raise exception 'Record the agreed next action.'; end if;
  if v_next is null and v_reason is null then
    raise exception 'Set a follow-up date or document why no follow-up is required.';
  end if;

  insert into public.bd_discussions (
    lead_id, occurred_at, channel, channel_detail, direction, contact_person, requirement_summary, discussion_summary,
    services_discussed, client_interest_level, objections, agreed_next_action, next_followup_at, no_followup_reason,
    external_reference, recorded_by)
  values (
    v_lead.id, v_occurred, public.bd_channel_code(v_channel), v_channel,
    initcap(coalesce(nullif(p_activity->>'direction', ''), 'outbound')), nullif(btrim(p_activity->>'contact_person'), ''),
    coalesce(nullif(btrim(p_activity->>'requirement'), ''), v_lead.initial_service_interest ->> 0, 'Not yet identified'),
    btrim(p_activity->>'summary'),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_activity->'services_discussed', '[]'::jsonb))), '{}'),
    nullif(p_activity->>'interest_level', ''), nullif(btrim(p_activity->>'objections'), ''), v_action, v_next,
    case when v_next is null then v_reason end, nullif(btrim(p_activity->>'external_reference'), ''), auth.uid())
  returning id into v_disc;

  if v_next is not null then
    insert into public.bd_followups (lead_id, discussion_id, assigned_to_user_id, followup_type, channel_detail,
                                     scheduled_at, objective, previous_outcome, next_action, created_by)
    values (v_lead.id, v_disc, v_lead.assigned_to_user_id,
            case public.bd_channel_code(v_channel) when 'Social' then 'Other' else public.bd_channel_code(v_channel) end,
            v_channel, v_next, v_action, btrim(p_activity->>'summary'), v_action, auth.uid());
  end if;
  update public.bd_leads
  set last_activity_at = greatest(coalesce(last_activity_at, v_occurred), v_occurred),
      first_contact_at = coalesce(first_contact_at, v_occurred),
      no_followup_reason = case when v_next is null then v_reason end,
      updated_by = auth.uid()
  where id = v_lead.id;
  perform public.bd_refresh_next_followup(v_lead.id);
  perform public.bd_audit('bd_discussions', v_disc, 'Create', null,
                          jsonb_build_object('lead_id', v_lead.id, 'channel', v_channel, 'next_followup_at', v_next));
  return public.bd_lead_ui_json(v_lead.id);
end $$;

create or replace function public.bd_create_followup(p_followup jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_channel text := coalesce(nullif(p_followup->>'channel', ''), 'Other');
  v_id uuid;
begin
  if not public.bd_can_edit_lead((p_followup->>'lead_id')::uuid) then
    raise exception 'You do not have permission to schedule a follow-up for this lead.';
  end if;
  select * into v_lead from public.bd_leads where id = (p_followup->>'lead_id')::uuid for update;
  if v_lead.status <> 'Open' then raise exception 'Follow-ups can only be scheduled for active leads.'; end if;
  if nullif(btrim(coalesce(p_followup->>'objective', '')), '') is null
     or nullif(btrim(coalesce(p_followup->>'next_action', '')), '') is null
     or nullif(p_followup->>'planned_at', '') is null then
    raise exception 'A planned date, objective, and next action are required.';
  end if;
  insert into public.bd_followups (lead_id, assigned_to_user_id, followup_type, channel_detail, scheduled_at, objective,
                                   previous_outcome, next_action, created_by)
  values (v_lead.id, coalesce(nullif(p_followup->>'assigned_to', '')::uuid, v_lead.assigned_to_user_id),
          case public.bd_channel_code(v_channel) when 'Social' then 'Other' else public.bd_channel_code(v_channel) end,
          v_channel, (p_followup->>'planned_at')::timestamptz, btrim(p_followup->>'objective'),
          nullif(btrim(p_followup->>'previous_outcome'), ''), btrim(p_followup->>'next_action'), auth.uid())
  returning id into v_id;
  update public.bd_leads set no_followup_reason = null, updated_by = auth.uid() where id = v_lead.id;
  perform public.bd_refresh_next_followup(v_lead.id);
  perform public.bd_audit('bd_followups', v_id, 'Create', null, p_followup);
  return public.bd_lead_ui_json(v_lead.id);
end $$;

create or replace function public.bd_complete_followup(p_followup_id uuid, p_completion jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_f public.bd_followups;
  v_lead public.bd_leads;
  v_next timestamptz := nullif(p_completion->>'next_followup_at', '')::timestamptz;
  v_action text := nullif(btrim(p_completion->>'next_action'), '');
  v_reason text := nullif(btrim(p_completion->>'no_followup_reason'), '');
  v_other boolean;
begin
  select * into v_f from public.bd_followups where id = p_followup_id for update;
  if not found or not public.bd_can_edit_lead(v_f.lead_id) then
    raise exception 'You do not have permission to complete this follow-up.';
  end if;
  if v_f.status in ('Completed', 'Cancelled') then raise exception 'This follow-up is already closed.'; end if;
  if not public.bd_is_meaningful(p_completion->>'discussion_summary') then
    raise exception 'A meaningful follow-up completion summary is required.';
  end if;
  if v_next is not null and v_action is null then raise exception 'A next action is required with the next follow-up date.'; end if;
  select exists (select 1 from public.bd_followups where lead_id = v_f.lead_id and id <> v_f.id
                 and status in ('Scheduled', 'Rescheduled')) into v_other;
  if v_next is null and not v_other and v_reason is null then
    raise exception 'Set another follow-up date or explain why no further follow-up is required.';
  end if;

  update public.bd_followups
  set status = 'Completed', completed_at = now(), outcome = 'Completed',
      completion_summary = btrim(p_completion->>'discussion_summary'),
      next_action = coalesce(v_action, next_action), next_followup_at = v_next, updated_at = now()
  where id = v_f.id;
  insert into public.bd_followup_history (followup_id, action, previous_scheduled_at, reason, changed_by_user_id)
  values (v_f.id, 'Completed', v_f.scheduled_at, btrim(p_completion->>'discussion_summary'), auth.uid());

  select * into v_lead from public.bd_leads where id = v_f.lead_id for update;
  if v_next is not null then
    insert into public.bd_followups (lead_id, lead_service_id, assigned_to_user_id, followup_type, channel_detail,
                                     scheduled_at, objective, previous_outcome, next_action, created_by)
    values (v_lead.id, v_f.lead_service_id, v_lead.assigned_to_user_id, v_f.followup_type, v_f.channel_detail, v_next,
            v_action, btrim(p_completion->>'discussion_summary'), v_action, auth.uid());
  end if;
  update public.bd_leads
  set last_activity_at = now(), first_contact_at = coalesce(first_contact_at, now()),
      no_followup_reason = case when v_next is null and not v_other then v_reason end, updated_by = auth.uid()
  where id = v_lead.id;
  perform public.bd_refresh_next_followup(v_lead.id);
  return public.bd_lead_ui_json(v_lead.id);
end $$;

-- ── 7. Services ──────────────────────────────────────────────────────

create or replace function public.bd_save_service(p_service jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p_service->>'id', '')::uuid;
  v_old public.bd_lead_services;
  v_lead public.bd_leads;
  v_cat uuid;
  v_status text := initcap(replace(coalesce(nullif(p_service->>'status', ''), 'identifying'), '_', ' '));
  v_new public.bd_lead_services;
begin
  if v_id is not null then
    select * into v_old from public.bd_lead_services where id = v_id for update;
    if not found then raise exception 'Service not found.'; end if;
  end if;
  select * into v_lead from public.bd_leads
  where id = coalesce(v_old.lead_id, nullif(p_service->>'lead_id', '')::uuid) for update;
  if not found or not public.bd_can_edit_lead(v_lead.id) then
    raise exception 'You do not have permission to change services on this lead.';
  end if;
  if v_lead.status = 'Won' then raise exception 'Commercial service terms cannot be changed after the lead is marked won.'; end if;
  if v_lead.status <> 'Open' then raise exception 'Services can only be changed on an active lead.'; end if;
  select id into v_cat from public.bd_service_catalog
  where is_active and (service_name = p_service->>'service_name' or service_code = p_service->>'service_name');
  if v_cat is null then raise exception 'Select a service from the service catalog.'; end if;
  if v_status = 'Accepted' and (nullif(p_service->>'final_agreed_fee', '') is null
                                or public.bd_billing_code(p_service->>'billing_frequency') is null) then
    raise exception 'An accepted service needs the final agreed fee and billing frequency.';
  end if;

  if v_id is null then
    insert into public.bd_lead_services (
      lead_id, service_id, service_status, scope_description, quantity_scope, billing_frequency, currency_code,
      client_budget_amount, estimated_fee_amount, proposed_fee_amount, final_agreed_fee_amount, discount_amount,
      quotation_reference, expected_start_date, expected_close_date, accepted_at, rejected_at, notes, created_by)
    values (
      v_lead.id, v_cat, v_status, nullif(btrim(p_service->>'requirements'), ''), nullif(btrim(p_service->>'quantity_scope'), ''),
      public.bd_billing_code(p_service->>'billing_frequency'), coalesce(nullif(p_service->>'currency', ''), 'AED'),
      nullif(p_service->>'client_budget', '')::numeric, nullif(p_service->>'initial_estimated_fee', '')::numeric,
      nullif(p_service->>'proposed_fee', '')::numeric, nullif(p_service->>'final_agreed_fee', '')::numeric,
      nullif(p_service->>'discount', '')::numeric, nullif(btrim(p_service->>'quotation_reference'), ''),
      nullif(p_service->>'expected_start_date', '')::date, nullif(p_service->>'expected_closing_date', '')::date,
      case when v_status = 'Accepted' then now() end, case when v_status = 'Rejected' then now() end,
      nullif(btrim(p_service->>'notes'), ''), auth.uid())
    returning * into v_new;
    perform public.bd_audit('bd_lead_services', v_new.id, 'Create', null, to_jsonb(v_new));
  else
    update public.bd_lead_services set
      service_id = v_cat, service_status = v_status, scope_description = nullif(btrim(p_service->>'requirements'), ''),
      quantity_scope = nullif(btrim(p_service->>'quantity_scope'), ''),
      billing_frequency = public.bd_billing_code(p_service->>'billing_frequency'),
      currency_code = coalesce(nullif(p_service->>'currency', ''), 'AED'),
      client_budget_amount = nullif(p_service->>'client_budget', '')::numeric,
      estimated_fee_amount = nullif(p_service->>'initial_estimated_fee', '')::numeric,
      proposed_fee_amount = nullif(p_service->>'proposed_fee', '')::numeric,
      final_agreed_fee_amount = nullif(p_service->>'final_agreed_fee', '')::numeric,
      discount_amount = nullif(p_service->>'discount', '')::numeric,
      quotation_reference = nullif(btrim(p_service->>'quotation_reference'), ''),
      expected_start_date = nullif(p_service->>'expected_start_date', '')::date,
      expected_close_date = nullif(p_service->>'expected_closing_date', '')::date,
      accepted_at = case when v_status = 'Accepted' then coalesce(accepted_at, now()) end,
      rejected_at = case when v_status = 'Rejected' then coalesce(rejected_at, now()) end,
      notes = nullif(btrim(p_service->>'notes'), ''), updated_at = now()
    where id = v_id returning * into v_new;
    perform public.bd_audit('bd_lead_services', v_new.id, 'Update', to_jsonb(v_old), to_jsonb(v_new));
  end if;
  update public.bd_leads set last_activity_at = now(), updated_by = auth.uid() where id = v_lead.id;
  return public.bd_lead_ui_json(v_lead.id);
end $$;

-- ── 8. Stage change ──────────────────────────────────────────────────

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
  select * into v_to from public.bd_pipeline_stages where is_active and (stage_name = p_stage or stage_code = p_stage);
  if not found then raise exception 'Select a valid pipeline stage.'; end if;
  if v_to.id = v_lead.stage_id then return public.bd_lead_ui_json(p_lead_id); end if;
  if v_to.stage_code = 'WON_PENDING_ONBOARDING' then
    raise exception 'Use the won workflow to move a lead to onboarding handover.';
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
    elsif v_req = 'quotation_sent' and not exists (
         select 1 from public.bd_quotations q where q.lead_id = p_lead_id and q.status in ('Sent', 'Accepted')) then
      raise exception 'Send a quotation before moving this lead to %.', v_to.stage_name;
    end if;
  end loop;

  select * into v_from from public.bd_pipeline_stages where id = v_lead.stage_id;
  update public.bd_leads set
    stage_id = v_to.id,
    qualified_at = case when v_to.stage_order >= 6 then coalesce(qualified_at, now()) else qualified_at end,
    proposal_sent_at = case when v_to.stage_order >= 8 then coalesce(proposal_sent_at, now()) else proposal_sent_at end,
    updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_stage_history(v_lead, v_from.id, 'Open', p_reason);
  perform public.bd_audit('bd_leads', p_lead_id, 'Stage Change', jsonb_build_object('stage', v_from.stage_code),
                          jsonb_build_object('stage', v_to.stage_code), p_reason);
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- ── 9. Won, lost, reopen ─────────────────────────────────────────────

create or replace function public.bd_mark_lead_won(p_lead_id uuid, p_handover jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_prev_stage uuid;
  v_prev_status text;
  v_accepted integer;
  v_handover uuid;
  v_key text := nullif(btrim(p_handover->>'idempotency_key'), '');
begin
  if v_key is not null then  -- a retried request returns the result of the first one
    select lead_id into v_handover from public.bd_onboarding_handovers where idempotency_key = v_key;
    if v_handover is not null then return public.bd_lead_ui_json(v_handover); end if;
  end if;
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to close this lead.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status not in ('Open', 'On Hold') then raise exception 'Only an active lead can be marked won.'; end if;
  if nullif(btrim(coalesce(p_handover->>'confirmation_contact', '')), '') is null
     or nullif(btrim(coalesce(p_handover->>'handover_notes', '')), '') is null then
    raise exception 'A confirmation contact and handover notes are required.';
  end if;
  select count(*) into v_accepted from public.bd_lead_services
  where lead_id = p_lead_id and service_status = 'Accepted' and final_agreed_fee_amount is not null
    and billing_frequency is not null;
  if v_accepted = 0 then
    raise exception 'Add at least one accepted service with a final agreed fee before closing as won.';
  end if;

  v_prev_stage := v_lead.stage_id;
  v_prev_status := v_lead.status;
  update public.bd_leads set
    status = 'Won', won_at = now(), closing_user_id = auth.uid(), onboarding_status = 'Pending',
    stage_id = (select id from public.bd_pipeline_stages where stage_code = 'WON_PENDING_ONBOARDING'),
    hold_until = null, updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_stage_history(v_lead, v_prev_stage, v_prev_status, 'Marked won');

  insert into public.bd_onboarding_handovers (
    lead_id, status, won_at, handed_over_at, handed_over_by, assigned_onboarding_user_id, onboarding_queue,
    handover_notes, confirmation_contact, agreement_reference, idempotency_key, source_snapshot)
  values (
    p_lead_id, 'Pending', v_lead.won_at, now(), auth.uid(), nullif(p_handover->>'onboarding_owner', '')::uuid,
    coalesce(nullif(btrim(p_handover->>'onboarding_queue'), ''), 'Client Onboarding Queue'),
    btrim(p_handover->>'handover_notes'), btrim(p_handover->>'confirmation_contact'),
    nullif(btrim(p_handover->>'agreement_reference'), ''), v_key,
    jsonb_build_object('lead', to_jsonb(v_lead), 'accepted_services', (
      select jsonb_agg(jsonb_build_object('service', c.service_name, 'fee', s.final_agreed_fee_amount,
                                          'currency', s.currency_code, 'billing_frequency', s.billing_frequency))
      from public.bd_lead_services s join public.bd_service_catalog c on c.id = s.service_id
      where s.lead_id = p_lead_id and s.service_status = 'Accepted')))
  on conflict (lead_id) where status <> 'Cancelled' do nothing
  returning id into v_handover;
  if v_handover is null then
    select id into v_handover from public.bd_onboarding_handovers where lead_id = p_lead_id and status <> 'Cancelled';
  end if;
  update public.bd_leads set onboarding_handover_id = v_handover where id = p_lead_id;
  perform public.bd_close_open_followups(p_lead_id, 'Lead won');
  perform public.bd_audit('bd_leads', p_lead_id, 'Convert', jsonb_build_object('status', v_prev_status),
                          jsonb_build_object('status', 'Won', 'handover_id', v_handover));
  return public.bd_lead_ui_json(p_lead_id);
end $$;

create or replace function public.bd_mark_lead_lost(p_lead_id uuid, p_reason text, p_notes text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_lead public.bd_leads;
  v_reason public.bd_lost_reasons;
  v_prev_status text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to close this lead.'; end if;
  select * into v_reason from public.bd_lost_reasons where is_active and (reason_name = p_reason or reason_code = p_reason);
  if not found then raise exception 'Select a valid lost reason.'; end if;
  if v_reason.requires_notes and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'Add notes for the % reason.', v_reason.reason_name;
  end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status not in ('Open', 'On Hold') then raise exception 'Only an active lead can be marked lost.'; end if;
  v_prev_status := v_lead.status;
  update public.bd_leads set status = 'Lost', lost_at = now(), lost_reason_id = v_reason.id,
    lost_notes = nullif(btrim(p_notes), ''), closing_user_id = auth.uid(), hold_until = null, updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  -- record the affected services
  update public.bd_lead_services set service_status = 'Rejected', rejected_at = now(),
    rejection_reason = v_reason.reason_name, updated_at = now()
  where lead_id = p_lead_id and service_status not in ('Accepted', 'Rejected');
  perform public.bd_stage_history(v_lead, v_lead.stage_id, v_prev_status, 'Marked lost: ' || v_reason.reason_name);
  perform public.bd_close_open_followups(p_lead_id, 'Lead lost');
  perform public.bd_audit('bd_leads', p_lead_id, 'Lost', jsonb_build_object('status', v_prev_status),
                          jsonb_build_object('status', 'Lost', 'reason', v_reason.reason_code), p_notes);
  return public.bd_lead_ui_json(p_lead_id);
end $$;

create or replace function public.bd_reopen_lead(p_lead_id uuid, p_reason text, p_stage text default 'CONTACT_ESTABLISHED')
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

-- ── 10. Row-level security: read through policies, write through functions ──

do $$
declare t text;
begin
  foreach t in array array['bd_user_roles', 'bd_service_catalog', 'bd_lead_sources', 'bd_campaigns', 'bd_pipeline_stages',
                           'bd_lost_reasons', 'bd_leads', 'bd_quotations', 'bd_lead_services', 'bd_quotation_items',
                           'bd_discussions', 'bd_followups', 'bd_followup_history', 'bd_lead_stage_history',
                           'bd_lead_assignment_history', 'bd_onboarding_handovers', 'bd_audit_logs',
                           'crm_teams', 'crm_team_members']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('revoke insert, update, delete on public.%I from authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
grant insert, update, delete on public.bd_user_roles, public.crm_teams, public.crm_team_members to authenticated;

drop policy if exists bd_roles_read on public.bd_user_roles;
create policy bd_roles_read on public.bd_user_roles for select to authenticated
  using (user_id = auth.uid() or public.bd_current_role() = 'super_admin');
drop policy if exists bd_roles_admin_manage on public.bd_user_roles;
create policy bd_roles_admin_manage on public.bd_user_roles for all to authenticated
  using (public.bd_current_role() = 'super_admin') with check (public.bd_current_role() = 'super_admin');

do $$
declare t text;
begin
  foreach t in array array['bd_service_catalog', 'bd_lead_sources', 'bd_campaigns', 'bd_pipeline_stages',
                           'bd_lost_reasons', 'crm_teams', 'crm_team_members']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
  end loop;
end $$;
drop policy if exists crm_teams_admin on public.crm_teams;
create policy crm_teams_admin on public.crm_teams for all to authenticated
  using (public.bd_current_role() = 'super_admin') with check (public.bd_current_role() = 'super_admin');
drop policy if exists crm_team_members_admin on public.crm_team_members;
create policy crm_team_members_admin on public.crm_team_members for all to authenticated
  using (public.bd_current_role() = 'super_admin') with check (public.bd_current_role() = 'super_admin');

drop policy if exists bd_leads_read on public.bd_leads;
create policy bd_leads_read on public.bd_leads for select to authenticated using (public.bd_can_view_lead(id));

do $$
declare t text;
begin
  foreach t in array array['bd_discussions', 'bd_followups', 'bd_lead_stage_history', 'bd_lead_assignment_history',
                           'bd_onboarding_handovers']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.bd_can_view_lead(lead_id))',
                   t || '_read', t);
  end loop;
end $$;
-- commercial tables also need permission to see fees
drop policy if exists bd_lead_services_read on public.bd_lead_services;
create policy bd_lead_services_read on public.bd_lead_services for select to authenticated
  using (public.bd_can_view_lead(lead_id) and public.bd_can_view_commercials());
drop policy if exists bd_quotations_read on public.bd_quotations;
create policy bd_quotations_read on public.bd_quotations for select to authenticated
  using (public.bd_can_view_lead(lead_id) and public.bd_can_view_commercials());
drop policy if exists bd_quotation_items_read on public.bd_quotation_items;
create policy bd_quotation_items_read on public.bd_quotation_items for select to authenticated
  using (exists (select 1 from public.bd_quotations q where q.id = quotation_id
                 and public.bd_can_view_lead(q.lead_id) and public.bd_can_view_commercials()));
drop policy if exists bd_followup_history_read on public.bd_followup_history;
create policy bd_followup_history_read on public.bd_followup_history for select to authenticated
  using (exists (select 1 from public.bd_followups f where f.id = followup_id and public.bd_can_view_lead(f.lead_id)));
drop policy if exists bd_audit_logs_read on public.bd_audit_logs;
create policy bd_audit_logs_read on public.bd_audit_logs for select to authenticated
  using (public.bd_current_role() in ('super_admin', 'bd_manager', 'management'));

-- views run with the caller's rights, so RLS applies through them
alter view public.bd_lead_pipeline_v set (security_invoker = true);
revoke all on public.bd_lead_pipeline_v from anon;
grant select on public.bd_lead_pipeline_v to authenticated;

-- ── 11. Function privileges ──────────────────────────────────────────

do $$
declare f text;
begin
  -- internal helpers: not callable from the API
  foreach f in array array[
    'bd_sync_user_role()', 'bd_audit(text, uuid, text, jsonb, jsonb, text)', 'bd_refresh_next_followup(uuid)',
    'bd_stage_history(public.bd_leads, uuid, text, text, jsonb)', 'bd_close_open_followups(uuid, text)',
    'bd_next_ref(text, regclass)', 'bd_leads_guard()', 'bd_quotations_guard()', 'bd_append_only()']
  loop
    -- Supabase grants anon/authenticated directly, not only through PUBLIC
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
  -- UI entry points and the permission checks the policies use
  foreach f in array array[
    'bd_current_role(uuid)', 'bd_is_manager()', 'bd_can_view_commercials()', 'bd_can_view_lead(uuid)',
    'bd_can_edit_lead(uuid)', 'bd_lead_ui_json(uuid)', 'bd_ui_leads(integer)',
    'bd_create_lead(jsonb, jsonb, jsonb)', 'bd_log_activity(jsonb)', 'bd_create_followup(jsonb)',
    'bd_complete_followup(uuid, jsonb)', 'bd_save_service(jsonb)', 'bd_change_stage(uuid, text, text)',
    'bd_mark_lead_won(uuid, jsonb)', 'bd_mark_lead_lost(uuid, text, text)', 'bd_reopen_lead(uuid, text, text)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated';
  end loop;
  -- vocabulary helpers are harmless but not part of the API either
  foreach f in array array['bd_ui_status(text)', 'bd_channel_code(text)', 'bd_billing_code(text)',
                           'bd_ui_billing(text)', 'bd_is_meaningful(text, integer)']
  loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
  end loop;
end $$;
