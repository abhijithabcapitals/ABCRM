-- =====================================================================
-- Messanger Base - team chat: conversations, members, messages and the functions that guard them    003
-- Needs Admin Base (profiles with full_name), the Supabase roles and the supabase_realtime publication. Idempotent.
-- Row security on all three tables. A person reads only chats they belong to; there is no admin exception.
-- The browser can read, and can insert its own messages. Everything else goes through the functions below.
-- =====================================================================
create table if not exists public.messenger_conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('direct', 'group')),
  title text,                                                     -- groups only
  direct_key text unique,                                         -- the two profile IDs sorted; directs only
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  check ((kind = 'group' and direct_key is null and char_length(title) between 1 and 80)
      or (kind = 'direct' and direct_key is not null and title is null))
);

create table if not exists public.messenger_members (
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  last_read_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  primary key (conversation_id, profile_id)
);
create index if not exists messenger_members_profile_idx on public.messenger_members (profile_id);

create table if not exists public.messenger_messages (
  id uuid primary key default gen_random_uuid(),                  -- the browser may supply it, so a retry cannot send twice
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  body text not null check (char_length(body) between 1 and 4000),
  link_type text check (link_type in ('client', 'lead', 'task', 'web')),
  link_ref text,
  link_label text,
  created_at timestamptz not null default now(),
  check (link_type is not null or (link_ref is null and link_label is null)),
  check (link_type is distinct from 'web' or left(link_ref, 8) = 'https://')
);
create index if not exists messenger_messages_conv_idx on public.messenger_messages (conversation_id, created_at desc);

alter table public.messenger_conversations enable row level security;
alter table public.messenger_members enable row level security;
alter table public.messenger_messages enable row level security;
revoke all on public.messenger_conversations, public.messenger_members, public.messenger_messages from public, anon, authenticated;
grant select on public.messenger_conversations, public.messenger_members to authenticated;
grant select, insert on public.messenger_messages to authenticated;

-- Used by the policies. A policy on messenger_members that read messenger_members would recurse, so this runs as owner.
create or replace function public.messenger_is_member(p_conversation uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.messenger_members m
    where m.conversation_id = p_conversation and m.profile_id = (select auth.uid()))
$$;

drop policy if exists messenger_conversations_select on public.messenger_conversations;
create policy messenger_conversations_select on public.messenger_conversations for select to authenticated
  using (public.messenger_is_member(id));
drop policy if exists messenger_members_select on public.messenger_members;
create policy messenger_members_select on public.messenger_members for select to authenticated
  using (public.messenger_is_member(conversation_id));
drop policy if exists messenger_messages_select on public.messenger_messages;
create policy messenger_messages_select on public.messenger_messages for select to authenticated
  using (public.messenger_is_member(conversation_id));
drop policy if exists messenger_messages_insert on public.messenger_messages;
create policy messenger_messages_insert on public.messenger_messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and public.messenger_is_member(conversation_id));

-- The server clock decides when a message was sent. The conversation remembers its latest message.
create or replace function public.messenger_stamp_message() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.created_at := now();
  return new;
end $$;

create or replace function public.messenger_touch_conversation() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messenger_conversations set last_message_at = new.created_at where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists messenger_messages_stamp on public.messenger_messages;
create trigger messenger_messages_stamp before insert on public.messenger_messages
  for each row execute function public.messenger_stamp_message();
drop trigger if exists messenger_messages_touch on public.messenger_messages;
create trigger messenger_messages_touch after insert on public.messenger_messages
  for each row execute function public.messenger_touch_conversation();

-- Internal check used by the owner-only functions. Not callable from the browser.
create or replace function public.messenger_require_owner(p_conversation uuid, p_user uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_user is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not exists (select 1 from public.messenger_members m
      join public.messenger_conversations c on c.id = m.conversation_id
      where m.conversation_id = p_conversation and m.profile_id = p_user and m.role = 'owner' and c.kind = 'group') then
    raise exception 'Only the group owner can do that' using errcode = '42501';
  end if;
end $$;

-- One-to-one chat: finds or creates it. If both people start it at once, the unique key lets one insert win and the other finds it.
create or replace function public.messenger_start_direct(p_other uuid) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_key text; v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_other is null or p_other = v_me then raise exception 'You cannot start a chat with yourself'; end if;
  if not exists (select 1 from public.profiles p where p.id = p_other) then raise exception 'That person is not a staff member'; end if;
  v_key := least(v_me, p_other)::text || ':' || greatest(v_me, p_other)::text;
  insert into public.messenger_conversations (kind, direct_key, created_by) values ('direct', v_key, v_me)
    on conflict (direct_key) do nothing returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.messenger_conversations c where c.direct_key = v_key;
  else
    insert into public.messenger_members (conversation_id, profile_id) values (v_id, v_me), (v_id, p_other);
  end if;
  return v_id;
end $$;

create or replace function public.messenger_create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_title text := btrim(p_title); v_ids uuid[]; v_id uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_title is null or char_length(v_title) not between 1 and 80 then raise exception 'Group name must be 1 to 80 characters'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_members) x where x is not null and x <> v_me;
  if cardinality(v_ids) = 0 then raise exception 'Pick at least one other person'; end if;
  if (select count(*) from public.profiles p where p.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Someone in the list is not a staff member';
  end if;
  insert into public.messenger_conversations (kind, title, created_by) values ('group', v_title, v_me) returning id into v_id;
  insert into public.messenger_members (conversation_id, profile_id, role) values (v_id, v_me, 'owner');
  insert into public.messenger_members (conversation_id, profile_id) select v_id, x from unnest(v_ids) x;
  return v_id;
end $$;

create or replace function public.messenger_add_members(p_conversation uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  perform public.messenger_require_owner(p_conversation, (select auth.uid()));
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_members) x where x is not null;
  if (select count(*) from public.profiles p where p.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Someone in the list is not a staff member';
  end if;
  insert into public.messenger_members (conversation_id, profile_id) select p_conversation, x from unnest(v_ids) x
    on conflict do nothing;
end $$;

create or replace function public.messenger_remove_member(p_conversation uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid());
begin
  perform public.messenger_require_owner(p_conversation, v_me);
  if p_member = v_me then raise exception 'Use Leave to remove yourself'; end if;
  delete from public.messenger_members where conversation_id = p_conversation and profile_id = p_member;
  if not found then raise exception 'That person is not in this chat'; end if;
end $$;

create or replace function public.messenger_rename_group(p_conversation uuid, p_title text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_title text := btrim(p_title);
begin
  perform public.messenger_require_owner(p_conversation, (select auth.uid()));
  if v_title is null or char_length(v_title) not between 1 and 80 then raise exception 'Group name must be 1 to 80 characters'; end if;
  update public.messenger_conversations set title = v_title where id = p_conversation;
end $$;

-- Leaves a group. The longest-standing member becomes owner if no owner remains; a group with nobody left is deleted with its messages.
create or replace function public.messenger_leave(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_kind text; v_next uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  select c.kind into v_kind from public.messenger_conversations c where c.id = p_conversation for update;   -- one leaver at a time
  if v_kind is null or not exists (select 1 from public.messenger_members m where m.conversation_id = p_conversation and m.profile_id = v_me) then
    raise exception 'You are not in this chat';
  end if;
  if v_kind <> 'group' then raise exception 'You cannot leave a one-to-one chat'; end if;
  delete from public.messenger_members where conversation_id = p_conversation and profile_id = v_me;
  if not exists (select 1 from public.messenger_members m where m.conversation_id = p_conversation) then
    delete from public.messenger_conversations where id = p_conversation;
  elsif not exists (select 1 from public.messenger_members m where m.conversation_id = p_conversation and m.role = 'owner') then
    select m.profile_id into v_next from public.messenger_members m where m.conversation_id = p_conversation order by m.joined_at, m.profile_id limit 1;
    update public.messenger_members set role = 'owner' where conversation_id = p_conversation and profile_id = v_next;
  end if;
end $$;

create or replace function public.messenger_mark_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messenger_members set last_read_at = greatest(last_read_at, now())
    where conversation_id = p_conversation and profile_id = (select auth.uid());
  if not found then raise exception 'You are not in this chat'; end if;
end $$;

-- The caller's chats with preview, unread count and the other person's name (directs), in one query. Latest first.
create or replace function public.messenger_chat_list()
returns table (id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text,
               last_link_label text, last_sender_id uuid, last_sender_name text, last_message_at timestamptz, unread int)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, c.title, mc.n, o.full_name, o.profile_id, lm.body, lm.link_label, lm.sender_id, lm.sender_name,
         c.last_message_at, un.n
  from public.messenger_members me
  join public.messenger_conversations c on c.id = me.conversation_id
  cross join lateral (select count(*)::int as n from public.messenger_members x where x.conversation_id = c.id) mc
  left join lateral (
    select om.profile_id, p.full_name from public.messenger_members om
    left join public.profiles p on p.id = om.profile_id
    where c.kind = 'direct' and om.conversation_id = c.id and om.profile_id <> me.profile_id limit 1) o on true
  left join lateral (
    select m.body, m.link_label, m.sender_id, sp.full_name as sender_name from public.messenger_messages m
    left join public.profiles sp on sp.id = m.sender_id
    where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  cross join lateral (
    select count(*)::int as n from public.messenger_messages u
    where u.conversation_id = c.id and u.created_at > me.last_read_at and u.sender_id is distinct from me.profile_id) un
  where me.profile_id = (select auth.uid())
  order by c.last_message_at desc, c.id
$$;

-- The earliest last_read_at among the other members, for the read ticks.
create or replace function public.messenger_read_state(p_conversation uuid) returns timestamptz
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid());
begin
  if not public.messenger_is_member(p_conversation) then raise exception 'You are not in this chat'; end if;
  return (select min(m.last_read_at) from public.messenger_members m where m.conversation_id = p_conversation and m.profile_id <> v_me);
end $$;

-- Removes messages older than 365 days. Service role only; the daily schedule is in schedule_chat_prune.sql.
create or replace function public.messenger_prune_messages() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.messenger_messages where created_at < now() - interval '365 days'
$$;

-- Supabase grants ALL on new functions to anon and authenticated, so take it away, then give back what is meant.
revoke all on function public.messenger_is_member(uuid), public.messenger_start_direct(uuid), public.messenger_create_group(text, uuid[]),
  public.messenger_add_members(uuid, uuid[]), public.messenger_remove_member(uuid, uuid), public.messenger_rename_group(uuid, text),
  public.messenger_leave(uuid), public.messenger_mark_read(uuid), public.messenger_chat_list(), public.messenger_read_state(uuid),
  public.messenger_prune_messages(), public.messenger_require_owner(uuid, uuid), public.messenger_stamp_message(),
  public.messenger_touch_conversation() from public, anon, authenticated;
grant execute on function public.messenger_is_member(uuid), public.messenger_start_direct(uuid), public.messenger_create_group(text, uuid[]),
  public.messenger_add_members(uuid, uuid[]), public.messenger_remove_member(uuid, uuid), public.messenger_rename_group(uuid, text),
  public.messenger_leave(uuid), public.messenger_mark_read(uuid), public.messenger_chat_list(), public.messenger_read_state(uuid) to authenticated;
grant execute on function public.messenger_prune_messages() to service_role;
grant all on public.messenger_conversations, public.messenger_members, public.messenger_messages to service_role;

-- Live delivery: Realtime applies row security, so people receive only messages from their own chats.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_messages') then
    alter publication supabase_realtime add table public.messenger_messages;
  end if;
end $$;
