-- Phase 5: UBO, AML and other register review dates, and tax deadlines.
-- Tax dates come from Client Module/crm/taxLogic.js, run by Edge Function alert-tax-scan, so the rules live in one place.
-- With no tax data in the Client Master, this raises nothing: Coverage shows that.
insert into public.alert_rules (code, category, department, title_template, action_template, steps)
select w.code, w.category, w.department, 'Review due: {subject}', 'Complete this review and record the next date.',
       '[{"days":30,"priority":"Medium"},{"days":7,"priority":"High"},{"days":-1,"priority":"High"},{"days":-30,"priority":"Critical"}]'::jsonb
from (values
  ('compliance_ubo_verification', 'UBO & AML', 'Business Setup'),
  ('compliance_aml_risk_assessment', 'UBO & AML', 'Business Setup'),
  ('compliance_kyc_document', 'UBO & AML', 'Business Setup'),
  ('compliance_corporate_register_review', 'UBO & AML', 'Business Setup'),
  ('compliance_regulatory_filing', 'UBO & AML', 'Business Setup'),
  ('compliance_compliance_review', 'UBO & AML', 'Business Setup'),
  ('compliance_tax_residency_certificate', 'Tax', 'Tax Compliance')
) as w(code, category, department)
on conflict (code) do nothing;

-- Review items use their review date, or else their expiry date.
create or replace function public.alert_compliance_review_candidates(p_type text, p_department text) returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'compliance:' || i.id || ':' || coalesce(coalesce(i.next_review_date, i.expiry_date)::text, ''), i.client_id,
         concat_ws(' - ', i.item_type, nullif(btrim(i.person_name), ''), m.legal_name),
         p_department, coalesce(i.next_review_date, i.expiry_date), alert_owner(i.client_id, p_department), null::uuid[],
         'client_compliance_items', i.id::text, null::uuid, null::text
  from client_compliance_items i
  left join client_master m on m.client_id = i.client_id
  left join business_setup_kyc_profiles k on k.client_id = i.client_id
  where i.item_type = p_type and i.status = 'Active'
    and coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

do $$
declare r record;
begin
  for r in select * from (values
    ('compliance_ubo_verification', 'UBO verification', 'Business Setup'), ('compliance_aml_risk_assessment', 'AML risk assessment', 'Business Setup'),
    ('compliance_kyc_document', 'KYC document', 'Business Setup'), ('compliance_corporate_register_review', 'Corporate register review', 'Business Setup'),
    ('compliance_regulatory_filing', 'Regulatory filing', 'Business Setup'), ('compliance_compliance_review', 'Compliance review', 'Business Setup'),
    ('compliance_tax_residency_certificate', 'Tax residency certificate', 'Tax Compliance')) as x(code, item_type, department)
  loop
    execute format($f$create or replace function public.%I() returns setof public.alert_candidate
      language sql stable security definer set search_path = public, pg_temp as $b$select * from public.alert_compliance_review_candidates(%L, %L)$b$ $f$,
      'alert_rule_' || r.code, r.item_type, r.department);
    execute format('revoke all on function public.%I() from public, anon, authenticated', 'alert_rule_' || r.code);
  end loop;
end $$;

-- The latest tax dates, replaced whole by each run of alert-tax-scan.
create table if not exists public.alert_tax_items (
  item_key text primary key,
  client_id text not null,
  title text not null,
  due_date date not null,
  scanned_at timestamptz not null default now()
);
alter table public.alert_tax_items enable row level security;
revoke all on public.alert_tax_items from anon, authenticated;

create or replace function public.alert_tax_ingest(p_items jsonb) returns int
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be a JSON array.'; end if;
  delete from alert_tax_items where true;
  insert into alert_tax_items (item_key, client_id, title, due_date)
  select i->>'item_key', i->>'client_id', i->>'title', (i->>'due_date')::date
  from jsonb_array_elements(p_items) i
  where exists (select 1 from client_master m where m.client_id = i->>'client_id')
  on conflict (item_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

insert into public.alert_rules (code, category, department, title_template, action_template, steps) values
  ('tax_deadline', 'Tax', 'Tax Compliance', 'Tax deadline: {subject}', 'Prepare and file this, or record that it is done.',
   '[{"days":30,"priority":"Medium"},{"days":14,"priority":"High"},{"days":7,"priority":"High"},{"days":-1,"priority":"Critical"}]')
on conflict (code) do nothing;
-- Off until the user chooses: closed companies with a CT registration, for a deregistration review.
insert into public.alert_rules (code, category, department, title_template, action_template, steps, enabled) values
  ('ct_dereg_review', 'Tax', 'Tax Compliance', 'CT deregistration review: {subject}', 'Check whether Corporate Tax deregistration is needed.', '[{"days":0,"priority":"Medium"}]', false)
on conflict (code) do nothing;

create or replace function public.alert_rule_tax_deadline() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'tax:' || t.item_key || ':' || t.due_date, t.client_id, t.title || ' - ' || m.legal_name, null::text, t.due_date,
         alert_owner(t.client_id, 'Tax Compliance'), null::uuid[], 'alert_tax_items', t.item_key, null::uuid, null::text
  from alert_tax_items t join client_master m on m.client_id = t.client_id
  left join business_setup_kyc_profiles k on k.client_id = t.client_id
  where coalesce(k.client_status, '') !~* 'liquidated|cancel|rejected'
$$;

create or replace function public.alert_rule_ct_dereg_review() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'ctdereg:' || k.client_id, k.client_id, m.legal_name, null::text, (now() at time zone 'Asia/Dubai')::date,
         alert_owner(k.client_id, 'Tax Compliance'), null::uuid[], 'business_setup_kyc_profiles', k.client_id, null::uuid, null::text
  from business_setup_kyc_profiles k join client_master m on m.client_id = k.client_id
  where k.client_status ~* 'liquidated|cancel' and k.licence_extras ->> 'ct_reg' = 'Done'
$$;

revoke all on function public.alert_compliance_review_candidates(text, text), public.alert_tax_ingest(jsonb), public.alert_rule_tax_deadline(), public.alert_rule_ct_dereg_review()
  from public, anon, authenticated;
grant execute on function public.alert_tax_ingest(jsonb) to service_role;
