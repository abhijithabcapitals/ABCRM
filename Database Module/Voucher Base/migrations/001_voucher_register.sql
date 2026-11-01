-- =====================================================================
-- Voucher Base - register of every number the CRM generates        001
-- =====================================================================
-- One row for each receipt, quotation and engagement letter, from Business Banking and Template Hub, filled
-- automatically when the document is created. Existing documents are copied in. Run last. Idempotent.
-- =====================================================================
create table if not exists public.voucher_register (
  id uuid primary key default gen_random_uuid(),
  voucher_type text not null check (voucher_type in ('Receipt','Quotation','Engagement Letter')),
  voucher_number text not null,
  version int not null default 1,
  serial int,
  company text not null default 'AB Capital',
  department text,
  source text not null check (source in ('banking','hub')),
  source_id uuid not null,
  case_id uuid,
  client_name text,
  issued_on date,
  amount numeric(18,2),
  status text,
  storage_path text,
  local_path text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (source, voucher_type, source_id)
);
create index if not exists voucher_register_number_idx on public.voucher_register (voucher_number);
create index if not exists voucher_register_type_idx on public.voucher_register (voucher_type, created_at desc);
alter table public.voucher_register enable row level security;
revoke all on public.voucher_register from anon, authenticated;
grant select on public.voucher_register to authenticated;
drop policy if exists voucher_register_read on public.voucher_register;
create policy voucher_register_read on public.voucher_register for select to authenticated using (
  source = 'hub' or (voucher_type = 'Receipt' and public.banking_can('payments.view')) or (voucher_type = 'Quotation' and public.banking_can('quotes.view')) or (voucher_type = 'Engagement Letter' and public.banking_can('agreements.view')));

create or replace function public.voucher_serial(p_number text) returns int
language sql immutable set search_path = public, pg_temp as $$
  select substring(p_number from '([0-9]+)[^0-9]*$')::int
$$;

create or replace function public.voucher_client(p_case uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select cl.display_name from banking_cases c join banking_clients cl on cl.id = c.client_id where c.id = p_case
$$;

create or replace function public.voucher_from_quote() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into voucher_register (voucher_type, voucher_number, version, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by)
  values ('Quotation', new.quotation_number, new.version, voucher_serial(new.quotation_number), 'Business Banking', 'banking', new.id, new.case_id, voucher_client(new.case_id), new.quotation_date, new.total_amount, new.status, new.created_by)
  on conflict (source, voucher_type, source_id) do update set amount = excluded.amount, status = excluded.status, issued_on = excluded.issued_on;
  return new;
end $$;

create or replace function public.voucher_from_letter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into voucher_register (voucher_type, voucher_number, version, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by)
  values ('Engagement Letter', new.letter_number, new.version, voucher_serial(new.letter_number), 'Business Banking', 'banking', new.id, new.case_id, voucher_client(new.case_id), new.letter_date, (new.content ->> 'total')::numeric, new.status, new.created_by)
  on conflict (source, voucher_type, source_id) do update set status = excluded.status;
  return new;
end $$;

create or replace function public.voucher_from_receipt() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare p banking_payments;
begin
  select * into p from banking_payments where id = new.payment_id;
  insert into voucher_register (voucher_type, voucher_number, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by)
  values ('Receipt', new.receipt_number, voucher_serial(new.receipt_number), 'Business Banking', 'banking', new.payment_id, p.case_id, voucher_client(p.case_id), p.payment_date, p.amount, 'Valid', new.created_by)
  on conflict (source, voucher_type, source_id) do nothing;
  return new;
end $$;

-- A refund or reversal marks the original receipt; the row stays.
create or replace function public.voucher_from_counter() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.reverses_payment_id is not null then
    update voucher_register set status = case new.txn_type when 'Reversal' then 'Reversed' else 'Refunded' end
     where source = 'banking' and voucher_type = 'Receipt' and source_id = new.reverses_payment_id;
  end if;
  return new;
end $$;

-- Saved files record where they are.
create or replace function public.voucher_from_file() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update voucher_register set storage_path = new.storage_path, local_path = coalesce(new.local_path, local_path)
   where source = 'banking' and ((new.kind = 'quote' and voucher_type = 'Quotation' and source_id = new.quotation_id)
      or (new.kind = 'letter' and voucher_type = 'Engagement Letter' and source_id = new.letter_id)
      or (new.kind = 'receipt' and voucher_type = 'Receipt' and source_id = new.payment_id));
  return new;
end $$;

create or replace function public.voucher_from_hub() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.doc_type not in ('quote','letter') then return new; end if;
  insert into voucher_register (voucher_type, voucher_number, serial, company, department, source, source_id, client_name, issued_on, amount, status, storage_path, local_path, created_by)
  values (case new.doc_type when 'quote' then 'Quotation' else 'Engagement Letter' end, new.document_number, new.document_serial, new.company, new.department, 'hub', new.id, new.client_name, new.created_at::date, new.total_amount, 'Generated', new.storage_path, new.local_path, new.created_by)
  on conflict (source, voucher_type, source_id) do update set storage_path = excluded.storage_path, local_path = excluded.local_path;
  return new;
end $$;

drop trigger if exists voucher_quote on public.banking_quotations;
create trigger voucher_quote after insert or update on public.banking_quotations for each row execute function public.voucher_from_quote();
drop trigger if exists voucher_letter on public.banking_engagement_letters;
create trigger voucher_letter after insert or update on public.banking_engagement_letters for each row execute function public.voucher_from_letter();
drop trigger if exists voucher_receipt on public.banking_receipts;
create trigger voucher_receipt after insert on public.banking_receipts for each row execute function public.voucher_from_receipt();
drop trigger if exists voucher_counter on public.banking_payments;
create trigger voucher_counter after insert on public.banking_payments for each row execute function public.voucher_from_counter();
drop trigger if exists voucher_file on public.banking_generated_documents;
create trigger voucher_file after insert on public.banking_generated_documents for each row execute function public.voucher_from_file();
drop trigger if exists voucher_hub on public.hub_documents;
create trigger voucher_hub after insert or update on public.hub_documents for each row execute function public.voucher_from_hub();

-- Documents that already exist.
insert into public.voucher_register (voucher_type, voucher_number, version, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by, created_at)
select 'Quotation', q.quotation_number, q.version, public.voucher_serial(q.quotation_number), 'Business Banking', 'banking', q.id, q.case_id, public.voucher_client(q.case_id), q.quotation_date, q.total_amount, q.status, q.created_by, q.created_at
  from public.banking_quotations q on conflict (source, voucher_type, source_id) do nothing;
insert into public.voucher_register (voucher_type, voucher_number, version, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by, created_at)
select 'Engagement Letter', l.letter_number, l.version, public.voucher_serial(l.letter_number), 'Business Banking', 'banking', l.id, l.case_id, public.voucher_client(l.case_id), l.letter_date, (l.content ->> 'total')::numeric, l.status, l.created_by, l.created_at
  from public.banking_engagement_letters l on conflict (source, voucher_type, source_id) do nothing;
insert into public.voucher_register (voucher_type, voucher_number, serial, department, source, source_id, case_id, client_name, issued_on, amount, status, created_by, created_at)
select 'Receipt', r.receipt_number, public.voucher_serial(r.receipt_number), 'Business Banking', 'banking', r.payment_id, p.case_id, public.voucher_client(p.case_id), p.payment_date, p.amount,
       case (select c.txn_type from public.banking_payments c where c.reverses_payment_id = p.id limit 1) when 'Reversal' then 'Reversed' when 'Refund' then 'Refunded' else 'Valid' end, r.created_by, r.created_at
  from public.banking_receipts r join public.banking_payments p on p.id = r.payment_id on conflict (source, voucher_type, source_id) do nothing;
insert into public.voucher_register (voucher_type, voucher_number, serial, company, department, source, source_id, client_name, issued_on, amount, status, storage_path, local_path, created_by, created_at)
select case d.doc_type when 'quote' then 'Quotation' else 'Engagement Letter' end, d.document_number, d.document_serial, d.company, d.department, 'hub', d.id, d.client_name, d.created_at::date, d.total_amount, 'Generated', d.storage_path, d.local_path, d.created_by, d.created_at
  from public.hub_documents d where d.doc_type in ('quote','letter') on conflict (source, voucher_type, source_id) do nothing;
update public.voucher_register v set storage_path = g.storage_path, local_path = coalesce(g.local_path, v.local_path)
  from public.banking_generated_documents g
 where v.source = 'banking' and v.storage_path is null and ((g.kind = 'quote' and v.voucher_type = 'Quotation' and v.source_id = g.quotation_id) or (g.kind = 'letter' and v.voucher_type = 'Engagement Letter' and v.source_id = g.letter_id) or (g.kind = 'receipt' and v.voucher_type = 'Receipt' and v.source_id = g.payment_id));

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'voucher\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
