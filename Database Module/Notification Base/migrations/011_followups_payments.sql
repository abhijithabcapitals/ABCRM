-- Phase 4: contact log, document requests, follow-up and payment rules, and items staff log by hand.
-- Nothing here contacts a client. Contact Client and Request Documents only record what a person did.
insert into public.alert_settings (key, value) values ('payment_terms_days', '30') on conflict (key) do nothing;

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master (client_id),
  channel text not null check (channel in ('Email', 'Call', 'WhatsApp', 'Meeting', 'Other')),
  note text,
  contacted_on date not null default ((now() at time zone 'Asia/Dubai')::date),
  follow_up_on date,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index if not exists client_contacts_client_idx on public.client_contacts (client_id, contacted_on desc, created_at desc);

create table if not exists public.client_document_requests (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master (client_id),
  what text not null,
  requested_on date not null default ((now() at time zone 'Asia/Dubai')::date),
  due_on date not null,
  status text not null default 'Open' check (status in ('Open', 'Answered', 'Closed')),
  answered_on date,
  note text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles (id) on delete set null
);
create index if not exists client_document_requests_open_idx on public.client_document_requests (status, due_on);

alter table public.client_contacts enable row level security;
alter table public.client_document_requests enable row level security;
revoke all on public.client_contacts, public.client_document_requests from anon, authenticated;

create or replace function public.client_contact_log(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_on date; v_follow date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a contact.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  begin
    v_on := coalesce(nullif(p->>'contacted_on', '')::date, (now() at time zone 'Asia/Dubai')::date);
    v_follow := nullif(p->>'follow_up_on', '')::date;
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  if v_follow is not null and v_follow < v_on then raise exception 'The follow-up date is before the contact date.'; end if;
  insert into client_contacts (client_id, channel, note, contacted_on, follow_up_on, created_by)
  values (v_client, coalesce(nullif(p->>'channel', ''), 'Other'), nullif(btrim(p->>'note'), ''), v_on, v_follow, auth.uid())
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.client_document_request(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_client text := nullif(btrim(p->>'client_id'), ''); v_what text := nullif(btrim(p->>'what'), ''); v_due date;
begin
  if auth.uid() is null then raise exception 'Sign in to log a request.'; end if;
  if v_client is null or not exists (select 1 from client_master where client_id = v_client) then raise exception 'Unknown client.'; end if;
  if v_what is null then raise exception 'Say which documents were requested.'; end if;
  begin
    v_due := coalesce(nullif(p->>'due_on', '')::date, (now() at time zone 'Asia/Dubai')::date + 7);
  exception when invalid_datetime_format or datetime_field_overflow then raise exception 'Dates must be real dates, written YYYY-MM-DD.'; end;
  insert into client_document_requests (client_id, what, due_on, created_by) values (v_client, v_what, v_due, auth.uid()) returning id into v_id;
  return v_id;
end $$;

create or replace function public.client_document_answered(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in to update a request.'; end if;
  update client_document_requests set status = 'Answered', answered_on = (now() at time zone 'Asia/Dubai')::date, note = nullif(btrim(p_note), '')
  where id = p_id and status = 'Open';
  if not found then raise exception 'That request is not open.'; end if;
end $$;

-- What a client's page shows: latest contacts and open requests.
create or replace function public.client_work_list(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'Sign in first.'; end if;
  return jsonb_build_object(
    'contacts', coalesce((select jsonb_agg(x) from (select c.id, c.channel, c.note, c.contacted_on, c.follow_up_on, p.full_name as by_name from client_contacts c left join profiles p on p.id = c.created_by
                          where c.client_id = p_client order by c.contacted_on desc, c.created_at desc limit 20) x), '[]'::jsonb),
    'requests', coalesce((select jsonb_agg(x) from (select r.id, r.what, r.requested_on, r.due_on, r.status from client_document_requests r
                          where r.client_id = p_client and r.status = 'Open' order by r.due_on limit 20) x), '[]'::jsonb));
end $$;

-- Items only a person can know. One hidden rule per category, off, because the scan does not raise them.
create or replace function public.alert_manual_types() returns jsonb
language sql immutable security definer set search_path = public, pg_temp as $$
  select '[{"type":"Complaint","rule":"manual_client_activity","priority":"High"},
           {"type":"Service dissatisfaction","rule":"manual_client_activity","priority":"High"},
           {"type":"Service opportunity","rule":"manual_client_activity","priority":"Normal"},
           {"type":"New employee visa requirement","rule":"manual_visa","priority":"Medium"},
           {"type":"Client has not responded","rule":"manual_followups","priority":"Medium"},
           {"type":"License activity mismatch","rule":"manual_licence","priority":"Medium"},
           {"type":"Corporate register update required","rule":"manual_ubo_aml","priority":"Medium"},
           {"type":"VAT payment pending","rule":"manual_tax","priority":"High"},
           {"type":"Tax documents pending","rule":"manual_tax","priority":"Medium"},
           {"type":"Audit documents pending","rule":"manual_tax","priority":"Medium"},
           {"type":"Financial statements pending","rule":"manual_tax","priority":"Medium"}]'::jsonb
$$;

insert into public.alert_rules (code, category, department, title_template, action_template, steps, enabled) values
  ('manual_client_activity', 'Client Activity', 'Business Setup', '{subject}', 'Follow this up and resolve it.', '[]', false),
  ('manual_visa', 'Visa & Emirates ID', 'Business Setup', '{subject}', 'Follow this up and resolve it.', '[]', false),
  ('manual_followups', 'Follow-ups', 'Business Setup', '{subject}', 'Follow this up and resolve it.', '[]', false),
  ('manual_licence', 'Licence', 'Business Setup', '{subject}', 'Follow this up and resolve it.', '[]', false),
  ('manual_ubo_aml', 'UBO & AML', 'Business Setup', '{subject}', 'Follow this up and resolve it.', '[]', false),
  ('manual_tax', 'Tax', 'Tax Compliance', '{subject}', 'Follow this up and resolve it.', '[]', false)
on conflict (code) do nothing;

create or replace function public.alert_manual_raise(p_type text, p_client text, p_detail text default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_t jsonb; v_name text; v_dept text; v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log an item.'; end if;
  select e into v_t from jsonb_array_elements(alert_manual_types()) e where e->>'type' = p_type;
  if v_t is null then raise exception 'Unknown item type.'; end if;
  select legal_name into v_name from client_master where client_id = p_client;
  if v_name is null then raise exception 'Unknown client.'; end if;
  select department into v_dept from alert_rules where code = v_t->>'rule';
  v_id := alert_raise(v_t->>'rule', 'manual:' || gen_random_uuid(), p_client, p_type || ' - ' || v_name, v_dept,
                      coalesce(p_due, (now() at time zone 'Asia/Dubai')::date + 7), 0, v_t->>'priority',
                      coalesce(alert_owner(p_client, v_dept), auth.uid()), 'client_master', p_client, null, nullif(btrim(p_detail), ''));
  return v_id;
end $$;

-- Rules. "Done" statuses match the job rule in 002.
insert into public.alert_rules (code, category, department, title_template, action_template, steps) values
  ('contact_followup', 'Follow-ups', 'Business Setup', 'Follow-up due: {subject}', 'Contact the client and log it.', '[{"days":1,"priority":"Medium"},{"days":0,"priority":"Medium"},{"days":-1,"priority":"High"}]'),
  ('job_followup', 'Follow-ups', 'Accounting', 'Follow-up due: {subject}', 'Contact the client and log it.', '[{"days":1,"priority":"Medium"},{"days":0,"priority":"Medium"},{"days":-1,"priority":"High"}]'),
  ('document_request', 'Client Documents', 'Business Setup', 'Documents pending: {subject}', 'Chase the client for these documents, then mark them received.', '[{"days":1,"priority":"Medium"},{"days":0,"priority":"Medium"},{"days":-1,"priority":"High"}]'),
  ('job_payment_due', 'Payments', 'Accounting', 'Payment overdue: {subject}', 'Chase this payment and record it when received.', '[{"days":7,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"}]'),
  ('setup_invoice_due', 'Payments', 'Business Setup', 'Payment overdue: {subject}', 'Chase this payment and record it when received.', '[{"days":7,"priority":"Medium"},{"days":0,"priority":"High"},{"days":-1,"priority":"High"}]')
on conflict (code) do nothing;

create or replace function public.alert_payment_terms() returns int
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (value #>> '{}')::int from alert_settings where key = 'payment_terms_days'), 30)
$$;

-- Only a client's newest contact counts: logging a later contact replaces the earlier follow-up.
create or replace function public.alert_rule_contact_followup() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'contact:' || c.id || ':' || coalesce(c.follow_up_on::text, ''), c.client_id, m.legal_name, null::text, c.follow_up_on,
         coalesce(alert_owner(c.client_id, 'Business Setup'), c.created_by), null::uuid[], 'client_contacts', c.id::text, null::uuid, null::text
  from (select distinct on (client_id) * from client_contacts order by client_id, contacted_on desc, created_at desc) c
  join client_master m on m.client_id = c.client_id
$$;

create or replace function public.alert_rule_job_followup() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'jobfollowup:' || j.id || ':' || coalesce(j.next_follow_up_on::text, ''), j.client_id, concat_ws(' - ', j.service_name, j.client_name),
         coalesce(j.service_department, 'Accounting'), j.next_follow_up_on,
         coalesce(v.ids[1], alert_owner(j.client_id, coalesce(j.service_department, 'Accounting'))), case when cardinality(v.ids) > 1 then v.ids[2:] end,
         'accounting_jobs', j.id::text, null::uuid, null::text
  from accounting_job_list j
  cross join lateral (select array(select u.uid from unnest(j.assignee_ids) with ordinality as u(uid, ord) join profiles p on p.id = u.uid order by u.ord) as ids) v
  where j.work_status not in ('Completed', 'Client Cancelled')
$$;

create or replace function public.alert_rule_document_request() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'docrequest:' || r.id || ':' || r.due_on, r.client_id, r.what || ' - ' || m.legal_name, null::text, r.due_on,
         coalesce(alert_owner(r.client_id, 'Business Setup'), r.created_by), null::uuid[], 'client_document_requests', r.id::text, null::uuid, null::text
  from client_document_requests r join client_master m on m.client_id = r.client_id
  where r.status = 'Open'
$$;

create or replace function public.alert_rule_job_payment_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'jobpayment:' || j.id || ':' || coalesce((j.invoice_date + alert_payment_terms())::text, ''), j.client_id, concat_ws(' - ', j.service_name, j.client_name),
         coalesce(j.service_department, 'Accounting'), j.invoice_date + alert_payment_terms(),
         coalesce(v.ids[1], alert_owner(j.client_id, coalesce(j.service_department, 'Accounting'))), case when cardinality(v.ids) > 1 then v.ids[2:] end,
         'accounting_jobs', j.id::text, null::uuid, null::text
  from accounting_job_list j
  cross join lateral (select array(select u.uid from unnest(j.assignee_ids) with ordinality as u(uid, ord) join profiles p on p.id = u.uid order by u.ord) as ids) v
  where coalesce(j.balance, 0) > 0
$$;

-- An invoice is overdue when its quote's invoices exceed what has been paid on that quote.
create or replace function public.alert_rule_setup_invoice_due() returns setof public.alert_candidate
language sql stable security definer set search_path = public, pg_temp as $$
  select 'setupinvoice:' || i.id || ':' || (i.issued_on + alert_payment_terms()), i.client_id, concat_ws(' - ', i.invoice_number, m.legal_name), null::text,
         i.issued_on + alert_payment_terms(), alert_owner(i.client_id, 'Business Setup'), null::uuid[], 'business_setup_invoices', i.id::text, null::uuid, null::text
  from business_setup_invoices i join client_master m on m.client_id = i.client_id
  where i.issued_on is not null and i.quote_id is not null
    and (select coalesce(sum(x.amount), 0) from business_setup_invoices x where x.quote_id = i.quote_id) > business_setup_net_paid(i.quote_id)
$$;

revoke all on function public.client_contact_log(jsonb), public.client_document_request(jsonb), public.client_document_answered(uuid, text), public.client_work_list(text),
  public.alert_manual_types(), public.alert_manual_raise(text, text, text, date), public.alert_payment_terms(),
  public.alert_rule_contact_followup(), public.alert_rule_job_followup(), public.alert_rule_document_request(), public.alert_rule_job_payment_due(), public.alert_rule_setup_invoice_due()
  from public, anon, authenticated;
grant execute on function public.client_contact_log(jsonb), public.client_document_request(jsonb), public.client_document_answered(uuid, text), public.client_work_list(text),
  public.alert_manual_types(), public.alert_manual_raise(text, text, text, date) to authenticated;
