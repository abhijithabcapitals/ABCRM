-- LOCAL TEST ONLY. Supabase has the storage schema. Client Base 003 inserts a bucket; Banking 004 adds policies once objects exist.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
