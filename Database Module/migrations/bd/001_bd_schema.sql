-- =====================================================================
-- CRM Business Development (BD) backend - schema            DRAFT 001
-- =====================================================================
-- Spec: docs/BD_BACKEND_SPEC.md   Plan: docs/BD_MIGRATION_PLAN.md
-- Target: PostgreSQL 15+ (local CRM database first; Supabase later).
-- NOT YET APPLIED to any CRM database. Idempotent: safe to re-run.
--
-- Reused / stand-in entities (see migration plan section 2):
--   public.profiles      CRM users. Same shape as the live Supabase table;
--                        created here only when it does not exist (local DB).
--   public.crm_teams     No team entity exists in the CRM yet -> created.
--   Client Master        Client Module CSV, IDs CL000001... (text, not UUID),
--                        so client links are VARCHAR(20) validated by format
--                        and by the Client Module API at conversion time.
--   Quotations           CRM only has quotation_templates (docx templates),
--                        no quotation records -> bd_quotations created.
--   Services             No service master -> bd_service_catalog created,
--                        seeded from the Client Module "Services Provided".
-- Timestamps: TIMESTAMPTZ (stored UTC, rendered Asia/Dubai by the API).
-- Money: NUMERIC(18,2) + explicit CHAR(3) currency. Never float.
-- =====================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid()

-- ── 0. Reused CRM entities (stand-ins only where missing) ────────────

create table if not exists public.profiles (           -- live CRM: id references auth.users
  id           uuid primary key default gen_random_uuid(),
  full_name    text,
  email        text,
  role         text default 'member',
  avatar_color text default '#378ADD',
  created_at   timestamp default now()
);

create table if not exists public.crm_teams (
  id           uuid primary key default gen_random_uuid(),
  team_code    varchar(50)  not null unique,
  team_name    varchar(150) not null,
  lead_user_id uuid references public.profiles(id),
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.crm_team_members (
  team_id    uuid not null references public.crm_teams(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  team_role  varchar(30) not null default 'Member' check (team_role in ('Member', 'Manager')),
  joined_at  timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- BD permission per user (the CRM only has profiles.role admin/member)
create table if not exists public.bd_user_roles (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  bd_role    varchar(30) not null check (bd_role in ('BD Executive', 'BD Manager', 'Onboarding', 'Viewer', 'Admin')),
  can_view_commercials boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ── 1. Masters ───────────────────────────────────────────────────────

create table if not exists public.bd_service_catalog (
  id                        uuid primary key default gen_random_uuid(),
  service_code              varchar(50)  not null unique,
  service_name              varchar(150) not null unique,  -- matches Client Module "Services Provided" option
  service_category          varchar(50)  not null,
  default_billing_frequency varchar(30) check (default_billing_frequency in ('One-time', 'Monthly', 'Quarterly', 'Annual', 'Other')),
  database_folder           varchar(150),                  -- Client Module config.json serviceFolders
  is_active                 boolean not null default true,
  sort_order                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.bd_lead_sources (
  id                uuid primary key default gen_random_uuid(),
  source_code       varchar(50)  not null unique,
  source_name       varchar(100) not null,
  source_category   varchar(50)  not null check (source_category in ('Paid', 'Organic', 'Referral', 'Direct', 'Other')),
  requires_campaign boolean not null default false,
  requires_referrer boolean not null default false,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.bd_campaigns (
  id                     uuid primary key default gen_random_uuid(),
  campaign_code          varchar(50)  not null unique,
  campaign_name          varchar(255) not null,
  channel                varchar(50)  not null check (channel in ('Meta', 'Google', 'Instagram', 'LinkedIn', 'Email', 'Other')),
  external_campaign_id   varchar(255),
  campaign_owner_user_id uuid references public.profiles(id),
  start_date             date,
  end_date               date,
  budget_amount          numeric(18,2) check (budget_amount >= 0),
  currency_code          char(3) check (currency_code ~ '^[A-Z]{3}$'),
  actual_spend           numeric(18,2) check (actual_spend >= 0),
  campaign_status        varchar(30) not null default 'Planned'
                         check (campaign_status in ('Planned', 'Active', 'Paused', 'Completed')),
  utm_source             varchar(255),
  utm_medium             varchar(255),
  utm_campaign           varchar(255),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint bd_campaigns_currency_with_money
    check ((budget_amount is null and actual_spend is null) or currency_code is not null),
  constraint bd_campaigns_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.bd_pipeline_stages (
  id                  uuid primary key default gen_random_uuid(),
  stage_code          varchar(50)  not null unique,
  stage_name          varchar(100) not null,
  stage_order         integer not null unique,
  progress_weight     numeric(5,2) check (progress_weight between 0 and 100),
  default_probability numeric(5,2) check (default_probability between 0 and 100),
  is_terminal         boolean not null default false,
  is_active           boolean not null default true,
  required_fields     jsonb not null default '[]'::jsonb,   -- e.g. ["services_with_budget"]
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.bd_lost_reasons (
  id             uuid primary key default gen_random_uuid(),
  reason_code    varchar(50)  not null unique,
  reason_name    varchar(100) not null,
  requires_notes boolean not null default false,
  is_active      boolean not null default true,
  sort_order     integer not null default 0
);

-- ── 2. Reference numbers ─────────────────────────────────────────────
-- Human-readable IDs, separate from UUID keys. Gaps are allowed (sequences).

create sequence if not exists public.bd_lead_number_seq;
create sequence if not exists public.bd_quotation_number_seq;
create sequence if not exists public.bd_handover_number_seq;

create or replace function public.bd_next_ref(prefix text, seq regclass)
returns text language sql volatile as $$
  select prefix || '-' || to_char(now() at time zone 'Asia/Dubai', 'YYYY') || '-' || lpad(nextval(seq)::text, 6, '0')
$$;

-- ── 3. Leads ─────────────────────────────────────────────────────────

create table if not exists public.bd_leads (
  id                          uuid primary key default gen_random_uuid(),
  lead_number                 varchar(30) not null unique
                              default public.bd_next_ref('LD', 'public.bd_lead_number_seq'),
  lead_type                   varchar(20) not null check (lead_type in ('Company', 'Individual')),
  prospect_name               varchar(255) not null check (btrim(prospect_name) <> ''),
  company_name                varchar(255),
  primary_contact_name        varchar(255),
  designation                 varchar(150),
  mobile_country_code         varchar(8) check (mobile_country_code ~ '^\+[0-9]{1,4}$'),
  mobile_number               varchar(30),
  mobile_normalized           varchar(30) generated always as (nullif(regexp_replace(coalesce(mobile_country_code, '') || coalesce(mobile_number, ''), '[^0-9]', '', 'g'), '')) stored,
  whatsapp_number             varchar(30),
  email                       varchar(255) check (email is null or btrim(email) ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  email_normalized            varchar(255) generated always as (nullif(lower(btrim(email)), '')) stored,
  website                     varchar(255),
  country                     varchar(100),
  emirate                     varchar(100),
  trade_licence_number        varchar(100),
  trade_licence_expiry_date   date,
  entity_type                 varchar(100),
  vat_trn                     varchar(50) check (vat_trn is null or vat_trn ~ '^[0-9]{15}$'),
  corporate_tax_status        varchar(50),
  source_id                   uuid not null references public.bd_lead_sources(id),
  source_detail               varchar(255),
  campaign_id                 uuid references public.bd_campaigns(id),
  referrer_name               varchar(255),
  external_source_reference   varchar(255),
  acquired_by_user_id         uuid not null references public.profiles(id),
  assigned_to_user_id         uuid not null references public.profiles(id),
  assigned_team_id            uuid references public.crm_teams(id),
  closing_user_id             uuid references public.profiles(id),
  stage_id                    uuid not null references public.bd_pipeline_stages(id),
  status                      varchar(30) not null default 'Open'
                              check (status in ('Open', 'Won', 'Lost', 'Disqualified', 'On Hold')),
  priority                    varchar(20) not null default 'Normal' check (priority in ('Low', 'Normal', 'High', 'Urgent')),
  initial_service_interest    jsonb,
  initial_discussion_summary  text not null check (length(btrim(initial_discussion_summary)) >= 10),
  case_opened_at              timestamptz not null default now(),
  first_contact_at            timestamptz,
  last_activity_at            timestamptz,
  next_followup_at            timestamptz,
  qualified_at                timestamptz,
  proposal_sent_at            timestamptz,
  won_at                      timestamptz,
  lost_at                     timestamptz,
  hold_until                  timestamptz,
  lost_reason_id              uuid references public.bd_lost_reasons(id),
  lost_notes                  text,
  converted_client_id         varchar(20) check (converted_client_id ~ '^CL[0-9]{6,}$'),  -- Client Module Client ID
  onboarding_status           varchar(30) not null default 'Not Started'
                              check (onboarding_status in ('Not Started', 'Pending', 'In Progress', 'Completed', 'Blocked')),
  onboarding_handover_id      uuid,   -- FK added after bd_onboarding_handovers exists
  created_by                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles(id),
  updated_at                  timestamptz not null default now(),
  archived_at                 timestamptz,
  constraint bd_leads_company_name check (lead_type = 'Individual' or company_name is not null),
  constraint bd_leads_won  check (status <> 'Won'  or (won_at is not null and closing_user_id is not null)),
  constraint bd_leads_lost check (status <> 'Lost' or (lost_at is not null and lost_reason_id is not null)),
  constraint bd_leads_hold check (status <> 'On Hold' or hold_until is not null)
);

-- case_opened_at and acquired_by_user_id never change after insert
create or replace function public.bd_leads_guard()
returns trigger language plpgsql as $$
begin
  if new.case_opened_at is distinct from old.case_opened_at then
    raise exception 'case_opened_at is immutable (lead %)', old.lead_number;
  end if;
  if new.acquired_by_user_id is distinct from old.acquired_by_user_id
     and coalesce(current_setting('bd.allow_attribution_change', true), '') <> 'on' then
    raise exception 'acquired_by_user_id keeps the original attribution (lead %)', old.lead_number;
  end if;
  if new.lead_number is distinct from old.lead_number then
    raise exception 'lead_number is immutable';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bd_leads_guard on public.bd_leads;
create trigger bd_leads_guard before update on public.bd_leads
  for each row execute function public.bd_leads_guard();

-- ── 4. Quotations (before services, which reference them) ────────────

create table if not exists public.bd_quotations (
  id                          uuid primary key default gen_random_uuid(),
  quotation_number            varchar(50) not null unique
                              default public.bd_next_ref('QT', 'public.bd_quotation_number_seq'),
  version_no                  integer not null default 1 check (version_no >= 1),
  supersedes_quotation_id     uuid references public.bd_quotations(id),
  lead_id                     uuid not null references public.bd_leads(id),
  quotation_template_id       uuid,          -- public.quotation_templates(id) on the live CRM (freezone docx)
  quotation_date              date not null default (now() at time zone 'Asia/Dubai')::date,
  valid_until                 date,
  currency_code               char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  subtotal                    numeric(18,2) not null check (subtotal >= 0),
  discount_amount             numeric(18,2) not null default 0 check (discount_amount >= 0),
  tax_amount                  numeric(18,2) check (tax_amount >= 0),
  total_amount                numeric(18,2) not null check (total_amount >= 0),
  status                      varchar(30) not null default 'Draft'
                              check (status in ('Draft', 'Sent', 'Accepted', 'Rejected', 'Expired', 'Cancelled')),
  sent_at                     timestamptz,
  accepted_at                 timestamptz,
  external_document_reference text,
  created_by                  uuid not null references public.profiles(id),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint bd_quotations_total check (total_amount = subtotal - discount_amount + coalesce(tax_amount, 0)),
  constraint bd_quotations_valid check (valid_until is null or valid_until >= quotation_date),
  constraint bd_quotations_sent check (status = 'Draft' or status = 'Cancelled' or sent_at is not null)
);

-- A quotation that has been sent is frozen: change it by issuing a new version
create or replace function public.bd_quotations_guard()
returns trigger language plpgsql as $$
begin
  if old.status <> 'Draft' and (new.subtotal, new.discount_amount, new.tax_amount, new.total_amount, new.currency_code,
       new.quotation_date, new.valid_until, new.lead_id)
       is distinct from (old.subtotal, old.discount_amount, old.tax_amount, old.total_amount, old.currency_code,
       old.quotation_date, old.valid_until, old.lead_id) then
    raise exception 'Quotation % was issued; create a new version instead of editing it', old.quotation_number;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists bd_quotations_guard on public.bd_quotations;
create trigger bd_quotations_guard before update on public.bd_quotations
  for each row execute function public.bd_quotations_guard();

-- ── 5. Services on a lead ────────────────────────────────────────────

create table if not exists public.bd_lead_services (
  id                      uuid primary key default gen_random_uuid(),
  lead_id                 uuid not null references public.bd_leads(id),
  service_id              uuid not null references public.bd_service_catalog(id),
  service_status          varchar(30) not null default 'Identifying'
                          check (service_status in ('Identifying', 'Interested', 'Quoted', 'Negotiating', 'Accepted', 'Rejected', 'On Hold')),
  scope_description       text,
  quantity                numeric(12,2) check (quantity > 0),
  billing_frequency       varchar(30) check (billing_frequency in ('One-time', 'Monthly', 'Quarterly', 'Annual', 'Other')),
  currency_code           char(3) not null default 'AED' check (currency_code ~ '^[A-Z]{3}$'),
  client_budget_amount    numeric(18,2) check (client_budget_amount >= 0),
  estimated_fee_amount    numeric(18,2) check (estimated_fee_amount >= 0),
  proposed_fee_amount     numeric(18,2) check (proposed_fee_amount >= 0),
  final_agreed_fee_amount numeric(18,2) check (final_agreed_fee_amount >= 0),
  discount_amount         numeric(18,2) check (discount_amount >= 0),
  quotation_id            uuid references public.bd_quotations(id),
  expected_start_date     date,
  expected_close_date     date,
  accepted_at             timestamptz,
  rejected_at             timestamptz,
  rejection_reason        text,
  notes                   text,
  created_by              uuid not null references public.profiles(id),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint bd_lead_services_accepted check (service_status <> 'Accepted'
             or (accepted_at is not null and final_agreed_fee_amount is not null and billing_frequency is not null)),
  constraint bd_lead_services_rejected check (service_status <> 'Rejected' or rejected_at is not null)
);

create table if not exists public.bd_quotation_items (
  id              uuid primary key default gen_random_uuid(),
  quotation_id    uuid not null references public.bd_quotations(id) on delete cascade,
  lead_service_id uuid references public.bd_lead_services(id),
  line_no         integer not null check (line_no >= 1),
  description     text not null,
  quantity        numeric(12,2) not null default 1 check (quantity > 0),
  unit_price      numeric(18,2) not null check (unit_price >= 0),
  discount_amount numeric(18,2) not null default 0 check (discount_amount >= 0),
  line_total      numeric(18,2) not null check (line_total >= 0),
  billing_frequency varchar(30) check (billing_frequency in ('One-time', 'Monthly', 'Quarterly', 'Annual', 'Other')),
  unique (quotation_id, line_no),
  constraint bd_quotation_items_total check (line_total = round(quantity * unit_price - discount_amount, 2))
);

-- ── 6. Discussions and follow-ups ────────────────────────────────────

create table if not exists public.bd_discussions (
  id                    uuid primary key default gen_random_uuid(),
  lead_id               uuid not null references public.bd_leads(id),
  lead_service_id       uuid references public.bd_lead_services(id),
  occurred_at           timestamptz not null,
  channel               varchar(30) not null check (channel in ('Call', 'WhatsApp', 'Email', 'Meeting', 'Social', 'Other')),
  direction             varchar(20) not null check (direction in ('Inbound', 'Outbound', 'Internal')),
  contact_person        varchar(255),
  outcome               varchar(100) not null,
  requirement_summary   text not null check (btrim(requirement_summary) <> ''),
  discussion_summary    text not null check (length(btrim(discussion_summary)) >= 10),
  client_interest_level varchar(30) check (client_interest_level in ('Hot', 'Warm', 'Cold', 'Unknown')),
  objections            text,
  agreed_next_action    text,
  next_followup_at      timestamptz,
  no_followup_reason    text,
  external_reference    varchar(255),
  attachment_reference  text,
  recorded_by           uuid not null references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint bd_discussions_next_step check (
    next_followup_at is not null or nullif(btrim(no_followup_reason), '') is not null)
);

create table if not exists public.bd_followups (
  id                  uuid primary key default gen_random_uuid(),
  lead_id             uuid not null references public.bd_leads(id),
  lead_service_id     uuid references public.bd_lead_services(id),
  discussion_id       uuid references public.bd_discussions(id),
  assigned_to_user_id uuid not null references public.profiles(id),
  followup_type       varchar(30) not null check (followup_type in ('Call', 'WhatsApp', 'Email', 'Meeting', 'Other')),
  scheduled_at        timestamptz not null,
  objective           text not null check (btrim(objective) <> ''),
  status              varchar(30) not null default 'Scheduled'
                      check (status in ('Scheduled', 'Completed', 'Rescheduled', 'Cancelled')),
  completed_at        timestamptz,
  outcome             varchar(100),
  completion_summary  text,
  next_action         text,
  next_followup_at    timestamptz,
  reminder_at         timestamptz,
  escalation_level    integer not null default 0 check (escalation_level >= 0),
  created_by          uuid not null references public.profiles(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint bd_followups_completed check (status <> 'Completed'
             or (completed_at is not null and outcome is not null and nullif(btrim(completion_summary), '') is not null))
);

-- Reschedules, cancellations and completions keep the original schedule
create table if not exists public.bd_followup_history (
  id                     uuid primary key default gen_random_uuid(),
  followup_id            uuid not null references public.bd_followups(id),
  action                 varchar(30) not null check (action in ('Rescheduled', 'Completed', 'Cancelled', 'Reassigned')),
  previous_scheduled_at  timestamptz,
  new_scheduled_at       timestamptz,
  previous_assignee_id   uuid references public.profiles(id),
  new_assignee_id        uuid references public.profiles(id),
  reason                 text,
  changed_by_user_id     uuid not null references public.profiles(id),
  changed_at             timestamptz not null default now()
);

-- ── 7. History ───────────────────────────────────────────────────────

create table if not exists public.bd_lead_stage_history (
  id                                 uuid primary key default gen_random_uuid(),
  lead_id                            uuid not null references public.bd_leads(id),
  from_stage_id                      uuid references public.bd_pipeline_stages(id),
  to_stage_id                        uuid not null references public.bd_pipeline_stages(id),
  from_status                        varchar(30),
  to_status                          varchar(30) not null,
  changed_by_user_id                 uuid not null references public.profiles(id),
  changed_at                         timestamptz not null default now(),
  reason                             text,
  duration_in_previous_stage_seconds bigint check (duration_in_previous_stage_seconds >= 0),
  transition_metadata                jsonb
);

create table if not exists public.bd_lead_assignment_history (
  id                     uuid primary key default gen_random_uuid(),
  lead_id                uuid not null references public.bd_leads(id),
  previous_owner_user_id uuid references public.profiles(id),
  new_owner_user_id      uuid not null references public.profiles(id),
  previous_team_id       uuid references public.crm_teams(id),
  new_team_id            uuid references public.crm_teams(id),
  changed_by_user_id     uuid not null references public.profiles(id),
  changed_at             timestamptz not null default now(),
  assignment_reason      text
);

-- ── 8. Onboarding handover ───────────────────────────────────────────

create table if not exists public.bd_onboarding_handovers (
  id                          uuid primary key default gen_random_uuid(),
  handover_number             varchar(50) not null unique
                              default public.bd_next_ref('HO', 'public.bd_handover_number_seq'),
  lead_id                     uuid not null references public.bd_leads(id),
  client_id                   varchar(20) check (client_id ~ '^CL[0-9]{6,}$'),  -- Client Module Client ID
  status                      varchar(30) not null default 'Pending'
                              check (status in ('Pending', 'Accepted', 'In Progress', 'Blocked', 'Completed', 'Cancelled')),
  won_at                      timestamptz not null,
  handed_over_at              timestamptz,
  handed_over_by              uuid not null references public.profiles(id),
  assigned_onboarding_user_id uuid references public.profiles(id),
  assigned_team_id            uuid references public.crm_teams(id),
  accepted_at                 timestamptz,
  completed_at                timestamptz,
  handover_notes              text,
  missing_items               jsonb not null default '[]'::jsonb,
  source_snapshot             jsonb,
  idempotency_key             varchar(100) unique,   -- request key of the Mark Won call that created it
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint bd_handovers_completed check (status <> 'Completed' or (completed_at is not null and client_id is not null))
);

-- Only one live handover per lead (a cancelled one may be replaced after a reopen)
create unique index if not exists bd_handovers_one_active
  on public.bd_onboarding_handovers (lead_id) where status <> 'Cancelled';

do $$ begin
  alter table public.bd_leads add constraint bd_leads_onboarding_handover_fk
    foreign key (onboarding_handover_id) references public.bd_onboarding_handovers(id);
exception when duplicate_object then null; end $$;

-- ── 9. Audit log (append-only) ───────────────────────────────────────

create table if not exists public.bd_audit_logs (
  id                 uuid primary key default gen_random_uuid(),
  entity_type        varchar(100) not null,
  entity_id          uuid not null,
  action             varchar(50) not null check (action in
                     ('Create', 'Update', 'Delete', 'Archive', 'Assign', 'Stage Change', 'Convert', 'Lost', 'Reopen', 'Export')),
  changed_by_user_id uuid references public.profiles(id),
  changed_at         timestamptz not null default now(),
  previous_values    jsonb,
  new_values         jsonb,
  reason             text,
  request_reference  varchar(100)
);

create or replace function public.bd_append_only()
returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name;
end $$;
do $$
declare t text;
begin
  foreach t in array array['bd_audit_logs', 'bd_lead_stage_history', 'bd_lead_assignment_history', 'bd_followup_history']
  loop
    execute format('drop trigger if exists %I_append_only on public.%I', t, t);
    execute format('create trigger %I_append_only before update or delete on public.%I '
                   'for each row execute function public.bd_append_only()', t, t);
  end loop;
end $$;

-- ── 10. Indexes (spec section 19) ────────────────────────────────────

create index if not exists bd_leads_assigned_idx     on public.bd_leads (assigned_to_user_id) where archived_at is null;
create index if not exists bd_leads_acquired_idx     on public.bd_leads (acquired_by_user_id);
create index if not exists bd_leads_stage_idx        on public.bd_leads (stage_id);
create index if not exists bd_leads_status_idx       on public.bd_leads (status);
create index if not exists bd_leads_source_idx       on public.bd_leads (source_id);
create index if not exists bd_leads_campaign_idx     on public.bd_leads (campaign_id);
create index if not exists bd_leads_created_idx      on public.bd_leads (created_at);
create index if not exists bd_leads_next_fu_idx      on public.bd_leads (next_followup_at) where status = 'Open';
create index if not exists bd_leads_client_idx       on public.bd_leads (converted_client_id);
-- duplicate checks (not unique: shared company numbers are legitimate)
create index if not exists bd_leads_mobile_idx       on public.bd_leads (mobile_normalized);
create index if not exists bd_leads_email_idx        on public.bd_leads (email_normalized);
create index if not exists bd_leads_licence_idx      on public.bd_leads (upper(trade_licence_number));
create index if not exists bd_leads_trn_idx          on public.bd_leads (vat_trn);
create index if not exists bd_leads_company_idx      on public.bd_leads (lower(company_name));
create index if not exists bd_lead_services_lead_idx on public.bd_lead_services (lead_id);
create unique index if not exists bd_lead_services_one_open
  on public.bd_lead_services (lead_id, service_id) where service_status not in ('Rejected');
create index if not exists bd_discussions_lead_idx   on public.bd_discussions (lead_id, occurred_at desc);
create index if not exists bd_followups_user_idx     on public.bd_followups (assigned_to_user_id, scheduled_at);
create index if not exists bd_followups_lead_idx     on public.bd_followups (lead_id, status);
create index if not exists bd_followups_status_idx   on public.bd_followups (status, scheduled_at);
create index if not exists bd_stage_history_idx      on public.bd_lead_stage_history (lead_id, changed_at);
create index if not exists bd_assign_history_idx     on public.bd_lead_assignment_history (lead_id, changed_at);
create index if not exists bd_quotations_lead_idx    on public.bd_quotations (lead_id);
create index if not exists bd_handovers_lead_idx     on public.bd_onboarding_handovers (lead_id);
create index if not exists bd_audit_entity_idx       on public.bd_audit_logs (entity_type, entity_id, changed_at);
-- lead_number, quotation_number, handover_number: indexed by their UNIQUE constraints

-- ── 11. Derived view: stage ageing and progress ──────────────────────

create or replace view public.bd_lead_pipeline_v as
select l.id, l.lead_number, l.prospect_name, l.status, l.assigned_to_user_id,
       s.stage_code, s.stage_name, s.stage_order, s.progress_weight, s.default_probability,
       coalesce((select max(h.changed_at) from public.bd_lead_stage_history h
                 where h.lead_id = l.id and h.to_stage_id = l.stage_id), l.case_opened_at) as stage_entered_at,
       now() - coalesce((select max(h.changed_at) from public.bd_lead_stage_history h
                 where h.lead_id = l.id and h.to_stage_id = l.stage_id), l.case_opened_at) as stage_age
from public.bd_leads l
join public.bd_pipeline_stages s on s.id = l.stage_id
where l.archived_at is null;
