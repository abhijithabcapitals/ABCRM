-- =====================================================================
-- Business Setup Base - tables, permissions, access rules              001
-- =====================================================================
-- Re-runnable. Runs after 001 and 002 (Business Setup permissions and audit), Client Base (client_master),
-- Services Base (service_items) and Template Hub Base (hub_documents).
-- Tables are read-only through the API; changes go through RPCs added in later migrations.
-- No client data and no prices live in this file: the fee list is a private seed (007).
-- =====================================================================

-- ── Client KYC ───────────────────────────────────────────────────────
create table if not exists public.business_setup_kyc_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique references public.client_master(client_id),
  company_status text,                       -- e.g. to be formed / licensed
  business_activity text,
  jurisdiction text,
  licence_number text,                       -- not required for a company being formed
  licence_expiry date,
  details jsonb not null default '{}',
  client_status text,                        -- from the legacy workbooks (e.g. Active, Cancelled)
  kyc_state text,                            -- e.g. Done
  ejari_provider text,
  licence_extras jsonb not null default '{}' -- imported licence values that have no column of their own
);
create table if not exists public.business_setup_kyc_partners (
  id uuid primary key default gen_random_uuid(),
  kyc_id uuid not null references public.business_setup_kyc_profiles(id) on delete cascade,
  full_name text not null,
  nationality text,
  share_percent numeric(5,2) check (share_percent between 0 and 100),
  is_shareholder boolean not null default true,
  is_ubo boolean not null default false,
  passport_number text,                      -- sensitive: needs setup.kyc.sensitive to read
  passport_expiry date,
  emirates_id text,                          -- sensitive
  details jsonb not null default '{}'
);

-- ── Fee master and services ──────────────────────────────────────────
create table if not exists public.business_setup_fee_items (
  id uuid primary key default gen_random_uuid(),
  grp text not null,
  name text not null,
  default_amount numeric(18,2) not null default 0 check (default_amount >= 0),
  service_item_id uuid references public.service_items(id),
  active boolean not null default true,
  sort_order int not null default 0,
  unique (grp, name)
);
create table if not exists public.business_setup_services (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  quote_id uuid references public.hub_documents(id),
  fee_item_id uuid references public.business_setup_fee_items(id),
  name text not null,
  status text not null default 'Not started',
  amount numeric(18,2) check (amount >= 0),
  due_date date,
  completed_at timestamptz,
  renews_service_id uuid references public.business_setup_services(id),
  notes text
);
create index if not exists business_setup_services_client_idx on public.business_setup_services (client_id);
create table if not exists public.business_setup_service_history (   -- append-only
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.business_setup_services(id),
  from_status text,
  to_status text not null,
  note text,
  changed_at timestamptz not null default now(),
  changed_by uuid default auth.uid()
);
create index if not exists business_setup_service_history_idx on public.business_setup_service_history (service_id, changed_at);

-- ── Payments ledger: amount is always positive, type decides the sign ─
create table if not exists public.business_setup_payments (          -- append-only
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  quote_id uuid references public.hub_documents(id),
  paid_on date not null,
  amount numeric(18,2) not null check (amount > 0),
  method text,
  reference text,
  type text not null check (type in ('Payment','Refund','Reversal')),
  reverses_id uuid references public.business_setup_payments(id),
  note text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check ((type = 'Reversal') = (reverses_id is not null))
);
create index if not exists business_setup_payments_client_idx on public.business_setup_payments (client_id, paid_on);
-- A payment can be reversed once.
create unique index if not exists business_setup_payments_one_reversal on public.business_setup_payments (reverses_id) where reverses_id is not null;

create table if not exists public.business_setup_receipts (          -- append-only except file locations
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references public.business_setup_payments(id),
  receipt_number text not null unique,
  storage_path text,
  local_path text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);

-- ── Documents, tasks ─────────────────────────────────────────────────
create table if not exists public.business_setup_documents (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  kind text,
  file_name text not null,
  storage_path text not null,                -- private bucket business-setup-documents
  note text,
  service_id uuid references public.business_setup_services(id),   -- set on a file produced for that service
  is_output boolean not null default false,  -- an output of the service, which completion looks for
  client_visible boolean not null default false
);
create index if not exists business_setup_documents_service_idx on public.business_setup_documents (service_id) where service_id is not null;
create table if not exists public.business_setup_tasks (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.client_master(client_id),
  title text not null,
  owner_id uuid references public.profiles(id),
  due_date date,
  status text not null default 'Open' check (status in ('Open','Done','Cancelled'))
);

-- ── Quote templates: the Word files a quote can be made from ─────────
-- storage_file is a file name in private storage. The files themselves are never in the repository.
create table if not exists public.business_setup_quote_templates (
  key text primary key check (key ~ '^[a-z0-9_]+$'),
  label text not null,
  jurisdiction text,
  storage_file text not null,
  active boolean not null default true
);
insert into public.business_setup_quote_templates (key, label, jurisdiction, storage_file) values
  ('ifza', 'IFZA', 'IFZA', 'IFZA.docx'),
  ('rakez', 'RAKEZ', 'RAKEZ', 'Rakez.docx'),
  ('shams', 'SHAMS', 'SHAMS', 'SHAMS.docx'),
  ('mainland', 'Dubai Mainland', 'Dubai Mainland', 'Mainland.docx'),
  ('liquidation', 'Liquidation', null, 'Liquidation.docx'),
  ('service', 'Visa and other services', null, 'Service_Quotation_Template.docx')
on conflict (key) do nothing;

-- ── Audit columns on tables that can be edited ───────────────────────
do $$
declare t text;
begin
  foreach t in array array['business_setup_kyc_profiles','business_setup_kyc_partners','business_setup_fee_items',
    'business_setup_services','business_setup_documents','business_setup_tasks','business_setup_quote_templates'] loop
    execute format('alter table public.%I add column if not exists created_at timestamptz not null default now(), add column if not exists created_by uuid, add column if not exists updated_at timestamptz not null default now(), add column if not exists updated_by uuid', t);
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.business_setup_touch()', t || '_touch', t);
  end loop;
end $$;

-- ── Append-only rules ────────────────────────────────────────────────
create or replace function public.business_setup_receipt_guard() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is append-only: receipts cannot be deleted', tg_table_name;
  end if;
  if (to_jsonb(new) - 'storage_path' - 'local_path') is distinct from (to_jsonb(old) - 'storage_path' - 'local_path') then
    raise exception '% is append-only: only the file locations can change', tg_table_name;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['business_setup_payments','business_setup_service_history'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public.business_setup_append_only()', t || '_immutable', t);
  end loop;
end $$;
drop trigger if exists business_setup_receipts_immutable on public.business_setup_receipts;
create trigger business_setup_receipts_immutable before update or delete on public.business_setup_receipts
  for each row execute function public.business_setup_receipt_guard();

-- ── Row-level security: read by permission, no direct writes ─────────
do $$
declare
  rec record;
begin
  for rec in select * from (values
    ('business_setup_kyc_profiles','setup.access'),
    ('business_setup_kyc_partners','setup.kyc.sensitive'),
    ('business_setup_fee_items','setup.access'),
    ('business_setup_services','setup.access'),
    ('business_setup_service_history','setup.access'),
    ('business_setup_payments','setup.access'),
    ('business_setup_receipts','setup.access'),
    ('business_setup_documents','setup.access'),
    ('business_setup_tasks','setup.access'),
    ('business_setup_quote_templates','setup.access')
  ) v(t, perm) loop
    execute format('alter table public.%I enable row level security', rec.t);
    execute format('drop policy if exists %I on public.%I', rec.t || '_read', rec.t);
    execute format('create policy %I on public.%I for select to authenticated using (public.business_setup_can(%L))', rec.t || '_read', rec.t, rec.perm);
    -- Supabase default privileges include TRUNCATE, which bypasses RLS: start from nothing.
    execute format('revoke all on public.%I from anon, authenticated', rec.t);
    execute format('grant select on public.%I to authenticated', rec.t);
  end loop;
end $$;
