-- =====================================================================
-- Business Setup Base - loading the department's old records           012
-- =====================================================================
-- Re-runnable. Runs after 001 to 011. scripts/legacy_load.py stages rows; a person reads the report and applies.
-- Exact names link. Anything else is held for a person, and a held row never blocks the rest. Existing values in
-- Client Master and KYC are never overwritten: differences are reported. No login is issued and nothing is sent.
-- No client data lives in this file.
-- =====================================================================

alter table public.business_setup_services add column if not exists source_key text;
create unique index if not exists business_setup_services_source_key on public.business_setup_services (source_key) where source_key is not null;

create table if not exists public.business_setup_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null,
  source text not null check (source in ('company', 'visa', 'ejari', 'service', 'quotation')),
  source_key text not null unique,
  name text not null,
  company text,
  payload jsonb not null default '{}',
  match_client text references public.client_master(client_id),
  decision text not null check (decision in ('matched', 'new', 'held', 'skip', 'report', 'applied')),
  reason text,
  decided_by uuid,
  applied_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists business_setup_import_rows_import_idx on public.business_setup_import_rows (import_id, source, decision);
alter table public.business_setup_import_rows enable row level security;
drop policy if exists business_setup_import_rows_read on public.business_setup_import_rows;
create policy business_setup_import_rows_read on public.business_setup_import_rows for select to authenticated using (public.business_setup_can('setup.import.manage'));
revoke all on public.business_setup_import_rows from anon, authenticated;
grant select on public.business_setup_import_rows to authenticated;

create or replace function public.business_setup_name_key(v text) returns text
language sql immutable set search_path = public, pg_catalog as $$ select regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]', '', 'g') $$;

-- The client with exactly this name, when there is exactly one.
create or replace function public.business_setup_import_exact(p_name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select min(client_id) from client_master where business_setup_name_key(legal_name) = business_setup_name_key(p_name) and business_setup_name_key(p_name) <> ''
  having count(*) = 1
$$;

-- A client whose name looks close: same once LLC and the like are removed, or one name starts with the other.
create or replace function public.business_setup_import_near(p_name text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select min(client_id) from client_master m,
         lateral (select client_master_norm_name(p_name) as a, client_master_norm_name(m.legal_name) as b) n
   where n.a <> '' and (n.a = n.b or (length(n.a) >= 6 and n.b like n.a || ' %') or (length(n.b) >= 6 and n.a like n.b || ' %'))
$$;

-- ── Stage ────────────────────────────────────────────────────────────
-- An applied row or a row a person decided stays as it is when the same record is staged again.
create or replace function public.business_setup_import_stage(p_import uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  e jsonb; v_source text; v_key text; v_name text; v_company text; v_client text; v_near text; v_decision text; v_reason text; v_bad jsonb; n int := 0;
begin
  perform business_setup_require('setup.import.manage');
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Rows must be a list'; end if;
  for e in select x from jsonb_array_elements(p_rows) x order by (x ->> 'source' = 'company') desc loop
    v_source := e ->> 'source'; v_key := e ->> 'source_key'; v_name := btrim(coalesce(e ->> 'name', '')); v_company := nullif(btrim(coalesce(e ->> 'company', '')), '');
    if exists (select 1 from business_setup_import_rows r where r.source_key = v_key and (r.decision = 'applied' or r.decided_by is not null)) then continue; end if;
    v_client := null; v_near := null; v_reason := null; v_bad := e -> 'payload' -> 'bad_dates';
    if v_source = 'quotation' then
      v_decision := 'report';
    elsif jsonb_typeof(v_bad) = 'array' and jsonb_array_length(v_bad) > 0 then
      v_decision := 'held'; v_reason := 'Not a real date: ' || (select string_agg(b, ', ') from jsonb_array_elements_text(v_bad) b);
    elsif v_source = 'company' then
      v_client := business_setup_import_exact(v_name);
      if v_client is not null then
        v_decision := 'matched';
      else
        v_near := business_setup_import_near(v_name);
        if v_near is not null then v_decision := 'held'; v_reason := 'Close to ' || v_near || ': a person decides';
        else v_decision := 'new'; end if;
      end if;
    else
      v_client := business_setup_import_exact(coalesce(v_company, v_name));
      if v_client is not null or exists (select 1 from business_setup_import_rows r where r.import_id = p_import and r.source = 'company' and r.decision in ('new', 'matched', 'applied')
                                          and business_setup_name_key(r.name) = business_setup_name_key(coalesce(v_company, v_name))) then
        v_decision := 'matched';
      else
        v_decision := 'held'; v_reason := 'No company with this exact name';
      end if;
    end if;
    insert into business_setup_import_rows (import_id, source, source_key, name, company, payload, match_client, decision, reason)
    values (p_import, v_source, v_key, v_name, v_company, coalesce(e -> 'payload', '{}'::jsonb), v_client, v_decision, v_reason)
    on conflict (source_key) do update set import_id = excluded.import_id, name = excluded.name, company = excluded.company, payload = excluded.payload,
      match_client = excluded.match_client, decision = excluded.decision, reason = excluded.reason;
    n := n + 1;
  end loop;
  return jsonb_build_object('staged', n);
end $$;

-- ── Report ───────────────────────────────────────────────────────────
create or replace function public.business_setup_import_report(p_import uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform business_setup_require('setup.import.manage');
  return jsonb_build_object(
    'sources', (select coalesce(jsonb_object_agg(t.source, t.c), '{}'::jsonb) from (
       select r.source, jsonb_build_object('total', count(*), 'matched', count(*) filter (where r.decision = 'matched'), 'new', count(*) filter (where r.decision = 'new'),
                'held', count(*) filter (where r.decision = 'held'), 'skip', count(*) filter (where r.decision = 'skip'), 'report', count(*) filter (where r.decision = 'report'),
                'applied', count(*) filter (where r.decision = 'applied'),
                'missing_email', count(*) filter (where r.decision <> 'held' and r.decision <> 'skip' and r.source = 'company' and client_master_plain(m.data ->> 'General Email') is null),
                'missing_phone', count(*) filter (where r.decision <> 'held' and r.decision <> 'skip' and r.source = 'company' and client_master_plain(m.data ->> 'General Phone') is null)) as c
         from business_setup_import_rows r left join client_master m on m.client_id = r.match_client
        where r.import_id = p_import group by r.source) t),
    'held', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'source', r.source, 'name', r.name, 'company', r.company, 'reason', r.reason) order by r.source, r.name), '[]'::jsonb)
               from business_setup_import_rows r where r.import_id = p_import and r.decision = 'held'),
    'quotations', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'zone', r.payload ->> 'zone', 'date', r.payload ->> 'date') order by r.name), '[]'::jsonb)
                     from business_setup_import_rows r where r.import_id = p_import and r.decision = 'report'),
    'differences', (select coalesce(jsonb_agg(jsonb_build_object('name', r.name, 'client_id', r.match_client, 'reason', r.reason) order by r.name), '[]'::jsonb)
                      from business_setup_import_rows r where r.import_id = p_import and r.decision = 'applied' and r.reason is not null));
end $$;

-- ── A person decides a held row ──────────────────────────────────────
create or replace function public.business_setup_import_decide(p_row uuid, p_client text, p_decision text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare r business_setup_import_rows;
begin
  perform business_setup_require('setup.import.manage');
  select * into r from business_setup_import_rows where id = p_row for update;
  if r.id is null then raise exception 'Row not found'; end if;
  if r.decision = 'applied' then raise exception 'This row is already loaded'; end if;
  if p_decision not in ('matched', 'new', 'skip') then raise exception 'Unknown decision'; end if;
  if p_decision = 'matched' and not exists (select 1 from client_master where client_id = p_client) then raise exception 'Client % not found', p_client; end if;
  if p_decision = 'new' and r.source <> 'company' then raise exception 'Only a company can be new'; end if;
  update business_setup_import_rows set decision = p_decision, match_client = case when p_decision = 'matched' then p_client end, reason = null, decided_by = auth.uid() where id = p_row;
end $$;

-- ── Apply ────────────────────────────────────────────────────────────
-- Empty fields are filled; a field that already holds another value keeps it and is listed.
create or replace function public.business_setup_import_company(r business_setup_import_rows) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  p jsonb := r.payload; v_client text := r.match_client; m client_master; k business_setup_kyc_profiles; fill jsonb := '{}'; diffs text[] := '{}'; res jsonb; pair record;
  fmt text; known text[] := array['licence_number', 'licence_date', 'licence_expiry', 'jurisdiction', 'zone_raw', 'client_status', 'kyc_form', 'bad_dates'];
begin
  for pair in select * from (values ('Trade License Number', p ->> 'licence_number'),
                 ('License Issue Date', to_char((p ->> 'licence_date')::date, 'DD/MM/YYYY')), ('License Expiry Date', to_char((p ->> 'licence_expiry')::date, 'DD/MM/YYYY')),
                 ('License Issuing Authority', p ->> 'jurisdiction')) t(key, val) where t.val is not null loop
    fill := fill || jsonb_build_object(pair.key, pair.val);
  end loop;
  if v_client is null then
    res := client_master_save(null, fill || jsonb_build_object('Client Legal Name', r.name), null, false);
    if coalesce((res ->> 'ok')::boolean, false) is not true then raise exception 'Client Master already holds this client: a person decides'; end if;
    v_client := res ->> 'id';
  else
    select * into m from client_master where client_id = v_client for update;
    for pair in select key, value #>> '{}' as val from jsonb_each(fill) loop
      fmt := client_master_plain(m.data ->> pair.key);
      if fmt is not null then
        if fmt <> pair.val then diffs := diffs || pair.key::text; end if;
        fill := fill - pair.key;
      end if;
    end loop;
    if fill <> '{}'::jsonb then perform client_master_save(v_client, fill || jsonb_build_object('Client Legal Name', coalesce(client_master_plain(m.data ->> 'Client Legal Name'), m.legal_name)), null); end if;
  end if;
  insert into business_setup_kyc_profiles (client_id) values (v_client) on conflict (client_id) do nothing;
  select * into k from business_setup_kyc_profiles where client_id = v_client for update;
  if k.licence_number is not null and p ->> 'licence_number' is not null and k.licence_number <> p ->> 'licence_number' then diffs := diffs || 'KYC licence number'::text; end if;
  if k.licence_expiry is not null and p ->> 'licence_expiry' is not null and k.licence_expiry <> (p ->> 'licence_expiry')::date then diffs := diffs || 'KYC licence expiry'::text; end if;
  update business_setup_kyc_profiles set
      company_status = coalesce(company_status, 'Existing'),
      jurisdiction = coalesce(jurisdiction, p ->> 'jurisdiction'),
      licence_number = coalesce(licence_number, p ->> 'licence_number'),
      licence_expiry = coalesce(licence_expiry, (p ->> 'licence_expiry')::date),
      client_status = coalesce(client_status, p ->> 'client_status'),
      kyc_state = coalesce(kyc_state, case when p ->> 'kyc_form' = 'Done' then 'Done' end),
      licence_extras = jsonb_strip_nulls(p - known) || licence_extras
    where id = k.id;
  update business_setup_import_rows set match_client = v_client, reason = case when cardinality(diffs) > 0 then 'Kept the existing value of: ' || array_to_string(diffs, ', ') end where id = r.id;
  return v_client;
end $$;

create or replace function public.business_setup_import_apply(p_import uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r business_setup_import_rows; v_client text; v_applied int := 0; v_status text; v_name text; v_note text; c jsonb;
begin
  perform business_setup_require('setup.import.manage');
  for r in select * from business_setup_import_rows where import_id = p_import and decision in ('matched', 'new')
            order by case source when 'company' then 1 when 'ejari' then 2 when 'visa' then 3 else 4 end, name for update loop
    begin
      c := r.payload;
      if r.source = 'company' then
        v_client := business_setup_import_company(r);
      else
        v_client := coalesce(r.match_client, business_setup_import_exact(coalesce(r.company, r.name)));
        if v_client is null then raise exception 'No company with this exact name'; end if;
      end if;
      if r.source = 'ejari' then
        insert into business_setup_kyc_profiles (client_id) values (v_client) on conflict (client_id) do nothing;
        update business_setup_kyc_profiles set ejari_provider = coalesce(ejari_provider, c ->> 'provider') where client_id = v_client;
      elsif r.source = 'visa' then
        insert into business_setup_visas (client_id, person_name, occupation, issue_date, expiry_date, status, source, source_key)
        values (v_client, r.name, c ->> 'occupation', (c ->> 'issue_date')::date, (c ->> 'expiry_date')::date, c ->> 'status', 'import', r.source_key)
        on conflict (source_key) do nothing;
      elsif r.source = 'service' then
        v_status := case c ->> 'old_status' when 'Done' then 'Completed' when 'Client Didn''t Confirm' then 'Cancelled' when 'Pending With Client' then 'Waiting on client' else 'In progress' end;
        v_name := case when business_setup_name_key(r.name) = business_setup_name_key(r.company) then coalesce(c ->> 'domain', 'Old CRM task') else r.name end;
        v_note := concat_ws('; ', 'From the old CRM: ' || (c ->> 'old_status'), 'Assignee: ' || (c ->> 'assignee'), 'Zone: ' || (c ->> 'zone'), 'Payment: ' || (c ->> 'payment_status'), c ->> 'remarks');
        insert into business_setup_services (client_id, name, status, historical, notes, completed_at, source_key)
        values (v_client, v_name, v_status, true, v_note, case when v_status = 'Completed' then (nullif(c ->> 'done', ''))::timestamptz end, r.source_key)
        on conflict (source_key) where source_key is not null do nothing;
      end if;
      update business_setup_import_rows set decision = 'applied', match_client = v_client, applied_at = now() where id = r.id;
      v_applied := v_applied + 1;
    exception when others then
      update business_setup_import_rows set decision = 'held', reason = sqlerrm where id = r.id;
    end;
  end loop;
  perform business_setup_audit('business_setup_import_rows', p_import::text, 'import_apply', null, jsonb_build_object('applied', v_applied));
  return jsonb_build_object('applied', v_applied, 'held', (select count(*) from business_setup_import_rows where import_id = p_import and decision = 'held'));
end $$;

revoke all on function public.business_setup_name_key(text), public.business_setup_import_exact(text), public.business_setup_import_near(text),
  public.business_setup_import_stage(uuid, jsonb), public.business_setup_import_report(uuid), public.business_setup_import_decide(uuid, text, text),
  public.business_setup_import_company(public.business_setup_import_rows), public.business_setup_import_apply(uuid) from public, anon, authenticated;
grant execute on function public.business_setup_import_stage(uuid, jsonb), public.business_setup_import_report(uuid), public.business_setup_import_decide(uuid, text, text),
  public.business_setup_import_apply(uuid) to authenticated;
