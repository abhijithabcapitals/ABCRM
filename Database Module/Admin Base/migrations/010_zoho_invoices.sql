-- Admin Base - one client invoice row per Zoho invoice                                   010
-- Re-runnable. Runs after Business Setup Base 010 (the table) and before the zoho-books function writes invoices.
-- The partial index lets the rows that exist today (no Zoho id) stay, and stops a Zoho invoice from showing twice.
create unique index if not exists business_setup_invoices_zoho_uq on public.business_setup_invoices (zoho_id) where zoho_id is not null;
