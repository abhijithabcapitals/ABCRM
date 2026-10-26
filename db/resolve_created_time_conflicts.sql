-- Resolve tasks that have CONFLICTING created_time rows (more than one distinct
-- value — leftovers from repeated backfills, e.g. 543641771 with 2026-08-12 /
-- 2026-08-13 / 2026-09-12). Collapse each such task to a SINGLE created_time =
-- its CRM creation day (date of created_at).
--
-- Scope: ONLY tasks whose created_time rows disagree. Tasks with a single
-- (correct) created_time are left completely untouched. Trigger disabled around
-- the write so task_history isn't flooded.
--
-- Run in the Supabase SQL editor. PREVIEW first.

-- ── PREVIEW: the conflicting tasks and the value they'll get ──
with conflict as (
  select tfv.task_id, sf.id as field_id
  from task_field_values tfv
  join space_fields sf on sf.id = tfv.field_id and lower(sf.field_name) = 'created_time'
  group by tfv.task_id, sf.id
  having count(distinct tfv.value) > 1
)
select li.name as list, t.title,
       array_agg(distinct tfv.value order by tfv.value) as current_values,
       to_char(t.created_at, 'YYYY-MM-DD') as will_become
from conflict c
join tasks t on t.id = c.task_id
join task_field_values tfv on tfv.task_id = c.task_id and tfv.field_id = c.field_id
left join lists li on li.id = t.list_id
group by li.name, t.title, t.created_at
order by li.name, t.title;

-- ── APPLY (uncomment the whole block to run) ──
-- Capture the conflicting (task, field) pairs FIRST, then delete their rows and
-- re-insert one row = date(created_at).
-- begin;
-- alter table task_field_values disable trigger trg_abcap_log_field_change;
--
-- create temp table _ct_conflicts on commit drop as
--   select t.id as task_id, sf.id as field_id, t.created_at
--   from tasks t
--   join space_fields sf on sf.list_id = t.list_id and lower(sf.field_name) = 'created_time'
--   where t.id in (
--     select tfv.task_id
--     from task_field_values tfv
--     join space_fields s2 on s2.id = tfv.field_id and lower(s2.field_name) = 'created_time'
--     group by tfv.task_id
--     having count(distinct tfv.value) > 1
--   );
--
-- delete from task_field_values tfv
-- using _ct_conflicts c
-- where tfv.task_id = c.task_id and tfv.field_id = c.field_id;
--
-- insert into task_field_values (task_id, field_id, value)
-- select task_id, field_id, to_char(created_at, 'YYYY-MM-DD') from _ct_conflicts;
--
-- alter table task_field_values enable trigger trg_abcap_log_field_change;
-- commit;
