-- =====================================================================
-- Business Setup Base - workspace reads, tasks, files, expiries        008
-- =====================================================================
-- Re-runnable. Runs after 001 to 007. What the Business Setup pages read, plus visas, tasks and uploaded files.
-- Re-running Client Base 001 resets client_base_list, so re-running it means re-running this file.
-- =====================================================================

-- ── Visas ────────────────────────────────────────────────────────────
create table if not exists public.business_setup_visas (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  person_name text not null,
  occupation text,
  issue_date date,
  expiry_date date,
  status text,
  source text,
  source_key text unique,                    -- the old record it came from, so an import can run again
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists business_setup_visas_client_idx on public.business_setup_visas (client_id);
create index if not exists business_setup_visas_expiry_idx on public.business_setup_visas (expiry_date);
drop trigger if exists business_setup_visas_touch on public.business_setup_visas;
create trigger business_setup_visas_touch before insert or update on public.business_setup_visas
  for each row execute function public.business_setup_touch();
alter table public.business_setup_visas enable row level security;
drop policy if exists business_setup_visas_read on public.business_setup_visas;
create policy business_setup_visas_read on public.business_setup_visas for select to authenticated using (public.business_setup_can('setup.access'));
revoke all on public.business_setup_visas from anon, authenticated;
grant select on public.business_setup_visas to authenticated;

create or replace function public.business_setup_visa_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_name text := nullif(btrim(coalesce(p ->> 'person_name', '')), ''); v_client text := p ->> 'client_id';
begin
  perform business_setup_require('setup.services.manage');
  if v_name is null then raise exception 'Enter the person''s name'; end if;
  if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Client % not found', v_client; end if;
  if v_id is null then
    insert into business_setup_visas (client_id, person_name, occupation, issue_date, expiry_date, status, source)
    values (v_client, v_name, nullif(p ->> 'occupation', ''), nullif(p ->> 'issue_date', '')::date, nullif(p ->> 'expiry_date', '')::date, nullif(p ->> 'status', ''), 'manual')
    returning id into v_id;
  else
    update business_setup_visas set client_id = v_client, person_name = v_name, occupation = nullif(p ->> 'occupation', ''),
           issue_date = nullif(p ->> 'issue_date', '')::date, expiry_date = nullif(p ->> 'expiry_date', '')::date, status = nullif(p ->> 'status', '')
     where id = v_id;
    if not found then raise exception 'Visa record not found'; end if;
  end if;
  perform business_setup_audit('business_setup_visas', v_id::text, 'visa_save', null, jsonb_build_object('client_id', v_client, 'person_name', v_name, 'expiry_date', p ->> 'expiry_date'));
  return v_id;
end $$;

-- ── File storage ─────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-setup-documents', 'business-setup-documents', false, 26214400, array[
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/tiff',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = false;
drop policy if exists business_setup_docs_read on storage.objects;
create policy business_setup_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'business-setup-documents' and public.business_setup_can('setup.access'));
drop policy if exists business_setup_docs_insert on storage.objects;
create policy business_setup_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'business-setup-documents' and (public.business_setup_can('setup.services.manage') or public.business_setup_can('setup.kyc.manage')));
-- no update or delete policy: stored files are never replaced or removed from the app

create or replace function public.business_setup_document_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid; v_client text := p ->> 'client_id'; v_service uuid := nullif(p ->> 'service_id', '')::uuid;
  v_file text := nullif(btrim(coalesce(p ->> 'file_name', '')), ''); v_path text := nullif(btrim(coalesce(p ->> 'storage_path', '')), '');
begin
  if not (business_setup_can('setup.services.manage') or business_setup_can('setup.kyc.manage')) then
    raise exception 'You do not have permission to add a document';
  end if;
  if v_file is null or v_path is null then raise exception 'A file name and storage path are required'; end if;
  if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Client % not found', v_client; end if;
  if v_service is not null and not exists (select 1 from business_setup_services where id = v_service and client_id = v_client) then
    raise exception 'That service does not belong to this client';
  end if;
  insert into business_setup_documents (client_id, kind, file_name, storage_path, note, service_id, is_output, client_visible)
  values (v_client, nullif(p ->> 'kind', ''), v_file, v_path, nullif(p ->> 'note', ''), v_service,
          coalesce((p ->> 'is_output')::boolean, false), coalesce((p ->> 'client_visible')::boolean, false))
  returning id into v_id;
  perform business_setup_audit('business_setup_documents', v_id::text, 'document_add', null, jsonb_build_object('client_id', v_client, 'kind', p ->> 'kind', 'file_name', v_file));
  return v_id;
end $$;

-- ── Tasks ────────────────────────────────────────────────────────────
create or replace function public.business_setup_task_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid; v_client text := p ->> 'client_id'; v_title text := nullif(btrim(coalesce(p ->> 'title', '')), '');
  v_status text := coalesce(nullif(p ->> 'status', ''), 'Open');
begin
  perform business_setup_require('setup.services.manage');
  if v_title is null then raise exception 'Enter a title for the task'; end if;
  if v_status not in ('Open', 'Done', 'Cancelled') then raise exception 'Unknown task status'; end if;
  if not exists (select 1 from client_master where client_id = v_client) then raise exception 'Client % not found', v_client; end if;
  if v_id is null then
    insert into business_setup_tasks (client_id, title, owner_id, due_date, status)
    values (v_client, v_title, nullif(p ->> 'owner_id', '')::uuid, nullif(p ->> 'due_date', '')::date, v_status) returning id into v_id;
  else
    update business_setup_tasks set client_id = v_client, title = v_title, owner_id = nullif(p ->> 'owner_id', '')::uuid,
           due_date = nullif(p ->> 'due_date', '')::date, status = v_status where id = v_id;
    if not found then raise exception 'Task not found'; end if;
  end if;
  perform business_setup_audit('business_setup_tasks', v_id::text, 'task_save', null, jsonb_build_object('client_id', v_client, 'title', v_title, 'status', v_status));
  return v_id;
end $$;

-- ── Expiries ─────────────────────────────────────────────────────────
-- Client Master stores dates as DD/MM/YYYY text. Anything else reads as no date, and never raises.
create or replace function public.business_setup_parse_date(p text) returns date
language plpgsql immutable set search_path = public, pg_temp as $$
begin
  if p is null or p !~ '^\d{1,2}/\d{1,2}/\d{4}$' then return null; end if;
  return to_date(p, 'DD/MM/YYYY');
exception when others then
  return null;
end $$;

-- Licences and visas with a date on file. Ejari has no date field, so it does not appear here.
create or replace function public.business_setup_expiries(p_days int default 90) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_today date := (now() at time zone 'Asia/Dubai')::date;
begin
  perform business_setup_require('setup.access');
  return (
    select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'client_id', e.client_id, 'client_name', e.client_name, 'label', e.label, 'date', e.d,
             'state', case when e.d < v_today then 'Past date' else 'Upcoming' end) order by e.d, e.label), '[]'::jsonb)
      from (
        select 'Licence'::text as kind, m.client_id, m.legal_name as client_name, m.legal_name as label,
               coalesce(k.licence_expiry, business_setup_parse_date(m.data ->> 'License Expiry Date')) as d
          from business_setup_kyc_profiles k join client_master m on m.client_id = k.client_id
         where coalesce(k.client_status, '') !~* 'liquidated|cancel'
        union all
        select 'Visa', v.client_id, m.legal_name, v.person_name, v.expiry_date
          from business_setup_visas v join client_master m on m.client_id = v.client_id
         where coalesce(v.status, '') !~* 'cancel|resign'
      ) e
     where e.d is not null and e.d <= v_today + p_days);
end $$;

-- ── Client list ──────────────────────────────────────────────────────
-- Business Setup clients: a KYC profile, a service, or a quote linked to the client.
create or replace function public.business_setup_client_list() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.access');
  return (
    with ids as (
      select client_id from business_setup_kyc_profiles
      union select client_id from business_setup_services
      union select client_id from hub_documents where department = 'Business Setup' and doc_type = 'quote' and client_id is not null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'client_id', m.client_id, 'legal_name', m.legal_name, 'client_status', k.client_status, 'kyc_state', k.kyc_state,
             'active_services', (select count(*) from business_setup_services s where s.client_id = m.client_id and s.status not in ('Completed', 'Cancelled') and not s.historical),
             'balance', (select coalesce(sum(q.total_amount - business_setup_net_paid(q.id)), 0) from hub_documents q
                          where q.client_id = m.client_id and q.doc_type = 'quote' and q.department = 'Business Setup' and q.status = 'accepted'),
             'missing_contact', client_master_plain(m.data ->> 'General Email') is null or client_master_plain(m.data ->> 'General Phone') is null)
             order by m.legal_name), '[]'::jsonb)
      from ids join client_master m on m.client_id = ids.client_id
      left join business_setup_kyc_profiles k on k.client_id = m.client_id);
end $$;

-- ── One client's workspace ───────────────────────────────────────────
-- Partner identity values need setup.kyc.sensitive. Client Master details need kyc.view. History needs setup.audit.view.
create or replace function public.business_setup_workspace(p_client text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare m client_master; k business_setup_kyc_profiles; v_sensitive boolean;
begin
  perform business_setup_require('setup.access');
  select * into m from client_master where client_id = p_client;
  if m.client_id is null then raise exception 'Client % not found', p_client; end if;
  select * into k from business_setup_kyc_profiles where client_id = p_client;
  v_sensitive := business_setup_can('setup.kyc.sensitive');
  return jsonb_build_object(
    'client', jsonb_build_object('client_id', m.client_id, 'legal_name', m.legal_name, 'version', m.version,
       'email', client_master_plain(m.data ->> 'General Email'), 'phone', client_master_plain(m.data ->> 'General Phone'),
       'data', case when business_setup_can('kyc.view') then m.data end),
    'kyc', to_jsonb(k),
    'kyc_status', business_setup_kyc_status(p_client),
    'partners', (select coalesce(jsonb_agg(case when v_sensitive then to_jsonb(p) else to_jsonb(p) - array['passport_number', 'passport_expiry', 'emirates_id', 'details'] end order by p.full_name), '[]'::jsonb)
                   from business_setup_kyc_partners p where p.kyc_id = k.id and p.deleted_at is null),
    'services', (select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at, s.name), '[]'::jsonb) from business_setup_services s where s.client_id = p_client),
    'quotes', (select coalesce(jsonb_agg(to_jsonb(q) || jsonb_build_object('balance', jsonb_build_object('total', q.total_amount, 'net_paid', business_setup_net_paid(q.id), 'outstanding', q.total_amount - business_setup_net_paid(q.id)))
                 order by q.created_at desc), '[]'::jsonb)
                 from hub_documents q where q.client_id = p_client and q.doc_type = 'quote' and q.department = 'Business Setup'),
    'letters', (select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at desc), '[]'::jsonb)
                  from hub_documents l join hub_documents q on q.id = l.parent_id
                 where q.client_id = p_client and l.doc_type = 'letter' and l.department = 'Business Setup'),
    'payments', (select coalesce(jsonb_agg(to_jsonb(y) || jsonb_build_object('receipt_id', r.id, 'receipt_number', r.receipt_number, 'receipt_path', r.storage_path) order by y.created_at desc), '[]'::jsonb)
                   from business_setup_payments y left join business_setup_receipts r on r.payment_id = y.id where y.client_id = p_client),
    'documents', (select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb) from business_setup_documents d where d.client_id = p_client),
    'tasks', (select coalesce(jsonb_agg(to_jsonb(t) order by t.due_date nulls last, t.created_at), '[]'::jsonb) from business_setup_tasks t where t.client_id = p_client),
    'visas', (select coalesce(jsonb_agg(to_jsonb(v) order by v.expiry_date nulls last, v.person_name), '[]'::jsonb) from business_setup_visas v where v.client_id = p_client),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('service_id', h.service_id, 'from_status', h.from_status, 'to_status', h.to_status, 'note', h.note, 'at', h.changed_at) order by h.changed_at desc), '[]'::jsonb)
                  from business_setup_service_history h join business_setup_services s on s.id = h.service_id where s.client_id = p_client),
    'activity', case when business_setup_can('setup.audit.view') then
                  (select coalesce(jsonb_agg(jsonb_build_object('action', a.action, 'at', a.occurred_at, 'actor', a.actor, 'detail', a.new_data) order by a.occurred_at desc), '[]'::jsonb)
                     from business_setup_audit_log a where a.new_data ->> 'client_id' = p_client) else '[]'::jsonb end);
end $$;

-- ── Dashboard ────────────────────────────────────────────────────────
-- Migrations 009 and 011 replace these two with the real counts.
create or replace function public.business_setup_dash_forms() returns int
language sql stable security definer set search_path = public, pg_temp as $$ select 0 $$;
create or replace function public.business_setup_dash_handover() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$ select '{"ready_for_accounts":0,"reverted_by_accounts":0}'::jsonb $$;

create or replace function public.business_setup_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_exp jsonb;
begin
  perform business_setup_require('setup.access');
  v_exp := business_setup_expiries();
  return jsonb_build_object(
    'forms_waiting', business_setup_dash_forms(),
    'open_quotes', (select count(*) from hub_documents where department = 'Business Setup' and doc_type = 'quote' and status = 'issued'),
    'accepted_without_letter', (select count(*) from hub_documents q where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'
                                   and not exists (select 1 from hub_documents l where l.parent_id = q.id and l.doc_type = 'letter')),
    'outstanding', (select coalesce(sum(greatest(q.total_amount - business_setup_net_paid(q.id), 0)), 0) from hub_documents q
                     where q.department = 'Business Setup' and q.doc_type = 'quote' and q.status = 'accepted'),
    'active_services', (select count(*) from business_setup_services where status not in ('Completed', 'Cancelled') and not historical),
    'expiries', jsonb_build_object('upcoming', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Upcoming'),
                                   'past', (select count(*) from jsonb_array_elements(v_exp) e where e ->> 'state' = 'Past date'))
  ) || business_setup_dash_handover();
end $$;

-- ── The all-clients list gains the Business Setup line ───────────────
-- Same as Client Base 001, with Business Setup services of clients linked through client_master_id.
create or replace function public.client_base_list() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
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
$$;

revoke all on function public.business_setup_visa_save(jsonb), public.business_setup_document_add(jsonb), public.business_setup_task_save(jsonb),
  public.business_setup_parse_date(text), public.business_setup_expiries(int), public.business_setup_client_list(), public.business_setup_workspace(text),
  public.business_setup_dash_forms(), public.business_setup_dash_handover(), public.business_setup_dashboard(), public.client_base_list() from public, anon, authenticated;
grant execute on function public.business_setup_visa_save(jsonb), public.business_setup_document_add(jsonb), public.business_setup_task_save(jsonb),
  public.business_setup_expiries(int), public.business_setup_client_list(), public.business_setup_workspace(text),
  public.business_setup_dashboard(), public.client_base_list() to authenticated;
