-- Relabel the month dropdowns in Monthly Accounting from "25-Jan" to "Jan-2025".
-- Rewrites BOTH the field option list (space_fields.field_options) and every
-- saved task value (task_field_values.value) for these three fields:
--   Data Received till, Payment received till, Invoice sent till
--
-- Run in the Supabase SQL editor. Idempotent + safe to re-run:
--   * only values matching NN-<month> are converted (Discontinued etc. untouched)
--   * already-converted values (Jan-2025) don't match and are skipped
-- Scoped to the list named 'Monthly Accounting' so no other dropdown is affected.

-- Converter: 'NN-Mon' -> 'Mon-20NN'; anything else returned unchanged.
create or replace function _abcap_month_relabel(v text)
returns text language sql immutable as $$
  select case
    when v ~* '^\d{2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$'
      then initcap(split_part(v, '-', 2)) || '-20' || split_part(v, '-', 1)
    else v
  end;
$$;

-- ── PREVIEW (optional): distinct values that will NOT be converted ──
-- Run this first to eyeball anything unexpected. Empty (or just "Discontinued")
-- means every real month value will convert cleanly.
select distinct v.value as wont_convert
from task_field_values v
where v.field_id in (
    select f.id
    from space_fields f
    join lists l on l.id = f.list_id
    where lower(trim(l.name)) = 'monthly accounting'
      and lower(trim(f.field_name)) in
        ('data received till', 'payment received till', 'invoice sent till')
  )
  and v.value is not null
  and v.value <> ''
  and _abcap_month_relabel(v.value) = v.value            -- unchanged by converter
  and v.value !~* '^[a-z]{3}-20\d{2}$'                   -- not already converted
order by 1;

-- ── 1) Rewrite the option lists ──
update space_fields f
set field_options = (
  select jsonb_agg(to_jsonb(_abcap_month_relabel(elem)))
  from jsonb_array_elements_text(f.field_options) elem
)
where f.id in (
    select f2.id
    from space_fields f2
    join lists l on l.id = f2.list_id
    where lower(trim(l.name)) = 'monthly accounting'
      and lower(trim(f2.field_name)) in
        ('data received till', 'payment received till', 'invoice sent till')
  )
  and f.field_options is not null
  and jsonb_typeof(f.field_options) = 'array';

-- ── 2) Rewrite the stored task values ──
update task_field_values v
set value = _abcap_month_relabel(v.value)
where v.field_id in (
    select f.id
    from space_fields f
    join lists l on l.id = f.list_id
    where lower(trim(l.name)) = 'monthly accounting'
      and lower(trim(f.field_name)) in
        ('data received till', 'payment received till', 'invoice sent till')
  )
  and v.value ~* '^\d{2}-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$';

-- Optional cleanup once you're happy:
-- drop function if exists _abcap_month_relabel(text);
