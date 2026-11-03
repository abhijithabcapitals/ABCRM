-- Drops the Zoho tables and their rows. This removes the CRM's record of what it created in Zoho (the Zoho drafts stay).
drop table if exists public.zoho_documents;
drop table if exists public.zoho_contact_links;
