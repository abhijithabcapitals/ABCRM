-- All Clients: the Accounting line also counts clients whose Client Master record lists Bookkeeping.
-- Rollback: run 004_accounting_line.sql again.

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
    select cl.id, 'Accounting'::text, null::text, null::timestamptz, null::text
      from client_master m
      join banking_clients cl on cl.client_master_id = m.client_id
     where client_master_plain(m.data ->> 'Services Provided') ~* '\y(Accounting|Bookkeeping)\y'
        or exists (select 1 from accounting_jobs j where j.client_id = m.client_id)
  )
  select coalesce(jsonb_agg(row_to_json(t) order by t.display_name), '[]'::jsonb) from (
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
$function$;
