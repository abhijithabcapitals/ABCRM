-- LOCAL TEST ONLY. Never run on Supabase (it already has these).
-- Runs after Banking Base/tests/000_stub.sql. Adds only what that stub lacks: the storage schema the portal migration writes to,
-- and the part of pg_cron Admin Base 003 schedules its hourly job with.
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false, file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text, name text, metadata jsonb
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;

-- Stand-in for Supabase Vault. Nothing is encrypted in this throwaway database.
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text, new_description text default '') returns uuid language sql as $$
  insert into vault.secrets (name, secret, description) values (new_name, new_secret, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text) returns void language sql as $$
  update vault.secrets set secret = new_secret where id = secret_id $$;
