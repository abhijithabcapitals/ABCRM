-- =====================================================================
-- Banking Base - saved fee receipt vouchers                        007
-- =====================================================================
-- Records each saved voucher like quotes and letters: number, serial and locations.
-- Vouchers keep their RC-000001 numbering. Idempotent: safe to re-run.
-- =====================================================================
alter table public.banking_generated_documents drop constraint if exists banking_generated_documents_kind_check;
alter table public.banking_generated_documents add constraint banking_generated_documents_kind_check check (kind in ('quote','letter','receipt'));
alter table public.banking_generated_documents add column if not exists payment_id uuid references public.banking_payments(id);
create index if not exists banking_gen_docs_payment_idx on public.banking_generated_documents (payment_id);

drop policy if exists banking_gen_docs_read on public.banking_generated_documents;
create policy banking_gen_docs_read on public.banking_generated_documents for select to authenticated
  using ((kind = 'quote' and public.banking_can('quotes.view')) or (kind = 'letter' and public.banking_can('agreements.view')) or (kind = 'receipt' and public.banking_can('payments.view')));
drop policy if exists banking_gen_docs_add on public.banking_generated_documents;
create policy banking_gen_docs_add on public.banking_generated_documents for insert to authenticated
  with check ((kind = 'quote' and public.banking_can('quotes.manage')) or (kind = 'letter' and public.banking_can('agreements.manage')) or (kind = 'receipt' and public.banking_can('payments.manage')));

-- Kinds with a set format read the serial through it; a voucher's serial is its trailing digits.
create or replace function public.banking_generated_serial() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare fmt text := banking_setting('document_numbering') -> new.kind ->> 'format';
begin
  if fmt is null then
    new.document_serial := substring(new.document_number from '([0-9]+)$')::int;
  else
    new.document_serial := substring(new.document_number from '^' || replace(replace(replace(regexp_replace(fmt, '([.+*?()\[\]^$|\\])', '\\\1', 'g'), '{YYYY}', '[0-9]{4}'), '{MM}', '[0-9]{2}'), '{SERIAL}', '([0-9]+)') || '$')::int;
  end if;
  return new;
end $$;
revoke all on function public.banking_generated_serial() from public, anon, authenticated;
