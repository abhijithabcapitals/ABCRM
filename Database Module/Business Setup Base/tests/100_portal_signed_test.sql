-- LOCAL TEST ONLY: the portal view of signed copies (staff upload, state only) and invoices (restructure Task 8). The client's own upload is gone. Run through tests/run-local.sh, after 090.
\set QUIET on
\pset tuples_only on
\pset format unaligned
-- 010 grants every function to signed-in users for its own calls: run the migrations again to restore their real grants.
\ir ../migrations/013_cases.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/015_documentation.sql
\ir ../migrations/018_portal.sql
create temp table f100 (k text primary key, v text);
grant all on f100 to authenticated;
create function pg_temp.fx(p_k text) returns text language sql as $$ select v from f100 where k = p_k $$;
create function pg_temp.mkq(p_client text, p_key text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false);
  insert into f100 values (p_key, (public.hub_document_create(jsonb_build_object('doc_type', 'quote', 'department', 'Business Setup', 'client_name', p_client || ' LLC', 'contact_name', 'C',
    'contact_email', 'c@x.ae', 'contact_phone', '1', 'client_id', p_client, 'lines', '[{"description":"Licence","amount":1000}]'::jsonb))).id::text);
end $$;
create function pg_temp.view(p_acc text) returns jsonb language sql security definer as $$ select public.business_setup_portal_view(pg_temp.fx(p_acc)::uuid) $$;
create function pg_temp.vq(p_acc text, p_quote text) returns jsonb language sql security definer as $$
  select e from jsonb_array_elements(public.business_setup_portal_view(pg_temp.fx(p_acc)::uuid) -> 'quotes') e where e ->> 'id' = pg_temp.fx(p_quote) $$;
select public.bs_as(null);
insert into public.client_master (client_id, legal_name, data) values ('CL900100', 'Client A100 LLC', '{}'), ('CL900101', 'Client B100 LLC', '{}') on conflict do nothing;
insert into public.business_setup_kyc_profiles (client_id, kyc_state) values ('CL900100', 'Done'), ('CL900101', 'Done') on conflict (client_id) do update set kyc_state = 'Done';
insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('CL900100', 'A', 'portal.a100', 'x'), ('CL900101', 'B', 'portal.b100', 'x');
insert into f100 select 'acc_a', id::text from public.client_portal_accounts where username = 'portal.a100';
insert into f100 select 'acc_b', id::text from public.client_portal_accounts where username = 'portal.b100';
select pg_temp.mkq('CL900100', 'qa');
select pg_temp.mkq('CL900101', 'qb');
select public.bs_as(null);

-- ── who may call ──
select public.bs_check('no_client_upload: business_setup_portal_signed_add no longer exists', not exists (select 1 from pg_proc where proname = 'business_setup_portal_signed_add'));
select public.bs_check('the portal view stays service-role only', not has_function_privilege('anon', 'public.business_setup_portal_view(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_portal_view(uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_portal_view(uuid)', 'execute'));
select public.bs_check('portal_other_client: account A does not see client B in its view', pg_temp.view('acc_a')::text !~ 'Client B100' and pg_temp.vq('acc_a', 'qb') is null and pg_temp.vq('acc_a', 'qa') is not null);

-- ── a signed copy added by staff shows in the portal as state only ──
select public.bs_check('before any copy the quote shows none, and offers no client upload', pg_temp.vq('acc_a', 'qa') -> 'signed' = 'null'::jsonb and not (pg_temp.vq('acc_a', 'qa') ? 'can_sign'));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f100 values ('sa1', public.business_setup_signed_add(pg_temp.fx('qa')::uuid, 'staff/CL900100/signed.pdf')::text);
select public.bs_as(null);
select public.bs_check('a staff upload is kept as Staff / Uploaded', (select source = 'Staff' and status = 'Uploaded' from public.business_setup_signed_quotes where id = pg_temp.fx('sa1')::uuid));
select public.bs_check('the portal shows it as waiting', pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Uploaded');
select public.bs_check('an upload does not accept the quote', (select status = 'issued' from public.hub_documents where id = pg_temp.fx('qa')::uuid));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_signed_decide(pg_temp.fx('sa1')::uuid, false, 'The signature page is missing');
select public.bs_as(null);
select public.bs_check('refuse_note: the portal shows the refusal and its note',
  pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Refused' and pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'note' = 'The signature page is missing');
select public.bs_check('the portal view never carries a staff name, id or the decided_by column', pg_temp.view('acc_a')::text !~* '(decided_by|created_by|Sales|Manager|00000000-0000-0000-0000-00000000000)');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
insert into f100 values ('sa2', public.business_setup_signed_add(pg_temp.fx('qa')::uuid, 'staff/CL900100/signed-2.pdf')::text);
select public.business_setup_signed_decide(pg_temp.fx('sa2')::uuid, true, 'Confirmed, thank you');
select public.bs_as(null);
select public.bs_check('confirming the staff copy accepts the quote', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('qa')::uuid) and (select count(*) = 1 from public.business_setup_services where quote_id = pg_temp.fx('qa')::uuid));
select public.bs_check('after acceptance the portal hides the confirm note', pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Confirmed' and pg_temp.vq('acc_a', 'qa') -> 'signed' -> 'note' = 'null'::jsonb);
select public.bs_check('client B is unaffected', pg_temp.vq('acc_b', 'qb') -> 'signed' = 'null'::jsonb and (select status = 'issued' from public.hub_documents where id = pg_temp.fx('qb')::uuid));

-- ── the login name for the quote message: quote staff only, and never a password or vault reference ──
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_check('login_name: SALES_EXECUTIVE gets id, username and status and nothing else', (select array_agg(k order by k) = array['id', 'status', 'username'] from jsonb_object_keys(public.business_setup_portal_login_name('CL900100')) k)
  and public.business_setup_portal_login_name('CL900100') ->> 'username' = 'portal.a100');
select public.bs_check('login_name: a client with no login gives nothing', public.business_setup_portal_login_name('CL000000-none') is null);
select public.bs_expect_error($$select business_setup_portal_login_state('CL900100')$$, 'permission');
select public.bs_as('00000000-0000-0000-0000-00000000000e');
select public.bs_expect_error($$select business_setup_portal_login_name('CL900100')$$, 'permission');
select public.bs_as(null);
select public.t_anon_refused('login_name: anon is refused', $$select public.business_setup_portal_login_name('CL900100')$$);

-- ── Paid is hidden on rejected quotes in the portal ──
insert into public.business_setup_payments (client_id, quote_id, paid_on, amount, type) values ('CL900101', pg_temp.fx('qb')::uuid, current_date, 400, 'Payment');
select public.bs_check('an issued quote shows what is paid', (pg_temp.vq('acc_b', 'qb') ->> 'net_paid')::numeric = 400);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_quote_reject(pg_temp.fx('qb')::uuid, 'Declined');
select public.bs_as(null);
select public.bs_check('a rejected quote shows no paid or outstanding in the portal', pg_temp.vq('acc_b', 'qb') ->> 'status' = 'rejected' and pg_temp.vq('acc_b', 'qb') -> 'net_paid' = 'null'::jsonb and pg_temp.vq('acc_b', 'qb') -> 'outstanding' = 'null'::jsonb);

-- ── Task 9: a recorded invoice reaches the client's Invoices section, and only that client's ──
create function pg_temp.vinv(p_acc text) returns jsonb language sql security definer as $$ select public.business_setup_portal_view(pg_temp.fx(p_acc)::uuid) -> 'invoices' $$;
select public.bs_check('invoices stay empty until one is recorded', pg_temp.vinv('acc_a') = '[]'::jsonb and pg_temp.vinv('acc_b') = '[]'::jsonb);
select public.bs_as('00000000-0000-0000-0000-00000000000e');
insert into f100 values ('inv_a', public.business_setup_invoice_record(jsonb_build_object('quote_id', pg_temp.fx('qa'), 'invoice_number', 'PINV-A', 'invoice_date', '2026-10-02', 'amount', 1050,
  'file_path', 'CL900100/invoice/pinv-a.pdf'))::text);
select public.bs_as(null);
select public.bs_check('portal_invoice: the recorded invoice appears in the client''s Invoices section',
  jsonb_array_length(pg_temp.vinv('acc_a')) = 1 and pg_temp.vinv('acc_a') -> 0 ->> 'number' = 'PINV-A' and (pg_temp.vinv('acc_a') -> 0 ->> 'amount')::numeric = 1050
  and pg_temp.vinv('acc_a') -> 0 ->> 'date' = '2026-10-02' and (pg_temp.vinv('acc_a') -> 0 ->> 'has_file')::boolean);
select public.bs_check('portal_invoice: another client sees none of it', pg_temp.vinv('acc_b') = '[]'::jsonb and pg_temp.view('acc_b')::text !~ 'PINV-A');
select public.bs_check('portal_invoice: the view names no staff or storage fields', (pg_temp.vinv('acc_a') -> 0) ?| array['file_path', 'created_by', 'case_id', 'source', 'zoho_id', 'client_id'] = false);
select public.bs_check('portal_invoice: the client opens their own invoice file', public.business_setup_portal_file(pg_temp.fx('acc_a')::uuid, 'invoice', pg_temp.fx('inv_a')::uuid) ->> 'path' = 'CL900100/invoice/pinv-a.pdf');
select public.bs_expect_error(format($$select public.business_setup_portal_file('%s', 'invoice', '%s')$$, pg_temp.fx('acc_b'), pg_temp.fx('inv_a')), 'File not found');

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
