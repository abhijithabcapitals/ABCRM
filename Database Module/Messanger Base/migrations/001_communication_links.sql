-- =====================================================================
-- Messanger Base - links from a client, lead or task to a chat, meeting or channel    001
-- Needs Admin Base (profiles, admin_is) and the client_master, bd_leads and tasks tables. Idempotent.
-- A link is visible only to people who can see its parent record, so the parent's own row security applies.
-- Links are added and removed, never edited.
-- =====================================================================
create table if not exists public.crm_communication_links (
  id uuid primary key default gen_random_uuid(),
  record_type text not null check (record_type in ('client', 'lead', 'task')),
  record_id text not null,                                        -- client_master.client_id, bd_leads.id or tasks.id as text
  link_type text not null check (link_type in ('chat', 'meeting', 'channel')),
  reference text not null,                                        -- the deep link or meeting ID, no KYC data
  label text,
  created_by uuid default auth.uid() references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (record_type, record_id, link_type, reference)
);
create index if not exists crm_communication_links_record_idx on public.crm_communication_links (record_type, record_id);

alter table public.crm_communication_links enable row level security;
revoke all on public.crm_communication_links from public, anon, authenticated;
grant select, insert, delete on public.crm_communication_links to authenticated;

-- True when the caller can see the parent row; the parent's row security decides.
create or replace function public.crm_link_parent_visible(p_type text, p_id text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select case p_type
    when 'client' then exists (select 1 from public.client_master c where c.client_id = p_id)
    when 'lead' then exists (select 1 from public.bd_leads l where l.id::text = p_id)
    when 'task' then exists (select 1 from public.tasks t where t.id::text = p_id)
    else false end
$$;
revoke all on function public.crm_link_parent_visible(text, text) from public, anon;
grant execute on function public.crm_link_parent_visible(text, text) to authenticated;

drop policy if exists crm_links_select on public.crm_communication_links;
create policy crm_links_select on public.crm_communication_links for select to authenticated
  using (public.crm_link_parent_visible(record_type, record_id));
drop policy if exists crm_links_insert on public.crm_communication_links;
create policy crm_links_insert on public.crm_communication_links for insert to authenticated
  with check (created_by = (select auth.uid()) and public.crm_link_parent_visible(record_type, record_id));
drop policy if exists crm_links_delete on public.crm_communication_links;
create policy crm_links_delete on public.crm_communication_links for delete to authenticated
  using (created_by = (select auth.uid()) or admin_is());
