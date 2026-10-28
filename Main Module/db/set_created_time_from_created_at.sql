-- Set created_time = the task's CRM creation day (date of tasks.created_at) for
-- every task in a list that has a created_time field. This replaces the old
-- approach of pulling created_time from the Google Sheet (whose ambiguous
-- dd/mm vs mm/dd formats caused swapped dates), and collapses any duplicate
-- created_time rows to a single correct one.
--
-- ⚠️ This OVERWRITES existing created_time values (including any you corrected
-- by hand) with date(created_at). That's the intended new behavior.
--
-- Run in the Supabase SQL editor. The trigger is disabled around the bulk write
-- so it doesn't flood task_history with one entry per task.

begin;

alter table task_field_values disable trigger trg_abcap_log_field_change;

-- Remove all existing created_time value rows (dedupes at the same time).
delete from task_field_values tfv
using space_fields sf
where tfv.field_id = sf.id and lower(sf.field_name) = 'created_time';

-- Insert exactly one created_time row per active task, = its creation day.
insert into task_field_values (task_id, field_id, value)
select t.id, sf.id, to_char(t.created_at, 'YYYY-MM-DD')
from space_fields sf
join tasks t on t.list_id = sf.list_id and t.deleted_at is null
where lower(sf.field_name) = 'created_time';

alter table task_field_values enable trigger trg_abcap_log_field_change;

commit;

-- Verify (WA POP UP): counts should now match the sidebar, none Undated.
-- select case when tfv.value ~ '^\d{4}-\d{2}' then substr(tfv.value,1,7) else 'Undated' end as ym,
--        count(*)
-- from task_field_values tfv
-- join space_fields sf on sf.id = tfv.field_id
-- join tasks t on t.id = tfv.task_id
-- join lists li on li.id = t.list_id
-- where li.name = 'WA POP UP' and lower(sf.field_name) = 'created_time'
-- group by 1 order by 1;
