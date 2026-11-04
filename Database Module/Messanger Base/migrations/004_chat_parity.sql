-- =====================================================================
-- Messanger Base - replies, edits, deletes, reactions, mentions, files, search, activity, presence, pin and mute    004
-- Needs 003_chat.sql. Idempotent. Adds to the live tables; removes nothing.
-- Row security as in 003: no admin exception. The browser may still only read and insert messages; every other change goes through a function.
-- Reactions and the file summary live on the message, so one Realtime UPDATE carries them and Realtime's unfiltered DELETE events are never needed.
-- =====================================================================
alter table public.messenger_messages
  add column if not exists parent_id uuid references public.messenger_messages(id) on delete set null,
  add column if not exists mention_ids uuid[] not null default '{}',
  add column if not exists reactions jsonb not null default '{}',      -- {"emoji": ["profile id", ...]}
  add column if not exists attachment jsonb,                           -- {id, name, type, size}; set only by messenger_send_file
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz;
create index if not exists messenger_messages_parent_idx on public.messenger_messages (parent_id);
create index if not exists messenger_messages_search_idx on public.messenger_messages using gin (to_tsvector('simple'::regconfig, body));

alter table public.messenger_members
  add column if not exists muted boolean not null default false,
  add column if not exists pinned boolean not null default false;

-- Files stay in private object storage; this row holds where and what. deleted_at stops downloads once the message is deleted.
create table if not exists public.messenger_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  storage_key text not null unique check (char_length(storage_key) <= 200),
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null check (char_length(content_type) <= 200),
  size_bytes bigint not null check (size_bytes between 1 and 26214400),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists messenger_attachments_message_idx on public.messenger_attachments (message_id);
create index if not exists messenger_attachments_conv_idx on public.messenger_attachments (conversation_id, created_at desc);
create index if not exists messenger_attachments_uploader_idx on public.messenger_attachments (uploaded_by);

create table if not exists public.messenger_activity (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mention', 'reply', 'reaction')),
  actor_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid not null references public.messenger_conversations(id) on delete cascade,
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  detail text check (char_length(detail) <= 16),                       -- the emoji, for a reaction
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists messenger_activity_person_idx on public.messenger_activity (profile_id, created_at desc);
create index if not exists messenger_activity_actor_idx on public.messenger_activity (actor_id);
create index if not exists messenger_activity_conv_idx on public.messenger_activity (conversation_id);
create index if not exists messenger_activity_message_idx on public.messenger_activity (message_id);

-- One row a person, updated by a beat every two minutes while their window is open. Older than that reads as offline.
create table if not exists public.messenger_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'available' check (status in ('available', 'busy', 'dnd', 'away')),
  last_seen_at timestamptz not null default now()
);

alter table public.messenger_attachments enable row level security;
alter table public.messenger_activity enable row level security;
alter table public.messenger_presence enable row level security;
revoke all on public.messenger_attachments, public.messenger_activity, public.messenger_presence from public, anon, authenticated;
grant all on public.messenger_attachments, public.messenger_activity, public.messenger_presence to service_role;

-- Replaces 003's version. The browser inserts messages directly, so it cannot be trusted with the new columns.
create or replace function public.messenger_stamp_message() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.created_at := now();
  new.edited_at := null;
  new.deleted_at := null;
  new.reactions := '{}';
  new.attachment := null;
  new.mention_ids := coalesce(new.mention_ids, '{}');
  if cardinality(new.mention_ids) > 50 then raise exception 'too_many_mentions'; end if;
  if new.parent_id is not null and not exists (
    select 1 from public.messenger_messages p where p.id = new.parent_id and p.conversation_id = new.conversation_id
  ) then
    raise exception 'reply_other_chat';
  end if;
  return new;
end $$;

-- Only current members hear about a mention, and a reply tells the person replied to. Nobody is told about their own message.
create or replace function public.messenger_message_activity() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_parent_sender uuid;
begin
  insert into public.messenger_activity (profile_id, kind, actor_id, conversation_id, message_id)
    select distinct m.profile_id, 'mention', new.sender_id, new.conversation_id, new.id
    from public.messenger_members m
    where m.conversation_id = new.conversation_id and m.profile_id = any(new.mention_ids) and m.profile_id is distinct from new.sender_id;
  if new.parent_id is not null then
    select p.sender_id into v_parent_sender from public.messenger_messages p where p.id = new.parent_id;
    if v_parent_sender is not null and v_parent_sender is distinct from new.sender_id and not (v_parent_sender = any(new.mention_ids))
       and exists (select 1 from public.messenger_members m where m.conversation_id = new.conversation_id and m.profile_id = v_parent_sender) then
      insert into public.messenger_activity (profile_id, kind, actor_id, conversation_id, message_id)
        values (v_parent_sender, 'reply', new.sender_id, new.conversation_id, new.id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists messenger_messages_activity on public.messenger_messages;
create trigger messenger_messages_activity after insert on public.messenger_messages
  for each row execute function public.messenger_message_activity();

create or replace function public.messenger_edit_message(p_message uuid, p_body text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_row public.messenger_messages;
begin
  if p_body is null or char_length(btrim(p_body)) = 0 or char_length(p_body) > 4000 then raise exception 'body_invalid'; end if;
  select * into v_row from public.messenger_messages where id = p_message for update;
  if not found or v_row.sender_id is distinct from v_me or not public.messenger_is_member(v_row.conversation_id) then raise exception 'not_allowed'; end if;
  if v_row.deleted_at is not null or v_row.attachment is not null then raise exception 'not_editable'; end if;
  update public.messenger_messages set body = p_body, edited_at = now() where id = p_message;
end $$;

-- Keeps the row so replies keep their place, and clears everything the sender wrote. The file stops downloading at once.
create or replace function public.messenger_delete_message(p_message uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_row public.messenger_messages;
begin
  select * into v_row from public.messenger_messages where id = p_message for update;
  if not found or v_row.sender_id is distinct from v_me or not public.messenger_is_member(v_row.conversation_id) then raise exception 'not_allowed'; end if;
  if v_row.deleted_at is not null then return; end if;
  update public.messenger_messages
    set body = 'Message deleted', link_type = null, link_ref = null, link_label = null, mention_ids = '{}', reactions = '{}', attachment = null, deleted_at = now()
    where id = p_message;
  update public.messenger_attachments set deleted_at = now() where message_id = p_message;
  delete from public.messenger_activity where message_id = p_message;
end $$;

create or replace function public.messenger_toggle_reaction(p_message uuid, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_row public.messenger_messages; v_who jsonb; v_out jsonb; v_added boolean;
begin
  if p_emoji is null or char_length(p_emoji) not between 1 and 16 then raise exception 'reaction_invalid'; end if;
  select * into v_row from public.messenger_messages where id = p_message for update;
  if not found or not public.messenger_is_member(v_row.conversation_id) then raise exception 'not_allowed'; end if;
  if v_row.deleted_at is not null then raise exception 'message_deleted'; end if;
  v_who := coalesce(v_row.reactions -> p_emoji, '[]'::jsonb);
  v_added := not (v_who ? v_me::text);
  if v_added and not (v_row.reactions ? p_emoji) and (select count(*) from jsonb_object_keys(v_row.reactions)) >= 20 then raise exception 'too_many_reactions'; end if;
  v_who := case when v_added then v_who || to_jsonb(v_me::text) else v_who - v_me::text end;
  v_out := case when jsonb_array_length(v_who) = 0 then v_row.reactions - p_emoji else jsonb_set(v_row.reactions, array[p_emoji], v_who) end;
  update public.messenger_messages set reactions = v_out where id = p_message;
  if v_added and v_row.sender_id is not null and v_row.sender_id <> v_me
     and exists (select 1 from public.messenger_members m where m.conversation_id = v_row.conversation_id and m.profile_id = v_row.sender_id) then
    insert into public.messenger_activity (profile_id, kind, actor_id, conversation_id, message_id, detail)
      values (v_row.sender_id, 'reaction', v_me, v_row.conversation_id, p_message, p_emoji);
  end if;
  return v_out;
end $$;

create or replace function public.messenger_set_chat_flags(p_conversation uuid, p_muted boolean default null, p_pinned boolean default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messenger_members
    set muted = coalesce(p_muted, muted), pinned = coalesce(p_pinned, pinned)
    where conversation_id = p_conversation and profile_id = (select auth.uid());
  if not found then raise exception 'not_allowed'; end if;
end $$;

-- Called only after the Edge Function has confirmed the stored file's real size. A retry with the same id changes nothing.
create or replace function public.messenger_send_file(p_id uuid, p_conversation uuid, p_key text, p_name text, p_type text, p_size bigint, p_parent uuid default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid()); v_attachment uuid := gen_random_uuid();
begin
  if not public.messenger_is_member(p_conversation) then raise exception 'not_allowed'; end if;
  if p_key is null or left(p_key, 37) <> p_conversation::text || '/' then raise exception 'key_invalid'; end if;
  if exists (select 1 from public.messenger_messages where id = p_id) then
    if exists (select 1 from public.messenger_attachments where message_id = p_id and uploaded_by = v_me and storage_key = p_key) then return; end if;
    raise exception 'not_allowed';
  end if;
  insert into public.messenger_messages (id, conversation_id, sender_id, body, parent_id) values (p_id, p_conversation, v_me, p_name, p_parent);
  insert into public.messenger_attachments (id, message_id, conversation_id, uploaded_by, storage_key, file_name, content_type, size_bytes)
    values (v_attachment, p_id, p_conversation, v_me, p_key, p_name, coalesce(p_type, 'application/octet-stream'), p_size);
  update public.messenger_messages
    set attachment = jsonb_build_object('id', v_attachment, 'name', p_name, 'type', coalesce(p_type, 'application/octet-stream'), 'size', p_size)
    where id = p_id;
end $$;

create or replace function public.messenger_file_for_download(p_attachment uuid)
returns table (storage_key text, file_name text, content_type text)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  return query select a.storage_key, a.file_name, a.content_type from public.messenger_attachments a
    where a.id = p_attachment and a.deleted_at is null and public.messenger_is_member(a.conversation_id);
  if not found then raise exception 'not_allowed'; end if;
end $$;

create or replace function public.messenger_files(p_limit int default 100)
returns table (id uuid, conversation_id uuid, file_name text, content_type text, size_bytes bigint, uploader_name text, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.conversation_id, a.file_name, a.content_type, a.size_bytes, p.full_name, a.created_at
  from public.messenger_attachments a
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = (select auth.uid())
  left join public.profiles p on p.id = a.uploaded_by
  where a.deleted_at is null
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;

-- Each word matches as a prefix. Only chats the caller belongs to.
create or replace function public.messenger_search(p_query text, p_limit int default 30)
returns table (message_id uuid, conversation_id uuid, body text, sender_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_text text; v_query tsquery;
begin
  select string_agg('''' || replace(replace(w, '\', '\\'), '''', '''''') || ''':*', ' & ') into v_text
    from regexp_split_to_table(btrim(coalesce(p_query, '')), '\s+') w where w <> '';
  if v_text is null then return; end if;
  v_query := to_tsquery('simple', v_text);
  return query
    select m.id, m.conversation_id, m.body, p.full_name, m.created_at
    from public.messenger_messages m
    join public.messenger_members me on me.conversation_id = m.conversation_id and me.profile_id = (select auth.uid())
    left join public.profiles p on p.id = m.sender_id
    where m.deleted_at is null and to_tsvector('simple'::regconfig, m.body) @@ v_query
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit, 30), 1), 50);
end $$;

create or replace function public.messenger_activity_list(p_limit int default 50)
returns table (id uuid, kind text, actor_name text, conversation_id uuid, message_id uuid, preview text, detail text, read_at timestamptz, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.kind, p.full_name, a.conversation_id, a.message_id, left(m.body, 200), a.detail, a.read_at, a.created_at
  from public.messenger_activity a
  join public.messenger_messages m on m.id = a.message_id
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = a.profile_id
  left join public.profiles p on p.id = a.actor_id
  where a.profile_id = (select auth.uid())
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;

-- With no id, marks everything read.
create or replace function public.messenger_activity_read(p_id uuid default null) returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.messenger_activity set read_at = now()
  where profile_id = (select auth.uid()) and read_at is null and (p_id is null or id = p_id)
$$;

create or replace function public.messenger_presence_beat(p_status text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select auth.uid()) is null then raise exception 'not_allowed'; end if;
  insert into public.messenger_presence (profile_id, status) values ((select auth.uid()), coalesce(p_status, 'available'))
    on conflict (profile_id) do update set status = coalesce(p_status, public.messenger_presence.status), last_seen_at = now();
end $$;

-- Only the caller and people they share a chat with.
create or replace function public.messenger_presence_list()
returns table (profile_id uuid, status text, last_seen_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select pr.profile_id, pr.status, pr.last_seen_at from public.messenger_presence pr
  where pr.profile_id = (select auth.uid()) or exists (
    select 1 from public.messenger_members mine
    join public.messenger_members theirs on theirs.conversation_id = mine.conversation_id
    where mine.profile_id = (select auth.uid()) and theirs.profile_id = pr.profile_id)
$$;

-- The list gains muted and pinned, and a deleted message no longer counts as unread. Its return type changes, so it is replaced.
drop function if exists public.messenger_chat_list();
create function public.messenger_chat_list()
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
  where me.profile_id = (select auth.uid())
  order by c.last_message_at desc, c.id
$$;

revoke all on function public.messenger_message_activity(), public.messenger_edit_message(uuid, text), public.messenger_delete_message(uuid),
  public.messenger_toggle_reaction(uuid, text), public.messenger_set_chat_flags(uuid, boolean, boolean),
  public.messenger_send_file(uuid, uuid, text, text, text, bigint, uuid), public.messenger_file_for_download(uuid), public.messenger_files(int),
  public.messenger_search(text, int), public.messenger_activity_list(int), public.messenger_activity_read(uuid),
  public.messenger_presence_beat(text), public.messenger_presence_list(), public.messenger_chat_list() from public, anon, authenticated;
grant execute on function public.messenger_edit_message(uuid, text), public.messenger_delete_message(uuid),
  public.messenger_toggle_reaction(uuid, text), public.messenger_set_chat_flags(uuid, boolean, boolean),
  public.messenger_send_file(uuid, uuid, text, text, text, bigint, uuid), public.messenger_file_for_download(uuid), public.messenger_files(int),
  public.messenger_search(text, int), public.messenger_activity_list(int), public.messenger_activity_read(uuid),
  public.messenger_presence_beat(text), public.messenger_presence_list(), public.messenger_chat_list() to authenticated;
