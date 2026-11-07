-- OneDrive folder map: links every existing folder in "CRM AB CAPITAL" to its CRM client, employee or lead, and tells each
-- CRM document which existing folder it belongs in. Nothing here creates, renames or moves a folder: the map only reads what
-- the folder scan (Database Module/tools/onedrive_folder_scan.py) reports.
--
-- How a folder is linked (folder names are never changed, so a folder whose name differs from the CRM name still links):
--   1. code:   the folder name ends " - CL000123" (client), " - ABC-008" (employee) or " - LD-2026-000002" (lead) and that
--              code exists in the CRM. The name in front of the code does not matter.
--   2. name:   no code, but the folder name and the CRM name are the same once case, punctuation, accents and legal suffixes
--              (LLC, FZCO, FZE, L.L.C, DMCC ...) are ignored, and only one CRM record has that name.
--   3. fuzzy:  a close but not equal name (shared words, or one name is the start of the other). Kept as "suggested" until a
--              person confirms it with storage_folder_decide. Never used for filing until confirmed.
-- A person's decision (confirm, reject, manual link) is never overwritten by a later scan.
-- Rollback: migrations/rollback/007_rollback.sql

create table if not exists public.storage_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.storage_folders (
  id uuid primary key default gen_random_uuid(),
  rel_path text not null unique,                       -- under the root, with backslashes, e.g. Business Setup\Apex LLC - CL000075
  folder_name text not null,
  area text not null,                                  -- Accounting, Business Banking, Business Setup, Business Development, EMPLOYEES, Archive
  kind text not null check (kind in ('client', 'employee', 'lead')),
  folder_code text,                                    -- code read from the folder name, if any
  is_ex boolean not null default false,                -- under EMPLOYEES\00 EX EMPLOYEES
  client_id text references public.client_master (client_id) on delete set null,
  employee_id uuid references public.hr_employees (id) on delete set null,
  lead_id uuid references public.bd_leads (id) on delete set null,
  match_method text not null default 'none' check (match_method in ('code', 'name', 'fuzzy', 'manual', 'none')),
  match_score numeric(4, 3),
  candidates jsonb not null default '[]',              -- best CRM matches for a person to choose from
  status text not null default 'unmatched' check (status in ('linked', 'suggested', 'unmatched', 'rejected')),
  name_differs boolean not null default false,         -- linked, but the folder name is not the CRM name (left as is)
  subfolders text[] not null default '{}',             -- the folder's own subfolders as named on disk (KYC, Proposals ...)
  last_seen_at timestamptz,
  missing_since timestamptz,                           -- not seen by the latest scan (moved or deleted in OneDrive)
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint storage_folders_owner check (num_nonnulls(client_id, employee_id, lead_id) <= 1)
);
create index if not exists storage_folders_client on public.storage_folders (client_id) where client_id is not null;
create index if not exists storage_folders_employee on public.storage_folders (employee_id) where employee_id is not null;
create index if not exists storage_folders_lead on public.storage_folders (lead_id) where lead_id is not null;

-- Which subfolder of a client, employee or lead folder each CRM document kind goes to. Matched without case.
create table if not exists public.storage_doc_folders (
  scope text not null check (scope in ('client', 'employee', 'lead')),
  doc_kind text not null,
  subfolder text not null,
  primary key (scope, doc_kind)
);
insert into public.storage_doc_folders (scope, doc_kind, subfolder)
select 'client', k, f from (values
  ('passport', 'KYC'), ('emirates id', 'KYC'), ('emirates_id', 'KYC'), ('visa', 'KYC'), ('emirates visa', 'KYC'), ('old visa', 'KYC'),
  ('old emirates id', 'KYC'), ('passport / id', 'KYC'), ('ubo', 'KYC'), ('trade licence', 'KYC'), ('trade license', 'KYC'), ('trade_license', 'KYC'),
  ('moa / aoa', 'KYC'), ('moa_aoa', 'KYC'), ('company_document', 'KYC'), ('tax_certificate', 'KYC'), ('vat document', 'KYC'),
  ('corporate tax document', 'KYC'), ('banking_document', 'KYC'), ('output', 'KYC'), ('intake', 'KYC'),
  ('bank statement', 'FINANCIALS INFORMATION'), ('bank_statement', 'FINANCIALS INFORMATION'), ('financial_statement', 'FINANCIALS INFORMATION'),
  ('audit_report', 'FINANCIALS INFORMATION'), ('vat_return', 'FINANCIALS INFORMATION'), ('corporate_tax_return', 'FINANCIALS INFORMATION'),
  ('soa', 'FINANCIALS INFORMATION'),
  ('ledger', 'ACCOUNTING DATA'), ('tally_backup', 'ACCOUNTING DATA'), ('sales_register', 'ACCOUNTING DATA'), ('purchase_register', 'ACCOUNTING DATA'),
  ('trial_balance', 'ACCOUNTING DATA'), ('payroll_data', 'ACCOUNTING DATA'),
  ('invoice', 'VOUCHERS'), ('receipt', 'VOUCHERS'), ('payment_voucher', 'VOUCHERS'), ('bill', 'VOUCHERS'), ('payment_proof', 'VOUCHERS'),
  ('quote', 'PROPOSALS'), ('proposal', 'PROPOSALS'),
  ('letter', 'ENGAGEMENT LETTERS'), ('engagement_letter', 'ENGAGEMENT LETTERS'), ('agreement', 'ENGAGEMENT LETTERS'),
  ('signed_acceptance', 'ENGAGEMENT LETTERS'), ('signed_quote', 'ENGAGEMENT LETTERS'),
  ('mail', 'OTHERS'), ('correspondence', 'OTHERS'), ('other', 'OTHERS')
) v (k, f)
union all
select 'employee', k, f from (values
  ('passport', 'PERSONAL DOCUMENTS'), ('emirates id', 'PERSONAL DOCUMENTS'), ('emirates_id', 'PERSONAL DOCUMENTS'), ('visa', 'PERSONAL DOCUMENTS'),
  ('photo', 'PERSONAL DOCUMENTS'), ('certificate', 'PERSONAL DOCUMENTS'), ('labour card', 'EMPLOYMENT DOCUMENTS'),
  ('offer_letter', 'EMPLOYMENT DOCUMENTS'), ('contract', 'EMPLOYMENT DOCUMENTS'), ('labour_card', 'EMPLOYMENT DOCUMENTS'), ('warning_letter', 'EMPLOYMENT DOCUMENTS'),
  ('payslip', 'PAYROLL'), ('salary_certificate', 'PAYROLL'), ('wps', 'PAYROLL'), ('expense', 'PAYROLL'), ('overtime', 'PAYROLL'),
  ('leave', 'LEAVE AND ATTENDANCE'), ('leave_request', 'LEAVE AND ATTENDANCE'), ('attendance', 'LEAVE AND ATTENDANCE'),
  ('attendance_report', 'LEAVE AND ATTENDANCE'), ('medical_certificate', 'LEAVE AND ATTENDANCE'), ('sick leave', 'LEAVE AND ATTENDANCE'),
  ('other', 'OTHERS')
) v (k, f)
union all
select 'lead', 'other', 'OTHERS'
on conflict (scope, doc_kind) do nothing;

-- Words of a name used for matching: upper case, accents and punctuation gone, "&" read as AND, legal suffixes dropped.
create or replace function public.storage_name_tokens(p_name text) returns text[]
language sql immutable set search_path = pg_catalog as $$
  select coalesce(array_agg(distinct w order by w), '{}')
    from regexp_split_to_table(
           regexp_replace(
             replace(replace(translate(upper(coalesce(p_name, '')), 'ÁÀÂÄÃÅÉÈÊËÍÌÎÏÓÒÔÖÕÚÙÛÜÇÑ', 'AAAAAAEEEEIIIIOOOOOUUUUCN'), '&', ' AND '), '.', ''),
             '[^A-Z0-9]+', ' ', 'g'),
           ' ') w
   where w <> '' and w <> all (array['LLC', 'LLCFZ', 'FZLLC', 'FZ', 'FZE', 'FZC', 'FZCO', 'DMCC', 'SPC', 'SOC', 'SP', 'LLCSP', 'LLCSOC',
                                     'CO', 'COMPANY', 'LTD', 'LIMITED', 'EST', 'DWC', 'FC', 'INC', 'THE', 'AND', 'OF', 'L', 'C'])
$$;

-- How alike two names are, 0 to 1. 1 = the same words. 0.85 = one joined name starts with the other (at least 6 letters).
-- Otherwise shared words over all words. p_person also counts every word of the CRM name appearing in the folder name
-- (an employee folder "GEO JOJAN" for the CRM name "GEO").
create or replace function public.storage_name_score(p_folder text, p_crm text, p_person boolean default false) returns numeric
language sql immutable set search_path = pg_catalog, public as $$
  with t as (select storage_name_tokens(p_folder) f, storage_name_tokens(p_crm) c),
  k as (select f, c, array_to_string(f, '') fk, array_to_string(c, '') ck,
               (select count(*) from unnest(f) x where x = any(c)) shared,
               (select count(distinct x) from unnest(f || c) x) total from t)
  select round(case
    when cardinality(f) = 0 or cardinality(c) = 0 then 0
    when f = c then 1
    when least(length(fk), length(ck)) >= 6 and (fk like ck || '%' or ck like fk || '%') then 0.85
    when p_person and shared = cardinality(c) then 0.7
    else shared::numeric / total end, 3)
  from k
$$;

-- Fills match fields for one folder. Code first, then name. Returns the fields to store.
create or replace function public.storage_folder_match(p_kind text, p_name text, p_code text)
returns table (client_id text, employee_id uuid, lead_id uuid, match_method text, match_score numeric, status text, candidates jsonb, name_differs boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_label text := regexp_replace(p_name, '\s+-\s+' || coalesce(regexp_replace(p_code, '([^A-Za-z0-9])', '\\\1', 'g'), '') || '\s*$', '');
  v_cands jsonb; v_best numeric; v_second numeric; v_id text; v_crm text;
begin
  -- 1. code
  if p_code is not null then
    if p_kind = 'client' then
      select m.client_id, m.legal_name into v_id, v_crm from client_master m where m.client_id = upper(p_code);
    elsif p_kind = 'employee' then
      select e.id::text, e.full_name into v_id, v_crm from hr_employees e where upper(e.employee_code) = upper(p_code);
    else
      select l.id::text, coalesce(l.company_name, l.prospect_name) into v_id, v_crm from bd_leads l where upper(l.lead_number) = upper(p_code);
    end if;
    if v_id is not null then
      return query select case when p_kind = 'client' then v_id end, case when p_kind = 'employee' then v_id::uuid end,
                          case when p_kind = 'lead' then v_id::uuid end, 'code'::text, 1.000::numeric, 'linked'::text,
                          jsonb_build_array(jsonb_build_object('id', v_id, 'name', v_crm, 'score', 1)),
                          storage_name_tokens(v_label) is distinct from storage_name_tokens(v_crm);
      return;
    end if;
  end if;
  -- 2 and 3. name: the three best CRM records
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'score', x.score) order by x.score desc, x.id), '[]')
    into v_cands
    from (select s.id, s.name, s.score from (
            select m.client_id as id, m.legal_name as name, storage_name_score(v_label, m.legal_name) as score
              from client_master m where p_kind = 'client'
            union all
            select e.id::text, e.full_name, storage_name_score(v_label, e.full_name, true) from hr_employees e where p_kind = 'employee'
            union all
            select l.id::text, coalesce(l.company_name, l.prospect_name), storage_name_score(v_label, coalesce(l.company_name, l.prospect_name))
              from bd_leads l where p_kind = 'lead' and l.archived_at is null) s
           where s.score >= 0.5 order by s.score desc, s.id limit 3) x;
  v_best := (v_cands -> 0 ->> 'score')::numeric;
  v_second := (v_cands -> 1 ->> 'score')::numeric;
  v_id := v_cands -> 0 ->> 'id';
  if v_best is null then
    return query select null::text, null::uuid, null::uuid, 'none'::text, null::numeric, 'unmatched'::text, '[]'::jsonb, false;
  elsif v_best = 1 and v_second is distinct from 1 then
    return query select case when p_kind = 'client' then v_id end, case when p_kind = 'employee' then v_id::uuid end,
                        case when p_kind = 'lead' then v_id::uuid end, 'name'::text, v_best, 'linked'::text, v_cands, false;
  elsif v_best >= 0.6 then
    return query select case when p_kind = 'client' then v_id end, case when p_kind = 'employee' then v_id::uuid end,
                        case when p_kind = 'lead' then v_id::uuid end, 'fuzzy'::text, v_best, 'suggested'::text, v_cands, true;
  else
    return query select null::text, null::uuid, null::uuid, 'none'::text, v_best, 'unmatched'::text, v_cands, false;
  end if;
end $$;

-- The scan sends every folder it found. Upserts each by path, keeps people's decisions, marks folders no longer found.
-- p_folders: [{ "path": "Business Setup\\Apex LLC - CL000075", "name": "Apex LLC - CL000075", "area": "Business Setup",
--               "kind": "client", "code": "CL000075", "ex": false, "subfolders": ["KYC", "OTHERS"] }, ...]
create or replace function public.storage_folders_sync(p_root text, p_folders jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  f jsonb; m record; v_now timestamptz := now(); v_path text; v_seen text[] := '{}';
begin
  if not (admin_is() or (auth.uid() is null and current_user in ('postgres', 'service_role', 'supabase_admin'))) then
    raise exception 'Only an admin can update the OneDrive folder map';
  end if;
  if coalesce(btrim(p_root), '') = '' or jsonb_typeof(p_folders) <> 'array' then
    raise exception 'The scan must send the root folder and a list of folders';
  end if;
  insert into storage_settings (key, value) values ('onedrive_root', btrim(p_root))
    on conflict (key) do update set value = excluded.value, updated_at = v_now;

  for f in select * from jsonb_array_elements(p_folders) loop
    v_path := btrim(f ->> 'path');
    if coalesce(v_path, '') = '' or f ->> 'kind' not in ('client', 'employee', 'lead') or v_path like '%..%' then continue; end if;
    v_seen := v_seen || v_path;
    select * into m from storage_folder_match(f ->> 'kind', f ->> 'name', nullif(f ->> 'code', ''));
    insert into storage_folders as s (rel_path, folder_name, area, kind, folder_code, is_ex, client_id, employee_id, lead_id,
                                      match_method, match_score, candidates, status, name_differs, subfolders, last_seen_at, missing_since)
    values (v_path, f ->> 'name', f ->> 'area', f ->> 'kind', nullif(f ->> 'code', ''), coalesce((f ->> 'ex')::boolean, false),
            m.client_id, m.employee_id, m.lead_id, m.match_method, m.match_score, m.candidates, m.status, m.name_differs,
            coalesce(array(select jsonb_array_elements_text(f -> 'subfolders')), '{}'), v_now, null)
    on conflict (rel_path) do update set
      folder_name = excluded.folder_name, area = excluded.area, kind = excluded.kind, folder_code = excluded.folder_code,
      is_ex = excluded.is_ex, subfolders = excluded.subfolders, last_seen_at = v_now, missing_since = null, updated_at = v_now,
      candidates = excluded.candidates,
      -- a person's decision stays; only automatic links are refreshed
      client_id = case when s.decided_at is null then excluded.client_id else s.client_id end,
      employee_id = case when s.decided_at is null then excluded.employee_id else s.employee_id end,
      lead_id = case when s.decided_at is null then excluded.lead_id else s.lead_id end,
      match_method = case when s.decided_at is null then excluded.match_method else s.match_method end,
      match_score = case when s.decided_at is null then excluded.match_score else s.match_score end,
      status = case when s.decided_at is null then excluded.status else s.status end,
      name_differs = case when s.decided_at is null then excluded.name_differs else s.name_differs end;
  end loop;
  if cardinality(v_seen) = 0 then raise exception 'The scan found no folders. Check that OneDrive is synced before scanning'; end if;

  update storage_folders set missing_since = coalesce(missing_since, v_now), updated_at = v_now
   where rel_path <> all (v_seen) and missing_since is null;

  return jsonb_build_object(
    'seen', cardinality(v_seen),
    'linked_by_code', (select count(*) from storage_folders where last_seen_at = v_now and status = 'linked' and match_method = 'code'),
    'linked_by_name', (select count(*) from storage_folders where last_seen_at = v_now and status = 'linked' and match_method = 'name'),
    'linked_by_person', (select count(*) from storage_folders where last_seen_at = v_now and status = 'linked' and match_method = 'manual'),
    'suggested', (select count(*) from storage_folders where last_seen_at = v_now and status = 'suggested'),
    'unmatched', (select count(*) from storage_folders where last_seen_at = v_now and status = 'unmatched'),
    'rejected', (select count(*) from storage_folders where last_seen_at = v_now and status = 'rejected'),
    'missing', (select count(*) from storage_folders where missing_since is not null),
    'name_differs', (select count(*) from storage_folders where last_seen_at = v_now and status = 'linked' and name_differs));
end $$;

-- Who may see and decide folder rows: client and lead folders for admins and Client Master users; employee folders for HR.
create or replace function public.storage_folder_can(p_kind text, p_manage boolean default false) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select hub_is_admin() or case p_kind
    when 'employee' then hr_is_admin_or_hr()
    else client_master_can(case when p_manage then 'kyc.manage' else 'kyc.view' end) end
$$;

-- A person confirms a suggestion, rejects a link, or links a folder by hand. The folder itself is not touched.
create or replace function public.storage_folder_decide(p_id uuid, p_action text, p_owner text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r storage_folders;
begin
  select * into r from storage_folders where id = p_id for update;
  if r.id is null then raise exception 'Folder not found'; end if;
  if not storage_folder_can(r.kind, true) then raise exception 'You do not have permission to link this folder'; end if;
  if p_action = 'confirm' then
    if r.status not in ('suggested', 'linked') or num_nonnulls(r.client_id, r.employee_id, r.lead_id) = 0 then
      raise exception 'Only a suggested link can be confirmed';
    end if;
    update storage_folders set status = 'linked', decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'reject' then
    update storage_folders set status = 'rejected', client_id = null, employee_id = null, lead_id = null,
           decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'link' then
    if r.kind = 'client' and not exists (select 1 from client_master where client_id = p_owner) then raise exception 'Client % not found', p_owner; end if;
    if r.kind = 'employee' and not exists (select 1 from hr_employees where id::text = p_owner) then raise exception 'Employee not found'; end if;
    if r.kind = 'lead' and not exists (select 1 from bd_leads where id::text = p_owner) then raise exception 'Lead not found'; end if;
    update storage_folders set status = 'linked', match_method = 'manual', match_score = null,
           client_id = case when r.kind = 'client' then p_owner end,
           employee_id = case when r.kind = 'employee' then p_owner::uuid end,
           lead_id = case when r.kind = 'lead' then p_owner::uuid end,
           decided_by = auth.uid(), decided_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'reset' then  -- hand the folder back to automatic matching on the next scan
    update storage_folders set decided_by = null, decided_at = null, updated_at = now() where id = p_id;
  else
    raise exception 'Unknown action %', p_action;
  end if;
  return (select to_jsonb(s) from storage_folders s where s.id = p_id);
end $$;

-- The existing folder for a client, employee or lead in one area (department). p_area null: any area, Business Setup first.
-- Only linked folders that the latest scan still found. Returns nothing when there is no folder: the CRM never makes one here.
create or replace function public.storage_owner_folder(p_kind text, p_owner text, p_area text default null)
returns table (folder_id uuid, rel_path text, area text, subfolders text[])
language sql stable security definer set search_path = public, pg_temp as $$
  select s.id, s.rel_path, s.area, s.subfolders
    from storage_folders s
   where s.kind = p_kind and s.status = 'linked' and s.missing_since is null and storage_folder_can(p_kind)
     and case p_kind when 'client' then s.client_id = p_owner when 'employee' then s.employee_id::text = p_owner else s.lead_id::text = p_owner end
     and (p_area is null or s.area = p_area)
   order by s.is_ex, (s.area = 'Archive'), array_position(array['Business Setup', 'Accounting', 'Business Banking'], s.area) nulls last,
            (s.match_method = 'code') desc, s.rel_path
   limit 1
$$;

-- Where a CRM document belongs in OneDrive. status: ready (the subfolder exists), no_subfolder (the folder has no such
-- subfolder; the path is OTHERS if it exists, else the folder itself), no_folder (nothing linked yet: path is null).
create or replace function public.storage_doc_target(p_kind text, p_owner text, p_area text, p_doc_kind text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_root text := (select value from storage_settings where key = 'onedrive_root');
  fo record; v_want text; v_have text; v_status text := 'ready';
begin
  if p_owner is null then return jsonb_build_object('status', 'no_folder', 'path', null); end if;
  select * into fo from storage_owner_folder(p_kind, p_owner, p_area);
  if fo.folder_id is null and p_area is not null then select * into fo from storage_owner_folder(p_kind, p_owner, null); end if;
  if fo.folder_id is null then return jsonb_build_object('status', 'no_folder', 'path', null); end if;
  v_want := coalesce((select d.subfolder from storage_doc_folders d where d.scope = p_kind and d.doc_kind = lower(btrim(p_doc_kind))), 'OTHERS');
  v_have := (select x from unnest(fo.subfolders) x where upper(x) = upper(v_want) limit 1);
  if v_have is null then
    v_status := 'no_subfolder';
    v_have := (select x from unnest(fo.subfolders) x where upper(x) = 'OTHERS' limit 1);
  end if;
  return jsonb_build_object('status', v_status, 'folder_id', fo.folder_id, 'area', fo.area, 'subfolder', v_want,
    'path', concat_ws('\', v_root, fo.rel_path, v_have));
end $$;

-- Every document the CRM stores or generates, with the OneDrive folder it belongs in. security_invoker: a user sees only
-- the rows the source tables already let them see.
create or replace view public.storage_document_links with (security_invoker = true) as
with docs as (
  select 'hub_documents'::text as source, d.id::text as source_id, 'client'::text as owner_kind, d.client_id as owner_id,
         d.department as area, d.doc_type as doc_kind, d.document_number as label, d.storage_path as crm_path, d.onedrive_path as saved_path,
         d.created_at
    from hub_documents d
  union all
  select 'hub_documents.signed', d.id::text, 'client', d.client_id, d.department, 'signed_acceptance', d.document_number, d.signed_path, null, d.created_at
    from hub_documents d where d.signed_path is not null
  union all
  select 'business_setup_documents', d.id::text, 'client', d.client_id, 'Business Setup', d.kind, d.file_name, d.storage_path, null, d.created_at
    from business_setup_documents d
  union all
  select 'business_setup_invoices', i.id::text, 'client', i.client_id, 'Business Setup', 'invoice', i.invoice_number, i.file_path, null, i.created_at
    from business_setup_invoices i where i.file_path is not null
  union all
  select 'business_setup_receipts', r.id::text, 'client', p.client_id, 'Business Setup', 'receipt', r.receipt_number, r.storage_path, r.local_path, r.created_at
    from business_setup_receipts r join business_setup_payments p on p.id = r.payment_id
  union all
  select 'business_setup_signed_quotes', s.id::text, 'client', q.client_id, coalesce(q.department, 'Business Setup'), 'signed_quote', q.document_number,
         s.storage_path, null, s.created_at
    from business_setup_signed_quotes s join hub_documents q on q.id = s.quote_id
  union all
  select 'client_portal_documents', d.id::text, 'client', a.client_master_id, null, d.doc_type, d.file_name, d.storage_path,
         coalesce(d.filed_path, d.local_path), d.uploaded_at
    from client_portal_documents d join client_portal_accounts a on a.id = d.account_id
  union all
  select 'banking_generated_documents', g.id::text, 'client', bc.client_master_id::text, 'Business Banking', g.kind, coalesce(g.document_number, g.file_name),
         g.storage_path, g.local_path, g.created_at
    from banking_generated_documents g join banking_cases c on c.id = g.case_id join banking_clients bc on bc.id = c.client_id
  union all
  select 'banking_document_versions', v.id::text, 'client', bc.client_master_id::text, 'Business Banking', 'banking_document', coalesce(v.file_name, b.title),
         v.storage_path, null, v.created_at
    from banking_document_versions v join banking_documents b on b.id = v.document_id join banking_clients bc on bc.id = b.client_id
   where b.deleted_at is null
  union all
  select 'accounting_receipts', r.id::text, 'client', j.client_id, 'Accounting', 'receipt', r.receipt_number, r.storage_path, null, r.created_at
    from accounting_receipts r join accounting_payments p on p.id = r.payment_id join accounting_jobs j on j.id = p.job_id
  union all
  select 'hr_documents', h.id::text, 'employee', h.employee_id::text, 'EMPLOYEES', h.doc_type, h.doc_type, h.storage_path, null, h.created_at
    from hr_documents h
  union all
  select 'hr_requests', h.id::text, 'employee', h.employee_id::text, 'EMPLOYEES', h.kind, h.kind, h.storage_path, null, h.created_at
    from hr_requests h where h.storage_path is not null
  union all
  select 'bd_lead_documents', d.id::text, 'lead', d.lead_id::text, 'Business Development', 'other', d.file_name, d.file_path, null, d.created_at
    from bd_lead_documents d
)
select d.*, t.target ->> 'status' as onedrive_status, t.target ->> 'path' as onedrive_folder, (t.target ->> 'folder_id')::uuid as folder_id
  from docs d cross join lateral storage_doc_target(d.owner_kind, d.owner_id, d.area, d.doc_kind) as t (target);

-- One row per client, employee and lead with every OneDrive folder linked to it.
create or replace view public.storage_owner_folders with (security_invoker = true) as
select s.kind, coalesce(s.client_id, s.employee_id::text, s.lead_id::text) as owner_id,
       jsonb_agg(jsonb_build_object('folder_id', s.id, 'area', s.area, 'path', concat_ws('\', (select value from storage_settings where key = 'onedrive_root'), s.rel_path),
                 'folder_name', s.folder_name, 'method', s.match_method, 'name_differs', s.name_differs, 'is_ex', s.is_ex,
                 'missing', s.missing_since is not null, 'subfolders', s.subfolders) order by s.area, s.rel_path) as folders
  from storage_folders s
 where s.status = 'linked'
 group by s.kind, coalesce(s.client_id, s.employee_id::text, s.lead_id::text);

alter table public.storage_folders enable row level security;
alter table public.storage_settings enable row level security;
alter table public.storage_doc_folders enable row level security;
drop policy if exists storage_folders_read on public.storage_folders;
create policy storage_folders_read on public.storage_folders for select to authenticated using (storage_folder_can(kind));
drop policy if exists storage_settings_read on public.storage_settings;
create policy storage_settings_read on public.storage_settings for select to authenticated using (true);
drop policy if exists storage_doc_folders_read on public.storage_doc_folders;
create policy storage_doc_folders_read on public.storage_doc_folders for select to authenticated using (true);

revoke all on public.storage_folders, public.storage_settings, public.storage_doc_folders from anon, authenticated;
grant select on public.storage_folders, public.storage_settings, public.storage_doc_folders to authenticated;
revoke all on public.storage_document_links, public.storage_owner_folders from anon, authenticated;
grant select on public.storage_document_links, public.storage_owner_folders to authenticated;

revoke all on function public.storage_name_tokens(text), public.storage_name_score(text, text, boolean),
  public.storage_folder_match(text, text, text), public.storage_folders_sync(text, jsonb), public.storage_folder_can(text, boolean),
  public.storage_folder_decide(uuid, text, text), public.storage_owner_folder(text, text, text),
  public.storage_doc_target(text, text, text, text) from public, anon, authenticated;
grant execute on function public.storage_name_tokens(text), public.storage_name_score(text, text, boolean),
  public.storage_folders_sync(text, jsonb), public.storage_folder_can(text, boolean), public.storage_folder_decide(uuid, text, text),
  public.storage_owner_folder(text, text, text), public.storage_doc_target(text, text, text, text) to authenticated;
