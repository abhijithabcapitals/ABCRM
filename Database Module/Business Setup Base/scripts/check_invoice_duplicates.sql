-- Read-only. Run on the live database BEFORE applying 016 (client flow). Lists every quote that holds the same invoice number more than once in
-- business_setup_invoices. 016 builds a unique index on (quote_id, lower(btrim(invoice_number))); it stops with a plain error if this query returns rows.
-- Empty result = safe to apply. Rows = remove or renumber the extra rows by hand first. The migration changes none of them.
select quote_id,
       lower(btrim(invoice_number)) as invoice_number,
       count(*) as copies,
       array_agg(id order by created_at) as invoice_ids,
       array_agg(source order by created_at) as sources
  from public.business_setup_invoices
 where quote_id is not null and invoice_number is not null
 group by quote_id, lower(btrim(invoice_number))
having count(*) > 1
 order by copies desc, quote_id;
