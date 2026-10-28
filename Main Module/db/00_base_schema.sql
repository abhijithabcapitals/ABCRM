-- =====================================================================
-- AB Capital Workspace — BASE SCHEMA (mirror of the LIVE database)
-- =====================================================================
-- Rebuilds the whole database structure on a NEW, EMPTY Supabase project:
-- tables, constraints, indexes, every function, triggers, RLS policies,
-- storage buckets, realtime and scheduled jobs. No data.
--
-- Generated from the live project (kokyhqbsdftyyjirzzvs) on 2026-10-26 via
-- db/tools/export_live_schema.sql. It reproduces production AS IS —
-- including its known security gaps; see db/security_fixes.sql for the
-- recommended fixes and apply those afterwards.
--
-- Run in Supabase → SQL Editor on a fresh project. Idempotent.
-- DO NOT run on the live project.
-- =====================================================================


-- ── 1. Extensions ────────────────────────────────────────────────────
-- pg_cron / pg_net: Dashboard → Database → Extensions if these fail here.

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net;


-- ── 2. Tables ────────────────────────────────────────────────────────

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
  folder_id  uuid constraint lists_folder_id_fkey references public.folders(id) on delete cascade,
  space_id   uuid constraint lists_space_id_fkey  references public.spaces(id)  on delete cascade,
  name       text not null,
  created_at timestamptz default now(),
  deleted_at timestamptz,
  deleted_by text,
  sort_order double precision
);

create table if not exists public.space_fields (
  id            uuid primary key default gen_random_uuid(),
  space_id      uuid constraint space_fields_space_id_fkey  references public.spaces(id)  on delete cascade,
  field_name    text not null,
  field_type    text default 'text',
  field_order   integer default 0,
  folder_id     uuid constraint space_fields_folder_id_fkey references public.folders(id) on delete cascade,
  field_options jsonb default '[]'::jsonb,
  list_id       uuid constraint space_fields_list_id_fkey   references public.lists(id)   on delete cascade
);

create table if not exists public.space_statuses (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid constraint space_statuses_space_id_fkey  references public.spaces(id)  on delete cascade,
  name            text not null,
  color           text default '#378ADD',
  status_order    integer default 0,
  folder_id       uuid constraint space_statuses_folder_id_fkey references public.folders(id) on delete cascade,
  list_id         uuid constraint space_statuses_list_id_fkey   references public.lists(id)   on delete cascade,
  is_complete     boolean,
  status_category text
);

create table if not exists public.tasks (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  space_id            uuid constraint tasks_space_id_fkey  references public.spaces(id)  on delete cascade,
  folder_id           uuid constraint tasks_folder_id_fkey references public.folders(id) on delete cascade,
  status              text default 'To Do',
  priority            text default 'Medium',
  assignee            text,
  due_date            date,
  created_at          timestamp default now(),
  assignee_id         uuid constraint tasks_assignee_id_fkey references public.profiles(id) on delete set null,
  assignees           text[] default '{}'::text[],
  updated_by          text,
  updated_at          timestamptz default now(),
  date_done           date,
  date_closed         date,
  date_updated_manual date,
  deleted_at          timestamptz,
  deleted_by          text,
  list_id             uuid constraint tasks_list_id_fkey        references public.lists(id) on delete set null,
  parent_task_id      uuid constraint tasks_parent_task_id_fkey references public.tasks(id) on delete cascade,
  source_key          text,
  cloned_from         uuid constraint tasks_cloned_from_fkey    references public.tasks(id) on delete set null,
  mirror_of           uuid constraint tasks_mirror_of_fkey      references public.tasks(id) on delete set null
);

create table if not exists public.task_field_values (
  id       uuid primary key default gen_random_uuid(),
  task_id  uuid constraint task_field_values_task_id_fkey  references public.tasks(id)        on delete cascade,
  field_id uuid constraint task_field_values_field_id_fkey references public.space_fields(id) on delete cascade,
  value    text
);

create table if not exists public.task_history (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid constraint task_history_task_id_fkey references public.tasks(id) on delete cascade,
  changed_by text not null,
  changed_at timestamptz default now(),
  changes    jsonb not null,
  snapshot   jsonb
);

create table if not exists public.task_attachments (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null constraint task_attachments_task_id_fkey references public.tasks(id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  file_type    text,
  storage_path text not null,
  uploaded_by  text,
  uploaded_at  timestamptz default now()
);

create table if not exists public.task_checklists (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null constraint task_checklists_task_id_fkey references public.tasks(id) on delete cascade,
  name       text not null default 'Checklist',
  list_order integer default 0,
  created_at timestamptz default now()
);

create table if not exists public.task_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null constraint task_checklist_items_checklist_id_fkey references public.task_checklists(id) on delete cascade,
  task_id      uuid not null constraint task_checklist_items_task_id_fkey      references public.tasks(id)           on delete cascade,
  title        text not null,
  is_checked   boolean default false,
  item_order   integer default 0,
  assigned_to  text,
  created_at   timestamptz default now()
);

create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null constraint task_comments_task_id_fkey references public.tasks(id) on delete cascade,
  profile_id uuid constraint task_comments_profile_id_fkey references public.profiles(id) on delete set null,
  content    text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.task_list_views (
  id         uuid primary key default gen_random_uuid(),
  scope_type text not null,
  scope_id   uuid not null,
  columns    jsonb not null,
  updated_at timestamptz default now(),
  constraint task_list_views_scope_type_scope_id_key unique (scope_type, scope_id)
);

create table if not exists public.wiki_categories (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  parent_id      uuid constraint wiki_categories_parent_id_fkey references public.wiki_categories(id) on delete cascade,
  category_order integer default 0,
  created_at     timestamp default now(),
  deleted_at     timestamptz,
  deleted_by     text
);

create table if not exists public.wiki_articles (
  id          uuid primary key default gen_random_uuid(),
  space_id    uuid constraint wiki_articles_space_id_fkey    references public.spaces(id)          on delete cascade,
  title       text not null,
  content     text,
  updated_at  timestamp default now(),
  category_id uuid constraint wiki_articles_category_id_fkey references public.wiki_categories(id) on delete set null,
  updated_by  text,
  deleted_at  timestamptz,
  deleted_by  text,
  folder_id   uuid constraint wiki_articles_folder_id_fkey   references public.folders(id)         on delete set null
);

create table if not exists public.wiki_history (
  id         uuid primary key default gen_random_uuid(),
  article_id uuid constraint wiki_history_article_id_fkey references public.wiki_articles(id) on delete cascade,
  changed_by text not null,
  changed_at timestamptz default now(),
  title      text,
  content    text,
  action     text
);

create table if not exists public.wiki_attachments (
  id           uuid primary key default gen_random_uuid(),
  article_id   uuid not null constraint wiki_attachments_article_id_fkey references public.wiki_articles(id) on delete cascade,
  file_name    text not null,
  file_size    bigint,
  file_type    text,
  storage_path text not null,
  uploaded_by  text,
  uploaded_at  timestamptz default now()
);

create table if not exists public.task_wiki_links (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid constraint task_wiki_links_task_id_fkey    references public.tasks(id)         on delete cascade,
  article_id uuid constraint task_wiki_links_article_id_fkey references public.wiki_articles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint task_wiki_links_task_id_article_id_key unique (task_id, article_id)
);

create table if not exists public.whiteboards (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Untitled Whiteboard',
  folder_id  uuid constraint whiteboards_folder_id_fkey references public.folders(id) on delete set null,
  space_id   uuid constraint whiteboards_space_id_fkey  references public.spaces(id)  on delete cascade,
  data       jsonb default '{"strokes": []}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

create table if not exists public.space_access (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid constraint space_access_space_id_fkey   references public.spaces(id)   on delete cascade,
  profile_id uuid constraint space_access_profile_id_fkey references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint space_access_space_id_profile_id_key unique (space_id, profile_id)
);

create table if not exists public.folder_access (
  id         uuid primary key default gen_random_uuid(),
  folder_id  uuid constraint folder_access_folder_id_fkey  references public.folders(id)  on delete cascade,
  profile_id uuid constraint folder_access_profile_id_fkey references public.profiles(id) on delete cascade,
  created_at timestamptz default now(),
  constraint folder_access_folder_id_profile_id_key unique (folder_id, profile_id)
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null constraint notifications_user_id_fkey references public.profiles(id) on delete cascade,
  task_id    uuid constraint notifications_task_id_fkey references public.tasks(id) on delete cascade,
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
  automation_id uuid constraint automation_runs_automation_id_fkey references public.automations(id) on delete cascade,
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
  template_id  uuid not null constraint quotation_template_history_template_id_fkey references public.quotation_templates(id) on delete cascade,
  freezone     text,
  fields       jsonb,
  usd_rate     numeric,
  file_name    text,
  storage_path text,
  action       text,
  changed_by   text,
  changed_at   timestamptz default now()
);


-- ── 3. Indexes (exactly as live) ─────────────────────────────────────

create index if not exists idx_automation_email_queue_status on public.automation_email_queue (status, created_at);
create index if not exists idx_automation_runs_automation    on public.automation_runs (automation_id, ran_at desc);
create index if not exists idx_automations_scope             on public.automations (scope_type, scope_id, enabled);
create index if not exists folders_deleted_at_idx            on public.folders (deleted_at);
create index if not exists idx_notifications_user            on public.notifications (user_id, read, created_at desc);
create index if not exists quotation_template_history_tpl_idx on public.quotation_template_history (template_id, changed_at desc);
create index if not exists idx_space_fields_list_id          on public.space_fields (list_id);
create index if not exists idx_space_statuses_space_name     on public.space_statuses (space_id, name);
create index if not exists spaces_deleted_at_idx             on public.spaces (deleted_at);
create index if not exists task_attachments_task_id_idx      on public.task_attachments (task_id);
create index if not exists task_checklist_items_checklist_id_idx on public.task_checklist_items (checklist_id);
create index if not exists task_checklists_task_id_idx       on public.task_checklists (task_id);
create index if not exists task_comments_task_id_idx         on public.task_comments (task_id);
create index if not exists idx_tfv_field_id                  on public.task_field_values (field_id);
create index if not exists idx_tfv_task_id                   on public.task_field_values (task_id);
create index if not exists task_history_task_id              on public.task_history (task_id, changed_at desc);
create index if not exists idx_tasks_active_folder           on public.tasks (folder_id) where deleted_at is null;
create index if not exists idx_tasks_active_list             on public.tasks (list_id) where deleted_at is null;
create index if not exists idx_tasks_active_space            on public.tasks (space_id) where deleted_at is null;
create index if not exists idx_tasks_list_active             on public.tasks (list_id) where deleted_at is null;
create index if not exists idx_tasks_list_created            on public.tasks (list_id, created_at desc) where deleted_at is null;
create index if not exists idx_tasks_parent_task_id          on public.tasks (parent_task_id);
create index if not exists tasks_cloned_from_idx             on public.tasks (cloned_from) where deleted_at is null;
create index if not exists tasks_deleted_at_idx              on public.tasks (deleted_at);
create index if not exists tasks_mirror_of_idx               on public.tasks (mirror_of) where deleted_at is null;
create unique index if not exists tasks_source_key_uniq      on public.tasks (source_key) where source_key is not null and deleted_at is null;
create index if not exists wiki_articles_deleted_at_idx      on public.wiki_articles (deleted_at);
create index if not exists idx_wiki_attachments_article      on public.wiki_attachments (article_id, uploaded_at desc);
create index if not exists wiki_categories_deleted_at_idx    on public.wiki_categories (deleted_at);
create index if not exists wiki_history_article_id           on public.wiki_history (article_id, changed_at desc);


-- ── 4. Functions (verbatim from live, alphabetical) ──────────────────
-- Includes two stale overloads still present live:
-- assignee_tasks(text) and _abcap_eval_conditions(jsonb, tasks).

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public._abcap_add_assignee(p_task uuid, p_name text)
 RETURNS void
 LANGUAGE sql
AS $function$
        update tasks set
          assignees = (case when p_name = any(coalesce(assignees,'{}'::text[]))
                            then assignees else array_append(coalesce(assignees,'{}'::text[]), p_name) end),
          assignee  = coalesce(nullif(assignee,''), p_name),
          updated_at = now()
        where id = p_task;
      $function$
;

CREATE OR REPLACE FUNCTION public._abcap_assignees(t tasks)
 RETURNS text[]
 LANGUAGE sql
 STABLE
AS $function$
        select case
          when coalesce(array_length(t.assignees,1),0) > 0 then t.assignees
          when t.assignee is not null and t.assignee <> '' then array[t.assignee]
          else '{}'::text[] end
      $function$
;

CREATE OR REPLACE FUNCTION public._abcap_clone_to(t tasks, params jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tgt_list uuid; tgt_folder uuid; tgt_space uuid;
  new_id uuid; st text; fv record; tgt_fid uuid; tgt_name text; k text; tok text; val text;
begin
  if t.cloned_from is not null then return; end if;
  tgt_list   := nullif(params->>'list_id','')::uuid;
  tgt_folder := coalesce(nullif(params->>'folder_id',''), nullif(params->>'target_folder_id',''))::uuid;

  if tgt_list is not null then
    select folder_id, space_id into tgt_folder, tgt_space from lists where id = tgt_list and deleted_at is null;
    if not found then return; end if;
  elsif tgt_folder is not null then
    select space_id into tgt_space from folders where id = tgt_folder and deleted_at is null;
    if not found then return; end if;
  else
    return;
  end if;

  perform set_config('abcap.in_automation','1', true);

  select id into new_id from tasks
   where cloned_from = t.id and deleted_at is null
     and ((tgt_list is not null and list_id = tgt_list)
       or (tgt_list is null and folder_id = tgt_folder and list_id is null))
   limit 1;

  if new_id is null then
    st := nullif(params->>'status','');
    if st is null or st = 'target_first' then
      select name into st from space_statuses
       where ((tgt_list is not null and list_id = tgt_list)
           or (tgt_list is null and folder_id = tgt_folder and list_id is null)
           or (tgt_list is null and tgt_folder is null and space_id = tgt_space and folder_id is null and list_id is null))
       order by status_order limit 1;
      st := coalesce(st, 'To Do');
    elsif st = 'source' then
      st := t.status;
    end if;

    insert into tasks (title, status, priority, space_id, folder_id, list_id, cloned_from, updated_by, updated_at)
    values (coalesce(nullif(t.title,''),'Untitled'), st, 'Medium', tgt_space, tgt_folder, tgt_list, t.id,
            coalesce(nullif(t.updated_by,''),'Automation'), now())
    returning id into new_id;
  end if;

  for fv in
    select sf.field_name as src_name, tfv.value
      from task_field_values tfv join space_fields sf on sf.id = tfv.field_id
     where tfv.task_id = t.id
  loop
    tgt_name := coalesce(
      params->'map'->>fv.src_name,
      (select v from jsonb_each_text(coalesce(params->'map','{}'::jsonb)) as m(kk, v) where lower(kk) = lower(fv.src_name) limit 1),
      fv.src_name);
    select id into tgt_fid from space_fields
     where lower(field_name) = lower(tgt_name)
       and ( (tgt_list is not null and list_id = tgt_list)
          or (tgt_folder is not null and folder_id = tgt_folder)
          or (tgt_folder is not null and list_id in (select id from lists where folder_id = tgt_folder and deleted_at is null))
          or (space_id = tgt_space and folder_id is null and list_id is null) )
     order by (list_id = tgt_list) desc nulls last, (folder_id = tgt_folder) desc nulls last
     limit 1;
    if tgt_fid is not null then
      update task_field_values set value = fv.value where task_id = new_id and field_id = tgt_fid;
      if not found then insert into task_field_values(task_id, field_id, value) values (new_id, tgt_fid, fv.value); end if;
    end if;
  end loop;

  if params ? 'set' then
    for k in select jsonb_object_keys(params->'set') loop
      tok := params->'set'->>k;
      val := case tok
               when 'today'       then to_char(current_date, 'YYYY-MM-DD')
               when 'month_start' then to_char(date_trunc('month', current_date), 'YYYY-MM-DD')
               when 'now'         then to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS')
               else tok
             end;
      select id into tgt_fid from space_fields
       where lower(field_name) = lower(k)
         and ( (tgt_list is not null and list_id = tgt_list)
            or (tgt_folder is not null and folder_id = tgt_folder)
            or (tgt_folder is not null and list_id in (select id from lists where folder_id = tgt_folder and deleted_at is null))
            or (space_id = tgt_space and folder_id is null and list_id is null) )
       order by (list_id = tgt_list) desc nulls last, (folder_id = tgt_folder) desc nulls last
       limit 1;
      if tgt_fid is not null then
        update task_field_values set value = val where task_id = new_id and field_id = tgt_fid;
        if not found then insert into task_field_values(task_id, field_id, value) values (new_id, tgt_fid, val); end if;
      end if;
    end loop;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_creator(t tasks)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$ select null::text $function$
;

CREATE OR REPLACE FUNCTION public._abcap_dispatch(t tasks, event text, changed_field text, actor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a automations; ttype text; matched boolean; tgt text; fld text; tov text;
begin
  for a in
    select * from automations
     where enabled
       and ((scope_type = 'list'   and scope_id = t.list_id)
         or (scope_type = 'folder' and scope_id = t.folder_id)
         or (scope_type = 'space'  and scope_id = t.space_id))
  loop
    ttype := a.trigger->>'type';
    matched := false;

    -- "Any change" fires on every task event (create / status / field / assign).
    -- Used by mirror rules that must sync whenever anything changes; the rule's
    -- conditions still gate whether the action runs.
    if ttype = 'any_change' then matched := true;
    elsif event = 'task_created'    and ttype = 'task_created'    then matched := true;
    elsif event = 'assigned'        and ttype = 'assigned'        then matched := true;
    elsif event = 'comment_mention' and ttype = 'comment_mention' then matched := true;
    elsif event = 'status_changed'  and ttype = 'status_changed'  then
      tgt := a.trigger->'params'->>'to';
      matched := (tgt is null or tgt = '' or tgt = t.status);
    elsif event = 'field_changed'   and ttype = 'field_changed'   then
      fld := a.trigger->'params'->>'field';
      tov := a.trigger->'params'->>'to';
      if fld = changed_field then
        if tov is null or tov = '' then
          matched := true;                                   -- any change
        elsif fld = 'assignee' then
          matched := tov = any(_abcap_assignees(t));
        else
          matched := (_abcap_field_value(t, fld) = tov);      -- changed to specific value
        end if;
      end if;
    end if;

    if matched and _abcap_eval_conditions(a.conditions, t, coalesce(a.conditions_match, 'all')) then
      -- Never let an automation failure roll back the user's task change:
      -- run it in a subtransaction and log any error instead of raising.
      begin
        perform _abcap_run(a, t, actor, event);
      exception when others then
        insert into automation_runs(automation_id, task_id, event, detail)
        values (a.id, t.id, event, jsonb_build_object('error', SQLERRM, 'actor', actor));
      end;
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_done_date(s text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when s ~ '^\d{4}-\d{2}-\d{2}' then substring(s, 1, 10)::date else null end;
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_eval_conditions(conds jsonb, t tasks)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb; field text; op text; val text; cur text; names text[]; ok boolean;
begin
  if conds is null or jsonb_array_length(conds) = 0 then return true; end if;
  for c in select jsonb_array_elements(conds) loop
    field := c->>'field'; op := c->>'op'; val := c->>'value';
    if field = 'assignee' then
      names := _abcap_assignees(t);
      ok := case op
        when 'is'       then val = any(names)
        when 'contains' then val = any(names)
        when 'is_not'   then not (val = any(names))
        when 'is_set'   then array_length(names,1) is not null
        when 'is_empty' then array_length(names,1) is null
        else true end;
    else
      cur := _abcap_field_value(t, field);
      ok := case op
        when 'is'       then cur = val
        when 'is_not'   then cur is distinct from val
        when 'contains' then cur ilike '%'||val||'%'
        when 'is_set'   then cur is not null and cur <> ''
        when 'is_empty' then cur is null or cur = ''
        else true end;
    end if;
    if not coalesce(ok, false) then return false; end if;
  end loop;
  return true;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_eval_conditions(conds jsonb, t tasks, mode text DEFAULT 'all'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c jsonb; field text; op text; val text; cur text; names text[]; ok boolean;
begin
  if conds is null or jsonb_array_length(conds) = 0 then return true; end if;
  for c in select jsonb_array_elements(conds) loop
    field := c->>'field'; op := c->>'op'; val := c->>'value';
    if field = 'assignee' then
      names := _abcap_assignees(t);
      ok := case op
        when 'is'       then val = any(names)
        when 'contains' then val = any(names)
        when 'is_not'   then not (val = any(names))
        when 'is_set'   then array_length(names,1) is not null
        when 'is_empty' then array_length(names,1) is null
        else true end;
    else
      cur := _abcap_field_value(t, field);
      ok := case op
        when 'is'       then cur = val
        when 'is_not'   then cur is distinct from val
        when 'contains' then cur ilike '%'||val||'%'
        when 'is_set'   then cur is not null and cur <> ''
        when 'is_empty' then cur is null or cur = ''
        else true end;
    end if;
    if mode = 'any' then
      if coalesce(ok, false) then return true; end if;   -- OR: first match wins
    else
      if not coalesce(ok, false) then return false; end if; -- AND: first miss fails
    end if;
  end loop;
  -- AND: nothing failed → true. OR: nothing matched → false.
  return (mode <> 'any');
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_field_value(t tasks, field text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid uuid; v text;
begin
  if field = 'status'   then return t.status; end if;
  if field = 'priority' then return t.priority; end if;
  if field = 'due_date' then return t.due_date::text; end if;
  if field like 'field\_%' then
    begin fid := substring(field from 7)::uuid; exception when others then return null; end;
    select value into v from task_field_values where task_id = t.id and field_id = fid limit 1;
    return v;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_hist_actor(p_updated_by text)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select case when current_setting('abcap.in_automation', true) = '1' then 'Automation'
              else coalesce(nullif(p_updated_by, ''), 'System') end;
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_log_field_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fname text; t_updated_by text; t_created timestamptz;
begin
  if TG_OP = 'UPDATE' and NEW.value is not distinct from OLD.value then return null; end if;
  select updated_by, created_at into t_updated_by, t_created from tasks where id = NEW.task_id;
  if not found then return null; end if;
  -- Skip the burst of field inserts fired while a task is first being created.
  if TG_OP = 'INSERT' and t_created is not null and t_created > now() - interval '10 seconds' then return null; end if;
  select field_name into fname from space_fields where id = NEW.field_id;
  insert into task_history(task_id, changed_by, changed_at, changes)
    values (NEW.task_id, _abcap_hist_actor(t_updated_by), now(),
      jsonb_build_object(coalesce(fname, 'Field'), jsonb_build_object(
        'from', coalesce(case when TG_OP = 'UPDATE' then OLD.value else '' end, ''),
        'to',   coalesce(NEW.value, ''))));
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_log_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ch jsonb := '{}'::jsonb;
begin
  if TG_OP = 'INSERT' then
    insert into task_history(task_id, changed_by, changed_at, changes)
      values (NEW.id, _abcap_hist_actor(NEW.updated_by), now(), '{"created": true}'::jsonb);
    return null;
  end if;

  if NEW.title       is distinct from OLD.title       then ch := ch || jsonb_build_object('title',       jsonb_build_object('from', OLD.title,       'to', NEW.title)); end if;
  if NEW.status      is distinct from OLD.status      then ch := ch || jsonb_build_object('status',      jsonb_build_object('from', OLD.status,      'to', NEW.status)); end if;
  if NEW.priority    is distinct from OLD.priority    then ch := ch || jsonb_build_object('priority',    jsonb_build_object('from', OLD.priority,    'to', NEW.priority)); end if;
  if NEW.due_date    is distinct from OLD.due_date    then ch := ch || jsonb_build_object('due_date',    jsonb_build_object('from', OLD.due_date,    'to', NEW.due_date)); end if;
  if NEW.description is distinct from OLD.description then ch := ch || jsonb_build_object('description', jsonb_build_object('from', '', 'to', '')); end if;
  if coalesce(NEW.assignees, '{}') is distinct from coalesce(OLD.assignees, '{}') then
    ch := ch || jsonb_build_object('assignees', jsonb_build_object(
      'from', to_jsonb(coalesce(OLD.assignees, '{}')), 'to', to_jsonb(coalesce(NEW.assignees, '{}'))));
  end if;

  if ch = '{}'::jsonb then return null; end if;  -- nothing tracked changed (e.g. trash/restore)
  insert into task_history(task_id, changed_by, changed_at, changes)
    values (NEW.id, _abcap_hist_actor(NEW.updated_by), now(), ch);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_mirror_to_list(t tasks, params jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  tgt_list uuid; tgt_folder uuid; tgt_space uuid;
  sync_mode text; mid uuid; is_new boolean := false;
  fv record; tgt_fid uuid;
begin
  if t.mirror_of is not null then return; end if;             -- don't mirror a mirror
  tgt_list := nullif(params->>'list_id','')::uuid;
  if tgt_list is null then return; end if;
  sync_mode := coalesce(nullif(params->>'sync',''), 'all');

  select folder_id, space_id into tgt_folder, tgt_space from lists where id = tgt_list;
  if not found then return; end if;

  perform set_config('abcap.in_automation','1', true);        -- suppress cascade

  select id into mid from tasks
   where mirror_of = t.id and list_id = tgt_list and deleted_at is null
   limit 1;

  if mid is null then
    insert into tasks (title, description, status, priority, assignee, assignee_id,
                       assignees, due_date, space_id, folder_id, list_id, mirror_of,
                       updated_by, updated_at)
    values (t.title, t.description, t.status, t.priority, t.assignee, t.assignee_id,
            t.assignees, t.due_date, tgt_space, tgt_folder, tgt_list, t.id,
            t.updated_by, now())
    returning id into mid;
    is_new := true;
  else
    if sync_mode = 'status' then
      update tasks set status = t.status, updated_at = now() where id = mid;
    elsif sync_mode = 'status_due' then
      update tasks set status = t.status, due_date = t.due_date, updated_at = now() where id = mid;
    else
      update tasks set title = t.title, description = t.description, status = t.status,
             priority = t.priority, assignee = t.assignee, assignee_id = t.assignee_id,
             assignees = t.assignees, due_date = t.due_date, updated_at = now()
       where id = mid;
    end if;
  end if;

  -- Custom fields: full snapshot on create; on later syncs only when sync = 'all'.
  -- Matched by field name so values land on the target list's own fields. If the
  -- target list has no field of that name, auto-create one (same type/options)
  -- so nothing is silently dropped.
  if is_new or sync_mode = 'all' then
    for fv in
      select tfv.value, sf.field_name, sf.field_type, sf.field_options
        from task_field_values tfv
        join space_fields sf on sf.id = tfv.field_id
       where tfv.task_id = t.id
    loop
      select id into tgt_fid from space_fields
       where list_id = tgt_list and field_name = fv.field_name
       limit 1;
      if tgt_fid is null then
        insert into space_fields (space_id, folder_id, list_id, field_name, field_type, field_options, field_order)
        values (tgt_space, tgt_folder, tgt_list, fv.field_name, fv.field_type, fv.field_options,
                coalesce((select max(field_order) from space_fields where list_id = tgt_list), 0) + 1)
        returning id into tgt_fid;
      end if;
      update task_field_values set value = fv.value where task_id = mid and field_id = tgt_fid;
      if not found then
        insert into task_field_values(task_id, field_id, value) values (mid, tgt_fid, fv.value);
      end if;
    end loop;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_month_relabel(v text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when v ~* '^\d{2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$'
      then initcap(split_part(v, '-', 2)) || '-20' || split_part(v, '-', 1)
    else v
  end;
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_notify_body(a automations, t tasks)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare tt text := a.trigger->>'type'; fld text; lbl text;
begin
  if tt = 'status_changed' then
    return 'Status changed to "' || coalesce(nullif(a.trigger->'params'->>'to',''), t.status) || '"';
  elsif tt = 'field_changed' then
    fld := a.trigger->'params'->>'field';
    if    fld = 'status'   then lbl := 'Status';
    elsif fld = 'priority' then lbl := 'Priority';
    elsif fld = 'assignee' then lbl := 'Assignee';
    elsif fld = 'due_date' then lbl := 'Due date';
    elsif fld like 'field\_%' then
      begin select field_name into lbl from space_fields where id = substring(fld from 7)::uuid limit 1;
      exception when others then lbl := null; end;
    end if;
    return coalesce(lbl, 'A field') || ' was updated';
  elsif tt = 'assigned'        then return 'Task assigned';
  elsif tt = 'comment_mention' then return 'New comment';
  elsif tt = 'date_based'      then return 'Date reminder';
  elsif tt = 'recurring'       then return 'Reminder';
  elsif tt = 'task_created'    then return 'New task created';
  else return 'Automation triggered';
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_parse_date(v text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if v is null then return null; end if;
  if v ~ '^\d{4}-\d{2}-\d{2}' then
    return substr(v, 1, 10)::date;
  elsif v ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$' then
    return to_date(regexp_replace(v, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', '\1-\2-\3'), 'DD-MM-YYYY');
  end if;
  return null;
exception when others then return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_recipients(recips jsonb, t tasks)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text;
begin
  for r in select jsonb_array_elements_text(coalesce(recips, '[]'::jsonb)) loop
    if r = 'assignee' then
      return query select p.id from profiles p where p.full_name = any(_abcap_assignees(t));
    elsif r = 'creator' then
      return query select p.id from profiles p where p.full_name = _abcap_creator(t);
    elsif r = 'admins' then
      return query select p.id from profiles p where p.role = 'admin';
    else
      return query select p.id from profiles p where p.full_name = r;
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_recipients2(recips jsonb, t tasks)
 RETURNS TABLE(id uuid, is_preset boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r text;
begin
  for r in select jsonb_array_elements_text(coalesce(recips, '[]'::jsonb)) loop
    if r = 'assignee' then
      return query select p.id, true from profiles p where p.full_name = any(_abcap_assignees(t));
    elsif r = 'creator' then
      return query select p.id, true from profiles p where p.full_name = _abcap_creator(t);
    elsif r = 'admins' then
      return query select p.id, true from profiles p where p.role = 'admin';
    else
      return query select p.id, false from profiles p where p.full_name = r;
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_render_tokens(msg text, t tasks)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare out text := msg; m text; fname text; fval text;
begin
  out := replace(out, '{task}',        coalesce(t.title, ''));
  out := replace(out, '{title}',       coalesce(t.title, ''));
  out := replace(out, '{description}', coalesce(t.description, ''));
  out := replace(out, '{status}',      coalesce(t.status, ''));
  out := replace(out, '{priority}',    coalesce(t.priority, ''));
  out := replace(out, '{due_date}',    coalesce(t.due_date::text, ''));
  out := replace(out, '{assignee}',    coalesce(array_to_string(_abcap_assignees(t), ', '), ''));
  out := replace(out, '{list}',        coalesce((select name from lists where id = t.list_id), ''));
  -- Custom columns: {field:Column Name} -> the task's value for that field.
  for m in select distinct (regexp_matches(out, '\{field:([^}]+)\}', 'g'))[1] loop
    fname := btrim(m);
    select fv.value into fval
    from task_field_values fv
    join space_fields sf on sf.id = fv.field_id
    where fv.task_id = t.id and lower(sf.field_name) = lower(fname)
    limit 1;
    out := replace(out, '{field:' || m || '}', coalesce(fval, ''));
  end loop;
  return out;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_run(a automations, t tasks, actor text, event text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  act jsonb; atype text; chans jsonb; recip uuid; actor_id uuid; body_text text;
  path text := _abcap_scope_path(t.space_id, t.folder_id, t.list_id);
begin
  if actor is not null then
    select id into actor_id from profiles where full_name = actor limit 1;
  end if;

  for act in select jsonb_array_elements(a.actions) loop
    atype := act->>'type';

    if atype = 'notify' then
      chans := coalesce(act->'params'->'channels', '["in_app"]'::jsonb);
      -- Custom message if provided (with token substitution), else the
      -- auto-generated description.
      body_text := _abcap_render_tokens(
        coalesce(nullif(act->'params'->>'message',''), _abcap_notify_body(a, t)), t);
      -- Notify every configured recipient, including the person who made the
      -- change: automations are deliberate alerts (e.g. "notify the assignee
      -- when this expires"), so the assignee still needs it even if they were
      -- the actor.
      for recip in
        select distinct rr.id from _abcap_recipients2(act->'params'->'recipients', t) rr
      loop
        if chans ? 'in_app' then
          insert into notifications(user_id, task_id, type, title, body, link_scope)
          values (recip, t.id, 'automation',
                  coalesce(nullif(t.title,''), 'Task'),
                  body_text,
                  jsonb_build_object('space_id', t.space_id, 'folder_id', t.folder_id,
                                     'list_id', t.list_id, 'path', path));
        end if;
        if chans ? 'email' then
          insert into automation_email_queue(user_id, task_id, automation_id, subject, body)
          values (recip, t.id, a.id,
                  coalesce(nullif(t.title,''), 'AB Capital') || ' — ' || coalesce(nullif(a.name,''), 'Automation'),
                  body_text || E'\n\n(' || coalesce(path,'') || ')');
        end if;
      end loop;

    elsif atype = 'change_status' then
      perform set_config('abcap.in_automation','1', true);
      update tasks set status = act->'params'->>'to', updated_at = now() where id = t.id;

    elsif atype = 'assign' then
      perform set_config('abcap.in_automation','1', true);
      if coalesce(act->'params'->>'user','') <> '' then
        perform _abcap_add_assignee(t.id, act->'params'->>'user');
      end if;

    elsif atype = 'set_field' then
      if coalesce(act->'params'->>'field','') <> '' then
        perform _abcap_set_field(t, act->'params'->>'field', act->'params'->>'value');
      end if;

    elsif atype = 'shift_date' then
      if coalesce(act->'params'->>'field','') <> '' then
        perform _abcap_shift_date(
          t,
          act->'params'->>'field',
          coalesce(nullif(act->'params'->>'months','')::int, 3),
          nullif(act->'params'->>'day','')::int
        );
      end if;

    elsif atype = 'mirror_to_list' then
      perform _abcap_mirror_to_list(t, act->'params');

    elsif atype = 'clone_to' then
      perform _abcap_clone_to(t, act->'params');
    end if;
  end loop;

  insert into automation_runs(automation_id, task_id, event, detail)
  values (a.id, t.id, event, jsonb_build_object('actor', actor));
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_scope_path(sid uuid, fid uuid, lid uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select nullif(array_to_string(array_remove(array[
    (select name from spaces  where id = sid),
    (select name from folders where id = fid),
    (select name from lists   where id = lid)
  ], null), ' / '), '');
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_set_field(t tasks, field text, val text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid uuid;
begin
  perform set_config('abcap.in_automation','1', true);  -- suppress re-entry
  if field = 'status' then
    update tasks set status = val, updated_at = now() where id = t.id;
  elsif field = 'priority' then
    update tasks set priority = val, updated_at = now() where id = t.id;
  elsif field = 'due_date' then
    update tasks set due_date = nullif(val,'')::date, updated_at = now() where id = t.id;
  elsif field like 'field\_%' then
    begin fid := substring(field from 7)::uuid; exception when others then return; end;
    update task_field_values set value = val where task_id = t.id and field_id = fid;
    if not found then
      insert into task_field_values(task_id, field_id, value) values (t.id, fid, val);
    end if;
  end if;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_shift_date(t tasks, field text, months integer, day integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare fid uuid; base_date date; new_date date; last_day int;
begin
  if field = 'due_date' then
    base_date := t.due_date;
  elsif field like 'field\_%' then
    begin fid := substring(field from 7)::uuid; exception when others then return; end;
    select nullif(value,'')::date into base_date
      from task_field_values where task_id = t.id and field_id = fid limit 1;
  else
    return;
  end if;
  if base_date is null then base_date := current_date; end if;
  new_date := (base_date + make_interval(0, coalesce(months,0)))::date;
  if day is not null then
    -- last day of new_date's month
    last_day := extract(day from
      (date_trunc('month', new_date::timestamp) + interval '1 month' - interval '1 day'))::int;
    new_date := make_date(extract(year from new_date)::int,
                          extract(month from new_date)::int,
                          least(day, last_day));
  end if;
  perform _abcap_set_field(t, field, to_char(new_date, 'YYYY-MM-DD'));
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_snapshot_quotation_template()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  insert into quotation_template_history
    (template_id, freezone, fields, usd_rate, file_name, storage_path, action, changed_by, changed_at)
  values (
    new.id, new.freezone, new.fields, new.usd_rate, new.file_name, new.storage_path,
    case
      when tg_op = 'INSERT' then 'insert'
      when new.deleted_at is not null and old.deleted_at is null then 'delete'
      else 'update'
    end,
    new.updated_by, coalesce(new.updated_at, now())
  );
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_status_open(s text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select s is not null and lower(s) !~ 'done|complete|cancel|closed|reject';
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_task_comments_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t tasks; actor text;
begin
  select * into t from tasks where id = NEW.task_id;
  if not found then return null; end if;
  select full_name into actor from profiles where id = NEW.profile_id;
  perform _abcap_dispatch(t, 'comment_mention', null, actor);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_task_complete(p_status text, p_space uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  select coalesce(
    (select case when ss.is_complete is not null then ss.is_complete
                 else lower(ss.name) ~ 'done|complete|closed' end
       from space_statuses ss
      where ss.space_id = p_space and ss.name = p_status
      order by ss.is_complete desc nulls last
      limit 1),
    (p_status is not null and lower(p_status) ~ 'done|complete|closed')
  );
$function$
;

CREATE OR REPLACE FUNCTION public._abcap_task_field_values_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t tasks;
begin
  if current_setting('abcap.in_automation', true) = '1' then return null; end if;
  if TG_OP = 'UPDATE' and NEW.value is not distinct from OLD.value then return null; end if;
  select * into t from tasks where id = NEW.task_id;
  if not found then return null; end if;
  perform _abcap_dispatch(t, 'field_changed', 'field_' || NEW.field_id::text, t.updated_by);
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_tasks_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('abcap.in_automation', true) = '1' then return null; end if;

  if TG_OP = 'INSERT' then
    perform _abcap_dispatch(NEW, 'task_created', null, NEW.updated_by);
    if array_length(_abcap_assignees(NEW), 1) is not null then
      perform _abcap_dispatch(NEW, 'assigned', null, NEW.updated_by);
    end if;
  else -- UPDATE
    if NEW.status is distinct from OLD.status then
      perform _abcap_dispatch(NEW, 'status_changed', null, NEW.updated_by);
      perform _abcap_dispatch(NEW, 'field_changed', 'status', NEW.updated_by);
    end if;
    if NEW.priority is distinct from OLD.priority then
      perform _abcap_dispatch(NEW, 'field_changed', 'priority', NEW.updated_by);
    end if;
    if NEW.due_date is distinct from OLD.due_date then
      perform _abcap_dispatch(NEW, 'field_changed', 'due_date', NEW.updated_by);
    end if;
    -- newly-added assignee(s)
    if exists (select 1 from unnest(_abcap_assignees(NEW)) n
                where n <> all(_abcap_assignees(OLD))) then
      perform _abcap_dispatch(NEW, 'assigned', null, NEW.updated_by);
      perform _abcap_dispatch(NEW, 'field_changed', 'assignee', NEW.updated_by);
    end if;
  end if;
  return null;
end $function$
;

CREATE OR REPLACE FUNCTION public._abcap_trigger_label(ttype text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case ttype
    when 'assigned'        then 'a task was assigned'
    when 'status_changed'  then 'a status changed'
    when 'field_changed'   then 'a field changed'
    when 'comment_mention' then 'a new comment'
    when 'date_based'      then 'a date rule'
    when 'recurring'       then 'a recurring reminder'
    when 'task_created'    then 'a task was created'
    when 'any_change'      then 'a change'
    else ttype end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_usage_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  result jsonb;
  v_db_size    bigint;
  v_store_size bigint;
begin
  -- Admin gate.
  if not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') then
    raise exception 'Not authorized';
  end if;

  select pg_database_size(current_database()) into v_db_size;

  -- Sum of stored object sizes across all buckets (bytes).
  begin
    select coalesce(sum((metadata->>'size')::bigint), 0)
      into v_store_size
      from storage.objects;
  exception when others then
    v_store_size := null;  -- storage schema not reachable
  end;

  select jsonb_build_object(
    'emails_sent_total',  (select count(*) from automation_email_queue where status = 'sent'),
    'emails_sent_30d',    (select count(*) from automation_email_queue where status = 'sent' and sent_at >= now() - interval '30 days'),
    'emails_pending',     (select count(*) from automation_email_queue where status = 'pending'),
    'emails_failed',      (select count(*) from automation_email_queue where status = 'error'),
    'emails_queued_total',(select count(*) from automation_email_queue),
    'last_email_sent_at', (select max(sent_at) from automation_email_queue where status = 'sent'),
    'db_size_bytes',      v_db_size,
    'storage_size_bytes', v_store_size,
    'generated_at',       now()
  ) into result;

  return result;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.assignee_tasks(p_name text, p_space uuid DEFAULT NULL::uuid, p_folder uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, title text, status text, priority text, due_date date, space_id uuid, folder_id uuid, list_id uuid, space_name text, list_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.title, t.status, t.priority, t.due_date,
         t.space_id, t.folder_id, t.list_id, s.name, l.name
  from tasks t
  left join spaces s on s.id = t.space_id
  left join lists  l on l.id = t.list_id
  where t.deleted_at is null
    and p_name = any(t.assignees)
    and (p_space is null or t.space_id = p_space)
    and (p_folder is null or t.folder_id = p_folder)
  order by (t.due_date is null), t.due_date;
$function$
;

CREATE OR REPLACE FUNCTION public.assignee_tasks(p_name text)
 RETURNS TABLE(id uuid, title text, status text, priority text, due_date date, space_id uuid, folder_id uuid, list_id uuid, space_name text, list_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.title, t.status, t.priority, t.due_date,
         t.space_id, t.folder_id, t.list_id, s.name, l.name
  from tasks t
  left join spaces s on s.id = t.space_id
  left join lists  l on l.id = t.list_id
  where t.deleted_at is null
    and p_name = any(t.assignees)
  order by (t.due_date is null), t.due_date;
$function$
;

CREATE OR REPLACE FUNCTION public.ceo_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  with
  -- Lead pipelines = lists that have a created_time field (same set as the
  -- Monthly Lead Report). A lead is "converted" when its status is Converted.
  lead_lists as (
    select distinct list_id from space_fields
    where lower(field_name) = 'created_time' and list_id is not null
  ),
  lt as (
    select t.id, t.status,
      (select _abcap_parse_date(tfv.value)
         from task_field_values tfv
         join space_fields sf on sf.id = tfv.field_id
        where tfv.task_id = t.id and sf.list_id = t.list_id and lower(sf.field_name) = 'created_time'
        order by tfv.id limit 1) as cdate
    from tasks t
    join lead_lists ll on ll.list_id = t.list_id
    where t.deleted_at is null
  ),
  leads_agg as (
    select count(*) total, count(*) filter (where lower(status) = 'converted') converted from lt
  ),
  by_month as (
    select to_char(date_trunc('month', cdate), 'YYYY-MM') ym,
           count(*) leads,
           count(*) filter (where lower(status) = 'converted') converted
    from lt
    where cdate is not null and cdate >= date_trunc('month', current_date) - interval '5 months'
    group by 1 order by 1
  ),
  -- Renewal/expiry risk: date fields whose NAME looks like a renewal date.
  exp_fields as (
    select sf.id as field_id, sf.field_name, l.name as list_name
    from space_fields sf
    join lists l on l.id = sf.list_id and l.deleted_at is null
    where sf.field_type = 'date'
      and sf.field_name ~* 'expiry|expire|licen|visa|renew|tenancy|e-?jari|permit'
  ),
  exp_clean as (
    select t.id as task_id, t.title, t.space_id, t.folder_id, t.list_id,
           ef.list_name, ef.field_name,
           _abcap_parse_date(tfv.value) as edate
    from exp_fields ef
    join task_field_values tfv on tfv.field_id = ef.field_id
    join tasks t on t.id = tfv.task_id and t.deleted_at is null
    where _abcap_parse_date(tfv.value) is not null
  )
  select jsonb_build_object(
    'leads', jsonb_build_object(
      'total', (select total from leads_agg),
      'converted', (select converted from leads_agg),
      'by_month', coalesce((select jsonb_agg(jsonb_build_object('ym', ym, 'leads', leads, 'converted', converted)) from by_month), '[]'::jsonb)
    ),
    'renewals', jsonb_build_object(
      'overdue', (select count(*) from exp_clean where edate < current_date),
      'd30', (select count(*) from exp_clean where edate >= current_date and edate < current_date + 30),
      'd60', (select count(*) from exp_clean where edate >= current_date + 30 and edate < current_date + 60),
      'd90', (select count(*) from exp_clean where edate >= current_date + 60 and edate < current_date + 90),
      'soon', coalesce((select jsonb_agg(x order by (x->>'days_left')::int) from (
        select jsonb_build_object(
          'task_id', task_id, 'title', title, 'list', list_name, 'field', field_name,
          'space_id', space_id, 'folder_id', folder_id, 'list_id', list_id,
          'date', to_char(edate, 'YYYY-MM-DD'), 'days_left', (edate - current_date)
        ) x
        from exp_clean
        where edate >= current_date and edate < current_date + 90
        order by edate asc limit 30
      ) s), '[]'::jsonb)
    )
  ) into res;
  return res;
end $function$
;

CREATE OR REPLACE FUNCTION public.dashboard_drilldown(p_metric text, p_space uuid DEFAULT NULL::uuid, p_folder uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare res jsonb;
begin
  -- Renewal/expiry buckets (from expiry-type date fields).
  if p_metric in ('renewals_overdue', 'renewals_30', 'renewals_90') then
    select coalesce(jsonb_agg(x order by (x->>'due')), '[]'::jsonb) into res from (
      select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
               'space_id', t.space_id, 'folder_id', t.folder_id, 'list_id', t.list_id,
               'sub', sf.field_name, 'due', to_char(_abcap_parse_date(tfv.value), 'YYYY-MM-DD')) x
      from space_fields sf
      join task_field_values tfv on tfv.field_id = sf.id
      join tasks t on t.id = tfv.task_id and t.deleted_at is null
      where sf.field_type = 'date'
        and sf.field_name ~* 'expiry|expire|licen|visa|renew|tenancy|e-?jari|permit'
        and _abcap_parse_date(tfv.value) is not null
        and (p_space is null or t.space_id = p_space)
        and (p_folder is null or t.folder_id = p_folder)
        and case p_metric
              when 'renewals_overdue' then _abcap_parse_date(tfv.value) < current_date
              when 'renewals_30' then _abcap_parse_date(tfv.value) >= current_date and _abcap_parse_date(tfv.value) < current_date + 30
              when 'renewals_90' then _abcap_parse_date(tfv.value) >= current_date and _abcap_parse_date(tfv.value) < current_date + 90
            end
      order by _abcap_parse_date(tfv.value)
      limit p_limit
    ) s;
    return res;
  end if;

  -- Lead pipeline / converted (lead lists = lists with a created_time field).
  if p_metric in ('leads', 'converted') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('id', t.id, 'title', t.title, 'status', t.status,
               'space_id', t.space_id, 'folder_id', t.folder_id, 'list_id', t.list_id,
               'due', to_char(t.due_date, 'YYYY-MM-DD')) x
      from tasks t
      where t.deleted_at is null
        and t.list_id in (select distinct list_id from space_fields where lower(field_name) = 'created_time' and list_id is not null)
        and (p_space is null or t.space_id = p_space)
        and (p_folder is null or t.folder_id = p_folder)
        and (p_metric <> 'converted' or lower(t.status) = 'converted')
      limit p_limit
    ) s;
    return res;
  end if;

  -- Tasks with a specific status (donut slice). p_metric = 'status:<name>'.
  if p_metric like 'status:%' then
    declare v_status text := substring(p_metric from 8);
    begin
      select coalesce(jsonb_agg(x order by (x->>'due')), '[]'::jsonb) into res from (
        select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
                 'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
                 'due', to_char(tk.due_date, 'YYYY-MM-DD')) x
        from tasks tk
        where tk.deleted_at is null and (p_space is null or tk.space_id = p_space)
          and (p_folder is null or tk.folder_id = p_folder)
          and (case when v_status = '(no status)' then coalesce(nullif(tk.status, ''), '(no status)') else tk.status end) = v_status
        order by tk.due_date nulls last
        limit p_limit
      ) s;
      return res;
    end;
  end if;

  -- Velocity: created / completed in the last 30 days.
  if p_metric in ('created_30d', 'completed_30d') then
    select coalesce(jsonb_agg(x), '[]'::jsonb) into res from (
      select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
               'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
               'due', to_char(tk.due_date, 'YYYY-MM-DD')) x
      from tasks tk
      where tk.deleted_at is null and (p_space is null or tk.space_id = p_space)
        and (p_folder is null or tk.folder_id = p_folder)
        and case p_metric
              when 'created_30d' then tk.created_at >= now() - interval '30 days'
              when 'completed_30d' then (tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}'
                                         and substring(tk.date_done::text, 1, 10)::date >= current_date - 30)
            end
      order by tk.created_at desc
      limit p_limit
    ) s;
    return res;
  end if;

  -- Generic task-status/date metrics.
  select coalesce(jsonb_agg(x order by due_date nulls last), '[]'::jsonb) into res from (
    select jsonb_build_object('id', tk.id, 'title', tk.title, 'status', tk.status,
             'space_id', tk.space_id, 'folder_id', tk.folder_id, 'list_id', tk.list_id,
             'due', to_char(tk.due_date, 'YYYY-MM-DD')) x,
           tk.due_date
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null
      and (p_space is null or tk.space_id = p_space)
      and (p_folder is null or tk.folder_id = p_folder)
      and case p_metric
        when 'total' then true
        when 'done' then tk.status = 'Done'
        when 'completed' then coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed'))
        when 'closed' then not (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'in_progress' then tk.status = 'In Progress'
        when 'open' then (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'urgent' then tk.priority = 'High' and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'overdue' then tk.due_date < current_date and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'due_7d' then tk.due_date >= current_date and tk.due_date < current_date + 7 and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        when 'due_30d' then tk.due_date >= current_date and tk.due_date < current_date + 30 and (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject')
        else false
      end
    order by tk.due_date nulls last
    limit p_limit
  ) s;
  return res;
end $function$
;

CREATE OR REPLACE FUNCTION public.dashboard_overview()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- Compute is_open / is_completed / done_dt ONCE per task here (single lateral
  -- to space_statuses), trimmed to needed columns. All aggregates below then
  -- read these columns instead of calling per-row functions thousands of times.
  with t as (
    select tk.id, tk.title, tk.status, tk.priority, tk.due_date, tk.created_at,
           tk.updated_at, tk.date_done, tk.list_id, tk.space_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null
  )
  select jsonb_build_object(
    'total',       (select count(*) from t),
    'done',        (select count(*) filter (where status = 'Done') from t),
    'completed',   (select count(*) filter (where is_completed) from t),
    'closed',      (select count(*) filter (where not is_open) from t),
    'in_progress', (select count(*) filter (where status = 'In Progress') from t),
    'open',        (select count(*) filter (where is_open) from t),
    'urgent',      (select count(*) filter (where priority = 'High' and is_open) from t),
    'overdue',     (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_7d',      (select count(*) filter (where due_date >= current_date and due_date < current_date + 7  and is_open) from t),
    'due_30d',     (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d',     (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'created_30d',      (select count(*) filter (where created_at >= now() - interval '30 days') from t),
    'created_prev_30d', (select count(*) filter (where created_at >= now() - interval '60 days' and created_at < now() - interval '30 days') from t),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'overdue_0_7',   (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30',  (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',   (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'oldest_overdue_days', (select coalesce(max(current_date - due_date), 0) from t where is_open and due_date < current_date),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else
                         round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'by_status',   (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                      from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_space',    (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                      select jsonb_build_object(
                        'space_id', sp.id, 'name', sp.name,
                        'total',   count(tt.id),
                        'open',    count(tt.id) filter (where tt.is_open),
                        'done',    count(tt.id) filter (where tt.status = 'Done'),
                        'completed', count(tt.id) filter (where tt.is_completed),
                        'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)
                      ) as row
                      from spaces sp left join t tt on tt.space_id = sp.id
                      where sp.deleted_at is null group by sp.id, sp.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name,
                        count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 12) y),
    'trend',       (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'created', cr, 'completed', cp) order by m), '[]'::jsonb) from (
                      select to_char(d, 'YYYY-MM') as m,
                        (select count(*) from t where to_char(created_at, 'YYYY-MM') = to_char(d, 'YYYY-MM')) as cr,
                        (select count(*) from t where done_dt is not null and to_char(done_dt, 'YYYY-MM') = to_char(d, 'YYYY-MM')) as cp
                      from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') d) z),
    'attention', jsonb_build_object(
      'top_overdue', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'list_id', list_id, 'space_id', space_id, 'days', current_date - due_date) order by due_date), '[]'::jsonb)
                        from (select id, title, due_date, list_id, space_id from t where is_open and due_date < current_date order by due_date limit 6) r),
      'stuck',       (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'list_id', list_id, 'space_id', space_id, 'days', (current_date - updated_at::date)) order by updated_at), '[]'::jsonb)
                        from (select id, title, status, list_id, space_id, updated_at from t where is_open and updated_at < now() - interval '30 days' order by updated_at limit 6) r),
      'unassigned_high', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'list_id', list_id, 'space_id', space_id) order by created_at), '[]'::jsonb)
                        from (select id, title, list_id, space_id, created_at from t where priority = 'High' and is_open and coalesce(cardinality(assignees), 0) = 0 order by created_at limit 6) r)
    )
  );
$function$
;

CREATE OR REPLACE FUNCTION public.folder_overview(p_folder_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (
    select tk.id, tk.title, tk.status, tk.due_date, tk.created_at, tk.date_done,
           tk.list_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null and tk.folder_id = p_folder_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from t),
    'open',    (select count(*) filter (where is_open) from t),
    'done',    (select count(*) filter (where status = 'Done') from t),
    'completed', (select count(*) filter (where is_completed) from t),
    'overdue', (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_30d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'overdue_0_7',  (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30', (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',  (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                    from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_list', (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                  select jsonb_build_object('folder_id', f.id, 'folder', f.name, 'list_id', l.id, 'list', l.name,
                    'total', count(tt.id), 'done', count(tt.id) filter (where tt.status = 'Done'),
                    'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)) as row
                  from lists l join folders f on f.id = l.folder_id
                  left join t tt on tt.list_id = l.id
                  where l.folder_id = p_folder_id and l.deleted_at is null and f.deleted_at is null
                  group by f.id, f.name, l.id, l.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name, count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 10) y),
    'at_risk', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'status', status, 'list_id', list_id) order by due_date), '[]'::jsonb)
                  from (select id, title, due_date, status, list_id from t
                        where due_date is not null and due_date < current_date + 30 and is_open
                        order by due_date limit 40) r)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    'member'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.lead_monthly_report(p_list_id uuid)
 RETURNS TABLE(ym text, status text, cnt bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Compute ONE created_time month per task in a single pass (DISTINCT ON),
  -- then left-join. This replaces a per-task LATERAL that timed out on large
  -- lists, and still counts each task once regardless of duplicate value rows.
  with ct as (
    select distinct on (tfv.task_id)
           tfv.task_id,
           case
             -- ISO (yyyy-mm-dd / yyyy-mm-ddT..): take year-month directly.
             when tfv.value ~ '^\d{4}-\d{2}' then substr(tfv.value, 1, 7)
             -- Day-first dd[-/]mm[-/]yyyy (legacy raw sheet values): reorder to
             -- YYYY-MM so they bucket into the right month instead of Undated.
             when tfv.value ~ '^\d{1,2}[-/]\d{1,2}[-/]\d{4}$'
               then to_char(
                 to_date(regexp_replace(tfv.value, '^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$', '\1-\2-\3'), 'DD-MM-YYYY'),
                 'YYYY-MM')
             else null
           end as ym
    from task_field_values tfv
    join space_fields sf on sf.id = tfv.field_id
    where sf.list_id = p_list_id and lower(sf.field_name) = 'created_time'
    order by tfv.task_id, tfv.value desc nulls last
  )
  select
    coalesce(ct.ym, 'Undated') as ym,
    coalesce(nullif(t.status, ''), 'No status') as status,
    count(*)::bigint
  from tasks t
  left join ct on ct.task_id = t.id
  where t.list_id = p_list_id and t.deleted_at is null
  group by 1, 2;
$function$
;

CREATE OR REPLACE FUNCTION public.reassign_assignee(p_from text, p_to text, p_task_ids uuid[] DEFAULT NULL::uuid[], p_actor text DEFAULT 'System'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; n int := 0; new_as text[];
begin
  if coalesce(p_from, '') = '' then return 0; end if;
  for r in
    select id, assignees from tasks
    where deleted_at is null
      and p_from = any(assignees)
      and (p_task_ids is null or id = any(p_task_ids))
  loop
    if coalesce(p_to, '') = '' then
      new_as := array_remove(r.assignees, p_from);
    else
      -- replace then de-duplicate (so we don't double-add an existing member)
      select array_agg(distinct x) into new_as
      from unnest(array_replace(r.assignees, p_from, p_to)) x;
    end if;
    update tasks
      set assignees  = new_as,
          assignee   = coalesce(new_as[1], ''),
          updated_by = p_actor,
          updated_at = now()
      where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_clone_actions(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t tasks; a automations; act jsonb;
begin
  select * into t from tasks where id = p_task_id and deleted_at is null;
  if not found then return; end if;
  for a in
    select * from automations
     where enabled
       and ((scope_type = 'list'   and scope_id = t.list_id)
         or (scope_type = 'folder' and scope_id = t.folder_id)
         or (scope_type = 'space'  and scope_id = t.space_id))
       and trigger->>'type' in ('task_created', 'any_change')
  loop
    if _abcap_eval_conditions(a.conditions, t, coalesce(a.conditions_match, 'all')) then
      for act in select jsonb_array_elements(a.actions) loop
        if act->>'type' = 'clone_to' then
          perform _abcap_clone_to(t, act->'params');
        end if;
      end loop;
    end if;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.run_date_based_automations()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a automations; t tasks; dir text; days int; fld text; target date; dval text; dd date; last_run timestamptz;
begin
  -- Date-based rules: fire once when a date field is N days before/after today.
  for a in select * from automations where enabled and trigger->>'type' = 'date_based' loop
    dir  := coalesce(a.trigger->'params'->>'direction', 'before');
    days := coalesce((a.trigger->'params'->>'days')::int, 0);
    fld  := coalesce(a.trigger->'params'->>'field', 'due_date');
    target := case dir when 'after' then current_date - days else current_date + days end;

    for t in
      select * from tasks
       where deleted_at is null
         and ((a.scope_type = 'list'   and list_id   = a.scope_id)
           or (a.scope_type = 'folder' and folder_id = a.scope_id)
           or (a.scope_type = 'space'  and space_id  = a.scope_id))
    loop
      dval := _abcap_field_value(t, fld);
      if dval is null or dval = '' then continue; end if;
      begin dd := dval::date; exception when others then continue; end;
      if dd = target and _abcap_eval_conditions(a.conditions, t, coalesce(a.conditions_match, 'all')) then
        perform _abcap_run(a, t, null, 'date_based');
      end if;
    end loop;
  end loop;

  -- Recurring reminders: while the conditions hold, re-run every N days.
  -- Uses automation_runs (event='recurring') to space out reminders per task.
  for a in select * from automations where enabled and trigger->>'type' = 'recurring' loop
    days := greatest(coalesce((a.trigger->'params'->>'days')::int, 3), 1);

    for t in
      select * from tasks
       where deleted_at is null
         and ((a.scope_type = 'list'   and list_id   = a.scope_id)
           or (a.scope_type = 'folder' and folder_id = a.scope_id)
           or (a.scope_type = 'space'  and space_id  = a.scope_id))
    loop
      if not _abcap_eval_conditions(a.conditions, t, coalesce(a.conditions_match, 'all')) then continue; end if;
      select max(ran_at) into last_run
        from automation_runs
       where automation_id = a.id and task_id = t.id and event = 'recurring';
      if last_run is null or last_run <= now() - make_interval(days => days) then
        perform _abcap_run(a, t, null, 'recurring');
      end if;
    end loop;
  end loop;
end $function$
;

CREATE OR REPLACE FUNCTION public.space_overview(p_space_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with t as (
    select tk.id, tk.title, tk.status, tk.due_date, tk.created_at, tk.date_done,
           tk.list_id, tk.assignees,
           (tk.status is not null and lower(tk.status) !~ 'done|complete|cancel|closed|reject') as is_open,
           coalesce(cs.complete, (tk.status is not null and lower(tk.status) ~ 'done|complete|closed')) as is_completed,
           case when tk.date_done::text ~ '^\d{4}-\d{2}-\d{2}' then substring(tk.date_done::text, 1, 10)::date end as done_dt
    from tasks tk
    left join lateral (
      select coalesce(ss.is_complete, lower(ss.name) ~ 'done|complete|closed') as complete
      from space_statuses ss
      where ss.space_id = tk.space_id and ss.name = tk.status
      order by ss.is_complete desc nulls last limit 1
    ) cs on true
    where tk.deleted_at is null and tk.space_id = p_space_id
  )
  select jsonb_build_object(
    'total',   (select count(*) from t),
    'open',    (select count(*) filter (where is_open) from t),
    'done',    (select count(*) filter (where status = 'Done') from t),
    'completed', (select count(*) filter (where is_completed) from t),
    'overdue', (select count(*) filter (where due_date < current_date and is_open) from t),
    'due_30d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 30 and is_open) from t),
    'due_90d', (select count(*) filter (where due_date >= current_date and due_date < current_date + 90 and is_open) from t),
    'overdue_0_7',  (select count(*) filter (where is_open and due_date >= current_date - 7  and due_date < current_date) from t),
    'overdue_8_30', (select count(*) filter (where is_open and due_date >= current_date - 30 and due_date < current_date - 7) from t),
    'overdue_30p',  (select count(*) filter (where is_open and due_date < current_date - 30) from t),
    'cycle_time_avg', (select round(avg(done_dt - created_at::date), 1) from t where done_dt >= current_date - 90),
    'on_time_pct',    (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where done_dt <= due_date) / count(*), 0) end
                         from t where done_dt >= current_date - 90 and due_date is not null),
    'completed_30d',      (select count(*) filter (where done_dt >= current_date - 30) from t),
    'completed_prev_30d', (select count(*) filter (where done_dt >= current_date - 60 and done_dt < current_date - 30) from t),
    'by_status', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'count', c) order by c desc), '[]'::jsonb)
                    from (select coalesce(nullif(status,''),'(no status)') as status, count(*) c from t group by 1) s),
    'by_list', (select coalesce(jsonb_agg(row order by (row->>'total')::int desc), '[]'::jsonb) from (
                  select jsonb_build_object('folder_id', f.id, 'folder', f.name, 'list_id', l.id, 'list', l.name,
                    'total', count(tt.id), 'done', count(tt.id) filter (where tt.status = 'Done'),
                    'overdue', count(tt.id) filter (where tt.due_date < current_date and tt.is_open)) as row
                  from lists l join folders f on f.id = l.folder_id
                  left join t tt on tt.list_id = l.id
                  where l.space_id = p_space_id and l.deleted_at is null and f.deleted_at is null
                  group by f.id, f.name, l.id, l.name) x),
    'by_assignee', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'open', open_c, 'overdue', od_c) order by open_c desc), '[]'::jsonb) from (
                      select a as name, count(*) filter (where is_open) as open_c,
                        count(*) filter (where due_date < current_date and is_open) as od_c
                      from t cross join lateral unnest(coalesce(assignees, array[]::text[])) as a
                      where a is not null and a <> '' group by a order by open_c desc limit 10) y),
    'at_risk', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due_date', due_date, 'status', status, 'list_id', list_id) order by due_date), '[]'::jsonb)
                  from (select id, title, due_date, status, list_id from t
                        where due_date is not null and due_date < current_date + 30 and is_open
                        order by due_date limit 40) r)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.task_counts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'lists', (
      select coalesce(jsonb_agg(jsonb_build_object(
                'id', list_id, 'folder_id', folder_id, 'space_id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select list_id, folder_id, space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is not null
        group by list_id, folder_id, space_id
      ) x),
    'folders', (
      select coalesce(jsonb_agg(jsonb_build_object('id', folder_id, 'space_id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select folder_id, space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is null and folder_id is not null
        group by folder_id, space_id
      ) y),
    'spaces', (
      select coalesce(jsonb_agg(jsonb_build_object('id', space_id, 'count', c)), '[]'::jsonb)
      from (
        select space_id, count(*) c
        from tasks
        where deleted_at is null and list_id is null and folder_id is null and space_id is not null
        group by space_id
      ) z)
  );
$function$
;

reset check_function_bodies;


-- ── 5. Triggers ──────────────────────────────────────────────────────

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists trg_snapshot_quotation_template on public.quotation_templates;
create trigger trg_snapshot_quotation_template after insert or update on public.quotation_templates
  for each row execute function public._abcap_snapshot_quotation_template();

drop trigger if exists trg_abcap_task_comments on public.task_comments;
create trigger trg_abcap_task_comments after insert on public.task_comments
  for each row execute function public._abcap_task_comments_trigger();

drop trigger if exists trg_abcap_log_field_change on public.task_field_values;
create trigger trg_abcap_log_field_change after insert or update on public.task_field_values
  for each row execute function public._abcap_log_field_change();

drop trigger if exists trg_abcap_task_field_values on public.task_field_values;
create trigger trg_abcap_task_field_values after insert or update on public.task_field_values
  for each row execute function public._abcap_task_field_values_trigger();

drop trigger if exists trg_abcap_log_task_change on public.tasks;
create trigger trg_abcap_log_task_change after insert or update on public.tasks
  for each row execute function public._abcap_log_task_change();

drop trigger if exists trg_abcap_tasks on public.tasks;
create trigger trg_abcap_tasks after insert or update on public.tasks
  for each row execute function public._abcap_tasks_trigger();


-- ── 6. Row Level Security (policies exactly as live) ─────────────────
-- Note: policies are OR-ed together, so the "Authenticated users full
-- access" ones make the stricter admin-only policies on the same table
-- ineffective. Kept as-is to mirror production; see security_fixes.sql.

do $$
declare t text;
begin
  foreach t in array array[
    'automation_email_queue','automation_runs','automations','folder_access','folders',
    'lists','notifications','profiles','quotation_template_history','quotation_templates',
    'space_access','space_fields','space_statuses','spaces','task_attachments',
    'task_checklist_items','task_checklists','task_comments','task_field_values',
    'task_history','task_list_views','task_wiki_links','tasks','whiteboards',
    'wiki_articles','wiki_attachments','wiki_categories','wiki_history'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- automation_email_queue / automation_runs / automations
drop policy if exists "read automation_email_queue" on public.automation_email_queue;
create policy "read automation_email_queue" on public.automation_email_queue for select to authenticated using (true);
drop policy if exists "read automation_runs" on public.automation_runs;
create policy "read automation_runs" on public.automation_runs for select to authenticated using (true);
drop policy if exists "read automations" on public.automations;
create policy "read automations" on public.automations for select to authenticated using (true);
drop policy if exists "write automations" on public.automations;
create policy "write automations" on public.automations for all to authenticated using (true) with check (true);

-- folder_access / space_access
drop policy if exists "Allow authenticated users full access" on public.folder_access;
create policy "Allow authenticated users full access" on public.folder_access for all to authenticated using (true) with check (true);
drop policy if exists "Allow authenticated users full access" on public.space_access;
create policy "Allow authenticated users full access" on public.space_access for all to authenticated using (true) with check (true);

-- folders
drop policy if exists "Admins can manage folders" on public.folders;
create policy "Admins can manage folders" on public.folders for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read folders" on public.folders;
create policy "Authenticated users can read folders" on public.folders for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.folders;
create policy "Authenticated users full access" on public.folders for all to public using (auth.role() = 'authenticated');

-- lists
drop policy if exists "Allow all for authenticated" on public.lists;
create policy "Allow all for authenticated" on public.lists for all to authenticated using (true) with check (true);

-- notifications
drop policy if exists "insert notifications" on public.notifications;
create policy "insert notifications" on public.notifications for insert to authenticated with check (true);
drop policy if exists "own notifications delete" on public.notifications;
create policy "own notifications delete" on public.notifications for delete to authenticated using (user_id = auth.uid());
drop policy if exists "own notifications select" on public.notifications;
create policy "own notifications select" on public.notifications for select to authenticated using (user_id = auth.uid());
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- profiles
drop policy if exists "Logged in users can read profiles" on public.profiles;
create policy "Logged in users can read profiles" on public.profiles for select to authenticated using (true);
drop policy if exists "Read all profiles" on public.profiles;
create policy "Read all profiles" on public.profiles for select to public using (auth.role() = 'authenticated');
drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles for update to public using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile" on public.profiles for update to authenticated using (auth.uid() = id);

-- quotation_templates / history
drop policy if exists quotation_template_history_select on public.quotation_template_history;
create policy quotation_template_history_select on public.quotation_template_history for select to authenticated using (true);
drop policy if exists quotation_templates_delete on public.quotation_templates;
create policy quotation_templates_delete on public.quotation_templates for delete to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists quotation_templates_insert on public.quotation_templates;
create policy quotation_templates_insert on public.quotation_templates for insert to authenticated
  with check (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));
drop policy if exists quotation_templates_select on public.quotation_templates;
create policy quotation_templates_select on public.quotation_templates for select to authenticated using (true);
drop policy if exists quotation_templates_update on public.quotation_templates;
create policy quotation_templates_update on public.quotation_templates for update to authenticated
  using (true)
  with check (deleted_at is null or exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- space_fields
drop policy if exists "Admins can manage space fields" on public.space_fields;
create policy "Admins can manage space fields" on public.space_fields for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read space fields" on public.space_fields;
create policy "Authenticated users can read space fields" on public.space_fields for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.space_fields;
create policy "Authenticated users full access" on public.space_fields for all to public using (auth.role() = 'authenticated');

-- space_statuses
drop policy if exists "Admins can manage space statuses" on public.space_statuses;
create policy "Admins can manage space statuses" on public.space_statuses for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read space statuses" on public.space_statuses;
create policy "Authenticated users can read space statuses" on public.space_statuses for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.space_statuses;
create policy "Authenticated users full access" on public.space_statuses for all to public using (auth.role() = 'authenticated');

-- spaces
drop policy if exists "Admins can create spaces" on public.spaces;
create policy "Admins can create spaces" on public.spaces for insert to authenticated
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can delete spaces" on public.spaces;
create policy "Admins can delete spaces" on public.spaces for delete to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can update spaces" on public.spaces;
create policy "Admins can update spaces" on public.spaces for update to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read spaces" on public.spaces;
create policy "Authenticated users can read spaces" on public.spaces for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.spaces;
create policy "Authenticated users full access" on public.spaces for all to public using (auth.role() = 'authenticated');
drop policy if exists "Only admins can delete spaces" on public.spaces;
create policy "Only admins can delete spaces" on public.spaces for delete to public
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

-- task_attachments / task_checklist_items / task_checklists / task_history / wiki_history
drop policy if exists "Authenticated users full access" on public.task_attachments;
create policy "Authenticated users full access" on public.task_attachments for all to public using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users full access" on public.task_checklist_items;
create policy "Authenticated users full access" on public.task_checklist_items for all to public using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users full access" on public.task_checklists;
create policy "Authenticated users full access" on public.task_checklists for all to public using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users full access" on public.task_history;
create policy "Authenticated users full access" on public.task_history for all to public using (auth.role() = 'authenticated');
drop policy if exists "Authenticated users full access" on public.wiki_history;
create policy "Authenticated users full access" on public.wiki_history for all to public using (auth.role() = 'authenticated');

-- task_comments
drop policy if exists "Anyone authenticated can read comments" on public.task_comments;
create policy "Anyone authenticated can read comments" on public.task_comments for select to public using (auth.role() = 'authenticated');
drop policy if exists "Users can delete their own comments" on public.task_comments;
create policy "Users can delete their own comments" on public.task_comments for delete to public using (profile_id = auth.uid());
drop policy if exists "Users can insert their own comments" on public.task_comments;
create policy "Users can insert their own comments" on public.task_comments for insert to public with check (profile_id = auth.uid());
drop policy if exists "Users can update their own comments" on public.task_comments;
create policy "Users can update their own comments" on public.task_comments for update to public using (profile_id = auth.uid());

-- task_field_values
drop policy if exists "Admins can manage field values" on public.task_field_values;
create policy "Admins can manage field values" on public.task_field_values for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users full access" on public.task_field_values;
create policy "Authenticated users full access" on public.task_field_values for all to public using (auth.role() = 'authenticated');
drop policy if exists "Members can read own task field values" on public.task_field_values;
create policy "Members can read own task field values" on public.task_field_values for select to authenticated
  using (exists (select 1 from tasks where tasks.id = task_field_values.task_id and tasks.assignee_id = auth.uid()));

-- task_list_views / task_wiki_links
drop policy if exists "All authenticated users" on public.task_list_views;
create policy "All authenticated users" on public.task_list_views for all to authenticated using (true) with check (true);
drop policy if exists "Allow all for authenticated" on public.task_wiki_links;
create policy "Allow all for authenticated" on public.task_wiki_links for all to authenticated using (true) with check (true);

-- tasks
drop policy if exists "Admins can create tasks" on public.tasks;
create policy "Admins can create tasks" on public.tasks for insert to authenticated
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can delete tasks" on public.tasks;
create policy "Admins can delete tasks" on public.tasks for delete to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can see all tasks" on public.tasks;
create policy "Admins can see all tasks" on public.tasks for select to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can update all tasks" on public.tasks;
create policy "Admins can update all tasks" on public.tasks for update to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users full access" on public.tasks;
create policy "Authenticated users full access" on public.tasks for all to public using (auth.role() = 'authenticated');
drop policy if exists "Members can see own tasks" on public.tasks;
create policy "Members can see own tasks" on public.tasks for select to authenticated using (assignee_id = auth.uid());
drop policy if exists "Members can update own task status" on public.tasks;
create policy "Members can update own task status" on public.tasks for update to authenticated using (assignee_id = auth.uid());

-- whiteboards
drop policy if exists "Allow all for authenticated" on public.whiteboards;
create policy "Allow all for authenticated" on public.whiteboards for all to public using (auth.role() = 'authenticated');

-- wiki_articles
drop policy if exists "Admins can manage wiki" on public.wiki_articles;
create policy "Admins can manage wiki" on public.wiki_articles for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can manage wiki articles" on public.wiki_articles;
create policy "Admins can manage wiki articles" on public.wiki_articles for all to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read wiki" on public.wiki_articles;
create policy "Authenticated users can read wiki" on public.wiki_articles for select to authenticated using (true);
drop policy if exists "Authenticated users can read wiki articles" on public.wiki_articles;
create policy "Authenticated users can read wiki articles" on public.wiki_articles for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.wiki_articles;
create policy "Authenticated users full access" on public.wiki_articles for all to public using (auth.role() = 'authenticated');

-- wiki_attachments
drop policy if exists "read wiki_attachments" on public.wiki_attachments;
create policy "read wiki_attachments" on public.wiki_attachments for select to authenticated using (true);
drop policy if exists "write wiki_attachments" on public.wiki_attachments;
create policy "write wiki_attachments" on public.wiki_attachments for all to authenticated using (true) with check (true);

-- wiki_categories
drop policy if exists "Admins can create wiki categories" on public.wiki_categories;
create policy "Admins can create wiki categories" on public.wiki_categories for insert to authenticated
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can delete wiki categories" on public.wiki_categories;
create policy "Admins can delete wiki categories" on public.wiki_categories for delete to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Admins can update wiki categories" on public.wiki_categories;
create policy "Admins can update wiki categories" on public.wiki_categories for update to authenticated
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
drop policy if exists "Authenticated users can read wiki categories" on public.wiki_categories;
create policy "Authenticated users can read wiki categories" on public.wiki_categories for select to authenticated using (true);
drop policy if exists "Authenticated users full access" on public.wiki_categories;
create policy "Authenticated users full access" on public.wiki_categories for all to public using (auth.role() = 'authenticated');


-- ── 7. Storage buckets (private) + policies ──────────────────────────

insert into storage.buckets (id, name, public) values
  ('quotation-templates', 'quotation-templates', false),
  ('task-attachments',    'task-attachments',    false),
  ('wiki-attachments',    'wiki-attachments',    false)
on conflict (id) do nothing;

drop policy if exists "Allow authenticated users full access 164dduw_0" on storage.objects;
create policy "Allow authenticated users full access 164dduw_0" on storage.objects for select to authenticated using (bucket_id = 'task-attachments');
drop policy if exists "Allow authenticated users full access 164dduw_1" on storage.objects;
create policy "Allow authenticated users full access 164dduw_1" on storage.objects for insert to authenticated with check (bucket_id = 'task-attachments');
drop policy if exists "Allow authenticated users full access 164dduw_2" on storage.objects;
create policy "Allow authenticated users full access 164dduw_2" on storage.objects for update to authenticated using (bucket_id = 'task-attachments');
drop policy if exists "Allow authenticated users full access 164dduw_3" on storage.objects;
create policy "Allow authenticated users full access 164dduw_3" on storage.objects for delete to authenticated using (bucket_id = 'task-attachments');

drop policy if exists quotation_templates_read on storage.objects;
create policy quotation_templates_read on storage.objects for select to authenticated using (bucket_id = 'quotation-templates');
drop policy if exists quotation_templates_write on storage.objects;
create policy quotation_templates_write on storage.objects for all to authenticated
  using (bucket_id = 'quotation-templates' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (bucket_id = 'quotation-templates' and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists "wiki-attachments delete" on storage.objects;
create policy "wiki-attachments delete" on storage.objects for delete to authenticated using (bucket_id = 'wiki-attachments');
drop policy if exists "wiki-attachments insert" on storage.objects;
create policy "wiki-attachments insert" on storage.objects for insert to authenticated with check (bucket_id = 'wiki-attachments');
drop policy if exists "wiki-attachments read" on storage.objects;
create policy "wiki-attachments read" on storage.objects for select to authenticated using (bucket_id = 'wiki-attachments');


-- ── 8. Realtime ──────────────────────────────────────────────────────

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


-- ── 9. Scheduled jobs (pg_cron) ──────────────────────────────────────
-- The email-sender job (every minute) is NOT recreated here because it
-- carries a webhook secret: set it up with db/phase4_email_cron.sql after
-- deploying the send-automation-emails edge function.

select cron.unschedule(jobname) from cron.job
 where jobname in ('purge-old-notifications', 'abcap-date-automations');

select cron.schedule('purge-old-notifications', '0 3 * * *', $cron$
  delete from notifications
   where read = true
     and created_at < now() - interval '30 days';
$cron$);

select cron.schedule('abcap-date-automations', '0 6 * * *',
  'select run_date_based_automations()');
