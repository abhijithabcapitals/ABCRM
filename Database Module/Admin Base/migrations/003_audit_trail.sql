-- =====================================================================
-- Admin Base - audit trail                                         003
-- =====================================================================
-- One locked log of every add, change and delete in the CRM's tables, with who made it. A trigger on each
-- table writes here, so a change is recorded whichever screen, function or import made it. A write whose
-- audit entry fails is rolled back, so nothing changes unrecorded. Only admins can read it. Kept forever.
--   Passwords, tokens, keys and hashes are never stored, only "[hidden]".
--   Other values are stored in full, so read access to this table must stay admin-only.
--   ceo, email_base and email_agent hold private mail: entries say what changed, without values, and the
--   background mail sync is not logged. The older module logs stay as they are.
--   An Edge Function using the service role shows as source service_role with no user.
-- Run after 001. Idempotent. Undo: rollback/003_rollback.sql
-- =====================================================================
create table if not exists public.audit_trail (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_name text,
  actor_email text,
  source text not null,
  table_schema text not null,
  table_name text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  row_id text,
  changed text[],
  old_values jsonb,
  new_values jsonb
);
create index if not exists audit_trail_at on public.audit_trail (at desc);
create index if not exists audit_trail_actor on public.audit_trail (actor, at desc);
create index if not exists audit_trail_table on public.audit_trail (table_name, at desc);
create index if not exists audit_trail_row on public.audit_trail (table_name, row_id);

create or replace function public.audit_trail_locked() returns trigger language plpgsql as $$
begin raise exception 'The audit trail cannot be changed'; end $$;
drop trigger if exists audit_trail_lock on public.audit_trail;
create trigger audit_trail_lock before update or delete on public.audit_trail for each row execute function public.audit_trail_locked();
drop trigger if exists audit_trail_lock_truncate on public.audit_trail;
create trigger audit_trail_lock_truncate before truncate on public.audit_trail for each statement execute function public.audit_trail_locked();

alter table public.audit_trail enable row level security;
revoke all on public.audit_trail from public, anon, authenticated, service_role;
grant select on public.audit_trail to authenticated;
drop policy if exists audit_trail_read on public.audit_trail;
create policy audit_trail_read on public.audit_trail for select to authenticated using (public.admin_is());

-- Hides secrets by column name and shortens very long values. Passport numbers and pay stay readable.
create or replace function public.audit_trail_clean(v jsonb) returns jsonb language sql immutable strict set search_path = pg_catalog, pg_temp as $$
  select coalesce(jsonb_object_agg(k, case
    when k ~* '^(.*_)?(password|passwd|secret|token|credential|api_?key|private_key|otp)(_.*)?$' or k ~* '_hash$' then to_jsonb('[hidden]'::text)
    when jsonb_typeof(x) = 'string' and length(x #>> '{}') > 4000 then to_jsonb('[long text, ' || length(x #>> '{}') || ' characters]')
    when jsonb_typeof(x) in ('array', 'object') and length(x::text) > 8000 then to_jsonb('[long data, ' || length(x::text) || ' characters]')
    else x end), '{}'::jsonb)
  from jsonb_each(v) as e(k, x) $$;

-- Trigger arguments are the table's primary key columns.
create or replace function public.audit_trail_capture() returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  o jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  n jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  who uuid := auth.uid();
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  private boolean := TG_TABLE_SCHEMA in ('ceo', 'email_base', 'email_agent');
  diff text[];
  person jsonb;
  rid text;
begin
  if private and who is null then return null; end if;
  if TG_OP = 'UPDATE' then
    select array_agg(k order by k) into diff from (select jsonb_object_keys(o) as k union select jsonb_object_keys(n)) keys where (o -> k) is distinct from (n -> k);
    if diff is null or diff <@ array['updated_at'] then return null; end if;
    select jsonb_object_agg(k, o -> k) into o from unnest(diff) as k;
    select jsonb_object_agg(k, n -> k) into n from unnest(diff) as k;
  end if;
  select to_jsonb(p) into person from public.profiles p where p.id = who;
  select string_agg((case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end) ->> c, '/') into rid from unnest(TG_ARGV) as c;
  insert into public.audit_trail (actor, actor_name, actor_email, source, table_schema, table_name, action, row_id, changed, old_values, new_values)
  values (who, person ->> 'full_name', coalesce(person ->> 'email', claims ->> 'email'), coalesce(claims ->> 'role', session_user::text),
    TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP, rid, diff,
    case when private then null else public.audit_trail_clean(o) end,
    case when private then null else public.audit_trail_clean(n) end);
  return null;
end $$;

-- Puts the trigger on every table that lacks it. Runs hourly, so new tables are covered without anyone remembering.
-- Tables that are logs themselves or only count usage are left out.
create or replace function public.audit_trail_attach_all() returns table (attached int, failed text[]) language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare
  t record;
  pk text;
  done int := 0;
  bad text[] := '{}';
begin
  for t in
    select c.oid, n.nspname, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and not c.relispartition
      and n.nspname in ('public', 'acct', 'ceo', 'email_base', 'email_agent')
      and (n.nspname, c.relname) not in (('public', 'audit_trail'), ('public', 'admin_audit'), ('public', 'hr_audit_log'), ('public', 'banking_activity_logs'), ('public', 'bd_audit_logs'), ('public', 'ai_usage'), ('ceo', 'audit_logs'))
      and not exists (select 1 from pg_trigger g where g.tgrelid = c.oid and g.tgname = 'audit_trail_row')
  loop
    select string_agg(quote_literal(a.attname), ', ' order by k.ord) into pk
    from pg_index i cross join lateral unnest(i.indkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = k.attnum
    where i.indrelid = t.oid and i.indisprimary;
    begin
      execute format('create trigger audit_trail_row after insert or update or delete on %I.%I for each row execute function public.audit_trail_capture(%s)', t.nspname, t.relname, coalesce(pk, ''));
      done := done + 1;
    exception when others then
      bad := bad || (t.nspname || '.' || t.relname || ': ' || sqlerrm);
    end;
  end loop;
  return query select done, bad;
end $$;

revoke all on function public.audit_trail_locked(), public.audit_trail_clean(jsonb), public.audit_trail_capture(), public.audit_trail_attach_all() from public, anon, authenticated;

select public.audit_trail_attach_all();
do $$ begin
  if not exists (select 1 from cron.job where jobname = 'audit-trail-attach') then
    perform cron.schedule('audit-trail-attach', '7 * * * *', 'select public.audit_trail_attach_all()');
  end if;
end $$;
