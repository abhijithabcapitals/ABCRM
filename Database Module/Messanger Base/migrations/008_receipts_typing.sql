-- =====================================================================
-- Messanger Base - delivered ticks, live ticks and typing    008
-- Needs 003_chat.sql and 004b_chat_audit_private.sql, and Supabase Realtime. Idempotent.
-- last_delivered_at is when a person's app last received the chat. Ticks read it through messenger_receipt_state.
-- Member rows join the Realtime publication, so a sender's ticks change live; row security decides who receives them.
-- Typing is a Realtime broadcast and is never stored. Only members of a chat may send or hear its signals.
-- Read and delivered times are not written to the audit trail: there is one per message per person, and nothing worth auditing.
-- =====================================================================
alter table public.messenger_members add column if not exists last_delivered_at timestamptz;

create or replace function public.messenger_mark_read(p_conversation uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.messenger_members set last_read_at = greatest(last_read_at, now()), last_delivered_at = now()
    where conversation_id = p_conversation and profile_id = (select auth.uid());
  if not found then raise exception 'You are not in this chat'; end if;
end $$;

-- Marks every chat holding something new from someone else as received by the caller. Writes nothing when there is nothing new.
create or replace function public.messenger_mark_delivered() returns void
language sql security definer set search_path = public, pg_temp as $$
  update public.messenger_members me set last_delivered_at = now()
  from public.messenger_conversations c
  where c.id = me.conversation_id and c.kind in ('direct', 'group') and me.profile_id = (select auth.uid())
    and exists (select 1 from public.messenger_messages m
      where m.conversation_id = me.conversation_id and m.sender_id is distinct from me.profile_id
        and m.created_at > greatest(me.last_read_at, coalesce(me.last_delivered_at, me.last_read_at)))
$$;

-- The earliest read and delivered times among the other members. Reading a chat also counts as receiving it.
create or replace function public.messenger_receipt_state(p_conversation uuid)
returns table (read_at timestamptz, delivered_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_me uuid := (select auth.uid());
begin
  if not public.messenger_is_member(p_conversation) then raise exception 'You are not in this chat'; end if;
  return query select min(m.last_read_at), min(greatest(m.last_read_at, coalesce(m.last_delivered_at, m.last_read_at)))
    from public.messenger_members m where m.conversation_id = p_conversation and m.profile_id <> v_me;
end $$;

-- True when a Realtime topic is a chat's signal channel and the caller is in that chat.
create or replace function public.messenger_signal_allowed(p_topic text) returns boolean
language sql stable security invoker set search_path = public, pg_temp as $$
  select case when p_topic ~ '^msgr:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then public.messenger_is_member(substr(p_topic, 6)::uuid) else false end
$$;

revoke all on function public.messenger_mark_delivered(), public.messenger_receipt_state(uuid), public.messenger_signal_allowed(text) from public, anon, authenticated;
grant execute on function public.messenger_mark_delivered(), public.messenger_receipt_state(uuid), public.messenger_signal_allowed(text) to authenticated;

drop policy if exists messenger_signal_read on realtime.messages;
create policy messenger_signal_read on realtime.messages for select to authenticated
  using (extension = 'broadcast' and public.messenger_signal_allowed((select realtime.topic())));
drop policy if exists messenger_signal_send on realtime.messages;
create policy messenger_signal_send on realtime.messages for insert to authenticated
  with check (extension = 'broadcast' and public.messenger_signal_allowed((select realtime.topic())));

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_members') then
    alter publication supabase_realtime add table public.messenger_members;
  end if;
end $$;

-- The same capture function as 004b, with one added line for read and delivered times.
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
    if TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'messenger_members' and diff <@ array['last_read_at', 'last_delivered_at'] then return null; end if;
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
