-- =====================================================================
-- Improvements Base - staff suggestions to the admin                 001
-- =====================================================================
-- Every signed-in member can write an improvement (idea, problem or request) with screenshots.
-- A member sees only their own; an admin sees all and sets the status and a reply.
-- Screenshots sit in the private "improvements" bucket at <user id>/<improvement id>/<uuid>-<file name>
-- and open only through short-lived signed URLs. Runs more than once safely.
-- =====================================================================

create table if not exists public.improvement_requests (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid(),
  author_name text,
  category text not null default 'idea' check (category in ('idea', 'problem', 'request', 'other')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  details text not null default '' check (char_length(details) <= 10000),
  -- [{ "path": "...", "name": "...", "type": "image/png", "size": 1234 }]
  attachments jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10),
  status text not null default 'new' check (status in ('new', 'seen', 'planned', 'done', 'declined')),
  admin_reply text check (char_length(admin_reply) <= 5000),
  replied_by uuid,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists improvement_requests_created_by_idx on public.improvement_requests (created_by, created_at desc);
create index if not exists improvement_requests_status_idx on public.improvement_requests (status, created_at desc);

-- New rows: the writer is always the caller, and only the admin fields' defaults apply.
-- Updates: stamps who replied and when the reply or status changed.
create or replace function public.improvement_requests_stamp()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.author_name := (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = new.created_by);
    new.status := 'new';
    new.admin_reply := null;
    new.replied_by := null;
    new.replied_at := null;
    new.created_at := now();
    -- Each screenshot must sit in the writer's own folder for this improvement.
    if exists (
      select 1 from jsonb_array_elements(new.attachments) a
      where jsonb_typeof(a) <> 'object' or coalesce(a->>'path', '') not like new.created_by::text || '/' || new.id::text || '/%'
    ) then
      raise exception 'Each screenshot must be uploaded to this improvement''s folder';
    end if;
  else
    if new.admin_reply is distinct from old.admin_reply or new.status is distinct from old.status then
      new.replied_by := auth.uid();
      new.replied_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists improvement_requests_stamp on public.improvement_requests;
create trigger improvement_requests_stamp before insert or update on public.improvement_requests
  for each row execute function public.improvement_requests_stamp();

alter table public.improvement_requests enable row level security;
revoke all on public.improvement_requests from public, anon, authenticated;
grant select, delete on public.improvement_requests to authenticated;
grant insert (id, category, title, details, attachments) on public.improvement_requests to authenticated;
grant update (status, admin_reply) on public.improvement_requests to authenticated;

drop policy if exists improvement_requests_read on public.improvement_requests;
create policy improvement_requests_read on public.improvement_requests for select to authenticated
  using (created_by = auth.uid() or public.admin_is());
drop policy if exists improvement_requests_insert on public.improvement_requests;
create policy improvement_requests_insert on public.improvement_requests for insert to authenticated
  with check (auth.uid() is not null and created_by = auth.uid());
drop policy if exists improvement_requests_update on public.improvement_requests;
create policy improvement_requests_update on public.improvement_requests for update to authenticated
  using (public.admin_is()) with check (public.admin_is());
-- The writer may withdraw an improvement the admin has not looked at yet; an admin may remove any.
drop policy if exists improvement_requests_delete on public.improvement_requests;
create policy improvement_requests_delete on public.improvement_requests for delete to authenticated
  using (public.admin_is() or (created_by = auth.uid() and status = 'new'));

-- Private screenshot storage. Skipped on plain PostgreSQL (local tests).
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: skipped';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('improvements', 'improvements', false, 10485760, array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

  drop policy if exists improvements_files_read on storage.objects;
  create policy improvements_files_read on storage.objects for select to authenticated
    using (bucket_id = 'improvements' and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_is()));
  drop policy if exists improvements_files_insert on storage.objects;
  create policy improvements_files_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'improvements' and (storage.foldername(name))[1] = auth.uid()::text);
  drop policy if exists improvements_files_delete on storage.objects;
  create policy improvements_files_delete on storage.objects for delete to authenticated
    using (bucket_id = 'improvements' and ((storage.foldername(name))[1] = auth.uid()::text or public.admin_is()));
end $do$;
