-- LOCAL TEST ONLY: service checklists (022). Run through tests/run-local.sh, last.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- Earlier tests re-run older migrations and grant every function to staff: put the real final state back, in order.
alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/016_client_flow.sql
\ir ../migrations/017_kyc_finished.sql
\ir ../migrations/018_portal.sql
\ir ../migrations/019_intake.sql
\ir ../migrations/022_checkpoints.sql
create temp table f210 (k text primary key, v text);
grant all on f210 to authenticated, service_role;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f210 where k = p_k $$;
create function pg_temp.st(p_k text) returns text language sql as $$ select i ->> 'status' from jsonb_array_elements(public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) -> 'items') i where i ->> 'id' = pg_temp.fx(p_k) $$;
select public.bs_as(null);

-- ── The seed ──
select public.bs_check('seed_counts: 45 lists, 512 steps, 40 Optional, all Business Setup',
  (select count(*) = 45 and bool_and(department = 'Business Setup') from public.business_setup_checkpoint_sets)
  and (select count(*) = 512 from public.business_setup_checkpoint_steps) and (select count(*) = 40 from public.business_setup_checkpoint_steps where requirement = 'Optional'),
  (select count(*) from public.business_setup_checkpoint_sets)::text || ' lists, ' || (select count(*) from public.business_setup_checkpoint_steps)::text || ' steps; ' || (select string_agg(department || '/' || category || '/' || name || '/' || coalesce(updated_by::text, '-') || '/' || (select count(*) from public.business_setup_checkpoint_steps st where st.set_id = cs.id), ' | ') from public.business_setup_checkpoint_sets cs where (select count(*) from public.business_setup_checkpoint_sets c2 where c2.name = cs.name) > 1 or cs.updated_by is not null or cs.department <> 'Business Setup'));
select public.bs_check('seed_encoding: the en dash is stored as U+2013, whatever the code page', exists (select 1 from public.business_setup_checkpoint_sets where name = U&'Establishment Card \2013 New / Renewal'));
select public.bs_check('seed: the rule for Optional is followed', not exists (select 1 from public.business_setup_checkpoint_steps where (label ~ '\((if|where) ') <> (requirement = 'Optional')));
select public.bs_check('fee_items: 45 linked services with no amount and 5% VAT', (select count(*) = 45 and bool_and(is_service) and bool_and(default_amount is null) and bool_and(vat_rate = 5) from public.business_setup_fee_items where checkpoint_set_id is not null));
update public.business_setup_checkpoint_steps set label = 'Edited label' where sort_order = 1 and set_id = (select id from public.business_setup_checkpoint_sets where name = 'Ejari Renewal');
\ir ../migrations/022_checkpoints.sql
select public.bs_check('seed: a re-run adds none and keeps an edit', (select count(*) = 512 from public.business_setup_checkpoint_steps) and exists (select 1 from public.business_setup_checkpoint_steps where label = 'Edited label'));
update public.business_setup_checkpoint_steps set label = 'Existing Ejari collected' where label = 'Edited label';

-- ── Who may touch the lists ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error($$select public.business_setup_checkpoint_list_save('{"name":"X","category":"Y","steps":[{"label":"Z"}]}')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error($$select public.business_setup_checkpoint_list_save('{"name":"X","category":"Y","steps":[]}')$$, 'at least one step');
select public.bs_as(null);
select public.bs_check('tables are closed', not has_table_privilege('authenticated', 'public.business_setup_service_checkpoints', 'select') and not has_table_privilege('anon', 'public.business_setup_checkpoint_sets', 'select'));
select public.bs_check('internal functions are closed', not exists (select 1 from pg_proc p, aclexplode(p.proacl) x where p.proname in ('business_setup_checkpoints_copy', 'business_setup_service_progress', 'business_setup_service_can_work', 'business_setup_checkpoint_open') and x.grantee <> p.proowner));

-- ── A client, a case and a quote ──
insert into public.client_master (client_id, legal_name, data) values ('CL990210', 'Check LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL990210', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.business_setup_cases (client_id, stage, lead_name, owner_id) values ('CL990210', 'Onboarding', 'T210', '00000000-0000-0000-0000-00000000000d');
insert into f210 select 'case', id::text from public.business_setup_cases where lead_name = 'T210';
insert into f210 select 'fee', id::text from public.business_setup_fee_items where name = 'Ejari Renewal';
insert into f210 select 'cost', id::text from public.business_setup_fee_items where checkpoint_set_id is null and not is_service limit 1;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f210 select 'q', (public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_id', 'CL990210', 'client_name', 'Check LLC', 'contact_name', 'C', 'contact_email', 'c@x.ae', 'contact_phone', '050', 'client_address', 'Dubai', 'case_id', pg_temp.fx('case'), 'services', '["Ejari Renewal","Typed"]'::jsonb,
   'lines', jsonb_build_array(jsonb_build_object('description', 'Ejari Renewal', 'amount', 100, 'fee_item_id', pg_temp.fx('fee')), jsonb_build_object('description', 'Typed', 'amount', 50))))).id::text;
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_signed_decide(public.business_setup_signed_add(pg_temp.fx('q')::uuid, 'staff/CL990210/s.pdf'), true, 'ok');
select public.bs_as(null);
insert into f210 select 'svc', id::text from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Ejari Renewal';
insert into f210 select 'typed', id::text from public.business_setup_services where quote_id = pg_temp.fx('q')::uuid and name = 'Typed';
select public.bs_check('copy_once: the listed service gets its list', (select count(*) = 10 from public.business_setup_service_checkpoints where service_id = pg_temp.fx('svc')::uuid));
select public.bs_check('no_list: a typed service gets none', not exists (select 1 from public.business_setup_service_checkpoints where service_id = pg_temp.fx('typed')::uuid));
select public.bs_check('assigned_default: the case owner is the assigned employee', (select owner_id = '00000000-0000-0000-0000-00000000000d' from public.business_setup_services where id = pg_temp.fx('svc')::uuid));
update public.business_setup_checkpoint_steps set label = 'Changed later' where sort_order = 1 and set_id = (select id from public.business_setup_checkpoint_sets where name = 'Ejari Renewal');
select public.bs_check('list_edit: a later edit leaves the copy', (select label = 'Existing Ejari collected' from public.business_setup_service_checkpoints where service_id = pg_temp.fx('svc')::uuid and sort_order = 1));
update public.business_setup_checkpoint_steps set label = 'Existing Ejari collected' where label = 'Changed later';
-- A service from before 022, with no list.
insert into public.business_setup_services (client_id, name, status) values ('CL990210', 'Old service', 'Not started');
select public.bs_check('existing_untouched: an old service has no items and no progress', not exists (select 1 from public.business_setup_service_checkpoints x join public.business_setup_services v on v.id = x.service_id where v.name = 'Old service'));
insert into f210 select 's' || sort_order, id::text from public.business_setup_service_checkpoints where service_id = pg_temp.fx('svc')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('steps start Not Started', pg_temp.st('s1') = 'Not Started');
select public.bs_as(null);

-- ── Who changes what ──
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Completed')$$, pg_temp.fx('s1')), 'Only the people');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Completed')$$, pg_temp.fx('s1')), 'Only the people');
-- ── Any order, and first activity ──
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.business_setup_checkpoint_set(pg_temp.fx('s10')::uuid, 'Completed');
select public.bs_check('any_order: the last item can go first', pg_temp.st('s10') = 'Completed');
select public.bs_check('first_activity: the service starts', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) -> 'service' ->> 'status') = 'In progress');
select public.bs_check('progress: 1 of 10 is 10', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'progress')::int = 10);
select public.bs_check('pending_approval: a completed Mandatory item waits', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'pending_approval')::int = 1);
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Not Applicable')$$, pg_temp.fx('s1')), 'reason');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Reopened', 'x')$$, pg_temp.fx('s1')), 'Only a completed');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Reopened')$$, pg_temp.fx('s10')), 'why');
select public.business_setup_checkpoint_set(pg_temp.fx('s1')::uuid, 'Not Applicable', 'Not needed here');
select public.bs_check('progress: Not Applicable leaves the count, 1 of 9 is 11', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'progress')::int = 11);
select public.business_setup_checkpoint_set(pg_temp.fx('s2')::uuid, 'Pending Client');
select public.bs_check('progress: pending does not count', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'progress')::int = 11);
-- ── Sign-off ──
select public.bs_expect_error(format($$select public.business_setup_checkpoint_verify('%s')$$, pg_temp.fx('s10')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_verify('%s')$$, pg_temp.fx('s2')), 'not completed');
select public.business_setup_checkpoint_verify(pg_temp.fx('s10')::uuid);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'In Progress')$$, pg_temp.fx('s10')), 'signed off');
select public.business_setup_checkpoint_set(pg_temp.fx('s10')::uuid, 'Reopened', 'Wrong file');
select public.bs_check('reopen_clears: the sign-off and the completed time go, and progress falls', (select i ->> 'verified_at' is null and i ->> 'completed_at' is null from jsonb_array_elements(public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) -> 'items') i where i ->> 'id' = pg_temp.fx('s10')) and (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'progress')::int = 0);
select public.bs_expect_error(format($$select public.business_setup_service_complete('%s', '{}', 'r')$$, pg_temp.fx('svc')), 'still need to be done');
-- ── Complete all but the Optional ones ──
do $$
declare r record;
begin
  for r in select v::uuid as id from f210 where k ~ '^s[0-9]+$' and pg_temp.st(k) <> 'Not Applicable' loop
    perform public.business_setup_checkpoint_set(r.id, 'Completed');
  end loop;
end $$;
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('verify_all: signs off what is Completed and Mandatory', public.business_setup_service_verify_all(pg_temp.fx('svc')::uuid) = 9);
select public.bs_as(null);
select public.bs_check('history_written: each sign-off has a row', (select count(*) >= 9 from public.business_setup_service_history where service_id = pg_temp.fx('svc')::uuid and note like '%signed off'));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_service_complete('%s', '{}')$$, pg_temp.fx('svc')), 'reason');
select public.business_setup_service_complete(pg_temp.fx('svc')::uuid, '{}', 'Test, no output');
select public.bs_check('confirm: the service is Completed, at 100', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) -> 'service' ->> 'status') = 'Completed' and (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) ->> 'progress')::int = 100);
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Reopened', 'x')$$, pg_temp.fx('s2')), 'reopen it first');
-- ── Reopening a confirmed service ──
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_service_reopen('%s', 'x')$$, pg_temp.fx('svc')), 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_service_reopen('%s', ' ')$$, pg_temp.fx('svc')), 'why');
select public.business_setup_service_complete(pg_temp.fx('typed')::uuid, '{}', 'Test, no output');
select public.bs_as(null);
update public.business_setup_cases set stage = 'Pipeline' where id = pg_temp.fx('case')::uuid and stage = 'Onboarding';
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_service_reopen(pg_temp.fx('svc')::uuid, 'Client asked for a change');
select public.bs_check('reopen_service: In progress, and the case is at Pipeline', (public.business_setup_service_checklist(pg_temp.fx('svc')::uuid) -> 'service' ->> 'status') = 'In progress');
select public.bs_as(null);
select public.bs_check('reopen_service: stage', (select stage = 'Pipeline' from public.business_setup_cases where id = pg_temp.fx('case')::uuid));
-- ── Case list and portal ──
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash, status) values ('CL990210', 'C', 'portal.c210', 'x', 'active');
insert into f210 select 'acc', id::text from public.client_portal_accounts where username = 'portal.c210';
select public.bs_check('portal: items are labels and statuses only', (select (s -> 'items' -> 0) ?& array['label', 'status'] and not (s -> 'items' -> 0) ?| array['reason', 'assigned_to', 'verified_by', 'assignee_name', 'completed_by'] from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx('acc')::uuid) -> 'services') s where s ->> 'name' = 'Ejari Renewal'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('case_list: services, progress and money', (select jsonb_array_length(e -> 'services') = 2 and e ? 'quote_total' and e ? 'net_paid' and e ? 'claims_pending' from jsonb_array_elements(public.business_setup_case_list('pipeline')) e where e ->> 'id' = pg_temp.fx('case')));
-- ── Cancelled ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_service_update(pg_temp.fx('svc')::uuid, 'Cancelled', '{}', 'Not wanted');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_expect_error(format($$select public.business_setup_checkpoint_set('%s', 'Not Started')$$, pg_temp.fx('s3')), 'cancelled');
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
