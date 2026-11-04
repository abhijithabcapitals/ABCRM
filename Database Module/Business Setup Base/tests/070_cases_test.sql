-- LOCAL TEST ONLY: cases, stages and sync (restructure Task 1). Run through tests/run-local.sh, after 010 and 050.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create temp table f70 (k text primary key, v text);
grant all on f70 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f70 where k = p_k $$;
create function pg_temp.stage(p_case text) returns text language sql as $$ select stage from public.business_setup_cases where id = pg_temp.fx(p_case)::uuid $$;
create function pg_temp.docs(p_case text) returns jsonb language sql as $$ select public.business_setup_case_docs(pg_temp.fx(p_case)::uuid) $$;
-- A case with a client, at the given stage.
create function pg_temp.mkcase(p_key text, p_client text, p_stage text) returns uuid language plpgsql as $$
declare c uuid;
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.business_setup_cases (client_id, stage, lead_name) values (p_client, p_stage, p_client) returning id into c;
  insert into f70 values (p_key, c::text);
  return c;
end $$;
-- A Business Setup quote straight into the table, with an optional case. Old-style rows pass no case.
create function pg_temp.mkquote(p_key text, p_num text, p_client text, p_case uuid, p_status text default 'issued', p_total numeric default 1000, p_root uuid default null) returns uuid language plpgsql as $$
declare q uuid := gen_random_uuid();
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.hub_documents (id, root_quote_id, doc_type, department, client_name, client_id, document_number, total_amount, status, case_id)
  values (q, coalesce(p_root, q), 'quote', 'Business Setup', p_client, p_client, p_num, p_total, p_status, p_case);
  insert into f70 values (p_key, q::text);
  return q;
end $$;
create function pg_temp.mkletter(p_quote text, p_num text, p_case uuid) returns void language sql as $$
  insert into public.hub_documents (parent_id, doc_type, department, client_name, document_number, case_id)
  select id, 'letter', 'Business Setup', client_name, p_num, p_case from public.hub_documents where id = pg_temp.fx(p_quote)::uuid
$$;
create function pg_temp.mkpay(p_client text, p_quote text, p_case uuid, p_amt numeric, p_type text default 'Payment') returns void language sql as $$
  insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type, case_id)
  values (p_client, nullif(pg_temp.fx(p_quote), '')::uuid, current_date, p_amt, p_type, p_case)
$$;
create function pg_temp.mkform(p_client text, p_key text, p_status text, p_case uuid default null) returns uuid language plpgsql as $$
declare a uuid; f uuid;
begin
  insert into public.client_master (client_id, legal_name, data) values (p_client, p_client || ' LLC', '{}') on conflict do nothing;
  insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values (p_client, p_client, lower(p_client), 'x') returning id into a;
  perform public.business_setup_form_create(p_client, a);
  select id into f from public.business_setup_onboarding_forms where account_id = a;
  update public.business_setup_onboarding_forms set status = p_status, case_id = p_case where id = f;
  insert into f70 values (p_key, f::text);
  return f;
end $$;
create function pg_temp.mkservice(p_client text, p_quote text, p_status text) returns void language sql as $$
  insert into public.business_setup_services (client_id, quote_id, name, status) values (p_client, pg_temp.fx(p_quote)::uuid, 'svc ' || p_status, p_status)
$$;
create function pg_temp.casecount() returns bigint language sql as $$ select count(*) from public.business_setup_cases $$;
select public.bs_as(null);

-- ── Shape, permissions, privileges ──
select public.bs_check('case table exists', to_regclass('public.business_setup_cases') is not null);
select public.bs_check('permission list has the new rights', business_setup_permissions() @> array['setup.leads.manage', 'setup.cases.approve']);
select public.bs_expect_error($$insert into public.business_setup_cases (stage) values ('Bogus')$$, 'check');
select pg_temp.mkcase('shape', 'CL970001', 'Lead');
select public.bs_check('case number is BSC and six digits', (select case_number ~ '^BSC[0-9]{6,}$' from public.business_setup_cases where id = pg_temp.fx('shape')::uuid));
select public.bs_expect_error($$insert into public.business_setup_cases (case_number) values ((select case_number from public.business_setup_cases limit 1))$$, 'duplicate key');
-- (Who may call the internal functions is checked in 010, before its blanket grant.)
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('sales holds leads.manage, not cases.approve', public.business_setup_can('setup.leads.manage') and not public.business_setup_can('setup.cases.approve'));
select public.bs_check('sales reads cases', (select count(*) from public.business_setup_cases) >= 1);
select public.bs_expect_error($$insert into public.business_setup_cases (stage) values ('Lead')$$, 'permission denied');
select public.bs_expect_error($$update public.business_setup_cases set stage = 'Lost'$$, 'permission denied');
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_check('documents holds leads.manage, not cases.approve', public.business_setup_can('setup.leads.manage') and not public.business_setup_can('setup.cases.approve'));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_check('manager holds both', public.business_setup_can('setup.leads.manage') and public.business_setup_can('setup.cases.approve'));
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_check('finance holds neither', not public.business_setup_can('setup.leads.manage') and not public.business_setup_can('setup.cases.approve'));
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select public.bs_check('admin holds both', public.business_setup_can('setup.leads.manage') and public.business_setup_can('setup.cases.approve'));
select public.bs_check('my access lists them', (public.business_setup_my_access() -> 'permissions') @> '["setup.leads.manage","setup.cases.approve"]'::jsonb);
select public.bs_as(null);

-- ── set_stage writes the audit entry ──
select public.business_setup_case_set_stage(pg_temp.fx('shape')::uuid, 'Contact', 'Link used');
select public.bs_check('set_stage moves the case', pg_temp.stage('shape') = 'Contact');
select public.bs_check('set_stage audits it', public.bs_audit_count('case_stage', pg_temp.fx('shape'), '{"stage":"Contact","note":"Link used"}') = 1);
select public.bs_expect_error(format($$select business_setup_case_set_stage('%s', 'Bogus', null)$$, pg_temp.fx('shape')), 'check');

-- ── case_sync_forward_only ──
select pg_temp.mkcase('fwd', 'CL970002', 'In service');
select pg_temp.mkquote('fwd_q', 'T70-FWD', 'CL970002', pg_temp.fx('fwd')::uuid, 'accepted');
select public.business_setup_case_sync(pg_temp.fx('fwd')::uuid);
select public.bs_check('case_sync_forward_only: In service is unchanged', pg_temp.stage('fwd') = 'In service');
select pg_temp.mkcase('fwd2', 'CL970003', 'Assignment');
select pg_temp.mkquote('fwd2_q', 'T70-FWD2', 'CL970003', pg_temp.fx('fwd2')::uuid);
select public.business_setup_case_sync(pg_temp.fx('fwd2')::uuid);
select public.bs_check('Assignment does not slide back to Documentation', pg_temp.stage('fwd2') = 'Assignment');
select pg_temp.mkcase('fwd3', 'CL970004', 'Review');
select pg_temp.mkquote('fwd3_q', 'T70-FWD3', 'CL970004', pg_temp.fx('fwd3')::uuid);
select public.bs_check('a quote does not lift a case still in Review', pg_temp.stage('fwd3') = 'Review');
select pg_temp.mkcase('lost', 'CL970005', 'Lost');
select pg_temp.mkquote('lost_q', 'T70-LOST', 'CL970005', pg_temp.fx('lost')::uuid);
select public.bs_check('a Lost case stays Lost', pg_temp.stage('lost') = 'Lost');

-- ── form_trigger ──
select pg_temp.mkcase('form', 'CL970010', 'Contact');
select pg_temp.mkform('CL970010', 'form_f', 'Draft', pg_temp.fx('form')::uuid);
select public.bs_check('a Draft form leaves the stage', pg_temp.stage('form') = 'Contact');
update public.business_setup_onboarding_forms set status = 'Submitted' where id = pg_temp.fx('form_f')::uuid;
select public.bs_check('form_trigger: Submitted gives Review', pg_temp.stage('form') = 'Review');
update public.business_setup_onboarding_forms set status = 'Returned' where id = pg_temp.fx('form_f')::uuid;
select public.bs_check('form_trigger: Returned gives Contact', pg_temp.stage('form') = 'Contact');
update public.business_setup_onboarding_forms set status = 'Submitted' where id = pg_temp.fx('form_f')::uuid;
update public.business_setup_onboarding_forms set status = 'In review' where id = pg_temp.fx('form_f')::uuid;
select public.bs_check('form_trigger: In review gives Review', pg_temp.stage('form') = 'Review');
update public.business_setup_onboarding_forms set status = 'Validated' where id = pg_temp.fx('form_f')::uuid;
select public.bs_check('form_trigger: Validated gives Services', pg_temp.stage('form') = 'Services');
select pg_temp.mkcase('form2', 'CL970011', 'Documentation');
select pg_temp.mkform('CL970011', 'form2_f', 'Draft', pg_temp.fx('form2')::uuid);
update public.business_setup_onboarding_forms set status = 'Returned' where id = pg_temp.fx('form2_f')::uuid;
select public.bs_check('a form change does not pull a later stage back', pg_temp.stage('form2') = 'Documentation');
select pg_temp.mkform('CL970012', 'form3_f', 'Draft');
update public.business_setup_onboarding_forms set status = 'Submitted' where id = pg_temp.fx('form3_f')::uuid;
select public.bs_check('a form with no case still updates', (select status from public.business_setup_onboarding_forms where id = pg_temp.fx('form3_f')::uuid) = 'Submitted');
select pg_temp.mkcase('form4', 'CL970013', 'Contact');
select pg_temp.mkquote('form4_q', 'T70-FORM4', 'CL970013', pg_temp.fx('form4')::uuid);
select pg_temp.mkform('CL970013', 'form4_f', 'Draft', pg_temp.fx('form4')::uuid);
update public.business_setup_onboarding_forms set status = 'Validated' where id = pg_temp.fx('form4_f')::uuid;
select public.bs_check('validating a form with a quote already issued reaches Documentation', pg_temp.stage('form4') = 'Documentation');

-- ── quote_trigger and docs_ready ──
select pg_temp.mkcase('doc', 'CL970020', 'Services');
select public.bs_check('no quote yet: stays in Services', pg_temp.stage('doc') = 'Services' and (pg_temp.docs('doc') ->> 'quote')::boolean = false);
select pg_temp.mkquote('doc_q', 'T70-DOC', 'CL970020', pg_temp.fx('doc')::uuid);
select public.bs_check('quote_trigger: issuing a quote moves Services to Documentation', pg_temp.stage('doc') = 'Documentation');
select public.bs_check('docs: quote only', pg_temp.docs('doc') = '{"quote":true,"signed":false,"paid":false,"letter":false,"invoice":true}'::jsonb);
update public.hub_documents set status = 'accepted' where id = pg_temp.fx('doc_q')::uuid;
select public.bs_check('accepting the quote counts as signed', (pg_temp.docs('doc') ->> 'signed')::boolean and pg_temp.stage('doc') = 'Documentation');
select pg_temp.mkpay('CL970020', 'doc_q', pg_temp.fx('doc')::uuid, 400);
select public.bs_check('a payment counts as paid', (pg_temp.docs('doc') ->> 'paid')::boolean and pg_temp.stage('doc') = 'Documentation');
select pg_temp.mkletter('doc_q', 'T70-DOC-L', pg_temp.fx('doc')::uuid);
select public.bs_check('docs_ready: accepted quote, payment and letter move to Assignment', pg_temp.stage('doc') = 'Assignment');
select public.bs_check('all five items are met', pg_temp.docs('doc') = '{"quote":true,"signed":true,"paid":true,"letter":true,"invoice":true}'::jsonb);

select pg_temp.mkcase('doc2', 'CL970021', 'Services');
select pg_temp.mkquote('doc2_q', 'T70-DOC2', 'CL970021', pg_temp.fx('doc2')::uuid, 'accepted', 500);
select pg_temp.mkpay('CL970021', 'doc2_q', pg_temp.fx('doc2')::uuid, 500);
select pg_temp.mkpay('CL970021', 'doc2_q', pg_temp.fx('doc2')::uuid, 500, 'Refund');
select public.bs_check('a refund takes the net back to zero', not (pg_temp.docs('doc2') ->> 'paid')::boolean);
select pg_temp.mkletter('doc2_q', 'T70-DOC2-L', pg_temp.fx('doc2')::uuid);
select public.bs_check('letter without net payment stays in Documentation', pg_temp.stage('doc2') = 'Documentation');
select pg_temp.mkcase('doc3', 'CL970022', 'Services');
select pg_temp.mkquote('doc3_q', 'T70-DOC3', 'CL970022', pg_temp.fx('doc3')::uuid, 'accepted', 0);
select public.bs_check('a zero-total quote needs no payment', (pg_temp.docs('doc3') ->> 'paid')::boolean);
select pg_temp.mkcase('doc4', 'CL970023', 'Services');
select pg_temp.mkquote('doc4_q', 'T70-DOC4', 'CL970023', pg_temp.fx('doc4')::uuid, 'issued', 0);
select public.bs_check('an unsigned quote is not signed, even at zero', not (pg_temp.docs('doc4') ->> 'signed')::boolean);
select pg_temp.mkcase('doc5', 'CL970024', 'Services');
select pg_temp.mkquote('doc5_q', 'T70-DOC5', 'CL970024', pg_temp.fx('doc5')::uuid, 'superseded');
select public.bs_check('a superseded quote does not count', not (pg_temp.docs('doc5') ->> 'quote')::boolean and pg_temp.stage('doc5') = 'Services');
select public.bs_check('docs of an unknown case are false except the invoice', public.business_setup_case_docs(gen_random_uuid()) = '{"quote":false,"signed":false,"paid":false,"letter":false,"invoice":true}'::jsonb);

-- ── In service closes ──
select pg_temp.mkcase('svc', 'CL970030', 'In service');
select pg_temp.mkquote('svc_q', 'T70-SVC', 'CL970030', pg_temp.fx('svc')::uuid, 'accepted');
select pg_temp.mkservice('CL970030', 'svc_q', 'Completed');
select pg_temp.mkservice('CL970030', 'svc_q', 'In progress');
select public.business_setup_case_sync(pg_temp.fx('svc')::uuid);
select public.bs_check('an open service keeps the case In service', pg_temp.stage('svc') = 'In service');
update public.business_setup_services set status = 'Cancelled' where client_id = 'CL970030' and status = 'In progress';
select public.business_setup_case_sync(pg_temp.fx('svc')::uuid);
select public.bs_check('Completed plus Cancelled gives Completed', pg_temp.stage('svc') = 'Completed');
select pg_temp.mkcase('svc2', 'CL970031', 'In service');
select pg_temp.mkquote('svc2_q', 'T70-SVC2', 'CL970031', pg_temp.fx('svc2')::uuid, 'accepted');
select pg_temp.mkservice('CL970031', 'svc2_q', 'Cancelled');
select public.business_setup_case_sync(pg_temp.fx('svc2')::uuid);
select public.bs_check('all Cancelled gives Cancelled', pg_temp.stage('svc2') = 'Cancelled');
select pg_temp.mkcase('svc3', 'CL970032', 'In service');
select public.business_setup_case_sync(pg_temp.fx('svc3')::uuid);
select public.bs_check('no services leaves In service alone', pg_temp.stage('svc3') = 'In service');

-- ── hub_document_create: case_id is copied, a letter and a revision inherit it ──
select pg_temp.mkcase('fn', 'CL970040', 'Services');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
create function pg_temp.fq(p_dept text, p_extra jsonb default '{}') returns public.hub_documents language sql as $$
  select * from public.hub_document_create(jsonb_build_object('doc_type','quote','department',p_dept,'client_name','Fn LLC','contact_name','C','contact_email','c@x.ae','contact_phone','1','client_address','Dubai',
    'lines','[{"description":"Licence","amount":100}]'::jsonb) || p_extra) $$;
insert into f70 select 'fn_q', (pg_temp.fq('Business Setup', jsonb_build_object('client_id', 'CL970040', 'case_id', pg_temp.fx('fn')))).id::text;
select public.bs_check('hub_document_create copies case_id', (select case_id::text from public.hub_documents where id = pg_temp.fx('fn_q')::uuid) = pg_temp.fx('fn'));
select public.bs_check('creating it moves the case to Documentation', pg_temp.stage('fn') = 'Documentation');
insert into f70 select 'fn_rev', (pg_temp.fq('Business Setup', jsonb_build_object('client_id', 'CL970040', 'revises_id', pg_temp.fx('fn_q')))).id::text;
select public.bs_check('a revision inherits the case', (select case_id::text from public.hub_documents where id = pg_temp.fx('fn_rev')::uuid) = pg_temp.fx('fn'));
select public.bs_check('the revised quote is superseded and the case stays', (select status from public.hub_documents where id = pg_temp.fx('fn_q')::uuid) = 'superseded' and pg_temp.stage('fn') = 'Documentation');
select public.bs_expect_error(format($$select pg_temp.fq('Business Setup', '{"client_id":"CL970040","case_id":"%s"}'::jsonb)$$, gen_random_uuid()), 'case');
select public.bs_as(null);
update public.hub_documents set status = 'accepted' where id = pg_temp.fx('fn_rev')::uuid;
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f70 select 'fn_let', (public.hub_document_create(jsonb_build_object('doc_type','letter','parent_id',pg_temp.fx('fn_rev')))).id::text;
select public.bs_check('a letter inherits the case', (select case_id::text from public.hub_documents where id = pg_temp.fx('fn_let')::uuid) = pg_temp.fx('fn'));
select public.bs_check('the letter is counted', (pg_temp.docs('fn') ->> 'letter')::boolean);

-- ── banking_quote_unaffected ──
select public.bs_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.casecount() as n_before \gset
insert into f70 select 'acct_q', (pg_temp.fq('Accounting', '{"vat_mode":"exclusive"}')).id::text;
select public.bs_check('Accounting quote: no case, same total', (select case_id is null and total_amount = 105 and vat_amount = 5 from public.hub_documents where id = pg_temp.fx('acct_q')::uuid));
insert into f70 select 'bank_q', (pg_temp.fq('Business Banking')).id::text;
select public.bs_check('banking_quote_unaffected: no case, total kept', (select case_id is null and total_amount = 100 from public.hub_documents where id = pg_temp.fx('bank_q')::uuid));
select public.bs_check('no case was made for them', pg_temp.casecount() = :n_before);
select public.bs_as(null);

-- ── backfill ──
-- Old-style rows: nothing carries a case_id.
-- A: accepted quote + letter + payment, B: issued quote only, C: work started, D: all closed (one done), E: all cancelled,
-- F: revised chain, G: quote and a validated form for one client, H to L: forms only
select pg_temp.mkquote('bf_a', 'T70-BF-A', 'CL970100', null, 'accepted');
select pg_temp.mkletter('bf_a', 'T70-BF-A-L', null);
select pg_temp.mkpay('CL970100', 'bf_a', null, 600);
select pg_temp.mkquote('bf_b', 'T70-BF-B', 'CL970101', null);
select pg_temp.mkquote('bf_c', 'T70-BF-C', 'CL970102', null, 'accepted');
select pg_temp.mkservice('CL970102', 'bf_c', 'In progress');
select pg_temp.mkquote('bf_d', 'T70-BF-D', 'CL970103', null, 'accepted');
select pg_temp.mkservice('CL970103', 'bf_d', 'Completed');
select pg_temp.mkservice('CL970103', 'bf_d', 'Cancelled');
select pg_temp.mkquote('bf_e', 'T70-BF-E', 'CL970104', null, 'accepted');
select pg_temp.mkservice('CL970104', 'bf_e', 'Cancelled');
select pg_temp.mkquote('bf_f1', 'T70-BF-F1', 'CL970105', null, 'superseded');
select pg_temp.mkquote('bf_f2', 'T70-BF-F2', 'CL970105', null, 'issued', 1000, pg_temp.fx('bf_f1')::uuid);
select pg_temp.mkquote('bf_g', 'T70-BF-G', 'CL970106', null);
select pg_temp.mkform('CL970106', 'bf_g_f', 'Validated');
select pg_temp.mkform('CL970107', 'bf_h_f', 'Validated');
select pg_temp.mkform('CL970108', 'bf_i_f', 'Returned');
select pg_temp.mkform('CL970109', 'bf_j_f', 'Submitted');
select pg_temp.mkform('CL970110', 'bf_k_f', 'Draft');
select pg_temp.mkform('CL970111', 'bf_l_f', 'In review');
select pg_temp.casecount() as n0 \gset
\ir ../migrations/013_cases.sql
select pg_temp.casecount() as n1 \gset
\ir ../migrations/013_cases.sql
\ir ../migrations/013_cases.sql
select public.bs_check('backfill: running 013 again makes no second case', pg_temp.casecount() = :n1, (:n1 - :n0)::text || ' new, ' || pg_temp.casecount() || ' now');
select public.bs_check('backfill: the first run made cases', :n1 > :n0);
select public.bs_check('backfill: one case per client', (select max(c) from (select count(*) c from public.business_setup_cases where client_id like 'CL9701%' group by client_id) x) = 1);
select public.bs_check('backfill: A reaches Assignment', (select stage from public.business_setup_cases where client_id = 'CL970100') = 'Assignment');
select public.bs_check('backfill: quote, letter and payment carry the case', (select count(distinct case_id) = 1 and bool_and(case_id is not null) from (
  select case_id from public.hub_documents where client_name = 'CL970100' union all select case_id from public.business_setup_payments where client_id = 'CL970100') y));
select public.bs_check('backfill: B is in Documentation', (select stage from public.business_setup_cases where client_id = 'CL970101') = 'Documentation');
select public.bs_check('backfill: C with work started is In service', (select stage from public.business_setup_cases where client_id = 'CL970102') = 'In service');
select public.bs_check('backfill: D is Completed', (select stage from public.business_setup_cases where client_id = 'CL970103') = 'Completed');
select public.bs_check('backfill: E is Cancelled', (select stage from public.business_setup_cases where client_id = 'CL970104') = 'Cancelled');
select public.bs_check('backfill: a revision chain is one case', (select count(*) from public.business_setup_cases where client_id = 'CL970105') = 1
  and (select count(distinct case_id) from public.hub_documents where client_name = 'CL970105') = 1 and (select stage from public.business_setup_cases where client_id = 'CL970105') = 'Documentation');
select public.bs_check('backfill: quote and form share one case', (select count(*) from public.business_setup_cases where client_id = 'CL970106') = 1
  and (select case_id from public.business_setup_onboarding_forms where id = pg_temp.fx('bf_g_f')::uuid) = (select id from public.business_setup_cases where client_id = 'CL970106'));
select public.bs_check('backfill: validated form alone is Services', (select stage from public.business_setup_cases where client_id = 'CL970107') = 'Services');
select public.bs_check('backfill: returned form is Contact', (select stage from public.business_setup_cases where client_id = 'CL970108') = 'Contact');
select public.bs_check('backfill: submitted form is Review', (select stage from public.business_setup_cases where client_id = 'CL970109') = 'Review');
select public.bs_check('backfill: draft form is Contact', (select stage from public.business_setup_cases where client_id = 'CL970110') = 'Contact');
select public.bs_check('backfill: in-review form is Review', (select stage from public.business_setup_cases where client_id = 'CL970111') = 'Review');
select public.bs_check('backfill: lead details come from the records', (select lead_name = 'CL970107 LLC' from public.business_setup_cases where client_id = 'CL970107'));
select public.bs_check('backfill: only Business Setup documents get a case', not exists (select 1 from public.hub_documents where department <> 'Business Setup' and case_id is not null));
select public.bs_check('backfill: a stage already moved is not reset by a re-run', pg_temp.stage('doc') = 'Assignment' and pg_temp.stage('lost') = 'Lost');
select public.bs_expect_error($$update public.business_setup_payments set amount = amount + 1$$, 'append-only');
select public.bs_expect_error($$update public.business_setup_payments set case_id = gen_random_uuid() where case_id is not null$$, 'append-only');
select public.bs_expect_error($$delete from public.business_setup_payments$$, 'append-only');

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
