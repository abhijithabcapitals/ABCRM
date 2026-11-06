-- Phase 7: client relationship rules. Multiple pending services is on. The others start off, because the contact log
-- has no history yet, so they would wrongly report every client. An admin turns them on in Settings when it has data.
insert into public.alert_settings (key, value) values ('contact_gap_days', '90'), ('inactive_days', '180') on conflict (key) do nothing;

insert into public.alert_rules (code, category, department, title_template, action_template, steps, enabled) values
  ('multiple_services', 'Client Activity', 'Business Setup', 'Multiple pending services: {subject}', 'Check these services together with the client.', '[{"days":0,"priority":"Normal"}]', true),
  ('client_not_contacted', 'Client Activity', 'Business Setup', 'Not contacted recently: {subject}', 'Contact the client and log it.', '[{"days":0,"priority":"Medium"}]', false),
  ('client_inactive', 'Client Activity', 'Business Setup', 'Client inactive: {subject}', 'Check whether this client still needs us.', '[{"days":0,"priority":"Medium"}]', false),
  ('company_anniversary', 'Client Activity', 'Business Setup', 'Company anniversary: {subject}', 'Consider a note to the client. Based on the licence issue date, which may differ from incorporation.', '[{"days":7,"priority":"Normal"}]', false)
on conflict (code) do nothing;

create or replace function public.alert_setting_int(p_key text, p_default int) returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::int from alert_settings where key = p_key), p_default)
$$;

-- Imported Visa Registration rows and historical rows do not count as pending work.
create or replace function public.alert_rule_multiple_services() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'multiservices:' || s.client_id, s.client_id, m.legal_name || ' (' || count(*) || ')', null::text, (now() at time zone 'Asia/Dubai')::date,
         alert_owner(s.client_id, 'Business Setup'), null::uuid[], 'client_master', s.client_id, null::uuid, null::text
  from business_setup_services s join client_master m on m.client_id = s.client_id
  where s.status not in ('Completed', 'Cancelled') and not s.historical and s.name is distinct from 'Visa Registration'
  group by s.client_id, m.legal_name
  having count(*) >= 2
$$;

-- Only clients with a logged contact count, so an empty log reports nobody. Closed clients are left out.
create or replace function public.alert_contact_gap(p_rule text, p_days int) returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select p_rule || ':' || c.client_id, c.client_id, m.legal_name, null::text, (now() at time zone 'Asia/Dubai')::date,
         alert_owner(c.client_id, 'Business Setup'), null::uuid[], 'client_contacts', c.client_id, null::uuid, null::text
  from (select client_id, max(contacted_on) as last_on from client_contacts group by client_id) c
  join client_master m on m.client_id = c.client_id
  left join business_setup_kyc_profiles k on k.client_id = c.client_id
  where c.last_on < (now() at time zone 'Asia/Dubai')::date - p_days
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_client_not_contacted() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$ select * from alert_contact_gap('notcontacted', alert_setting_int('contact_gap_days', 90)) $$;

create or replace function public.alert_rule_client_inactive() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$ select * from alert_contact_gap('inactive', alert_setting_int('inactive_days', 180)) $$;

create or replace function public.alert_rule_company_anniversary() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  with t as (select (now() at time zone 'Asia/Dubai')::date as d)
  select 'anniversary:' || m.client_id || ':' || a.next_on, m.client_id, m.legal_name, null::text, a.next_on,
         alert_owner(m.client_id, 'Business Setup'), null::uuid[], 'client_master', m.client_id, null::uuid, null::text
  from client_master m
  left join business_setup_kyc_profiles k on k.client_id = m.client_id
  cross join t
  cross join lateral (select business_setup_parse_date(m.data ->> 'License Issue Date') as issued) i
  cross join lateral (
    select case when make_date(extract(year from t.d)::int, extract(month from i.issued)::int, least(extract(day from i.issued)::int, 28)) >= t.d
                then make_date(extract(year from t.d)::int, extract(month from i.issued)::int, least(extract(day from i.issued)::int, 28))
                else make_date(extract(year from t.d)::int + 1, extract(month from i.issued)::int, least(extract(day from i.issued)::int, 28)) end as next_on) a
  where i.issued is not null and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

revoke all on function public.alert_setting_int(text, int), public.alert_rule_multiple_services(), public.alert_contact_gap(text, int),
  public.alert_rule_client_not_contacted(), public.alert_rule_client_inactive(), public.alert_rule_company_anniversary() from public, anon, authenticated;
