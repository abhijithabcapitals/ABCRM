-- =====================================================================
-- AB Capital Messenger - DRAFT schema for review. NOT a migration: never run this as it stands.
-- Each phase becomes its own numbered file in Database Module/Messanger Base/migrations, with a rollback and tests,
-- and adds its row security policies and guarded functions at that point. Policies are not written here yet.
-- Extends the live messenger_ tables from migration 003. Times are timestamptz in UTC.
-- Phase 1 is now real, in migrations/004_chat_parity.sql, and differs from the sketch below: reactions and the file summary live on the message,
-- mentions are a column, and presence has last_seen_at. Read 004 for phase 1.
-- =====================================================================

-- Phase 1: chat parity
alter table public.messenger_messages
  add column parent_id uuid references public.messenger_messages(id) on delete set null,   -- replies and threads
  add column edited_at timestamptz,
  add column deleted_at timestamptz,                                                        -- soft delete keeps thread shape
  add column search tsvector generated always as (to_tsvector('simple', body)) stored;
create index on public.messenger_messages (parent_id);
create index on public.messenger_messages using gin (search);

alter table public.messenger_members
  add column muted boolean not null default false,
  add column pinned boolean not null default false;

create table public.messenger_reactions (
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) <= 16),
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id, emoji)
);
create index on public.messenger_reactions (profile_id);

create table public.messenger_mentions (
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  primary key (message_id, profile_id)
);
create index on public.messenger_mentions (profile_id);

create table public.messenger_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messenger_messages(id) on delete cascade,
  uploaded_by uuid references public.profiles(id) on delete set null,
  storage_key text not null unique,                               -- object key in R2; the file is not in the database
  file_name text not null check (char_length(file_name) <= 255),
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  created_at timestamptz not null default now()
);
create index on public.messenger_attachments (message_id);
create index on public.messenger_attachments (uploaded_by);

create table public.messenger_activity (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('mention', 'reply', 'reaction', 'missed_call', 'meeting')),
  actor_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.messenger_conversations(id) on delete cascade,
  message_id uuid references public.messenger_messages(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.messenger_activity (profile_id, created_at desc);

create table public.messenger_presence (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null default 'offline' check (status in ('available', 'busy', 'dnd', 'away', 'offline')),
  status_until timestamptz,
  updated_at timestamptz not null default now()
);

-- Phase 2: teams and channels. A channel owns a conversation, so messages, reactions and files reuse the tables above.
alter table public.messenger_conversations drop constraint messenger_conversations_kind_check;
alter table public.messenger_conversations add constraint messenger_conversations_kind_check
  check (kind in ('direct', 'group', 'channel', 'meeting'));
-- The existing title and direct_key check must also be widened in the real migration.

create table public.messenger_teams (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  description text check (char_length(description) <= 500),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.messenger_team_members (
  team_id uuid not null references public.messenger_teams(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);
create index on public.messenger_team_members (profile_id);

create table public.messenger_channels (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.messenger_teams(id) on delete cascade,
  conversation_id uuid not null unique references public.messenger_conversations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  visibility text not null default 'standard' check (visibility in ('standard', 'private')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, name)
);

-- Phase 4: calls
create table public.messenger_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.messenger_conversations(id) on delete set null,
  started_by uuid references public.profiles(id) on delete set null,
  room_name text not null unique,
  media text not null default 'audio' check (media in ('audio', 'video')),
  status text not null default 'ringing' check (status in ('ringing', 'active', 'ended', 'missed', 'declined')),
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index on public.messenger_calls (conversation_id, started_at desc);
create index on public.messenger_calls (started_by);

create table public.messenger_call_participants (
  call_id uuid not null references public.messenger_calls(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (call_id, profile_id)
);
create index on public.messenger_call_participants (profile_id);

-- Phase 5: calendar and meetings
create table public.messenger_meetings (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid references public.profiles(id) on delete set null,
  conversation_id uuid references public.messenger_conversations(id) on delete set null,   -- the meeting's own chat
  room_name text not null unique,
  title text not null check (char_length(title) between 1 and 200),
  notes text,
  start_at timestamptz not null,
  end_at timestamptz not null,
  time_zone text not null default 'Asia/Dubai',                   -- repeats expand in this zone
  repeat_rule text,                                               -- iCalendar RRULE text
  series_id uuid references public.messenger_meetings(id) on delete cascade,
  lobby_rule text not null default 'staff_skip' check (lobby_rule in ('everyone_waits', 'staff_skip', 'nobody_waits')),
  record_rule text not null default 'organizers' check (record_rule in ('organizers', 'presenters', 'nobody')),
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);
create index on public.messenger_meetings (organizer_id, start_at);
create index on public.messenger_meetings (start_at);
create index on public.messenger_meetings (series_id);
create index on public.messenger_meetings (conversation_id);

create table public.messenger_meeting_participants (
  meeting_id uuid not null references public.messenger_meetings(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'attendee' check (role in ('organizer', 'co_organizer', 'presenter', 'attendee')),
  response text not null default 'none' check (response in ('none', 'accepted', 'tentative', 'declined')),
  primary key (meeting_id, profile_id)
);
create index on public.messenger_meeting_participants (profile_id);

-- Phase 6: recordings and transcripts. The files live in R2.
create table public.messenger_recordings (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.messenger_meetings(id) on delete cascade,
  started_by uuid references public.profiles(id) on delete set null,
  status text not null default 'recording' check (status in ('recording', 'processing', 'ready', 'failed')),
  storage_key text unique,
  transcript_key text unique,
  size_bytes bigint,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz
);
create index on public.messenger_recordings (meeting_id);
create index on public.messenger_recordings (started_by);
