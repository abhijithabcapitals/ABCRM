begin;

alter table email_base.threads
  add column if not exists is_important boolean not null default false;

alter table email_base.threads
  add column if not exists assistant_search_vector tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(subject, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(key_points::text, '')
    )
  ) stored;
create index if not exists email_base_threads_assistant_search_idx
  on email_base.threads using gin(assistant_search_vector);

grant update (status, is_important) on email_base.threads to authenticated;

create table ceo.email_saved_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references email_base.threads(id) on delete cascade,
  subject text not null,
  fact text not null,
  fact_hash bytea generated always as (
    extensions.digest(fact, 'sha256')
  ) stored,
  search_vector tsvector generated always as (
    to_tsvector('english', coalesce(subject, '') || ' ' || coalesce(fact, ''))
  ) stored,
  created_at timestamptz not null default now(),
  unique (user_id, thread_id, fact_hash),
  check (char_length(fact) between 1 and 2000),
  check (char_length(subject) between 1 and 1000)
);
create index email_saved_facts_search_idx on ceo.email_saved_facts using gin(search_vector);
create index email_saved_facts_user_created_idx on ceo.email_saved_facts(user_id, created_at desc);

create table ceo.email_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id uuid not null references email_base.threads(id) on delete cascade,
  to_address text not null,
  subject text not null,
  body text not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(to_address) between 3 and 320),
  check (char_length(subject) between 1 and 1000),
  check (char_length(body) between 1 and 10000)
);
create index email_drafts_user_status_idx on ceo.email_drafts(user_id, status, created_at desc);

alter table ceo.email_saved_facts enable row level security;
alter table ceo.email_drafts enable row level security;
revoke all on ceo.email_saved_facts, ceo.email_drafts from anon, public;
grant select, insert on ceo.email_saved_facts to authenticated;
grant select, insert on ceo.email_drafts to authenticated;
grant update (body, status) on ceo.email_drafts to authenticated;
grant all on ceo.email_saved_facts, ceo.email_drafts to service_role;

create policy email_saved_facts_select_own on ceo.email_saved_facts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_saved_facts.thread_id and m.owner_user_id = (select auth.uid())
    )
  );
create policy email_saved_facts_insert_own on ceo.email_saved_facts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_saved_facts.thread_id and m.owner_user_id = (select auth.uid())
    )
  );

create policy email_drafts_select_own on ceo.email_drafts
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_drafts.thread_id and m.owner_user_id = (select auth.uid())
    )
  );
create policy email_drafts_insert_own on ceo.email_drafts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_drafts.thread_id and m.owner_user_id = (select auth.uid())
    )
  );
create policy email_drafts_update_own on ceo.email_drafts
  for update to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_drafts.thread_id and m.owner_user_id = (select auth.uid())
    )
  )
  with check (
    user_id = (select auth.uid())
    and status in ('draft', 'approved', 'cancelled')
    and exists (
      select 1
      from email_base.threads t
      join email_base.mailboxes m on m.id = t.mailbox_id
      where t.id = email_drafts.thread_id and m.owner_user_id = (select auth.uid())
    )
  );

create trigger email_drafts_set_updated_at
  before update on ceo.email_drafts
  for each row execute function ceo.set_updated_at();

create function ceo.audit_email_base_assistant_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
  action_name text;
  details jsonb;
begin
  actor := nullif(current_setting('request.jwt.claim.sub', true), '');
  if actor is null then actor := 'system'; end if;

  if tg_table_name = 'email_saved_facts' then
    action_name := 'mail_fact_saved';
    details := jsonb_build_object('subject', new.subject, 'fact_id', new.id);
  elsif tg_table_name = 'email_drafts' then
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
    new.user_id,
    case when actor = 'system' then 'system' else 'user' end,
    actor,
    action_name,
    'email_thread',
    new.thread_id,
    'allowed',
    coalesce(details, '{}'::jsonb)
  );
  return new;
end;
$$;
revoke all on function ceo.audit_email_base_assistant_change() from public, anon, authenticated;

create trigger email_saved_facts_audit
  after insert on ceo.email_saved_facts
  for each row execute function ceo.audit_email_base_assistant_change();
create trigger email_drafts_audit
  after insert or update on ceo.email_drafts
  for each row execute function ceo.audit_email_base_assistant_change();

commit;
