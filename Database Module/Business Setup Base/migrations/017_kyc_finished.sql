-- =====================================================================
-- Business Setup Base - a finished KYC   017
-- =====================================================================
-- Found in the Phase A browser walk. The Clients list and the workspace call a KYC finished when it is marked Done or nothing is missing, but
-- 016's Fields item and the portal's Accept asked for Done alone. Done is set only by validating a client form, and a lead entered by hand has no form,
-- so that lead could never reach Pipeline. Both now use business_setup_kyc_finished.
-- Run after 016 and before 018. Re-runnable. It redefines functions from 016: run this file again whenever 016 is re-run.
-- Undo with rollback/015_018_rollback.sql or rollback/013_019_rollback.sql, which drop the two new functions and put 016's work back.
-- =====================================================================

-- The items business_setup_kyc_status names (005), for internal callers. It has no rights check because a client accepting from the portal has no staff user.
create or replace function public.business_setup_kyc_missing(p_client text) returns text[]
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  m client_master; k business_setup_kyc_profiles;
  existing boolean; miss text[] := '{}'; total int := 7; partner_ok boolean;
begin
  select * into m from client_master where client_id = p_client;
  if m.client_id is null then return array['client']; end if;
  select * into k from business_setup_kyc_profiles where client_id = p_client;
  existing := k.company_status = 'Existing';

  if client_master_plain(m.data ->> 'Client Legal Name') is null and client_master_plain(m.legal_name) is null then miss := array_append(miss, 'client name'::text); end if;
  if client_master_plain(split_part(coalesce(m.data ->> 'Primary Contact', ''), ';', 1)) is null then miss := array_append(miss, 'contact person'::text); end if;
  if client_master_plain(m.data ->> 'General Email') is null then miss := array_append(miss, 'email'::text); end if;
  if client_master_plain(m.data ->> 'General Phone') is null then miss := array_append(miss, 'phone'::text); end if;
  if nullif(btrim(coalesce(k.business_activity, '')), '') is null then miss := array_append(miss, 'business activity'::text); end if;
  if k.company_status is null then miss := array_append(miss, 'company status'::text); end if;
  select exists (select 1 from business_setup_kyc_partners
                  where kyc_id = k.id and deleted_at is null
                    and nullif(btrim(full_name), '') is not null and nullif(btrim(coalesce(nationality, '')), '') is not null) into partner_ok;
  if not coalesce(partner_ok, false) then miss := array_append(miss, 'partner'::text); end if;

  if existing then
    total := total + 3;
    if coalesce(nullif(btrim(coalesce(k.licence_number, '')), ''), client_master_plain(m.data ->> 'Trade License Number')) is null then miss := array_append(miss, 'licence number'::text); end if;
    if k.licence_expiry is null then miss := array_append(miss, 'licence expiry'::text); end if;
    if coalesce(nullif(btrim(coalesce(k.details ->> 'issuing_authority', '')), ''), client_master_plain(m.data ->> 'License Issuing Authority')) is null then miss := array_append(miss, 'issuing authority'::text); end if;
  end if;
  return miss;
end $$;
revoke all on function public.business_setup_kyc_missing(text) from public, anon, authenticated;

create or replace function public.business_setup_kyc_finished(p_client text) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p_client is not null and (
    exists (select 1 from business_setup_kyc_profiles where client_id = p_client and kyc_state = 'Done')
    or cardinality(business_setup_kyc_missing(p_client)) = 0), false)
$$;
revoke all on function public.business_setup_kyc_finished(text) from public, anon, authenticated;

create or replace function public.business_setup_case_docs(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; v_form text; v_form_id uuid; v_fields boolean; v_documents boolean; v_letter boolean; v_total numeric;
begin
  select * into c from business_setup_cases where id = p_case;
  select id, status into v_form_id, v_form from business_setup_onboarding_forms where case_id = p_case order by created_at desc limit 1;
  v_fields := case when v_form is not null then v_form = 'Validated'
                   else coalesce(c.client_id is not null and business_setup_kyc_finished(c.client_id), false) end;
  v_documents := case when v_form_id is not null
                      then not exists (select 1 from client_portal_documents d where d.form_id = v_form_id and d.upload_complete and d.doc_type <> 'Payment proof' and d.status <> 'validated')
                           and (v_fields or exists (select 1 from client_portal_documents d where d.form_id = v_form_id and d.upload_complete and d.doc_type <> 'Payment proof'))
                      else v_fields end;
  -- A letter the client rejected, or that a new one replaced, is not the letter.
  v_letter := exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id where l.case_id = p_case and l.doc_type = 'letter' and l.status not in ('rejected', 'superseded') and lq.status = 'accepted');
  select total_amount into v_total from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')
   order by (status = 'accepted') desc, created_at desc limit 1;
  return jsonb_build_object(
    'fields', v_fields,
    'documents', v_documents,
    'quote', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status not in ('superseded', 'rejected')),
    'login', c.client_id is not null and exists (select 1 from client_portal_accounts a where a.id = business_setup_portal_account(c.client_id) and a.status = 'active'),
    'quote_accepted', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted'),
    'letter', v_letter,
    'letter_accepted', exists (select 1 from hub_documents l join hub_documents lq on lq.id = l.parent_id join business_setup_acceptances a on a.document_id = l.id
                                where l.case_id = p_case and l.doc_type = 'letter' and l.status not in ('rejected', 'superseded') and lq.status = 'accepted' and a.kind = 'Letter' and a.decision = 'Accepted'),
    -- Only an invoice on the live quote (issued or accepted, not replaced or rejected) meets the item, so a revision needs its own invoice or a new waiver.
    'invoice', coalesce(c.invoice_override_reason is not null, false) or exists (select 1 from business_setup_invoices i
                 where i.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote' and status in ('issued', 'accepted'))),
    'balance', coalesce(v_total, 0) - business_setup_case_net_paid(p_case));
end $$;

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

-- A KYC can finish through any field of its profile, not only kyc_state.
drop trigger if exists business_setup_case_kyc on public.business_setup_kyc_profiles;
create trigger business_setup_case_kyc after insert or update on public.business_setup_kyc_profiles
  for each row execute function public.business_setup_case_client_trg();
