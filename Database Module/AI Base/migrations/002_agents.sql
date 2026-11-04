-- Settings > Agents: each agent's configuration, who may use it, and each person's monthly usage credit.
-- Saving here runs nothing. The agent gateway reads these tables with the service role and enforces them.
-- Admins read the tables directly and change them only through the admin_agent_* functions.
-- Agent API keys are not here: they are in Vault as crm_cred:AGENT_KEY_<ID>, through admin_credential_set.

create table if not exists public.agents (
  id text primary key,
  name text not null check (btrim(name) <> ''),
  role text not null default '',
  instructions text not null default '',
  extra_content text not null default '',
  provider text not null default 'anthropic' check (provider in ('anthropic', 'openrouter')),
  model text not null default 'claude-sonnet-5-5',
  enabled boolean not null default false,
  monthly_budget_usd numeric(12,2) check (monthly_budget_usd >= 0),
  approval_rules text not null default '',
  notes text not null default '',
  group_name text not null default 'Other',
  runtime text not null default 'not_connected' check (runtime in ('not_connected', 'own_code', 'gateway')),
  sort_order int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_knowledge (
  agent_id text not null references public.agents(id) on delete cascade,
  category_id uuid not null references public.knowledge_categories(id) on delete cascade,
  primary key (agent_id, category_id)
);

create table if not exists public.agent_table_access (
  agent_id text not null references public.agents(id) on delete cascade,
  schema_name text not null,
  table_name text not null,
  level text not null check (level in ('read', 'write')),
  primary key (agent_id, schema_name, table_name)
);

create table if not exists public.agent_user_access (
  agent_id text not null references public.agents(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (agent_id, profile_id)
);

-- A person with no row has no credit, so they cannot run a paid agent call.
create table if not exists public.agent_user_credit (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  monthly_credit_usd numeric(12,2) not null default 0 check (monthly_credit_usd >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Written by the gateway for each paid call.
create table if not exists public.agent_usage (
  id bigint generated always as identity primary key,
  agent_id text not null references public.agents(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  cost_usd numeric(12,6) not null check (cost_usd >= 0),
  created_at timestamptz not null default now()
);
create index if not exists agent_usage_profile_month on public.agent_usage (profile_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['agents', 'agent_knowledge', 'agent_table_access', 'agent_user_access', 'agent_user_credit', 'agent_usage'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, public, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.admin_is())', t || '_admin_read', t);
  end loop;
end $$;

-- Tables an agent may be offered. System schemas, this feature's own tables, the logs and any table
-- holding a password, token or similar column are never offered.
create or replace function public.agent_table_allowed(p_schema text, p_table text)
returns boolean language sql stable security definer set search_path = pg_catalog, pg_temp as $$
  select p_schema !~ '^(pg_.*|information_schema|auth|vault|storage|cron|net|realtime|extensions|graphql.*|pgsodium.*|supabase_.*|_.*|.*rollback.*)$'
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

create or replace function public.admin_agent_tables()
returns table (schema_name text, table_name text)
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if not public.admin_is() then raise exception 'Only a CRM admin can list database tables.'; end if;
  return query
    select n.nspname::text, c.relname::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and public.agent_table_allowed(n.nspname::text, c.relname::text)
    order by 1, 2;
end $$;

create or replace function public.admin_agent_save(
  p_id text, p_fields jsonb, p_categories uuid[], p_tables jsonb, p_users uuid[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
begin
  if not public.admin_is() then raise exception 'Only a CRM admin can change agents.'; end if;
  if not exists (select 1 from agents where id = p_id) then raise exception 'That agent does not exist.'; end if;

  for r in select x.schema_name, x.table_name, x.level from jsonb_to_recordset(coalesce(p_tables, '[]'::jsonb))
    as x(schema_name text, table_name text, level text)
  loop
    if not public.agent_table_allowed(r.schema_name, r.table_name) then
      raise exception 'Agents cannot be given access to %.%.', r.schema_name, r.table_name;
    end if;
    if r.level not in ('read', 'write') then raise exception 'Access must be read or write.'; end if;
  end loop;

  update agents set
    name = p_fields->>'name',
    role = coalesce(p_fields->>'role', ''),
    instructions = coalesce(p_fields->>'instructions', ''),
    extra_content = coalesce(p_fields->>'extra_content', ''),
    provider = p_fields->>'provider',
    model = p_fields->>'model',
    enabled = coalesce((p_fields->>'enabled')::boolean, false),
    monthly_budget_usd = nullif(p_fields->>'monthly_budget_usd', '')::numeric,
    approval_rules = coalesce(p_fields->>'approval_rules', ''),
    notes = coalesce(p_fields->>'notes', ''),
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_id;

  -- Only real changes are written, so the Audit Trail shows only what changed.
  delete from agent_knowledge where agent_id = p_id and category_id <> all (coalesce(p_categories, '{}'));
  insert into agent_knowledge (agent_id, category_id)
    select p_id, c from unnest(coalesce(p_categories, '{}')) c on conflict do nothing;

  delete from agent_table_access a where a.agent_id = p_id and not exists (
    select 1 from jsonb_to_recordset(coalesce(p_tables, '[]'::jsonb)) as x(schema_name text, table_name text)
    where x.schema_name = a.schema_name and x.table_name = a.table_name);
  insert into agent_table_access (agent_id, schema_name, table_name, level)
    select p_id, x.schema_name, x.table_name, x.level
    from jsonb_to_recordset(coalesce(p_tables, '[]'::jsonb)) as x(schema_name text, table_name text, level text)
    on conflict (agent_id, schema_name, table_name) do update set level = excluded.level
      where agent_table_access.level is distinct from excluded.level;

  delete from agent_user_access where agent_id = p_id and profile_id <> all (coalesce(p_users, '{}'));
  insert into agent_user_access (agent_id, profile_id, granted_by)
    select p_id, u, auth.uid() from unnest(coalesce(p_users, '{}')) u on conflict do nothing;
end $$;

-- Sets the person's monthly credit. The screen's increase and decrease buttons send the new total.
create or replace function public.admin_agent_credit_set(p_profile uuid, p_amount numeric)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_is() then raise exception 'Only a CRM admin can change usage credit.'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'Credit cannot be below zero.'; end if;
  insert into agent_user_credit (profile_id, monthly_credit_usd, updated_by)
  values (p_profile, p_amount, auth.uid())
  on conflict (profile_id) do update set
    monthly_credit_usd = excluded.monthly_credit_usd, updated_by = excluded.updated_by, updated_at = now();
end $$;

-- Spend per person since the start of this month, Dubai time.
create or replace function public.admin_agent_usage_this_month()
returns table (profile_id uuid, used_usd numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.admin_is() then raise exception 'Only a CRM admin can read usage.'; end if;
  return query
    select u.profile_id, sum(u.cost_usd)
    from agent_usage u
    where u.profile_id is not null
      and u.created_at >= (date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai')
    group by u.profile_id;
end $$;

revoke all on function public.admin_agent_tables() from public, anon;
revoke all on function public.admin_agent_save(text, jsonb, uuid[], jsonb, uuid[]) from public, anon;
revoke all on function public.admin_agent_credit_set(uuid, numeric) from public, anon;
revoke all on function public.admin_agent_usage_this_month() from public, anon;
grant execute on function public.admin_agent_tables() to authenticated;
grant execute on function public.admin_agent_save(text, jsonb, uuid[], jsonb, uuid[]) to authenticated;
grant execute on function public.admin_agent_credit_set(uuid, numeric) to authenticated;
grant execute on function public.admin_agent_usage_this_month() to authenticated;
