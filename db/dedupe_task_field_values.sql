-- Remove duplicate task_field_values rows (same task_id + field_id), keeping one
-- per pair. Duplicates can arise from repeated backfills (the update path treats
-- ">1 existing row" as none and inserts another), and they inflate the monthly
-- report and can compound on each run. (task_id, field_id) is meant to be unique.
--
-- Run in the Supabase SQL editor. PREVIEW first, then the DELETE.

-- ── PREVIEW: how many duplicate rows would be removed, and for which fields ──
select sf.field_name, count(*) as extra_rows_to_delete
from (
  select ctid, task_id, field_id,
         row_number() over (partition by task_id, field_id order by ctid) as rn
  from task_field_values
) d
join space_fields sf on sf.id = d.field_id
where d.rn > 1
group by sf.field_name
order by extra_rows_to_delete desc;

-- ── SAFE DELETE: only duplicates whose values are ALL IDENTICAL ──
-- Lossless — it skips any task/field whose duplicate rows disagree (those may
-- hold a manually-corrected value). Run this one.
delete from task_field_values a
using task_field_values b
where a.task_id = b.task_id
  and a.field_id = b.field_id
  and a.ctid > b.ctid
  and (a.task_id, a.field_id) not in (
    select task_id, field_id
    from task_field_values
    group by task_id, field_id
    having count(distinct value) > 1
  );

-- ── LIST the remaining CONFLICTS (different values on one task/field) ──
-- These need a human decision on which value is correct. Resolve them (fix in
-- the drawer, or UPDATE all rows to the right value) before deduping them.
select li.name as list, sf.field_name, t.title,
       array_agg(distinct tfv.value order by tfv.value) as values
from task_field_values tfv
join space_fields sf on sf.id = tfv.field_id
join tasks t on t.id = tfv.task_id
left join lists li on li.id = t.list_id
where (tfv.task_id, tfv.field_id) in (
  select task_id, field_id from task_field_values
  group by task_id, field_id having count(distinct value) > 1
)
group by li.name, sf.field_name, t.title
order by li.name, sf.field_name, t.title;

-- ── FULL DELETE (run ONLY after every conflict above is resolved) ──
-- delete from task_field_values a
-- using task_field_values b
-- where a.task_id = b.task_id and a.field_id = b.field_id and a.ctid > b.ctid;
