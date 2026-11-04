-- =====================================================================
-- Messanger Base - keep chat out of the audit trail's stored values    004b
-- Needs Admin Base 003_audit_trail.sql. Idempotent.
-- Chat becomes private the way mail already is: the audit trail records who changed which fields and when, never the text.
-- Status beats and the activity feed are not logged at all: they are many, small and hold nothing worth auditing.
-- Rows already in the audit trail are not touched; that table is locked.
-- =====================================================================
create or replace function public.audit_trail_capture() returns trigger
language plpgsql security definer set search_path to 'pg_catalog', 'public', 'pg_temp' as $function$
declare
  whole jsonb := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  o jsonb := case when TG_OP <> 'INSERT' then to_jsonb(OLD) end;
  n jsonb := case when TG_OP <> 'DELETE' then to_jsonb(NEW) end;
  who uuid := auth.uid();
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  private boolean := TG_TABLE_SCHEMA in ('ceo', 'email_base', 'email_agent') or (TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME like 'messenger\_%');
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
end $function$;
revoke all on function public.audit_trail_capture() from public, anon, authenticated;
