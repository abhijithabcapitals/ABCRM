-- =====================================================================
-- Messanger Base - teams, channels and threads    005
-- Needs 004_chat_parity.sql. Idempotent. No existing conversation or message changes.
-- A channel is a conversation of kind 'channel', so its messages, reactions, files, search and row security are those of chat.
-- Being in a channel means a row in messenger_members: every team member for a standard channel, chosen people for a private one.
-- All writes go through functions. Any staff member can create a team; its owners manage it. There is no admin exception.
-- =====================================================================
alter table public.messenger_conversations drop constraint if exists messenger_conversations_kind_check;
alter table public.messenger_conversations add constraint messenger_conversations_kind_check check (kind in ('direct', 'group', 'channel'));
alter table public.messenger_conversations drop constraint if exists messenger_conversations_check;
alter table public.messenger_conversations add constraint messenger_conversations_check check (
  (kind in ('group', 'channel') and direct_key is null and title is not null and char_length(title) between 1 and 80)
  or (kind = 'direct' and direct_key is not null and title is null));

create table if not exists public.messenger_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists messenger_teams_creator_idx on public.messenger_teams (created_by);

create table if not exists public.messenger_team_members (
  team_id uuid not null references public.messenger_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index if not exists messenger_team_members_person_idx on public.messenger_team_members (profile_id);

create table if not exists public.messenger_channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.messenger_teams(id) on delete cascade,
  conversation_id uuid not null unique references public.messenger_conversations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  visibility text not null default 'standard' check (visibility in ('standard', 'private')),
  is_general boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists messenger_channels_name_idx on public.messenger_channels (team_id, lower(name));

alter table public.messenger_teams enable row level security;
alter table public.messenger_team_members enable row level security;
alter table public.messenger_channels enable row level security;
revoke all on public.messenger_teams, public.messenger_team_members, public.messenger_channels from public, anon, authenticated;
grant all on public.messenger_teams, public.messenger_team_members, public.messenger_channels to service_role;

create or replace function public.messenger_require_team_owner(p_team uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.profile_id = (select auth.uid()) and m.role = 'owner') then
    raise exception 'Only a team owner can do that' using errcode = '42501';
  end if;
end $$;

create or replace function public.messenger_clean_name(p_name text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_name text := btrim(p_name);
begin
  if v_name is null or char_length(v_name) not between 1 and 80 then raise exception 'A name must be 1 to 80 characters'; end if;
  return v_name;
end $$;

-- Refuses anyone who is not staff, as messenger_add_members does.
create or replace function public.messenger_clean_people(p_people uuid[]) returns uuid[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ids uuid[];
begin
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(coalesce(p_people, '{}')) x where x is not null;
  if (select count(*) from public.profiles p where p.id = any (v_ids)) <> cardinality(v_ids) then
    raise exception 'Someone in the list is not a staff member';
  end if;
  return v_ids;
end $$;

-- A new team member joins every standard channel.
create or replace function public.messenger_team_member_added() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.messenger_members (conversation_id, profile_id)
    select c.conversation_id, new.profile_id from public.messenger_channels c where c.team_id = new.team_id and c.visibility = 'standard'
    on conflict do nothing;
  return null;
end $$;
drop trigger if exists messenger_team_members_added on public.messenger_team_members;
create trigger messenger_team_members_added after insert on public.messenger_team_members
  for each row execute function public.messenger_team_member_added();

-- Runs after any team member row goes (removal, leaving, or a profile delete). They leave every channel of the team. A private channel left empty goes,
-- as nobody could reach it. A team with nobody left goes with its channels; if no owner remains, the longest-standing member becomes owner.
-- When the whole team is being deleted its row is already gone here, so nothing more happens.
create or replace function public.messenger_team_member_removed() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_next uuid;
begin
  perform 1 from public.messenger_teams t where t.id = old.team_id for update;   -- one change at a time
  if not found then return null; end if;
  delete from public.messenger_members m using public.messenger_channels c
    where c.team_id = old.team_id and m.conversation_id = c.conversation_id and m.profile_id = old.profile_id;
  delete from public.messenger_conversations v using public.messenger_channels c
    where c.team_id = old.team_id and v.id = c.conversation_id and c.visibility = 'private'
      and not exists (select 1 from public.messenger_members m where m.conversation_id = c.conversation_id);
  if not exists (select 1 from public.messenger_team_members m where m.team_id = old.team_id) then
    delete from public.messenger_conversations v using public.messenger_channels c where c.team_id = old.team_id and v.id = c.conversation_id;
    delete from public.messenger_teams where id = old.team_id;
  elsif not exists (select 1 from public.messenger_team_members m where m.team_id = old.team_id and m.role = 'owner') then
    select m.profile_id into v_next from public.messenger_team_members m where m.team_id = old.team_id order by m.joined_at, m.profile_id limit 1;
    update public.messenger_team_members set role = 'owner' where team_id = old.team_id and profile_id = v_next;
  end if;
  return null;
end $$;
drop trigger if exists messenger_team_members_removed on public.messenger_team_members;
create trigger messenger_team_members_removed after delete on public.messenger_team_members
  for each row execute function public.messenger_team_member_removed();

-- Internal. The conversation and the channel appear together, and the title stays the channel's name.
create or replace function public.messenger_make_channel(p_team uuid, p_name text, p_visibility text, p_people uuid[], p_general boolean) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_conversation uuid; v_channel uuid; v_name text := public.messenger_clean_name(p_name);
begin
  if exists (select 1 from public.messenger_channels c where c.team_id = p_team and lower(c.name) = lower(v_name)) then
    raise exception 'This team already has a channel with that name';
  end if;
  insert into public.messenger_conversations (kind, title, created_by) values ('channel', v_name, (select auth.uid())) returning id into v_conversation;
  insert into public.messenger_channels (team_id, conversation_id, name, visibility, is_general) values (p_team, v_conversation, v_name, p_visibility, p_general) returning id into v_channel;
  if p_visibility = 'standard' then
    insert into public.messenger_members (conversation_id, profile_id) select v_conversation, m.profile_id from public.messenger_team_members m where m.team_id = p_team;
  else
    insert into public.messenger_members (conversation_id, profile_id) select v_conversation, x from unnest(p_people) x;
  end if;
  return v_channel;
end $$;

create or replace function public.messenger_create_team(p_name text, p_description text default null, p_members uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_team uuid; v_name text := public.messenger_clean_name(p_name); v_people uuid[] := public.messenger_clean_people(p_members);
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into public.messenger_teams (name, description, created_by) values (v_name, nullif(btrim(p_description), ''), v_me) returning id into v_team;
  insert into public.messenger_team_members (team_id, profile_id, role) values (v_team, v_me, 'owner');
  insert into public.messenger_team_members (team_id, profile_id) select v_team, x from unnest(v_people) x where x <> v_me;
  perform public.messenger_make_channel(v_team, 'General', 'standard', '{}', true);
  return v_team;
end $$;

create or replace function public.messenger_update_team(p_team uuid, p_name text, p_description text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_team_owner(p_team);
  update public.messenger_teams set name = public.messenger_clean_name(p_name), description = nullif(btrim(p_description), ''), updated_at = now() where id = p_team;
end $$;

-- Removes every channel and message of the team. This cannot be undone.
create or replace function public.messenger_delete_team(p_team uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_team_owner(p_team);
  delete from public.messenger_conversations v using public.messenger_channels c where c.team_id = p_team and v.id = c.conversation_id;
  delete from public.messenger_teams where id = p_team;
end $$;

create or replace function public.messenger_add_team_members(p_team uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_team_owner(p_team);
  insert into public.messenger_team_members (team_id, profile_id) select p_team, x from unnest(public.messenger_clean_people(p_members)) x on conflict do nothing;
end $$;

create or replace function public.messenger_remove_team_member(p_team uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_team_owner(p_team);
  if p_member = (select auth.uid()) then raise exception 'Use Leave team to remove yourself'; end if;
  delete from public.messenger_team_members where team_id = p_team and profile_id = p_member;
  if not found then raise exception 'That person is not in this team'; end if;
end $$;

create or replace function public.messenger_leave_team(p_team uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid());
begin
  if not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.profile_id = v_me) then raise exception 'You are not in this team'; end if;
  if not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.profile_id <> v_me) then
    raise exception 'You are the only person in this team. Delete the team instead';
  end if;
  delete from public.messenger_team_members where team_id = p_team and profile_id = v_me;
end $$;

create or replace function public.messenger_set_team_role(p_team uuid, p_member uuid, p_role text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.messenger_require_team_owner(p_team);
  perform 1 from public.messenger_teams t where t.id = p_team for update;   -- one change at a time, so two owners cannot demote each other
  if p_role = 'member' and not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.role = 'owner' and m.profile_id <> p_member) then
    raise exception 'A team needs at least one owner';
  end if;
  update public.messenger_team_members set role = p_role where team_id = p_team and profile_id = p_member;
  if not found then raise exception 'That person is not in this team'; end if;
end $$;

-- A private channel holds its creator and chosen team members.
create or replace function public.messenger_create_channel(p_team uuid, p_name text, p_visibility text default 'standard', p_members uuid[] default '{}') returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_people uuid[];
begin
  perform public.messenger_require_team_owner(p_team);
  if p_visibility not in ('standard', 'private') then raise exception 'Unknown channel type'; end if;
  v_people := public.messenger_clean_people(array_append(coalesce(p_members, '{}'), (select auth.uid())));
  if p_visibility = 'private' and exists (select 1 from unnest(v_people) x where not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.profile_id = x)) then
    raise exception 'Everyone in a private channel must be in the team';
  end if;
  return public.messenger_make_channel(p_team, p_name, p_visibility, v_people, false);
end $$;

-- Owners act only on channels they can see. A private channel they are not in stays private from them.
create or replace function public.messenger_owned_channel(p_channel uuid) returns public.messenger_channels
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels;
begin
  select * into v_row from public.messenger_channels c where c.id = p_channel and public.messenger_is_member(c.conversation_id);
  if not found then raise exception 'Only a team owner can do that' using errcode = '42501'; end if;
  perform public.messenger_require_team_owner(v_row.team_id);
  return v_row;
end $$;

create or replace function public.messenger_rename_channel(p_channel uuid, p_name text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels := public.messenger_owned_channel(p_channel); v_name text := public.messenger_clean_name(p_name);
begin
  if v_row.is_general then raise exception 'General cannot be renamed'; end if;
  if exists (select 1 from public.messenger_channels c where c.team_id = v_row.team_id and c.id <> p_channel and lower(c.name) = lower(v_name)) then
    raise exception 'This team already has a channel with that name';
  end if;
  update public.messenger_channels set name = v_name, updated_at = now() where id = p_channel;
  update public.messenger_conversations set title = v_name where id = v_row.conversation_id;
end $$;

-- Removes the channel's messages too. This cannot be undone.
create or replace function public.messenger_delete_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels := public.messenger_owned_channel(p_channel);
begin
  if v_row.is_general then raise exception 'General cannot be deleted'; end if;
  delete from public.messenger_conversations where id = v_row.conversation_id;
end $$;

create or replace function public.messenger_add_channel_members(p_channel uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels := public.messenger_owned_channel(p_channel); v_people uuid[] := public.messenger_clean_people(p_members);
begin
  if v_row.visibility <> 'private' then raise exception 'Everyone in the team is already in a standard channel'; end if;
  if exists (select 1 from unnest(v_people) x where not exists (select 1 from public.messenger_team_members m where m.team_id = v_row.team_id and m.profile_id = x)) then
    raise exception 'Everyone in a private channel must be in the team';
  end if;
  insert into public.messenger_members (conversation_id, profile_id) select v_row.conversation_id, x from unnest(v_people) x on conflict do nothing;
end $$;

create or replace function public.messenger_remove_channel_member(p_channel uuid, p_member uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels := public.messenger_owned_channel(p_channel);
begin
  if v_row.visibility <> 'private' then raise exception 'Everyone in the team stays in a standard channel'; end if;
  if p_member = (select auth.uid()) then raise exception 'Use Leave channel to remove yourself'; end if;
  delete from public.messenger_members where conversation_id = v_row.conversation_id and profile_id = p_member;
  if not found then raise exception 'That person is not in this channel'; end if;
end $$;

-- The last person out of a private channel takes it with them, as nobody else could reach it.
create or replace function public.messenger_leave_channel(p_channel uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_channels;
begin
  select * into v_row from public.messenger_channels c where c.id = p_channel and public.messenger_is_member(c.conversation_id) for update;
  if not found then raise exception 'You are not in this channel'; end if;
  if v_row.visibility <> 'private' then raise exception 'Everyone in the team stays in a standard channel'; end if;
  delete from public.messenger_members where conversation_id = v_row.conversation_id and profile_id = (select auth.uid());
  if not exists (select 1 from public.messenger_members m where m.conversation_id = v_row.conversation_id) then
    delete from public.messenger_conversations where id = v_row.conversation_id;
  end if;
end $$;

-- One row per channel the caller can see.
create or replace function public.messenger_team_list()
returns table (team_id uuid, team_name text, description text, team_role text, channel_id uuid, channel_name text, visibility text, is_general boolean,
               conversation_id uuid, member_count int, unread int, muted boolean, last_message_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select t.id, t.name, t.description, tm.role, c.id, c.name, c.visibility, c.is_general, c.conversation_id, mc.n, un.n, me.muted, v.last_message_at
  from public.messenger_team_members tm
  join public.messenger_teams t on t.id = tm.team_id
  join public.messenger_channels c on c.team_id = t.id
  join public.messenger_members me on me.conversation_id = c.conversation_id and me.profile_id = tm.profile_id
  join public.messenger_conversations v on v.id = c.conversation_id
  cross join lateral (select count(*)::int as n from public.messenger_members x where x.conversation_id = c.conversation_id) mc
  cross join lateral (
    select count(*)::int as n from public.messenger_messages u
    where u.conversation_id = c.conversation_id and u.created_at > me.last_read_at and u.sender_id is distinct from me.profile_id and u.deleted_at is null) un
  where tm.profile_id = (select auth.uid())
  order by t.name, t.id, c.is_general desc, c.name
$$;

create or replace function public.messenger_team_people(p_team uuid)
returns table (profile_id uuid, full_name text, role text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.messenger_team_members m where m.team_id = p_team and m.profile_id = (select auth.uid())) then
    raise exception 'You are not in this team';
  end if;
  return query select m.profile_id, p.full_name, m.role from public.messenger_team_members m
    left join public.profiles p on p.id = m.profile_id where m.team_id = p_team order by m.role, p.full_name;
end $$;

-- Top-level posts, newest first, each with its reply count. Rows are JSON so they match the live message shape.
create or replace function public.messenger_channel_posts(p_conversation uuid, p_before timestamptz default null, p_limit int default 50) returns setof jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.messenger_is_member(p_conversation) then raise exception 'You are not in this chat'; end if;
  return query
    select to_jsonb(m) || jsonb_build_object('reply_count', (select count(*) from public.messenger_messages r where r.parent_id = m.id and r.deleted_at is null))
    from public.messenger_messages m
    where m.conversation_id = p_conversation and m.parent_id is null and (p_before is null or m.created_at < p_before)
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- These three return where a result lives, so the screen can open a channel as well as a chat. Their return types change, so they are replaced.
drop function if exists public.messenger_files(int);
create function public.messenger_files(p_limit int default 100)
returns table (id uuid, conversation_id uuid, file_name text, content_type text, size_bytes bigint, uploader_name text, created_at timestamptz, conversation_kind text, conversation_title text)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.conversation_id, a.file_name, a.content_type, a.size_bytes, p.full_name, a.created_at, v.kind, v.title
  from public.messenger_attachments a
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = (select auth.uid())
  join public.messenger_conversations v on v.id = a.conversation_id
  left join public.profiles p on p.id = a.uploaded_by
  where a.deleted_at is null
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

drop function if exists public.messenger_search(text, int);
create function public.messenger_search(p_query text, p_limit int default 30)
returns table (message_id uuid, conversation_id uuid, body text, sender_name text, created_at timestamptz, conversation_kind text, conversation_title text, parent_id uuid)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_text text; v_query tsquery;
begin
  select string_agg('''' || replace(replace(w, '\', '\\'), '''', '''''') || ''':*', ' & ') into v_text
    from regexp_split_to_table(btrim(coalesce(p_query, '')), '\s+') w where w <> '';
  if v_text is null then return; end if;
  v_query := to_tsquery('simple', v_text);
  return query
    select m.id, m.conversation_id, m.body, p.full_name, m.created_at, v.kind, v.title, m.parent_id
    from public.messenger_messages m
    join public.messenger_members me on me.conversation_id = m.conversation_id and me.profile_id = (select auth.uid())
    join public.messenger_conversations v on v.id = m.conversation_id
    left join public.profiles p on p.id = m.sender_id
    where m.deleted_at is null and to_tsvector('simple'::regconfig, m.body) @@ v_query
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

drop function if exists public.messenger_activity_list(int);
create function public.messenger_activity_list(p_limit int default 50)
returns table (id uuid, kind text, actor_name text, conversation_id uuid, message_id uuid, preview text, detail text, read_at timestamptz, created_at timestamptz,
               conversation_kind text, conversation_title text, parent_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.kind, p.full_name, a.conversation_id, a.message_id, left(m.body, 200), a.detail, a.read_at, a.created_at, v.kind, v.title, m.parent_id
  from public.messenger_activity a
  join public.messenger_messages m on m.id = a.message_id
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = a.profile_id
  join public.messenger_conversations v on v.id = a.conversation_id
  left join public.profiles p on p.id = a.actor_id
  where a.profile_id = (select auth.uid())
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- Channels have their own list, so the chat list holds only direct chats and groups.
create or replace function public.messenger_chat_list()
returns table (id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text,
               last_link_label text, last_sender_id uuid, last_sender_name text, last_message_at timestamptz, unread int, muted boolean, pinned boolean)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.kind, c.title, mc.n, o.full_name, o.profile_id, lm.body, lm.link_label, lm.sender_id, lm.sender_name,
         c.last_message_at, un.n, me.muted, me.pinned
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
    where u.conversation_id = c.id and u.created_at > me.last_read_at and u.sender_id is distinct from me.profile_id and u.deleted_at is null) un
  where me.profile_id = (select auth.uid()) and c.kind <> 'channel'
  order by c.last_message_at desc, c.id
$$;

-- Channel messages stay out of the 365-day limit until the user decides whether it should apply to them.
create or replace function public.messenger_prune_messages() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.messenger_messages m using public.messenger_conversations c
  where c.id = m.conversation_id and c.kind <> 'channel' and m.created_at < now() - interval '365 days'
$$;

revoke all on function public.messenger_require_team_owner(uuid), public.messenger_clean_name(text), public.messenger_clean_people(uuid[]),
  public.messenger_team_member_added(), public.messenger_team_member_removed(), public.messenger_make_channel(uuid, text, text, uuid[], boolean),
  public.messenger_create_team(text, text, uuid[]), public.messenger_update_team(uuid, text, text), public.messenger_delete_team(uuid),
  public.messenger_add_team_members(uuid, uuid[]), public.messenger_remove_team_member(uuid, uuid), public.messenger_leave_team(uuid),
  public.messenger_set_team_role(uuid, uuid, text), public.messenger_create_channel(uuid, text, text, uuid[]), public.messenger_owned_channel(uuid),
  public.messenger_rename_channel(uuid, text), public.messenger_delete_channel(uuid), public.messenger_add_channel_members(uuid, uuid[]),
  public.messenger_remove_channel_member(uuid, uuid), public.messenger_leave_channel(uuid), public.messenger_team_list(), public.messenger_team_people(uuid),
  public.messenger_channel_posts(uuid, timestamptz, int), public.messenger_files(int), public.messenger_search(text, int), public.messenger_activity_list(int),
  public.messenger_chat_list(), public.messenger_prune_messages() from public, anon, authenticated;
grant execute on function public.messenger_create_team(text, text, uuid[]), public.messenger_update_team(uuid, text, text), public.messenger_delete_team(uuid),
  public.messenger_add_team_members(uuid, uuid[]), public.messenger_remove_team_member(uuid, uuid), public.messenger_leave_team(uuid),
  public.messenger_set_team_role(uuid, uuid, text), public.messenger_create_channel(uuid, text, text, uuid[]),
  public.messenger_rename_channel(uuid, text), public.messenger_delete_channel(uuid), public.messenger_add_channel_members(uuid, uuid[]),
  public.messenger_remove_channel_member(uuid, uuid), public.messenger_leave_channel(uuid), public.messenger_team_list(), public.messenger_team_people(uuid),
  public.messenger_channel_posts(uuid, timestamptz, int), public.messenger_files(int), public.messenger_search(text, int), public.messenger_activity_list(int),
  public.messenger_chat_list() to authenticated;
grant execute on function public.messenger_prune_messages() to service_role;
