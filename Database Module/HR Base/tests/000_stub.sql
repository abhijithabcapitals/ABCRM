-- LOCAL TEST ONLY. Never run on Supabase. Minimal stand-ins for CRM tables HR later tasks link to.
create table if not exists public.spaces (id uuid primary key default gen_random_uuid(), name text);
create table if not exists public.lists (id uuid primary key default gen_random_uuid(), space_id uuid references public.spaces(id), name text);
create table if not exists public.tasks (id uuid primary key default gen_random_uuid(), list_id uuid references public.lists(id), title text, created_at timestamptz default now());
