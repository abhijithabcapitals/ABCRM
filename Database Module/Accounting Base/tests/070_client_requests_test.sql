-- Client requests (006): who may make one, the no-login refusal, the sign-in link, client activity and Received.
-- Reuses t.ok and t.fails from 010 in the same database.
\set ON_ERROR_STOP on
reset role;
insert into client_master (client_id, legal_name, data) values
  ('CR-1', 'Request Co LLC', '{"General Email": "owner@request.test"}'),
  ('CR-2', 'No Login LLC', '{}');
insert into client_portal_accounts (client_master_id, display_name, username, email) values ('CR-1', 'Request Co LLC', 'requestco', 'login@request.test');
grant select on t.keep to authenticated;
create table t.req (k text primary key, v jsonb);
grant all on t.req to authenticated;
-- The owner runs what the Edge Function runs with the service role.
create function t.svc(stmt text) returns jsonb language plpgsql security definer as $$ declare r jsonb; begin execute stmt into r; return r; end $$;
grant execute on function t.svc(text) to authenticated;
create function t.make(k text, p jsonb) returns jsonb language sql as $$
  insert into t.req values (k, accounting_client_request_create(p)) returning v $$;
create function t.r(k text) returns uuid language sql as $$ select (v ->> 'id')::uuid from t.req where t.req.k = $1 $$;
create function t.tok(k text) returns text language sql as $$ select v ->> 'token' from t.req where t.req.k = $1 $$;

set role authenticated;
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- Who may call what
select t.ok('anon_cannot_call_' || f, not has_function_privilege('anon', 'public.' || f, 'execute'))
  from unnest(array['accounting_client_request_create(jsonb)', 'client_portal_link_login(text)', 'client_portal_requests(uuid)']) f;
select t.ok('authenticated_cannot_call_' || f, not has_function_privilege('authenticated', 'public.' || f, 'execute'))
  from unnest(array['accounting_client_request_mailed(uuid,boolean,text)', 'client_portal_link_login(text)', 'client_portal_requests(uuid)', 'client_portal_request_shared(uuid,uuid)']) f;
select t.ok('staff_cannot_read_link_hash', not has_column_privilege('authenticated', 'public.accounting_client_requests', 'link_hash', 'select'));

-- Login check
select t.ok('login_found', (accounting_client_request_login('CR-1') ->> 'has_login')::boolean and accounting_client_request_login('CR-1') ->> 'email' = 'owner@request.test');
select t.ok('no_login_found', not (accounting_client_request_login('CR-2') ->> 'has_login')::boolean);

-- Refusals
select t.fails('no_login_refused', $$select accounting_client_request_create('{"client_id":"CR-2","items":["Accounting data"]}')$$, 'no client login');
select t.fails('no_items_refused', $$select accounting_client_request_create('{"client_id":"CR-1","items":[]}')$$, 'at least one');
select t.fails('unknown_item_refused', $$select accounting_client_request_create('{"client_id":"CR-1","items":["Cake"]}')$$, 'Unknown');
select t.fails('other_needs_note', $$select accounting_client_request_create('{"client_id":"CR-1","items":["Other"]}')$$, 'under Other');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000b', false);
select t.fails('no_role_refused', $$select accounting_client_request_create('{"client_id":"CR-1","items":["Accounting data"]}')$$, '');
select set_config('test.uid', '00000000-0000-0000-0000-00000000000a', false);

-- A request
select t.make('a', '{"client_id":"CR-1","items":["Legal documents","Accounting data","Accounting data"],"message":"For Q3"}');
select t.ok('token_is_64_hex', t.tok('a') ~ '^[0-9a-f]{64}$');
select t.ok('items_unique_sorted', (select items from accounting_client_requests where id = t.r('a')) = array['Accounting data','Legal documents']);
select t.ok('mail_to_client_master', (select email_to from accounting_client_requests where id = t.r('a')) = 'owner@request.test');
select t.ok('expires_in_7_days', (select link_expires_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour' from accounting_client_requests where id = t.r('a')));

-- The mail result is set once
select t.svc(format('select to_jsonb(accounting_client_request_mailed(%L, false, %L))', t.r('a'), 'SMTP down'));
select t.svc(format('select to_jsonb(accounting_client_request_mailed(%L, true, null))', t.r('a')));
select t.ok('mail_result_kept_first', (select emailed = false and email_error = 'SMTP down' from accounting_client_requests where id = t.r('a')));

-- The link signs in
select t.ok('link_signs_in', (t.svc(format('select client_portal_link_login(%L)', t.tok('a'))) ->> 'ok')::boolean);
select t.ok('link_counts_use', (select link_uses = 1 and link_last_used_at is not null from accounting_client_requests where id = t.r('a')));
select t.ok('wrong_link_refused', not (t.svc(format('select client_portal_link_login(%L)', repeat('0', 64))) ->> 'ok')::boolean);
select t.ok('junk_link_refused', not (t.svc($$select client_portal_link_login('x')$$) ->> 'ok')::boolean);

-- Client side: list and "I have sent everything"
select t.ok('client_sees_request', jsonb_array_length(t.svc(format('select client_portal_requests(%L)', (select account_id from accounting_client_requests where id = t.r('a'))))) = 1);
select t.svc(format('select to_jsonb(client_portal_request_shared(%L, %L))', (select account_id from accounting_client_requests where id = t.r('a')), t.r('a')));
select t.ok('shared_at_set', (select client_shared_at is not null from accounting_client_requests where id = t.r('a')));

-- Activity since the request
reset role;
insert into client_portal_documents (account_id, doc_type, file_name, upload_complete) select account_id, 'Bank Statement', 'q3.pdf', true from accounting_client_requests where id = t.r('a');
insert into client_portal_documents (account_id, doc_type, file_name, upload_complete) select account_id, 'Other', 'half.pdf', false from accounting_client_requests where id = t.r('a');
insert into client_portal_documents (account_id, doc_type, file_name, upload_complete, uploaded_at) select account_id, 'Other', 'old.pdf', true, now() - interval '1 day' from accounting_client_requests where id = t.r('a');
insert into client_portal_change_requests (account_id, field_key, new_value) select account_id, 'TRN', '100' from accounting_client_requests where id = t.r('a');
set role authenticated;
select t.ok('activity_lists_new_finished_uploads', (select jsonb_array_length(accounting_client_request_activity(t.r('a')) -> 'documents')) = 1);
select t.ok('activity_lists_changes', (select jsonb_array_length(accounting_client_request_activity(t.r('a')) -> 'changes')) = 1);

-- Received and back
select accounting_client_request_set_received(t.r('a'), true, 'All in');
select t.ok('received', (select received_at is not null and received_note = 'All in' from accounting_client_requests where id = t.r('a')));
select t.fails('received_twice_refused', format('select accounting_client_request_set_received(%L, true, null)', t.r('a')), 'already');
select t.fails('shared_after_received_refused', format('select t.svc(%L)', format('select to_jsonb(client_portal_request_shared(%L, %L))', (select account_id from accounting_client_requests where id = t.r('a')), t.r('a'))), 'not found');
select accounting_client_request_set_received(t.r('a'), false, null);
select t.ok('moved_back', (select received_at is null from accounting_client_requests where id = t.r('a')));

-- Ending the link stops it
select accounting_client_request_end_link(t.r('a'));
select t.ok('ended_link_refused', not (t.svc(format('select client_portal_link_login(%L)', t.tok('a'))) ->> 'ok')::boolean);

-- An expired link and a revoked login stop it too
select t.make('b', '{"client_id":"CR-1","items":["Other"],"other_note":"Lease"}');
reset role;
update accounting_client_requests set link_expires_at = now() - interval '1 second' where id = t.r('b');
set role authenticated;
select t.ok('expired_link_refused', not (t.svc(format('select client_portal_link_login(%L)', t.tok('b'))) ->> 'ok')::boolean);
select t.make('c', '{"client_id":"CR-1","items":["Payment for services"]}');
reset role;
update client_portal_accounts set status = 'revoked' where client_master_id = 'CR-1';
set role authenticated;
select t.ok('revoked_login_refused', not (t.svc(format('select client_portal_link_login(%L)', t.tok('c'))) ->> 'ok')::boolean);
reset role;
update client_portal_accounts set status = 'active' where client_master_id = 'CR-1';
