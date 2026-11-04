-- Admin Base - one client invoice row per Zoho invoice                                   010
-- Re-runnable. Order: Business Setup Base 010 first (it creates the table), then this file. It fails if the table is missing.
-- The partial index lets the rows that exist today (no Zoho id) stay, and stops a Zoho invoice from showing twice.
-- The zoho-books function writes these rows with the service role.
create unique index if not exists business_setup_invoices_zoho_uq on public.business_setup_invoices (zoho_id) where zoho_id is not null;
grant select, insert, update, delete on public.business_setup_invoices to service_role;
