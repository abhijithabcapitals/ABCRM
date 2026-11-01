-- LOCAL TEST ONLY. Never run on Supabase. Stand-ins for the CRM task tables HR links to.
-- Column names and types follow Main Module/db/00_base_schema.sql (only the columns HR reads, plus the soft-delete ones).
create table if not exists public.spaces (id uuid primary key default gen_random_uuid(), name text not null, deleted_at timestamptz);
create table if not exists public.folders (id uuid primary key default gen_random_uuid(), space_id uuid references public.spaces(id) on delete cascade, parent_id uuid, name text not null, deleted_at timestamptz);
create table if not exists public.lists (id uuid primary key default gen_random_uuid(), folder_id uuid references public.folders(id) on delete cascade, space_id uuid references public.spaces(id) on delete cascade, name text not null, created_at timestamptz default now(), deleted_at timestamptz);
create table if not exists public.space_statuses (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces(id) on delete cascade,
  name text not null,
  folder_id uuid references public.folders(id) on delete cascade,
  list_id uuid references public.lists(id) on delete cascade,
  is_complete boolean,
  status_category text
);
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  space_id uuid references public.spaces(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  status text default 'To Do',
  priority text default 'Medium',
  due_date date,
  created_at timestamp default now(),
  assignees text[] default '{}'::text[],
  date_done date,
  date_closed date,
  deleted_at timestamptz,
  list_id uuid references public.lists(id) on delete set null
);
