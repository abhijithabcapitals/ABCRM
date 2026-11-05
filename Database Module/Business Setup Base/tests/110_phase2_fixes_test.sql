-- LOCAL TEST ONLY: fixes from the phase 2 whole-branch review. Run through tests/run-local.sh, after 100.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 010 grants every function to signed-in users for its own calls: run the migrations again to restore their real grants.
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/018_portal.sql
create temp table f110 (k text primary key, v text);
grant all on f110 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f110 where k = p_k $$;
create function pg_temp.mkcase(p_key text, p_client text) returns void language plpgsql as $$
begin with c as (insert into public.business_setup_cases (client_id, stage, lead_name) values (p_client, 'Documentation', p_key) returning id) insert into f110 select p_key, id::text from c; end $$;
create function pg_temp.mkq(p_key text, p_client text, p_case text, p_amount numeric) returns void language plpgsql as $$
begin
  insert into f110 values (p_key, (public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', 'Fix LLC', 'contact_name', 'C', 'contact_email', 'c@x.ae',
    'contact_phone', '1', 'client_address', 'Dubai', 'client_id', p_client, 'case_id', pg_temp.fx(p_case), 'lines', jsonb_build_array(jsonb_build_object('description', 'S', 'amount', p_amount))))).id::text);
end $$;
create function pg_temp.signaccept(p_quote text, p_path text) returns void language plpgsql as $$
begin perform public.business_setup_signed_decide(public.business_setup_signed_add(pg_temp.fx(p_quote)::uuid, p_path), true, 'Looks right'); end $$;
create function pg_temp.vq(p_acc text, p_quote text) returns jsonb language sql security definer as $$
  select e from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx(p_acc)::uuid) -> 'quotes') e where e ->> 'id' = pg_temp.fx(p_quote) $$;
create function pg_temp.qst(p_k text) returns text language sql security definer as $$ select status from public.hub_documents where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.stg(p_k text) returns text language sql security definer as $$ select stage from public.business_setup_cases where id = pg_temp.fx(p_k)::uuid $$;
create function pg_temp.docs(p_k text) returns jsonb language sql security definer as $$ select public.business_setup_case_docs(pg_temp.fx(p_k)::uuid) $$;
create function pg_temp.audited(p_action text, p_id text) returns boolean language sql security definer as $$
  select exists (select 1 from public.business_setup_audit_log where action = p_action and row_id = p_id) $$;

select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900110', 'Keep Login LLC', '{}'), ('CL900111', 'Reverse LLC', '{}'), ('CL900112', 'Closed LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL900110', 'Done'), ('CL900111', 'Done'), ('CL900112', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL900110', 'K', 'portal.k110', 'x'), ('CL900112', 'C', 'portal.c110', 'x');
insert into f110 select 'acc', id::text from public.client_portal_accounts where username = 'portal.k110';
insert into f110 select 'acc_c', id::text from public.client_portal_accounts where username = 'portal.c110';
-- Other work: this client keeps the login after one case is lost.
insert into public.business_setup_services (client_id, name) values ('CL900110', 'Earlier work');
select pg_temp.mkcase('cL', 'CL900110');
select pg_temp.mkcase('cL2', 'CL900110');
select pg_temp.mkcase('cC', 'CL900112');
select pg_temp.mkcase('cX', 'CL900112');
select pg_temp.mkcase('cLet', 'CL900111');
select pg_temp.mkcase('cRev', 'CL900111');

-- ── I7: a Lost case leaves no live quote ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.mkq('qL', 'CL900110', 'cL', 1000);
select pg_temp.mkq('qL2', 'CL900110', 'cL2', 1000);
select pg_temp.mkq('qC', 'CL900112', 'cC', 1000);
select pg_temp.mkq('qX', 'CL900112', 'cX', 1000);
select public.bs_as(null);
select public.bs_check('lost: before Lost the client sees a quote waiting', pg_temp.vq('acc', 'qL') ->> 'status' = 'issued');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f110 values ('sL', public.business_setup_signed_add(pg_temp.fx('qL')::uuid, 'staff/CL900110/a.pdf')::text);
select public.business_setup_case_lost(pg_temp.fx('cL')::uuid, 'Went elsewhere');
select public.business_setup_case_lost(pg_temp.fx('cL2')::uuid, 'Went elsewhere');
select public.bs_as(null);
select public.bs_check('lost: the case is Lost', pg_temp.stg('cL') = 'Lost');
select public.bs_check('lost: its issued quote is rejected', pg_temp.qst('qL') = 'rejected' and (select status_reason from public.hub_documents where id = pg_temp.fx('qL')::uuid) ~ 'Went elsewhere');
select public.bs_check('lost: the rejection is audited', pg_temp.audited('quote_reject_by_lost', pg_temp.fx('qL')));
select public.bs_check('lost: the waiting signed copy is refused', (select status = 'Refused' and note is not null and decided_at is not null from public.business_setup_signed_quotes where id = pg_temp.fx('sL')::uuid));
select public.bs_check('lost: the refusal is audited', pg_temp.audited('signed_refused_by_lost', pg_temp.fx('sL')));
select public.bs_check('lost: the client with other work keeps the login', (select status = 'active' from public.client_portal_accounts where id = pg_temp.fx('acc')::uuid));
select public.bs_check('lost: that client no longer sees Waiting for you', pg_temp.vq('acc', 'qL2') ->> 'status' = 'rejected' and pg_temp.vq('acc', 'qL') ->> 'status' = 'rejected');

-- ── I7: a Completed or Cancelled case takes no signature either ──
select public.business_setup_case_set_stage(pg_temp.fx('cC')::uuid, 'Completed', 'test');
select public.business_setup_case_set_stage(pg_temp.fx('cX')::uuid, 'Cancelled', 'test');
select public.bs_check('closed case: the view says the quote is closed', (pg_temp.vq('acc_c', 'qC') ->> 'closed')::boolean and (pg_temp.vq('acc_c', 'qX') ->> 'closed')::boolean);
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select public.business_setup_signed_add('%s', 'staff/CL900112/c.pdf')$$, pg_temp.fx('qC')), 'closed');
select public.bs_as(null);

-- ── Step 3: Letter counts only on the accepted quote ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.mkq('qLet1', 'CL900111', 'cLet', 500);
select public.bs_as(null);
-- A letter from before the gate, on what becomes the rejected quote.
insert into public.hub_documents (doc_type, department, client_name, document_number, document_serial, parent_id, case_id, client_id)
  values ('letter', 'Business Setup', 'Fix LLC', 'OLD-LETTER-110', 1, pg_temp.fx('qLet1')::uuid, pg_temp.fx('cLet')::uuid, 'CL900111');
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_quote_reject(pg_temp.fx('qLet1')::uuid, 'Changed their mind');
select pg_temp.mkq('qLet2', 'CL900111', 'cLet', 500);
select pg_temp.signaccept('qLet2', 'staff/CL900111/let2.pdf');
select public.bs_as(null);
select public.bs_check('letter: Q1 rejected with a letter and Q2 accepted leaves Letter not done', pg_temp.qst('qLet2') = 'accepted' and (pg_temp.docs('cLet') ->> 'letter')::boolean = false);
select public.bs_check('letter: the case stays in Documentation', pg_temp.stg('cLet') = 'Documentation');
-- case_sync moves forward only: a case already past Documentation stays there though its letter no longer counts.
select public.business_setup_case_set_stage(pg_temp.fx('cLet')::uuid, 'Assignment', 'test');
select public.business_setup_case_sync(pg_temp.fx('cLet')::uuid);
select public.bs_check('letter: a case past Documentation does not move back', pg_temp.stg('cLet') = 'Assignment');

-- ── Step 3: a reversal cannot take net paid below zero ──
select public.bs_as('00000000-0000-0000-0000-00000000000e');
insert into f110 values ('p100', public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cRev'), 'amount', 100)) ->> 'payment_id');
insert into f110 values ('p50', public.business_setup_payment_add(jsonb_build_object('case_id', pg_temp.fx('cRev'), 'amount', 50)) ->> 'payment_id');
select public.business_setup_refund_add(jsonb_build_object('case_id', pg_temp.fx('cRev'), 'amount', 60, 'reason', 'Returned')) as ignored \gset
select public.bs_expect_error(format($$select public.business_setup_payment_reverse('%s', 'Mistake')$$, pg_temp.fx('p100')), 'Reverse the refund first.');
select public.business_setup_payment_reverse(pg_temp.fx('p50')::uuid, 'Mistake') as ignored \gset
select public.bs_as(null);
select public.bs_check('reverse: a reversal that leaves net paid at or above zero still works', public.business_setup_case_net_paid(pg_temp.fx('cRev')::uuid) = 40);
-- A quote with no case: the same rule on the quote's own net paid.
select public.bs_as('00000000-0000-0000-0000-00000000000b');
insert into f110 values ('qNo', (public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', 'Fix LLC', 'contact_name', 'C', 'contact_email', 'c@x.ae',
    'contact_phone', '1', 'client_address', 'Dubai', 'client_id', 'CL900111', 'lines', '[{"description":"S","amount":1000}]'::jsonb))).id::text);
select pg_temp.signaccept('qNo', 'staff/CL900111/no.pdf');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
insert into f110 values ('pNo', public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('qNo'), 'amount', 100)) ->> 'payment_id');
select public.business_setup_refund_add(jsonb_build_object('quote_id', pg_temp.fx('qNo'), 'amount', 30, 'reason', 'Returned')) as ignored \gset
select public.bs_expect_error(format($$select public.business_setup_payment_reverse('%s', 'Mistake')$$, pg_temp.fx('pNo')), 'Reverse the refund first.');
select public.bs_as(null);

-- ── Step 3: Finance's door only creates from the case ──
select public.bs_as(null);
with c as (insert into public.business_setup_cases (stage, lead_name, email, phone) values ('Lead', 'Door 110 LLC', 'door110@x.ae', '0500110') returning id) insert into f110 select 'cDoor', id::text from c;
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select public.business_setup_case_link_client_for_payment('%s', 'CL900111')$$, pg_temp.fx('cDoor')), 'ask a manager or Sales');
select public.bs_expect_error(format($$select public.business_setup_case_link_client_for_payment('%s', null, true)$$, pg_temp.fx('cDoor')), 'ask a manager or Sales');
select public.bs_as(null);
select public.bs_check('finance door: both refusals left the case with no client', (select client_id is null from public.business_setup_cases where id = pg_temp.fx('cDoor')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('finance door: an empty client ID still creates from the case', public.business_setup_case_link_client_for_payment(pg_temp.fx('cDoor')::uuid, '  ', false) is not null);
select public.bs_check('finance: holds access to the Leads tab and the payment right, not lead actions', public.business_setup_can('setup.access') and public.business_setup_can('setup.payments.manage') and not public.business_setup_can('setup.leads.manage'));
select public.bs_as(null);

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
