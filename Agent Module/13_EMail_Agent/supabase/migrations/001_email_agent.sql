-- Email Agent (AGT-13-EMAIL): reads CRM Email Base and turns mail into notifications,
-- calendar entries (CEO meetings, reminders, tasks) and follow-up / digest alerts.
--
-- Apply to the CRM Supabase project (pnnakrhfzyxudjaghoxx) after Email Base migrations
-- 001-006 and the CEO schema (ceo.records, ceo.meetings, ceo.tasks, ceo.reminders).
-- Then expose the `email_agent` schema in Project Settings > Data API and deploy the
-- `email-agent` Edge Function from Agent Module/13_EMail_Agent/supabase/email-agent.
--
-- The agent never sends, moves, deletes or flags mail. It writes only:
--   * its own tables in this schema,
--   * public.notifications rows for the mailbox owner,
--   * ceo.records / ceo.meetings / ceo.tasks / ceo.reminders rows for the mailbox owner,
--   * email_base.threads.tags and is_important.
begin;

create schema if not exists email_agent;
revoke all on schema email_agent from public, anon;
grant usage on schema email_agent to authenticated, service_role;

-- Per mailbox owner. A row is created with these defaults on the agent's first run.
create table if not exists email_agent.settings (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  -- Add meetings, deadlines and tasks to the calendar without review when the
  -- extraction is at least min_confidence; below it they wait as proposals.
  auto_calendar boolean not null default true,
  min_confidence numeric(3,2) not null default 0.75 check (min_confidence between 0 and 1),
  notify_priorities text[] not null default '{urgent,high}',
  follow_up_days integer not null default 3 check (follow_up_days between 1 and 60),
  digest_hour integer not null default 8 check (digest_hour between 0 and 23),
  -- Only mail received after this moment is processed (no full-history backfill).
  process_since timestamptz not null default now() - interval '3 days',
  timezone text not null default 'Asia/Dubai',
  updated_at timestamptz not null default now()
);

create table if not exists email_agent.rules (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  match_type text not null check (match_type in ('sender', 'domain', 'subject')),
  pattern text not null check (char_length(pattern) between 1 and 320),
  action text not null check (action in ('vip', 'ignore', 'no_calendar', 'always_notify')),
  note text,
  created_at timestamptz not null default now(),
  unique (owner_user_id, match_type, pattern, action)
);

-- One row per processed Email Base message. Also stops the same RFC Message-ID being
-- processed twice when it sits in several folders.
create table if not exists email_agent.processed (
  message_id uuid primary key references email_base.messages(id) on delete cascade,
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  thread_id uuid references email_base.threads(id) on delete cascade,
  rfc_message_id text,
  status text not null check (status in ('done', 'skipped', 'failed')),
  reason text,
  priority text,
  category text,
  phishing_risk text,
  attempts integer not null default 1,
  processed_at timestamptz not null default now()
);
create index if not exists processed_rfc_idx on email_agent.processed(mailbox_id, rfc_message_id);

create table if not exists email_agent.insights (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  mailbox_id uuid not null references email_base.mailboxes(id) on delete cascade,
  thread_id uuid references email_base.threads(id) on delete cascade,
  message_id uuid references email_base.messages(id) on delete cascade,
  kind text not null check (kind in (
    'meeting', 'deadline', 'payment', 'task', 'reminder', 'document_request',
    'follow_up', 'phishing', 'notice'
  )),
  title text not null check (char_length(title) between 1 and 300),
  detail text check (detail is null or char_length(detail) <= 2000),
  starts_at timestamptz,
  ends_at timestamptz,
  due_at timestamptz,
  location text,
  priority text not null default 'normal' check (priority in ('urgent', 'high', 'normal', 'low')),
  confidence numeric(3,2) not null default 0 check (confidence between 0 and 1),
  evidence text check (evidence is null or char_length(evidence) <= 600),
  source text not null default 'ai' check (source in ('ai', 'ics', 'rule', 'sql')),
  status text not null default 'proposed' check (status in ('proposed', 'applied', 'dismissed', 'notified')),
  applied_table text,
  applied_id uuid,
  reminder_id uuid,
  notification_id uuid,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, dedupe_key)
);
create index if not exists insights_owner_idx on email_agent.insights(owner_user_id, status, created_at desc);
create index if not exists insights_thread_idx on email_agent.insights(thread_id);

create table if not exists email_agent.runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null check (trigger in ('schedule', 'manual')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb not null default '{}'::jsonb,
  errors text[] not null default '{}'
);
create index if not exists runs_started_idx on email_agent.runs(started_at desc);

create table if not exists email_agent.digests (
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  digest_date date not null,
  body text not null,
  stats jsonb not null default '{}'::jsonb,
  notification_id uuid,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, digest_date)
);

-- Inbound messages waiting for the agent, oldest first. A message is skipped when the
-- same RFC Message-ID of the same mailbox was already processed from another folder.
create or replace function email_agent.pending_messages(p_limit integer default 30)
returns table (id uuid, mailbox_id uuid, owner_user_id uuid)
language sql stable security definer set search_path = '' as $$
  select m.id, m.mailbox_id, mb.owner_user_id
  from email_base.messages m
  join email_base.mailboxes mb on mb.id = m.mailbox_id and mb.enabled and mb.owner_user_id is not null
  left join email_agent.settings s on s.owner_user_id = mb.owner_user_id
  where m.direction = 'inbound'
    and coalesce(s.enabled, true)
    and coalesce(m.sent_at, m.created_at) >= coalesce(s.process_since, now() - interval '3 days')
    -- A failed message is retried until it has failed 3 times.
    and not exists (
      select 1 from email_agent.processed p
      where p.message_id = m.id and not (p.status = 'failed' and p.attempts < 3)
    )
    and not (
      m.message_id is not null and exists (
        select 1 from email_agent.processed p
        where p.mailbox_id = m.mailbox_id and p.rfc_message_id = m.message_id
          and p.message_id <> m.id and p.status in ('done', 'skipped')
      )
    )
  order by coalesce(m.sent_at, m.created_at)
  limit greatest(1, least(p_limit, 200));
$$;

-- Conversations whose latest message was sent by us and has had no answer for
-- follow_up_days, with no follow-up alert raised since that message.
create or replace function email_agent.follow_up_candidates(p_limit integer default 10)
returns table (
  thread_id uuid, mailbox_id uuid, owner_user_id uuid, subject text,
  last_sent_at timestamptz, to_addresses text[], days_waiting integer
)
language sql stable security definer set search_path = '' as $$
  with last_msg as (
    select distinct on (m.thread_id) m.thread_id, m.mailbox_id, m.direction, m.subject, m.to_addresses,
           coalesce(m.sent_at, m.created_at) as at
    from email_base.messages m
    order by m.thread_id, coalesce(m.sent_at, m.created_at) desc
  )
  select l.thread_id, l.mailbox_id, mb.owner_user_id, l.subject, l.at, l.to_addresses,
         extract(day from now() - l.at)::integer
  from last_msg l
  join email_base.mailboxes mb on mb.id = l.mailbox_id and mb.enabled and mb.owner_user_id is not null
  join email_base.threads t on t.id = l.thread_id and t.status <> 'archived'
  left join email_agent.settings s on s.owner_user_id = mb.owner_user_id
  where l.direction = 'outbound'
    and coalesce(s.enabled, true)
    and l.at < now() - make_interval(days => coalesce(s.follow_up_days, 3))
    and l.at > now() - interval '30 days'
    and cardinality(l.to_addresses) > 0
    and not exists (
      select 1 from email_agent.insights i
      where i.thread_id = l.thread_id and i.kind = 'follow_up' and i.created_at > l.at
    )
  order by l.at
  limit greatest(1, least(p_limit, 50));
$$;

revoke all on function email_agent.pending_messages(integer) from public, anon, authenticated;
revoke all on function email_agent.follow_up_candidates(integer) from public, anon, authenticated;
grant execute on function email_agent.pending_messages(integer) to service_role;
grant execute on function email_agent.follow_up_candidates(integer) to service_role;

-- Shared secret for the scheduler's calls to email-agent; only the service role can check it.
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'email_agent_secret', 'Header secret for the email-agent cron call')
where not exists (select 1 from vault.secrets where name = 'email_agent_secret');

create or replace function email_agent.check_secret(candidate text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'email_agent_secret' and decrypted_secret = candidate);
$$;
revoke all on function email_agent.check_secret(text) from public, anon, authenticated;
grant execute on function email_agent.check_secret(text) to service_role;

-- Access: owners read their own rows, edit their settings and rules, and dismiss
-- proposals. Applying a proposal goes through the Edge Function.
alter table email_agent.settings enable row level security;
alter table email_agent.rules enable row level security;
alter table email_agent.processed enable row level security;
alter table email_agent.insights enable row level security;
alter table email_agent.runs enable row level security;
alter table email_agent.digests enable row level security;

revoke all on all tables in schema email_agent from anon, authenticated;
grant select, insert on email_agent.settings to authenticated;
grant update (enabled, auto_calendar, min_confidence, notify_priorities, follow_up_days, digest_hour, timezone)
  on email_agent.settings to authenticated;
grant select, insert, delete on email_agent.rules to authenticated;
grant select on email_agent.insights, email_agent.digests, email_agent.runs to authenticated;
grant update (status) on email_agent.insights to authenticated;
grant all on all tables in schema email_agent to service_role;

drop policy if exists settings_own on email_agent.settings;
create policy settings_own on email_agent.settings for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
drop policy if exists rules_own on email_agent.rules;
create policy rules_own on email_agent.rules for all to authenticated
  using (owner_user_id = (select auth.uid())) with check (owner_user_id = (select auth.uid()));
drop policy if exists insights_select_own on email_agent.insights;
create policy insights_select_own on email_agent.insights for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists insights_dismiss_own on email_agent.insights;
create policy insights_dismiss_own on email_agent.insights for update to authenticated
  using (owner_user_id = (select auth.uid()) and status in ('proposed', 'notified'))
  with check (owner_user_id = (select auth.uid()) and status = 'dismissed');
drop policy if exists digests_select_own on email_agent.digests;
create policy digests_select_own on email_agent.digests for select to authenticated
  using (owner_user_id = (select auth.uid()));
drop policy if exists runs_select_owners on email_agent.runs;
create policy runs_select_owners on email_agent.runs for select to authenticated
  using (exists (select 1 from email_base.mailboxes mb where mb.owner_user_id = (select auth.uid())));

-- Every 10 minutes, offset from the 5-minute mail sync so new mail is usually stored first.
select cron.unschedule(jobid) from cron.job where jobname = 'email-agent-run';
select cron.schedule(
  'email-agent-run',
  '2-59/10 * * * *',
  $$
  select net.http_post(
    url := 'https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/email-agent',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-agent-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'email_agent_secret')
    ),
    body := '{"action":"run"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Add email_agent to the schemas the Data API exposes, keeping whatever is already listed.
do $$
declare
  current_list text;
begin
  select split_part(cfg, '=', 2) into current_list
  from pg_db_role_setting s
  join pg_roles r on r.oid = s.setrole
  cross join unnest(s.setconfig) cfg
  where r.rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%'
  limit 1;
  current_list := coalesce(nullif(current_list, ''), 'public, graphql_public, acct, ceo, email_base');
  if position('email_agent' in current_list) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', current_list || ', email_agent');
  end if;
end $$;
notify pgrst, 'reload config';

commit;
