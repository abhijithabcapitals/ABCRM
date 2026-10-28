-- Add an "Alternate Number" (phone) custom field to the "New Zap Lead 26" list
-- (Marketing Leads ▸ Advertising). The lead-ingest pipeline maps the sheet's
-- `phone_number` column onto this field by name. Idempotent.
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
select l.space_id, null, l.list_id, 'Alternate Number', 'phone',
       coalesce((select max(field_order) from space_fields where list_id = l.list_id), 0) + 1
from l
where not exists (
  select 1 from space_fields sf
  where sf.list_id = l.list_id and lower(sf.field_name) = 'alternate number'
);

-- Verify:
select sf.field_name, sf.field_type, sf.field_order
from space_fields sf
join lists li on li.id = sf.list_id
where li.name = 'New Zap Lead 26' and li.deleted_at is null
order by sf.field_order;
