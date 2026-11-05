-- Compliance register and its expiry alerts (Phase 2, Task 1). Prints "ok ..." per check and stops at the first failure.
-- Runs after 010 to 050. Figures from the functions are compared with counts taken straight from the tables as postgres, before "set role".
\set ON_ERROR_STOP on

select (now() at time zone 'Asia/Dubai')::date as today \gset
select '00000000-0000-0000-0000-0000000006a1'::uuid as adm, '00000000-0000-0000-0000-0000000006a2'::uuid as mem,
       '00000000-0000-0000-0000-0000000006a3'::uuid as clk, '00000000-0000-0000-0000-0000000006a4'::uuid as mgr,
       '00000000-0000-0000-0000-0000000006a5'::uuid as own \gset

insert into profiles (id, full_name, email, role) values
  (:'adm', 'Reg Admin', 'regadmin@x', 'admin'), (:'mem', 'Reg Plain Member', 'regmem@x', 'member'),
  (:'clk', 'Reg Clients Member', 'regclk@x', 'member'), (:'mgr', 'Reg Manager', 'regmgr@x', 'member'),
  (:'own', 'Reg Owner', 'regown@x', 'member');
insert into member_tab_access (profile_id, tab_key) values (:'clk', 'clients'), (:'mem', 'hr');
insert into banking_user_roles (user_id, role) values (:'mgr', 'MANAGER');
insert into client_master (client_id, legal_name, data) values
  ('R1', 'Register One LLC', '{}'), ('R2', 'Register Two LLC', '{}'), ('RL', 'Register Closed LLC', '{}');
insert into business_setup_kyc_profiles (client_id, client_status) values ('R1', 'Active'), ('R2', 'Active'), ('RL', 'LIQUIDATED');
insert into client_owners (client_id, department, owner_id) values ('R1', 'Business Setup', :'own');
update alert_settings set value = '"Triage"' where key = 'alert_mode';

-- ═══ Seed ════════════════════════════════════════════════════════════
select t.ok('nine compliance rules seeded with the ruled steps', (select count(*) = 9 from alert_rules where code like 'compliance\_%'
  and department = 'Business Setup'
  and ((category = 'Ejari & Establishment Card' and code in ('compliance_establishment_card', 'compliance_ejari', 'compliance_office_lease', 'compliance_immigration_file', 'compliance_labour_establishment')
        and steps = '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":-1,"priority":"Critical"}]'::jsonb)
    or (category = 'Visa & Emirates ID' and code in ('compliance_emirates_id', 'compliance_passport', 'compliance_dependent_visa', 'compliance_work_permit')
        and steps = '[{"days":90,"priority":"Medium"},{"days":60,"priority":"Medium"},{"days":30,"priority":"High"},{"days":15,"priority":"High"},{"days":7,"priority":"High"},{"days":-1,"priority":"Critical"}]'::jsonb))));
select steps as pass_steps from alert_rules where code = 'compliance_passport' \gset
update alert_rules set steps = '[{"days":5,"priority":"Normal"}]' where code = 'compliance_passport';
\ir ../migrations/006_compliance_register.sql
select t.ok('reapply keeps edited compliance steps', (select steps = '[{"days":5,"priority":"Normal"}]'::jsonb from alert_rules where code = 'compliance_passport'));
update alert_rules set steps = :'pass_steps' where code = 'compliance_passport';
select t.ok('rules have no browser-callable wrappers', (select count(*) = 9 and bool_and(not has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute'))
  from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'alert\_rule\_compliance\_%'));
select t.ok('the candidate function is not browser-callable', not has_function_privilege('authenticated', 'alert_compliance_candidates(text)', 'execute')
  and not has_function_privilege('anon', 'alert_compliance_candidates(text)', 'execute'));

-- ═══ Permission ══════════════════════════════════════════════════════
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select t.ok('a member with the Clients tab may use the register', client_compliance_can_read() and client_compliance_can_write());
select client_compliance_save(jsonb_build_object('client_id', 'R1', 'item_type', 'Passport', 'person_name', 'Zed Ref', 'reference', 'REF-9X7Q-SECRET',
  'issue_date', (:'today'::date - 3000)::text, 'expiry_date', (:'today'::date + 30)::text, 'source', 'Client copy')) as s1 \gset
select client_compliance_save(jsonb_build_object('client_id', 'R1', 'item_type', 'Establishment card', 'expiry_date', (:'today'::date - 5)::text)) as s2 \gset
reset role;
select t.ok('save stored the entry as given', (select client_id = 'R1' and item_type = 'Passport' and person_name = 'Zed Ref' and reference = 'REF-9X7Q-SECRET'
  and expiry_date = :'today'::date + 30 and status = 'Active' and source = 'Client copy' and created_by = :'clk' and updated_by = :'clk'
  from client_compliance_items where id = :'s1'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';

select t.fails('unknown client refused', $q$select client_compliance_save('{"client_id": "NOPE", "item_type": "Passport"}')$q$, 'Unknown client');
select t.fails('missing client refused', $q$select client_compliance_save('{"item_type": "Passport"}')$q$, 'Unknown client');
select t.fails('unknown type refused', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Driving licence"}')$q$, 'Unknown item type');
select t.fails('expiry before issue refused', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Passport", "issue_date": "2026-05-01", "expiry_date": "2026-04-30"}')$q$, 'before the issue date');
select t.fails('an impossible date is refused', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Passport", "expiry_date": "2026-13-45"}')$q$, 'real dates');
select t.fails('garbage date is refused', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Passport", "expiry_date": "soon"}')$q$, 'real dates');
select t.fails('an update that makes expiry precede the stored issue date is refused',
  format($q$select client_compliance_save('{"id": "%s", "expiry_date": "1990-01-01"}')$q$, :'s1'), 'before the issue date');
select t.fails('a save cannot close an entry', format($q$select client_compliance_save('{"id": "%s", "status": "Closed"}')$q$, :'s1'), 'Use Close');
select t.fails('an odd status is refused', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Passport", "status": "Maybe"}')$q$, 'Active or Closed');
select t.fails('an unknown id is refused', $q$select client_compliance_save('{"id": "00000000-0000-0000-0000-00000000dead", "client_id": "R1", "item_type": "Passport"}')$q$, 'does not exist');
select t.fails('a non-uuid id is refused', $q$select client_compliance_save('{"id": "abc", "client_id": "R1", "item_type": "Passport"}')$q$, 'not valid');
select t.fails('an array is refused', $q$select client_compliance_save('[]')$q$, 'JSON object');

-- Update touches only the keys sent
select client_compliance_save(jsonb_build_object('id', :'s1', 'notes', 'Renewal asked')) as s1b \gset
select t.ok('update returns the same id', :'s1b' = :'s1');
reset role;
select t.ok('update changed the notes and kept the rest', (select notes = 'Renewal asked' and reference = 'REF-9X7Q-SECRET' and expiry_date = :'today'::date + 30 and person_name = 'Zed Ref'
  from client_compliance_items where id = :'s1'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';

-- Import: partial success
select client_compliance_import(jsonb_build_array(
  jsonb_build_object('client_id', 'R2', 'item_type', 'Ejari', 'person_name', 'Imp good 1', 'expiry_date', (:'today'::date + 300)::text),
  jsonb_build_object('client_id', 'NOPE', 'item_type', 'Ejari'),
  jsonb_build_object('client_id', 'R2', 'item_type', 'Ejari', 'person_name', 'Imp good 2', 'expiry_date', (:'today'::date + 301)::text),
  jsonb_build_object('client_id', 'R2', 'item_type', 'Nonsense'))) as imp \gset
select t.ok('import saves the good rows and reports the bad ones by position',
  (:'imp'::jsonb->>'saved')::int = 2 and jsonb_array_length(:'imp'::jsonb->'errors') = 2
  and (:'imp'::jsonb->'errors'->0->>'row')::int = 2 and (:'imp'::jsonb->'errors'->0->>'error') like '%Unknown client%'
  and (:'imp'::jsonb->'errors'->1->>'row')::int = 4 and (:'imp'::jsonb->'errors'->1->>'error') like '%Unknown item type%');
reset role;
select t.ok('the good import rows are in the table', (select count(*) = 2 from client_compliance_items where person_name like 'Imp good%'));
select jsonb_agg(jsonb_build_object('client_id', 'R2', 'item_type', 'Ejari', 'person_name', 'Page ' || lpad(g::text, 2, '0'), 'expiry_date', (:'today'::date + 400 + g)::text)) as rows12
from generate_series(1, 12) g \gset
select jsonb_agg(jsonb_build_object('client_id', 'R2', 'item_type', 'Ejari', 'expiry_date', (:'today'::date + 400)::text)) as rows501
from generate_series(1, 501) g \gset
select count(*) as before501 from client_compliance_items \gset
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_import(:'rows12'::jsonb) as imp12 \gset
select t.ok('twelve rows import', (:'imp12'::jsonb->>'saved')::int = 12 and jsonb_array_length(:'imp12'::jsonb->'errors') = 0);
select t.fails('501 rows are refused', format($q$select client_compliance_import(%L::jsonb)$q$, :'rows501'), 'at most 500');
select t.fails('a non-array import is refused', $q$select client_compliance_import('{"a": 1}')$q$, 'JSON array');
select client_compliance_import('[]') as imp0 \gset
select t.ok('an empty import saves nothing and fails nothing', (:'imp0'::jsonb->>'saved')::int = 0 and :'imp0'::jsonb->'errors' = '[]'::jsonb);
reset role;
select t.ok('the refused 501-row call saved nothing', (select count(*) = :before501 + 12 from client_compliance_items));

-- List: independent counts first
select count(*) as n_r2_ejari from client_compliance_items where client_id = 'R2' and item_type = 'Ejari' and status = 'Active' \gset
select count(*) as n_active from client_compliance_items where status = 'Active' \gset
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_list('R2', 'Ejari', 'Active', 5, 0) as l1 \gset
select client_compliance_list('R2', 'Ejari', 'Active', 5, 10) as l3 \gset
select client_compliance_list() as l_all \gset
select t.ok('list page 1 holds the limit and the true total', jsonb_array_length(:'l1'::jsonb->'rows') = 5 and (:'l1'::jsonb->>'total')::int = :n_r2_ejari);
select t.ok('list pages by offset', jsonb_array_length(:'l3'::jsonb->'rows') = :n_r2_ejari - 10 and (:'l3'::jsonb->>'total')::int = :n_r2_ejari);
select t.ok('list rows carry the client name, in expiry order', (select bool_and(r->>'client_name' = 'Register Two LLC') from jsonb_array_elements(:'l1'::jsonb->'rows') r)
  and (select array_agg(r->>'expiry_date' order by o) = array_agg(r->>'expiry_date' order by r->>'expiry_date') from jsonb_array_elements(:'l1'::jsonb->'rows') with ordinality x(r, o)));
select t.ok('the default list is every Active entry', (:'l_all'::jsonb->>'total')::int = :n_active);
select t.ok('limit zero or negative still returns one row, an offset past the end none',
  jsonb_array_length(client_compliance_list('R2', 'Ejari', 'Active', 0, 0)->'rows') = 1
  and jsonb_array_length(client_compliance_list('R2', 'Ejari', 'Active', -4, 0)->'rows') = 1
  and jsonb_array_length(client_compliance_list('R2', 'Ejari', 'Active', 5, 1000)->'rows') = 0);
select t.fails('list refuses an odd status', $q$select client_compliance_list(null, null, 'Maybe')$q$, 'Active, Closed or All');
reset role;
-- The cap needs more than 500 rows: a type with no rule, removed again below.
insert into client_compliance_items (client_id, item_type, expiry_date)
select 'R2', 'KYC document', :'today'::date + 500 + g from generate_series(1, 520) g;
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_list('R2', 'KYC document', 'Active', 1000, 0) as l_cap \gset
select t.ok('the limit is capped at 500 inside the function', jsonb_array_length(:'l_cap'::jsonb->'rows') = 500 and (:'l_cap'::jsonb->>'total')::int = 520);
reset role;
delete from client_compliance_items where item_type = 'KYC document';

-- Close
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_save(jsonb_build_object('client_id', 'R1', 'item_type', 'Ejari', 'expiry_date', (:'today'::date + 30)::text, 'notes', 'First note')) as s3 \gset
select client_compliance_save(jsonb_build_object('client_id', 'R1', 'item_type', 'Ejari', 'person_name', 'Lease A', 'expiry_date', (:'today'::date + 20)::text)) as s4 \gset
select t.fails('close needs a reason (empty)', format($q$select client_compliance_close(%L, '')$q$, :'s3'), 'reason is required');
select t.fails('close needs a reason (blank)', format($q$select client_compliance_close(%L, '   ')$q$, :'s3'), 'reason is required');
select t.fails('close needs a reason (null)', format($q$select client_compliance_close(%L, null)$q$, :'s3'), 'reason is required');
select t.fails('close of an unknown entry is refused', $q$select client_compliance_close('00000000-0000-0000-0000-00000000dead', 'x')$q$, 'does not exist');
reset role;
select t.ok('the refused closes changed nothing', (select status = 'Active' and notes = 'First note' from client_compliance_items where id = :'s3'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_close(:'s3', 'Lease ended') \gset
reset role;
select t.ok('close sets status, keeps the old notes and appends the dated reason', (select status = 'Closed' and notes = 'First note' || E'\n' || 'Closed ' || :'today' || ': Lease ended' and updated_by = :'clk'
  from client_compliance_items where id = :'s3'));
select count(*) as n_closed from client_compliance_items where status = 'Closed' \gset
select count(*) as n_active2 from client_compliance_items where status = 'Active' \gset
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select t.ok('the default list leaves closed entries out, Closed and All show them',
  (client_compliance_list()->>'total')::int = :n_active2 and (client_compliance_list(null, null, 'Closed')->>'total')::int = :n_closed
  and (client_compliance_list(null, null, 'All')->>'total')::int = :n_active2 + :n_closed);
-- A closed entry may be reopened by a save
select client_compliance_save(jsonb_build_object('id', :'s3', 'status', 'Active')) as s3r \gset
reset role;
select t.ok('a save may reopen a closed entry', (select status = 'Active' from client_compliance_items where id = :'s3'));
update client_compliance_items set status = 'Closed', notes = notes || E'\nClosed again' where id = :'s3';

-- Who may not
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a2';
select t.ok('a member with no Clients tab may not use the register', not client_compliance_can_read() and not client_compliance_can_write());
select t.fails('untagged member cannot save', $q$select client_compliance_save('{"client_id": "R1", "item_type": "Passport"}')$q$, 'permission');
select t.fails('untagged member cannot close', format($q$select client_compliance_close(%L, 'x')$q$, :'s4'), 'permission');
select t.fails('untagged member cannot import', $q$select client_compliance_import('[]')$q$, 'permission');
select t.fails('untagged member cannot list', $q$select client_compliance_list()$q$, 'permission');
select t.ok('untagged member reads no rows from the table', (select count(*) = 0 from client_compliance_items));
select t.fails('no browser role may write the table', $q$insert into client_compliance_items (client_id, item_type) values ('R1', 'Passport')$q$, 'permission denied');
select t.fails('no browser role may update the table', $q$update client_compliance_items set notes = 'x'$q$, 'permission denied');
select t.fails('no browser role may delete from the table', $q$delete from client_compliance_items$q$, 'permission denied');
select t.ok('alert_my_access says the untagged member cannot register', (alert_my_access()->>'can_register')::boolean = false);
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select t.ok('the Clients tab member reads the table through the policy', (select count(*) > 0 from client_compliance_items));
select t.ok('alert_my_access says the Clients tab member can register', (alert_my_access()->>'can_register')::boolean = true);
set test.uid = '00000000-0000-0000-0000-0000000006a4';
select t.ok('a tagged Manager may use the register', client_compliance_can_read() and client_compliance_can_write() and jsonb_array_length(client_compliance_list(null, null, 'All', 1, 0)->'rows') = 1
  and (alert_my_access()->>'can_register')::boolean);
set test.uid = '00000000-0000-0000-0000-0000000006a1';
select t.ok('an admin may use the register', client_compliance_can_read() and client_compliance_can_write() and (alert_my_access()->>'can_register')::boolean);
reset test.uid;
select t.ok('nobody signed in may use the register', not client_compliance_can_read() and not client_compliance_can_write());
set role anon;
select t.fails('anon cannot read the table', $q$select * from client_compliance_items$q$, 'permission denied');
select t.fails('anon cannot call save', $q$select client_compliance_save('{}')$q$, 'permission denied');
select t.fails('anon cannot call list', $q$select client_compliance_list()$q$, 'permission denied');
select t.fails('anon cannot call close', $q$select client_compliance_close(gen_random_uuid(), 'x')$q$, 'permission denied');
select t.fails('anon cannot call import', $q$select client_compliance_import('[]')$q$, 'permission denied');
select t.fails('anon cannot call the permission helper', $q$select client_compliance_can_read()$q$, 'permission denied');
reset role;

-- Exact grants: the six register functions, nothing else
select t.ok('authenticated runs exactly the six register functions',
  (select count(*) = 6 and array_agg(proname::text order by proname) = array['client_compliance_can_read', 'client_compliance_can_write', 'client_compliance_close',
     'client_compliance_import', 'client_compliance_list', 'client_compliance_save']
   from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'client\_compliance\_%' and has_function_privilege('authenticated', p.oid, 'execute')));
select t.ok('anon and public run no register function', (select count(*) >= 7 and bool_and(not has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
  from pg_proc p where pronamespace = 'public'::regnamespace and proname like 'client\_compliance\_%'));
select t.ok('every register function pins its search_path and is security definer', (select count(*) >= 7 and bool_and(p.prosecdef and coalesce('search_path=public, pg_temp' = any (p.proconfig), false))
  from pg_proc p where pronamespace = 'public'::regnamespace and (proname like 'client\_compliance\_%' or proname like 'alert\_rule\_compliance\_%' or proname = 'alert_compliance_candidates')));
select t.ok('the register table has row security on', (select relrowsecurity from pg_class where oid = 'public.client_compliance_items'::regclass));

-- ═══ Scan ════════════════════════════════════════════════════════════
-- Fixtures as postgres. s1 (passport +30, with a reference) and s2 (establishment card, expired) were saved above; s3 is closed, s4 is open.
insert into client_compliance_items (client_id, item_type, person_name, expiry_date) values
  ('RL', 'Emirates ID', 'Closed Client Person', :'today'::date + 10),
  ('R1', 'Passport', 'Far Away', :'today'::date + 200),
  ('R1', 'Passport', 'No Date', null),
  ('R1', 'UBO verification', 'Ubo Person', :'today'::date + 5),
  ('R1', 'AML risk assessment', null, :'today'::date - 40);
insert into client_compliance_items (client_id, item_type, person_name, expiry_date) values ('R2', 'Work permit', 'Mover', :'today'::date + 80) returning id as s6 \gset
select id as s_ubo from client_compliance_items where item_type = 'UBO verification' \gset
select id as s_rl from client_compliance_items where client_id = 'RL' \gset
select alert_scan() as scan1 \gset
select t.ok('scan is Ok and the compliance rules ran', :'scan1'::jsonb->>'status' = 'Ok' and (:'scan1'::jsonb->'rule_counts') ? 'compliance_passport');
select t.ok('establishment card in the past is Critical', (select count(*) = 1 and bool_and(priority = 'Critical' and current_step = -1 and due_date = :'today'::date - 5
  and assigned_to = :'own' and department = 'Business Setup' and category = 'Ejari & Establishment Card' and client_id = 'R1'
  and source_table = 'client_compliance_items' and rule_code = 'compliance_establishment_card'
  and title = 'Expiry: Establishment card - Register One LLC') from alerts where source_id = :'s2'));
select t.ok('passport 30 days out is High, owned, titled with type, person and client', (select count(*) = 1 and bool_and(priority = 'High' and current_step = 30 and due_date = :'today'::date + 30
  and assigned_to = :'own' and source_table = 'client_compliance_items' and rule_code = 'compliance_passport' and category = 'Visa & Emirates ID'
  and title = 'Expiry: Passport - Zed Ref - Register One LLC' and subject = 'Passport - Zed Ref - Register One LLC'
  and dedupe_key = 'compliance:' || :'s1' || ':' || (:'today'::date + 30)::text) from alerts where source_id = :'s1'));
select t.ok('a closed entry raised nothing', (select count(*) = 0 from alerts where source_id = :'s3'));
select t.ok('an entry of a closed client raised nothing', (select count(*) = 0 from alerts where source_id = :'s_rl'));
select t.ok('a far-off entry raised nothing', (select count(*) = 0 from alerts where source_id = (select id::text from client_compliance_items where person_name = 'Far Away')));
select t.ok('types with no rule raise nothing until Phase 5', (select count(*) = 0 from alerts where source_id in (:'s_ubo', (select id::text from client_compliance_items where item_type = 'AML risk assessment'))));
select t.ok('passport counts are exact: three checked, two dated, one raised', (select rule_counts->'compliance_passport' @> '{"checked": 3, "with_data": 2, "raised": 1, "error": null}'::jsonb
  from alert_scan_log order by id desc limit 1));
select t.ok('every register alert came from the register, nothing else raised there', (select count(*) = 4 from alerts where rule_code like 'compliance\_%' and status = 'Open'));
select t.ok('Triage bells the assigned owner once for each owned alert', (select count(*) = 3 from notifications where type = 'alert_centre' and user_id = :'own'
  and title in ('Expiry: Establishment card - Register One LLC', 'Expiry: Passport - Zed Ref - Register One LLC', 'Expiry: Ejari - Lease A - Register One LLC')));

-- An open alert closes when its entry is closed
select id as a4 from alerts where source_id = :'s4' \gset
select t.ok('the open entry has an open alert', (select status = 'Open' and current_step = 30 from alerts where id = :'a4'));
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a3';
select client_compliance_close(:'s4', 'Lease not renewed') \gset
reset role;
select alert_scan() as scan2 \gset
select t.ok('closing the entry closed its open alert, by the system', (select status = 'Resolved' and resolved_by_system and resolved_by is null from alerts where id = :'a4'));
select t.ok('and the scan reports the closing', (select (rule_counts->'compliance_ejari'->>'closed')::int = 1 from alert_scan_log order by id desc limit 1));
select alert_scan() \gset
select t.ok('a third scan leaves it closed', (select status = 'Resolved' from alerts where id = :'a4') and (select count(*) = 1 from alerts where source_id = :'s4'));

-- A date change opens a new cycle
select id as a6a from alerts where source_id = :'s6' \gset
select t.ok('work permit 80 days out is step 90, Medium', (select status = 'Open' and current_step = 90 and priority = 'Medium' from alerts where id = :'a6a'));
update client_compliance_items set expiry_date = :'today'::date + 25 where id = :'s6';
select alert_scan() \gset
select t.ok('a changed date resolves the old cycle', (select status = 'Resolved' and resolved_by_system from alerts where id = :'a6a'));
select t.ok('and opens a new one with its own key', (select count(*) = 1 and bool_and(status = 'Open' and current_step = 30 and priority = 'High' and id <> :'a6a'
  and dedupe_key = 'compliance:' || :'s6' || ':' || (:'today'::date + 25)::text) from alerts where source_id = :'s6' and status = 'Open'));

-- The reference never leaves the register
select t.ok('control: the reference is in the register', (select count(*) = 1 from client_compliance_items where reference = 'REF-9X7Q-SECRET'));
select t.ok('the reference is in no alerts column', (select count(*) = 0 from alerts a where a::text ilike '%REF-9X7Q%'));
select t.ok('the reference is in no alert event', (select count(*) = 0 from alert_events e where e::text ilike '%REF-9X7Q%'));
select t.ok('the reference is in no bell row', (select count(*) = 0 from notifications n where n::text ilike '%REF-9X7Q%'));
select t.ok('the reference is in no scan log row', (select count(*) = 0 from alert_scan_log l where l::text ilike '%REF-9X7Q%'));
select t.ok('the reference is in no recipient row', (select count(*) = 0 from alert_recipients r where r::text ilike '%REF-9X7Q%'));
select id as a1 from alerts where source_id = :'s1' \gset
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a1';
select alert_list('Management', 'All', null, 500, 0)::text as l_text, alert_detail(:'a1')::text as d_text, alert_tiles('Management')::text as t_text \gset
reset role;
select t.ok('the reference is not in alert_list or alert_detail', position('REF-9X7Q' in :'l_text') = 0 and position('REF-9X7Q' in :'d_text') = 0 and position('9X7Q' in :'t_text') = 0);
select t.ok('control: the list does carry the register alert', position('Zed Ref' in :'l_text') > 0 and position('Zed Ref' in :'d_text') > 0);

-- Renewals tile
select count(*) as n_ren from alerts where status in ('Open', 'In progress') and (rule_code in ('licence_expiry', 'visa_expiry') or rule_code like 'compliance\_%') and current_step >= 0 \gset
select count(*) as n_ren_old from alerts where status in ('Open', 'In progress') and rule_code in ('licence_expiry', 'visa_expiry') and current_step >= 0 \gset
select count(*) as n_ren_reg from alerts where status in ('Open', 'In progress') and rule_code like 'compliance\_%' and current_step >= 0 \gset
select t.ok('control: the register adds renewals alerts, and the expired card does not count', :n_ren_reg = 2 and :n_ren = :n_ren_old + 2);
set role authenticated;
set test.uid = '00000000-0000-0000-0000-0000000006a1';
select alert_tiles('Management')->>'renewals' as t_ren, alert_management_summary()->>'renewals' as m_ren \gset
reset role;
select t.ok('the renewals tile counts register alerts', :t_ren::int = :n_ren);
select t.ok('the management summary counts them too', :m_ren::int = :n_ren);

-- Preview: backlog, no bell, no mail path
insert into client_compliance_items (client_id, item_type, person_name, expiry_date, reference)
  values ('R1', 'Dependent visa', 'Preview Person', :'today'::date + 10, 'REF-PREVIEW-77') returning id as s_pv \gset
update alert_settings set value = '"Preview"' where key = 'alert_mode';
select count(*) as bells_pv from notifications where type = 'alert_centre' \gset
select alert_scan() \gset
select t.ok('Preview makes a backlog alert', (select count(*) = 1 and bool_and(backlog and priority = 'High' and current_step = 15) from alerts where source_id = :'s_pv'));
select t.ok('Preview writes no bell', (select count(*) = :bells_pv from notifications where type = 'alert_centre'));
select t.ok('Preview keeps the reference out too', (select count(*) = 0 from alerts a where a::text ilike '%REF-PREVIEW%') and (select count(*) = 0 from notifications n where n::text ilike '%REF-PREVIEW%'));
update alert_settings set value = '"Triage"' where key = 'alert_mode';

-- A manager is not belled in Triage for an owned alert; the register adds no new bell path
select t.ok('Triage bells only Assigned recipients for register alerts', (select count(*) = 0 from notifications n
  where n.type = 'alert_centre' and n.link_scope->>'alert_id' in (select id::text from alerts where rule_code like 'compliance\_%') and n.user_id not in (:'own')));

-- Leave the run as the other tests expect it
update alert_settings set value = '"Live"' where key = 'alert_mode';
