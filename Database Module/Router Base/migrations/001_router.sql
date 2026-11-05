-- Router Base: each person's saved agent name and private chat with the router, and the checks the router runs.
-- Tables live in schema router, not public, so the audit-trail job (which attaches to every new public table) never
-- sees private chats and PostgREST's exposed schemas stay unchanged. Row security is on with no policies and no grants
-- to anon or authenticated: the tables are reachable only through the security definer functions below.
-- If a policy is ever added, wrap the call as (select auth.uid()). Idempotent.

create schema if not exists router;
revoke all on schema router from public, anon, authenticated;

create table if not exists router.settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  agent_name text not null default 'Bruno' check (char_length(btrim(agent_name)) between 1 and 30),
  ceo_thread_id uuid,
  updated_at timestamptz not null default now()
);

create table if not exists router.messages (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 8000),
  agent_id text references public.agents(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists messages_profile_id_idx on router.messages (profile_id, id desc);

alter table router.settings enable row level security;
alter table router.messages enable row level security;
revoke all on router.settings, router.messages from public, anon, authenticated;

-- Keeps the newest 50 messages per person.
create or replace function router.messages_trim() returns trigger
language plpgsql set search_path = router, pg_temp as $$
begin
  delete from router.messages m
  where m.profile_id = new.profile_id
    and m.id not in (select k.id from router.messages k where k.profile_id = new.profile_id order by k.id desc limit 50);
  return null;
end $$;
revoke all on function router.messages_trim() from public, anon, authenticated;
drop trigger if exists messages_trim on router.messages;
create trigger messages_trim after insert on router.messages
  for each row execute function router.messages_trim();

-- Signed-in person --------------------------------------------------------------------------------------------

create or replace function public.router_my_agent_name()
returns text language plpgsql stable security definer set search_path = public, router, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return coalesce((select s.agent_name from router.settings s where s.profile_id = auth.uid()), 'Bruno');
end $$;

create or replace function public.router_set_agent_name(p_name text)
returns text language plpgsql security definer set search_path = public, router, pg_temp as $$
declare
  v text := btrim(coalesce(p_name, ''));
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  if char_length(v) < 1 or char_length(v) > 30 then raise exception 'The agent name must be 1 to 30 characters.'; end if;
  insert into router.settings (profile_id, agent_name) values (auth.uid(), v)
  on conflict (profile_id) do update set agent_name = excluded.agent_name, updated_at = now();
  return v;
end $$;

create or replace function public.router_history()
returns table (id bigint, role text, content text, from_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = public, router, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return query
    select m.id, m.role, m.content, a.name, m.created_at
    from router.messages m left join public.agents a on a.id = m.agent_id
    where m.profile_id = auth.uid()
    order by m.id;
end $$;

create or replace function public.router_clear()
returns void language plpgsql security definer set search_path = public, router, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  delete from router.messages where profile_id = auth.uid();
end $$;

-- Service role only -------------------------------------------------------------------------------------------

-- Agents this person may reach now: enabled, ticked for them, they have credit left, and the agent is under its budget.
-- Usage counts from the start of the current Asia/Dubai month, as admin_agent_usage_this_month does.
create or replace function public.router_context(p_profile uuid)
returns jsonb language sql stable security definer set search_path = public, router, pg_temp as $$
  with m as (select (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai') as start_at),
  cr as (
    select greatest(c.monthly_credit_usd - coalesce((select sum(u.cost_usd) from public.agent_usage u, m
      where u.profile_id = p_profile and u.created_at >= m.start_at), 0), 0) as credit_left
    from public.agent_user_credit c where c.profile_id = p_profile),
  ag as (
    select a.id, a.name, a.role, a.sort_order,
      case when a.monthly_budget_usd is null then null
        else a.monthly_budget_usd - coalesce((select sum(u.cost_usd) from public.agent_usage u, m
          where u.agent_id = a.id and u.created_at >= m.start_at), 0) end as budget_left
    from public.agents a
    join public.agent_user_access x on x.agent_id = a.id and x.profile_id = p_profile
    where a.enabled)
  select jsonb_build_object(
    'agent_name', coalesce((select s.agent_name from router.settings s where s.profile_id = p_profile), 'Bruno'),
    'ceo_thread_id', (select s.ceo_thread_id from router.settings s where s.profile_id = p_profile),
    'credit_left', coalesce((select credit_left from cr), 0),
    'agents', case when coalesce((select credit_left from cr), 0) > 0 then coalesce((
      select jsonb_agg(jsonb_build_object('id', ag.id, 'name', ag.name, 'role', ag.role, 'budget_left', ag.budget_left) order by ag.sort_order, ag.id)
      from ag where ag.budget_left is null or ag.budget_left > 0), '[]'::jsonb) else '[]'::jsonb end,
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('role', r.role, 'content', r.content) order by r.id)
      from (select m2.id, m2.role, m2.content from router.messages m2
            where m2.profile_id = p_profile and not (m2.role = 'assistant' and m2.agent_id is null)
            order by m2.id desc limit 6) r), '[]'::jsonb));
$$;

create or replace function public.router_save_message(p_profile uuid, p_role text, p_content text, p_agent_id text)
returns void language plpgsql security definer set search_path = public, router, pg_temp as $$
begin
  insert into router.messages (profile_id, role, content, agent_id)
  values (p_profile, p_role, left(coalesce(p_content, ''), 8000), p_agent_id);
end $$;

create or replace function public.router_set_ceo_thread(p_profile uuid, p_thread uuid)
returns void language plpgsql security definer set search_path = public, router, pg_temp as $$
begin
  insert into router.settings (profile_id, ceo_thread_id) values (p_profile, p_thread)
  on conflict (profile_id) do update set ceo_thread_id = excluded.ceo_thread_id, updated_at = now();
end $$;

create or replace function public.router_record_usage(p_agent_id text, p_profile uuid, p_cost numeric)
returns void language plpgsql security definer set search_path = public, router, pg_temp as $$
begin
  insert into public.agent_usage (agent_id, profile_id, cost_usd) values (p_agent_id, p_profile, p_cost);
end $$;

revoke all on function public.router_my_agent_name() from public, anon;
revoke all on function public.router_set_agent_name(text) from public, anon;
revoke all on function public.router_history() from public, anon;
revoke all on function public.router_clear() from public, anon;
revoke all on function public.router_context(uuid) from public, anon, authenticated;
revoke all on function public.router_save_message(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.router_set_ceo_thread(uuid, uuid) from public, anon, authenticated;
revoke all on function public.router_record_usage(text, uuid, numeric) from public, anon, authenticated;
grant execute on function public.router_my_agent_name() to authenticated;
grant execute on function public.router_set_agent_name(text) to authenticated;
grant execute on function public.router_history() to authenticated;
grant execute on function public.router_clear() to authenticated;
grant execute on function public.router_context(uuid) to service_role;
grant execute on function public.router_save_message(uuid, text, text, text) to service_role;
grant execute on function public.router_set_ceo_thread(uuid, uuid) to service_role;
grant execute on function public.router_record_usage(text, uuid, numeric) to service_role;

-- AI Base changes ---------------------------------------------------------------------------------------------

-- Same as 002_agents.sql, with the router schema refused so private chats are never offered to an agent.
create or replace function public.agent_table_allowed(p_schema text, p_table text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select p_schema !~ '^(pg_.*|information_schema|auth|vault|storage|cron|net|realtime|extensions|graphql.*|pgsodium.*|supabase_.*|router|_.*|.*rollback.*)$'
    and not (p_schema = 'public' and p_table ~ '^(agents|agent_.*|integration_credentials|audit_trail|admin_audit)$')
    and exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = p_schema and c.relname = p_table and c.relkind in ('r', 'p') and not c.relispartition)
    and not exists (
      select 1 from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = p_schema and c.relname = p_table and a.attnum > 0 and not a.attisdropped
        and (a.attname ~* '^(.*_)?(password|passwd|secret|token|credential|api_?key|private_key|otp)(_.*)?$' or a.attname ~* '_hash$'))
$$;
revoke all on function public.agent_table_allowed(text, text) from public, anon, authenticated;

-- Business Development has its own code but was seeded not_connected. Only that old value is changed.
update public.agents set runtime = 'own_code' where id = 'AGT-05-BIZDEV' and runtime = 'not_connected';
