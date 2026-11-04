-- CEO Inbox display preferences: mailboxes the user switched off with the Inbox
-- settings (gear) button. A hidden mailbox keeps syncing into Email Base; its
-- conversations are only left out of this user's Inbox list, search and badge.
begin;

create table if not exists ceo.inbox_preferences (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  hidden_mailbox_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table ceo.inbox_preferences enable row level security;
revoke all on ceo.inbox_preferences from anon, public;
grant select, insert, update on ceo.inbox_preferences to authenticated;
grant all on ceo.inbox_preferences to service_role;

drop policy if exists inbox_preferences_own on ceo.inbox_preferences;
create policy inbox_preferences_own on ceo.inbox_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

notify pgrst, 'reload schema';

commit;
