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

-- ── 016_client_flow.sql ──────────────────────────────────────────────
-- The move function goes. The start gate returns to 006's (016 lets a quote of a case start without a payment, which reads case_id). The other functions 016
-- replaced (case_sync, case_docs, case_list, case_new, case_take, case_shared, case_confirm, case_lost, case_form_trg, dashboard) are dropped or restored by the sections below.
drop trigger if exists business_setup_case_handover on public.business_setup_handovers;
drop function if exists public.business_setup_case_handover_trg();
drop function if exists public.business_setup_case_move_to_onboarding(uuid, text, boolean);
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
drop table if exists public.business_setup_signed_quotes;
delete from public.business_setup_fee_items f where f.grp = 'Company' and f.name in ('Company registration', 'Company renewal', 'Visa') and f.default_amount is null
   and not exists (select 1 from public.business_setup_services s where s.fee_item_id = f.id);
update public.business_setup_fee_items set default_amount = 0 where default_amount is null;
alter table public.business_setup_fee_items alter column default_amount set not null;
alter table public.business_setup_fee_items drop column if exists vat_rate;

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
