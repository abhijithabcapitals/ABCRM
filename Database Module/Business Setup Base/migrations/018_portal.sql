-- =====================================================================
-- Business Setup Base - client portal: signed quote upload   018
-- =====================================================================
-- Holds only portal functions. The portal view gains, on each quote, whether the client may upload a signed copy and the state of the
-- latest one (with the refusal note the client may read, never a staff name). business_setup_portal_signed_add records the client's
-- upload. Clients are not Supabase Auth users: both take p_account and are callable by the service role only.
-- Run after 015. Re-runnable. Undo with rollback/013_019_rollback.sql.
-- =====================================================================

-- The portal view as 010 defines it, plus 'can_sign' and 'signed' on each quote.
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
                  'net_paid', case when q.status in ('issued', 'accepted') then business_setup_net_paid(q.id) end, 'outstanding', case when q.status in ('issued', 'accepted') then q.total_amount - business_setup_net_paid(q.id) end, 'has_file', q.storage_path is not null,
                  'can_sign', q.status = 'issued' and not exists (select 1 from business_setup_signed_quotes s where s.quote_id = q.id and s.status = 'Uploaded'),
                  'signed', (select jsonb_build_object('status', s.status, 'date', s.created_at::date, 'note', case when s.status = 'Refused' then s.note end)
                               from business_setup_signed_quotes s where s.quote_id = q.id order by s.created_at desc limit 1),
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
end $$;

-- The client's own signed copy of a quote. The file is already in storage under incoming/<account>/ (the Edge Function made the upload
-- link and checked the file is there). The quote must be this client's and issued. One copy waits for review at a time.
create or replace function public.business_setup_portal_signed_add(p_account uuid, p_quote uuid, p_path text) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); q hub_documents; v_path text := nullif(btrim(coalesce(p_path, '')), ''); v_prefix text; v_id uuid;
begin
  if v_client is null then raise exception 'Quote not found'; end if;
  select * into q from hub_documents where id = p_quote and doc_type = 'quote' and department = 'Business Setup' and client_id = v_client for update;
  if q.id is null then raise exception 'Quote not found'; end if;
  if q.status <> 'issued' then raise exception 'Only a quote that is waiting for you can take a signed copy'; end if;
  if v_path is null then raise exception 'The file path is missing'; end if;
  v_prefix := 'incoming/' || p_account || '/';
  if not coalesce(left(v_path, length(v_prefix)) = v_prefix, false) or '..' = any (string_to_array(v_path, '/')) or '' = any (string_to_array(v_path, '/')) then
    raise exception 'The file path is not valid';
  end if;
  if exists (select 1 from business_setup_signed_quotes where quote_id = q.id and status = 'Uploaded') then
    raise exception 'A signed copy of this quote is already waiting for review';
  end if;
  begin
    insert into business_setup_signed_quotes (quote_id, storage_path, source, status, created_by) values (q.id, v_path, 'Client', 'Uploaded', null) returning id into v_id;
  exception when unique_violation then raise exception 'That file has already been sent';
  end;
  perform business_setup_audit('business_setup_signed_quotes', v_id::text, 'signed_add', null, jsonb_build_object('quote_id', q.id, 'source', 'Client', 'account_id', p_account));
  return v_id;
end $$;

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

revoke all on function public.business_setup_portal_view(uuid), public.business_setup_portal_signed_add(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.business_setup_portal_view(uuid), public.business_setup_portal_signed_add(uuid, uuid, text) to service_role;
