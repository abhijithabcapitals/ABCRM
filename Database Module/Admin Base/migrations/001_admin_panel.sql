-- =====================================================================
-- Admin Base - technical panel                                     001
-- =====================================================================
-- Tab access per member, the admin audit log, and the checks behind Settings. Everything here is for CRM admins,
-- except my_tabs, which tells a signed-in member their own tabs. Run after HR Base and AI Base. Idempotent.
-- =====================================================================
create table if not exists public.member_tab_access (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  tab_key text not null,
  granted_at timestamptz not null default now(),
  granted_by uuid default auth.uid(),
  primary key (profile_id, tab_key)
);
alter table public.member_tab_access enable row level security;
revoke all on public.member_tab_access from public, anon, authenticated;
grant select on public.member_tab_access to authenticated;
drop policy if exists member_tab_access_read on public.member_tab_access;
create policy member_tab_access_read on public.member_tab_access for select to authenticated using (profile_id = auth.uid() or admin_is());

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  action text not null,
  target text,
  detail jsonb
);
create or replace function public.admin_audit_locked() returns trigger language plpgsql as $$
begin raise exception 'The audit log cannot be changed'; end $$;
drop trigger if exists admin_audit_lock on public.admin_audit;
create trigger admin_audit_lock before update or delete on public.admin_audit for each row execute function public.admin_audit_locked();
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from public, anon, authenticated;
grant select on public.admin_audit to authenticated;
grant insert on public.admin_audit to service_role;
drop policy if exists admin_audit_read on public.admin_audit;
create policy admin_audit_read on public.admin_audit for select to authenticated using (admin_is());

create or replace function public.admin_require() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin if not admin_is() then raise exception 'Admin access required'; end if; end $$;

create or replace function public.my_tabs() returns text[]
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(tab_key), '{}') from member_tab_access where profile_id = auth.uid()
$$;

create or replace function public.admin_set_tabs(p_profile uuid, p_tabs text[]) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  delete from member_tab_access where profile_id = p_profile;
  insert into member_tab_access (profile_id, tab_key) select p_profile, distinct_tab from (select distinct unnest(p_tabs) as distinct_tab) t;
  insert into admin_audit (action, target, detail) values ('set_tabs', p_profile::text, jsonb_build_object('tabs', p_tabs));
end $$;

create or replace function public.admin_members() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  perform admin_require();
  select coalesce(jsonb_agg(row_to_json(t) order by t.full_name), '[]'::jsonb) into out from (
    select p.id, p.full_name, p.email, p.role, u.last_sign_in_at, u.created_at as joined_at,
           (u.banned_until is not null and u.banned_until > now()) as suspended,
           e.employee_code, e.department, e.designation,
           (select coalesce(array_agg(a.tab_key), '{}') from member_tab_access a where a.profile_id = p.id) as tabs,
           (select r.role from banking_user_roles r where r.user_id = p.id) as data_role
      from profiles p
      left join auth.users u on u.id = p.id
      left join hr_employees e on e.profile_id = p.id
  ) t;
  return out;
end $$;

-- Runs a check that may depend on an optional module, and reports null if that module is absent.
create or replace function public.admin_try(p_sql text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare out jsonb;
begin
  execute p_sql into out;
  return out;
exception when others then
  return null;
end $$;

create or replace function public.admin_health() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  return jsonb_build_object(
    'generated_at', now(),
    'db_size_bytes', pg_database_size(current_database()),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::int,
    'cache_hit_percent', (select round(100.0 * blks_hit / nullif(blks_hit + blks_read, 0), 1) from pg_stat_database where datname = current_database()),
    'slow_queries', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active' and now() - query_start > interval '1 minute'),
    'tables_without_rls', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    'members', (select count(*) from profiles),
    'active_7d', (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
    'email', jsonb_build_object(
      'last_sync', admin_try($q$select to_jsonb(max(last_synced_at)) from email_base.mailbox_folders$q$),
      'folder_errors', admin_try($q$select to_jsonb(count(*)) from email_base.mailbox_folders where last_error is not null$q$),
      'summaries_waiting_7d', admin_try($q$select to_jsonb(count(*)) from email_base.threads where needs_summary and last_message_at > now() - interval '7 days'$q$),
      'summaries_waiting_all', admin_try($q$select to_jsonb(count(*)) from email_base.threads where needs_summary$q$),
      'agent_last_run', admin_try($q$select to_jsonb(max(started_at)) from email_agent.runs$q$),
      'agent_errors_24h', admin_try($q$select to_jsonb(count(*)) from email_agent.runs where started_at > now() - interval '24 hours' and coalesce(array_length(errors, 1), 0) > 0$q$),
      'agent_last_error', admin_try($q$select to_jsonb(errors[1]) from email_agent.runs where coalesce(array_length(errors, 1), 0) > 0 order by started_at desc limit 1$q$)
    )
  );
end $$;

create or replace function public.admin_storage() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  return jsonb_build_object(
    'db_size_bytes', pg_database_size(current_database()),
    'tables', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
      select n.nspname as schema, c.relname as name, pg_total_relation_size(c.oid) as bytes, c.reltuples::bigint as rows
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where c.relkind = 'r' and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
       order by 3 desc limit 25) t),
    'buckets', admin_try($q$select coalesce(jsonb_agg(t), '[]'::jsonb) from (select bucket_id as name, count(*) as files, coalesce(sum((metadata->>'size')::bigint), 0) as bytes from storage.objects group by bucket_id order by 3 desc) t$q$)
  );
end $$;

create or replace function public.admin_ai_usage(p_days integer default 30) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare since timestamptz := now() - make_interval(days => greatest(1, least(p_days, 365)));
begin
  perform admin_require();
  return jsonb_build_object(
    'days', p_days,
    'first_logged', (select min(at) from ai_usage),
    'total', (select jsonb_build_object('calls', count(*), 'cost', coalesce(sum(cost_usd), 0), 'prompt', coalesce(sum(prompt_tokens), 0), 'completion', coalesce(sum(completion_tokens), 0), 'reasoning', coalesce(sum(reasoning_tokens), 0), 'cached', coalesce(sum(cached_tokens), 0)) from ai_usage where at >= since),
    'by_task', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select function_name as name, count(*) as calls, coalesce(sum(prompt_tokens), 0) as prompt, coalesce(sum(completion_tokens), 0) as completion, coalesce(sum(cost_usd), 0) as cost from ai_usage where at >= since group by 1 order by 5 desc, 2 desc) t),
    'by_member', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select u.user_id as id, coalesce(p.full_name, p.email, 'Automatic (no person)') as name, count(*) as calls, coalesce(sum(u.prompt_tokens), 0) as prompt, coalesce(sum(u.completion_tokens), 0) as completion, coalesce(sum(u.cost_usd), 0) as cost from ai_usage u left join profiles p on p.id = u.user_id where u.at >= since group by 1, 2 order by 6 desc, 3 desc) t),
    'by_model', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (select model as name, count(*) as calls, coalesce(sum(cost_usd), 0) as cost from ai_usage where at >= since group by 1 order by 3 desc) t),
    'by_day', (select coalesce(jsonb_agg(t order by t.day), '[]'::jsonb) from (select (at at time zone 'Asia/Dubai')::date as day, count(*) as calls, coalesce(sum(cost_usd), 0) as cost from ai_usage where at >= since group by 1) t)
  );
end $$;

create or replace function public.admin_jobs() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  return coalesce(admin_try($q$
    select coalesce(jsonb_agg(t order by t.jobname), '[]'::jsonb) from (
      select j.jobid, j.jobname, j.schedule, j.active,
             (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid) as last_run,
             (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) as last_status,
             (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'failed' and d.start_time > now() - interval '24 hours') as failed_24h
        from cron.job j) t
  $q$), '[]'::jsonb);
end $$;

-- Pausing a job stops it running; nothing else about it changes.
create or replace function public.admin_job_set_active(p_job bigint, p_active boolean) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform admin_require();
  perform cron.alter_job(job_id := p_job, active := p_active);
  insert into admin_audit (action, target, detail) values (case when p_active then 'resume_job' else 'pause_job' end, p_job::text, null);
end $$;

revoke all on function public.admin_try(text), public.admin_require(), public.admin_audit_locked() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['my_tabs()', 'admin_set_tabs(uuid, text[])', 'admin_members()', 'admin_health()', 'admin_storage()', 'admin_ai_usage(integer)', 'admin_jobs()', 'admin_job_set_active(bigint, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
