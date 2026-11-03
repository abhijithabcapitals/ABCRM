-- =====================================================================
-- Client Login Base - what a client sees                           001
-- =====================================================================
-- The read layer of the client portal: services, accounts (amounts and ledger), documents, requested changes,
-- and the admin client list. Only the client-portal Edge Function (service role) calls the client functions; the
-- admin list is for signed-in admins. Named fields only: risk, source of funds, turnover, remarks, received_by,
-- reference_note, import_row_id, approval fields, commission, staff names and storage paths never leave here.
-- Run after Client Base 003 and Banking Base. Idempotent.
-- =====================================================================

-- A client's request to change one field of their record. Created here because the SQL below reads it; the
-- functions that write to it come in 002. Staff see it through functions, never directly.
create table if not exists public.client_portal_change_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.client_portal_accounts(id) on delete cascade,
  field_key text not null,
  old_value text,
  new_value text not null,
  status text not null default 'pending' check (status in ('pending', 'in_review', 'validated', 'rejected', 'superseded')),
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);
-- one open request per field per client
create unique index if not exists client_portal_change_requests_open
  on public.client_portal_change_requests (account_id, field_key) where status in ('pending', 'in_review');
create index if not exists client_portal_change_requests_account on public.client_portal_change_requests (account_id, created_at desc);
alter table public.client_portal_change_requests enable row level security;
revoke all on public.client_portal_change_requests from anon, public, authenticated;
grant all on public.client_portal_change_requests to service_role;

-- ---- what a client sees ------------------------------------------------------------------------------

-- Existing keys (username, display_name, record, services, master_services, documents) keep their meaning; the rest is new.
create or replace function public.client_portal_me(p_account uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with a as (select * from client_portal_accounts where id = p_account),
  c as (select b.* from banking_clients b join a on a.banking_client_id = b.id),
  k as (select p.* from banking_kyc_profiles p join c on p.client_id = c.id limit 1),
  m as (select x.client_id, x.data, x.legal_name from client_master x
         where x.client_id = coalesce((select client_master_id from a), (select client_master_id from c))),
  -- one row per case: bank, latest Accepted quotation, payment totals, and whether the money side is hidden
  cx as (
    select cs.id, cs.case_ref, cs.account_kind, cs.current_stage, cs.outcome, cs.created_at,
           (select r.bank_name from banking_bank_recommendations br join banking_partners r on r.id = br.bank_id
             where br.case_id = cs.id and br.is_selected) as bank,
           q.total_amount, q.direct_to_bank_total,
           pay.n as payment_rows, pay.paid,
           (cs.is_historical or coalesce(q.is_imported, false)) and pay.n = 0 as hidden
      from c
      join banking_cases cs on cs.client_id = c.id
      left join lateral (select qq.total_amount, qq.direct_to_bank_total, qq.is_imported from banking_quotations qq
                          where qq.case_id = cs.id and qq.status = 'Accepted' order by qq.version desc limit 1) q on true
      cross join lateral (select count(*) as n, coalesce(sum(p.signed_amount), 0) as paid from banking_payments p where p.case_id = cs.id) pay),
  gal as (
    select d.id, 'kyc' as source, d.title, t.doc_name as doc_type, d.created_at::date as doc_date, v.file_name,
           coalesce(t.is_sensitive, false) as sensitive,
           (not coalesce(t.is_sensitive, false)) and nullif(v.storage_path, '') is not null as can_open
      from c
      join banking_documents d on d.client_id = c.id
      join lateral (select vv.file_name, vv.storage_path from banking_document_versions vv where vv.document_id = d.id order by vv.version desc limit 1) v on true
      left join banking_document_types t on t.id = d.document_type_id
     where d.deleted_at is null and not coalesce(t.is_information, false)
    union all
    select g.id, 'generated', g.document_number,
           case g.kind when 'quote' then 'Quotation' when 'letter' then 'Engagement letter' when 'receipt' then 'Receipt' else g.kind end,
           g.created_at::date, g.file_name, false, nullif(g.storage_path, '') is not null
      from c
      join banking_cases cs on cs.client_id = c.id
      join banking_generated_documents g on g.case_id = cs.id)
  select jsonb_build_object(
    'username', (select username from a),
    'display_name', (select display_name from a),
    'record', jsonb_build_object(
      'legal_name', coalesce((select legal_name from k), (select legal_name from m)),
      'trade_name', coalesce((select trade_name from k), (select data->>'Trade Name' from m)),
      'license_number', coalesce((select license_number from k), (select license_number from c), (select data->>'Trade License Number' from m)),
      'license_issue_date', coalesce((select license_issue_date::text from k), (select data->>'License Issue Date' from m)),
      'license_expiry_date', coalesce((select license_expiry_date::text from k), (select data->>'License Expiry Date' from m)),
      'issuing_authority', coalesce((select issuing_authority from k), (select data->>'Jurisdiction' from m)),
      'legal_structure', (select legal_structure from k),
      'business_activity', coalesce((select business_activity from k), (select data->>'Business Activities' from m)),
      'registered_address', coalesce((select registered_address from k), (select data->>'Registered Address' from m)),
      'office_address', coalesce((select office_address from k), (select data->>'Office Address' from m)),
      'vat_trn', coalesce((select vat_trn from k), (select data->>'TRN' from m)),
      'ct_registration_number', (select data->>'CT Registration Number' from m),
      'financial_year_end', (select data->>'Financial Year End' from m),
      'website', coalesce((select website from k), (select data->>'Website' from m)),
      'email', (select company_email from k),
      'phone', (select company_phone from k),
      'company_email', coalesce((select company_email from k), (select data->>'General Email' from m)),
      'company_phone', coalesce((select company_phone from k), (select data->>'General Phone' from m))),
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
       from client_portal_documents d where d.account_id = p_account and d.upload_complete),
    'has_master', exists (select 1 from m),
    -- every case of the client; the account block only for an approved case, with the IBAN cut to its last four
    'banking_services', (select coalesce(jsonb_agg(jsonb_build_object(
        'case_id', x.id, 'case_ref', x.case_ref, 'account_kind', x.account_kind, 'bank', x.bank,
        'current_stage', x.current_stage, 'outcome', x.outcome,
        'account', (select jsonb_build_object('bank', coalesce(pb.bank_name, x.bank), 'account_name', ca.account_name, 'opened_on', ca.opened_on,
                                              'iban_masked', case when nullif(trim(ca.iban), '') is null then null else repeat(chr(8226), 4) || right(regexp_replace(ca.iban, '\s', '', 'g'), 4) end)
                      from banking_client_accounts ca left join banking_partners pb on pb.id = ca.bank_id
                     where ca.case_id = x.id and x.outcome = 'Approved')) order by x.created_at, x.case_ref), '[]'::jsonb)
       from cx x),
    -- money per case; a hidden case (imported or historical with no payment rows) carries nulls from here
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object(
        'case_ref', x.case_ref, 'bank', x.bank, 'hidden', x.hidden,
        'payable', case when x.hidden then null else x.total_amount end,
        'paid', case when x.hidden then null else x.paid end,
        'balance', case when x.hidden then null else x.total_amount - x.paid end,
        'direct_to_bank', case when x.hidden then null else x.direct_to_bank_total end,
        'lines', case when x.hidden then null else (
            select coalesce(jsonb_agg(jsonb_build_object('payment_date', p.payment_date, 'payment_ref', p.payment_ref, 'txn_type', p.txn_type,
                                                         'amount', p.signed_amount, 'payment_method', p.payment_method, 'receipt_number', rc.receipt_number)
                                      order by p.payment_date, p.created_at), '[]'::jsonb)
              from banking_payments p left join banking_receipts rc on rc.payment_id = p.id where p.case_id = x.id) end
      ) order by x.created_at, x.case_ref), '[]'::jsonb)
       from cx x),
    -- only the Client Master columns the tax tracker reads (Client Module/crm/taxLogic.js); no staff names
    'filing_record', (select jsonb_build_object('Client ID', mm.client_id, 'client_id', mm.client_id, 'Client Legal Name', coalesce(nullif(mm.data->>'Client Legal Name', ''), mm.legal_name))
          || coalesce((select jsonb_object_agg(e.key, e.value) from jsonb_each(mm.data) e
                        where e.key = any(array['Client Legal Name', 'Trade Name', 'VAT Registered', 'TRN', 'VAT Return Due Date', 'VAT Filing Frequency',
                          'VAT Tax Period', 'VAT Effective Date', 'VAT Registration Date', 'Corporate Tax Registered', 'CT Registration Number',
                          'CT Return Status', 'CT Return Due Date', 'Financial Year End', 'Financial Year', 'License Expiry Date', 'Renewal Date',
                          'Trade License Number'])), '{}'::jsonb)
         from m mm),
    'gallery', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'source', g.source, 'title', g.title, 'doc_type', g.doc_type, 'doc_date', g.doc_date, 'file_name', g.file_name,
        'sensitive', g.sensitive, 'can_open', g.can_open) order by g.doc_date desc, g.title), '[]'::jsonb)
       from gal g),
    -- the latest request per field that has not been superseded; a note shows only on a rejection
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('field_key', r.field_key, 'new_value', r.new_value, 'status', r.status,
                          'review_note', case when r.status = 'rejected' then r.review_note end) order by r.field_key), '[]'::jsonb)
       from (select distinct on (field_key) field_key, new_value, status, review_note
               from client_portal_change_requests where account_id = p_account and status <> 'superseded'
              order by field_key, created_at desc) r))
$$;

-- The storage path and file name behind one gallery card, or null: not this client's, deleted, sensitive, or no path.
-- The Edge Function signs the link; the browser never sees the path.
create or replace function public.client_portal_gallery_path(p_account uuid, p_source text, p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select r from (
    select jsonb_build_object('storage_path', v.storage_path, 'file_name', v.file_name) as r
      from client_portal_accounts a
      join banking_documents d on d.client_id = a.banking_client_id
      join lateral (select vv.storage_path, vv.file_name from banking_document_versions vv where vv.document_id = d.id order by vv.version desc limit 1) v on true
      left join banking_document_types t on t.id = d.document_type_id
     where p_source = 'kyc' and a.id = p_account and d.id = p_id and d.deleted_at is null
       and not coalesce(t.is_sensitive, false) and not coalesce(t.is_information, false) and nullif(v.storage_path, '') is not null
    union all
    select jsonb_build_object('storage_path', g.storage_path, 'file_name', g.file_name)
      from client_portal_accounts a
      join banking_cases cs on cs.client_id = a.banking_client_id
      join banking_generated_documents g on g.case_id = cs.id
     where p_source = 'generated' and a.id = p_account and g.id = p_id and nullif(g.storage_path, '') is not null
  ) x limit 1
$$;

-- ---- admin: the client list with access, lines, KYC, contact and pending edits ---------------------------

-- Every client (banking clients plus Client Master rows not linked to one) with their access state. Existing columns kept.
create or replace function public.client_portal_admin_clients() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb) from (
    select c.id as banking_client_id, c.client_master_id, c.display_name, c.license_number,
           a.id as account_id, a.username, a.status, a.last_login_at,
           array['Business Banking']::text[] as lines,
           coalesce(k.completion_percent, round((substring(mm.data->>'Onboarding Completion %' from '^\s*([0-9]+(?:\.[0-9]+)?)'))::numeric)::int, 0) as kyc_percent,
           coalesce(k.company_email, mm.data->>'General Email') as email,
           coalesce(k.company_phone, mm.data->>'General Phone') as phone,
           (select count(*) from client_portal_change_requests r where r.account_id = a.id and r.status in ('pending', 'in_review'))::int as pending_edits
      from banking_clients c
      left join client_portal_accounts a on a.banking_client_id = c.id
             or (a.banking_client_id is null and a.client_master_id = c.client_master_id)
      left join banking_kyc_profiles k on k.client_id = c.id
      left join client_master mm on mm.client_id = c.client_master_id
    union all
    select null, m.client_id, coalesce(m.legal_name, m.client_id), m.data->>'Trade License Number',
           a.id, a.username, a.status, a.last_login_at,
           '{}'::text[],
           coalesce(round((substring(m.data->>'Onboarding Completion %' from '^\s*([0-9]+(?:\.[0-9]+)?)'))::numeric)::int, 0),
           m.data->>'General Email', m.data->>'General Phone',
           (select count(*) from client_portal_change_requests r where r.account_id = a.id and r.status in ('pending', 'in_review'))::int
      from client_master m
      left join client_portal_accounts a on a.client_master_id = m.client_id
     where not exists (select 1 from banking_clients c where c.client_master_id = m.client_id)
  ) t);
end $$;

-- ---- execute rights: Supabase grants new functions to everyone, so name them explicitly ----------------

do $$
declare f text;
begin
  foreach f in array array['client_portal_me(uuid)', 'client_portal_gallery_path(uuid, text, uuid)', 'client_portal_admin_clients()']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  grant execute on function public.client_portal_admin_clients() to authenticated;
end $$;
