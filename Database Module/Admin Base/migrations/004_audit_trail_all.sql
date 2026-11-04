-- =====================================================================
-- Admin Base - audit trail: all activity and employee view         004
-- =====================================================================
-- Adds to audit_trail: logins and logouts, taken from auth.sessions with the IP and browser; page opens and
-- clicks sent by the CRM through audit_events(); and employee_id, so a person's records can be listed.
--   Clicks and page opens are removed after 12 months. Everything else is kept forever.
--   Typed text is never sent. A failed entry never blocks a login.
--   Logout means the session ended, which includes a session that expired.
-- Run after 003. Idempotent. Undo: rollback/004_rollback.sql
-- =====================================================================
alter table public.audit_trail add column if not exists employee_id uuid;
create index if not exists audit_trail_employee on public.audit_trail (employee_id, at desc);
create index if not exists audit_trail_action on public.audit_trail (action, at desc);
alter table public.audit_trail drop constraint if exists audit_trail_action_check;
alter table public.audit_trail add constraint audit_trail_action_check check (action in ('INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'PAGE', 'CLICK'));

create or replace function public.audit_trail_locked() returns trigger language plpgsql as $$
begin
  if TG_OP = 'DELETE' and OLD.action in ('PAGE', 'CLICK') and OLD.at < now() - interval '12 months' then return OLD; end if;
  raise exception 'The audit trail cannot be changed';
end $$;

create or replace function public.audit_trail_capture() returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  whole jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  o jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  n jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  who uuid := auth.uid();
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  private boolean := TG_TABLE_SCHEMA in ('ceo', 'email_base', 'email_agent') or (TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME like 'messenger\_%'); -- chat text stays out: Messanger Base 004b
  emp text := case when TG_TABLE_NAME = 'hr_employees' then whole ->> 'id' else whole ->> 'employee_id' end;
  diff text[];
  person jsonb;
  rid text;
begin
  if TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME in ('messenger_presence', 'messenger_activity') then return null; end if;
  if private and who is null then return null; end if;
  if TG_OP = 'UPDATE' then
    select array_agg(k order by k) into diff from (select jsonb_object_keys(o) as k union select jsonb_object_keys(n)) keys where (o -> k) is distinct from (n -> k);
    if diff is null or diff <@ array['updated_at'] then return null; end if;
    select jsonb_object_agg(k, o -> k) into o from unnest(diff) as k;
    select jsonb_object_agg(k, n -> k) into n from unnest(diff) as k;
  end if;
  select to_jsonb(p) into person from public.profiles p where p.id = who;
  select string_agg(whole ->> c, '/') into rid from unnest(TG_ARGV) as c;
  insert into public.audit_trail (actor, actor_name, actor_email, source, table_schema, table_name, action, row_id, changed, old_values, new_values, employee_id)
  values (who, person ->> 'full_name', coalesce(person ->> 'email', claims ->> 'email'), coalesce(claims ->> 'role', session_user::text),
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, rid, diff,
    case when private then null else public.audit_trail_clean(o) end,
    case when private then null else public.audit_trail_clean(n) end,
    case when emp ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then emp::uuid end);
  return null;
end $$;

-- A session row appears at login and goes at logout or expiry. Refreshing a token adds no row.
create or replace function public.audit_trail_session() returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  s jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  person public.profiles;
begin
  select * into person from public.profiles p where p.id = (s ->> 'user_id')::uuid;
  insert into public.audit_trail (actor, actor_name, actor_email, source, table_schema, table_name, action, row_id, new_values)
  values ((s ->> 'user_id')::uuid, person.full_name, person.email, 'auth', 'auth', 'sessions', case when TG_OP = 'DELETE' then 'LOGOUT' else 'LOGIN' end, s ->> 'id',
    jsonb_build_object('ip', s ->> 'ip', 'browser', left(s ->> 'user_agent', 200)));
  return null;
exception when others then
  raise warning 'audit trail session entry failed: %', sqlerrm;
  return null;
end $$;
drop trigger if exists audit_trail_session on auth.sessions;
create trigger audit_trail_session after insert or delete on auth.sessions for each row execute function public.audit_trail_session();

-- Sessions open now, so today's logins are not lost.
insert into public.audit_trail (at, actor, actor_name, actor_email, source, table_schema, table_name, action, row_id, new_values)
select s.created_at, s.user_id, p.full_name, p.email, 'auth', 'auth', 'sessions', 'LOGIN', s.id::text,
  jsonb_build_object('ip', to_jsonb(s) ->> 'ip', 'browser', left(to_jsonb(s) ->> 'user_agent', 200))
from auth.sessions s left join public.profiles p on p.id = s.user_id
where not exists (select 1 from public.audit_trail a where a.action = 'LOGIN' and a.row_id = s.id::text);

-- Links entries made before this migration to their employee. Only the new link column is filled.
do $$
declare t record;
begin
  alter table public.audit_trail disable trigger audit_trail_lock;
  for t in
    select c.table_name from information_schema.columns c
    join information_schema.columns i on i.table_schema = c.table_schema and i.table_name = c.table_name and i.column_name = 'id'
    where c.table_schema = 'public' and c.column_name = 'employee_id' and c.data_type = 'uuid'
  loop
    execute format('update public.audit_trail a set employee_id = x.employee_id from public.%I x where a.table_schema = ''public'' and a.table_name = %L and a.employee_id is null and a.row_id = x.id::text', t.table_name, t.table_name);
  end loop;
  if to_regclass('public.hr_employees') is not null then
    update public.audit_trail a set employee_id = a.row_id::uuid where a.table_schema = 'public' and a.table_name = 'hr_employees' and a.employee_id is null and a.row_id ~* '^[0-9a-f-]{36}$';
  end if;
  alter table public.audit_trail enable trigger audit_trail_lock;
end $$;

-- Page opens and clicks from the CRM. The user comes from the login, never from what the browser sends.
create or replace function public.audit_events(p_events jsonb) returns void language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  who uuid := auth.uid();
  person public.profiles;
begin
  if who is null then raise exception 'Not signed in'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 100 then raise exception 'Send up to 100 events at a time'; end if;
  select * into person from public.profiles p where p.id = who;
  insert into public.audit_trail (actor, actor_name, actor_email, source, table_schema, table_name, action, new_values)
  select who, person.full_name, person.email, 'browser', 'app', coalesce(nullif(left(e ->> 'page', 80), ''), 'app'), e ->> 'kind',
    jsonb_strip_nulls(jsonb_build_object('label', left(e ->> 'label', 120), 'element', left(e ->> 'element', 40), 'client_at', left(e ->> 'at', 40)))
  from jsonb_array_elements(p_events) as e
  where e ->> 'kind' in ('PAGE', 'CLICK');
end $$;

create or replace function public.audit_trail_purge_old() returns void language sql security definer set search_path = pg_catalog, public, pg_temp as $$
  delete from public.audit_trail where action in ('PAGE', 'CLICK') and at < now() - interval '12 months' $$;

revoke all on function public.audit_trail_session(), public.audit_trail_purge_old(), public.audit_events(jsonb) from public, anon, authenticated;
grant execute on function public.audit_events(jsonb) to authenticated;

do $$ begin
  if not exists (select 1 from cron.job where jobname = 'audit-trail-purge') then
    perform cron.schedule('audit-trail-purge', '23 2 * * *', 'select public.audit_trail_purge_old()');
  end if;
end $$;
