-- Company news: any signed-in staff member publishes a short message from their Profile, and it
-- runs as a headline across the top of the CRM for every staff member, with the author's name.
-- Client portal logins do not use Supabase sign-in, so they never read this table.
-- Undo: rollback/008_crm_news_rollback.sql

begin;

create table public.crm_news (
  id uuid primary key default gen_random_uuid(),
  message text not null check (char_length(btrim(message)) between 1 and 300),
  author_id uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days'
);
create index crm_news_live_idx on public.crm_news (expires_at, created_at desc);

alter table public.crm_news enable row level security;
revoke all on public.crm_news from public, anon, authenticated;
grant select, delete on public.crm_news to authenticated;
-- Only the message: the author and the dates are always set by the database.
grant insert (message) on public.crm_news to authenticated;

create policy crm_news_read on public.crm_news for select to authenticated using (true);
create policy crm_news_publish on public.crm_news for insert to authenticated
  with check (author_id = (select auth.uid()));
create policy crm_news_remove on public.crm_news for delete to authenticated
  using (author_id = (select auth.uid())
    or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin'));

-- A new or removed headline reaches open screens at once.
alter publication supabase_realtime add table public.crm_news;

commit;
