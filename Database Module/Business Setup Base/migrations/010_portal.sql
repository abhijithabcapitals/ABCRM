-- =====================================================================
-- Business Setup Base - the client's view in the portal                010
-- =====================================================================
-- Re-runnable. Runs after 001 to 009 and Client Base 003. Clients are not Supabase users: only the client-portal
-- Edge Function, with the service role, calls these functions, and it passes the account of the live session.
-- The client ID is worked out here from that account and is never taken from the browser. Named fields only.
-- Re-running Client Base 003 resets client_portal_me, so re-running it means re-running this file.
-- =====================================================================

-- Invoices. Nothing writes here until Zoho is connected, and the client's Invoices section stays empty.
create table if not exists public.business_setup_invoices (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  quote_id uuid references public.hub_documents(id),
  invoice_number text,
  issued_on date,
  amount numeric(18,2),
  file_path text,
  source text not null default 'zoho',
  zoho_id text,
  created_at timestamptz not null default now()
);
create index if not exists business_setup_invoices_client_idx on public.business_setup_invoices (client_id);
alter table public.business_setup_invoices enable row level security;
drop policy if exists business_setup_invoices_read on public.business_setup_invoices;
create policy business_setup_invoices_read on public.business_setup_invoices for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_invoices from anon, authenticated;
grant select on public.business_setup_invoices to authenticated;

-- Which client an account belongs to: its own link, or the one on its Banking client. Null when neither is set.
create or replace function public.business_setup_portal_client(p_account uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(a.client_master_id, (select b.client_master_id from banking_clients b where b.id = a.banking_client_id))
    from client_portal_accounts a where a.id = p_account
$$;

create or replace function public.business_setup_portal_view(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account);
begin
  return jsonb_build_object(
    'form', business_setup_form_get(p_account),
    'details', client_portal_me(p_account) -> 'record',
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'action', s.action, 'status', s.status, 'started_at', s.started_at,
                    'completed_at', s.completed_at, 'expiry_date', s.expiry_date) order by s.created_at desc), '[]'::jsonb)
                   from business_setup_services s where s.client_id = v_client),
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
end $$;

-- Where a file of this client's is stored, for a short signed link. One reply for anything not theirs or not there.
create or replace function public.business_setup_portal_file(p_account uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_client text := business_setup_portal_client(p_account); v_bucket text; v_path text; v_name text;
begin
  if v_client is not null then
    if p_kind = 'quote' then
      select 'hub-documents', q.storage_path, q.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents q
       where q.id = p_id and q.client_id = v_client and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'letter' then
      select 'hub-documents', l.storage_path, l.document_number || '.docx' into v_bucket, v_path, v_name from hub_documents l join hub_documents q on q.id = l.parent_id
       where l.id = p_id and l.doc_type = 'letter' and q.client_id = v_client and q.department = 'Business Setup' and q.status in ('issued', 'accepted', 'rejected');
    elsif p_kind = 'receipt' then
      select 'hub-documents', r.storage_path, replace(r.receipt_number, '/', '-') || '.docx' into v_bucket, v_path, v_name from business_setup_receipts r join business_setup_payments y on y.id = r.payment_id
       where r.id = p_id and y.client_id = v_client;
    elsif p_kind = 'output' then
      select 'business-setup-documents', d.storage_path, d.file_name into v_bucket, v_path, v_name from business_setup_documents d
       where d.id = p_id and d.client_id = v_client and d.is_output and d.client_visible;
    elsif p_kind = 'invoice' then
      select 'business-setup-documents', i.file_path, coalesce(i.invoice_number, 'invoice') || '.pdf' into v_bucket, v_path, v_name from business_setup_invoices i
       where i.id = p_id and i.client_id = v_client;
    end if;
  end if;
  if v_path is null then raise exception 'File not found'; end if;
  return jsonb_build_object('bucket', v_bucket, 'path', v_path, 'file_name', replace(coalesce(v_name, 'file'), '/', '-'));
end $$;

-- Same as Client Base 003, with email and phone from Client Master first. What a client sees of their own record:
-- KYC risk, internal notes, Banking fees and staff data never leave here. Their own Business Setup quotes and payments
-- come from business_setup_portal_view above.
create or replace function public.client_portal_me(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from client_portal_accounts where id = p_account),
  c as (select b.* from banking_clients b join a on a.banking_client_id = b.id),
  k as (select p.* from banking_kyc_profiles p join c on p.client_id = c.id limit 1),
  m as (select x.data, x.legal_name from client_master x
         where x.client_id = coalesce((select client_master_id from a), (select client_master_id from c)))
  select jsonb_build_object(
    'username', (select username from a),
    'display_name', (select display_name from a),
    'record', jsonb_build_object(
      'legal_name', coalesce((select legal_name from k), (select legal_name from m)),
      'trade_name', coalesce((select trade_name from k), (select data->>'Trade Name' from m)),
      'license_number', coalesce((select license_number from k), (select license_number from c), (select data->>'Trade License Number' from m)),
      'license_expiry_date', coalesce((select license_expiry_date::text from k), (select data->>'License Expiry Date' from m)),
      'issuing_authority', coalesce((select issuing_authority from k), (select data->>'Jurisdiction' from m)),
      'legal_structure', (select legal_structure from k),
      'business_activity', coalesce((select business_activity from k), (select data->>'Business Activities' from m)),
      'registered_address', coalesce((select registered_address from k), (select data->>'Registered Address' from m)),
      'vat_trn', coalesce((select vat_trn from k), (select data->>'TRN' from m)),
      'ct_registration_number', (select data->>'CT Registration Number' from m),
      'financial_year_end', (select data->>'Financial Year End' from m),
      'website', coalesce((select website from k), (select data->>'Website' from m)),
      'email', coalesce((select client_master_plain(data ->> 'General Email') from m), (select company_email from k)),
      'phone', coalesce((select client_master_plain(data ->> 'General Phone') from m), (select company_phone from k))),
    'services', (select coalesce(jsonb_agg(distinct jsonb_build_object('line', 'Business Banking', 'detail', r.bank_name)), '[]'::jsonb)
       from c join banking_cases cs on cs.client_id = c.id
       join banking_bank_recommendations br on br.case_id = cs.id and br.is_selected
       join banking_partners r on r.id = br.bank_id
      where cs.is_historical or (select coalesce(sum(p.signed_amount), 0) from banking_payments p where p.case_id = cs.id) > 0),
    'master_services', (select data->>'Services Provided' from m),
    'documents', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'doc_type', d.doc_type, 'note', d.note, 'file_name', d.file_name, 'size_bytes', d.size_bytes,
        'status', d.status, 'uploaded_at', d.uploaded_at, 'reviewed_at', d.reviewed_at,
        'review_note', case when d.status = 'rejected' then d.review_note end) order by d.uploaded_at desc), '[]'::jsonb)
       from client_portal_documents d where d.account_id = p_account and d.upload_complete))
$$;

revoke all on function public.business_setup_portal_client(uuid), public.business_setup_portal_view(uuid), public.business_setup_portal_file(uuid, text, uuid),
  public.client_portal_me(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_portal_client(uuid), public.business_setup_portal_view(uuid), public.business_setup_portal_file(uuid, text, uuid),
  public.client_portal_me(uuid) to service_role;
