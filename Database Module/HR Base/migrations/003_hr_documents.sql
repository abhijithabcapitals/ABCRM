-- =====================================================================
-- HR Base - employee documents                                     003
-- =====================================================================
-- Visa, passport, Emirates ID, labour card and similar, with expiry dates, and a private storage bucket for the files.
-- HR and admin: everything. An employee reads their own rows and files and may add their own, never change or remove.
-- Managers: nothing about their reports, only their own like any employee. Bucket path: <employee id>/<uuid>-<file name>. Storage part is skipped on plain PostgreSQL. Idempotent.
-- Requires 002 (hr_is_admin_or_hr, hr_my_employee_id).
-- =====================================================================
create table if not exists public.hr_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.hr_employees(id) on delete cascade,
  doc_type text not null,
  doc_number text,
  issue_date date,
  expiry_date date,
  storage_path text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists hr_documents_employee_idx on public.hr_documents (employee_id);
create index if not exists hr_documents_expiry_idx on public.hr_documents (expiry_date);

-- Keeps updated_at and updated_by honest on every change. Later HR tables reuse it.
create or replace function public.hr_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists hr_documents_touch on public.hr_documents;
create trigger hr_documents_touch before update on public.hr_documents
  for each row execute function public.hr_touch();

alter table public.hr_documents enable row level security;
revoke all on public.hr_documents from public, anon, authenticated;
grant select, insert, update, delete on public.hr_documents to authenticated;

drop policy if exists hr_documents_hr on public.hr_documents;
create policy hr_documents_hr on public.hr_documents for all to authenticated
  using (public.hr_is_admin_or_hr()) with check (public.hr_is_admin_or_hr());
drop policy if exists hr_documents_self_read on public.hr_documents;
create policy hr_documents_self_read on public.hr_documents for select to authenticated
  using (employee_id = public.hr_my_employee_id());
drop policy if exists hr_documents_self_add on public.hr_documents;
create policy hr_documents_self_add on public.hr_documents for insert to authenticated
  with check (employee_id = public.hr_my_employee_id());
-- no employee update or delete policy

-- A row may only point at a file in its own employee's folder, for everyone (HR included), so View never opens another record's file.
do $do$
begin
  if not exists (select 1 from pg_constraint where conname = 'hr_documents_path_own_folder' and conrelid = 'public.hr_documents'::regclass) then
    alter table public.hr_documents add constraint hr_documents_path_own_folder
      check (storage_path is null or storage_path like employee_id::text || '/%');
  end if;
end $do$;

-- Documents already expired or expiring within 90 days. Leavers are left out. HR sees all, an employee their own, a manager none.
create or replace function public.hr_documents_expiring()
returns table (id uuid, employee_id uuid, employee_code text, full_name text, doc_type text, doc_number text, expiry_date date, days_left integer)
language sql stable security definer set search_path = public, pg_temp as $$
  select d.id, d.employee_id, e.employee_code, e.full_name, d.doc_type, d.doc_number, d.expiry_date, (d.expiry_date - current_date)::integer
  from public.hr_documents d
  join public.hr_employees e on e.id = d.employee_id
  where d.expiry_date is not null
    and d.expiry_date <= current_date + 90
    and e.status <> 'Left'
    and (public.hr_is_admin_or_hr() or d.employee_id = public.hr_my_employee_id())
  order by d.expiry_date, e.employee_code
$$;
revoke all on function public.hr_documents_expiring() from public, anon, authenticated;
grant execute on function public.hr_documents_expiring() to authenticated;

-- ── private bucket for the files ──
do $do$
begin
  if to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: skipped';
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit)
  values ('hr-documents', 'hr-documents', false, 26214400)
  on conflict (id) do update set public = false, file_size_limit = 26214400;

  drop policy if exists hr_docs_read on storage.objects;
  create policy hr_docs_read on storage.objects for select to authenticated
    using (bucket_id = 'hr-documents' and (public.hr_is_admin_or_hr() or (storage.foldername(name))[1] = public.hr_my_employee_id()::text));
  drop policy if exists hr_docs_insert on storage.objects;
  create policy hr_docs_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'hr-documents' and (public.hr_is_admin_or_hr() or (storage.foldername(name))[1] = public.hr_my_employee_id()::text));
  -- no update or delete policy: stored files are never replaced or removed from the app
end $do$;
