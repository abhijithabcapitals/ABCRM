-- Chat history for the CEO Agent chat: one thread per conversation, one row
-- per message. Private to each user through row-level security.

create table ceo.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index chat_threads_user_updated_idx on ceo.chat_threads(user_id, updated_at desc);

create table ceo.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  thread_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 40000),
  saved jsonb not null default '[]'::jsonb,
  capture_id uuid,
  created_at timestamptz not null default now(),
  foreign key (user_id, thread_id) references ceo.chat_threads(user_id, id) on delete cascade,
  foreign key (user_id, capture_id) references ceo.captures(user_id, id) on delete set null (capture_id)
);
create index chat_messages_thread_idx on ceo.chat_messages(thread_id, created_at);

create trigger chat_threads_set_updated_at before update on ceo.chat_threads
  for each row execute function ceo.set_updated_at();

alter table ceo.chat_threads enable row level security;
alter table ceo.chat_messages enable row level security;

create policy chat_threads_select_own on ceo.chat_threads for select to authenticated using (user_id = (select auth.uid()));
create policy chat_threads_insert_own on ceo.chat_threads for insert to authenticated with check (user_id = (select auth.uid()));
create policy chat_threads_update_own on ceo.chat_threads for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy chat_threads_delete_own on ceo.chat_threads for delete to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_select_own on ceo.chat_messages for select to authenticated using (user_id = (select auth.uid()));
create policy chat_messages_insert_own on ceo.chat_messages for insert to authenticated with check (user_id = (select auth.uid()));
create policy chat_messages_delete_own on ceo.chat_messages for delete to authenticated using (user_id = (select auth.uid()));

revoke all on ceo.chat_threads, ceo.chat_messages from anon, public;
grant select, insert, delete on ceo.chat_threads, ceo.chat_messages to authenticated;
grant update (title, updated_at) on ceo.chat_threads to authenticated;
grant all on ceo.chat_threads, ceo.chat_messages to service_role;
