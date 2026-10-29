-- Business Development module. Run in Supabase SQL Editor after reviewing.
-- Adds isolated BD tables and policies; it does not modify client master data.

create table if not exists public.bd_user_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role text not null default 'sales_executive'
    check (role in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive',
                    'marketing_executive', 'onboarding_executive', 'management', 'read_only')),
  assigned_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.bd_user_roles (user_id, role)
select p.id, case when p.role = 'admin' then 'super_admin' else 'sales_executive' end
from public.profiles p
on conflict (user_id) do nothing;

create or replace function public.bd_sync_user_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role = 'admin' then
    insert into public.bd_user_roles (user_id, role)
    values (new.id, 'super_admin')
    on conflict (user_id) do update set role = 'super_admin', updated_at = now();
  elsif tg_op = 'UPDATE' then
    if old.role = 'admin' then
      update public.bd_user_roles
      set role = 'sales_executive', updated_at = now()
      where user_id = new.id and role = 'super_admin';
    end if;
  else
    insert into public.bd_user_roles (user_id, role)
    values (new.id, 'sales_executive')
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists bd_profiles_role_sync_insert on public.profiles;
create trigger bd_profiles_role_sync_insert
after insert on public.profiles
for each row execute function public.bd_sync_user_role();
drop trigger if exists bd_profiles_role_sync_update on public.profiles;
create trigger bd_profiles_role_sync_update
after update of role on public.profiles
for each row execute function public.bd_sync_user_role();

create or replace function public.bd_current_role(p_user_id uuid default auth.uid())
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_user_id is distinct from auth.uid()
      and not exists (select 1 from public.bd_user_roles r where r.user_id = auth.uid() and r.role = 'super_admin')
      and not exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then null
    else coalesce(
      (select r.role from public.bd_user_roles r where r.user_id = p_user_id),
      (select case when p.role = 'admin' then 'super_admin' end from public.profiles p where p.id = p_user_id)
    )
  end;
$$;

create sequence if not exists public.bd_lead_number_seq;

create table if not exists public.bd_leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  lead_type text not null check (lead_type in ('individual', 'company')),
  name text not null check (length(btrim(name)) > 0),
  contact_name text,
  mobile text,
  email text,
  whatsapp text,
  country text,
  emirate text,
  website text,
  source text not null,
  source_detail text,
  campaign_name text,
  acquired_by uuid not null references public.profiles(id),
  current_owner uuid not null references public.profiles(id),
  acquired_at date not null default current_date,
  initial_service_interest text,
  initial_summary text not null check (length(btrim(initial_summary)) >= 20),
  next_followup_at timestamptz,
  no_followup_reason text,
  estimated_budget numeric(14, 2) check (estimated_budget is null or estimated_budget >= 0),
  budget_currency text not null default 'AED' check (budget_currency ~ '^[A-Z]{3}$'),
  priority text not null default 'Medium' check (priority in ('Low', 'Medium', 'High', 'Urgent')),
  notes text,
  stage text not null default 'New Lead',
  status text not null default 'active' check (status in ('active', 'won', 'lost', 'disqualified', 'on_hold')),
  duplicate_exception boolean not null default false,
  won_at timestamptz,
  won_value numeric(14, 2),
  won_currency text check (won_currency is null or won_currency ~ '^[A-Z]{3}$'),
  lost_at timestamptz,
  lost_reason text,
  lost_notes text,
  hold_reason text,
  hold_review_date date,
  hold_no_action_reason text,
  closed_by uuid references public.profiles(id),
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bd_lead_contact_required check (nullif(regexp_replace(coalesce(mobile, ''), '\D', '', 'g'), '') is not null or nullif(btrim(email), '') is not null),
  constraint bd_lead_hold_reason_required check (status <> 'on_hold' or (nullif(btrim(hold_reason), '') is not null and hold_review_date is not null)),
  constraint bd_lead_stage_valid check (stage in (
    'New Lead', 'Contact Pending', 'First Contact Attempted', 'Contact Established',
    'Requirement Identified', 'Qualified', 'Proposal / Quotation Preparation',
    'Proposal Sent', 'Follow-up / Negotiation', 'Verbal Confirmation',
    'Won — Pending Onboarding', 'Onboarding Completed'
  ))
);

create or replace function public.bd_can_view_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.bd_leads l
    where l.id = p_lead_id
      and (
        public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'marketing_executive', 'onboarding_executive', 'management', 'read_only')
        or l.current_owner = auth.uid()
        or l.acquired_by = auth.uid()
      )
  );
$$;

create or replace function public.bd_can_edit_lead(p_lead_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.bd_leads l
    where l.id = p_lead_id
      and (
        public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader')
        or (public.bd_current_role() in ('sales_executive', 'marketing_executive') and (l.current_owner = auth.uid() or l.acquired_by = auth.uid()))
      )
  );
$$;

create table if not exists public.bd_lead_services (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.bd_leads(id) on delete cascade,
  service_name text not null,
  service_category text,
  requirements text,
  quantity_scope text,
  billing_frequency text not null default 'one_time' check (billing_frequency in ('one_time', 'monthly', 'quarterly', 'annually', 'other')),
  currency text not null default 'AED' check (currency ~ '^[A-Z]{3}$'),
  client_budget numeric(14, 2) check (client_budget is null or client_budget >= 0),
  initial_estimated_fee numeric(14, 2) check (initial_estimated_fee is null or initial_estimated_fee >= 0),
  proposed_fee numeric(14, 2) check (proposed_fee is null or proposed_fee >= 0),
  final_agreed_fee numeric(14, 2) check (final_agreed_fee is null or final_agreed_fee >= 0),
  discount numeric(14, 2) check (discount is null or discount >= 0),
  quotation_reference text,
  status text not null default 'identifying' check (status in ('identifying', 'interested', 'quoted', 'negotiating', 'accepted', 'rejected', 'on_hold')),
  expected_start_date date,
  expected_closing_date date,
  notes text,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bd_lead_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.bd_leads(id) on delete cascade,
  occurred_at timestamptz not null default now(),
  channel text not null check (channel in ('Phone Call', 'WhatsApp', 'Email', 'Face-to-Face Meeting', 'Video Meeting', 'Instagram / Social Media', 'Website / Form', 'Other')),
  direction text not null check (direction in ('inbound', 'outbound')),
  contact_person text not null,
  summary text not null check (length(btrim(summary)) >= 20),
  requirement text,
  services_discussed text[] not null default '{}',
  interest_level text not null default 'Unknown',
  objections text,
  next_action text not null,
  next_followup_at timestamptz,
  no_followup_reason text,
  external_reference text,
  recorded_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint bd_activity_next_step check (next_followup_at is not null or nullif(btrim(no_followup_reason), '') is not null)
);

create table if not exists public.bd_lead_followups (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.bd_leads(id) on delete cascade,
  service_id uuid references public.bd_lead_services(id) on delete set null,
  planned_at timestamptz not null,
  channel text not null,
  assigned_to uuid references public.profiles(id),
  objective text not null,
  previous_outcome text,
  next_action text not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'due_today', 'overdue', 'completed', 'rescheduled', 'cancelled')),
  completed_at timestamptz,
  discussion_summary text,
  next_followup_at timestamptz,
  created_by uuid not null default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bd_lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.bd_leads(id) on delete cascade,
  stage text not null,
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  changed_by uuid references public.profiles(id),
  reason text
);

create table if not exists public.bd_lead_audit_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.bd_leads(id) on delete cascade,
  action text not null,
  changed_by uuid references public.profiles(id),
  changed_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb
);

create table if not exists public.bd_onboarding_handoffs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.bd_leads(id) on delete restrict,
  confirmation_contact text not null,
  agreement_reference text,
  handover_notes text not null,
  onboarding_owner uuid references public.profiles(id),
  onboarding_queue text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'in_progress', 'completed', 'cancelled')),
  client_master_id text,
  handed_over_by uuid not null references public.profiles(id),
  handed_over_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint bd_handoff_assignee check (onboarding_owner is not null or nullif(btrim(onboarding_queue), '') is not null)
);

create index if not exists bd_leads_owner_status_idx on public.bd_leads (current_owner, status, created_at desc);
create index if not exists bd_leads_stage_idx on public.bd_leads (stage, status);
create index if not exists bd_leads_followup_idx on public.bd_leads (next_followup_at) where status = 'active';
create index if not exists bd_leads_mobile_idx on public.bd_leads (regexp_replace(coalesce(mobile, ''), '\D', '', 'g'));
create index if not exists bd_leads_email_idx on public.bd_leads (lower(btrim(email)));
create index if not exists bd_activities_timeline_idx on public.bd_lead_activities (lead_id, occurred_at desc);
create index if not exists bd_followups_planned_idx on public.bd_lead_followups (planned_at, status);
create index if not exists bd_services_lead_idx on public.bd_lead_services (lead_id, status);

create or replace function public.bd_validate_lead_transition()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.stage is distinct from old.stage then
    if new.stage = 'Won — Pending Onboarding' and new.status <> 'won' then
      raise exception 'Use the won workflow to move a lead to onboarding handover.';
    end if;
    if new.stage = 'Onboarding Completed' and not exists (
      select 1 from public.bd_onboarding_handoffs h where h.lead_id = new.id and h.status = 'completed'
    ) then
      raise exception 'Complete the onboarding handover before marking onboarding complete.';
    end if;
    if new.status = 'active' and new.stage in (
      'Requirement Identified', 'Qualified', 'Proposal / Quotation Preparation',
      'Proposal Sent', 'Follow-up / Negotiation', 'Verbal Confirmation'
    ) and nullif(btrim(new.initial_service_interest), '') is null and not exists (
      select 1 from public.bd_lead_services s where s.lead_id = new.id
    ) then
      raise exception 'Add a service interest before moving this lead to Requirement Identified.';
    end if;
    if new.status = 'active' and new.stage in (
      'Qualified', 'Proposal / Quotation Preparation', 'Proposal Sent',
      'Follow-up / Negotiation', 'Verbal Confirmation'
    ) and new.next_followup_at is null and nullif(btrim(new.no_followup_reason), '') is null then
      raise exception 'Set the next follow-up date or document why no follow-up is required.';
    end if;
    if new.status = 'active' and new.stage in (
      'Proposal Sent', 'Follow-up / Negotiation', 'Verbal Confirmation'
    ) and not exists (
      select 1 from public.bd_lead_services s
      where s.lead_id = new.id and s.proposed_fee is not null
    ) then
      raise exception 'Add a proposed fee to at least one service before advancing to Proposal Sent.';
    end if;
  end if;

  if new.status is distinct from old.status then
    if old.status <> 'active' then
      raise exception 'A closed or held lead cannot be reopened without an authorized reopen workflow.';
    end if;
    if new.status = 'lost' and (new.lost_at is null or nullif(btrim(new.lost_reason), '') is null or new.closed_by is null) then
      raise exception 'Use the lost workflow and provide the loss reason.';
    end if;
    if new.status = 'won' and (new.won_at is null or new.closed_by is null or new.stage <> 'Won — Pending Onboarding'
      or not exists (select 1 from public.bd_lead_services s where s.lead_id = new.id and s.status = 'accepted' and s.final_agreed_fee is not null)) then
      raise exception 'Use the won workflow after confirming accepted services and final fees.';
    end if;
    if new.status = 'on_hold' and (nullif(btrim(new.hold_reason), '') is null or new.hold_review_date is null) then
      raise exception 'A hold reason and review date are required.';
    end if;
    if new.status = 'disqualified' and (nullif(btrim(new.lost_reason), '') is null or new.closed_by is null) then
      raise exception 'A disqualification reason and responsible employee are required.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists bd_lead_transition_guard on public.bd_leads;
create trigger bd_lead_transition_guard before update on public.bd_leads
for each row execute function public.bd_validate_lead_transition();

create or replace function public.bd_audit_service_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.bd_leads l
    where l.id = coalesce(new.lead_id, old.lead_id) and l.status = 'won'
  ) then
    raise exception 'Commercial service terms cannot be changed after the lead is marked won.';
  end if;
  new.updated_at := now();
  insert into public.bd_lead_audit_log (lead_id, action, changed_by, before_data, after_data)
  values (
    case when tg_op = 'INSERT' then new.lead_id else old.lead_id end,
    case when tg_op = 'INSERT' then 'service_created' else 'service_updated' end,
    auth.uid(),
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end;
$$;

drop trigger if exists bd_service_change_audit on public.bd_lead_services;
create trigger bd_service_change_audit before insert or update on public.bd_lead_services
for each row execute function public.bd_audit_service_change();

create or replace function public.bd_assign_lead_id()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.lead_id is null or btrim(new.lead_id) = '' then
    new.lead_id := 'BD-' || to_char(now() at time zone 'Asia/Dubai', 'YYYY') || '-' ||
      lpad(nextval('public.bd_lead_number_seq')::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists bd_lead_id_before_insert on public.bd_leads;
create trigger bd_lead_id_before_insert before insert on public.bd_leads
for each row execute function public.bd_assign_lead_id();

create or replace function public.bd_record_lead_changes()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  changed_fields jsonb;
begin
  new.updated_at := now();
  changed_fields := jsonb_build_object(
    'stage', case when old.stage is distinct from new.stage then jsonb_build_object('from', old.stage, 'to', new.stage) end,
    'status', case when old.status is distinct from new.status then jsonb_build_object('from', old.status, 'to', new.status) end,
    'current_owner', case when old.current_owner is distinct from new.current_owner then jsonb_build_object('from', old.current_owner, 'to', new.current_owner) end,
    'estimated_budget', case when old.estimated_budget is distinct from new.estimated_budget then jsonb_build_object('from', old.estimated_budget, 'to', new.estimated_budget) end,
    'source', case when old.source is distinct from new.source then jsonb_build_object('from', old.source, 'to', new.source) end,
    'initial_service_interest', case when old.initial_service_interest is distinct from new.initial_service_interest then jsonb_build_object('from', old.initial_service_interest, 'to', new.initial_service_interest) end
  );
  if old.stage is distinct from new.stage then
    update public.bd_lead_stage_history set exited_at = now()
    where lead_id = old.id and exited_at is null;
    insert into public.bd_lead_stage_history (lead_id, stage, changed_by)
    values (new.id, new.stage, auth.uid());
  end if;
  if old is distinct from new then
    insert into public.bd_lead_audit_log (lead_id, action, changed_by, before_data, after_data)
    values (new.id, 'lead_updated', auth.uid(), changed_fields, to_jsonb(new));
  end if;
  return new;
end;
$$;

drop trigger if exists bd_lead_change_audit on public.bd_leads;
create trigger bd_lead_change_audit before update on public.bd_leads
for each row execute function public.bd_record_lead_changes();

create or replace function public.bd_record_lead_creation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.bd_lead_stage_history (lead_id, stage, changed_by)
  values (new.id, new.stage, auth.uid());
  insert into public.bd_lead_audit_log (lead_id, action, changed_by, after_data)
  values (new.id, 'lead_created', auth.uid(), to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists bd_lead_creation_history on public.bd_leads;
create trigger bd_lead_creation_history after insert on public.bd_leads
for each row execute function public.bd_record_lead_creation();

create or replace function public.bd_create_lead(p_lead jsonb, p_activity jsonb, p_followup jsonb)
returns public.bd_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  new_lead public.bd_leads;
  duplicate_found boolean;
  current_user_role text := public.bd_current_role();
  lock_key text;
begin
  if auth.uid() is null or current_user_role is null then
    raise exception 'Sign in and request a Business Development role before creating leads.';
  end if;
  if current_user_role not in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive') then
    raise exception 'Your Business Development role cannot create leads.';
  end if;
  if current_user_role not in ('super_admin', 'bd_manager', 'team_leader')
    and ((p_lead->>'acquired_by')::uuid <> auth.uid() or (p_lead->>'current_owner')::uuid <> auth.uid()) then
    raise exception 'Only a manager or team leader can assign a lead to another employee.';
  end if;
  if nullif(btrim(coalesce(p_lead->>'name', '')), '') is null
    or (nullif(regexp_replace(coalesce(p_lead->>'mobile', ''), '\D', '', 'g'), '') is null and nullif(btrim(coalesce(p_lead->>'email', '')), '') is null) then
    raise exception 'A prospect name and at least one contact method are required.';
  end if;
  if nullif(btrim(p_lead->>'email'), '') is not null
    and btrim(p_lead->>'email') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  if length(btrim(coalesce(p_activity->>'summary', ''))) < 20
    or lower(btrim(coalesce(p_activity->>'summary', ''))) in ('called client', 'called customer', 'followed up', 'spoke to client', 'no answer', 'sent email') then
    raise exception 'Enter a meaningful initial discussion summary.';
  end if;
  if nullif(p_followup->>'planned_at', '') is null then
    raise exception 'A next follow-up date is required for an active lead.';
  end if;
  for lock_key in
    select contact_key
    from unnest(array[
      case when nullif(btrim(p_lead->>'mobile'), '') is not null
        then 'mobile:' || regexp_replace(p_lead->>'mobile', '\D', '', 'g') end,
      case when nullif(btrim(p_lead->>'email'), '') is not null
        then 'email:' || lower(btrim(p_lead->>'email')) end,
      case when nullif(btrim(p_lead->>'name'), '') is not null
        then 'name:' || coalesce(p_lead->>'lead_type', 'company') || ':' ||
          lower(regexp_replace(btrim(p_lead->>'name'), '\s+', ' ', 'g')) end
    ]) as contact_keys(contact_key)
    where contact_key is not null
    order by contact_key
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;
  select exists (
    select 1 from public.bd_leads existing
    where (nullif(btrim(p_lead->>'mobile'), '') is not null and regexp_replace(coalesce(existing.mobile, ''), '\D', '', 'g') = regexp_replace(p_lead->>'mobile', '\D', '', 'g'))
       or (nullif(btrim(p_lead->>'email'), '') is not null and lower(btrim(existing.email)) = lower(btrim(p_lead->>'email')))
       or (existing.lead_type = coalesce(p_lead->>'lead_type', 'company')
         and lower(regexp_replace(btrim(existing.name), '\s+', ' ', 'g')) =
           lower(regexp_replace(btrim(p_lead->>'name'), '\s+', ' ', 'g')))
  ) into duplicate_found;
  if duplicate_found and coalesce((p_lead->>'duplicate_exception')::boolean, false) is false then
    raise exception 'A possible matching lead already exists. Review the matching record before continuing.';
  end if;
  if duplicate_found and current_user_role not in ('super_admin', 'bd_manager', 'team_leader') then
    raise exception 'Only a manager can approve a duplicate-lead exception.';
  end if;

  insert into public.bd_leads (
    lead_type, name, contact_name, mobile, email, whatsapp, source, source_detail, campaign_name,
    acquired_by, current_owner, acquired_at, initial_service_interest, initial_summary,
    next_followup_at, estimated_budget, budget_currency, priority, notes, stage, status,
    duplicate_exception, created_by
  ) values (
    coalesce(p_lead->>'lead_type', 'company'), btrim(p_lead->>'name'),
    nullif(btrim(p_lead->>'contact_name'), ''), nullif(btrim(p_lead->>'mobile'), ''),
    nullif(btrim(p_lead->>'email'), ''), nullif(btrim(p_lead->>'whatsapp'), ''),
    coalesce(nullif(btrim(p_lead->>'source'), ''), 'Other'), nullif(btrim(p_lead->>'source_detail'), ''),
    nullif(btrim(p_lead->>'campaign_name'), ''), (p_lead->>'acquired_by')::uuid,
    (p_lead->>'current_owner')::uuid, coalesce(nullif(p_lead->>'acquired_at', '')::date, current_date),
    nullif(btrim(p_lead->>'initial_service_interest'), ''), btrim(p_lead->>'initial_summary'),
    (p_followup->>'planned_at')::timestamptz, nullif(p_lead->>'estimated_budget', '')::numeric,
    coalesce(nullif(p_lead->>'budget_currency', ''), 'AED'), coalesce(p_lead->>'priority', 'Medium'),
    nullif(btrim(p_lead->>'notes'), ''), 'New Lead', 'active',
    coalesce((p_lead->>'duplicate_exception')::boolean, false), auth.uid()
  ) returning * into new_lead;

  insert into public.bd_lead_activities (
    lead_id, occurred_at, channel, direction, contact_person, summary, requirement,
    services_discussed, interest_level, next_action, next_followup_at, recorded_by
  ) values (
    new_lead.id, coalesce(nullif(p_activity->>'occurred_at', '')::timestamptz, now()),
    coalesce(p_activity->>'channel', 'Other'), coalesce(p_activity->>'direction', 'outbound'),
    coalesce(nullif(btrim(p_activity->>'contact_person'), ''), new_lead.name), btrim(p_activity->>'summary'),
    nullif(btrim(p_activity->>'requirement'), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_activity->'services_discussed', '[]'::jsonb))), '{}'::text[]),
    coalesce(p_activity->>'interest_level', 'Unknown'), 'Follow up with prospect',
    (p_followup->>'planned_at')::timestamptz, auth.uid()
  );

  insert into public.bd_lead_followups (
    lead_id, planned_at, channel, assigned_to, objective, next_action, status, created_by
  ) values (
    new_lead.id, (p_followup->>'planned_at')::timestamptz,
    coalesce(p_followup->>'channel', 'Other'), new_lead.current_owner,
    coalesce(p_followup->>'objective', 'Follow up with prospect'),
    'Follow up on initial discussion', 'scheduled', auth.uid()
  );
  return new_lead;
end;
$$;

create or replace function public.bd_mark_lead_won(p_lead_id uuid, p_handover jsonb)
returns public.bd_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead public.bd_leads;
  accepted_count integer;
  distinct_currencies integer;
  won_total numeric(14, 2);
  won_currency text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to close this lead.'; end if;
  select * into current_lead from public.bd_leads where id = p_lead_id for update;
  if current_lead.status <> 'active' then raise exception 'Only an active lead can be marked won.'; end if;
  if nullif(btrim(coalesce(p_handover->>'confirmation_contact', '')), '') is null
    or nullif(btrim(coalesce(p_handover->>'handover_notes', '')), '') is null then
    raise exception 'A confirmation contact and handover notes are required.';
  end if;
  select count(*), count(distinct currency), sum(final_agreed_fee), min(currency)
    into accepted_count, distinct_currencies, won_total, won_currency
    from public.bd_lead_services
    where lead_id = p_lead_id and status = 'accepted' and final_agreed_fee is not null;
  if accepted_count = 0 then raise exception 'Add at least one accepted service with a final agreed fee before closing as won.'; end if;

  update public.bd_leads set
    status = 'won',
    stage = 'Won — Pending Onboarding',
    won_at = now(),
    won_value = case when distinct_currencies = 1 then won_total else null end,
    won_currency = case when distinct_currencies = 1 then won_currency else null end,
    closed_by = auth.uid()
  where id = p_lead_id returning * into current_lead;

  insert into public.bd_onboarding_handoffs (
    lead_id, confirmation_contact, agreement_reference, handover_notes,
    onboarding_owner, onboarding_queue, handed_over_by
  ) values (
    p_lead_id, btrim(p_handover->>'confirmation_contact'),
    nullif(btrim(p_handover->>'agreement_reference'), ''),
    btrim(p_handover->>'handover_notes'),
    nullif(p_handover->>'onboarding_owner', '')::uuid,
    coalesce(nullif(btrim(p_handover->>'onboarding_queue'), ''), 'Client Onboarding Queue'),
    auth.uid()
  ) on conflict (lead_id) do nothing;
  update public.bd_lead_followups
  set status = 'cancelled', updated_at = now()
  where lead_id = p_lead_id and status in ('scheduled', 'due_today', 'overdue', 'rescheduled');
  return current_lead;
end;
$$;

create or replace function public.bd_mark_lead_lost(p_lead_id uuid, p_reason text, p_notes text)
returns public.bd_leads
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead public.bd_leads;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to close this lead.'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'A lost reason is required.'; end if;
  if p_reason not in ('Price Too High', 'No Response', 'Competitor Selected', 'Service Not Required',
    'Budget Not Available', 'Timing / Deferred', 'Unable to Meet Requirements', 'Duplicate Lead', 'Other') then
    raise exception 'Select a valid lost reason.';
  end if;
  if p_reason = 'Other' and nullif(btrim(coalesce(p_notes, '')), '') is null then raise exception 'Add notes for the Other reason.'; end if;
  update public.bd_leads set status = 'lost', lost_at = now(), lost_reason = p_reason,
    lost_notes = nullif(btrim(p_notes), ''), closed_by = auth.uid()
  where id = p_lead_id and status = 'active'
  returning * into current_lead;
  if not found then raise exception 'Only an active lead can be marked lost.'; end if;
  update public.bd_lead_followups
  set status = 'cancelled', updated_at = now()
  where lead_id = p_lead_id and status in ('scheduled', 'due_today', 'overdue', 'rescheduled');
  return current_lead;
end;
$$;

create or replace function public.bd_log_activity(p_activity jsonb)
returns public.bd_lead_activities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_row public.bd_leads;
  activity_row public.bd_lead_activities;
  next_at timestamptz;
  no_followup text;
begin
  if not public.bd_can_edit_lead((p_activity->>'lead_id')::uuid) then
    raise exception 'You do not have permission to log activity for this lead.';
  end if;
  select * into lead_row from public.bd_leads where id = (p_activity->>'lead_id')::uuid for update;
  if lead_row.status <> 'active' then raise exception 'Activity can only be logged for an active lead.'; end if;
  if length(btrim(coalesce(p_activity->>'summary', ''))) < 20
    or lower(btrim(coalesce(p_activity->>'summary', ''))) in ('called client', 'called customer', 'followed up', 'spoke to client', 'no answer', 'sent email') then
    raise exception 'Enter a meaningful discussion summary.';
  end if;
  if nullif(btrim(coalesce(p_activity->>'next_action', '')), '') is null then raise exception 'Record the agreed next action.'; end if;
  next_at := nullif(p_activity->>'next_followup_at', '')::timestamptz;
  no_followup := nullif(btrim(p_activity->>'no_followup_reason'), '');
  if next_at is null and no_followup is null then raise exception 'Set a follow-up date or document why no follow-up is required.'; end if;

  insert into public.bd_lead_activities (
    lead_id, occurred_at, channel, direction, contact_person, summary, requirement,
    services_discussed, interest_level, objections, next_action, next_followup_at,
    no_followup_reason, external_reference, recorded_by
  ) values (
    lead_row.id, coalesce(nullif(p_activity->>'occurred_at', '')::timestamptz, now()),
    p_activity->>'channel', p_activity->>'direction', btrim(p_activity->>'contact_person'),
    btrim(p_activity->>'summary'), nullif(btrim(p_activity->>'requirement'), ''),
    coalesce(array(select jsonb_array_elements_text(coalesce(p_activity->'services_discussed', '[]'::jsonb))), '{}'::text[]),
    coalesce(p_activity->>'interest_level', 'Unknown'), nullif(btrim(p_activity->>'objections'), ''),
    btrim(p_activity->>'next_action'), next_at, no_followup,
    nullif(btrim(p_activity->>'external_reference'), ''), auth.uid()
  ) returning * into activity_row;

  update public.bd_leads
  set next_followup_at = next_at, no_followup_reason = no_followup
  where id = lead_row.id;
  if next_at is not null then
    insert into public.bd_lead_followups (
      lead_id, planned_at, channel, assigned_to, objective, previous_outcome,
      next_action, status, created_by
    ) values (
      lead_row.id, next_at, p_activity->>'channel', lead_row.current_owner,
      btrim(p_activity->>'next_action'), btrim(p_activity->>'summary'),
      btrim(p_activity->>'next_action'), 'scheduled', auth.uid()
    );
  end if;
  return activity_row;
end;
$$;

create or replace function public.bd_create_followup(p_followup jsonb)
returns public.bd_lead_followups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  lead_row public.bd_leads;
  followup_row public.bd_lead_followups;
begin
  if not public.bd_can_edit_lead((p_followup->>'lead_id')::uuid) then
    raise exception 'You do not have permission to schedule a follow-up for this lead.';
  end if;
  select * into lead_row from public.bd_leads where id = (p_followup->>'lead_id')::uuid for update;
  if lead_row.status <> 'active' then raise exception 'Follow-ups can only be scheduled for active leads.'; end if;
  if nullif(btrim(coalesce(p_followup->>'objective', '')), '') is null
    or nullif(btrim(coalesce(p_followup->>'next_action', '')), '') is null
    or nullif(p_followup->>'planned_at', '') is null then
    raise exception 'A planned date, objective, and next action are required.';
  end if;
  insert into public.bd_lead_followups (
    lead_id, planned_at, channel, assigned_to, objective, previous_outcome,
    next_action, status, created_by
  ) values (
    lead_row.id, (p_followup->>'planned_at')::timestamptz,
    coalesce(p_followup->>'channel', 'Other'), lead_row.current_owner,
    btrim(p_followup->>'objective'), nullif(btrim(p_followup->>'previous_outcome'), ''),
    btrim(p_followup->>'next_action'), 'scheduled', auth.uid()
  ) returning * into followup_row;
  update public.bd_leads set next_followup_at = followup_row.planned_at, no_followup_reason = null where id = lead_row.id;
  return followup_row;
end;
$$;

create or replace function public.bd_complete_followup(p_followup_id uuid, p_completion jsonb)
returns public.bd_lead_followups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  followup_row public.bd_lead_followups;
  lead_row public.bd_leads;
  next_at timestamptz;
  no_followup text;
begin
  select * into followup_row from public.bd_lead_followups where id = p_followup_id for update;
  if not found or not public.bd_can_edit_lead(followup_row.lead_id) then
    raise exception 'You do not have permission to complete this follow-up.';
  end if;
  if followup_row.status in ('completed', 'cancelled') then raise exception 'This follow-up is already closed.'; end if;
  if length(btrim(coalesce(p_completion->>'discussion_summary', ''))) < 20 then
    raise exception 'A meaningful follow-up completion summary is required.';
  end if;
  next_at := nullif(p_completion->>'next_followup_at', '')::timestamptz;
  no_followup := nullif(btrim(p_completion->>'no_followup_reason'), '');
  if next_at is null then
    select min(planned_at) into next_at from public.bd_lead_followups
    where lead_id = followup_row.lead_id and id <> p_followup_id and status in ('scheduled', 'due_today', 'overdue', 'rescheduled');
    if next_at is null and no_followup is null then raise exception 'Set another follow-up date or explain why no further follow-up is required.'; end if;
  end if;
  if next_at is not null then no_followup := null; end if;

  update public.bd_lead_followups set status = 'completed', completed_at = now(),
    discussion_summary = btrim(p_completion->>'discussion_summary'),
    next_followup_at = next_at, next_action = coalesce(nullif(btrim(p_completion->>'next_action'), ''), next_action)
  where id = p_followup_id returning * into followup_row;

  if nullif(p_completion->>'next_followup_at', '') is not null then
    if nullif(btrim(p_completion->>'next_action'), '') is null then raise exception 'A next action is required with the next follow-up date.'; end if;
    select * into lead_row from public.bd_leads where id = followup_row.lead_id;
    insert into public.bd_lead_followups (lead_id, planned_at, channel, assigned_to, objective, previous_outcome, next_action, status, created_by)
    values (lead_row.id, next_at, followup_row.channel, lead_row.current_owner,
      btrim(p_completion->>'next_action'), btrim(p_completion->>'discussion_summary'),
      btrim(p_completion->>'next_action'), 'scheduled', auth.uid());
  end if;
  update public.bd_leads set next_followup_at = next_at, no_followup_reason = no_followup
  where id = followup_row.lead_id;
  return followup_row;
end;
$$;

alter table public.bd_user_roles enable row level security;
alter table public.bd_leads enable row level security;
alter table public.bd_lead_services enable row level security;
alter table public.bd_lead_activities enable row level security;
alter table public.bd_lead_followups enable row level security;
alter table public.bd_lead_stage_history enable row level security;
alter table public.bd_lead_audit_log enable row level security;
alter table public.bd_onboarding_handoffs enable row level security;

drop policy if exists bd_roles_read on public.bd_user_roles;
create policy bd_roles_read on public.bd_user_roles for select to authenticated
using (user_id = auth.uid() or public.bd_current_role() = 'super_admin');
drop policy if exists bd_roles_admin_manage on public.bd_user_roles;
create policy bd_roles_admin_manage on public.bd_user_roles for all to authenticated
using (public.bd_current_role() = 'super_admin')
with check (public.bd_current_role() = 'super_admin');

drop policy if exists bd_leads_read on public.bd_leads;
create policy bd_leads_read on public.bd_leads for select to authenticated
using (
  public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'marketing_executive', 'onboarding_executive', 'management', 'read_only')
  or current_owner = auth.uid() or acquired_by = auth.uid()
);
drop policy if exists bd_leads_create on public.bd_leads;
create policy bd_leads_create on public.bd_leads for insert to authenticated
with check (
  public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive')
  and created_by = auth.uid()
);
drop policy if exists bd_leads_update on public.bd_leads;
create policy bd_leads_update on public.bd_leads for update to authenticated
using (
  public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader')
  or (public.bd_current_role() in ('sales_executive', 'marketing_executive') and (current_owner = auth.uid() or acquired_by = auth.uid()))
)
with check (
  public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader')
  or (public.bd_current_role() in ('sales_executive', 'marketing_executive') and (current_owner = auth.uid() or acquired_by = auth.uid()))
);

drop policy if exists bd_services_read on public.bd_lead_services;
create policy bd_services_read on public.bd_lead_services for select to authenticated
using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_services_create on public.bd_lead_services;
create policy bd_services_create on public.bd_lead_services for insert to authenticated
with check (public.bd_can_edit_lead(lead_id) and created_by = auth.uid());
drop policy if exists bd_services_update on public.bd_lead_services;
create policy bd_services_update on public.bd_lead_services for update to authenticated
using (public.bd_can_edit_lead(lead_id)) with check (public.bd_can_edit_lead(lead_id));

drop policy if exists bd_activities_read on public.bd_lead_activities;
create policy bd_activities_read on public.bd_lead_activities for select to authenticated
using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_activities_create on public.bd_lead_activities;
create policy bd_activities_create on public.bd_lead_activities for insert to authenticated
with check (public.bd_can_edit_lead(lead_id) and recorded_by = auth.uid());

drop policy if exists bd_followups_read on public.bd_lead_followups;
create policy bd_followups_read on public.bd_lead_followups for select to authenticated
using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_followups_create on public.bd_lead_followups;
create policy bd_followups_create on public.bd_lead_followups for insert to authenticated
with check (public.bd_can_edit_lead(lead_id) and created_by = auth.uid());
drop policy if exists bd_followups_update on public.bd_lead_followups;
create policy bd_followups_update on public.bd_lead_followups for update to authenticated
using (public.bd_can_edit_lead(lead_id)) with check (public.bd_can_edit_lead(lead_id));

drop policy if exists bd_stage_history_read on public.bd_lead_stage_history;
create policy bd_stage_history_read on public.bd_lead_stage_history for select to authenticated
using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_audit_read on public.bd_lead_audit_log;
create policy bd_audit_read on public.bd_lead_audit_log for select to authenticated
using (public.bd_can_view_lead(lead_id));
drop policy if exists bd_handoffs_read on public.bd_onboarding_handoffs;
create policy bd_handoffs_read on public.bd_onboarding_handoffs for select to authenticated
using (public.bd_can_view_lead(lead_id));

grant select, insert, update, delete on public.bd_user_roles to authenticated;
grant select on public.bd_leads to authenticated;
grant update (stage) on public.bd_leads to authenticated;
grant select, insert, update on public.bd_lead_services to authenticated;
grant select on public.bd_lead_followups, public.bd_lead_activities to authenticated;
grant select on public.bd_lead_stage_history, public.bd_lead_audit_log,
  public.bd_onboarding_handoffs to authenticated;
grant usage, select on sequence public.bd_lead_number_seq to authenticated;
grant execute on function public.bd_create_lead(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.bd_mark_lead_won(uuid, jsonb) to authenticated;
grant execute on function public.bd_mark_lead_lost(uuid, text, text) to authenticated;
grant execute on function public.bd_log_activity(jsonb) to authenticated;
grant execute on function public.bd_create_followup(jsonb) to authenticated;
grant execute on function public.bd_complete_followup(uuid, jsonb) to authenticated;
grant execute on function public.bd_current_role(uuid) to authenticated;
grant execute on function public.bd_can_view_lead(uuid) to authenticated;
grant execute on function public.bd_can_edit_lead(uuid) to authenticated;
revoke all on function public.bd_sync_user_role() from public;
revoke all on function public.bd_assign_lead_id() from public;
revoke all on function public.bd_record_lead_changes() from public;
revoke all on function public.bd_record_lead_creation() from public;
revoke all on function public.bd_validate_lead_transition() from public;
revoke all on function public.bd_audit_service_change() from public;
revoke all on function public.bd_create_lead(jsonb, jsonb, jsonb) from public;
revoke all on function public.bd_mark_lead_won(uuid, jsonb) from public;
revoke all on function public.bd_mark_lead_lost(uuid, text, text) from public;
revoke all on function public.bd_log_activity(jsonb) from public;
revoke all on function public.bd_create_followup(jsonb) from public;
revoke all on function public.bd_complete_followup(uuid, jsonb) from public;
revoke all on function public.bd_current_role(uuid) from public;
revoke all on function public.bd_can_view_lead(uuid) from public;
revoke all on function public.bd_can_edit_lead(uuid) from public;
grant execute on function public.bd_create_lead(jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.bd_mark_lead_won(uuid, jsonb) to authenticated;
grant execute on function public.bd_mark_lead_lost(uuid, text, text) to authenticated;
grant execute on function public.bd_log_activity(jsonb) to authenticated;
grant execute on function public.bd_create_followup(jsonb) to authenticated;
grant execute on function public.bd_complete_followup(uuid, jsonb) to authenticated;

comment on table public.bd_onboarding_handoffs is
  'Pending handover queue only. Client master creation/linking must be completed through the approved Client Module workflow.';
