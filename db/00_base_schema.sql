-- =====================================================================
-- AB Capital Workspace — BASE SCHEMA (run this FIRST on a new project)
-- =====================================================================
-- Creates every table the app uses, in dependency order, plus the
-- profile-on-signup trigger, RLS, storage buckets and realtime.
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query
-- → paste → Run). Idempotent — safe to re-run.
--
-- After this, run the other files in db/ (functions, automations engine,
-- reports, etc.) — they build on these tables.
--
-- Built from the Supabase "schema for context" export, with fixes so it
-- actually executes:
--   * tables ordered so every foreign key target exists first
--   * tasks.assignees typed as text[] (export showed bare "ARRAY")
--   * ON DELETE rules added — the export omits them, but the app relies on
--     them (e.g. permanently deleting a space/folder/task removes rows that
--     comments, checklists, fields and statuses still point at)
--
-- RLS below follows the pattern used in the other db/ files: any signed-in
-- user can read/write workspace data; admins alone manage access rules and
-- profiles. Tighten per table if you need stricter member access.
-- =====================================================================


-- ── 1. Tables ────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  full_name    text,
  email        text,
  role         text default 'member',
  avatar_color text default '#378ADD',
  created_at   timestamp default now()
);

create table if not exists public.spaces (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text default '#378ADD',
  created_at timestamp default now(),
  icon       text default '🏢',
  deleted_at timestamptz,
  deleted_by text,
  sort_order double precision
);

create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid,
  parent_id  uuid,
  name       text not null,
  deleted_at timestamptz,
  deleted_by text,
  sort_order double precision,
  constraint folders_space_id_fkey  foreign key (space_id)  references public.spaces(id)  on delete cascade,
  constraint folders_parent_id_fkey foreign key (parent_id) references public.folders(id) on delete cascade
);

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid references public.folders(id) on delete cascade,
  space_id   uuid references public.spaces(id)  on delete cascade,
  name       text not null,
  created_at timestamptz default now(),
  deleted_at timestamptz,
  deleted_by text,
  sort_order double precision
);

create table if not exists public.space_fields (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid references public.spaces(id)  on delete cascade,
  field_name    text not null,
  field_type    text default 'text',
  field_order   integer default 0,
  folder_id     uuid references public.folders(id) on delete cascade,
  field_options jsonb default '[]'::jsonb,
  list_id       uuid references public.lists(id)   on delete cascade
);

create table if not exists public.space_statuses (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid references public.spaces(id)  on delete cascade,
  name            text not null,
  color           text default '#378ADD',
  status_order    integer default 0,
  folder_id       uuid references public.folders(id) on delete cascade,
  list_id         uuid references public.lists(id)   on delete cascade,
  is_complete     boolean,
  status_category text
);

create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  space_id            uuid references public.spaces(id)  on delete cascade,
  folder_id           uuid references public.folders(id) on delete cascade,
  status              text default 'To Do',
  priority            text default 'Medium',
  assignee            text,
  due_date            date,
  created_at          timestamp default now(),
  assignee_id         uuid references public.profiles(id) on delete set null,
  assignees           text[] default '{}'::text[],
  updated_by          text,
  updated_at          timestamptz default now(),
  date_done           date,
  date_closed         date,
  date_updated_manual date,
  deleted_at          timestamptz,
  deleted_by          text,
  list_id             uuid references public.lists(id) on delete cascade,
  parent_task_id      uuid references public.tasks(id) on delete cascade,
  source_key          text,
  cloned_from         uuid references public.tasks(id) on delete set null,
  mirror_of           uuid references public.tasks(id) on delete set null
);

create table if not exists public.task_field_values (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid references public.tasks(id)        on delete cascade,
  field_id uuid references public.space_fields(id) on delete cascade,
  value    text
);

create table if not exists public.task_history (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks(id) on delete cascade,
  changed_by text not null,
  changed_at timestamptz default now(),
  changes    jsonb not null,
  snapshot   jsonb
);

create table if not exists public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.tasks(id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  file_type    text,
  storage_path text not null,
  uploaded_by  text,
  uploaded_at  timestamptz default now()
);

create table if not exists public.task_checklists (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  name       text not null default 'Checklist',
  list_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.task_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.task_checklists(id) on delete cascade,
  task_id      uuid not null references public.tasks(id)           on delete cascade,
  title        text not null,
  is_checked   boolean default false,
  item_order   integer default 0,
  assigned_to  text,
  created_at   timestamptz default now()
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.task_list_views (
  id         uuid primary key default gen_random_uuid(),
  scope_type text not null,
  scope_id   uuid not null,
  columns    jsonb not null,
  updated_at timestamptz default now()
);

create table if not exists public.wiki_categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  parent_id      uuid references public.wiki_categories(id) on delete cascade,
  category_order integer default 0,
  created_at     timestamp default now(),
  deleted_at     timestamptz,
  deleted_by     text
);

create table if not exists public.wiki_articles (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid references public.spaces(id)          on delete set null,
  title       text not null,
  content     text,
  updated_at  timestamp default now(),
  category_id uuid references public.wiki_categories(id) on delete set null,
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text,
  folder_id   uuid references public.folders(id)         on delete set null
);

create table if not exists public.wiki_history (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid references public.wiki_articles(id) on delete cascade,
  changed_by text not null,
  changed_at timestamptz default now(),
  title      text,
  content    text,
  action     text
);

create table if not exists public.wiki_attachments (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid not null references public.wiki_articles(id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  file_type    text,
  storage_path text not null,
  uploaded_by  text,
  uploaded_at  timestamptz default now()
);

create table if not exists public.task_wiki_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid references public.tasks(id)         on delete cascade,
  article_id uuid references public.wiki_articles(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.whiteboards (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Untitled Whiteboard',
  folder_id  uuid references public.folders(id) on delete cascade,
  space_id   uuid references public.spaces(id)  on delete cascade,
  data       jsonb default '{"strokes": []}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.space_access (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid references public.spaces(id)   on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.folder_access (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid references public.folders(id)  on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  created_at timestamptz default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  task_id    uuid references public.tasks(id) on delete cascade,
  type       text,
  title      text not null,
  body       text,
  link_scope jsonb,
  read       boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.automations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  enabled          boolean default true,
  scope_type       text not null,
  scope_id         uuid not null,
  trigger          jsonb not null,
  conditions       jsonb default '[]'::jsonb,
  actions          jsonb default '[]'::jsonb,
  created_by       text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  conditions_match text default 'all'
);

create table if not exists public.automation_runs (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations(id) on delete cascade,
  task_id       uuid,
  event         text,
  detail        jsonb,
  ran_at        timestamptz default now()
);

create table if not exists public.automation_email_queue (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid,
  task_id       uuid,
  automation_id uuid,
  subject       text,
  body          text,
  status        text default 'pending',
  error         text,
  created_at    timestamptz default now(),
  sent_at       timestamptz
);

create table if not exists public.quotation_templates (
  id           uuid primary key default gen_random_uuid(),
  freezone     text not null,
  storage_path text not null,
  file_name    text,
  fields       jsonb not null default '[]'::jsonb,
  updated_by   text,
  updated_at   timestamptz default now(),
  created_at   timestamptz default now(),
  deleted_at   timestamptz,
  usd_rate     numeric default 3.6725
);

create table if not exists public.quotation_template_history (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.quotation_templates(id) on delete cascade,
  freezone     text,
  fields       jsonb,
  usd_rate     numeric,
  file_name    text,
  storage_path text,
  action       text,
  changed_by   text,
  changed_at   timestamptz default now()
);


-- ── 2. Indexes on the hot lookup columns ─────────────────────────────

create index if not exists idx_folders_space          on public.folders(space_id);
create index if not exists idx_folders_parent         on public.folders(parent_id);
create index if not exists idx_lists_folder           on public.lists(folder_id);
create index if not exists idx_lists_space            on public.lists(space_id);
create index if not exists idx_tasks_space            on public.tasks(space_id);
create index if not exists idx_tasks_folder           on public.tasks(folder_id);
create index if not exists idx_tasks_list             on public.tasks(list_id);
create index if not exists idx_tasks_parent           on public.tasks(parent_task_id);
create index if not exists idx_tasks_assignee         on public.tasks(assignee_id);
create index if not exists idx_tasks_source_key       on public.tasks(source_key);
create index if not exists idx_tfv_task               on public.task_field_values(task_id);
create index if not exists idx_tfv_field              on public.task_field_values(field_id);
create index if not exists idx_task_history_task      on public.task_history(task_id, changed_at desc);
create index if not exists idx_task_comments_task     on public.task_comments(task_id);
create index if not exists idx_task_checklists_task   on public.task_checklists(task_id);
create index if not exists idx_checklist_items_list   on public.task_checklist_items(checklist_id);
create index if not exists idx_task_attachments_task  on public.task_attachments(task_id);
create index if not exists idx_wiki_attachments_article on public.wiki_attachments(article_id, uploaded_at desc);
create index if not exists idx_wiki_history_article   on public.wiki_history(article_id, changed_at desc);
create index if not exists idx_notifications_user     on public.notifications(user_id, read, created_at desc);
create index if not exists idx_task_list_views_scope  on public.task_list_views(scope_type, scope_id);
create index if not exists idx_automations_scope      on public.automations(scope_type, scope_id);


-- ── 3. Auto-create a profile row for every new auth user ─────────────
-- The README's "add a team member" flow creates the user in Auth, then
-- updates their profile row — this trigger is what creates that row.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Admin check used by the policies below. SECURITY DEFINER so it can read
-- profiles without recursing through profiles' own RLS.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;


-- ── 4. Row Level Security ────────────────────────────────────────────

-- Workspace data: any signed-in user can read and write.
do $$
declare t text;
begin
  foreach t in array array[
    'spaces','folders','lists','space_fields','space_statuses','tasks',
    'task_field_values','task_history','task_attachments','task_checklists',
    'task_checklist_items','task_comments','task_list_views','wiki_categories',
    'wiki_articles','wiki_history','wiki_attachments','task_wiki_links',
    'whiteboards','automations','quotation_template_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_authenticated_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (true) with check (true)',
      t || '_authenticated_all', t);
  end loop;
end $$;

-- Profiles: everyone signed in can read (assignee dropdowns); only admins
-- change them (role edits). New rows come from the trigger above.
alter table public.profiles enable row level security;
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Access rules: readable by all (the sidebar filters on them), admin-managed.
do $$
declare t text;
begin
  foreach t in array array['space_access','folder_access'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_write', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_write', t);
  end loop;
end $$;

-- Notifications: you see and manage your own; anyone can notify others
-- (e.g. @mentions inserted from the task drawer).
alter table public.notifications enable row level security;
drop policy if exists notifications_own on public.notifications;
create policy notifications_own on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists notifications_own_update on public.notifications;
create policy notifications_own_update on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists notifications_own_delete on public.notifications;
create policy notifications_own_delete on public.notifications
  for delete to authenticated using (user_id = auth.uid());
drop policy if exists notifications_insert on public.notifications;
create policy notifications_insert on public.notifications
  for insert to authenticated with check (true);

-- Quotation templates: readable by all, admin-managed (same as quotation_maker.sql).
alter table public.quotation_templates enable row level security;
drop policy if exists quotation_templates_select on public.quotation_templates;
create policy quotation_templates_select on public.quotation_templates
  for select to authenticated using (true);
drop policy if exists quotation_templates_admin_write on public.quotation_templates;
create policy quotation_templates_admin_write on public.quotation_templates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Automation engine internals: written only by SECURITY DEFINER functions
-- (phase3_automations_engine.sql); admins can inspect them.
do $$
declare t text;
begin
  foreach t in array array['automation_runs','automation_email_queue'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())', t || '_admin_read', t);
  end loop;
end $$;


-- ── 5. Storage buckets (private) ─────────────────────────────────────
-- wiki-attachments and quotation-templates get their policies from
-- wiki_attachments.sql and quotation_maker.sql; task-attachments is here.

insert into storage.buckets (id, name, public) values
  ('task-attachments',    'task-attachments',    false),
  ('wiki-attachments',    'wiki-attachments',    false),
  ('quotation-templates', 'quotation-templates', false)
on conflict (id) do nothing;

drop policy if exists "task-attachments read" on storage.objects;
create policy "task-attachments read" on storage.objects
  for select to authenticated using (bucket_id = 'task-attachments');
drop policy if exists "task-attachments insert" on storage.objects;
create policy "task-attachments insert" on storage.objects
  for insert to authenticated with check (bucket_id = 'task-attachments');
drop policy if exists "task-attachments delete" on storage.objects;
create policy "task-attachments delete" on storage.objects
  for delete to authenticated using (bucket_id = 'task-attachments');


-- ── 6. Realtime ──────────────────────────────────────────────────────
-- The sidebar's live task counts and the notification bell subscribe to
-- these tables.

do $$
declare t text;
begin
  foreach t in array array['tasks','notifications'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
