-- =====================================================================
-- Business Setup Base - client portal: signed copy state   018
-- =====================================================================
-- Holds only portal functions. The portal view gains, on each quote, the state of the latest signed copy staff added (with the refusal note
-- the client may read, never a staff name), the client's own decision and whether it can still be made (expired, decision, can_decide; the letter has the
-- last two). The client cannot upload a signed copy, but decides in the portal (business_setup_portal_decide); staff issue the login with the quote
-- (business_setup_issue_login_ok, business_setup_login_grant, business_setup_login_mail). Clients are not Supabase Auth users: the view takes p_account and is
-- callable by the service role only.
-- The view also carries the revision of each decision, a letters list, the client's payment claims (business_setup_portal_claims, below) and, on each invoice,
-- whether a claim can be made or one is waiting. No staff name, staff note, reason or override text; a note shows only on a refused signed copy, a refused claim
-- and the client's own rejection.
-- Run after 015. Re-runnable. Undo with rollback/015_018_rollback.sql (phase 2 only, with 015) or rollback/013_019_rollback.sql (every case migration).
-- =====================================================================

-- The portal view as 010 defines it, plus 'closed' and 'signed' on each quote.
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
                                      'can_decide', q.status = 'accepted' and not exists (select 1 from business_setup_acceptances a where a.document_id = l.id)
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
                    'can_claim', coalesce((select cs.stage <> 'Lost' from business_setup_cases cs where cs.id = coalesce(i.case_id, (select q.case_id from hub_documents q where q.id = i.quote_id))), false)
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

-- A client no longer uploads a signed copy: business_setup_portal_signed_add is gone. Dropped here so a database that ran an earlier copy loses it too.
drop function if exists public.business_setup_portal_signed_add(uuid, uuid, text);

-- The client's login name for the quote message: id, username and status only. Never the password or a vault reference. For staff who
-- issue quotes (setup.quotes.manage), who do not hold the wider login rights of business_setup_portal_login_state.
create or replace function public.business_setup_portal_login_name(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.quotes.manage');
  return (select jsonb_build_object('id', a.id, 'username', a.username, 'status', a.status)
            from client_portal_accounts a where a.id = business_setup_portal_account(p_client));
end $$;
revoke all on function public.business_setup_portal_login_name(text) from public, anon;
grant execute on function public.business_setup_portal_login_name(text) to authenticated;

-- ── The client decides on a quote or a letter ────────────────────────
-- Accept or Reject from the portal. p_account comes from the live session, never from the browser; the client is worked out here, and a document
-- of another client reads as not found. Accept on a quote runs the accept logic of 016 (services, and the rest), Reject needs a note staff can read.
-- One decision per document: a revised quote is a new document with a decision of its own. Service role only.
create or replace function public.business_setup_portal_decide(p_account uuid, p_document uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client text := business_setup_portal_client(p_account); a client_portal_accounts; d hub_documents; q hub_documents; v_root uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_kind text; v_id uuid; v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  select * into a from client_portal_accounts where id = p_account;
  if a.id is null or a.status <> 'active' or v_client is null then raise exception 'Please sign in again.'; end if;
  select * into d from hub_documents where id = p_document;
  if d.id is null or d.department <> 'Business Setup' or d.doc_type not in ('quote', 'letter') or d.client_id is distinct from v_client then raise exception 'Document not found.'; end if;
  if p_decision is null or p_decision not in ('Accepted', 'Rejected') then raise exception 'Choose Accept or Reject.'; end if;
  if p_decision = 'Rejected' and v_note is null then raise exception 'Tell us why you are rejecting this document.'; end if;
  v_kind := case d.doc_type when 'letter' then 'Letter' else 'Quote' end;
  -- Lock the chain root, then the document, as an accept and a revision do.
  v_root := coalesce((select coalesce(r.root_quote_id, r.id) from hub_documents r where r.id = case when v_kind = 'Letter' then d.parent_id else d.id end), d.id);
  perform 1 from hub_documents where id = v_root for update;
  select * into d from hub_documents where id = p_document for update;
  if exists (select 1 from business_setup_acceptances where document_id = d.id) then raise exception 'A decision has already been recorded for this document.'; end if;
  if d.case_id is not null and (select stage from business_setup_cases where id = d.case_id) in ('Lost', 'Completed', 'Cancelled') then raise exception 'This case is closed.'; end if;
  if v_kind = 'Quote' then
    if d.status = 'superseded' then raise exception 'This quote was replaced by a newer one.'; end if;
    if d.status <> 'issued' then raise exception 'This quote is no longer open for a decision.'; end if;
    if d.valid_until is not null and d.valid_until < v_today then raise exception 'This quote has expired. Please ask AB Capital Services FZE for a new one.'; end if;
  else
    select * into q from hub_documents where id = d.parent_id;
    if q.id is null or q.status <> 'accepted' then raise exception 'Please accept the quote before the letter.'; end if;
    if d.status <> 'issued' then raise exception 'This letter is no longer open for a decision.'; end if;
  end if;
  insert into business_setup_acceptances (document_id, kind, revision, decision, note, source, account_id, username, created_by)
  values (d.id, v_kind, business_setup_doc_revision(d.id), p_decision, v_note, 'Portal', a.id, a.username, null) returning id into v_id;
  if v_kind = 'Quote' and p_decision = 'Accepted' then perform business_setup_quote_accept_body(d.id, false); end if;
  -- A rejected letter is out of the way: staff can issue a new one (hub_document_create), which supersedes it.
  if v_kind = 'Letter' and p_decision = 'Rejected' then update hub_documents set status = 'rejected', status_at = now(), status_reason = 'Rejected by the client' where id = d.id; end if;
  perform business_setup_audit('business_setup_acceptances', v_id::text, 'portal_decide', null,
          jsonb_build_object('document_id', d.id, 'kind', v_kind, 'decision', p_decision, 'username', a.username));
end $$;
revoke all on function public.business_setup_portal_decide(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.business_setup_portal_decide(uuid, uuid, text, text) to service_role;

-- ── The login issued with a quote ────────────────────────────────────
-- Staff with setup.leads.manage issue the client's login when the case's quote is issued. The checks are here; the client-portal function generates the
-- password on the server, saves it through business_setup_login_grant and emails it, so no member of staff sees it. Returns the client, the address
-- to write to (Client Master's, else the one the existing login was made with) and whether an active login already exists. A revoked login is refused.
create or replace function public.business_setup_issue_login_ok(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c business_setup_cases; q hub_documents; a client_portal_accounts; v_cm text; v_email text;
begin
  perform business_setup_require('setup.leads.manage');
  select * into c from business_setup_cases where id = p_case;
  if c.id is null then raise exception 'Case not found'; end if;
  if c.stage in ('Completed', 'Cancelled', 'Lost') then raise exception 'This case is closed'; end if;
  -- As the other case moves: the owner, or a holder of setup.cases.approve.
  if c.owner_id is distinct from auth.uid() and not business_setup_can('setup.cases.approve') then
    raise exception 'Only the owner (%) or a manager can issue the login for this case', coalesce(business_setup_person_name(c.owner_id), 'nobody yet');
  end if;
  if c.client_id is null then raise exception 'Link the client to this case first'; end if;
  select * into q from hub_documents where case_id = p_case and doc_type = 'quote' and status in ('issued', 'accepted')
   order by (status = 'accepted') desc, created_at desc limit 1;
  if q.id is null then raise exception 'Issue the quote first: the login goes out with it'; end if;
  select * into a from client_portal_accounts where id = business_setup_portal_account(c.client_id);
  -- Revoking and restoring belong to setup.portal.manage and admins, not to whoever issues a quote.
  if a.id is not null and a.status = 'revoked' then raise exception 'This client''s login was revoked. Ask an administrator to restore it.'; end if;
  -- The address is the client's own in Client Master (never a contact typed on a quote). A login that exists keeps the address it was made with.
  v_cm := (select nullif(btrim(coalesce(m.data ->> 'General Email', '')), '') from client_master m where m.client_id = c.client_id);
  v_email := coalesce(v_cm, nullif(btrim(coalesce(a.email, '')), ''));
  if v_email is null then raise exception 'Add the client''s email in Client Master first.'; end if;
  return jsonb_build_object('client_id', c.client_id, 'email', v_email, 'has_login', a.id is not null and a.status = 'active');
end $$;
revoke all on function public.business_setup_issue_login_ok(uuid) from public, anon;
grant execute on function public.business_setup_issue_login_ok(uuid) to authenticated;

-- Saves the login for a client, with the readable copy of its password in the vault as client_portal_admin_grant does (Client Login Base 004). That function
-- is for admins and is left as it is; this one is for the client-portal function after business_setup_issue_login_ok has passed, so it is service role only.
-- An active login is returned as it is, with created false: nothing changes, so issuing twice never changes the password. A revoked login is refused, not restored.
create or replace function public.business_setup_login_grant(p_client text, p_username text, p_password text, p_email text, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_user text := lower(trim(coalesce(p_username, ''))); v_email text := trim(coalesce(p_email, '')); v_name text; v_id uuid; v_secret uuid; a client_portal_accounts;
begin
  if v_user !~ '^[a-z0-9][a-z0-9._-]{3,59}$' then raise exception 'Username needs 4 to 60 letters, numbers, dots, dashes or underscores. It cannot contain @.'; end if;
  if length(coalesce(p_password, '')) < 10 then raise exception 'Password needs at least 10 characters.'; end if;
  if length(v_email) > 254 or v_email !~ '^[^[:space:]@<>,;"]+@[^[:space:]@<>,;"]+\.[^[:space:]@<>,;"]+$' then raise exception 'Enter a valid email address.'; end if;
  select coalesce(legal_name, client_id) into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Client not found.'; end if;
  perform pg_advisory_xact_lock(hashtext('business_setup_login:' || p_client));
  v_id := business_setup_portal_account(p_client);
  if v_id is not null then
    select * into a from client_portal_accounts where id = v_id for update;
    -- Revoking and restoring belong to setup.portal.manage and admins: issuing never undoes a revoke.
    if a.status <> 'active' then raise exception 'This client''s login was revoked. Ask an administrator to restore it.'; end if;
    return jsonb_build_object('created', false, 'id', a.id, 'username', a.username, 'display_name', a.display_name, 'email', coalesce(nullif(btrim(coalesce(a.email, '')), ''), v_email));
  end if;
  if exists (select 1 from client_portal_accounts where username = v_user) then raise exception 'That username is taken. Choose another.'; end if;
  -- The Banking record of the client, where the existing link rule (banking_clients.client_master_id) finds one, so Banking sees the same login.
  insert into client_portal_accounts (client_master_id, banking_client_id, display_name, username, password_hash, email, created_by)
  values (p_client, (select b.id from banking_clients b where b.client_master_id = p_client), v_name, v_user, crypt(p_password, gen_salt('bf', 10)), v_email, p_actor) returning id into v_id;
  select id into v_secret from vault.secrets where name = 'client_portal_pw:' || v_id;
  if v_secret is null then perform vault.create_secret(p_password, 'client_portal_pw:' || v_id, 'Client portal password');
  else perform vault.update_secret(v_secret, p_password); end if;
  insert into admin_audit (actor, action, target, detail) values (p_actor, 'client_portal_create', v_user, jsonb_build_object('client', v_name));
  insert into business_setup_audit_log (actor, table_name, row_id, action, old_data, new_data)
  values (p_actor, 'client_portal_accounts', v_id::text, 'login_issue', null, jsonb_build_object('client_id', p_client, 'username', v_user));
  return jsonb_build_object('created', true, 'id', v_id, 'username', v_user, 'display_name', v_name, 'email', v_email);
end $$;
revoke all on function public.business_setup_login_grant(text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.business_setup_login_grant(text, text, text, text, uuid) to service_role;

-- The client's login for an email: username, name and status, and the password too when asked (Resend). Only the client-portal function calls it, after
-- business_setup_issue_login_ok has passed. Reading the password is logged without it. Service role only.
create or replace function public.business_setup_login_mail(p_client text, p_with_password boolean, p_actor uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare a client_portal_accounts; v_password text;
begin
  select * into a from client_portal_accounts where id = business_setup_portal_account(p_client);
  if a.id is null then return null; end if;
  if coalesce(p_with_password, false) then
    select decrypted_secret into v_password from vault.decrypted_secrets where name = 'client_portal_pw:' || a.id;
    insert into admin_audit (actor, action, target, detail) values (p_actor, 'client_portal_password_emailed', a.username, jsonb_build_object('found', v_password is not null));
  end if;
  return jsonb_build_object('id', a.id, 'username', a.username, 'display_name', a.display_name, 'status', a.status, 'email', nullif(btrim(coalesce(a.email, '')), ''))
         || case when coalesce(p_with_password, false) then jsonb_build_object('password', v_password) else '{}'::jsonb end;
end $$;
revoke all on function public.business_setup_login_mail(text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.business_setup_login_mail(text, boolean, uuid) to service_role;

revoke all on function public.business_setup_portal_view(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_view(uuid) to service_role;

-- ── Payment claims from the portal ───────────────────────────────────
-- "I have paid" on one invoice (p: invoice_id, amount, paid_on, reference, proof_path). p_account comes from the live session; the client is worked out here and
-- an invoice of another client reads as not found. The claim belongs to the invoice and to the invoice's case, changes no balance, and waits for staff
-- (business_setup_payment_add with claim_id, or business_setup_claim_refuse, both in 016). One Pending claim per invoice. A claim above the balance is allowed:
-- staff meet the overpayment rule when they confirm it. proof_path is optional and must be a finished upload of this very login (incoming/<account>/...).
-- Service role only.
create or replace function public.business_setup_portal_claim_add(p_account uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_client text := business_setup_portal_client(p_account); a client_portal_accounts; i business_setup_invoices; v_case uuid; v_stage text; v_id uuid;
  v_today date := (now() at time zone 'Asia/Dubai')::date; v_amount numeric; v_on date; v_ref text; v_proof text; v_prefix text; v_inv uuid;
begin
  select * into a from client_portal_accounts where id = p_account;
  if a.id is null or a.status <> 'active' or v_client is null then raise exception 'Please sign in again.'; end if;
  p := coalesce(p, '{}'::jsonb);
  begin
    v_inv := nullif(p ->> 'invoice_id', '')::uuid;
  exception when invalid_text_representation then
    v_inv := null;
  end;
  -- Locking the invoice makes two claims on it wait for each other, so "one Pending" holds (the unique index is the last guard).
  select * into i from business_setup_invoices where id = v_inv for update;
  if i.id is null or i.client_id is distinct from v_client then raise exception 'Invoice not found.'; end if;
  v_case := coalesce(i.case_id, (select q.case_id from hub_documents q where q.id = i.quote_id));
  if v_case is null then raise exception 'This invoice cannot take a payment claim yet. Please contact AB Capital Services FZE.'; end if;
  select stage into v_stage from business_setup_cases where id = v_case;
  if v_stage is null or v_stage = 'Lost' then raise exception 'This case is closed and takes no payment.'; end if;
  if exists (select 1 from business_setup_payment_claims where invoice_id = i.id and status = 'Pending') then
    raise exception 'A payment claim for this invoice is already waiting for AB Capital Services FZE to check.';
  end if;
  begin
    v_amount := nullif(btrim(coalesce(p ->> 'amount', '')), '')::numeric;
  exception when others then
    v_amount := null;
  end;
  if v_amount is null or v_amount <= 0 or v_amount >= 10000000000000000 or v_amount <> round(v_amount, 2) then
    raise exception 'Enter an amount above zero with at most two decimals.';
  end if;
  begin
    v_on := nullif(btrim(coalesce(p ->> 'paid_on', '')), '')::date;
  exception when others then
    raise exception 'Enter the date you paid.';
  end;
  if v_on is null then raise exception 'Enter the date you paid.'; end if;
  if v_on > v_today then raise exception 'The payment date cannot be in the future.'; end if;
  v_ref := nullif(btrim(coalesce(p ->> 'reference', '')), '');
  if length(v_ref) > 200 then raise exception 'The reference is too long.'; end if;
  v_proof := nullif(btrim(coalesce(p ->> 'proof_path', '')), '');
  if v_proof is not null then
    v_prefix := 'incoming/' || p_account::text || '/';
    if not coalesce(left(v_proof, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_proof, '/')) or '' = any (string_to_array(v_proof, '/'))
       or not exists (select 1 from client_portal_documents d where d.account_id = p_account and d.storage_path = v_proof and d.upload_complete) then
      raise exception 'The proof of payment is not one of your finished uploads. Please upload it again.';
    end if;
  end if;
  begin
    insert into business_setup_payment_claims (case_id, account_id, invoice_id, amount, paid_on, reference, proof_path)
    values (v_case, p_account, i.id, v_amount, v_on, v_ref, v_proof) returning id into v_id;
  exception when unique_violation then
    raise exception 'A payment claim for this invoice is already waiting for AB Capital Services FZE to check.';
  end;
  perform business_setup_audit('business_setup_payment_claims', v_id::text, 'claim_add', null,
          jsonb_build_object('case_id', v_case, 'invoice_id', i.id, 'amount', v_amount, 'username', a.username, 'has_proof', v_proof is not null));
  return v_id;
end $$;
revoke all on function public.business_setup_portal_claim_add(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.business_setup_portal_claim_add(uuid, jsonb) to service_role;

-- The client's own claims, newest first: status, the refusal note when refused, and the receipt when confirmed. Never a staff name, an id of staff, or a file path.
create or replace function public.business_setup_portal_claims(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'invoice_id', c.invoice_id, 'invoice_number', i.invoice_number, 'amount', c.amount, 'paid_on', c.paid_on,
           'reference', c.reference, 'status', c.status, 'date', c.created_at::date, 'has_proof', c.proof_path is not null,
           'note', case when c.status = 'Refused' then c.note end,
           'receipt_id', case when c.status = 'Confirmed' then (select r.id from business_setup_receipts r where r.payment_id = c.payment_id) end)
         order by c.created_at desc), '[]'::jsonb)
    from business_setup_payment_claims c join business_setup_invoices i on i.id = c.invoice_id
   where i.client_id = business_setup_portal_client(p_account) and business_setup_portal_client(p_account) is not null
$$;
revoke all on function public.business_setup_portal_claims(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_claims(uuid) to service_role;
