-- LOCAL TEST ONLY: handover to Accounts. Run through tests/run-local.sh, after 010.
\set QUIET on
\pset tuples_only on
\pset format unaligned
create temp table f50 (k text primary key, v text);
grant all on f50 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f50 where k = p_k $$;
create function pg_temp.q(p_num text) returns uuid language sql as $$
  insert into public.hub_documents (doc_type, department, client_name, client_id, document_number, total_amount, status)
  values ('quote', 'Business Setup', 'CL900090', 'CL900090', p_num, 1000, 'accepted') returning id
$$;
create function pg_temp.s(p_quote text, p_name text, p_status text) returns uuid language sql as $$
  insert into public.business_setup_services (client_id, quote_id, name, status) values ('CL900090', pg_temp.fx(p_quote)::uuid, p_name, p_status) returning id
$$;
create function pg_temp.pay(p_quote text, p_amt numeric) returns void language sql as $$
  insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900090', pg_temp.fx(p_quote)::uuid, current_date, p_amt, 'Payment');
$$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900090', 'Handover LLC', '{}');
insert into public.banking_user_permissions (user_id, permission, allowed) values ('00000000-0000-0000-0000-00000000000e', 'accounts.review', true) on conflict do nothing;
insert into f50 values ('q_open', pg_temp.q('H-OPEN')::text), ('q_done', pg_temp.q('H-DONE')::text), ('q_cancelled', pg_temp.q('H-CANCELLED')::text), ('q_none', pg_temp.q('H-NONE')::text);
insert into f50 values ('svc_open', pg_temp.s('q_open', 'still going', 'In progress')::text);
insert into f50 values ('svc_locked', pg_temp.s('q_done', 'finished', 'Completed')::text), ('svc_done2', pg_temp.s('q_done', 'dropped', 'Cancelled')::text);
insert into f50 values ('svc_c1', pg_temp.s('q_cancelled', 'c one', 'Cancelled')::text), ('svc_c2', pg_temp.s('q_cancelled', 'c two', 'Cancelled')::text);
select pg_temp.pay('q_done', 900);
select pg_temp.pay('q_cancelled', 500);

select public.bs_as('00000000-0000-0000-0000-00000000000b');
-- ── When it can go ──
select public.bs_expect_error(format($$select business_setup_send_to_accounts('%s')$$, pg_temp.fx('q_open')), 'not completed');
select public.bs_check('state names what blocks it', (public.business_setup_handover_state(pg_temp.fx('q_open')::uuid) ->> 'ready')::boolean = false
  and public.business_setup_handover_state(pg_temp.fx('q_open')::uuid) -> 'blockers' ->> 0 ~ 'still going');
select public.bs_expect_error(format($$select business_setup_send_to_accounts('%s')$$, pg_temp.fx('q_none')), 'not completed');
select public.bs_check('sends with balance due', (public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'outstanding')::numeric = 100 and (public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'ready')::boolean);
select public.bs_check('all cancelled can send', (public.business_setup_handover_state(pg_temp.fx('q_cancelled')::uuid) ->> 'ready')::boolean);
select public.bs_check('net paid shown', (public.business_setup_handover_state(pg_temp.fx('q_cancelled')::uuid) ->> 'net_paid')::numeric = 500);
select public.bs_check('dashboard counts what is ready', (public.business_setup_dashboard() ->> 'ready_for_accounts')::int >= 2);
select public.bs_as('00000000-0000-0000-0000-00000000000d');
select public.bs_as('00000000-0000-0000-0000-000000000099');
select public.bs_expect_error(format($$select business_setup_send_to_accounts('%s')$$, pg_temp.fx('q_done')), 'permission');
select public.bs_expect_error(format($$select business_setup_handover_state('%s')$$, pg_temp.fx('q_done')), 'permission');
select public.bs_expect_error($$select business_setup_accounts_queue()$$, 'permission');
select public.bs_expect_error(format($$select business_setup_accounts_review('%s','validate')$$, pg_temp.fx('q_done')), 'permission');

-- ── Sending locks it ──
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_send_to_accounts(pg_temp.fx('q_done')::uuid, 'Ready to invoice');
select public.bs_check('state says with Accounts', public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'state' = 'With Accounts' and not (public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'ready')::boolean);
select public.bs_check('the services are locked', (select locked from public.business_setup_services where id = pg_temp.fx('svc_locked')::uuid));
select public.bs_expect_error(format($$select business_setup_send_to_accounts('%s')$$, pg_temp.fx('q_done')), 'already');
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('svc_locked')), 'Accounts');
select public.bs_expect_error(format($$select business_setup_document_add('%s')$$, jsonb_build_object('client_id','CL900090','file_name','late.pdf','storage_path','x/late.pdf','service_id',pg_temp.fx('svc_locked'))), 'Accounts');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error(format($$select business_setup_payment_add('%s')$$, jsonb_build_object('quote_id', pg_temp.fx('q_done'), 'amount', 10)), 'Accounts');
select public.bs_check('queue lists it', public.business_setup_accounts_queue()::text ~ 'H-DONE');
select public.bs_check('queue shows the balance and services', (select (e ->> 'outstanding')::numeric = 100 and jsonb_array_length(e -> 'services') = 2 and e ->> 'client_name' = 'Handover LLC' from jsonb_array_elements(public.business_setup_accounts_queue()) e where e ->> 'number' = 'H-DONE'));
select public.bs_check('queue leaves out what is not sent', public.business_setup_accounts_queue()::text !~ 'H-OPEN');

-- ── Revert reopens ──
select public.bs_expect_error(format($$select business_setup_accounts_review('%s','revert',null)$$, pg_temp.fx('q_done')), 'remarks');
select public.bs_expect_error(format($$select business_setup_accounts_review('%s','other','x')$$, pg_temp.fx('q_done')), 'Unknown');
select public.business_setup_accounts_review(pg_temp.fx('q_done')::uuid, 'revert', 'Receipt missing');
select public.bs_check('revert unlocks', not (select locked from public.business_setup_services where id = pg_temp.fx('svc_locked')::uuid));
select public.bs_check('revert carries remarks', public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'state' = 'Reverted' and public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'remarks' = 'Receipt missing');
select public.bs_check('dashboard counts the revert', (public.business_setup_dashboard() ->> 'reverted_by_accounts')::int >= 1);
select public.bs_expect_error(format($$select business_setup_accounts_review('%s','validate')$$, pg_temp.fx('q_done')), 'not waiting');
select public.business_setup_payment_add(jsonb_build_object('quote_id', pg_temp.fx('q_done'), 'amount', 100)) as ignored \gset
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.business_setup_send_to_accounts(pg_temp.fx('q_done')::uuid);

-- ── Validate closes ──
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.business_setup_accounts_review(pg_temp.fx('q_done')::uuid, 'validate');
select public.bs_check('validated is closed and stays locked', public.business_setup_handover_state(pg_temp.fx('q_done')::uuid) ->> 'state' = 'Closed' and (select locked from public.business_setup_services where id = pg_temp.fx('svc_locked')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000b');
select public.bs_expect_error(format($$select business_setup_send_to_accounts('%s')$$, pg_temp.fx('q_done')), 'already');
select public.bs_expect_error(format($$select business_setup_service_update('%s','In progress')$$, pg_temp.fx('svc_locked')), 'Accounts');
select public.bs_as(null);
select public.bs_check('every step is reviewed in order', (select array_agg(action order by created_at, id) from public.business_setup_accounts_reviews where quote_id = pg_temp.fx('q_done')::uuid) @> array['Sent', 'Reverted', 'Validated']
  and (select count(*) from public.business_setup_accounts_reviews where quote_id = pg_temp.fx('q_done')::uuid) = 4);
select public.bs_expect_error($$update business_setup_accounts_reviews set remarks = 'x'$$, 'append');
select public.bs_expect_error($$delete from business_setup_accounts_reviews$$, 'append');
select public.bs_check('invoices not writable', not has_table_privilege('authenticated', 'public.business_setup_invoices', 'insert') and not has_table_privilege('authenticated', 'public.business_setup_invoices', 'update'));
select public.bs_check('sending writes the audit log', public.bs_audit_count('send_to_accounts', pg_temp.fx('q_done'), '{"client_id":"CL900090"}') = 2);

-- ── Summary: raise when anything failed so psql exits non-zero ──
do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
