begin;

create extension if not exists pgcrypto with schema extensions;
create schema if not exists ceo;
revoke all on schema ceo from public, anon;
grant usage on schema ceo to authenticated, service_role;

create table ceo.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  timezone text not null default 'Asia/Dubai',
  require_mfa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table ceo.captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  input_text text,
  transcript text,
  audio_path text,
  status text not null default 'accepted'
    check (status in (
      'accepted', 'transcription_pending', 'extraction_pending',
      'awaiting_review', 'database_write_pending', 'saved',
      'external_action_pending', 'completed', 'failed'
    )),
  error_message text,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(input_text, '') || ' ' || coalesce(transcript, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (input_text is null or char_length(input_text) <= 20000),
  check (transcript is null or char_length(transcript) <= 20000),
  unique (user_id, idempotency_key),
  unique (user_id, id)
);
create index captures_search_idx on ceo.captures using gin(search_vector);
create index captures_user_created_idx on ceo.captures(user_id, created_at desc);

create table ceo.records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in (
    'person', 'organization', 'client', 'contact', 'task', 'decision',
    'meeting', 'project', 'milestone', 'idea', 'risk', 'document', 'note'
  )),
  title text not null,
  summary text,
  attributes jsonb not null default '{}'::jsonb,
  source_capture_id uuid,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, source_capture_id)
    references ceo.captures(user_id, id)
);
create index records_search_idx on ceo.records using gin(search_vector);
create index records_type_updated_idx on ceo.records(user_id, record_type, updated_at desc);

create table ceo.people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  full_name text not null,
  email text,
  phone text,
  organization_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);
create index people_name_idx on ceo.people(user_id, lower(full_name));

create table ceo.organizations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  name text not null,
  organization_type text,
  country_code char(2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);
create index organizations_name_idx on ceo.organizations(user_id, lower(name));
alter table ceo.people
  add constraint people_organization_owner_fk
  foreign key (user_id, organization_id)
  references ceo.organizations(user_id, id);

create table ceo.crm_external_refs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  provider text not null,
  external_type text not null,
  external_id text not null,
  last_synced_at timestamptz,
  sync_status text not null default 'not_synced'
    check (sync_status in ('not_synced', 'synced', 'conflict', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_type, external_id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);

create table ceo.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_at timestamptz,
  completed_at timestamptz,
  assigned_to uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);
create index tasks_due_idx on ceo.tasks(user_id, due_at) where status not in ('done', 'cancelled');

create table ceo.decisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  decision_text text not null,
  rationale text,
  decided_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'reversed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);

create table ceo.decision_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  decision_id uuid not null,
  changed_by uuid references auth.users(id) on delete set null,
  change_type text not null check (change_type in ('created', 'updated', 'superseded', 'reversed')),
  previous_state jsonb,
  new_state jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (user_id, decision_id) references ceo.decisions(user_id, id) on delete cascade
);

create table ceo.meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Dubai',
  summary text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade,
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create table ceo.meeting_participants (
  user_id uuid not null references auth.users(id) on delete cascade,
  meeting_id uuid not null,
  person_id uuid not null,
  participation_role text,
  primary key (user_id, meeting_id, person_id),
  foreign key (user_id, meeting_id) references ceo.meetings(user_id, id) on delete cascade,
  foreign key (user_id, person_id) references ceo.people(user_id, id) on delete cascade
);

create table ceo.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  name text not null,
  status text not null default 'planned'
    check (status in ('planned', 'active', 'paused', 'completed', 'cancelled')),
  start_date date,
  target_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade,
  check (target_date is null or start_date is null or target_date >= start_date)
);

create table ceo.milestones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null,
  title text not null,
  due_at timestamptz,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'done', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, project_id) references ceo.projects(user_id, id) on delete cascade
);

create table ceo.ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  status text not null default 'captured'
    check (status in ('captured', 'evaluating', 'parked', 'accepted', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);

create table ceo.risks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  likelihood smallint check (likelihood between 1 and 5),
  impact smallint check (impact between 1 and 5),
  mitigation text,
  status text not null default 'open'
    check (status in ('open', 'mitigating', 'accepted', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);

create table ceo.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid not null,
  storage_provider text not null default 'onedrive'
    check (storage_provider in ('onedrive', 'supabase', 'external')),
  storage_reference text not null,
  mime_type text,
  retention_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id) on delete cascade
);

create table ceo.record_relationships (
  user_id uuid not null references auth.users(id) on delete cascade,
  from_record_id uuid not null,
  to_record_id uuid not null,
  relationship_type text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, from_record_id, to_record_id, relationship_type),
  foreign key (user_id, from_record_id) references ceo.records(user_id, id) on delete cascade,
  foreign key (user_id, to_record_id) references ceo.records(user_id, id) on delete cascade,
  check (from_record_id <> to_record_id)
);

create table ceo.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  record_id uuid,
  title text not null,
  body text,
  scheduled_at timestamptz not null,
  timezone text not null default 'Asia/Dubai',
  channel text not null default 'in_app'
    check (channel in ('in_app', 'email', 'push')),
  provider_reference text,
  delivery_status text not null default 'scheduled'
    check (delivery_status in ('scheduled', 'processing', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, record_id) references ceo.records(user_id, id)
);
create index reminders_schedule_idx on ceo.reminders(delivery_status, scheduled_at)
  where delivery_status in ('scheduled', 'failed');

create table ceo.reminder_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id uuid not null,
  attempted_at timestamptz not null default now(),
  status text not null check (status in ('sent', 'failed')),
  provider_reference text,
  error_message text,
  foreign key (user_id, reminder_id) references ceo.reminders(user_id, id) on delete cascade
);

create table ceo.agent_registry (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_key text not null,
  purpose text not null,
  enabled boolean not null default false,
  rate_limit_per_minute integer not null default 0 check (rate_limit_per_minute >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agent_key),
  unique (user_id, id)
);

create table ceo.agent_permissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null,
  record_type text not null,
  permitted_operations text[] not null default '{}',
  data_scope jsonb not null default '{}'::jsonb,
  approval_required boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, agent_id, record_type),
  foreign key (user_id, agent_id) references ceo.agent_registry(user_id, id) on delete cascade
);

create table ceo.approval_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid,
  action_type text not null,
  proposed_change jsonb not null,
  reason text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'executed')),
  expires_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, agent_id) references ceo.agent_registry(user_id, id)
);

create table ceo.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  actor_type text not null check (actor_type in ('user', 'agent', 'system')),
  actor_id text not null,
  action text not null,
  record_type text,
  record_id uuid,
  outcome text not null check (outcome in ('allowed', 'denied', 'failed', 'pending')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_user_created_idx on ceo.audit_logs(user_id, created_at desc);

create table ceo.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  capture_id uuid,
  job_type text not null,
  idempotency_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (user_id, capture_id) references ceo.captures(user_id, id)
);
create index processing_jobs_queue_idx on ceo.processing_jobs(available_at)
  where status in ('queued', 'retrying');

create table ceo.integration_sync_state (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  entity_type text not null,
  cursor text,
  last_synced_at timestamptz,
  status text not null default 'idle'
    check (status in ('idle', 'running', 'failed', 'paused')),
  last_error text,
  updated_at timestamptz not null default now(),
  unique (user_id, provider, entity_type)
);

create table ceo.outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null,
  idempotency_key text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index outbox_delivery_idx on ceo.outbox(available_at)
  where status in ('pending', 'failed');

create or replace function ceo.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function ceo.set_updated_at() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'captures', 'records', 'people', 'organizations',
    'crm_external_refs', 'tasks', 'decisions', 'meetings', 'projects',
    'milestones', 'ideas', 'risks', 'documents', 'reminders',
    'agent_registry', 'agent_permissions', 'approval_requests',
    'processing_jobs', 'integration_sync_state', 'outbox'
  ]
  loop
    execute format(
      'create trigger %I before update on ceo.%I for each row execute function ceo.set_updated_at()',
      table_name || '_set_updated_at', table_name
    );
  end loop;
end;
$$;

alter table ceo.profiles enable row level security;
alter table ceo.captures enable row level security;
alter table ceo.records enable row level security;
alter table ceo.people enable row level security;
alter table ceo.organizations enable row level security;
alter table ceo.crm_external_refs enable row level security;
alter table ceo.tasks enable row level security;
alter table ceo.decisions enable row level security;
alter table ceo.decision_history enable row level security;
alter table ceo.meetings enable row level security;
alter table ceo.meeting_participants enable row level security;
alter table ceo.projects enable row level security;
alter table ceo.milestones enable row level security;
alter table ceo.ideas enable row level security;
alter table ceo.risks enable row level security;
alter table ceo.documents enable row level security;
alter table ceo.record_relationships enable row level security;
alter table ceo.reminders enable row level security;
alter table ceo.reminder_attempts enable row level security;
alter table ceo.agent_registry enable row level security;
alter table ceo.agent_permissions enable row level security;
alter table ceo.approval_requests enable row level security;
alter table ceo.audit_logs enable row level security;
alter table ceo.processing_jobs enable row level security;
alter table ceo.integration_sync_state enable row level security;
alter table ceo.outbox enable row level security;

grant select on all tables in schema ceo to authenticated;
grant insert, delete on ceo.captures to authenticated;
grant insert, update, delete on
  ceo.records, ceo.people, ceo.organizations,
  ceo.crm_external_refs, ceo.tasks, ceo.decisions, ceo.meetings,
  ceo.meeting_participants, ceo.projects, ceo.milestones, ceo.ideas,
  ceo.risks, ceo.documents, ceo.record_relationships, ceo.reminders
to authenticated;
grant insert on ceo.approval_requests to authenticated;
grant all on all tables in schema ceo to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'records', 'people', 'organizations', 'crm_external_refs',
    'tasks', 'decisions', 'decision_history', 'meetings', 'meeting_participants',
    'projects', 'milestones', 'ideas', 'risks', 'documents',
    'record_relationships', 'reminders', 'reminder_attempts', 'agent_registry',
    'agent_permissions', 'approval_requests', 'audit_logs', 'processing_jobs',
    'integration_sync_state', 'outbox'
  ]
  loop
    execute format(
      'create policy %I on ceo.%I for select to authenticated using (user_id = (select auth.uid()))',
      table_name || '_select_own', table_name
    );
  end loop;

  -- captures is excluded: its stricter insert policy is created below.
  foreach table_name in array array[
    'records', 'people', 'organizations', 'crm_external_refs',
    'tasks', 'decisions', 'meetings', 'meeting_participants', 'projects',
    'milestones', 'ideas', 'risks', 'documents', 'record_relationships', 'reminders'
  ]
  loop
    execute format(
      'create policy %I on ceo.%I for insert to authenticated with check (user_id = (select auth.uid()))',
      table_name || '_insert_own', table_name
    );
  end loop;

  foreach table_name in array array[
    'records', 'people', 'organizations', 'crm_external_refs',
    'tasks', 'decisions', 'meetings', 'meeting_participants', 'projects',
    'milestones', 'ideas', 'risks', 'documents', 'record_relationships', 'reminders'
  ]
  loop
    execute format(
      'create policy %I on ceo.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      table_name || '_update_own', table_name
    );
  end loop;

  foreach table_name in array array[
    'captures', 'records', 'people', 'organizations', 'crm_external_refs',
    'tasks', 'decisions', 'meetings', 'meeting_participants', 'projects',
    'milestones', 'ideas', 'risks', 'documents', 'record_relationships', 'reminders'
  ]
  loop
    execute format(
      'create policy %I on ceo.%I for delete to authenticated using (user_id = (select auth.uid()))',
      table_name || '_delete_own', table_name
    );
  end loop;

  execute 'create policy captures_insert_own on ceo.captures for insert to authenticated with check (user_id = (select auth.uid()) and status = ''accepted'' and transcript is null and audio_path is null and error_message is null)';
  execute 'create policy profiles_select_self on ceo.profiles for select to authenticated using (user_id = (select auth.uid()))';
  execute 'create policy approval_requests_insert_own on ceo.approval_requests for insert to authenticated with check (user_id = (select auth.uid()) and status = ''pending'' and resolved_at is null and resolved_by is null)';
end;
$$;

revoke all on all tables in schema ceo from anon, public;
grant usage on schema ceo to authenticated, service_role;
alter default privileges in schema ceo revoke all on tables from public, anon;
alter default privileges in schema ceo grant select on tables to authenticated;
alter default privileges in schema ceo grant all on tables to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ceo-captures',
  'ceo-captures',
  false,
  52428800,
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The bucket is intentionally inaccessible until an approved retention policy
-- and a durable cleanup worker are configured. Add Storage policies then.

commit;
