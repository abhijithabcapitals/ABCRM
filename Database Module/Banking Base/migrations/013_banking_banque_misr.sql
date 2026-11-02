-- =====================================================================
-- Banking Base - Banque Misr in the bank master                    013
-- =====================================================================
-- Added at the user's request on 02/11/2026: the old CRM has deals with this bank. Nothing already edited
-- in the CRM is overwritten. Idempotent: safe to re-run.
-- =====================================================================
insert into public.banking_partners (bank_code, bank_name, aliases, internal_remarks)
values ('BANQUEMISR', 'Banque Misr', array['BANQUE MISR'], 'Added from the old CRM import. Requirements not recorded.')
on conflict (bank_code) do nothing;
