-- All Clients with every line: Business Setup from 005_business_setup_line.sql and Bookkeeping from 005_bookkeeping_line.sql.
-- Both 005 files replace the same function, so this file is the current definition. Add new lines here, not to a 005.
-- Rollback: run 004_accounting_line.sql again, which removes both.

create or replace function public.client_base_list()
returns jsonb
language sql
stable security definer
set search_path to 'public', 'pg_temp'
as $function$
  with lines as (
    select c.client_id, 'Business Banking'::text as line, b.bank_name as detail, c.created_at, c.accounts_status
      from banking_cases c
      join banking_bank_recommendations r on r.case_id = c.id and r.is_selected
      join banking_partners b on b.id = r.bank_id
     where c.is_historical or (select coalesce(sum(p.signed_amount), 0) from banking_payments p where p.case_id = c.id) > 0
    union all
    select cl.id, 'Business Setup'::text, null::text, s.created_at, null::text
      from business_setup_services s
      join banking_clients cl on cl.client_master_id = s.client_id
     where s.status <> 'Cancelled'
    union all
    select cl.id, 'Business Setup'::text, null::text, null::timestamptz, null::text
      from business_setup_kyc_profiles k
      join banking_clients cl on cl.client_master_id = k.client_id
    union all
    select cl.id, 'Accounting'::text, null::text, null::timestamptz, null::text
      from client_master m
      join banking_clients cl on cl.client_master_id = m.client_id
     where client_master_plain(m.data ->> 'Services Provided') ~* '\y(Accounting|Bookkeeping)\y'
        or exists (select 1 from accounting_jobs j where j.client_id = m.client_id)
  ), banking_rows as (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as j from (
    select cl.id, cl.display_name, cl.client_type, cl.license_number, cl.client_master_id, cl.link_status,
           (select array_agg(distinct l.line) from lines l where l.client_id = cl.id) as lines,
           (select array_agg(distinct l.detail) filter (where l.detail is not null) from lines l where l.client_id = cl.id) as banks,
           (select min(l.created_at)::date from lines l where l.client_id = cl.id) as client_since,
           (select count(*) from lines l where l.client_id = cl.id) as engagements,
           (select bool_and(l.accounts_status is not distinct from 'Closed') from lines l where l.client_id = cl.id) as all_closed,
           ld.contact_person, ld.nationality, coalesce(k.company_email, ld.email) as email, coalesce(k.company_phone, ld.mobile) as phone,
           k.legal_name, k.trade_name, k.legal_structure, k.business_activity, k.issuing_authority, k.license_expiry_date, k.vat_trn, k.registered_address, k.completion_percent as kyc_percent
      from banking_clients cl
      left join banking_kyc_profiles k on k.client_id = cl.id and banking_can('kyc.view')
      left join lateral (select * from banking_leads l where l.client_id = cl.id order by l.lead_date desc limit 1) ld on banking_can('leads.view')
     where banking_can('cases.view') and exists (select 1 from lines l where l.client_id = cl.id)) t
  ), setup_rows as (
    -- A Business Setup client with no Banking-side row. Its id is the Client Master id. Nothing is added to Banking.
    select coalesce(jsonb_agg(to_jsonb(u)), '[]'::jsonb) as j from (
      select m.client_id as id, m.legal_name as display_name, 'Company'::text as client_type, k.licence_number as license_number, m.client_id as client_master_id,
             'Linked'::text as link_status, array['Business Setup']::text[] as lines, null::text[] as banks, null::date as client_since,
             (select count(*) from business_setup_services s where s.client_id = m.client_id and s.status <> 'Cancelled') as engagements, false as all_closed,
             case when client_master_can('kyc.view') then client_master_plain(split_part(m.data ->> 'Primary Contact', ';', 1)) end as contact_person, null::text as nationality,
             case when client_master_can('kyc.view') then client_master_plain(m.data ->> 'General Email') end as email,
             case when client_master_can('kyc.view') then client_master_plain(m.data ->> 'General Phone') end as phone,
             m.legal_name as legal_name, null::text as trade_name, null::text as legal_structure, k.business_activity, k.jurisdiction as issuing_authority,
             k.licence_expiry as license_expiry_date, null::text as vat_trn, null::text as registered_address, null::numeric as kyc_percent, true as setup_only
        from business_setup_kyc_profiles k
        join client_master m on m.client_id = k.client_id
       where (banking_can('cases.view') or business_setup_can('setup.access'))
         and not exists (select 1 from banking_clients b where b.client_master_id = k.client_id)) u
  )
  select coalesce(jsonb_agg(e order by lower(e ->> 'display_name')), '[]'::jsonb)
    from banking_rows b cross join setup_rows s cross join lateral jsonb_array_elements(b.j || s.j) e
$function$;
