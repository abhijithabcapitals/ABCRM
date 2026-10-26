-- Add two custom fields to the "New Zap Lead 26" list (Marketing Leads ▸
-- Advertising) so the lead-ingest pipeline can store them:
--   created_time  (date)   — the sheet's created_time; the Edge Function slices
--                            the ISO datetime (2026-06-19T12:14:49-05:00) down
--                            to the date (2026-06-19), shown as 19-06-2026.
--   Row Number    (number) — the source spreadsheet row index
--
-- The create-lead-task Edge Function maps incoming fields to CRM fields BY NAME
-- (case-insensitive), so these names must match the payload exactly. Idempotent:
-- re-running skips fields that already exist.
--
-- Run in the Supabase SQL editor.

with l as (
  select li.id as list_id, li.space_id
  from lists li
  join folders f on f.id = li.folder_id
  join spaces  s on s.id = li.space_id
  where li.name = 'New Zap Lead 26' and li.deleted_at is null
    and f.name  = 'Advertising'      and f.deleted_at is null
    and s.name  = 'Marketing Leads'  and s.deleted_at is null
  limit 1
)
insert into space_fields (space_id, folder_id, list_id, field_name, field_type, field_order)
select l.space_id, null, l.list_id, v.name, v.type,
       coalesce((select max(field_order) from space_fields where list_id = l.list_id), 0) + v.ord
from l
cross join (values ('created_time', 'date', 1),
                   ('Row Number',   'number', 2)) as v(name, type, ord)
where not exists (
  select 1 from space_fields sf
  where sf.list_id = l.list_id and lower(sf.field_name) = lower(v.name)
);

-- If created_time was already created as text in an earlier run, fix its type:
update space_fields sf
set field_type = 'date'
from lists li
where li.id = sf.list_id and li.name = 'New Zap Lead 26' and li.deleted_at is null
  and lower(sf.field_name) = 'created_time' and sf.field_type <> 'date';

-- Verify:
select sf.field_name, sf.field_type, sf.field_order
from space_fields sf
join lists li on li.id = sf.list_id
where li.name = 'New Zap Lead 26' and li.deleted_at is null
order by sf.field_order;
