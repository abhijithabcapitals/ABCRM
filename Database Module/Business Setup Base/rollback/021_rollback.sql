-- Undoes migration 021 and the records it loaded. Clients it added, "Visa Registration" on Client Master and on the
-- Clients list stay: Client Master keeps its history and does not reuse an ID, and staff may have worked on them since.
begin;
delete from public.business_setup_service_history where service_id in (select id from public.business_setup_services where source_key like 'visa\_sheet:%');
delete from public.business_setup_services where source_key like 'visa\_sheet:%';
delete from public.business_setup_visas where source = 'visa_sheet';
drop function if exists public.business_setup_visa_sheet_apply(jsonb);
commit;
