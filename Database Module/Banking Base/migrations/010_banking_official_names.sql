-- =====================================================================
-- Banking Base - official bank names and websites                  010
-- =====================================================================
-- Old short names stay as aliases so Excel rows and uploads still match. Only rows still holding the
-- old name or no website change, so later edits in the CRM are kept. Idempotent: safe to re-run.
-- =====================================================================
do $$
declare r record;
begin
  for r in select * from (values
    ('ADCB', 'ADCB', 'Abu Dhabi Commercial Bank PJSC', 'https://www.adcb.com'),
    ('ADIB', 'ADIB', 'Abu Dhabi Islamic Bank PJSC', 'https://www.adib.ae'),
    ('DIB', 'Dubai Islamic Bank', 'Dubai Islamic Bank PJSC', 'https://www.dib.ae'),
    ('EIB', 'Emirates Islamic Bank', 'Emirates Islamic Bank PJSC', 'https://www.emiratesislamic.ae'),
    ('ENBD', 'Emirates NBD', 'Emirates NBD Bank PJSC', 'https://www.emiratesnbd.com'),
    ('FAB', 'FAB', 'First Abu Dhabi Bank PJSC', 'https://www.bankfab.com'),
    ('MBANK', 'M Bank', 'Al Maryah Community Bank (Mbank)', 'https://www.mbank.ae'),
    ('MASHREQ', 'Mashreq', 'Mashreqbank PSC', 'https://www.mashreq.com'),
    ('NBF', 'National Bank of Fujairah', 'National Bank of Fujairah PJSC', 'https://www.nbf.ae'),
    ('RAKBANK', 'RAKBANK', 'The National Bank of Ras Al Khaimah PJSC (RAKBANK)', 'https://www.rakbank.ae'),
    ('RUYA', 'Ruya Bank', 'Ruya Community Islamic Bank', 'https://www.ruya.ae'),
    ('SIB', 'Sharjah Islamic Bank', 'Sharjah Islamic Bank PJSC', 'https://www.sib.ae'),
    ('UBL', 'UBL Bank', 'United Bank Limited (UBL)', 'https://www.ubldigital.com'),
    ('WIO', 'Wio Bank', 'Wio Bank PJSC', 'https://www.wio.io')
  ) v(code, old_name, new_name, site) loop
    update public.banking_partners set
      aliases = case when upper(r.old_name) = any(aliases) then aliases else aliases || upper(r.old_name) end,
      bank_name = case when bank_name = r.old_name then r.new_name else bank_name end,
      website = coalesce(website, r.site)
    where bank_code = r.code;
  end loop;
end $$;
