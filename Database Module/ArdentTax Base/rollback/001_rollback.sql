-- Undoes migrations/001_ardentax.sql. Stops if any ArdentTax document exists, because removing them loses issued numbers.
-- To remove them anyway, first run in the same session: set ardentax.rollback_force = 'yes';
do $$
begin
  if to_regclass('public.ardentax_documents') is not null
     and exists (select 1 from public.ardentax_documents)
     and coalesce(current_setting('ardentax.rollback_force', true), '') <> 'yes' then
    raise exception 'ArdentTax documents exist. Export them, then set ardentax.rollback_force to yes.';
  end if;
end $$;

drop policy if exists hub_docs_ardentax_read on storage.objects;
drop policy if exists hub_docs_ardentax_insert on storage.objects;
drop trigger if exists voucher_ardentax on public.ardentax_documents;
drop function if exists public.voucher_from_ardentax();
drop policy if exists voucher_register_read_ardentax on public.voucher_register;
delete from public.voucher_register where source = 'ardentax';
alter table public.voucher_register drop constraint if exists voucher_register_source_check;
alter table public.voucher_register add constraint voucher_register_source_check check (source in ('banking','hub','template','business_setup','accounting'));

drop function if exists public.ardentax_mail_sent(uuid, uuid);
drop function if exists public.ardentax_mail_update(uuid, text, text, text, text, boolean);
drop function if exists public.ardentax_document_attach(uuid, text, text);
drop function if exists public.ardentax_document_revise(uuid, jsonb);
drop function if exists public.ardentax_document_create(jsonb);
drop function if exists public.ardentax_prepare(jsonb, jsonb);
drop function if exists public.ardentax_totals(jsonb);
drop function if exists public.ardentax_num(jsonb);
drop function if exists public.ardentax_strip(text);
drop policy if exists ardentax_documents_read on public.ardentax_documents;
drop table if exists public.ardentax_documents;
drop function if exists public.ardentax_can();

delete from public.hub_number_counters where department = 'ArdentTax (ASP)';
delete from public.hub_settings where key = 'ardentax_mail';
update public.hub_settings set value = value - 'ArdentTax (ASP)' where key = 'document_numbering';
delete from public.service_departments where name = 'ArdentTax (ASP)';
