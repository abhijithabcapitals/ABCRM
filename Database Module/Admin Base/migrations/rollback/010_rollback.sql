-- Undoes 010_zoho_invoices.sql. Drops the unique index only. No invoice rows are touched.
drop index if exists public.business_setup_invoices_zoho_uq;
