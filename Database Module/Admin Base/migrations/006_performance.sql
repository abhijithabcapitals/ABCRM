-- Database speed fixes. NOT APPLIED. Run only after approval; check it on a copy first.
-- No data changes and no access changes: every policy allows exactly what it allowed before.
-- Undo: rollback/006_performance_rollback.sql

begin;

-- 1. Row security: Postgres re-runs auth.uid() for every row unless it is wrapped in a select.
-- Rewrites the 90 policies the Supabase performance advisor lists. The old text is kept for rollback.
create schema if not exists optimize_rollback;
revoke all on schema optimize_rollback from public;

create table optimize_rollback.policies_006 as
  select schemaname, tablename, policyname, qual, with_check
  from pg_policies
  where schemaname not in ('auth', 'storage', 'realtime', 'vault', 'cron', 'net')
    and (qual ~ '(?<!SELECT )auth\.(uid|role|jwt)\(\)' or with_check ~ '(?<!SELECT )auth\.(uid|role|jwt)\(\)');

do $$
declare
  p record;
  wrap constant text := '(?<!SELECT )auth\.(uid|role|jwt)\(\)';
begin
  for p in select * from optimize_rollback.policies_006 loop
    if p.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename,
        regexp_replace(p.qual, wrap, '(select auth.\1())', 'g'));
    end if;
    if p.with_check is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename,
        regexp_replace(p.with_check, wrap, '(select auth.\1())', 'g'));
    end if;
  end loop;
end $$;

-- 2. The email agent's queue query averages 2.5 seconds every 10 minutes (pending_messages).
-- It filters and sorts on this expression, which no index covers.
create index if not exists messages_inbound_time_idx
  on email_base.messages ((coalesce(sent_at, created_at)))
  where direction = 'inbound';

-- 3. Two pairs of identical indexes (Supabase advisor); one of each is enough.
drop index if exists email_base.threads_assistant_search_idx;
drop index if exists public.idx_tasks_list_active;

commit;
