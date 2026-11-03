-- Prints "ok ..." per check and stops at the first failure. Prices here are invented.
\set ON_ERROR_STOP on
create schema t;
grant usage on schema t to public;
create function t.ok(label text, good boolean) returns void language plpgsql as $$
begin
  if good is not true then raise exception 'FAILED: %', label; end if;
  raise notice 'ok %', label;
end $$;
-- Passes when the statement raises an error containing `expect`.
create function t.fails(label text, stmt text, expect text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ilike '%' || expect || '%' then raise notice 'ok %', label; return; end if;
    raise exception 'FAILED: % gave: %', label, sqlerrm;
  end;
  raise exception 'FAILED: % did not fail', label;
end $$;
create function t.n(q text) returns bigint language plpgsql as $$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
grant execute on all functions in schema t to public;

-- Data, loaded as the database owner
insert into profiles values ('00000000-0000-0000-0000-00000000000a', 'admin'), ('00000000-0000-0000-0000-00000000000b', 'member'), ('00000000-0000-0000-0000-00000000000c', 'member');
insert into member_tab_access values ('00000000-0000-0000-0000-00000000000b', 'knowledge');
insert into knowledge_entries (category_id, entry_type, title, body, status, visibility, source_ref) values
  ((select id from knowledge_categories where name = 'Visas'), 'procedure', 'Shareable Approved entry', '<p>Alpha body</p>', 'Approved', 'Shareable', 'e1'),
  ((select id from knowledge_categories where name = 'Visas'), 'checklist', 'Shareable Draft entry', '<p>Beta body</p>', 'Draft', 'Shareable', 'e2'),
  ((select id from knowledge_categories where name = 'Visas'), 'procedure', 'Internal entry', '<p>Gamma</p>', 'Draft', 'Internal', 'e3'),
  ((select id from knowledge_categories where name = 'Visas'), 'procedure', 'Deleted entry', '<p>Delta</p>', 'Draft', 'Shareable', null);
update knowledge_entries set deleted_at = now() where title = 'Deleted entry';
insert into knowledge_entries (category_id, entry_type, title, body) values
  ((select id from knowledge_categories where name = 'General'), 'plan', 'No source ref one', ''),
  ((select id from knowledge_categories where name = 'General'), 'plan', 'No source ref two', '');
insert into knowledge_price_lines (category_id, template, line_group, item, amount_aed, payee, basis, status, visibility, source_ref) values
  ((select id from knowledge_categories where name = 'Business Setup'), 'TestZone', 'Licence', 'Test licence', 1000, 'Authority', 'internal note', 'Approved', 'Shareable', 'p1'),
  ((select id from knowledge_categories where name = 'Business Setup'), 'TestZone', 'Visa', 'Test visa', 500, 'Third party', null, 'Draft', 'Internal', 'p2');

insert into banking_partners (id, bank_name) values ('10000000-0000-0000-0000-000000000001', 'Test Bank');
insert into banking_schemes (id, bank_id, scheme_name) values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Test Scheme');
insert into banking_pricing (bank_id, scheme_id, account_opening_fee, other_bank_charges, service_fee, service_fee_min, service_fee_max, source, remarks, effective_date, expiry_date) values
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 100, 10, 50, 40, 60, 'secret source', 'secret remark', current_date - 10, null),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 200, 20, 70, 60, 80, 'old', 'old', current_date - 100, current_date - 50),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 300, 30, 90, 80, 99, 'future', 'future', current_date + 30, null);
insert into service_categories (id, name, department) values ('30000000-0000-0000-0000-000000000001', 'Test group', 'Accounting');
insert into service_items (category_id, name) values ('30000000-0000-0000-0000-000000000001', 'Test bookkeeping');

-- Member with the tab
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t.ok('member reads Approved and Draft Shareable entries', t.n('select 1 from knowledge_entries where source_ref in (''e1'',''e2'')') = 2);
select t.ok('member cannot read Internal or deleted entries', t.n('select 1 from knowledge_entries where title in (''Internal entry'',''Deleted entry'')') = 0);
select t.ok('member reads Shareable price lines only', t.n('select 1 from knowledge_price_lines') = 1);
select t.ok('member reads categories', t.n('select 1 from knowledge_categories') = 6);
select t.fails('member cannot insert', 'insert into knowledge_entries (category_id, entry_type, title, body) select id, ''plan'', ''x'', '''' from knowledge_categories limit 1', 'row-level security');
with u as (update knowledge_entries set title = 'Changed' where source_ref = 'e2' returning 1)
  select t.ok('member update affects no rows', (select count(*) from u) = 0);
with u as (update knowledge_entries set status = 'Approved' where source_ref = 'e2' returning 1)
  select t.ok('member cannot approve', (select count(*) from u) = 0);
with u as (delete from knowledge_price_lines returning 1)
  select t.ok('member delete affects no rows', (select count(*) from u) = 0);
select t.ok('banking read returns the current price only', t.n('select 1 from knowledge_banking_prices()') = 1);
select t.ok('banking read leaves out the hidden columns', not exists (
  select 1 from jsonb_object_keys(to_jsonb((select p from knowledge_banking_prices() p limit 1))) k
  where k in ('service_fee_min', 'service_fee_max', 'source', 'remarks', 'bank_fee_collected_by_ab')));
select t.ok('banking read returns the current fee', (select account_opening_fee from knowledge_banking_prices()) = 100);
select t.ok('search has no Internal rows', t.n('select 1 from v_knowledge_search where visibility = ''Internal''') = 0);
select t.ok('search has banking and service rows', (select count(distinct kind) from v_knowledge_search where kind in ('banking', 'service')) = 2);
select t.ok('search has entry and price rows', (select count(distinct kind) from v_knowledge_search where kind in ('entry', 'price')) = 2);
reset role;

-- Member without the tab
select set_config('test.uid', '00000000-0000-0000-0000-00000000000c', false);
set role authenticated;
select t.ok('no-tab member reads no entries', t.n('select 1 from knowledge_entries') = 0);
select t.ok('no-tab member reads no price lines', t.n('select 1 from knowledge_price_lines') = 0);
select t.ok('no-tab member reads no categories', t.n('select 1 from knowledge_categories') = 0);
select t.ok('no-tab member gets no banking rows', t.n('select 1 from knowledge_banking_prices()') = 0);
select t.ok('no-tab member gets no search rows', t.n('select 1 from v_knowledge_search') = 0);
reset role;

-- The member's blocked update left the row as it was
select t.ok('blocked member update changed nothing', (select title = 'Shareable Draft entry' and status = 'Draft' from knowledge_entries where source_ref = 'e2'));

-- Admin
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);
set role authenticated;
select t.ok('admin reads Internal and deleted entries', t.n('select 1 from knowledge_entries') = 6);
select t.ok('admin sees Internal rows in search', t.n('select 1 from v_knowledge_search where visibility = ''Internal''') > 0);
insert into knowledge_entries (category_id, entry_type, title, body, source_ref) values ((select id from knowledge_categories where name = 'Tax'), 'client_answer', 'Admin entry', '<p>Original</p>', 'a1');
select t.ok('new entry starts as Draft and Internal', (select status || visibility from knowledge_entries where source_ref = 'a1') = 'DraftInternal');
select t.ok('insert stamps updated_by', (select updated_by from knowledge_entries where source_ref = 'a1') = '00000000-0000-0000-0000-00000000000a');
update knowledge_entries set status = 'Approved' where source_ref = 'a1';
select t.ok('approval sets approved_by and approved_at', (select approved_by is not null and approved_at is not null and status = 'Approved' from knowledge_entries where source_ref = 'a1'));
update knowledge_entries set body = '<p>Edited</p>' where source_ref = 'a1';
select t.ok('editing an Approved body returns it to Draft', (select status = 'Draft' and approved_by is null and approved_at is null from knowledge_entries where source_ref = 'a1'));
update knowledge_entries set status = 'Approved' where source_ref = 'a1';
update knowledge_entries set visibility = 'Shareable' where source_ref = 'a1';
select t.ok('changing only visibility keeps an entry Approved', (select status = 'Approved' and approved_by is not null from knowledge_entries where source_ref = 'a1'));
update knowledge_entries set title = 'Admin entry renamed' where source_ref = 'a1';
select t.ok('editing an Approved title returns it to Draft', (select status = 'Draft' from knowledge_entries where source_ref = 'a1'));

insert into knowledge_price_lines (category_id, template, line_group, item, amount_aed, source_ref, status) values ((select id from knowledge_categories where name = 'Business Setup'), 'TestZone', 'Licence', 'Admin line', 800, 'a2', 'Approved');
select t.ok('inserting an Approved line records the approver', (select approved_by is not null and approved_at is not null from knowledge_price_lines where source_ref = 'a2'));
update knowledge_price_lines set amount_aed = 900 where source_ref = 'a2';
select t.ok('changing amount_aed on an Approved line returns it to Draft', (select status = 'Draft' and approved_by is null and approved_at is null from knowledge_price_lines where source_ref = 'a2'));
update knowledge_price_lines set status = 'Approved' where source_ref = 'a2';
update knowledge_price_lines set visibility = 'Internal' where source_ref = 'a2';
update knowledge_price_lines set valid_until = current_date + 30 where source_ref = 'a2';
select t.ok('changing only visibility or valid_until keeps a line Approved', (select status = 'Approved' and approved_by is not null from knowledge_price_lines where source_ref = 'a2'));
update knowledge_price_lines set payee = 'Authority' where source_ref = 'a2';
select t.ok('changing payee on an Approved line returns it to Draft', (select status = 'Draft' from knowledge_price_lines where source_ref = 'a2'));

select t.fails('duplicate source_ref is refused', 'insert into knowledge_entries (category_id, entry_type, title, body, source_ref) select id, ''plan'', ''dup'', '''', ''a1'' from knowledge_categories limit 1', 'duplicate key');
select t.ok('several null source_refs are allowed', (select count(*) from knowledge_entries where source_ref is null) = 3);
select t.fails('negative amount is refused', 'insert into knowledge_price_lines (category_id, template, line_group, item, amount_aed) select id, ''Z'', ''Licence'', ''neg'', -1 from knowledge_categories limit 1', 'check constraint');
select t.fails('unknown status is refused', 'update knowledge_entries set status = ''Published'' where source_ref = ''a1''', 'check constraint');
select t.fails('unknown entry type is refused', 'update knowledge_entries set entry_type = ''memo'' where source_ref = ''a1''', 'check constraint');
select t.ok('admin gets the banking read', t.n('select 1 from knowledge_banking_prices()') = 1);
reset role;
-- Banking read: retired masters, same-day corrections, the default service fee and the VAT mode. All invented.
insert into banking_partners (id, bank_name, is_active, deleted_at) values
  ('10000000-0000-0000-0000-000000000002', 'Retired Bank', false, null),
  ('10000000-0000-0000-0000-000000000003', 'Deleted Bank', true, now()),
  ('10000000-0000-0000-0000-000000000004', 'Live Bank', true, null);
insert into banking_schemes (id, bank_id, scheme_name, is_active, deleted_at) values
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004', 'Retired Scheme', false, null),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000004', 'Deleted Scheme', true, now()),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'Older First', true, null),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004', 'Newer First', true, null);
insert into banking_pricing (bank_id, scheme_id, account_opening_fee, service_fee, effective_date, created_at) values
  ('10000000-0000-0000-0000-000000000002', null, 11, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000003', null, 12, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 13, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000003', 14, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', null, 15, null, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 16, 1, current_date, now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 17, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 19, 1, current_date, now()),
  ('10000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 18, 1, current_date, now() - interval '1 day');
insert into service_categories (id, name, department, is_active) values ('30000000-0000-0000-0000-000000000002', 'Retired group', 'Accounting', false);
insert into service_items (category_id, name) values ('30000000-0000-0000-0000-000000000002', 'Item in a retired group');

select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t.ok('a retired bank is not shown', t.n('select 1 from knowledge_banking_prices() where bank_name = ''Retired Bank''') = 0);
select t.ok('a deleted bank is not shown', t.n('select 1 from knowledge_banking_prices() where bank_name = ''Deleted Bank''') = 0);
select t.ok('a retired scheme is not shown', t.n('select 1 from knowledge_banking_prices() where scheme_name = ''Retired Scheme''') = 0);
select t.ok('a deleted scheme is not shown', t.n('select 1 from knowledge_banking_prices() where scheme_name = ''Deleted Scheme''') = 0);
select t.ok('a bank-level row with no scheme is kept', t.n('select 1 from knowledge_banking_prices() where bank_name = ''Live Bank'' and scheme_name is null') = 1);
select t.ok('a same-day correction replaces the older row (older inserted first)', (select account_opening_fee from knowledge_banking_prices() where scheme_name = 'Older First') = 17);
select t.ok('a same-day correction replaces the older row (newer inserted first)', (select account_opening_fee from knowledge_banking_prices() where scheme_name = 'Newer First') = 19);
select t.ok('a blank service fee stays blank with no default set', (select service_fee is null from knowledge_banking_prices() where bank_name = 'Live Bank' and scheme_name is null));
select t.ok('vat_mode falls back to inclusive with no setting', (select bool_and(vat_mode = 'inclusive') from knowledge_banking_prices()));
select t.ok('a service in a retired category is not searchable', t.n('select 1 from v_knowledge_search where kind = ''service'' and title = ''Item in a retired group''') = 0);
reset role;

insert into banking_settings (key, value) values ('default_service_fee', '777'), ('vat', '{"mode": "exclusive", "rate": 5}');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t.ok('a blank service fee uses the default', (select service_fee from knowledge_banking_prices() where bank_name = 'Live Bank' and scheme_name is null) = 777);
select t.ok('a set service fee beats the default', (select service_fee from knowledge_banking_prices() where scheme_name = 'Older First') = 1);
select t.ok('vat_mode follows the vat setting', (select bool_and(vat_mode = 'exclusive') from knowledge_banking_prices()));
reset role;
update banking_settings set value = '{"mode": "inclusive", "rate": 5}' where key = 'vat';
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
set role authenticated;
select t.ok('vat_mode reads inclusive', (select bool_and(vat_mode = 'inclusive') from knowledge_banking_prices()));
reset role;
update banking_settings set value = '{"rate": 5}' where key = 'vat';
set role authenticated;
select t.ok('vat_mode falls back to inclusive when the setting has no mode', (select bool_and(vat_mode = 'inclusive') from knowledge_banking_prices()));
reset role;

select t.ok('knowledge_touch fixes its search_path', (select array_to_string(proconfig, ',') = 'search_path=public, pg_temp' from pg_proc where oid = 'public.knowledge_touch'::regproc));

select t.ok('all checks passed', true);
