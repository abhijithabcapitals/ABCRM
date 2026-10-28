-- =====================================================================
-- Wiki PDF attachments — table + storage bucket + policies
-- =====================================================================
-- Enables attaching PDFs to wiki pages. Run once in the Supabase SQL editor.
-- Idempotent.
-- =====================================================================

-- 1. Metadata table
create table if not exists wiki_attachments (
  id            uuid primary key default gen_random_uuid(),
  article_id    uuid not null references wiki_articles(id) on delete cascade,
  file_name     text not null,
  file_size     bigint,
  file_type     text,
  storage_path  text not null,
  uploaded_by   text,
  uploaded_at   timestamptz default now()
);
create index if not exists idx_wiki_attachments_article on wiki_attachments(article_id, uploaded_at desc);

alter table wiki_attachments enable row level security;
do $$ begin
  create policy "read wiki_attachments"  on wiki_attachments for select to authenticated using (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "write wiki_attachments" on wiki_attachments for all to authenticated using (true) with check (true);
exception when duplicate_object then null; end $$;

-- 2. Storage bucket (private)
insert into storage.buckets (id, name, public)
values ('wiki-attachments', 'wiki-attachments', false)
on conflict (id) do nothing;

-- 3. Storage policies — authenticated users can read/write objects in this bucket
do $$ begin
  create policy "wiki-attachments read"   on storage.objects for select to authenticated using (bucket_id = 'wiki-attachments');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "wiki-attachments insert" on storage.objects for insert to authenticated with check (bucket_id = 'wiki-attachments');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "wiki-attachments delete" on storage.objects for delete to authenticated using (bucket_id = 'wiki-attachments');
exception when duplicate_object then null; end $$;
