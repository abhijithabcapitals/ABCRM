-- Undoes 006_performance.sql: restores each policy's old text and removes the new index.
-- threads_assistant_search_idx and idx_tasks_list_active stay dropped: their identical twins
-- email_base_threads_assistant_search_idx and idx_tasks_active_list do the same work.

begin;

do $$
declare
  p record;
begin
  for p in select * from optimize_rollback.policies_006 loop
    if p.qual is not null then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, p.qual);
    end if;
    if p.with_check is not null then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, p.with_check);
    end if;
  end loop;
end $$;

drop index if exists email_base.messages_inbound_time_idx;
drop schema optimize_rollback cascade;

commit;
