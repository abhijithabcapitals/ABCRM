-- TEMPLATE: add extra custom fields (created_time, Row Number, …) to any lead
-- list, so the ingest pipeline + monthly report can use them. Copy this block,
-- edit the three names at the top and the fields list, and run it in the
-- Supabase SQL editor. Idempotent — re-running skips fields that already exist.
--
-- HOW TO USE for another sheet:
--   1. Set p_list / p_folder / p_space to that sheet's target list (the CTE).
--   2. In the VALUES list, keep the fields you want. Types:
--        created_time → date   (Edge Function slices ISO datetime to the day)
--        Row Number   → number
--        anything else → text / phone / number / date as appropriate
--   3. Run it, check the verify query, then do the Apps Script steps.

with l as (
  select li.id as list_id, li.space_id
  from lists li
  join folders f on f.id = li.folder_id
  join spaces  s on s.id = li.space_id
  where li.name = 'New Zap Lead 26'      -- ← EDIT: target list name
    and f.name  = 'Advertising'          -- ← EDIT: its folder
    and s.name  = 'Marketing Leads'      -- ← EDIT: its space
    and li.deleted_at is null and f.deleted_at is null and s.deleted_at is null
  limit 1
)
insert into space_fields (space_id, folder_id, list_id, field_name, field_type, field_order)
select l.space_id, null, l.list_id, v.name, v.type,
       coalesce((select max(field_order) from space_fields where list_id = l.list_id), 0) + v.ord
from l
cross join (values
  ('created_time', 'date',   1),   -- ← EDIT / add rows: (field name, type, order offset)
  ('Row Number',   'number', 2)
) as v(name, type, ord)
where not exists (
  select 1 from space_fields sf
  where sf.list_id = l.list_id and lower(sf.field_name) = lower(v.name)
);

-- Verify what the target list now has:
select sf.field_name, sf.field_type, sf.field_order
from space_fields sf
join lists li on li.id = sf.list_id
where li.name = 'New Zap Lead 26'          -- ← EDIT: same list name
order by sf.field_order;
