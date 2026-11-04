-- =====================================================================
-- Messanger Base - Microsoft 365 connection, user links, sync log and token storage    002
-- Needs Admin Base (profiles, admin_is), Supabase Vault and the service_role role. Idempotent.
-- Browser users only read: a member sees their own link, an admin sees everything. All writes go through the service role (Edge Functions).
-- Refresh tokens live in Vault as ms_rt:<profile_id>. Only service_role can run the token functions.
-- =====================================================================
create table if not exists public.microsoft_connection (
  id boolean primary key default true check (id),                 -- one row only
  tenant_id text,
  status text not null default 'not_connected' check (status in ('not_connected', 'active', 'revoked')),
  connected_by uuid references public.profiles(id) on delete set null,
  consented_at timestamptz,
  client_secret_expires_on date,                                  -- shown to admins before the app secret lapses
  updated_at timestamptz not null default now()
);

create table if not exists public.microsoft_user_links (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  microsoft_user_id text unique,
  upn text,
  scopes text[],
  status text not null default 'active' check (status in ('active', 'review', 'revoked')),
  teams_app_installed boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.microsoft_sync_log (
  id bigint generated always as identity primary key,
  action text not null,
  status text not null,
  error_code text,
  actor uuid,
  detail jsonb,                                                   -- no tokens, no message text
  created_at timestamptz not null default now()
);
create index if not exists microsoft_sync_log_created_idx on public.microsoft_sync_log (created_at);

alter table public.microsoft_connection enable row level security;
alter table public.microsoft_user_links enable row level security;
alter table public.microsoft_sync_log enable row level security;
revoke all on public.microsoft_connection, public.microsoft_user_links, public.microsoft_sync_log from public, anon, authenticated;
grant select on public.microsoft_connection, public.microsoft_user_links, public.microsoft_sync_log to authenticated;
grant select, insert, update, delete on public.microsoft_connection, public.microsoft_user_links, public.microsoft_sync_log to service_role;

drop policy if exists ms_connection_select on public.microsoft_connection;
create policy ms_connection_select on public.microsoft_connection for select to authenticated using (admin_is());
drop policy if exists ms_links_select on public.microsoft_user_links;
create policy ms_links_select on public.microsoft_user_links for select to authenticated
  using (profile_id = (select auth.uid()) or admin_is());
drop policy if exists ms_log_select on public.microsoft_sync_log;
create policy ms_log_select on public.microsoft_sync_log for select to authenticated using (admin_is());

-- Token storage. security definer reads Vault for the caller, so only service_role may execute.
create or replace function public.ms_token_set(p_profile uuid, p_token text) returns void
language plpgsql security definer set search_path = public, vault, pg_temp as $$
declare v_name text := 'ms_rt:' || p_profile::text; v_id uuid;
begin
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then perform vault.create_secret(p_token, v_name, 'Microsoft refresh token');
  else perform vault.update_secret(v_id, p_token); end if;
end $$;

create or replace function public.ms_token_get(p_profile uuid) returns text
language sql stable security definer set search_path = public, vault, pg_temp as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'ms_rt:' || p_profile::text limit 1
$$;

create or replace function public.ms_token_delete(p_profile uuid) returns void
language sql security definer set search_path = public, vault, pg_temp as $$
  delete from vault.secrets where name = 'ms_rt:' || p_profile::text
$$;

create or replace function public.ms365_prune_logs() returns void
language sql security definer set search_path = public, pg_temp as $$
  delete from public.microsoft_sync_log where created_at < now() - interval '90 days'
$$;

revoke all on function public.ms_token_set(uuid, text), public.ms_token_get(uuid), public.ms_token_delete(uuid), public.ms365_prune_logs() from public, anon, authenticated;
grant execute on function public.ms_token_set(uuid, text), public.ms_token_get(uuid), public.ms_token_delete(uuid), public.ms365_prune_logs() to service_role;
