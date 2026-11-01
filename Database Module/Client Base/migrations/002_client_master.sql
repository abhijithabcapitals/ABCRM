-- =====================================================================
-- Client Base - Client Master and client lookup                    002
-- =====================================================================
-- ONE CLIENT = ONE ROW. `data` holds the 134 columns of Client Module/clientmodule/schema.json, keyed by column
-- name, exactly as the onboarding rules write them. The form calculates completion and review items;
-- this file owns what must hold whoever saves: Client IDs are never reused, likely duplicates stop a new client,
-- blank values never overwrite stored ones, stale saves are refused and every change is logged.
-- Read: kyc.view. Write: kyc.manage, through client_master_save only. Run after Banking Base. Idempotent.
-- =====================================================================
create sequence if not exists public.client_master_seq;

create table if not exists public.client_master (
  client_id text primary key,
  legal_name text not null,
  data jsonb not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.client_master_history (
  id bigint generated always as identity primary key,
  client_id text not null references public.client_master(client_id),
  action text not null,
  field text,
  old_value text,
  new_value text,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);
create index if not exists client_master_history_client_idx on public.client_master_history (client_id, changed_at desc);

create or replace function public.client_master_history_locked() returns trigger language plpgsql as $$
begin raise exception 'Client Master history cannot be changed'; end $$;
drop trigger if exists client_master_history_lock on public.client_master_history;
create trigger client_master_history_lock before update or delete on public.client_master_history
  for each row execute function public.client_master_history_locked();

alter table public.client_master enable row level security;
alter table public.client_master_history enable row level security;
drop policy if exists client_master_read on public.client_master;
create policy client_master_read on public.client_master for select to authenticated using (banking_can('kyc.view'));
drop policy if exists client_master_history_read on public.client_master_history;
create policy client_master_history_read on public.client_master_history for select to authenticated using (banking_can('kyc.view'));
revoke all on public.client_master, public.client_master_history from public, anon, authenticated;
grant select on public.client_master, public.client_master_history to authenticated;
revoke all on sequence public.client_master_seq from public, anon, authenticated;

-- A stored value without its markers, or null when it holds no information.
create or replace function public.client_master_plain(v text) returns text
language sql immutable set search_path = pg_catalog as $$
  select nullif(btrim(case when v like '% (Provided – Verification Required)' then left(v, length(v) - length(' (Provided – Verification Required)')) else v end), '')
   where coalesce(v, '') not in ('Not Provided', 'N/A', 'None', 'Provided – Verification Required')
$$;

create or replace function public.client_master_norm_name(v text) returns text
language sql immutable set search_path = public, pg_catalog as $$
  select btrim(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(client_master_plain(v), '')), '[^a-z0-9 ]', ' ', 'g'),
    '\y(l\s?l\s?c|fz\s?llc|fz\s?co|fze|fzc|llc|est|establishment|company|co|ltd|limited|plc|branch|the|sole|proprietorship|l l c)\y', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.client_master_duplicates(p jsonb, p_exclude text) returns jsonb
language sql stable set search_path = public, pg_catalog as $$
  with cur as (
    select client_master_norm_name(p ->> 'Client Legal Name') as name, client_master_norm_name(p ->> 'Trade Name') as trade,
           lower(coalesce(client_master_plain(p ->> 'General Email'), '')) as email,
           right(regexp_replace(coalesce(client_master_plain(p ->> 'General Phone'), ''), '\D', '', 'g'), 9) as phone
  ), hits as (
    select m.client_id, m.legal_name, array_remove(array[
        case when c.name <> '' and client_master_norm_name(m.data ->> 'Client Legal Name') = c.name then 'Legal name' end,
        case when c.trade <> '' and c.trade in (client_master_norm_name(m.data ->> 'Client Legal Name'), client_master_norm_name(m.data ->> 'Trade Name')) then 'Trade name' end,
        case when k.ids ? 'Trade License Number' then 'Trade License Number' end,
        case when k.ids ? 'Company Registration Number' then 'Company Registration Number' end,
        case when k.ids ? 'TRN' then 'TRN' end,
        case when k.ids ? 'CT Registration Number' then 'CT Registration Number' end,
        case when c.email <> '' and lower(coalesce(client_master_plain(m.data ->> 'General Email'), '')) = c.email then 'Email' end,
        case when length(c.phone) = 9 and right(regexp_replace(coalesce(client_master_plain(m.data ->> 'General Phone'), ''), '\D', '', 'g'), 9) = c.phone then 'Phone' end
      ], null) as matches
      from client_master m cross join cur c
      cross join lateral (
        select coalesce(jsonb_object_agg(col, true), '{}'::jsonb) as ids
          from unnest(array['Trade License Number', 'Company Registration Number', 'TRN', 'CT Registration Number']) col
         where upper(regexp_replace(coalesce(client_master_plain(p ->> col), ''), '[^A-Za-z0-9]', '', 'g')) <> ''
           and upper(regexp_replace(coalesce(client_master_plain(p ->> col), ''), '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(coalesce(client_master_plain(m.data ->> col), ''), '[^A-Za-z0-9]', '', 'g'))
      ) k
     where m.client_id is distinct from p_exclude
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', client_id, 'name', legal_name, 'matches', matches)), '[]'::jsonb) from hits where cardinality(matches) > 0
$$;

-- New client when p_id is null, otherwise that row only. p_version is the version the form opened.
create or replace function public.client_master_save(p_id text, p_data jsonb, p_version integer default null, p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cur client_master; merged jsonb; v_id text; dups jsonb; v_name text; k text; ch integer := 0;
begin
  if not banking_can('kyc.manage') then raise exception 'You do not have permission to change the Client Master'; end if;
  if p_data::text ~* 'AE[0-9]{21}' then raise exception 'Store only the last 4 digits of an IBAN'; end if;
  if p_id is not null then
    select * into cur from client_master where client_id = p_id for update;
    if cur.client_id is null then raise exception 'Client % not found', p_id; end if;
    if p_version is not null and p_version <> cur.version then raise exception 'Someone else changed this client. Reopen it and try again.'; end if;
  end if;
  -- Blank incoming values never overwrite what is stored.
  select coalesce(cur.data, '{}'::jsonb) || coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into merged
    from jsonb_each(p_data) e where btrim(coalesce(e.value #>> '{}', '')) <> '';
  v_name := client_master_plain(merged ->> 'Client Legal Name');
  if v_name is null then raise exception 'Client Legal Name is required.'; end if;
  if client_master_plain(merged ->> 'Risk Level') in ('High', 'Review Required') and client_master_plain(merged ->> 'Risk Reason') is null then
    raise exception 'Risk Level is % - record the Risk Reason before saving.', client_master_plain(merged ->> 'Risk Level');
  end if;
  dups := client_master_duplicates(merged, p_id);
  if p_id is null then
    if jsonb_array_length(dups) > 0 and not p_allow_duplicate then return jsonb_build_object('ok', false, 'duplicates', dups); end if;
    v_id := 'CL' || lpad(nextval('client_master_seq')::text, 6, '0');
    merged := merged || jsonb_build_object('Client ID', v_id);
    insert into client_master (client_id, legal_name, data) values (v_id, v_name, merged);
    insert into client_master_history (client_id, action) values (v_id, case when jsonb_array_length(dups) > 0 then 'Created (duplicate override)' else 'Created' end);
    return jsonb_build_object('ok', true, 'id', v_id, 'duplicates', dups);
  end if;
  merged := merged || jsonb_build_object('Client ID', p_id);
  for k in select key from jsonb_each(merged) loop
    if k <> 'Last Updated' and (cur.data ->> k) is distinct from (merged ->> k) then
      insert into client_master_history (client_id, action, field, old_value, new_value) values (p_id, 'Updated', k, cur.data ->> k, merged ->> k);
      ch := ch + 1;
    end if;
  end loop;
  if ch = 0 then return jsonb_build_object('ok', true, 'id', p_id, 'unchanged', true); end if;
  update client_master set legal_name = v_name, data = merged, version = version + 1, updated_at = now(), updated_by = auth.uid() where client_id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'changes', ch);
end $$;

-- Everything known about each client, for filling in forms: Client Master first, then banking clients and open leads.
create or replace function public.client_lookup() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select 1 as rank, m.client_id as ref, m.legal_name as name, client_master_plain(m.data ->> 'Client Legal Name') as legal_name, client_master_plain(m.data ->> 'Trade Name') as trade_name,
           client_master_plain(split_part(m.data ->> 'Primary Contact', ';', 1)) as contact, client_master_plain(m.data ->> 'General Email') as email, client_master_plain(m.data ->> 'General Phone') as phone,
           null::text as whatsapp, null::text as nationality, client_master_plain(m.data ->> 'Registered Address') as address, client_master_plain(m.data ->> 'Trade License Number') as license,
           client_master_plain(m.data ->> 'TRN') as trn, client_master_plain(m.data ->> 'License Issuing Authority') as authority, client_master_plain(m.data ->> 'Entity Type') as company_type, client_master_plain(m.data ->> 'Main Business Activity') as activity
      from client_master m where banking_can('kyc.view')
    union all
    select 2, cl.client_master_id, cl.display_name, k.legal_name, k.trade_name, ld.contact_person, coalesce(k.company_email, ld.email), coalesce(k.company_phone, ld.mobile),
           ld.whatsapp, ld.nationality, k.registered_address, coalesce(cl.license_number, k.license_number, ld.license_number), k.vat_trn, coalesce(k.issuing_authority, ld.license_authority), coalesce(k.legal_structure, ld.company_type), coalesce(k.business_activity, ld.business_activity)
      from banking_clients cl
      left join banking_kyc_profiles k on k.client_id = cl.id and banking_can('kyc.view')
      left join lateral (select * from banking_leads l where l.client_id = cl.id order by l.lead_date desc limit 1) ld on banking_can('leads.view')
     where banking_can('cases.view')
    union all
    select 3, null, l.company_name, null, null, l.contact_person, l.email, l.mobile, l.whatsapp, l.nationality, null, l.license_number, null, l.license_authority, l.company_type, l.business_activity
      from banking_leads l where l.client_id is null and banking_can('leads.view')
    order by 1, 3
  ) t
$$;

revoke all on function public.client_master_save(text, jsonb, integer, boolean), public.client_lookup() from public, anon;
grant execute on function public.client_master_save(text, jsonb, integer, boolean), public.client_lookup() to authenticated;
revoke all on function public.client_master_duplicates(jsonb, text), public.client_master_history_locked() from public, anon, authenticated;
