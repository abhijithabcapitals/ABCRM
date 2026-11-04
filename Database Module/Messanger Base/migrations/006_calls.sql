-- =====================================================================
-- Messanger Base - audio and video calls in chats    006
-- Needs 005_teams_channels.sql. Idempotent. The media itself never touches this database; it goes through LiveKit.
-- A person sees only calls they were part of. There is no admin exception. All writes go through functions.
-- =====================================================================
create table if not exists public.messenger_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  started_by uuid references public.profiles(id) on delete set null,
  room_name text not null unique default gen_random_uuid()::text,       -- random, so it cannot be guessed
  media text not null default 'audio' check (media in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index if not exists messenger_calls_conv_idx on public.messenger_calls (conversation_id, started_at desc);
create index if not exists messenger_calls_starter_idx on public.messenger_calls (started_by);
-- One open call a chat: two people calling at once end up in the same call.
create unique index if not exists messenger_calls_open_idx on public.messenger_calls (conversation_id) where status in ('ringing', 'active');

create table if not exists public.messenger_call_participants (
  call_id uuid not null references public.messenger_calls(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  state text not null default 'invited' check (state in ('invited', 'joined', 'declined', 'left', 'missed')),
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, profile_id)
);
create index if not exists messenger_call_participants_person_idx on public.messenger_call_participants (profile_id, call_id);

alter table public.messenger_calls enable row level security;
alter table public.messenger_call_participants enable row level security;
revoke all on public.messenger_calls, public.messenger_call_participants from public, anon, authenticated;
grant select on public.messenger_calls to authenticated;    -- needed for live updates; the policy limits it
grant all on public.messenger_calls, public.messenger_call_participants to service_role;

create or replace function public.messenger_in_call(p_call uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.messenger_call_participants p where p.call_id = p_call and p.profile_id = (select auth.uid()))
$$;
drop policy if exists messenger_calls_select on public.messenger_calls;
create policy messenger_calls_select on public.messenger_calls for select to authenticated using (public.messenger_in_call(id));

-- A missed call has no message behind it.
alter table public.messenger_activity drop constraint if exists messenger_activity_kind_check;
alter table public.messenger_activity add constraint messenger_activity_kind_check check (kind in ('mention', 'reply', 'reaction', 'missed_call'));
alter table public.messenger_activity alter column message_id drop not null;

-- Internal. Closes a call once: anyone still being rung is told they missed it.
create or replace function public.messenger_finish_call(p_call uuid, p_status text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_calls;
begin
  update public.messenger_calls set status = p_status, ended_at = now()
    where id = p_call and status in ('ringing', 'active') returning * into v_row;
  if not found then return; end if;
  insert into public.messenger_activity (profile_id, kind, actor_id, conversation_id)
    select p.profile_id, 'missed_call', v_row.started_by, v_row.conversation_id
    from public.messenger_call_participants p where p.call_id = p_call and p.state = 'invited';
  update public.messenger_call_participants set state = 'missed' where call_id = p_call and state = 'invited';
  update public.messenger_call_participants set state = 'left', left_at = now() where call_id = p_call and state = 'joined';
end $$;

-- Internal. A call nobody answered in time counts as missed; an open call with nobody in it is over.
create or replace function public.messenger_close_stale_calls(p_conversation uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  for v_id in select c.id from public.messenger_calls c
      where c.status = 'ringing' and c.started_at < now() - interval '60 seconds' and (p_conversation is null or c.conversation_id = p_conversation) loop
    perform public.messenger_finish_call(v_id, 'missed');
  end loop;
  for v_id in select c.id from public.messenger_calls c
      where c.status = 'active' and (p_conversation is null or c.conversation_id = p_conversation)
        and not exists (select 1 from public.messenger_call_participants p where p.call_id = c.id and p.state = 'joined') loop
    perform public.messenger_finish_call(v_id, 'ended');
  end loop;
end $$;

-- Internal. In a one-to-one call, one person leaving ends it. In a group, it ends when nobody is left.
create or replace function public.messenger_person_left(p_call uuid, p_person uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.messenger_calls; v_kind text;
begin
  select * into v_row from public.messenger_calls where id = p_call for update;
  if not found or v_row.status not in ('ringing', 'active') then return; end if;
  update public.messenger_call_participants set state = 'left', left_at = now() where call_id = p_call and profile_id = p_person and state = 'joined';
  select c.kind into v_kind from public.messenger_conversations c where c.id = v_row.conversation_id;
  if v_kind = 'direct' or not exists (select 1 from public.messenger_call_participants p where p.call_id = p_call and p.state = 'joined') then
    perform public.messenger_finish_call(p_call, case when v_row.answered_at is null then 'missed' else 'ended' end);
  end if;
end $$;

create or replace function public.messenger_start_call(p_conversation uuid, p_media text default 'audio')
returns table (call_id uuid, joined_existing boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_kind text; v_call uuid;
begin
  if v_me is null or not public.messenger_is_member(p_conversation) then raise exception 'You are not in this chat' using errcode = '42501'; end if;
  if p_media not in ('audio', 'video') then raise exception 'Unknown call type'; end if;
  select c.kind into v_kind from public.messenger_conversations c where c.id = p_conversation for update;   -- one start at a time
  if v_kind not in ('direct', 'group') then raise exception 'Calls start from a chat'; end if;
  if (select count(*) from public.messenger_members m where m.conversation_id = p_conversation) < 2 then raise exception 'There is nobody else in this chat to call'; end if;
  perform public.messenger_close_stale_calls(p_conversation);
  select c.id into v_call from public.messenger_calls c where c.conversation_id = p_conversation and c.status in ('ringing', 'active');
  if found then
    update public.messenger_call_participants set state = 'joined', joined_at = coalesce(joined_at, now()), left_at = null where messenger_call_participants.call_id = v_call and profile_id = v_me;
    if not found then insert into public.messenger_call_participants (call_id, profile_id, state, joined_at) values (v_call, v_me, 'joined', now()); end if;
    update public.messenger_calls set status = 'active', answered_at = coalesce(answered_at, now()) where id = v_call;
    return query select v_call, true;
    return;
  end if;
  insert into public.messenger_calls (conversation_id, started_by, media) values (p_conversation, v_me, p_media) returning id into v_call;
  insert into public.messenger_call_participants (call_id, profile_id, state, joined_at)
    select v_call, m.profile_id, case when m.profile_id = v_me then 'joined' else 'invited' end, case when m.profile_id = v_me then now() end
    from public.messenger_members m where m.conversation_id = p_conversation;
  return query select v_call, false;
end $$;

create or replace function public.messenger_answer_call(p_call uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select c.status into v_status from public.messenger_calls c where c.id = p_call for update;
  if not found or not public.messenger_in_call(p_call) then raise exception 'You are not part of this call' using errcode = '42501'; end if;
  if v_status not in ('ringing', 'active') then raise exception 'This call has ended'; end if;
  update public.messenger_call_participants set state = 'joined', joined_at = coalesce(joined_at, now()), left_at = null where call_id = p_call and profile_id = (select auth.uid());
  update public.messenger_calls set status = 'active', answered_at = coalesce(answered_at, now()) where id = p_call;
end $$;

-- Declining alone does not end a group call while someone else may still answer.
create or replace function public.messenger_decline_call(p_call uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_status text;
begin
  select c.status into v_status from public.messenger_calls c where c.id = p_call for update;
  if not found or not public.messenger_in_call(p_call) then raise exception 'You are not part of this call' using errcode = '42501'; end if;
  update public.messenger_call_participants set state = 'declined' where call_id = p_call and profile_id = (select auth.uid()) and state = 'invited';
  if v_status = 'ringing' and not exists (select 1 from public.messenger_call_participants p where p.call_id = p_call and p.state = 'invited') then
    perform public.messenger_finish_call(p_call, 'declined');
  end if;
end $$;

create or replace function public.messenger_leave_call(p_call uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.messenger_in_call(p_call) then raise exception 'You are not part of this call' using errcode = '42501'; end if;
  perform public.messenger_person_left(p_call, (select auth.uid()));
end $$;

-- The caller's window asks this when ringing has gone on too long. Too early changes nothing.
create or replace function public.messenger_ring_timeout(p_call uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.messenger_in_call(p_call) then raise exception 'You are not part of this call' using errcode = '42501'; end if;
  perform 1 from public.messenger_calls c where c.id = p_call and c.status = 'ringing' and c.started_at < now() - interval '40 seconds' for update;
  if found then perform public.messenger_finish_call(p_call, 'missed'); end if;
end $$;

-- Calls ringing for the caller right now. Do not disturb stays quiet; the missed call still reaches Activity.
create or replace function public.messenger_calls_ringing()
returns table (id uuid, conversation_id uuid, media text, started_by uuid, caller_name text, conversation_kind text, conversation_title text, started_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.conversation_id, c.media, c.started_by, sp.full_name, v.kind, v.title, c.started_at
  from public.messenger_call_participants me
  join public.messenger_calls c on c.id = me.call_id
  join public.messenger_conversations v on v.id = c.conversation_id
  left join public.profiles sp on sp.id = c.started_by
  where me.profile_id = (select auth.uid()) and me.state = 'invited' and c.status in ('ringing', 'active') and c.started_at > now() - interval '60 seconds'
    and not exists (select 1 from public.messenger_presence pr where pr.profile_id = me.profile_id and pr.status = 'dnd' and pr.last_seen_at > now() - interval '5 minutes')
  order by c.started_at desc
$$;

create or replace function public.messenger_call_history(p_limit int default 50)
returns table (id uuid, conversation_id uuid, conversation_kind text, conversation_title text, other_name text, media text, status text,
               started_by_me boolean, caller_name text, my_state text, started_at timestamptz, answered_at timestamptz, ended_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, c.conversation_id, v.kind, v.title, o.full_name, c.media, c.status, c.started_by = me.profile_id, sp.full_name, me.state, c.started_at, c.answered_at, c.ended_at
  from public.messenger_call_participants me
  join public.messenger_calls c on c.id = me.call_id
  join public.messenger_conversations v on v.id = c.conversation_id
  left join public.profiles sp on sp.id = c.started_by
  left join lateral (
    select p.full_name from public.messenger_members om left join public.profiles p on p.id = om.profile_id
    where v.kind = 'direct' and om.conversation_id = v.id and om.profile_id <> me.profile_id limit 1) o on true
  where me.profile_id = (select auth.uid())
  order by c.started_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- What the function needs to issue a join token. Only for someone in the call, and only while it is open.
create or replace function public.messenger_call_for_token(p_call uuid)
returns table (room_name text, media text, full_name text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select c.room_name, c.media, p.full_name
    from public.messenger_calls c
    join public.messenger_call_participants me on me.call_id = c.id and me.profile_id = (select auth.uid())
    left join public.profiles p on p.id = me.profile_id
    where c.id = p_call and c.status in ('ringing', 'active');
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- LiveKit's signed webhook, through the function with the service key. Tolerates repeats, and ignores rooms and people it does not know.
create or replace function public.messenger_call_event(p_room text, p_event text, p_person text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_call uuid; v_person uuid;
begin
  select c.id into v_call from public.messenger_calls c where c.room_name = p_room;
  if not found then return; end if;
  if p_event = 'room_finished' then
    perform public.messenger_finish_call(v_call, 'ended');
  elsif p_event = 'participant_left' then
    begin v_person := p_person::uuid; exception when others then return; end;
    perform public.messenger_person_left(v_call, v_person);
  end if;
end $$;

-- A missed call has no message, so the feed keeps it with a left join. The return type is unchanged.
create or replace function public.messenger_activity_list(p_limit int default 50)
returns table (id uuid, kind text, actor_name text, conversation_id uuid, message_id uuid, preview text, detail text, read_at timestamptz, created_at timestamptz,
               conversation_kind text, conversation_title text, parent_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.kind, p.full_name, a.conversation_id, a.message_id, left(m.body, 200), a.detail, a.read_at, a.created_at, v.kind, v.title, m.parent_id
  from public.messenger_activity a
  left join public.messenger_messages m on m.id = a.message_id
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = a.profile_id
  join public.messenger_conversations v on v.id = a.conversation_id
  left join public.profiles p on p.id = a.actor_id
  where a.profile_id = (select auth.uid())
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

revoke all on function public.messenger_in_call(uuid), public.messenger_finish_call(uuid, text), public.messenger_close_stale_calls(uuid), public.messenger_person_left(uuid, uuid),
  public.messenger_start_call(uuid, text), public.messenger_answer_call(uuid), public.messenger_decline_call(uuid), public.messenger_leave_call(uuid), public.messenger_ring_timeout(uuid),
  public.messenger_calls_ringing(), public.messenger_call_history(int), public.messenger_call_for_token(uuid), public.messenger_call_event(text, text, text) from public, anon, authenticated;
grant execute on function public.messenger_in_call(uuid), public.messenger_start_call(uuid, text), public.messenger_answer_call(uuid), public.messenger_decline_call(uuid), public.messenger_leave_call(uuid),
  public.messenger_ring_timeout(uuid), public.messenger_calls_ringing(), public.messenger_call_history(int), public.messenger_call_for_token(uuid) to authenticated;
grant execute on function public.messenger_call_event(text, text, text), public.messenger_close_stale_calls(uuid) to service_role;

-- Live delivery: Realtime applies the row security above, so only people in the call hear of it.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_calls') then
    alter publication supabase_realtime add table public.messenger_calls;
  end if;
end $$;
