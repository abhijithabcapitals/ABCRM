-- 014: Business Development quotes go through Template Hub.
-- A lead's quote is a Template Hub quotation (hub_documents, department 'Business Development', its own BDQ/BDE numbering) made on the
-- Service Desk template and linked to the lead (hub_documents.bd_lead_id). The engagement letter comes only after the client accepts the
-- quote: in the client portal (bd_portal_decide) or from a signed copy staff upload on the lead (bd_quote_accept_signed). Then the letter is
-- made from the quote exactly as in Template Hub (hub_document_create doc_type letter), and the guard below refuses one any earlier.
-- So the lead can use the portal before it is converted, it gets a Client Master record (bd_leads.portal_client_id) and a login
-- (Edge Function bd-quote-portal, action bd_issue_login).
-- Rollback: rollback/014_rollback.sql.

begin;

-- Numbering: ABC/{YYYY}/{MM}/BDQ001 and BDE001, editable in Template Hub settings like the other departments.
update hub_settings set value = value || jsonb_build_object('Business Development', jsonb_build_object(
  'quote',  jsonb_build_object('digits', 3, 'format', 'ABC/{YYYY}/{MM}/BDQ{SERIAL}', 'restart', 'never'),
  'letter', jsonb_build_object('digits', 3, 'format', 'ABC/{YYYY}/{MM}/BDE{SERIAL}', 'restart', 'never')))
 where key = 'document_numbering' and not (value ? 'Business Development');

alter table public.hub_documents add column if not exists bd_lead_id uuid references public.bd_leads(id);
create index if not exists hub_documents_bd_lead_idx on public.hub_documents (bd_lead_id) where bd_lead_id is not null;

alter table public.bd_leads add column if not exists portal_client_id text references public.client_master(client_id);

-- The client's acceptance of a BD quote: from the portal, or from the signed copy staff uploaded. One decision per quote.
create table if not exists public.bd_quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null unique references public.hub_documents(id),
  lead_id uuid not null references public.bd_leads(id),
  decision text not null check (decision in ('Accepted', 'Rejected')),
  source text not null check (source in ('Portal', 'Signed copy')),
  note text,
  signed_path text,
  signed_file_name text,
  account_id uuid references public.client_portal_accounts(id),
  username text,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table public.bd_quote_acceptances enable row level security;
drop policy if exists bd_quote_acceptances_read on public.bd_quote_acceptances;
create policy bd_quote_acceptances_read on public.bd_quote_acceptances for select to authenticated using (public.bd_current_role() is not null);
revoke insert, update, delete on public.bd_quote_acceptances from anon, authenticated;
grant select on public.bd_quote_acceptances to authenticated;

-- Signed copies: Business Development/signed/<lead id>/..., written and read by BD users.
drop policy if exists bd_signed_insert on storage.objects;
create policy bd_signed_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'hub-documents' and name like 'Business Development/signed/%'
  and public.bd_current_role() = any (array['super_admin', 'bd_manager', 'team_leader', 'sales_executive', 'marketing_executive']));
drop policy if exists bd_signed_read on storage.objects;
create policy bd_signed_read on storage.objects for select to authenticated using (
  bucket_id <> 'hub-documents' or name not like 'Business Development/signed/%' or public.bd_current_role() is not null);

-- A letter of a BD quote: only once the quote is accepted. It takes the lead from its quote, and the lead records the letter's number.
create or replace function public.bd_hub_letter_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare q hub_documents;
begin
  if new.doc_type <> 'letter' or new.parent_id is null then return new; end if;
  select * into q from hub_documents where id = new.parent_id;
  if q.bd_lead_id is null then return new; end if;
  if q.status <> 'accepted' then
    raise exception 'Quote % is not accepted yet: the client accepts it in the portal, or upload the signed quote on the lead', q.document_number;
  end if;
  new.bd_lead_id := q.bd_lead_id;
  update bd_leads set engagement_reference = new.document_number, last_activity_at = now() where id = q.bd_lead_id;
  return new;
end $$;
drop trigger if exists bd_hub_letter_guard on public.hub_documents;
create trigger bd_hub_letter_guard before insert on public.hub_documents for each row execute function public.bd_hub_letter_guard();

-- The lead's Client Master record, made the first time it is needed (a portal login). An existing client with the same email is used instead.
create or replace function public.bd_lead_portal_client(p_lead uuid) returns text language plpgsql security definer set search_path = public as $$
declare l bd_leads; v_id text; v_email text; v_name text; v_n int;
begin
  if not bd_can_edit_lead(p_lead) then raise exception 'You do not have permission to change this lead.'; end if;
  select * into l from bd_leads where id = p_lead for update;
  if l.portal_client_id is not null then return l.portal_client_id; end if;
  v_email := lower(nullif(btrim(coalesce(l.email, '')), ''));
  if v_email is null then raise exception 'Add the lead''s email first: the portal login is sent there.'; end if;
  select count(*), min(client_id) into v_n, v_id from client_master where lower(btrim(coalesce(data ->> 'General Email', ''))) = v_email;
  if v_n <> 1 then
    v_name := coalesce(nullif(btrim(coalesce(l.company_name, '')), ''), l.prospect_name);
    v_id := 'CL' || lpad(nextval('client_master_seq')::text, 6, '0');
    insert into client_master (client_id, legal_name, data, created_by) values (v_id, v_name, jsonb_strip_nulls(jsonb_build_object(
      'Client ID', v_id, 'Client Legal Name', v_name, 'General Email', l.email,
      'General Phone', nullif(btrim(coalesce(l.mobile_country_code || ' ', '') || coalesce(l.mobile_number, '')), ''),
      'Primary Contact', l.primary_contact_name, 'Trade License Number', l.trade_licence_number,
      'Onboarding Status', 'Business Development lead ' || l.lead_number)), auth.uid());
    insert into client_master_history (client_id, action) values (v_id, 'Created from Business Development lead ' || l.lead_number);
  end if;
  update bd_leads set portal_client_id = v_id, updated_by = auth.uid(), updated_at = now() where id = p_lead;
  -- Quotes already made for the lead reach the portal too.
  update hub_documents set client_id = v_id where bd_lead_id = p_lead and client_id is null;
  perform bd_audit('bd_leads', p_lead, 'Update', null, jsonb_build_object('portal_client_id', v_id));
  return v_id;
end $$;

-- For the Edge Function's bd_issue_login: may this user issue the login, and to which client and address.
create or replace function public.bd_issue_login_ok(p_lead uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client text; a client_portal_accounts; v_email text;
begin
  v_client := bd_lead_portal_client(p_lead);
  if not exists (select 1 from hub_documents where bd_lead_id = p_lead and doc_type = 'quote' and status in ('issued', 'accepted')) then
    raise exception 'Generate the quote first: the login goes out with it';
  end if;
  select * into a from client_portal_accounts where id = business_setup_portal_account(v_client);
  if a.id is not null and a.status = 'revoked' then raise exception 'This client''s login was revoked. Ask an administrator to restore it.'; end if;
  v_email := coalesce((select nullif(btrim(coalesce(m.data ->> 'General Email', '')), '') from client_master m where m.client_id = v_client), nullif(btrim(coalesce(a.email, '')), ''));
  if v_email is null then raise exception 'Add the client''s email first.'; end if;
  return jsonb_build_object('client_id', v_client, 'email', v_email, 'has_login', a.id is not null and a.status = 'active');
end $$;

-- The lead's quote: a Template Hub quotation on the Service Desk template, department Business Development, linked to the lead.
-- p is hub_document_create's payload (client details, lines, vat_mode, valid_until, notes); the type and department are set here.
create or replace function public.bd_quote_issue(p_lead uuid, p jsonb) returns hub_documents language plpgsql security definer set search_path = public as $$
declare l bd_leads; r hub_documents;
begin
  if not bd_can_edit_lead(p_lead) then raise exception 'You do not have permission to change this lead.'; end if;
  select * into l from bd_leads where id = p_lead for update;
  if l.status <> 'Open' then raise exception 'Only an active lead can be sent a quote.'; end if;
  if exists (select 1 from hub_documents where bd_lead_id = p_lead and doc_type = 'quote' and status in ('issued', 'accepted')) and nullif(p ->> 'revises_id', '') is null then
    raise exception 'This lead already has a live quote. Revise it, or wait for the client''s decision.';
  end if;
  r := hub_document_create((p - 'client_id' - 'case_id' - 'template_key') || jsonb_build_object('doc_type', 'quote', 'department', 'Business Development')
        || case when l.portal_client_id is not null then jsonb_build_object('client_id', l.portal_client_id) else '{}'::jsonb end);
  update hub_documents set bd_lead_id = p_lead where id = r.id returning * into r;
  update bd_leads set quote_reference = r.document_number, last_activity_at = now(), updated_by = auth.uid() where id = p_lead;
  perform bd_audit('bd_leads', p_lead, 'Update', null, jsonb_build_object('quote', r.document_number, 'quote_id', r.id));
  return r;
end $$;

-- Staff record the client's acceptance from the signed quote they uploaded (Business Development/signed/<lead>/...).
create or replace function public.bd_quote_accept_signed(p_doc uuid, p jsonb) returns hub_documents language plpgsql security definer set search_path = public as $$
declare q hub_documents; v_path text := nullif(btrim(p ->> 'signed_path'), ''); r hub_documents;
begin
  select * into q from hub_documents where id = p_doc and doc_type = 'quote' for update;
  if q.id is null or q.bd_lead_id is null then raise exception 'Quote not found'; end if;
  if not bd_can_edit_lead(q.bd_lead_id) then raise exception 'You do not have permission to change this lead.'; end if;
  if q.status <> 'issued' then raise exception 'Quote % is % and cannot be accepted', q.document_number, q.status; end if;
  if v_path is null or v_path not like 'Business Development/signed/' || q.bd_lead_id::text || '/%' then raise exception 'Upload the signed quote first.'; end if;
  if exists (select 1 from bd_quote_acceptances where document_id = q.id) then raise exception 'A decision is already recorded for this quote.'; end if;
  insert into bd_quote_acceptances (document_id, lead_id, decision, source, note, signed_path, signed_file_name, created_by)
  values (q.id, q.bd_lead_id, 'Accepted', 'Signed copy', nullif(btrim(coalesce(p ->> 'note', '')), ''), v_path, nullif(btrim(coalesce(p ->> 'file_name', '')), ''), auth.uid());
  update hub_documents set status = 'accepted', status_at = now(), status_by = auth.uid(), signed_at = now(), signed_path = v_path where id = q.id returning * into r;
  update bd_leads set last_activity_at = now() where id = q.bd_lead_id;
  perform bd_audit('bd_leads', q.bd_lead_id, 'Update', null, jsonb_build_object('quote', q.document_number, 'accepted', 'Signed copy'));
  return r;
end $$;

-- Quote sent: the engagement letter now follows acceptance, so its reference is optional here.
create or replace function public.bd_record_quote_sent(p_lead_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_lead public.bd_leads;
  v_from public.bd_pipeline_stages;
  v_to public.bd_pipeline_stages;
  v_quote text := nullif(btrim(p->>'quote_reference'), '');
  v_engagement text := nullif(btrim(p->>'engagement_reference'), '');
  v_to_email text := nullif(btrim(p->>'sent_to'), '');
  v_sent timestamptz := coalesce(nullif(p->>'sent_at', '')::timestamptz, now());
  v_next timestamptz := nullif(p->>'next_followup_at', '')::timestamptz;
  v_summary text;
begin
  if not public.bd_can_edit_lead(p_lead_id) then raise exception 'You do not have permission to change this lead.'; end if;
  select * into v_lead from public.bd_leads where id = p_lead_id for update;
  if v_lead.status <> 'Open' then raise exception 'Only an active lead can be sent a quote.'; end if;
  if v_lead.assigned_to_user_id is null then raise exception 'Assign the lead to someone first.'; end if;
  if v_quote is null then raise exception 'Enter the quotation reference.'; end if;
  if v_to_email is null or v_to_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter the email address the quote was sent to.';
  end if;
  if not exists (select 1 from public.bd_lead_services s where s.lead_id = p_lead_id and s.proposed_fee_amount is not null
                 and s.service_status <> 'Rejected') then
    raise exception 'Add a proposed fee to at least one service before sending the quote.';
  end if;
  if v_next is null then raise exception 'Set the date to follow up on the quote.'; end if;

  v_summary := coalesce(nullif(btrim(p->>'summary'), ''),
    format('Quotation %s sent to %s.', v_quote, v_to_email));
  if length(v_summary) < 10 then v_summary := v_summary || ' (quote sent)'; end if;

  insert into public.bd_discussions (lead_id, occurred_at, channel, channel_detail, direction, contact_person, outcome,
    requirement_summary, discussion_summary, services_discussed, client_interest_level, agreed_next_action,
    next_followup_at, external_reference, recorded_by)
  values (p_lead_id, v_sent, 'Email', 'Email', 'Outbound', coalesce(v_lead.primary_contact_name, v_lead.prospect_name),
    'Quote sent', 'Quotation', v_summary,
    coalesce(array(select c.service_name from public.bd_lead_services s join public.bd_service_catalog c on c.id = s.service_id
                   where s.lead_id = p_lead_id and s.service_status <> 'Rejected'), '{}'),
    'Interested', 'Follow up on the quote: client acceptance, engagement letter, payment', v_next, left(concat_ws(' / ', v_quote, v_engagement), 255), auth.uid());

  insert into public.bd_followups (lead_id, assigned_to_user_id, followup_type, channel_detail, scheduled_at, objective,
                                   next_action, created_by)
  values (p_lead_id, v_lead.assigned_to_user_id, 'Email', 'Email', v_next, 'Follow up on the quote',
          'Confirm acceptance, send the engagement letter and collect the payment receipt', auth.uid());

  update public.bd_lead_services set service_status = 'Quoted', updated_at = now()
  where lead_id = p_lead_id and proposed_fee_amount is not null and service_status in ('Identifying', 'Interested');

  select * into v_from from public.bd_pipeline_stages where id = v_lead.stage_id;
  select * into v_to from public.bd_pipeline_stages where stage_code = 'QUOTE_SENT';
  update public.bd_leads set quote_reference = v_quote, engagement_reference = coalesce(v_engagement, engagement_reference), quote_sent_to = v_to_email,
    quote_sent_at = v_sent, stage_id = v_to.id, proposal_sent_at = coalesce(proposal_sent_at, v_sent),
    qualified_at = coalesce(qualified_at, v_sent), last_activity_at = now(), updated_by = auth.uid()
  where id = p_lead_id returning * into v_lead;
  perform public.bd_refresh_next_followup(p_lead_id);
  if v_from.id is distinct from v_to.id then
    perform public.bd_stage_history(v_lead, v_from.id, 'Open', 'Quote sent');
  end if;
  perform public.bd_audit('bd_leads', p_lead_id, 'Stage Change', jsonb_build_object('stage', v_from.stage_code),
                          jsonb_build_object('stage', 'QUOTE_SENT', 'quote', v_quote, 'engagement', v_engagement, 'sent_to', v_to_email));
  return public.bd_lead_ui_json(p_lead_id);
end $$;

-- Portal (called by the Edge Function with the session's account only): the client's own BD quotes and their letters.
create or replace function public.bd_portal_quotes(p_account uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client text := business_setup_portal_client(p_account); v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  if v_client is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', q.id, 'number', q.document_number, 'date', q.created_at, 'total', q.total_amount, 'status', q.status, 'services', to_jsonb(q.services),
      'valid_until', q.valid_until, 'has_file', q.storage_path is not null,
      'expired', q.status = 'issued' and q.valid_until is not null and q.valid_until < v_today,
      'can_decide', q.status = 'issued' and a.id is null and (q.valid_until is null or q.valid_until >= v_today),
      'decision', case when a.id is not null then jsonb_build_object('decision', a.decision, 'date', a.created_at, 'source', a.source,
                    'note', case when a.source = 'Portal' then a.note end) end,
      'letter', (select jsonb_build_object('id', l.id, 'number', l.document_number, 'has_file', l.storage_path is not null)
                   from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter' and l.status <> 'rejected' order by l.created_at desc limit 1))
      order by q.created_at desc)
    from hub_documents q left join bd_quote_acceptances a on a.document_id = q.id
   where q.client_id = v_client and q.bd_lead_id is not null and q.doc_type = 'quote' and q.status <> 'superseded'), '[]'::jsonb);
end $$;

create or replace function public.bd_portal_decide(p_account uuid, p_document uuid, p_decision text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_client text := business_setup_portal_client(p_account); a client_portal_accounts; q hub_documents; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select * into a from client_portal_accounts where id = p_account;
  if a.id is null or a.status <> 'active' or v_client is null then raise exception 'Please sign in again.'; end if;
  if p_decision is null or p_decision not in ('Accepted', 'Rejected') then raise exception 'Choose Accept or Reject.'; end if;
  if p_decision = 'Rejected' and v_note is null then raise exception 'Tell us why you are rejecting this quote.'; end if;
  select * into q from hub_documents where id = p_document and doc_type = 'quote' and bd_lead_id is not null for update;
  if q.id is null or q.client_id is distinct from v_client then raise exception 'Document not found.'; end if;
  if exists (select 1 from bd_quote_acceptances where document_id = q.id) then raise exception 'A decision has already been recorded for this quote.'; end if;
  if q.status <> 'issued' then raise exception 'This quote is no longer open for a decision.'; end if;
  if q.valid_until is not null and q.valid_until < (now() at time zone 'Asia/Dubai')::date then
    raise exception 'This quote has expired. Please ask AB Capital Services FZE for a new one.';
  end if;
  insert into bd_quote_acceptances (document_id, lead_id, decision, source, note, account_id, username)
  values (q.id, q.bd_lead_id, p_decision, 'Portal', v_note, a.id, a.username);
  update hub_documents set status = case p_decision when 'Accepted' then 'accepted' else 'rejected' end, status_at = now(),
         status_reason = case when p_decision = 'Rejected' then 'Rejected by the client in the portal' end where id = q.id;
  update bd_leads set last_activity_at = now() where id = q.bd_lead_id;
  perform bd_audit('bd_leads', q.bd_lead_id, 'Update', null, jsonb_build_object('quote', q.document_number, 'portal_decision', p_decision, 'username', a.username));
end $$;

-- A link to the client's own BD quote or letter file.
create or replace function public.bd_portal_file(p_account uuid, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client text := business_setup_portal_client(p_account); d hub_documents;
begin
  select * into d from hub_documents where id = p_id and doc_type in ('quote', 'letter') and bd_lead_id is not null;
  if d.id is null or v_client is null or d.client_id is distinct from v_client or d.storage_path is null then raise exception 'File not found.'; end if;
  return jsonb_build_object('bucket', 'hub-documents', 'path', d.storage_path,
    'file_name', regexp_replace(d.document_number, '[/\\]+', '-', 'g') || '.' || coalesce(substring(d.storage_path from '\.([A-Za-z0-9]+)$'), 'docx'));
end $$;

revoke all on function public.bd_portal_quotes(uuid), public.bd_portal_decide(uuid, uuid, text, text), public.bd_portal_file(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bd_portal_quotes(uuid), public.bd_portal_decide(uuid, uuid, text, text), public.bd_portal_file(uuid, uuid) to service_role;
revoke all on function public.bd_lead_portal_client(uuid), public.bd_issue_login_ok(uuid), public.bd_quote_issue(uuid, jsonb), public.bd_quote_accept_signed(uuid, jsonb) from public, anon;
grant execute on function public.bd_lead_portal_client(uuid), public.bd_issue_login_ok(uuid), public.bd_quote_issue(uuid, jsonb), public.bd_quote_accept_signed(uuid, jsonb) to authenticated;
revoke all on function public.bd_hub_letter_guard() from public, anon, authenticated;

commit;
