-- LOCAL TEST ONLY: Services & Fees categories (025). Run through tests/run-local.sh, after 210.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier tests re-run older migrations: put 015's save back, then the final state in order.
\ir ../migrations/015_documentation.sql
\ir ../migrations/022_checkpoints.sql
select public.bs_as(null);
-- Fee parts of the five older groups, with no category, as on live before 025. One item already has a category staff chose.
delete from public.business_setup_fee_items where name like 'T220 %';
insert into public.business_setup_fee_items (grp, name, default_amount, vat_rate, is_service, category) values
  ('Visa processing', 'T220 Medical', 300, 5, false, null), ('Visa renewal', 'T220 Visa Stamp', 100, 5, false, null),
  ('Visit visa', 'T220 Outside UAE, 30 days', 500, 5, true, null), ('Applications', 'T220 RERA APP', 200, 5, true, null),
  ('Mainland', 'T220 New Client', 1000, 5, true, null), ('Other things', 'T220 Courier', 50, 5, false, null),
  ('Mainland', 'T220 Chosen', 10, 5, true, 'Corporate Compliance');
update public.business_setup_fee_items set category = null where checkpoint_set_id is not null;
create temp table pre025 as select md5(replace(pg_get_functiondef('public.business_setup_fee_item_save(jsonb)'::regprocedure), E'', '')) || coalesce((select proacl::text from pg_proc where oid = 'public.business_setup_fee_item_save(jsonb)'::regprocedure), '') v;
\ir ../migrations/025_fee_categories.sql
create function pg_temp.cat(p_name text) returns text language sql as $$ select category from public.business_setup_fee_items where name = p_name $$;

-- ── Backfill ──
select public.bs_check('linked items take their checklist''s category',
  (select count(*) = 45 and bool_and(f.category = cs.category) from public.business_setup_fee_items f join public.business_setup_checkpoint_sets cs on cs.id = f.checkpoint_set_id));
select public.bs_check('older groups map as chosen',
  pg_temp.cat('T220 Medical') = 'Visa & Immigration' and pg_temp.cat('T220 Visa Stamp') = 'Visa & Immigration' and pg_temp.cat('T220 Outside UAE, 30 days') = 'Visa & Immigration'
  and pg_temp.cat('T220 RERA APP') = 'Trade License & Approvals' and pg_temp.cat('T220 New Client') = 'Company Formation',
  (select string_agg(name || '=' || coalesce(category, 'null'), ', ') from public.business_setup_fee_items where name like 'T220 %'));
select public.bs_check('another group keeps its group as category', pg_temp.cat('T220 Courier') = 'Other things');
select public.bs_check('a category already set is kept', pg_temp.cat('T220 Chosen') = 'Corporate Compliance');
select public.bs_check('nothing renamed or repriced', (select count(*) = 7 and sum(default_amount) = 2160 from public.business_setup_fee_items where name like 'T220 %' and grp in ('Visa processing', 'Visa renewal', 'Visit visa', 'Applications', 'Mainland', 'Other things')));
select public.bs_check('every item has a category', not exists (select 1 from public.business_setup_fee_items where category is null));
\ir ../migrations/025_fee_categories.sql
select public.bs_check('re-run changes nothing', pg_temp.cat('T220 Chosen') = 'Corporate Compliance' and pg_temp.cat('T220 Medical') = 'Visa & Immigration');

-- ── Save ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"G","name":"T220 X","category":"C"}')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_fee_item_save(jsonb_build_object('id', (select id from public.business_setup_fee_items where name = 'T220 Medical'), 'grp', 'Visa processing', 'name', 'T220 Medical', 'category', 'Corporate Compliance'));
select public.bs_check('save sets the category', pg_temp.cat('T220 Medical') = 'Corporate Compliance');
select public.business_setup_fee_item_save(jsonb_build_object('id', (select id from public.business_setup_fee_items where name = 'T220 Medical'), 'grp', 'Visa processing', 'name', 'T220 Medical', 'default_amount', 350));
select public.bs_check('save without the key keeps it', pg_temp.cat('T220 Medical') = 'Corporate Compliance' and (select default_amount = 350 from public.business_setup_fee_items where name = 'T220 Medical'));
select public.bs_expect_error($$select public.business_setup_fee_item_save('{"grp":"G","name":"T220 Y","category":" "}')$$, 'category is required');
select public.business_setup_fee_item_save('{"grp":"T220 group","name":"T220 New"}');
select public.bs_check('a new item without a category takes its group', pg_temp.cat('T220 New') = 'T220 group');
select public.business_setup_fee_item_save('{"grp":"T220 group","name":"T220 New2","category":"Business Banking"}');
select public.bs_check('a new item takes the category given', pg_temp.cat('T220 New2') = 'Business Banking');
select public.bs_as(null);
select public.bs_check('the column stays readable to staff', has_column_privilege('authenticated', 'public.business_setup_fee_items', 'category', 'select'));
delete from public.business_setup_fee_items where name like 'T220 %';

-- ── Rollback ──
\ir ../rollback/025_rollback.sql
select public.bs_check('rollback: 015''s save and grants come back, the column goes',
  (select v from pre025) = md5(replace(pg_get_functiondef('public.business_setup_fee_item_save(jsonb)'::regprocedure), E'', '')) || coalesce((select proacl::text from pg_proc where oid = 'public.business_setup_fee_item_save(jsonb)'::regprocedure), '')
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'business_setup_fee_items' and column_name = 'category'),
  (select v from pre025) || ' / ' || md5(replace(pg_get_functiondef('public.business_setup_fee_item_save(jsonb)'::regprocedure), E'', '')) || coalesce((select proacl::text from pg_proc where oid = 'public.business_setup_fee_item_save(jsonb)'::regprocedure), '')
  || ' / column ' || (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'business_setup_fee_items' and column_name = 'category'));
\ir ../migrations/025_fee_categories.sql
select public.bs_check('applies again after rollback', not exists (select 1 from public.business_setup_fee_items where category is null));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
