-- LOCAL TEST ONLY: a client's signed quote upload through the portal (restructure Task 8). Run through tests/run-local.sh, after 090.
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
select public.bs_check('portal_roles: anon and authenticated cannot call business_setup_portal_signed_add', not has_function_privilege('anon', 'public.business_setup_portal_signed_add(uuid, uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_portal_signed_add(uuid, uuid, text)', 'execute') and has_function_privilege('service_role', 'public.business_setup_portal_signed_add(uuid, uuid, text)', 'execute'));
select public.bs_check('the portal view stays service-role only', not has_function_privilege('anon', 'public.business_setup_portal_view(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.business_setup_portal_view(uuid)', 'execute') and has_function_privilege('service_role', 'public.business_setup_portal_view(uuid)', 'execute'));
select public.t_anon_refused('portal_roles: anon is refused', format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')));
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'permission denied');
select public.bs_as(null);

-- ── the quote must be this client's, and issued ──
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qb'), pg_temp.fx('acc_a')), 'Quote not found');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_b'), pg_temp.fx('qa'), pg_temp.fx('acc_b')), 'Quote not found');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, gen_random_uuid(), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'Quote not found');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', gen_random_uuid(), 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('acc_a')), 'Quote not found');
select public.bs_check('portal_other_client: nothing was stored by the refused calls', not exists (select 1 from public.business_setup_signed_quotes where storage_path like 'incoming/%'));
select public.bs_check('portal_other_client: account A does not see client B in its view', pg_temp.view('acc_a')::text !~ 'Client B100' and pg_temp.vq('acc_a', 'qb') is null and pg_temp.vq('acc_a', 'qa') is not null);
-- path rules, same as the staff side
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/x/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_b')), 'not valid');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'staff/CL900100/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa')), 'not valid');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/../%s/a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a'), pg_temp.fx('acc_b')), 'not valid');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s//a.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'not valid');
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', null)$$, pg_temp.fx('acc_a'), pg_temp.fx('qa')), 'missing');

-- ── upload, view and refuse ──
select public.bs_check('before any upload the quote can be signed and shows no copy', (pg_temp.vq('acc_a', 'qa') ->> 'can_sign')::boolean and pg_temp.vq('acc_a', 'qa') -> 'signed' = 'null'::jsonb);
insert into f100 values ('sa1', public.business_setup_portal_signed_add(pg_temp.fx('acc_a')::uuid, pg_temp.fx('qa')::uuid, 'incoming/' || pg_temp.fx('acc_a') || '/f1/signed.pdf')::text);
select public.bs_check('a client upload is kept as Client / Uploaded with no staff author', (select source = 'Client' and status = 'Uploaded' and created_by is null from public.business_setup_signed_quotes where id = pg_temp.fx('sa1')::uuid));
select public.bs_check('the portal shows it as waiting, and no second upload yet', pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Uploaded' and not (pg_temp.vq('acc_a', 'qa') ->> 'can_sign')::boolean);
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/f2/signed.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'already waiting');
select public.bs_check('an upload does not accept the quote', (select status = 'issued' from public.hub_documents where id = pg_temp.fx('qa')::uuid));
select public.bs_check('the upload is audited without client data', public.bs_audit_count('signed_add', pg_temp.fx('sa1'), '{"source":"Client"}') = 1);
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_signed_decide(pg_temp.fx('sa1')::uuid, false, 'The signature page is missing');
select public.bs_as(null);
select public.bs_check('refuse_note: the portal shows the refusal and its note, and a new upload is allowed',
  pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Refused' and pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'note' = 'The signature page is missing' and (pg_temp.vq('acc_a', 'qa') ->> 'can_sign')::boolean);
select public.bs_check('the portal view never carries a staff name, id or the decided_by column', pg_temp.view('acc_a')::text !~* '(decided_by|created_by|Sales|Manager|00000000-0000-0000-0000-00000000000)');
insert into f100 values ('sa2', public.business_setup_portal_signed_add(pg_temp.fx('acc_a')::uuid, pg_temp.fx('qa')::uuid, 'incoming/' || pg_temp.fx('acc_a') || '/f2/signed.pdf')::text);
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/f2/signed.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'already');
select public.bs_as('00000000-0000-0000-0000-00000000000c');
select public.business_setup_signed_decide(pg_temp.fx('sa2')::uuid, true, 'Confirmed, thank you');
select public.bs_as(null);
select public.bs_check('confirming the client copy accepts the quote', (select status = 'accepted' from public.hub_documents where id = pg_temp.fx('qa')::uuid) and (select count(*) = 1 from public.business_setup_services where quote_id = pg_temp.fx('qa')::uuid));
select public.bs_check('after acceptance the portal hides the confirm note and offers no upload', pg_temp.vq('acc_a', 'qa') -> 'signed' ->> 'status' = 'Confirmed' and pg_temp.vq('acc_a', 'qa') -> 'signed' -> 'note' = 'null'::jsonb and not (pg_temp.vq('acc_a', 'qa') ->> 'can_sign')::boolean);
select public.bs_expect_error(format($$select public.business_setup_portal_signed_add('%s', '%s', 'incoming/%s/f3/signed.pdf')$$, pg_temp.fx('acc_a'), pg_temp.fx('qa'), pg_temp.fx('acc_a')), 'waiting for you');
select public.bs_check('client B is unaffected', (pg_temp.vq('acc_b', 'qb') ->> 'can_sign')::boolean and (select status = 'issued' from public.hub_documents where id = pg_temp.fx('qb')::uuid));

-- ── the Edge Function checks the same file path before it calls this function ──
select public.bs_check('the same path cannot be sent twice (unique)', (select count(*) = 1 from public.business_setup_signed_quotes where storage_path = 'incoming/' || pg_temp.fx('acc_a') || '/f2/signed.pdf'));

do $$
declare f int; t int;
begin
  select count(*) filter (where not ok), count(*) into f, t from public.bs_result;
  raise notice '% checks, % failed', t, f;
  if f > 0 then raise exception 'Business Setup tests failed: % of % checks', f, t; end if;
end $$;
