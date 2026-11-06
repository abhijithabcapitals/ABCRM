-- Undoes migrations 013 onward (the case restructure), newest first, in one transaction. Migrations 001 to 012 stay.
-- Run with psql (it uses \ir to re-run the file that last defined a replaced function). Each migration adds its section
-- at the top of the body, above the one before it, so the order here is the reverse of the order they were applied.
-- WARNING: cases and everything stored only on them are lost. Quotes, letters, payments and forms keep their rows.
-- WARNING (signed copies): every row of business_setup_signed_quotes is lost, including real client and staff uploads and their review
-- notes. The files stay in storage but nothing points at them. Applying 015 again turns every already accepted quote into a Legacy
-- row with no file, so a real signed copy is no longer linked after a rollback and re-apply.
-- WARNING (advances): a payment recorded on a case before any quote has no quote_id. When case_id goes, the advance loses its case and falls out of net_paid, which then
-- sums by quote only: the money stays on the client's payment list but counts toward nothing. Note such payments before rolling back.
-- To undo phase 2 alone and keep cases, run rollback/015_018_rollback.sql instead.
begin;

-- 022 (service checklists) goes first: see rollback/022_rollback.sql for what is lost.
create or replace function public.business_setup_quote_accept_body(p_id uuid, p_allow_expired boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  select * into q from hub_documents where id = p_id;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
  v_root := coalesce(q.root_quote_id, q.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
    raise exception 'A quote in this revision chain is already accepted';
  end if;
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and cannot take an accepted quote', lower((select stage from business_setup_cases where id = q.case_id));
  end if;
  if q.case_id is not null and exists (select 1 from hub_documents where case_id = q.case_id and doc_type = 'quote' and status = 'accepted' and id <> q.id) then
    raise exception 'Another quote of this case is already accepted: a case holds one quote and its revisions';
  end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
  -- The KYC is finished when it is marked Done or nothing is missing. A client accepting from the portal is not told what staff still have to fill in.
  if not business_setup_kyc_finished(q.client_id) then
    if auth.uid() is null then raise exception 'Your details are not complete yet. Please contact AB Capital Services FZE.'; end if;
    raise exception 'The client KYC is incomplete: missing %', array_to_string(business_setup_kyc_missing(q.client_id), ', ');
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;
  if not exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Confirmed')
     and not exists (select 1 from business_setup_acceptances where document_id = q.id and kind = 'Quote' and decision = 'Accepted') then
    raise exception 'This quote has not been accepted by the client or confirmed from a signed copy yet';
  end if;

  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(),
         status_reason = case when q.valid_until is not null and q.valid_until < v_today then 'Accepted after expiry' else null end
   where id = q.id;

  for ln in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
    v_name := coalesce(nullif(btrim(coalesce(ln ->> 'service_name', '')), ''), nullif(btrim(coalesce(ln ->> 'description', '')), ''));
    if v_name is null then raise exception 'Every quote line needs a service name'; end if;
    v_action := coalesce(nullif(btrim(coalesce(ln ->> 'action', '')), ''), 'New');
    if v_action not in ('New','Renewal','Rectification','Cancellation') then raise exception 'Unknown action % on a quote line', v_action; end if;
    v_renews := nullif(ln ->> 'renews_service_id', '')::uuid;
    if v_renews is not null and not exists (select 1 from business_setup_services where id = v_renews and client_id = q.client_id) then
      raise exception 'A renewal must link to an earlier service of the same client';
    end if;
    v_fee := nullif(ln ->> 'fee_item_id', '')::uuid;
    -- A line for a cost (its fee item is not a service) stays on the quote and creates no service.
    if v_fee is not null and not coalesce((select is_service from business_setup_fee_items where id = v_fee), true) then continue; end if;
    insert into business_setup_services (client_id, quote_id, fee_item_id, name, action, amount, renews_service_id)
    values (q.client_id, q.id, v_fee, v_name, v_action, nullif(ln ->> 'amount', '')::numeric, v_renews)
    returning id into v_svc;
    insert into business_setup_service_history (service_id, from_status, to_status, note)
    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);
    n := n + 1;
  end loop;

  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
end $$;

create or replace function public.business_setup_service_complete(p_id uuid, p_output_details jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s business_setup_services; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); d jsonb := coalesce(p_output_details, '{}'::jsonb);
  lic jsonb; v_expiry date; v_issue date; v_start_override boolean; v_no_output boolean;
begin
  perform business_setup_require('setup.services.manage');
  select * into s from business_setup_services where id = p_id for update;
  if s.id is null then raise exception 'Service not found'; end if;
  if s.status = 'Completed' then raise exception 'This service is already completed'; end if;
  if s.status = 'Cancelled' then raise exception 'A cancelled service cannot be completed'; end if;
  if jsonb_typeof(d) <> 'object' then raise exception 'The output details must be an object'; end if;
  v_no_output := not exists (select 1 from business_setup_documents where service_id = s.id and is_output);
  if v_no_output then
    if not business_setup_can('setup.services.override') then raise exception 'Upload at least one output file before completing this service'; end if;
    if v_reason is null then raise exception 'Give a reason for completing without an output file'; end if;
  end if;
  v_start_override := s.started_at is null and business_setup_start_gate(s.quote_id, v_reason);
  if d ? 'licence' then
    lic := d -> 'licence';
    if jsonb_typeof(lic) <> 'object' then raise exception 'The licence details must be an object'; end if;
    if nullif(btrim(coalesce(lic ->> 'number', '')), '') is null or nullif(btrim(coalesce(lic ->> 'authority', '')), '') is null
       or nullif(lic ->> 'issue_date', '') is null or nullif(lic ->> 'expiry_date', '') is null then
      raise exception 'Enter the licence number, issue date, expiry date and authority';
    end if;
    v_issue := (lic ->> 'issue_date')::date; v_expiry := (lic ->> 'expiry_date')::date;
    if v_expiry < v_issue then raise exception 'The licence expiry cannot be before its issue date'; end if;
    -- Client Master keeps UAE dates as DD/MM/YYYY.
    perform client_master_save(s.client_id, jsonb_build_object('Trade License Number', btrim(lic ->> 'number'), 'License Issuing Authority', btrim(lic ->> 'authority'),
            'License Issue Date', to_char(v_issue, 'DD/MM/YYYY'), 'License Expiry Date', to_char(v_expiry, 'DD/MM/YYYY')));
  end if;
  update business_setup_services set status = 'Completed', completed_at = now(), started_at = coalesce(started_at, now()),
      output_details = d, expiry_date = coalesce(v_expiry, expiry_date)
    where id = s.id;
  insert into business_setup_service_history (service_id, from_status, to_status, note) values (s.id, s.status, 'Completed', v_reason);
  perform business_setup_audit('business_setup_services', s.id::text, 'service_complete', null,
          jsonb_build_object('client_id', s.client_id, 'from_status', s.status, 'without_output', v_no_output, 'start_override', v_start_override,
                             'detail_keys', (select coalesce(jsonb_agg(key order by key), '[]'::jsonb) from jsonb_object_keys(d) key), 'reason', v_reason));
end $$;

create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'assigned' then array['Lead', 'Review']
    when 'leads' then array['Lead', 'Review']
    when 'inputs' then array['Lead', 'Review']
    when 'onboarding' then array['Onboarding']
    when 'pipeline' then array['Pipeline']
    when 'completion' then array['Completion', 'With Accounts']
    when 'closed' then array['Lost']
    when 'documentation' then array['Onboarding']
    when 'cases' then array['Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use assigned, leads, inputs, onboarding, pipeline, completion or closed', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'referred_by_name', case when (to_jsonb(c) ->> 'referred_by') is not null then business_setup_person_name((to_jsonb(c) ->> 'referred_by')::uuid) end,
      'docs', business_setup_case_docs(c.id),
      'intake_pending', exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null),
      'form_id', (select f.id from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'form_status', (select f.status from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))
          or exists (select 1 from business_setup_intake_submissions s where s.case_id = c.id and s.applied_at is null)));
end $$;

create or replace function public.business_setup_portal_view(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client and not s.historical),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'total', q.total_amount,
                  'net_paid', case when q.status in ('issued', 'accepted') then business_setup_net_paid(q.id) end, 'outstanding', case when q.status in ('issued', 'accepted') then greatest(q.total_amount - business_setup_net_paid(q.id), 0) end, 'has_file', q.storage_path is not null,
                  'closed', exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'signed', (select jsonb_build_object('status', s.status, 'date', s.created_at::date, 'note', case when s.status = 'Refused' then s.note end)
                               from business_setup_signed_quotes s where s.quote_id = q.id order by s.created_at desc limit 1),
                  'expired', q.status = 'issued' and q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date,
                  'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                 from business_setup_acceptances a where a.document_id = q.id order by a.created_at desc limit 1),
                  'can_decide', q.status = 'issued' and not (q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date)
                                and not exists (select 1 from business_setup_acceptances a where a.document_id = q.id)
                                and not exists (select 1 from business_setup_cases c where c.id = q.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')),
                  'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'signed_at', l.signed_at, 'has_file', l.storage_path is not null,
                                      'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                                     from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                                      'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                                    and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled')))
                               from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter' and l.status <> 'superseded' order by l.created_at desc limit 1)) order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q
                where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'date', y.paid_on, 'amount', y.amount, 'type', y.type, 'reference', y.reference,
                    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'has_file', r.storage_path is not null) order by y.paid_on desc, y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = v_client),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.issued_on, 'amount', i.amount, 'has_file', i.file_path is not null,
                    'claim_pending', exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending'),
                    -- The rule of business_setup_portal_claim_add, so the screen shows a state instead of a button that fails: the invoice belongs to a case that is not Lost, and no claim waits.
                    -- Nothing owed, no button: the case's balance (as business_setup_case_docs: the accepted or newest live quote's total less net payments) is above zero.
                    'can_claim', coalesce((select cs.stage <> 'Lost'
                                                  and coalesce((select t.total_amount from hub_documents t where t.case_id = cs.id and t.doc_type = 'quote' and t.status not in ('superseded', 'rejected')
                                                                 order by (t.status = 'accepted') desc, t.created_at desc limit 1), 0) - business_setup_case_net_paid(cs.id) > 0
                                             from business_setup_cases cs where cs.id = coalesce(i.case_id, (select q.case_id from hub_documents q where q.id = i.quote_id))), false)
                                 and not exists (select 1 from business_setup_payment_claims c where c.invoice_id = i.id and c.status = 'Pending')) order by i.issued_on desc), '[]'::jsonb)
                   from business_setup_invoices i where i.client_id = v_client),
    'claims', business_setup_portal_claims(p_account),
    'letters', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'has_file', l.storage_path is not null,
                    'quote_id', q.id, 'quote_number', q.document_number,
                    'decision', (select jsonb_build_object('decision', a.decision, 'revision', a.revision, 'date', a.created_at::date, 'source', a.source, 'note', case when a.source = 'Portal' and a.decision = 'Rejected' then a.note end)
                                   from business_setup_acceptances a where a.document_id = l.id order by a.created_at desc limit 1),
                    'can_decide', q.status = 'accepted' and l.status = 'issued' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
                                  and not exists (select 1 from business_setup_cases c where c.id = l.case_id and c.stage in ('Lost', 'Completed', 'Cancelled'))) order by l.created_at desc), '[]'::jsonb)
                  from hub_documents l join hub_documents q on q.id = l.parent_id
                 where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')
                   and l.doc_type = 'letter' and l.status <> 'superseded'),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'date', d.created_at::date) order by d.created_at desc), '[]'::jsonb)
                    from business_setup_documents d where d.client_id = v_client and d.is_output and d.client_visible));
end $$;

drop function if exists public.business_setup_checkpoint_list_save(jsonb);
drop function if exists public.business_setup_checkpoint_lists();
drop function if exists public.business_setup_service_checklist(uuid);
drop function if exists public.business_setup_checkpoint_file_link(uuid, uuid);
drop function if exists public.business_setup_service_details_save(uuid, jsonb);
drop function if exists public.business_setup_service_reopen(uuid, text);
drop function if exists public.business_setup_service_verify_all(uuid);
drop function if exists public.business_setup_checkpoint_verify(uuid);
drop function if exists public.business_setup_checkpoint_assign(uuid, uuid, date);
drop function if exists public.business_setup_checkpoint_set(uuid, text, text);
drop function if exists public.business_setup_checkpoint_open(uuid);
drop function if exists public.business_setup_service_can_work(uuid);
drop function if exists public.business_setup_service_progress(uuid);
drop function if exists public.business_setup_checkpoints_copy(uuid, uuid);
alter table public.business_setup_documents drop column if exists checkpoint_id;
alter table public.business_setup_services drop constraint if exists business_setup_services_priority_check;
alter table public.business_setup_services drop column if exists expected_completion;
alter table public.business_setup_services drop column if exists authority;
alter table public.business_setup_services drop column if exists priority;
alter table public.business_setup_services drop column if exists reviewer_id;
drop table if exists public.business_setup_service_checkpoints;
do $$ begin if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'business_setup_fee_items' and column_name = 'checkpoint_set_id') then execute 'update public.business_setup_fee_items set active = false where checkpoint_set_id is not null'; end if; end $$;
alter table public.business_setup_fee_items drop column if exists checkpoint_set_id;
drop table if exists public.business_setup_checkpoint_steps;
drop table if exists public.business_setup_checkpoint_sets;

-- 019 (open referral link) goes first: see rollback/019_rollback.sql for what is lost.
create or replace function public.business_setup_case_list(p_view text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_stages text[];
begin
  perform business_setup_require('setup.access');
  v_stages := case p_view
    when 'assigned' then array['Lead', 'Review']
    when 'leads' then array['Lead', 'Review']
    when 'inputs' then array['Lead', 'Review']
    when 'onboarding' then array['Onboarding']
    when 'pipeline' then array['Pipeline']
    when 'completion' then array['Completion', 'With Accounts']
    when 'closed' then array['Lost']
    when 'documentation' then array['Onboarding']
    when 'cases' then array['Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled']
    when 'all' then array['Lead', 'Review', 'Onboarding', 'Pipeline', 'Completion', 'With Accounts', 'Completed', 'Cancelled', 'Lost'] end;
  if v_stages is null then raise exception 'Unknown view %: use assigned, leads, inputs, onboarding, pipeline, completion or closed', p_view; end if;
  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(
      'client_name', m.legal_name,
      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,
      'referred_by_name', case when (to_jsonb(c) ->> 'referred_by') is not null then business_setup_person_name((to_jsonb(c) ->> 'referred_by')::uuid) end,
      'docs', business_setup_case_docs(c.id),
      'form_id', (select f.id from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'form_status', (select f.status from business_setup_onboarding_forms f where f.case_id = c.id order by f.created_at desc limit 1),
      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)
                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')
    ) order by c.created_at desc, c.id), '[]'::jsonb)
    from business_setup_cases c left join client_master m on m.client_id = c.client_id
   where c.stage = any (v_stages)
     and (p_view <> 'assigned' or c.owner_id = auth.uid())
     and (p_view <> 'inputs' or exists (select 1 from business_setup_onboarding_forms f where f.case_id = c.id and f.status in ('Submitted', 'In review'))));
end $$;

create or replace function public.business_setup_case_move_to_onboarding(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_client text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage not in ('Lead', 'Review') then raise exception 'Only a lead or a case in review can move to Client Onboarding'; end if;
  if c.owner_id is null then raise exception 'Assign the lead before moving it.'; end if;
  if c.owner_id <> auth.uid() and not business_setup_can('setup.cases.approve') then
    raise exception 'Only the owner (%) or a manager can move this case to Client Onboarding', business_setup_person_name(c.owner_id);
  end if;
  v_client := business_setup_case_link_client_body(p_case, p_client, p_allow_duplicate);
  perform business_setup_case_set_stage(p_case, 'Onboarding', 'Moved to Client Onboarding by ' || business_setup_person_name(auth.uid()));
  perform business_setup_case_sync(p_case);
  return v_client;
end $$;

create or replace function public.client_inputs_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (client_inputs_can() or business_setup_form_doc_can(p_id) or business_setup_claim_proof_can(p_id)) then raise exception 'You do not have access to Client Inputs.'; end if;
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'file_name', d.file_name, 'doc_type', d.doc_type,
         'status', d.status, 'client', a.display_name, 'filed_path', d.filed_path, 'actor', auth.uid(),
         'can_review', d.assigned_to = auth.uid() or client_portal_is_admin())
    into r from client_portal_documents d join client_portal_accounts a on a.id = d.account_id
   where d.id = p_id and d.upload_complete;
  if r is null then raise exception 'Document not found.'; end if;
  return r;
end $$;

drop function if exists public.business_setup_intake_apply(uuid, text);
drop function if exists public.business_setup_intake_cleanup();
drop function if exists public.business_setup_intake_submit(text, uuid, jsonb, text, uuid);
drop function if exists public.business_setup_intake_upload_ok(text, uuid, text, text, bigint);
drop function if exists public.business_setup_intake_open(text);
drop function if exists public.business_setup_case_spam(uuid, text);
drop function if exists public.business_setup_referrers();
drop function if exists public.business_setup_case_set_referrer(uuid, uuid, text);
drop function if exists public.business_setup_intake_detail(uuid);
drop function if exists public.business_setup_intake_link_revoke(uuid);
drop function if exists public.business_setup_intake_link_list();
drop function if exists public.business_setup_intake_link_new();
drop trigger if exists business_setup_form_account_fill on public.client_portal_accounts;
drop function if exists public.business_setup_form_account_fill();
drop trigger if exists business_setup_form_no_login_guard on public.business_setup_onboarding_forms;
drop function if exists public.business_setup_form_no_login_guard();
delete from public.client_portal_documents where account_id is null;
update public.business_setup_onboarding_forms f set account_id = a.id from public.client_portal_accounts a where f.account_id is null and a.client_master_id = f.client_id;
delete from public.business_setup_onboarding_forms where account_id is null;
alter table public.client_portal_documents alter column account_id set not null;
alter table public.business_setup_onboarding_forms alter column account_id set not null;
drop table if exists public.business_setup_intake_files;
drop table if exists public.business_setup_intake_submissions;
alter table public.business_setup_cases drop column if exists referred_by;
alter table public.business_setup_cases drop column if exists intake_link_id;
drop table if exists public.business_setup_intake_links;

-- ── 016_client_flow.sql ──────────────────────────────────────────────
-- Acceptance records (016) and the client login and decision functions (018): the triggers, the append-only table (before business_setup_signed_quotes, which it
-- points at) and the functions go. WARNING: every acceptance row is lost. A quote accepted from the portal stays accepted, with no signed copy behind it; an
-- accepted quote needs none at 014. The accept logic returns to 014's below (business_setup_quote_accept_body goes with it).
-- Payment claims (016, 018): the table with its trigger, and the functions. WARNING: every claim row is lost, with its status and refusal note. A confirmed claim's
-- payment and receipt stay (payments are append-only); payment_add returns to 014's below and no longer takes claim_id.
drop table if exists public.business_setup_payment_claims;
drop function if exists public.business_setup_payment_claims_guard();
drop function if exists public.business_setup_claim_refuse(uuid, text);
-- Client Onboarding screen (client flow Task 7): the claim list and the claim-proof right go, client_inputs_file returns to 009's text, and the trigger that
-- re-checks a case when one of its form documents changes goes.
create or replace function public.client_inputs_file(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  if not (client_inputs_can() or business_setup_form_doc_can(p_id)) then raise exception 'You do not have access to Client Inputs.'; end if;
  select jsonb_build_object('id', d.id, 'storage_path', d.storage_path, 'file_name', d.file_name, 'doc_type', d.doc_type,
         'status', d.status, 'client', a.display_name, 'filed_path', d.filed_path, 'actor', auth.uid(),
         'can_review', d.assigned_to = auth.uid() or client_portal_is_admin())
    into r from client_portal_documents d join client_portal_accounts a on a.id = d.account_id
   where d.id = p_id and d.upload_complete;
  if r is null then raise exception 'Document not found.'; end if;
  return r;
end $$;
drop function if exists public.business_setup_claim_proof_can(uuid);
drop function if exists public.business_setup_claim_list(uuid);
drop trigger if exists business_setup_case_doc on public.client_portal_documents;
drop function if exists public.business_setup_case_doc_trg();
drop function if exists public.business_setup_portal_claim_add(uuid, jsonb);
drop function if exists public.business_setup_portal_claims(uuid);
drop trigger if exists business_setup_case_acceptance on public.business_setup_acceptances;
drop trigger if exists business_setup_case_login on public.client_portal_accounts;
drop trigger if exists business_setup_case_kyc on public.business_setup_kyc_profiles;
drop table if exists public.business_setup_acceptances;
drop function if exists public.business_setup_acceptances_immutable();
drop function if exists public.business_setup_case_acceptance_trg();
drop function if exists public.business_setup_case_client_trg();
drop function if exists public.business_setup_doc_revision(uuid);
drop function if exists public.business_setup_portal_decide(uuid, uuid, text, text);
drop function if exists public.business_setup_issue_login_ok(uuid);
drop function if exists public.business_setup_login_grant(text, text, text, text, uuid);
drop function if exists public.business_setup_login_mail(text, boolean, uuid);
-- The move function goes. The start gate returns to 006's (016 lets a quote of a case start without a payment, which reads case_id). The other functions 016
-- replaced (case_sync, case_docs, case_list, case_new, case_take, case_shared, case_confirm, case_lost, case_form_trg, dashboard) are dropped or restored by the sections below.
drop trigger if exists business_setup_case_handover on public.business_setup_handovers;
drop function if exists public.business_setup_case_handover_trg();
drop function if exists public.business_setup_case_move_to_onboarding(uuid, text, boolean);
-- 017's two KYC functions go.
drop function if exists public.business_setup_kyc_finished(text);
drop function if exists public.business_setup_kyc_missing(text);
-- business_setup_send_to_accounts goes back to 011's (016 asked for setup.cases.approve).
create or replace function public.business_setup_send_to_accounts(p_quote uuid, p_remarks text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare q hub_documents; v_state jsonb; v_remarks text := nullif(btrim(coalesce(p_remarks, '')), '');
begin
  perform business_setup_require('setup.services.manage');
  select * into q from hub_documents where id = p_quote and doc_type = 'quote' and department = 'Business Setup' for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  v_state := business_setup_handover_read(p_quote);
  if v_state ->> 'state' in ('With Accounts', 'Closed') then raise exception 'This quote is already %', lower(v_state ->> 'state'); end if;
  if jsonb_array_length(v_state -> 'blockers') > 0 then
    raise exception 'This quote is not completed: %', (select string_agg(b, ', ') from jsonb_array_elements_text(v_state -> 'blockers') b);
  end if;
  insert into business_setup_handovers (quote_id, status, sent_at, sent_by, remarks) values (p_quote, 'With Accounts', now(), auth.uid(), v_remarks)
  on conflict (quote_id) do update set status = 'With Accounts', sent_at = now(), sent_by = auth.uid(), reviewed_at = null, reviewed_by = null, remarks = v_remarks;
  update business_setup_services set locked = true where quote_id = p_quote;
  insert into business_setup_accounts_reviews (quote_id, action, remarks) values (p_quote, 'Sent', v_remarks);
  perform business_setup_audit('business_setup_handovers', p_quote::text, 'send_to_accounts', null, jsonb_build_object('client_id', q.client_id, 'number', q.document_number));
end $$;
-- business_setup_form_list(text) goes back to 009's (016 added case_id to each row).
create or replace function public.business_setup_form_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'client_id', f.client_id, 'legal_name', m.legal_name, 'status', f.status, 'submitted_at', f.submitted_at,
             'taken_by', case when f.taken_by is not null then business_setup_person_name(f.taken_by) end, 'return_note', f.return_note,
             'missing', to_jsonb(business_setup_form_missing_items(f.id, true))) order by f.submitted_at nulls last, f.created_at), '[]'::jsonb)
    from business_setup_onboarding_forms f join client_master m on m.client_id = f.client_id
   where p_status is null or f.status = p_status);
end $$;
create or replace function public.business_setup_start_gate(p_quote uuid, p_reason text) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_quote is null or coalesce((select total_amount from hub_documents where id = p_quote), 0) <= 0 or business_setup_net_paid(p_quote) > 0 then
    return false;
  end if;
  if not business_setup_can('setup.services.override') then raise exception 'A payment is needed before this service can start'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for starting without a payment'; end if;
  return true;
end $$;

-- ── 018_portal.sql ───────────────────────────────────────────────────
-- The portal view goes back to 010's (no signed-copy fields) and the client upload function goes.
drop function if exists public.business_setup_portal_signed_add(uuid, uuid, text);
drop function if exists public.business_setup_portal_login_name(text);
\ir ../migrations/010_portal.sql

-- ── 015_documentation.sql ────────────────────────────────────────────
-- Invoices recorded by hand (Task 9): their functions and trigger go, and the invoice rows keep their other columns (case_id and created_by are dropped,
-- so a hand-recorded invoice stays in the client's portal list but no longer belongs to a case). The client list goes back to 008's, without kyc_missing.
drop policy if exists business_setup_invoice_upload on storage.objects;
drop function if exists public.business_setup_invoice_upload_ok(text, text);
drop trigger if exists business_setup_case_invoice on public.business_setup_invoices;
drop function if exists public.business_setup_invoice_sync_trg();
drop function if exists public.business_setup_invoice_record(jsonb);
drop function if exists public.business_setup_invoice_publish(jsonb);
drop index if exists public.business_setup_invoices_quote_number_uq;
drop function if exists public.business_setup_case_invoice_override(uuid, text);
drop index if exists public.business_setup_invoices_case_idx;
alter table public.business_setup_invoices drop column if exists case_id cascade;
alter table public.business_setup_invoices drop column if exists created_by;
create or replace function public.business_setup_client_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (
    with ids as (
      select client_id from business_setup_kyc_profiles
      union select client_id from business_setup_services
      union select client_id from hub_documents where department = 'Business Setup' and doc_type = 'quote' and client_id is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'client_id', m.client_id, 'legal_name', m.legal_name, 'client_status', k.client_status, 'kyc_state', k.kyc_state,
             'active_services', (select count(*) from business_setup_services s where s.client_id = m.client_id and s.status not in ('Completed', 'Cancelled') and not s.historical),
             'balance', (select coalesce(sum(q.total_amount - business_setup_net_paid(q.id)), 0) from hub_documents q
                          where q.client_id = m.client_id and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status = 'accepted'),
             'missing_contact', client_master_plain(m.data ->> 'General Email') is null or client_master_plain(m.data ->> 'General Phone') is null)
             order by m.legal_name), '[]'::jsonb)
      from ids join client_master m on m.client_id = ids.client_id
      left join business_setup_kyc_profiles k on k.client_id = m.client_id);
end $$;
-- hub_document_create goes back to 014's, and fee_item_save to 005's, by running those files again. Quotes keep their rows: the
-- vat_rate and scope stored on their lines stay in the JSON, where nothing reads them, and a quote issued with line VAT keeps its amounts.
-- The three company items go unless a service uses them (then they stay, at 0), and every other empty amount becomes 0.
-- 006 (quote_reject), 011 (child lock, Accounts queue) and 014 (link client, accept, case_lost, create) come back in that order.
\ir ../migrations/002_client_master_access.sql
\ir ../migrations/006_quotes_tracker.sql
\ir ../migrations/011_accounts_handover.sql
\ir ../migrations/014_leads_ownership.sql
\ir ../migrations/005_kyc_fees.sql
-- Signed copies, payment by case and the letter gate (Task 8): payment_add and payment_reverse go back to 007's by running it again
-- (014 above already restored quote_accept, case_lost and hub_document_create; case_docs goes back with 013's file further down).
-- The signed copies table goes with its functions. Quotes accepted through it stay accepted, and payments keep their case_id until 013's section.
\ir ../migrations/007_payments.sql
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_net_paid(uuid);
drop function if exists public.business_setup_case_documents(uuid);
drop function if exists public.business_setup_case_locked(uuid);
drop function if exists public.business_setup_case_link_client_for_payment(uuid, text, boolean);
drop function if exists public.business_setup_case_link_client_body(uuid, text, boolean);
drop function if exists public.business_setup_quote_accept_body(uuid, boolean);
drop table if exists public.business_setup_signed_quotes;
delete from public.business_setup_fee_items f where f.grp = 'Company' and f.name in ('Company registration', 'Company renewal', 'Visa') and f.default_amount is null
   and not exists (select 1 from public.business_setup_services s where s.fee_item_id = f.id);
update public.business_setup_fee_items set default_amount = 0 where default_amount is null;
alter table public.business_setup_fee_items alter column default_amount set not null;
alter table public.business_setup_fee_items drop column if exists vat_rate;

-- ── 021_visa_registration.sql ────────────────────────────────────────
drop function if exists public.business_setup_visa_sheet_apply(jsonb);

-- ── 020_client_main_fields.sql ───────────────────────────────────────
drop function if exists public.business_setup_client_main_save(text, jsonb);
drop function if exists public.business_setup_client_main_fields();

-- ── 014_leads_ownership.sql ──────────────────────────────────────────
drop policy if exists business_setup_staff_upload on storage.objects;
drop function if exists public.business_setup_staff_upload_ok(text, text);
-- Linking a quote to a client, as Business Setup Base 006 defines it (014 also fills the case).
create or replace function public.business_setup_quote_link(p_id uuid, p_client text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be linked to a client'; end if;
  if not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
  if q.client_id is not null and q.client_id <> p_client then raise exception 'This quote is already linked to a different client'; end if;
  if q.client_id = p_client then return; end if;
  update hub_documents set client_id = p_client where id = q.id;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_link', null,
          jsonb_build_object('client_id', p_client, 'document_number', q.document_number));
end $$;
drop trigger if exists business_setup_case_service on public.business_setup_services;
drop function if exists public.business_setup_case_service_trg();
drop function if exists public.business_setup_case_new(jsonb);
drop function if exists public.business_setup_case_take(uuid);
drop function if exists public.business_setup_case_link_client(uuid, text, boolean);
drop function if exists public.business_setup_case_shared(uuid);
drop function if exists public.business_setup_case_lost(uuid, text);
drop function if exists public.business_setup_case_confirm(uuid);
drop function if exists public.business_setup_case_assign(uuid, uuid, text);
drop function if exists public.business_setup_case_list(text);
drop function if exists public.business_setup_reassign_request(uuid, uuid, text);
drop function if exists public.business_setup_reassign_respond(uuid, boolean, text);
drop function if exists public.business_setup_form_staff_save(uuid, jsonb);
drop function if exists public.business_setup_form_doc_add(uuid, text, text);
drop table if exists public.business_setup_reassign_requests;
-- Accepting a quote, as Business Setup Base 006 defines it (014 adds a one-accepted-quote-per-case check).
create or replace function public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  q hub_documents; v_root uuid; ln jsonb; kyc jsonb; v_today date := (now() at time zone 'Asia/Dubai')::date;
  v_name text; v_action text; v_renews uuid; v_fee uuid; v_svc uuid; n int := 0;
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be accepted'; end if;
  v_root := coalesce(q.root_quote_id, q.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into q from hub_documents where id = p_id for update;   -- read again: it may have changed while we waited
  if exists (select 1 from hub_documents where doc_type = 'quote' and status = 'accepted' and coalesce(root_quote_id, id) = v_root) then
    raise exception 'A quote in this revision chain is already accepted';
  end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be accepted (this one is %)', q.status; end if;
  if q.client_id is null then raise exception 'Link this quote to a client before accepting it'; end if;
  kyc := business_setup_kyc_status(q.client_id);
  -- KYC already done (validated here, or marked Done in the old records) is not asked for again.
  if (kyc ->> 'percent')::int < 100 and not exists (select 1 from business_setup_kyc_profiles where client_id = q.client_id and kyc_state = 'Done') then
    raise exception 'The client KYC is incomplete: missing %', (select string_agg(m, ', ') from jsonb_array_elements_text(kyc -> 'missing') m);
  end if;
  if q.valid_until is not null and q.valid_until < v_today and not coalesce(p_allow_expired, false) then
    raise exception 'This quote expired on %: confirm to accept it anyway', to_char(q.valid_until, 'DD Mon YYYY');
  end if;

  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(),
         status_reason = case when q.valid_until is not null and q.valid_until < v_today then 'Accepted after expiry' else null end
   where id = q.id;

  for ln in select value from jsonb_array_elements(coalesce(q.lines, '[]'::jsonb)) loop
    v_name := coalesce(nullif(btrim(coalesce(ln ->> 'service_name', '')), ''), nullif(btrim(coalesce(ln ->> 'description', '')), ''));
    if v_name is null then raise exception 'Every quote line needs a service name'; end if;
    v_action := coalesce(nullif(btrim(coalesce(ln ->> 'action', '')), ''), 'New');
    if v_action not in ('New','Renewal','Rectification','Cancellation') then raise exception 'Unknown action % on a quote line', v_action; end if;
    v_renews := nullif(ln ->> 'renews_service_id', '')::uuid;
    if v_renews is not null and not exists (select 1 from business_setup_services where id = v_renews and client_id = q.client_id) then
      raise exception 'A renewal must link to an earlier service of the same client';
    end if;
    v_fee := nullif(ln ->> 'fee_item_id', '')::uuid;
    insert into business_setup_services (client_id, quote_id, fee_item_id, name, action, amount, renews_service_id)
    values (q.client_id, q.id, v_fee, v_name, v_action, nullif(ln ->> 'amount', '')::numeric, v_renews)
    returning id into v_svc;
    insert into business_setup_service_history (service_id, from_status, to_status, note)
    values (v_svc, null, 'Not started', 'Created from quote ' || q.document_number);
    n := n + 1;
  end loop;

  perform business_setup_audit('hub_documents', q.id::text, 'quote_accept', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'services_created', n,
                             'after_expiry', q.valid_until is not null and q.valid_until < v_today));
  return jsonb_build_object('quote_id', q.id, 'status', 'accepted', 'services_created', n);
end $$;
-- Payments stop following their quote's case, and net paid goes back to a sum by quote (Business Setup Base 006).
drop trigger if exists business_setup_payment_case_fill on public.business_setup_payments;
drop function if exists public.business_setup_payment_case_fill();
create or replace function public.business_setup_net_paid(p_quote uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) from business_setup_payments where quote_id = p_quote
$$;
-- The dashboard, as Business Setup Base 008 defines it (009 and 011 only replace its helpers, which 014 leaves alone).
create or replace function public.business_setup_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_exp jsonb;
begin
  perform business_setup_require('setup.access');
  v_exp := business_setup_expiries();
  return jsonb_build_object(
    'forms_waiting', business_setup_dash_forms(),
    'open_quotes', (select count(*) from hub_documents where department = 'Business Setup' and doc_type = 'quote' and status = 'issued'),
    'accepted_without_letter', (select count(*) from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')),
    'outstanding', (select coalesce(sum(greatest(q.total_amount - business_setup_net_paid(q.id), 0)), 0) from hub_documents q
                     where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'),
    'active_services', (select count(*) from business_setup_services where status not in ('Completed', 'Cancelled') and not historical),
    'expiries', jsonb_build_object('upcoming', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Upcoming'),
                                   'past', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Past date'))
  ) || business_setup_dash_handover();
end $$;
-- hub_document_create, as 013 defines it. The 013 section below then puts back the version before 013.
\ir ../migrations/013_cases.sql

-- ── 013_cases.sql ────────────────────────────────────────────────────
drop trigger if exists business_setup_case_form on public.business_setup_onboarding_forms;
drop trigger if exists business_setup_case_doc_ins on public.hub_documents;
drop trigger if exists business_setup_case_doc_status on public.hub_documents;
drop trigger if exists business_setup_case_payment on public.business_setup_payments;

-- Payments go back to fully append-only.
drop trigger if exists business_setup_payments_immutable on public.business_setup_payments;
create trigger business_setup_payments_immutable before update or delete on public.business_setup_payments
  for each row execute function public.business_setup_append_only();

drop function if exists public.business_setup_case_form_trg();
drop function if exists public.business_setup_case_sync_trg();
drop function if exists public.business_setup_payment_guard();
drop function if exists public.business_setup_case_sync(uuid);
drop function if exists public.business_setup_case_docs(uuid);
drop function if exists public.business_setup_case_set_stage(uuid, text, text);

alter table public.hub_documents drop column if exists case_id cascade;
alter table public.business_setup_payments drop column if exists case_id cascade;
alter table public.business_setup_onboarding_forms drop column if exists case_id cascade;
drop table if exists public.business_setup_cases cascade;
drop sequence if exists public.business_setup_case_seq;

delete from public.business_setup_role_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');
delete from public.business_setup_user_permissions where permission in ('setup.leads.manage', 'setup.cases.approve');

-- The permission list, as Business Setup Base 001 defines it.
create or replace function public.business_setup_permissions() returns text[]
language sql immutable set search_path = public, pg_temp as $$
  select array[
    'setup.access', 'setup.kyc.manage', 'setup.kyc.sensitive', 'setup.quotes.manage',
    'setup.payments.manage', 'setup.payments.override', 'setup.services.manage', 'setup.services.override',
    'setup.fees.manage', 'setup.portal.manage', 'setup.import.manage', 'setup.audit.view', 'setup.settings.manage',
    'kyc.view', 'kyc.manage']
$$;
-- hub_document_create, as Business Setup Base 004 defines it (no later file replaces it before 013).
\ir ../migrations/004_hub_extension.sql

commit;
