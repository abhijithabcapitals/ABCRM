-- =====================================================================
-- Messanger Base - WhatsApp, Telegram and Instagram accounts in the Inbox    007
-- Needs 006_calls.sql, and Admin Base (admin_is). Idempotent.
-- Clients' messages: nobody sees an account by default. Admins connect accounts and choose who sees each, but read its messages only if they are on that list.
-- Tokens stay in Vault and only the service role reads them. The names start messenger_, so the audit trail keeps out the text.
-- =====================================================================
create table if not exists public.messenger_inbox_accounts (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('whatsapp', 'telegram', 'instagram')),
  label text not null check (char_length(label) between 1 and 80),
  external_id text not null check (char_length(external_id) between 1 and 100),   -- phone number id, bot id or Instagram account id
  display_name text check (char_length(display_name) <= 200),
  last_event_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (channel, external_id)
);
create index if not exists messenger_inbox_accounts_creator_idx on public.messenger_inbox_accounts (created_by);

create table if not exists public.messenger_inbox_access (
  account_id uuid not null references public.messenger_inbox_accounts(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_at timestamptz not null default now(),
  primary key (account_id, profile_id)
);
create index if not exists messenger_inbox_access_person_idx on public.messenger_inbox_access (profile_id);

create table if not exists public.messenger_inbox_threads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.messenger_inbox_accounts(id) on delete cascade,
  external_id text not null check (char_length(external_id) <= 100),              -- the person or chat on that platform
  contact_name text check (char_length(contact_name) <= 200),
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  assigned_to uuid references public.profiles(id) on delete set null,
  last_preview text check (char_length(last_preview) <= 200),
  last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index if not exists messenger_inbox_threads_list_idx on public.messenger_inbox_threads (account_id, last_message_at desc);
create index if not exists messenger_inbox_threads_assigned_idx on public.messenger_inbox_threads (assigned_to);

create table if not exists public.messenger_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.messenger_inbox_threads(id) on delete cascade,
  account_id uuid not null references public.messenger_inbox_accounts(id) on delete cascade,
  external_id text check (char_length(external_id) <= 200),                       -- the platform's id, so a repeated webhook cannot add a message twice
  direction text not null check (direction in ('in', 'out')),
  body text not null check (char_length(body) between 1 and 4096),
  sent_by uuid references public.profiles(id) on delete set null,
  status text not null default 'received' check (status in ('received', 'sending', 'sent', 'failed')),
  created_at timestamptz not null default now(),
  unique (account_id, external_id)
);
create index if not exists messenger_inbox_messages_thread_idx on public.messenger_inbox_messages (thread_id, created_at desc);
create index if not exists messenger_inbox_messages_sender_idx on public.messenger_inbox_messages (sent_by);

alter table public.messenger_inbox_accounts enable row level security;
alter table public.messenger_inbox_access enable row level security;
alter table public.messenger_inbox_threads enable row level security;
alter table public.messenger_inbox_messages enable row level security;
revoke all on public.messenger_inbox_accounts, public.messenger_inbox_access, public.messenger_inbox_threads, public.messenger_inbox_messages from public, anon, authenticated;
grant select on public.messenger_inbox_accounts, public.messenger_inbox_threads, public.messenger_inbox_messages to authenticated;
grant all on public.messenger_inbox_accounts, public.messenger_inbox_access, public.messenger_inbox_threads, public.messenger_inbox_messages to service_role;

create or replace function public.messenger_inbox_can(p_account uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.messenger_inbox_access a where a.account_id = p_account and a.profile_id = (select auth.uid()))
$$;
drop policy if exists messenger_inbox_accounts_select on public.messenger_inbox_accounts;
create policy messenger_inbox_accounts_select on public.messenger_inbox_accounts for select to authenticated using (public.messenger_inbox_can(id));
drop policy if exists messenger_inbox_threads_select on public.messenger_inbox_threads;
create policy messenger_inbox_threads_select on public.messenger_inbox_threads for select to authenticated using (public.messenger_inbox_can(account_id));
drop policy if exists messenger_inbox_messages_select on public.messenger_inbox_messages;
create policy messenger_inbox_messages_select on public.messenger_inbox_messages for select to authenticated using (public.messenger_inbox_can(account_id));

-- Vault, service role only. Each account holds its token, app secret and webhook secret under its own names.
create or replace function public.messenger_inbox_secret_set(p_account uuid, p_key text, p_value text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_name text := 'inbox:' || p_account::text || ':' || p_key; v_id uuid;
begin
  if p_account is null or p_key is null or p_value is null or p_value = '' then raise exception 'A secret needs an account, a name and a value'; end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then perform vault.create_secret(p_value, v_name, 'Messenger Inbox account secret');
  else perform vault.update_secret(v_id, p_value); end if;
end $$;
create or replace function public.messenger_inbox_secret_get(p_account uuid, p_key text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'inbox:' || p_account::text || ':' || p_key limit 1
$$;
create or replace function public.messenger_inbox_account_gone() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  delete from vault.secrets where name like 'inbox:' || old.id::text || ':%';
  return null;
end $$;
drop trigger if exists messenger_inbox_accounts_gone on public.messenger_inbox_accounts;
create trigger messenger_inbox_accounts_gone after delete on public.messenger_inbox_accounts
  for each row execute function public.messenger_inbox_account_gone();

-- Admins: connect and remove accounts, and choose who sees them. None of this returns a message or a secret.
create or replace function public.messenger_inbox_require_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not coalesce(public.admin_is(), false) then raise exception 'Only an admin can manage connected accounts' using errcode = '42501'; end if;
end $$;

create or replace function public.messenger_inbox_connect(p_channel text, p_label text, p_external_id text, p_display_name text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_id uuid;
begin
  perform public.messenger_inbox_require_admin();
  if exists (select 1 from public.messenger_inbox_accounts a where a.channel = p_channel and a.external_id = p_external_id) then
    raise exception 'This account is already connected';
  end if;
  insert into public.messenger_inbox_accounts (channel, label, external_id, display_name, created_by)
    values (p_channel, btrim(p_label), p_external_id, p_display_name, v_me) returning id into v_id;
  insert into public.messenger_inbox_access (account_id, profile_id) values (v_id, v_me);
  return v_id;
end $$;

-- Removes the account's stored conversations too. This cannot be undone.
create or replace function public.messenger_inbox_disconnect(p_account uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_inbox_require_admin();
  delete from public.messenger_inbox_accounts where id = p_account;
  if not found then raise exception 'This account is no longer connected'; end if;
end $$;

create or replace function public.messenger_inbox_set_access(p_account uuid, p_people uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  perform public.messenger_inbox_require_admin();
  if not exists (select 1 from public.messenger_inbox_accounts a where a.id = p_account) then raise exception 'This account is no longer connected'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_people, '{}')) x where x is not null;
  if (select count(*) from public.profiles p where p.id = any (v_ids)) <> cardinality(v_ids) then raise exception 'Someone in the list is not a staff member'; end if;
  delete from public.messenger_inbox_access a where a.account_id = p_account and not (a.profile_id = any (v_ids));
  insert into public.messenger_inbox_access (account_id, profile_id) select p_account, x from unnest(v_ids) x on conflict do nothing;
end $$;

create or replace function public.messenger_inbox_admin_list()
returns table (id uuid, channel text, label text, external_id text, display_name text, last_event_at timestamptz, created_at timestamptz, people uuid[])
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_inbox_require_admin();
  return query select a.id, a.channel, a.label, a.external_id, a.display_name, a.last_event_at, a.created_at,
      coalesce((select array_agg(x.profile_id) from public.messenger_inbox_access x where x.account_id = a.id), '{}')
    from public.messenger_inbox_accounts a order by a.channel, a.label;
end $$;

-- Staff with access to the account.
create or replace function public.messenger_inbox_set_status(p_thread uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_status not in ('new', 'read', 'archived') then raise exception 'Unknown status'; end if;
  update public.messenger_inbox_threads t set status = p_status where t.id = p_thread and public.messenger_inbox_can(t.account_id);
  if not found then raise exception 'You do not have access to this conversation' using errcode = '42501'; end if;
end $$;

-- Assigning needs access for both people, so a conversation never lands with someone who cannot read it.
create or replace function public.messenger_inbox_assign(p_thread uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_account uuid;
begin
  select t.account_id into v_account from public.messenger_inbox_threads t where t.id = p_thread;
  if v_account is null or not public.messenger_inbox_can(v_account) then raise exception 'You do not have access to this conversation' using errcode = '42501'; end if;
  if p_person is not null and not exists (select 1 from public.messenger_inbox_access a where a.account_id = v_account and a.profile_id = p_person) then
    raise exception 'That person cannot see this account';
  end if;
  update public.messenger_inbox_threads set assigned_to = p_person where id = p_thread;
end $$;

create or replace function public.messenger_inbox_unread() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::int from public.messenger_inbox_threads t
  join public.messenger_inbox_access a on a.account_id = t.account_id and a.profile_id = (select auth.uid())
  where t.status = 'new'
$$;

-- The first half of sending, as the person: checks access and the platform's reply window, and records the message.
create or replace function public.messenger_inbox_send_begin(p_thread uuid, p_body text)
returns table (message_id uuid, account_id uuid, channel text, account_external_id text, thread_external_id text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_thread public.messenger_inbox_threads; v_account public.messenger_inbox_accounts; v_id uuid;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 4096 then raise exception 'A message must be 1 to 4096 characters'; end if;
  select * into v_thread from public.messenger_inbox_threads where id = p_thread;
  if not found or not public.messenger_inbox_can(v_thread.account_id) then raise exception 'You do not have access to this conversation' using errcode = '42501'; end if;
  select * into v_account from public.messenger_inbox_accounts where id = v_thread.account_id;
  if v_account.channel in ('whatsapp', 'instagram') and (v_thread.last_inbound_at is null or v_thread.last_inbound_at < now() - interval '24 hours') then
    raise exception 'This person last wrote over 24 hours ago, so the platform does not allow a free reply';
  end if;
  insert into public.messenger_inbox_messages (thread_id, account_id, direction, body, sent_by, status)
    values (p_thread, v_thread.account_id, 'out', p_body, v_me, 'sending') returning id into v_id;
  return query select v_id, v_account.id, v_account.channel, v_account.external_id, v_thread.external_id;
end $$;

-- The second half, from the function with the service key.
create or replace function public.messenger_inbox_send_done(p_message uuid, p_external_id text, p_ok boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_inbox_messages;
begin
  update public.messenger_inbox_messages set status = case when p_ok then 'sent' else 'failed' end, external_id = p_external_id
    where id = p_message returning * into v_row;
  if p_ok and found then
    update public.messenger_inbox_threads set last_preview = left(v_row.body, 200), last_message_at = now(), status = case when status = 'new' then 'read' else status end
      where id = v_row.thread_id;
  end if;
end $$;

-- A message arriving, from the function with the service key. A repeat changes nothing.
create or replace function public.messenger_inbox_store(p_account uuid, p_thread_external text, p_contact text, p_message_external text, p_body text, p_at timestamptz default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_thread uuid; v_at timestamptz := coalesce(p_at, now()); v_new uuid;
begin
  update public.messenger_inbox_accounts set last_event_at = now() where id = p_account;
  if not found then return; end if;
  if exists (select 1 from public.messenger_inbox_messages m where m.account_id = p_account and m.external_id = p_message_external) then return; end if;
  insert into public.messenger_inbox_threads (account_id, external_id, contact_name) values (p_account, p_thread_external, left(p_contact, 200))
    on conflict (account_id, external_id) do update set contact_name = coalesce(excluded.contact_name, public.messenger_inbox_threads.contact_name)
    returning id into v_thread;
  insert into public.messenger_inbox_messages (thread_id, account_id, external_id, direction, body, status, created_at)
    values (v_thread, p_account, p_message_external, 'in', left(p_body, 4096), 'received', v_at)
    on conflict (account_id, external_id) do nothing returning id into v_new;
  if v_new is null then return; end if;
  update public.messenger_inbox_threads set status = 'new', last_preview = left(p_body, 200),
      last_message_at = greatest(last_message_at, v_at), last_inbound_at = greatest(coalesce(last_inbound_at, v_at), v_at)
    where id = v_thread;
end $$;

revoke all on function public.messenger_inbox_can(uuid), public.messenger_inbox_secret_set(uuid, text, text), public.messenger_inbox_secret_get(uuid, text), public.messenger_inbox_account_gone(),
  public.messenger_inbox_require_admin(), public.messenger_inbox_connect(text, text, text, text), public.messenger_inbox_disconnect(uuid), public.messenger_inbox_set_access(uuid, uuid[]),
  public.messenger_inbox_admin_list(), public.messenger_inbox_set_status(uuid, text), public.messenger_inbox_assign(uuid, uuid), public.messenger_inbox_unread(),
  public.messenger_inbox_send_begin(uuid, text), public.messenger_inbox_send_done(uuid, text, boolean), public.messenger_inbox_store(uuid, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.messenger_inbox_can(uuid), public.messenger_inbox_connect(text, text, text, text), public.messenger_inbox_disconnect(uuid), public.messenger_inbox_set_access(uuid, uuid[]),
  public.messenger_inbox_admin_list(), public.messenger_inbox_set_status(uuid, text), public.messenger_inbox_assign(uuid, uuid), public.messenger_inbox_unread(), public.messenger_inbox_send_begin(uuid, text) to authenticated;
grant execute on function public.messenger_inbox_secret_set(uuid, text, text), public.messenger_inbox_secret_get(uuid, text), public.messenger_inbox_send_done(uuid, text, boolean),
  public.messenger_inbox_store(uuid, text, text, text, text, timestamptz) to service_role;

-- Live delivery: Realtime applies the row security above.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_inbox_messages') then
    alter publication supabase_realtime add table public.messenger_inbox_messages;
  end if;
end $$;
