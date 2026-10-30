-- Personal email signatures (Profile > Mail), used by the Business Development reply composer.
-- Each user sees and edits only their own signatures. Logos live in the public
-- `email-signatures` bucket under <user id>/..., so mail clients can load them.
begin;

create table if not exists public.email_signatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  body_text text not null check (char_length(body_text) between 1 and 2000),
  logo_url text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists email_signatures_user_idx on public.email_signatures (user_id, created_at);
create unique index if not exists email_signatures_one_default_idx on public.email_signatures (user_id) where is_default;

alter table public.email_signatures enable row level security;
revoke all on public.email_signatures from anon, public;
grant select, insert, update, delete on public.email_signatures to authenticated;
grant all on public.email_signatures to service_role;

drop policy if exists email_signatures_own on public.email_signatures;
create policy email_signatures_own on public.email_signatures for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('email-signatures', 'email-signatures', true, 1048576, array['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists email_signatures_logo_insert on storage.objects;
create policy email_signatures_logo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'email-signatures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists email_signatures_logo_update on storage.objects;
create policy email_signatures_logo_update on storage.objects for update to authenticated
  using (bucket_id = 'email-signatures' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists email_signatures_logo_delete on storage.objects;
create policy email_signatures_logo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'email-signatures' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
