-- ROLLBACK of Business Setup Base migration 022 (service checklists). Then revert the site and redeploy the earlier client-portal function if it changed.
--
-- WARNING: this DELETES every service's checklist items and their sign-offs, and the lists. History rows stay. The 45 fee items stay, marked inactive, because quotes may name them.

begin;

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

commit;
