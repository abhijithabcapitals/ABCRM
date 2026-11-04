-- Undoes 006_calls.sql. Deletes all call history and missed-call activity.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messenger_calls') then
    alter publication supabase_realtime drop table public.messenger_calls;
  end if;
end $$;
delete from public.messenger_activity where kind = 'missed_call';
drop table if exists public.messenger_call_participants;
drop table if exists public.messenger_calls cascade;
drop function if exists public.messenger_in_call(uuid);
drop function if exists public.messenger_finish_call(uuid, text);
drop function if exists public.messenger_close_stale_calls(uuid);
drop function if exists public.messenger_person_left(uuid, uuid);
drop function if exists public.messenger_start_call(uuid, text);
drop function if exists public.messenger_answer_call(uuid);
drop function if exists public.messenger_decline_call(uuid);
drop function if exists public.messenger_leave_call(uuid);
drop function if exists public.messenger_ring_timeout(uuid);
drop function if exists public.messenger_calls_ringing();
drop function if exists public.messenger_call_history(int);
drop function if exists public.messenger_call_for_token(uuid);
drop function if exists public.messenger_call_event(text, text, text);

alter table public.messenger_activity alter column message_id set not null;
alter table public.messenger_activity drop constraint if exists messenger_activity_kind_check;
alter table public.messenger_activity add constraint messenger_activity_kind_check check (kind in ('mention', 'reply', 'reaction'));

create or replace function public.messenger_activity_list(p_limit int default 50)
returns table (id uuid, kind text, actor_name text, conversation_id uuid, message_id uuid, preview text, detail text, read_at timestamptz, created_at timestamptz,
               conversation_kind text, conversation_title text, parent_id uuid)
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id, a.kind, p.full_name, a.conversation_id, a.message_id, left(m.body, 200), a.detail, a.read_at, a.created_at, v.kind, v.title, m.parent_id
  from public.messenger_activity a
  join public.messenger_messages m on m.id = a.message_id
  join public.messenger_members me on me.conversation_id = a.conversation_id and me.profile_id = a.profile_id
  join public.messenger_conversations v on v.id = a.conversation_id
  left join public.profiles p on p.id = a.actor_id
  where a.profile_id = (select auth.uid())
  order by a.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
