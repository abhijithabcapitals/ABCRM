-- Document Base 001: schema od_copy, the map and work queue for copying the old OneDrive folder into CRM AB CAPITAL.
-- Idempotent. Spec: Document Intelligence Module/docs/2026-11-06-onedrive-copy-design.md.
-- Read: admins and the CEO. Write: service role only. Rollback: drop schema od_copy cascade.
begin;

create schema if not exists od_copy;

-- Who may read: CRM admins (public.admin_is) and the CEO (ceo.profiles role 'owner').
create or replace function od_copy.can_read() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.admin_is()
    or exists (select 1 from ceo.profiles p where p.user_id = auth.uid() and p.role = 'owner')
$$;
revoke all on function od_copy.can_read() from public, anon;
grant execute on function od_copy.can_read() to authenticated;

create table if not exists od_copy.settings (
  id boolean primary key default true check (id),
  drive_id text,
  source_item_id text,
  dest_item_id text,
  stage text not null default 'idle' check (stage in ('idle','inventory','plan','approved','copying','done','paused','rollback')),
  delta_link text,
  batch_size int not null default 20,
  max_in_flight int not null default 4,
  last_run_at timestamptz,
  last_run_result jsonb,
  rollback_scope jsonb
);
alter table od_copy.settings add column if not exists rollback_scope jsonb;
insert into od_copy.settings (id) values (true) on conflict do nothing;

create table if not exists od_copy.source_items (
  item_id text primary key,
  parent_path text not null,
  name text not null,
  size bigint not null,
  quickxor_hash text,
  modified_at timestamptz,
  is_folder boolean not null default false,
  seen_at timestamptz not null default now()
);

create table if not exists od_copy.area_rules (
  area text primary key,
  department text not null,
  kind text not null check (kind in ('client','fixed','archive','employees')),
  service text,
  target_prefix text
);

create table if not exists od_copy.folder_rules (
  id serial primary key,
  pattern text not null,
  is_regex boolean not null default false,
  folder text not null check (folder in ('KYC','FINANCIALS INFORMATION','ACCOUNTING DATA','VOUCHERS','OTHERS','PROPOSALS','ENGAGEMENT LETTERS')),
  priority int not null,
  unique (pattern, is_regex)
);

create table if not exists od_copy.client_matches (
  area text not null,
  folder_name text not null,
  client_id text references public.client_master(client_id),
  method text check (method in ('exact','close','manual','none')),
  status text check (status in ('auto','review','approved','rejected','unmatched')),
  confidence numeric,
  reviewed_by uuid,
  primary key (area, folder_name)
);

create table if not exists od_copy.plan (
  source_item_id text primary key references od_copy.source_items(item_id),
  source_path text,
  target_path text not null,
  department text,
  client_id text,
  status text check (status in ('planned','approved','copying','copied','verified','failed','skipped_duplicate','rolled_back')),
  duplicate_of text,
  dest_item_id text,
  monitor_url text,
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);
create index if not exists plan_status_idx on od_copy.plan (status);

create table if not exists od_copy.client_folders (
  client_id text not null,
  department text not null,
  dest_item_id text,
  web_url text,
  primary key (client_id, department)
);

create table if not exists od_copy.operations (
  id bigserial primary key,
  at timestamptz not null default now(),
  action text,
  source_item_id text,
  dest_item_id text,
  result text,
  detail jsonb
);

-- Append-only log: reuse the CRM's public.banking_append_only() when present, else a local copy.
create or replace function od_copy.append_only() returns trigger
language plpgsql set search_path = pg_temp as $$
begin
  raise exception '% is append-only: add a new record instead of changing history', tg_table_name;
end $$;
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'operations_immutable' and tgrelid = 'od_copy.operations'::regclass) then
    execute format('create trigger operations_immutable before update or delete on od_copy.operations for each row execute function %s',
      case when to_regprocedure('public.banking_append_only()') is not null then 'public.banking_append_only()' else 'od_copy.append_only()' end);
  end if;
end $$;

-- Row Level Security: select for admins and CEO, writes for service_role only.
do $$ declare t text; begin
  foreach t in array array['settings','source_items','area_rules','folder_rules','client_matches','plan','client_folders','operations'] loop
    execute format('alter table od_copy.%I enable row level security', t);
    execute format('drop policy if exists %I on od_copy.%I', t || '_read', t);
    execute format('create policy %I on od_copy.%I for select to authenticated using (od_copy.can_read())', t || '_read', t);
    execute format('drop policy if exists %I on od_copy.%I', t || '_service', t);
    execute format('create policy %I on od_copy.%I for all to service_role using (true) with check (true)', t || '_service', t);
    execute format('revoke all on od_copy.%I from public, anon, authenticated', t);
    execute format('grant select on od_copy.%I to authenticated', t);
    execute format('grant select, insert, update, delete on od_copy.%I to service_role', t);
  end loop;
end $$;
grant usage on schema od_copy to authenticated, service_role;
grant usage, select on all sequences in schema od_copy to service_role;

-- Department by old area (spec: Target path rules).
insert into od_copy.area_rules (area, department, kind, service, target_prefix) values
  ('2. Accounting Clients', 'Accounting', 'client', 'Accounting', null),
  ('3. Corporate Tax', 'Accounting', 'client', 'Corporate Tax', null),
  ('4. VAT Clients', 'Accounting', 'client', 'VAT', null),
  ('5. Audit Clients', 'Accounting', 'client', 'Audit', null),
  ('Company Formation Clients', 'Business Setup', 'client', 'Company Formation', null),
  ('LIQUIDATION', 'Business Setup', 'client', 'Liquidation', null),
  ('GOLDEN VISAS', 'Business Setup', 'client', 'Golden Visas', null),
  ('Banking ACCOUNT ABC/Bank Account Clients', 'Business Banking', 'client', 'Bank Account', null),
  ('LOAN CLIENTS', 'Business Banking', 'client', 'Loans', null),
  ('Banking ACCOUNT ABC', 'Business Banking', 'fixed', null, 'Business Banking/00 Bank Partner Documents'),
  ('1. AB Capital Documents', 'CEO', 'fixed', null, 'CEO/00 Company Records (AB Capital)'),
  ('Employee Folders', 'EMPLOYEES', 'employees', null, 'EMPLOYEES'),
  ('EX Employees', 'EMPLOYEES', 'fixed', null, 'EMPLOYEES/00 EX EMPLOYEES'),
  ('Freezone and Mainland Pricing', '04 Shared Library', 'fixed', null, '04 Shared Library'),
  ('AB Capital Logo & letterhead', '04 Shared Library', 'fixed', null, '04 Shared Library'),
  ('Agreements', '04 Shared Library', 'fixed', null, '04 Shared Library'),
  ('Social Media', 'Business Development', 'fixed', null, 'Business Development/00 Marketing and Social Media'),
  ('Traction Consulting Services', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Traction Consulting Services'),
  ('Various Other Work', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Various Other Work'),
  ('Desktop', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Desktop'),
  ('Documents', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Documents'),
  ('Pictures', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Pictures'),
  ('RARE', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/RARE'),
  ('Attestation', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/Attestation'),
  ('(root files)', '08 Archive', 'archive', null, '08 Archive/From old OneDrive/(root files)')
on conflict (area) do nothing;

-- Sub-folder name to FOLDER: lowercase substring (or regex), first match by priority wins.
-- Anything else, and files directly in the client folder, fall to OTHERS in code (no row needed).
insert into od_copy.folder_rules (pattern, is_regex, folder, priority)
select p, r, f, n * 10 from (values
  (1, 'kyc', false, 'KYC'), (2, 'passport', false, 'KYC'), (3, 'emirates id', false, 'KYC'), (4, 'eid', false, 'KYC'),
  (5, 'visa', false, 'KYC'), (6, 'company doc', false, 'KYC'), (7, 'co doc', false, 'KYC'), (8, 'license', false, 'KYC'),
  (9, 'licence', false, 'KYC'), (10, 'moa', false, 'KYC'), (11, 'aoa', false, 'KYC'), (12, 'incorporation', false, 'KYC'),
  (13, 'certificate', false, 'KYC'),
  (14, 'bank statement', false, 'FINANCIALS INFORMATION'), (15, 'statement', false, 'FINANCIALS INFORMATION'),
  (16, 'soa', false, 'FINANCIALS INFORMATION'), (17, 'financial', false, 'FINANCIALS INFORMATION'),
  (18, 'audit', false, 'FINANCIALS INFORMATION'), (19, 'signed audit', false, 'FINANCIALS INFORMATION'),
  (20, 'vat return', false, 'FINANCIALS INFORMATION'), (21, 'ct return', false, 'FINANCIALS INFORMATION'),
  (22, 'tax return', false, 'FINANCIALS INFORMATION'), (23, '^20(19|2[0-9]|30)$', true, 'FINANCIALS INFORMATION'),
  (24, 'accounting work', false, 'ACCOUNTING DATA'), (25, 'tally', false, 'ACCOUNTING DATA'), (26, 'ledger', false, 'ACCOUNTING DATA'),
  (27, 'sales', false, 'ACCOUNTING DATA'), (28, 'purchase', false, 'ACCOUNTING DATA'), (29, 'turnover', false, 'ACCOUNTING DATA'),
  (30, 'books', false, 'ACCOUNTING DATA'), (31, 'working', false, 'ACCOUNTING DATA'),
  (32, 'invoice', false, 'VOUCHERS'), (33, 'inv', false, 'VOUCHERS'), (34, 'receipt', false, 'VOUCHERS'),
  (35, 'voucher', false, 'VOUCHERS'), (36, 'bill', false, 'VOUCHERS'), (37, 'payment', false, 'VOUCHERS'),
  (38, 'proposal', false, 'PROPOSALS'), (39, 'quotation', false, 'PROPOSALS'), (40, 'quote', false, 'PROPOSALS'),
  (41, 'agreement', false, 'ENGAGEMENT LETTERS'), (42, 'engagement', false, 'ENGAGEMENT LETTERS'), (43, 'contract', false, 'ENGAGEMENT LETTERS')
) as v(n, p, r, f)
on conflict (pattern, is_regex) do nothing;

-- Expose od_copy through the Data API, keeping whatever is already listed.
do $$
declare
  current_list text;
begin
  select split_part(cfg, '=', 2) into current_list
  from pg_db_role_setting s
  join pg_roles r on r.oid = s.setrole
  cross join unnest(s.setconfig) cfg
  where r.rolname = 'authenticator' and cfg like 'pgrst.db_schemas=%'
  limit 1;
  current_list := coalesce(nullif(current_list, ''), 'public, graphql_public, acct, ceo, email_base');
  if position('od_copy' in current_list) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', current_list || ', od_copy');
  end if;
end $$;
notify pgrst, 'reload config';

commit;
