# Accounting Base

Database for the `Accounting Module`, in the CRM Supabase project. This folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_banking_validation.sql` | `accounting_case_reviews` (every send, validation and revert, append-only), the ACCOUNTS role, and the handover functions |
| `migrations/002_jobs.sql` | Jobs, file batches and the invoice record. Rollback: `migrations/rollback/002_rollback.sql` |
| `migrations/003_payments_followups.sql` | Payments, receipts, follow-ups, the job list view, `accounting_client_options()` (the client master for `accounts.review` users, who lack the `kyc.view` that `client_lookup` needs) and the restrictive `storage.objects` policy on `Accounting/receipts/`. Rollback: `migrations/rollback/003_rollback.sql` |
| `migrations/004_legacy_import.sql` | Staging for the old CRM import and the apply function. Rollback: `migrations/rollback/004_rollback.sql` |
| `scripts/legacy_load.py` | Turns the old CRM Accounting export (CSV) into staging inserts for 004 |
| `tests/000_stub.sql` | Stubs of what migrations 002 onward need from Supabase and the live CRM (auth, profiles, client master, Template Hub numbering, voucher register, `banking_can`, `storage.objects`). Migration 001 needs the Banking tables, which are not stubbed, so it is not run here |
| `tests/010_jobs_test.sql` | Job creation, status moves and version stamp, Dubai dates, imported jobs |
| `tests/020_invoice_links_test.sql` | Invoice record, client and document links |
| `tests/030_payments_test.sql` | Who may call what, payments and receipts, follow-ups, the job list view, direct-edit refusal |
| `tests/040_legacy_test.sql` | Legacy staging rows, apply, repeat runs, who may call and read |
| `tests/test_legacy_load.py` | Python unit tests for `scripts/legacy_load.py` |
| `tests/run-local.sh` | Runs migrations 002 to 005 twice on a throwaway local PostgreSQL, then every SQL test. Nothing touches Supabase |

Run it after `Banking Base/migrations/011`. Banking Base holds the case itself, including its status and the lock.

## Run order

Run after Banking Base 011, Voucher Base, Template Hub Base and Business Setup Base `007`:

1. `migrations/001_banking_validation.sql`
2. `migrations/002_jobs.sql`
3. `migrations/003_payments_followups.sql`
4. `migrations/004_legacy_import.sql`
5. `migrations/005_job_fee_vat.sql` (fee VAT; undo with `rollback/005_rollback.sql`)

Undo in reverse order: 005, then 004, then 003, then 002, each with its rollback script. Roll back anything built on 003 before 003.

## Tests

```bash
bash "Database Module/Accounting Base/tests/run-local.sh"
python -m unittest discover -s "Database Module/Accounting Base/tests" -p "test_*.py"
```

`run-local.sh` needs PostgreSQL 18 at `C:\Program Files\PostgreSQL\18\bin` (or set `PG_BIN`).

## Warning: keep `accounting` in the voucher `source` check

Migration `003` sets the voucher `source` check to `banking`, `hub`, `template`, `business_setup` and `accounting`. Accounting vouchers need `accounting` in that check, so any later change to it must keep `accounting`. Voucher Base `002` and Business Setup `007_payments.sql` reset the same check and list all five sources. Business Setup `rollback/001_012_rollback.sql` deletes only its own receipt counter, so Accounting's `ACR` serials stay.
