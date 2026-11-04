begin;

alter table ceo.mail_threads
  add column if not exists is_important boolean not null default false;

alter table ceo.mail_threads
  add column if not exists assistant_search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(subject, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(key_points::text, '')
    )
  ) stored;
create index if not exists mail_threads_assistant_search_idx
  on ceo.mail_threads using gin(assistant_search_vector);

grant update (status, is_important) on ceo.mail_threads to authenticated;

create table ceo.mail_saved_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  subject text not null,
  fact text not null,
  fact_hash bytea generated always as (
    extensions.digest(convert_to(fact, 'UTF8'), 'sha256')
  ) stored,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(fact, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (user_id, thread_id, fact_hash),
  foreign key (user_id, thread_id) references ceo.mail_threads(user_id, id) on delete cascade,
  check (char_length(fact) between 1 and 2000),
  check (char_length(subject) between 1 and 1000)
);
create index mail_saved_facts_search_idx on ceo.mail_saved_facts using gin(search_vector);
create index mail_saved_facts_user_created_idx on ceo.mail_saved_facts(user_id, created_at desc);

alter table ceo.mail_saved_facts enable row level security;
revoke all on ceo.mail_saved_facts from anon, public;
grant select, insert on ceo.mail_saved_facts to authenticated;
grant all on ceo.mail_saved_facts to service_role;
create policy mail_saved_facts_select_own on ceo.mail_saved_facts
  for select to authenticated using (user_id = (select auth.uid()));
create policy mail_saved_facts_insert_own on ceo.mail_saved_facts
  for insert to authenticated with check (user_id = (select auth.uid()));
create table ceo.mail_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, thread_id) references ceo.mail_threads(user_id, id) on delete cascade,
  check (char_length(to_address) between 3 and 320),
  check (char_length(subject) between 1 and 1000),
  check (char_length(body) between 1 and 10000)
);
create index mail_drafts_user_status_idx on ceo.mail_drafts(user_id, status, created_at desc);

alter table ceo.mail_drafts enable row level security;
revoke all on ceo.mail_drafts from anon, public;
grant select, insert on ceo.mail_drafts to authenticated;
grant update (body, status) on ceo.mail_drafts to authenticated;
grant all on ceo.mail_drafts to service_role;
create policy mail_drafts_select_own on ceo.mail_drafts
  for select to authenticated using (user_id = (select auth.uid()));
create policy mail_drafts_insert_own on ceo.mail_drafts
  for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'draft');
create policy mail_drafts_update_own on ceo.mail_drafts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and status in ('draft', 'approved', 'cancelled'));

create trigger mail_drafts_set_updated_at
  before update on ceo.mail_drafts
  for each row execute function ceo.set_updated_at();

create or replace function ceo.audit_mail_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_user uuid;
  actor text;
  action_name text;
  affected_id uuid;
  details jsonb;
begin
  affected_user := coalesce(new.user_id, old.user_id);
  actor := nullif(current_setting('request.jwt.claim.sub', true), '');

  if actor is null then
    actor := 'system';
  end if;

  if tg_table_name = 'mail_threads' then
    affected_id := new.id;
    if tg_op = 'UPDATE' and old.is_important is distinct from new.is_important then
      action_name := case when new.is_important then 'mail_marked_important' else 'mail_unmarked_important' end;
      details := jsonb_build_object('subject', new.subject);
    elsif tg_op = 'UPDATE' and old.status is distinct from new.status then
      action_name := 'mail_status_changed';
      details := jsonb_build_object('from', old.status, 'to', new.status, 'subject', new.subject);
    else
      return new;
    end if;
  elsif tg_table_name = 'mail_saved_facts' then
    affected_id := new.thread_id;
    action_name := 'mail_fact_saved';
    details := jsonb_build_object('subject', new.subject, 'fact_id', new.id);
  elsif tg_table_name = 'mail_drafts' then
    affected_id := new.thread_id;
    action_name := case
      when tg_op = 'INSERT' then 'mail_reply_draft_created'
      when old.status is distinct from new.status then 'mail_reply_draft_status_changed'
      else 'mail_reply_draft_edited'
    end;
    details := jsonb_build_object('draft_id', new.id, 'status', new.status);
  else
    return new;
  end if;

  insert into ceo.audit_logs (
    user_id, actor_type, actor_id, action, record_type, record_id, outcome, metadata
  )
  values (
    affected_user,
    case when actor = 'system' then 'system' else 'user' end,
    actor,
    action_name,
    'email_thread',
    affected_id,
    'allowed',
    coalesce(details, '{}'::jsonb)
  );
  return new;
end;
$$;
revoke all on function ceo.audit_mail_change() from public, anon, authenticated;

create trigger mail_threads_audit
  after update of status, is_important on ceo.mail_threads
  for each row execute function ceo.audit_mail_change();
create trigger mail_saved_facts_audit
  after insert on ceo.mail_saved_facts
  for each row execute function ceo.audit_mail_change();
create trigger mail_drafts_audit
  after insert or update on ceo.mail_drafts
  for each row execute function ceo.audit_mail_change();

commit;
