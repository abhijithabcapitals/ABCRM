-- =====================================================================
-- Business Development - lead documents                            013
-- =====================================================================
-- Documents dropped on the New Lead form (licence, passport, Emirates ID, business card and the like).
-- The browser reads them with DOC OCR Module to fill the form, then uploads them to hub-documents under
-- "Business Development/leads/<lead id>/" and records each one here with bd_add_lead_document.
-- Re-runnable.

create table if not exists public.bd_lead_documents (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null references public.bd_leads(id) on delete cascade,
  file_path    text not null unique check (file_path like 'Business Development/leads/%'),
  file_name    varchar(255) not null,
  content_type varchar(120),
  size_bytes   bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by  uuid not null references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index if not exists bd_lead_documents_lead_idx on public.bd_lead_documents (lead_id, created_at);

alter table public.bd_lead_documents enable row level security;
revoke all on public.bd_lead_documents from anon;
revoke insert, update, delete on public.bd_lead_documents from authenticated;
grant select on public.bd_lead_documents to authenticated;
drop policy if exists bd_lead_documents_read on public.bd_lead_documents;
create policy bd_lead_documents_read on public.bd_lead_documents for select to authenticated
  using (public.bd_can_view_lead(lead_id));

-- Records a file already uploaded under the lead's folder. Anyone who can see the lead can attach to it.
create or replace function public.bd_add_lead_document(p_lead_id uuid, p_file_path text, p_file_name text,
  p_content_type text default null, p_size_bytes bigint default null)
returns public.bd_lead_documents language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_row public.bd_lead_documents;
begin
  if auth.uid() is null or public.bd_current_role() is null then
    raise exception 'Sign in and request a Business Development role before attaching documents.';
  end if;
  if not public.bd_can_view_lead(p_lead_id) then
    raise exception 'You cannot attach documents to this lead.';
  end if;
  if p_file_path is null or p_file_path not like 'Business Development/leads/' || p_lead_id::text || '/%' then
    raise exception 'The document must be uploaded to this lead''s folder.';
  end if;
  if btrim(coalesce(p_file_name, '')) = '' then
    raise exception 'The document needs a file name.';
  end if;
  insert into public.bd_lead_documents (lead_id, file_path, file_name, content_type, size_bytes, uploaded_by)
  values (p_lead_id, p_file_path, left(btrim(p_file_name), 255), left(nullif(btrim(p_content_type), ''), 120), p_size_bytes, auth.uid())
  on conflict (file_path) do update set file_name = excluded.file_name
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.bd_add_lead_document(uuid, text, text, text, bigint) from public, anon;
grant execute on function public.bd_add_lead_document(uuid, text, text, text, bigint) to authenticated;

-- Lead files: BD users upload under "Business Development/leads/<lead id>/"; only BD roles read them.
do $$ begin
  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists bd_lead_docs_insert on storage.objects';
    execute $p$create policy bd_lead_docs_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'hub-documents' and name like 'Business Development/leads/%'
                  and public.bd_current_role() in ('super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive'))$p$;
    execute 'drop policy if exists bd_lead_docs_read on storage.objects';
    execute $p$create policy bd_lead_docs_read on storage.objects as restrictive for select to authenticated
      using (bucket_id <> 'hub-documents' or name not like 'Business Development/leads/%' or public.bd_current_role() is not null)$p$;
  end if;
end $$;
