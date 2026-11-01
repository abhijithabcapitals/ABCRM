-- =====================================================================
-- Voucher Base - where each generated file is                      002
-- =====================================================================
-- Records documents generated from a Word template, which carry no CRM number, under their file name. Also records
-- the PC folder copy when it is written after the document was created (the Client Module was off at the time).
-- Run after 001. Idempotent.
-- =====================================================================
alter table public.voucher_register add column if not exists file_name text;
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking', 'hub', 'template'));

drop policy if exists voucher_register_read_template on public.voucher_register;
create policy voucher_register_read_template on public.voucher_register for select to authenticated using (source = 'template');

create or replace function public.voucher_template_record(p jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if coalesce(p ->> 'file_name', '') = '' then raise exception 'File name is required'; end if;
  insert into voucher_register (voucher_type, voucher_number, department, source, source_id, client_name, issued_on, status, storage_path, local_path, file_name, created_by)
  values ('Quotation', p ->> 'file_name', coalesce(p ->> 'department', 'Business Setup'), 'template', gen_random_uuid(), p ->> 'client_name', current_date, 'Generated', p ->> 'storage_path', p ->> 'local_path', p ->> 'file_name', auth.uid())
  returning id into v_id;
  return v_id;
end $$;

-- Only fills an empty location, and only on a record the caller may see.
create or replace function public.voucher_set_local(p_id uuid, p_path text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v voucher_register;
begin
  select * into v from voucher_register where id = p_id for update;
  if v.id is null or not (v.source in ('hub', 'template')
     or (v.voucher_type = 'Receipt' and banking_can('payments.view'))
     or (v.voucher_type = 'Quotation' and banking_can('quotes.view'))
     or (v.voucher_type = 'Engagement Letter' and banking_can('agreements.view'))) then raise exception 'Record not found'; end if;
  if coalesce(p_path, '') = '' then raise exception 'Path is required'; end if;
  if v.local_path is not null then return; end if;
  if v.source = 'hub' then update hub_documents set local_path = p_path where id = v.source_id;
  elsif v.source = 'banking' then update banking_generated_documents set local_path = p_path where storage_path = v.storage_path; end if;
  update voucher_register set local_path = p_path where id = p_id;
end $$;

revoke all on function public.voucher_template_record(jsonb), public.voucher_set_local(uuid, text) from public, anon;
grant execute on function public.voucher_template_record(jsonb), public.voucher_set_local(uuid, text) to authenticated;
