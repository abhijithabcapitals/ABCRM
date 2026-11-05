-- Undoes phase 2 only: 018, then 015. Puts the database back to what 014 left. Migrations 001 to 014 stay, and so do business_setup_cases and all phase 1 data.
-- Plain SQL in one transaction, with no \ir, so it can be pasted into any SQL client. It does not re-run older migrations, because that would re-run 013's backfill
-- and 005's seed against live rows. The functions below are exact copies of their 014 state, generated with pg_get_functiondef from a database at 014;
-- 001 to 014 are live and never edited, so the copies cannot go stale. ROLLBACK_TEST=1 in tests/run-local.sh compares every function, grant, column, trigger,
-- policy and index with a snapshot taken at 014, then applies 015 and 018 again.
-- To undo the case restructure too, run rollback/013_019_rollback.sql instead (or after this file).
--
-- WARNING (signed copies): every row of business_setup_signed_quotes is lost, including real client and staff uploads and their review notes. The files stay in
-- storage but nothing points at them. Applying 015 again turns every already accepted quote into a Legacy row with no file, so a real signed copy is no longer linked.
-- Quotes accepted through a signed copy stay accepted.
-- WARNING (advances): a payment recorded on a case before any quote has no quote_id. In this rollback it keeps its case_id (the column is 013's) and 014's
-- business_setup_net_paid still counts it for the case's quotes, but the case-level screens and 015's reversal and refund by case go, and 007's reversal writes no case_id,
-- so reversing an advance after this rollback does not reduce net paid: correct such a case by hand. rollback/013_019_rollback.sql then drops case_id, and advances
-- lose their case and fall out of net_paid altogether.
-- WARNING (invoices): case_id and created_by go from business_setup_invoices. A hand-recorded invoice stays in the client's portal list but no longer belongs to a case,
-- and the Paid and Invoice items of 014's checklist go back to how 013 defined them. Override reasons stay on the case rows (the columns are 013's) and are read by nothing.
-- WARNING (fee items): every empty amount becomes 0, and each item's VAT rate and its is_service flag are lost (a cost-only item then creates a service again when a quote is accepted).
-- Quotes keep their rows: the vat_rate and scope on their lines stay in the JSON, where nothing reads them, and a quote issued with line VAT keeps its amounts.
-- Quotes that a Lost case rejected stay rejected.
-- 016 (client flow stages) goes too: the stage check returns to 013's list and each case is mapped back to its nearest old stage. Onboarding becomes Documentation when
-- the case has a quote that was not replaced, else Services. Pipeline becomes In service when the case has an owner, else Assignment (an Assignment case that already had an
-- owner comes back as In service). Completion and With Accounts become Completed. Lead and Review stay. Stage history in the audit log is kept.
begin;

-- ── 018_portal.sql ───────────────────────────────────────────────────
-- Acceptance records (016) and the client login and decision functions (018): the triggers, the append-only table (before business_setup_signed_quotes, which it
-- points at) and the functions go. WARNING: every acceptance row is lost. A quote accepted from the portal stays accepted, with no signed copy behind it; an
-- accepted quote needs none at 014. The accept logic returns to 014's below (business_setup_quote_accept_body goes with it).
-- Payment claims (016, 018): the table with its trigger, and the functions. WARNING: every claim row is lost, with its status and refusal note. A confirmed claim's
-- payment and receipt stay (payments are append-only); payment_add returns to 014's below and no longer takes claim_id.
drop table if exists public.business_setup_payment_claims;
drop function if exists public.business_setup_payment_claims_guard();
drop function if exists public.business_setup_claim_refuse(uuid, text);
-- Client Onboarding screen (client flow Task 7): the claim list and the claim-proof right go, client_inputs_file returns to 009's text, and the trigger that
-- re-checks a case when one of its form documents changes goes (the Documents item of case_docs returns to 014's below).
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
drop function if exists public.business_setup_portal_signed_add(uuid, uuid, text);
drop function if exists public.business_setup_portal_login_name(text);

-- ── 016_client_flow.sql ──────────────────────────────────────────────
-- Zoho publish (client flow Task 5): the unique invoice number per quote goes (015's record function holds the same rule again), and so does the publish function.
-- WARNING: an invoice already published keeps its row and its stored file; only the function that made it goes.
drop function if exists public.business_setup_invoice_publish(jsonb);
drop index if exists public.business_setup_invoices_quote_number_uq;
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
alter table public.business_setup_cases drop constraint if exists business_setup_cases_stage_check;
alter table public.business_setup_cases disable trigger business_setup_cases_touch;
update public.business_setup_cases c set stage = case c.stage
  when 'Onboarding' then case when exists (select 1 from public.hub_documents q where q.case_id = c.id and q.doc_type = 'quote' and q.status <> 'superseded') then 'Documentation' else 'Services' end
  when 'Pipeline' then case when c.owner_id is null then 'Assignment' else 'In service' end
  else 'Completed' end
 where c.stage in ('Onboarding', 'Pipeline', 'Completion', 'With Accounts');
alter table public.business_setup_cases enable trigger business_setup_cases_touch;
alter table public.business_setup_cases add constraint business_setup_cases_stage_check
  check (stage in ('Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service', 'Completed', 'Cancelled', 'Lost'));

-- ── 015_documentation.sql ────────────────────────────────────────────
drop policy if exists business_setup_invoice_upload on storage.objects;
drop function if exists public.business_setup_invoice_upload_ok(text, text);
drop trigger if exists business_setup_case_invoice on public.business_setup_invoices;
drop function if exists public.business_setup_invoice_sync_trg();
drop function if exists public.business_setup_invoice_record(jsonb);
drop function if exists public.business_setup_case_invoice_override(uuid, text);
drop function if exists public.business_setup_case_paid_override(uuid, text);
drop function if exists public.business_setup_case_documents(uuid);
drop function if exists public.business_setup_case_link_client_for_payment(uuid, text, boolean);
drop function if exists public.business_setup_case_link_client_body(uuid, text, boolean);
drop function if exists public.business_setup_signed_add(uuid, text);
drop function if exists public.business_setup_signed_file(uuid);
drop function if exists public.business_setup_signed_decide(uuid, boolean, text, boolean);

-- ── Functions as 014 left them (each replaces 015's or 018's version; grants on a replaced function are kept) ──
-- business_setup_accounts_queue()
CREATE OR REPLACE FUNCTION public.business_setup_accounts_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform banking_require('accounts.review');
  return (select coalesce(jsonb_agg(jsonb_build_object('quote_id', q.id, 'number', q.document_number, 'client_id', q.client_id, 'client_name', m.legal_name,
             'status', h.status, 'sent_at', h.sent_at, 'reviewed_at', h.reviewed_at, 'remarks', h.remarks, 'total', q.total_amount, 'net_paid', business_setup_net_paid(q.id),
             'outstanding', q.total_amount - business_setup_net_paid(q.id),
             'services', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'action', s.action, 'status', s.status, 'completed_at', s.completed_at) order by s.name), '[]'::jsonb) from business_setup_services s where s.quote_id = q.id),
             'payments', (select coalesce(jsonb_agg(jsonb_build_object('date', y.paid_on, 'amount', y.amount, 'type', y.type, 'method', y.method, 'reference', y.reference, 'receipt_number', r.receipt_number, 'receipt_path', r.storage_path) order by y.paid_on), '[]'::jsonb)
                            from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.quote_id = q.id),
             'outputs', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'file_name', d.file_name, 'storage_path', d.storage_path) order by d.created_at), '[]'::jsonb)
                           from business_setup_documents d join business_setup_services s on s.id = d.service_id where s.quote_id = q.id and d.is_output))
             order by (h.status = 'With Accounts') desc, coalesce(h.reviewed_at, h.sent_at) desc), '[]'::jsonb)
    from business_setup_handovers h join hub_documents q on q.id = h.quote_id left join client_master m on m.client_id = q.client_id
   where h.status in ('With Accounts', 'Closed'));
end $function$
;

-- business_setup_case_docs(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_case_docs(p_case uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_quote_total numeric; v_net numeric;
begin
  -- The accepted quote if there is one, else the newest quote that was not replaced.
  select total_amount into v_quote_total from hub_documents
   where case_id = p_case and doc_type = 'quote' and status <> 'superseded'
   order by (status = 'accepted') desc, created_at desc limit 1;
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) into v_net from business_setup_payments where case_id = p_case;
  return jsonb_build_object(
    'quote', v_quote_total is not null,
    'signed', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted'),
    'paid', coalesce(v_net > 0 or v_quote_total = 0, false),
    'letter', exists (select 1 from hub_documents where case_id = p_case and doc_type = 'letter'),
    'invoice', true);
end $function$
;

-- business_setup_case_link_client(uuid,text,boolean)
CREATE OR REPLACE FUNCTION public.business_setup_case_link_client(p_case uuid, p_client text DEFAULT NULL::text, p_allow_duplicate boolean DEFAULT false)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c business_setup_cases; v_client text := nullif(btrim(coalesce(p_client, '')), ''); r jsonb; v_data jsonb; v_dups text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.client_id is not null then
    if v_client is not null and v_client <> c.client_id then raise exception 'This case is already linked to client %', c.client_id; end if;
    return c.client_id;
  end if;
  if v_client is not null then
    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  else
    v_data := jsonb_strip_nulls(jsonb_build_object('Client Legal Name', c.lead_name, 'Primary Contact', c.contact_person, 'General Email', c.email, 'General Phone', c.phone));
    r := client_master_save(null, v_data, null, p_allow_duplicate);
    if not coalesce((r ->> 'ok')::boolean, false) then
      select string_agg((d ->> 'id') || ' ' || coalesce(d ->> 'name', '') || ' (same ' || (select string_agg(m, ', ') from jsonb_array_elements_text(d -> 'matches') m) || ')', '; ')
        into v_dups from jsonb_array_elements(r -> 'duplicates') d;
      raise exception 'A client like this already exists: %. Link that client, or confirm this is a new one.', coalesce(v_dups, 'see Client Master');
    end if;
    v_client := r ->> 'id';
  end if;
  update business_setup_cases set client_id = v_client where id = p_case;
  -- The case's quotes and letters that have no client follow it, so the quote can then be accepted.
  update hub_documents set client_id = v_client where case_id = p_case and client_id is null;
  perform business_setup_audit('business_setup_cases', p_case::text, 'case_link_client', null, jsonb_build_object('client_id', v_client));
  return v_client;
end $function$
;

-- business_setup_case_lost(uuid,text)
CREATE OR REPLACE FUNCTION public.business_setup_case_lost(p_case uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c business_setup_cases; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_net numeric; v_acct uuid;
begin
  perform business_setup_require('setup.leads.manage');
  if v_reason is null then raise exception 'Enter the reason this case is lost'; end if;
  select * into c from business_setup_cases where id = p_case for update;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  if c.stage = 'In service' then raise exception 'A case in service cannot be marked lost'; end if;
  if exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status = 'accepted') then
    raise exception 'This case has an accepted quote and cannot be marked lost: cancel its services instead';
  end if;
  select coalesce(sum(case when type = 'Payment' then amount else -amount end), 0) into v_net from business_setup_payments where case_id = p_case;
  if v_net > 0 then raise exception 'This case has a net payment of %: refund it before marking the case lost', v_net; end if;
  update business_setup_cases set lost_reason = v_reason where id = p_case;
  perform business_setup_case_set_stage(p_case, 'Lost', v_reason);
  if c.client_id is not null
     and not exists (select 1 from business_setup_cases where client_id = c.client_id and id <> p_case and stage not in ('Completed', 'Cancelled', 'Lost'))
     and not exists (select 1 from business_setup_services where client_id = c.client_id)
     and not exists (select 1 from banking_cases bc join banking_clients bk on bk.id = bc.client_id where bk.client_master_id = c.client_id) then
    v_acct := business_setup_portal_account(c.client_id);
    update client_portal_accounts set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), failed_attempts = 0, locked_until = null where id = v_acct and status = 'active';
    if found then
      delete from client_portal_sessions where account_id = v_acct;
      perform business_setup_audit('client_portal_accounts', v_acct::text, 'login_revoke', null, jsonb_build_object('client_id', c.client_id, 'case_id', p_case));
    end if;
  end if;
end $function$
;

-- business_setup_child_lock()
CREATE OR REPLACE FUNCTION public.business_setup_child_lock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_locked boolean := false;
begin
  if tg_table_name = 'business_setup_payments' then
    v_locked := new.quote_id is not null and business_setup_quote_locked(new.quote_id);
  elsif tg_table_name = 'business_setup_receipts' then
    v_locked := exists (select 1 from business_setup_payments y where y.id = new.payment_id and y.quote_id is not null and business_setup_quote_locked(y.quote_id));
  elsif tg_table_name = 'business_setup_documents' then
    v_locked := new.service_id is not null and exists (select 1 from business_setup_services s where s.id = new.service_id and s.locked);
  end if;
  if v_locked then raise exception 'This quote is with Accounts. It can be changed only if Accounts reverts it.'; end if;
  return new;
end $function$
;

-- business_setup_client_list()
CREATE OR REPLACE FUNCTION public.business_setup_client_list()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
end $function$
;

-- business_setup_fee_item_save(jsonb)
CREATE OR REPLACE FUNCTION public.business_setup_fee_item_save(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_id uuid; v_amount numeric;
begin
  perform business_setup_require('setup.fees.manage');
  p := coalesce(p, '{}'::jsonb);
  v_amount := coalesce(nullif(p ->> 'default_amount', '')::numeric, 0);
  if v_amount < 0 then raise exception 'The fee amount cannot be negative'; end if;
  if nullif(btrim(coalesce(p ->> 'grp', '')), '') is null then raise exception 'The fee group is required'; end if;
  if nullif(btrim(coalesce(p ->> 'name', '')), '') is null then raise exception 'The fee name is required'; end if;
  if nullif(p ->> 'id', '') is not null then
    v_id := (p ->> 'id')::uuid;
    update business_setup_fee_items set
        grp = btrim(p ->> 'grp'), name = btrim(p ->> 'name'),
        default_amount = case when p ? 'default_amount' then v_amount else default_amount end,
        service_item_id = case when p ? 'service_item_id' then nullif(p ->> 'service_item_id', '')::uuid else service_item_id end,
        active = case when p ? 'active' then coalesce((p ->> 'active')::boolean, active) else active end,
        sort_order = case when p ? 'sort_order' then coalesce((p ->> 'sort_order')::int, sort_order) else sort_order end
      where id = v_id;
    if not found then raise exception 'Fee item not found'; end if;
  else
    insert into business_setup_fee_items (grp, name, default_amount, service_item_id, active, sort_order)
    values (btrim(p ->> 'grp'), btrim(p ->> 'name'), v_amount, nullif(p ->> 'service_item_id', '')::uuid,
            coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort_order')::int, 0))
    on conflict (grp, name) do update set default_amount = case when p ? 'default_amount' then excluded.default_amount else business_setup_fee_items.default_amount end,
        service_item_id = coalesce(excluded.service_item_id, business_setup_fee_items.service_item_id),
        active = excluded.active, sort_order = excluded.sort_order
    returning id into v_id;
  end if;
  perform business_setup_audit('business_setup_fee_items', v_id::text, 'fee_item_save', null, jsonb_build_object('grp', p ->> 'grp', 'name', p ->> 'name'));
  return v_id;
end $function$
;

-- business_setup_payment_add(jsonb)
CREATE OR REPLACE FUNCTION public.business_setup_payment_add(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q hub_documents; v_today date := (now() at time zone 'Asia/Dubai')::date; v_amount numeric; v_on date;
  v_outstanding numeric; v_over boolean; v_reason text; v_note text; v_pay uuid; v_rec uuid; v_number text;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.status <> 'accepted' then
    raise exception 'A payment can be recorded only against an accepted Business Setup quote';
  end if;
  if q.client_id is null then raise exception 'Link this quote to a client before recording a payment'; end if;
  if business_setup_quote_locked(q.id) then
    raise exception 'This quote is locked because Accounts holds it: no payment can be recorded';
  end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount above zero with at most two decimals';
  end if;
  v_on := coalesce(nullif(p ->> 'paid_on', '')::date, v_today);
  if v_on > v_today then raise exception 'The payment date cannot be in the future'; end if;

  v_outstanding := coalesce(q.total_amount, 0) - business_setup_net_paid(q.id);
  v_over := v_amount > v_outstanding;
  v_reason := nullif(btrim(coalesce(p ->> 'override_reason', '')), '');
  if v_over then
    if not business_setup_can('setup.payments.override') then
      raise exception 'This payment is above the balance of %: ask someone who may accept an overpayment', to_char(v_outstanding, 'FM999,999,999,990.00');
    end if;
    if v_reason is null then raise exception 'Give a reason for accepting a payment above the balance'; end if;
  end if;
  v_note := nullif(btrim(coalesce(p ->> 'note', '')), '');
  if v_over then v_note := concat_ws(E'\n', v_note, 'Above the balance: ' || v_reason); end if;

  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, note)
  values (q.client_id, q.id, v_on, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Payment', v_note)
  returning id into v_pay;
  v_number := hub_next_number('Business Setup', 'receipt');
  insert into business_setup_receipts (payment_id, receipt_number) values (v_pay, v_number) returning id into v_rec;

  perform business_setup_audit('business_setup_payments', v_pay::text, 'payment_add', null,
          jsonb_build_object('client_id', q.client_id, 'quote_id', q.id, 'amount', v_amount, 'receipt_number', v_number,
                             'overpayment', v_over, 'reason', case when v_over then v_reason end));
  return jsonb_build_object('payment_id', v_pay, 'receipt_id', v_rec, 'receipt_number', v_number);
end $function$
;

-- business_setup_payment_reverse(uuid,text)
CREATE OR REPLACE FUNCTION public.business_setup_payment_reverse(p_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  o business_setup_payments; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_rev uuid;
begin
  perform business_setup_require('setup.payments.manage');
  select * into o from business_setup_payments where id = p_id;
  if o.id is null then raise exception 'Payment not found'; end if;
  if o.type <> 'Payment' then raise exception 'Only a payment can have a reversal: a refund or a reversal cannot be reversed'; end if;
  if v_reason is null then raise exception 'Give a reason for the reversal'; end if;
  if o.quote_id is not null then
    perform 1 from hub_documents where id = o.quote_id for update;   -- same lock as recording, so the balance cannot move underneath
    if business_setup_quote_locked(o.quote_id) then
      raise exception 'This quote is locked because Accounts holds it: no payment can be reversed';
    end if;
  end if;
  if exists (select 1 from business_setup_payments where reverses_id = o.id) then raise exception 'This payment already has a reversal'; end if;

  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, reverses_id, note)
  values (o.client_id, o.quote_id, (now() at time zone 'Asia/Dubai')::date, o.amount, o.method, o.reference, 'Reversal', o.id, v_reason)
  returning id into v_rev;
  perform business_setup_audit('business_setup_payments', v_rev::text, 'payment_reverse', null,
          jsonb_build_object('client_id', o.client_id, 'quote_id', o.quote_id, 'amount', o.amount, 'reverses_id', o.id, 'reason', v_reason));
  return jsonb_build_object('reversal_id', v_rev, 'payment_id', o.id);
end $function$
;

-- business_setup_portal_view(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_portal_view(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client and not s.historical),
    'quotes', (select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'number', q.document_number, 'date', q.created_at::date, 'status', q.status, 'total', q.total_amount,
                  'net_paid', business_setup_net_paid(q.id), 'outstanding', q.total_amount - business_setup_net_paid(q.id), 'has_file', q.storage_path is not null,
                  'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'date', l.created_at::date, 'signed_at', l.signed_at, 'has_file', l.storage_path is not null)
                               from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')) order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q
                where q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected')),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('id', y.id, 'date', y.paid_on, 'amount', y.amount, 'type', y.type, 'reference', y.reference,
                    'receipt_id', r.id, 'receipt_number', r.receipt_number, 'has_file', r.storage_path is not null) order by y.paid_on desc, y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = v_client),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'number', i.invoice_number, 'date', i.issued_on, 'amount', i.amount, 'has_file', i.file_path is not null) order by i.issued_on desc), '[]'::jsonb)
                   from business_setup_invoices i where i.client_id = v_client),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'kind', d.kind, 'file_name', d.file_name, 'date', d.created_at::date) order by d.created_at desc), '[]'::jsonb)
                    from business_setup_documents d where d.client_id = v_client and d.is_output and d.client_visible));
end $function$
;

-- business_setup_quote_accept(uuid,boolean)
CREATE OR REPLACE FUNCTION public.business_setup_quote_accept(p_id uuid, p_allow_expired boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if q.case_id is not null and (select stage from business_setup_cases where id = q.case_id) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and cannot take an accepted quote', lower((select stage from business_setup_cases where id = q.case_id));
  end if;
  if q.case_id is not null and exists (select 1 from hub_documents where case_id = q.case_id and doc_type = 'quote' and status = 'accepted' and id <> q.id) then
    raise exception 'Another quote of this case is already accepted: a case holds one quote and its revisions';
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
end $function$
;

-- business_setup_quote_reject(uuid,text)
CREATE OR REPLACE FUNCTION public.business_setup_quote_reject(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  q hub_documents; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform business_setup_require('setup.quotes.manage');
  select * into q from hub_documents where id = p_id for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.doc_type <> 'quote' or q.department <> 'Business Setup' then raise exception 'Only a Business Setup quote can be rejected'; end if;
  if v_reason is null then raise exception 'Give a reason for rejecting the quote'; end if;
  if q.status <> 'issued' then raise exception 'Only an issued quote can be rejected (this one is %)', q.status; end if;
  update hub_documents set status = 'rejected', status_at = now(), status_by = auth.uid(), status_reason = v_reason where id = q.id;
  perform business_setup_audit('hub_documents', q.id::text, 'quote_reject', null,
          jsonb_build_object('client_id', q.client_id, 'document_number', q.document_number, 'reason', v_reason));
end $function$
;

-- business_setup_refund_add(jsonb)
CREATE OR REPLACE FUNCTION public.business_setup_refund_add(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare q hub_documents; v_amount numeric; v_reason text; v_id uuid; v_net numeric;
begin
  perform business_setup_require('setup.payments.manage');
  p := coalesce(p, '{}'::jsonb);
  select * into q from hub_documents where id = nullif(p ->> 'quote_id', '')::uuid for update;
  if q.id is null or q.doc_type <> 'quote' or q.department <> 'Business Setup' or q.client_id is null then raise exception 'Quote not found'; end if;
  if business_setup_quote_locked(q.id) then raise exception 'This quote is locked because Accounts holds it: no refund can be recorded'; end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount <> round(v_amount, 2) then raise exception 'Enter an amount above zero with at most two decimals'; end if;
  v_reason := nullif(btrim(coalesce(p ->> 'reason', '')), '');
  if v_reason is null then raise exception 'Give a reason for the refund'; end if;
  v_net := business_setup_net_paid(q.id);
  if v_amount > v_net then raise exception 'This refund is above the % paid on the quote', to_char(v_net, 'FM999,999,999,990.00'); end if;
  insert into business_setup_payments (client_id, quote_id, paid_on, amount, method, reference, type, note)
  values (q.client_id, q.id, (now() at time zone 'Asia/Dubai')::date, v_amount, nullif(btrim(coalesce(p ->> 'method', '')), ''), nullif(btrim(coalesce(p ->> 'reference', '')), ''), 'Refund', v_reason)
  returning id into v_id;
  perform business_setup_audit('business_setup_payments', v_id::text, 'refund_add', null, jsonb_build_object('client_id', q.client_id, 'quote_id', q.id, 'amount', v_amount, 'reason', v_reason));
  return v_id;
end $function$
;

-- 016 also replaced these, as 006, 013 and 014 left them
-- business_setup_case_confirm(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_case_confirm(p_case uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare c business_setup_cases;

begin

  perform business_setup_require('setup.access');

  select * into c from business_setup_cases where id = p_case for update;

  if c.id is null then raise exception 'Case not found'; end if;

  if c.stage <> 'Assignment' then raise exception 'Only a case at Assignment can be confirmed'; end if;

  if c.owner_id is null then raise exception 'This case has no owner yet: ask a manager to assign one'; end if;

  if c.owner_id <> auth.uid() and not business_setup_can('setup.cases.approve') then

    raise exception 'Only the owner (%) or a manager can confirm this case', business_setup_person_name(c.owner_id);

  end if;

  perform business_setup_case_set_stage(p_case, 'In service', 'Confirmed by ' || business_setup_person_name(auth.uid()));

  perform business_setup_case_sync(p_case);

end $function$
;

-- business_setup_case_form_trg()
CREATE OR REPLACE FUNCTION public.business_setup_case_form_trg()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare v_to text := case new.status when 'Submitted' then 'Review' when 'In review' then 'Review' when 'Returned' then 'Contact' when 'Validated' then 'Services' end;

        v_stage text;

begin

  if v_to is null then return null; end if;

  select stage into v_stage from business_setup_cases where id = new.case_id for update;

  if v_stage in ('Lead', 'Contact', 'Review') and v_stage <> v_to then

    perform business_setup_case_set_stage(new.case_id, v_to, 'Form ' || lower(new.status));

  end if;

  perform business_setup_case_sync(new.case_id);

  return null;

end $function$
;

-- business_setup_case_list(text)
CREATE OR REPLACE FUNCTION public.business_setup_case_list(p_view text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare v_stages text[];

begin

  perform business_setup_require('setup.access');

  v_stages := case p_view

    when 'leads' then array['Lead', 'Contact', 'Review', 'Lost']

    when 'documentation' then array['Services', 'Documentation']

    when 'cases' then array['Assignment', 'In service', 'Completed', 'Cancelled']

    when 'all' then array['Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service', 'Completed', 'Cancelled', 'Lost'] end;

  if v_stages is null then raise exception 'Unknown view %: use leads, documentation, cases or all', p_view; end if;

  return (select coalesce(jsonb_agg(to_jsonb(c) || jsonb_build_object(

      'client_name', m.legal_name,

      'owner_name', case when c.owner_id is not null then business_setup_person_name(c.owner_id) end,

      'docs', business_setup_case_docs(c.id),

      'reassign', (select jsonb_build_object('id', r.id, 'to_user', r.to_user, 'to_name', business_setup_person_name(r.to_user), 'reason', r.reason, 'created_by', r.created_by, 'created_at', r.created_at)

                     from business_setup_reassign_requests r where r.case_id = c.id and r.status = 'Pending')

    ) order by c.created_at desc, c.id), '[]'::jsonb)

    from business_setup_cases c left join client_master m on m.client_id = c.client_id

   where c.stage = any (v_stages));

end $function$
;

-- business_setup_case_new(jsonb)
CREATE OR REPLACE FUNCTION public.business_setup_case_new(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare v_name text := nullif(btrim(coalesce(p ->> 'lead_name', '')), ''); v_client text := nullif(btrim(coalesce(p ->> 'client_id', '')), '');

        v_stage text := 'Lead'; v_id uuid;

begin

  perform business_setup_require('setup.leads.manage');

  if v_name is null then raise exception 'Enter the lead name'; end if;

  if v_client is not null then

    if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;

    if exists (select 1 from business_setup_kyc_profiles where client_id = v_client and kyc_state = 'Done') then v_stage := 'Services'; end if;

  end if;

  insert into business_setup_cases (client_id, stage, source, lead_name, contact_person, phone, email, notes)

  values (v_client, v_stage, nullif(btrim(coalesce(p ->> 'source', '')), ''), v_name, nullif(btrim(coalesce(p ->> 'contact_person', '')), ''),

          nullif(btrim(coalesce(p ->> 'phone', '')), ''), nullif(btrim(coalesce(p ->> 'email', '')), ''), nullif(btrim(coalesce(p ->> 'notes', '')), ''))

  returning id into v_id;

  perform business_setup_audit('business_setup_cases', v_id::text, 'case_new', null, jsonb_build_object('stage', v_stage, 'lead_name', v_name, 'client_id', v_client));

  return v_id;

end $function$
;

-- business_setup_case_shared(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_case_shared(p_case uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare c business_setup_cases; f business_setup_onboarding_forms; v_acct uuid; v_done boolean; v_to text;

begin

  perform business_setup_require('setup.leads.manage');

  select * into c from business_setup_cases where id = p_case for update;

  if c.id is null then raise exception 'Case not found'; end if;

  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;

  if c.client_id is null then raise exception 'Link or create the client first'; end if;

  v_acct := business_setup_portal_account(c.client_id);

  if not exists (select 1 from client_portal_accounts where id = v_acct and status = 'active') then raise exception 'Issue an active client login first'; end if;

  v_done := exists (select 1 from business_setup_kyc_profiles where client_id = c.client_id and kyc_state = 'Done');

  select * into f from business_setup_onboarding_forms where client_id = c.client_id and status <> 'Validated' order by created_at desc limit 1 for update;

  if f.id is null and not v_done then

    perform business_setup_form_create(c.client_id, v_acct);

    select * into f from business_setup_onboarding_forms where client_id = c.client_id and status <> 'Validated' order by created_at desc limit 1 for update;

    if f.id is null then raise exception 'This client has no form to send'; end if;

  end if;

  if f.id is not null then

    -- A form on a case that is Lost, Completed or Cancelled is free: it moves to this case.

    if f.case_id is not null and f.case_id <> p_case

       and (select stage from business_setup_cases where id = f.case_id) not in ('Completed', 'Cancelled', 'Lost') then

      raise exception 'This client already has an open form on case %', (select case_number from business_setup_cases where id = f.case_id);

    end if;

    update business_setup_onboarding_forms set case_id = p_case where id = f.id and case_id is distinct from p_case;

  end if;

  if c.stage = 'Lead' then

    v_to := case when v_done then 'Services' when f.status in ('Submitted', 'In review') then 'Review' else 'Contact' end;

    perform business_setup_case_set_stage(p_case, v_to, 'The client link was shared');

  end if;

  perform business_setup_audit('business_setup_cases', p_case::text, 'case_shared', null, jsonb_build_object('client_id', c.client_id, 'form_id', f.id));

  perform business_setup_case_sync(p_case);

end $function$
;

-- business_setup_case_sync(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_case_sync(p_case uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare v_stage text; v_open int; v_done int; v_total int;

begin

  select stage into v_stage from business_setup_cases where id = p_case for update;

  if not found then return; end if;

  if v_stage = 'Services' and exists (select 1 from hub_documents where case_id = p_case and doc_type = 'quote' and status <> 'superseded') then

    perform business_setup_case_set_stage(p_case, 'Documentation', 'A quote was issued');

    v_stage := 'Documentation';

  end if;

  if v_stage = 'Documentation' and not exists (select 1 from jsonb_each(business_setup_case_docs(p_case)) where value <> 'true'::jsonb) then

    perform business_setup_case_set_stage(p_case, 'Assignment', 'Quote, signature, payment, letter and invoice are in place');

    v_stage := 'Assignment';

  end if;

  if v_stage = 'In service' then

    select count(*), count(*) filter (where s.status not in ('Completed', 'Cancelled')), count(*) filter (where s.status = 'Completed') into v_total, v_open, v_done

      from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = p_case and doc_type = 'quote');

    if v_total > 0 and v_open = 0 then

      perform business_setup_case_set_stage(p_case, case when v_done > 0 then 'Completed' else 'Cancelled' end, 'Every service is closed');

    end if;

  end if;

end $function$
;

-- business_setup_case_take(uuid)
CREATE OR REPLACE FUNCTION public.business_setup_case_take(p_case uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare c business_setup_cases;

begin

  perform business_setup_require('setup.leads.manage');

  select * into c from business_setup_cases where id = p_case for update;

  if c.id is null then raise exception 'Case not found'; end if;

  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;

  if c.owner_id is not null then raise exception 'This case was already taken by %', business_setup_person_name(c.owner_id); end if;

  update business_setup_cases set owner_id = auth.uid() where id = p_case;

  perform business_setup_audit('business_setup_cases', p_case::text, 'case_take', null, jsonb_build_object('owner_id', auth.uid()));

  if c.stage = 'Assignment' then

    perform business_setup_case_set_stage(p_case, 'In service', 'The owner took the case');

    -- Every service may already be closed: the case then completes now instead of waiting for a service change that never comes.

    perform business_setup_case_sync(p_case);

  end if;

end $function$
;

-- business_setup_dashboard()
CREATE OR REPLACE FUNCTION public.business_setup_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

declare v_exp jsonb; v_month timestamptz := date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai';

        v_done_total int; v_done_month int; v_recv numeric;

begin

  perform business_setup_require('setup.access');

  v_exp := business_setup_expiries();

  -- One expression for both outstanding and receivables.

  select coalesce(sum(greatest(q.total_amount - business_setup_net_paid(q.id), 0)), 0) into v_recv from hub_documents q

   where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted';

  select count(*), count(*) filter (where t.at >= v_month) into v_done_total, v_done_month

    from (select coalesce(

                   (select max(a.occurred_at) from business_setup_audit_log a

                     where a.table_name = 'business_setup_cases' and a.row_id = c.id::text and a.action = 'case_stage' and a.new_data ->> 'stage' = 'Completed'),

                   (select max(s.completed_at) from business_setup_services s where s.quote_id in (select id from hub_documents where case_id = c.id and doc_type = 'quote')),

                   c.updated_at) as at

            from business_setup_cases c where c.stage = 'Completed') t;

  return jsonb_build_object(

    'forms_waiting', business_setup_dash_forms(),

    'open_quotes', (select count(*) from hub_documents where department = 'Business Setup' and doc_type = 'quote' and status = 'issued'),

    'accepted_without_letter', (select count(*) from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'

                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')),

    'outstanding', v_recv,

    'active_services', (select count(*) from business_setup_services where status not in ('Completed', 'Cancelled') and not historical),

    'expiries', jsonb_build_object('upcoming', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Upcoming'),

                                   'past', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Past date')),

    'processes_pending', (select count(*) from business_setup_services s

                           where s.status not in ('Completed', 'Cancelled') and not s.historical

                             and exists (select 1 from hub_documents q where q.id = s.quote_id and q.case_id is not null)),

    'receivables', v_recv,

    'advances', (select coalesce(sum(case when p.type = 'Payment' then p.amount else -p.amount end), 0) from business_setup_payments p

                  where p.case_id is not null

                    and not exists (select 1 from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'

                                       and (q.case_id = p.case_id or q.id = p.quote_id))),

    'cases_completed_month', v_done_month,

    'cases_completed_total', v_done_total,

    'pipeline', (select jsonb_object_agg(st, (select count(*) from business_setup_cases c where c.stage = st))

                   from unnest(array['Lead', 'Contact', 'Review', 'Services', 'Documentation', 'Assignment', 'In service']) st),

    'forms_to_review', business_setup_dash_forms(),

    'pending_after_kyc', (select count(*) from business_setup_cases where stage = 'Services')

  ) || business_setup_dash_handover();

end $function$
;

-- business_setup_start_gate(uuid,text)
CREATE OR REPLACE FUNCTION public.business_setup_start_gate(p_quote uuid, p_reason text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$

begin

  if p_quote is null or coalesce((select total_amount from hub_documents where id = p_quote), 0) <= 0 or business_setup_net_paid(p_quote) > 0 then

    return false;

  end if;

  if not business_setup_can('setup.services.override') then raise exception 'A payment is needed before this service can start'; end if;

  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason for starting without a payment'; end if;

  return true;

end $function$
;

-- client_master_can(text)
CREATE OR REPLACE FUNCTION public.client_master_can(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select banking_can(p_permission) or business_setup_can(p_permission)
$function$
;

-- hub_document_create(jsonb)
CREATE OR REPLACE FUNCTION public.hub_document_create(p jsonb)
 RETURNS hub_documents
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_type text := p ->> 'doc_type'; v_net numeric := 0; v_vat numeric := 0; v_total numeric; v_rate numeric := coalesce((p ->> 'vat_rate')::numeric, 5);
  v_mode text := coalesce(p ->> 'vat_mode', 'inclusive'); v_number text; r hub_documents; it jsonb; q hub_documents; o hub_documents; v_id uuid := gen_random_uuid(); v_root uuid;
  v_client text := nullif(trim(p ->> 'client_id'), ''); v_revises uuid := nullif(p ->> 'revises_id', '')::uuid; v_template text := nullif(trim(p ->> 'template_key'), '');
  v_case uuid := nullif(p ->> 'case_id', '')::uuid; v_case_client text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  -- An engagement letter exists only as the next step of a generated quote, and takes everything from it.
  if v_type = 'letter' then
    select * into q from hub_documents where id = (p ->> 'parent_id')::uuid and doc_type = 'quote' for update;
    if q.id is null then raise exception 'Generate the quote first: an engagement letter comes from a quote'; end if;
    if exists (select 1 from hub_documents where parent_id = q.id and doc_type = 'letter') then raise exception 'Quote % already has its engagement letter', q.document_number; end if;
    if q.department = 'Business Setup' and q.status <> 'accepted' then raise exception 'Mark the quote as accepted first'; end if;
    p := jsonb_build_object('doc_type', 'letter', 'parent_id', q.id, 'department', q.department, 'client_name', q.client_name, 'contact_name', q.contact_name, 'contact_email', q.contact_email, 'contact_phone', q.contact_phone, 'client_address', q.client_address, 'license_number', q.license_number, 'vat_trn', q.vat_trn, 'services', to_jsonb(q.services), 'lines', q.lines, 'vat_mode', q.vat_mode, 'vat_rate', q.vat_rate);
    v_mode := q.vat_mode; v_rate := q.vat_rate; v_client := q.client_id; v_revises := null; v_case := q.case_id;
  end if;
  -- Business Setup documents reach a client's login, so issuing one needs the department's right. A letter takes its department from its quote above.
  if p ->> 'department' = 'Business Setup' then perform business_setup_require('setup.quotes.manage'); end if;
  if v_type <> 'quote' then v_revises := null; v_template := null; end if;
  if v_template is not null and not exists (select 1 from business_setup_quote_templates where key = v_template and active) then raise exception 'Unknown quote template %', v_template; end if;
  if v_client is not null and not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client %', v_client; end if;
  if v_case is not null and not exists (select 1 from business_setup_cases where id = v_case) then raise exception 'Unknown case'; end if;
  if v_case is not null then
    if p ->> 'department' is distinct from 'Business Setup' then raise exception 'Only a Business Setup document can belong to a case'; end if;
    select client_id into v_case_client from business_setup_cases where id = v_case;
    if v_client is not null and v_case_client is not null and v_client <> v_case_client then raise exception 'This client does not match the client of the case'; end if;
    -- A case is one lead, one quote and its revisions. A new quote is allowed only when every earlier quote of the case was rejected
    -- or replaced by a revision (a replaced quote is not live: Q1 revised to Q2 and Q2 rejected leaves nothing live).
    if v_type = 'quote' and v_revises is null then
      perform 1 from business_setup_cases where id = v_case for update;
      if exists (select 1 from hub_documents where case_id = v_case and doc_type = 'quote' and status not in ('rejected', 'superseded')) then
        raise exception 'This case already has a quote: revise that quote, or open a new case';
      end if;
    end if;
  end if;
  if nullif(trim(p ->> 'client_name'), '') is null then raise exception 'Enter the client name'; end if;
  if v_type in ('quote','letter') then
    if nullif(trim(p ->> 'contact_name'), '') is null or nullif(trim(p ->> 'contact_email'), '') is null or nullif(trim(p ->> 'contact_phone'), '') is null or (nullif(trim(p ->> 'client_address'), '') is null and p ->> 'department' <> 'Business Setup') then
      raise exception 'Fill in the client details first';
    end if;
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one service'; end if;
  for it in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((it ->> 'amount')::numeric, -1) < 0 then raise exception 'Enter a fee for %', it ->> 'description'; end if;
    v_net := v_net + (it ->> 'amount')::numeric;
  end loop;
  if v_mode = 'exclusive' then v_vat := round(v_net * v_rate / 100, 2); v_total := v_net + v_vat;
  elsif v_mode = 'inclusive' then v_vat := round(v_net * v_rate / (100 + v_rate), 2); v_total := v_net;
  else v_total := v_net; end if;
  -- A revision replaces an issued quote of the same department; the chain root and the old quote stay locked until this transaction ends.
  if v_revises is not null then
    -- Lock order is root first, then the quote (same as business_setup_quote_accept), so a revise and an accept on a
    -- non-root member of one chain cannot deadlock. The root is found unlocked, then the quote is read again locked.
    select * into o from hub_documents where id = v_revises and doc_type = 'quote';
    if o.id is not null then perform 1 from hub_documents where id = coalesce(o.root_quote_id, o.id) for update; end if;
    select * into o from hub_documents where id = v_revises and doc_type = 'quote' for update;
    if o.id is null then raise exception 'The quote to revise was not found'; end if;
    if o.department is distinct from p ->> 'department' then raise exception 'A revision must be for the same department as the quote it replaces'; end if;
    if o.status <> 'issued' then raise exception 'Only an issued quote can be revised'; end if;
    -- The revision stays with the old quote's client; a different client is refused.
    if o.client_id is not null then
      if v_client is null then v_client := o.client_id;
      elsif v_client <> o.client_id then raise exception 'A revision must keep the client of the quote it replaces'; end if;
    end if;
    -- A quote outside every case cannot bring its revision into one: that would start a second chain in the case.
    if o.case_id is null and v_case is not null then raise exception 'This quote is not in a case, so its revision cannot be put in one'; end if;
    -- It also stays in the old quote's case.
    if o.case_id is not null then
      if v_case is null then v_case := o.case_id;
      elsif v_case <> o.case_id then raise exception 'A revision must keep the case of the quote it replaces'; end if;
    end if;
  end if;
  -- The case may have closed meanwhile, or the document inherits it from its quote or revision: no new document in a closed case.
  if v_case is not null and (select stage from business_setup_cases where id = v_case) in ('Lost', 'Completed', 'Cancelled') then
    raise exception 'This case is % and takes no new documents', lower((select stage from business_setup_cases where id = v_case));
  end if;
  if v_type = 'quote' then v_root := coalesce(o.root_quote_id, o.id, v_id); end if;
  if v_type in ('quote','letter') then v_number := hub_next_number(p ->> 'department', v_type);
  elsif (p ->> 'parent_id') is not null then select document_number into v_number from hub_documents where id = (p ->> 'parent_id')::uuid;
  end if;
  insert into hub_documents (id, root_quote_id, parent_id, doc_type, department, document_number, document_serial, client_name, contact_name, contact_email, contact_phone, client_address, license_number, vat_trn, services, lines, vat_mode, vat_rate, vat_amount, total_amount, valid_until, notes, mail_subject, mail_body, client_id, revises_id, template_key, case_id)
  values (v_id, v_root, (p ->> 'parent_id')::uuid, v_type, p ->> 'department', v_number, case when v_type in ('quote','letter') then hub_serial_of(p ->> 'department', v_type, v_number) end, trim(p ->> 'client_name'), p ->> 'contact_name', p ->> 'contact_email', p ->> 'contact_phone', p ->> 'client_address', p ->> 'license_number', p ->> 'vat_trn',
          array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb))), p -> 'lines', v_mode, v_rate, v_vat, v_total, (p ->> 'valid_until')::date, p ->> 'notes', p ->> 'mail_subject', p ->> 'mail_body', v_client, v_revises, v_template, v_case)
  returning * into r;
  if v_revises is not null then
    update hub_documents set status = 'superseded', status_at = now(), status_by = auth.uid(), status_reason = 'Revised by ' || r.document_number where id = v_revises;
  end if;
  return r;
end $function$
;

drop function if exists public.business_setup_quote_accept_body(uuid, boolean);
-- 016 redefined business_setup_portal_account (an active login first); 010's definition returns.
create or replace function public.business_setup_portal_account(p_client text) returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from client_portal_accounts a
   where a.client_master_id = p_client
      or a.banking_client_id in (select b.id from banking_clients b where b.client_master_id = p_client)
   limit 1
$$;
-- These two were used by the 015 versions replaced above.
drop function if exists public.business_setup_case_locked(uuid);
drop function if exists public.business_setup_case_net_paid(uuid);

-- ── Tables and columns ───────────────────────────────────────────────
drop table if exists public.business_setup_signed_quotes;
drop index if exists public.business_setup_invoices_case_idx;
alter table public.business_setup_invoices drop column if exists case_id cascade;
alter table public.business_setup_invoices drop column if exists created_by;
update public.business_setup_fee_items set default_amount = 0 where default_amount is null;
alter table public.business_setup_fee_items alter column default_amount set not null;
alter table public.business_setup_fee_items drop column if exists vat_rate;
alter table public.business_setup_fee_items drop column if exists is_service;

commit;
