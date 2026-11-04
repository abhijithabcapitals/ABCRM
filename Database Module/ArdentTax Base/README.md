# ArdentTax Base

Database for the ArdentTax (ASP) tab in `Template Module/ardentax`, in the CRM Supabase project. Applied to live on 2026-11-05 as migration `ardentax_001`.

| Path | Purpose |
|---|---|
| `migrations/001_ardentax.sql` | `ardentax_documents`, the numbering formats, mail defaults, Voucher Register trigger and storage rules |
| `rollback/001_rollback.sql` | Undoes 001. Stops while documents exist unless `ardentax.rollback_force` is `yes` |
| `tests/run-local.sh` | Runs everything on a throwaway local PostgreSQL. Nothing touches Supabase |

Numbers come from the shared `hub_next_number`: `Ardentax/{YYYY}/{MM}/ADTQ{SERIAL}` for quotes and `Ardentax/{YYYY}/{MM}/ADTE{SERIAL}` for letters, 3 digits, never restarting. Both formats can be edited on the Template Hub numbering page.

`hub_next_number` checks only `hub_documents` for a used number, so this table has its own `unique (document_number, version)`. A mistaken counter reset causes an error, not a duplicate.

`ardentax_totals` repeats `computeQuote` in `Template Module/ardentax/logic/quoteModel.js`. Both are tested against `Template Module/ardentax/tests/fixtures/totals.json`. Change them together.

Applying 001 live: check afterwards that `hub_docs_ardentax_read` and `hub_docs_ardentax_insert` exist, because `storage.objects` is owned by `supabase_storage_admin`.
