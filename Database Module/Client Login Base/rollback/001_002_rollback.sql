-- ROLLBACK of Client Login Base migrations 001 and 002.
--
-- WARNING: this DELETES the table client_portal_change_requests, so every change a client has asked for
-- and not yet had validated (and the history of decided ones) is lost. Export it first if it matters:
--   select * from public.client_portal_change_requests;
-- Decisions already applied to the client record stay applied; only the request log goes.
--
-- What it does:
--   1. Drops every function the two migrations added (client_change_*, client_changes_*, client_portal_gallery_path).
--   2. Drops client_portal_change_requests.
--   3. Restores client_portal_me and client_portal_admin_clients exactly as Client Base 003 defines them,
--      with the execute rights 003 gives them.
-- It leaves client_portal_documents and every other 003 object alone. Safe to run more than once.
-- Run it before redeploying the earlier client-portal function: the earlier function expects the 003 shapes.

begin;

drop function if exists public.client_changes_decide(uuid, text, text, boolean);
drop function if exists public.client_changes_release(uuid);
drop function if exists public.client_changes_assign(uuid, uuid);
drop function if exists public.client_changes_take(uuid);
drop function if exists public.client_changes_assignees();
drop function if exists public.client_changes_list();
drop function if exists public.client_change_submit(uuid, text, text);
drop function if exists public.client_change_apply(uuid, text, text, uuid);
drop function if exists public.client_change_official(uuid, text);
drop function if exists public.client_change_iso(text);
drop function if exists public.client_change_field(text);
drop function if exists public.client_portal_gallery_path(uuid, text, uuid);

drop table if exists public.client_portal_change_requests;

-- ---- restored from Client Base 003 (verbatim) ----------------------------------------------------

-- Every client (banking clients plus Client Master rows not linked to one) with their access state.
create or replace function public.client_portal_admin_clients() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not client_portal_is_admin() then raise exception 'Admins only.'; end if;
  return (select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb) from (
    select c.id as banking_client_id, c.client_master_id, c.display_name, c.license_number,
           a.id as account_id, a.username, a.status, a.last_login_at
      from banking_clients c
      left join client_portal_accounts a on a.banking_client_id = c.id
             or (a.banking_client_id is null and a.client_master_id = c.client_master_id)
    union all
    select null, m.client_id, coalesce(m.legal_name, m.client_id), m.data->>'Trade License Number',
           a.id, a.username, a.status, a.last_login_at
      from client_master m
      left join client_portal_accounts a on a.client_master_id = m.client_id
     where not exists (select 1 from banking_clients c where c.client_master_id = m.client_id)
  ) t);
end $$;


-- What a client sees. Named fields only: KYC risk, internal notes, fees and staff data never leave here.
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
      'email', (select company_email from k),
      'phone', (select company_phone from k)),
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

-- Execute rights as 003 sets them: both service_role; admin_clients also authenticated (it checks admin inside).
do $$
declare f text;
begin
  foreach f in array array['client_portal_admin_clients()', 'client_portal_me(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  grant execute on function public.client_portal_admin_clients() to authenticated;
end $$;

commit;
