# Business Setup Base

Database for the `Business Setup Module`, in the CRM Supabase project. Tables are named `business_setup_*`, are read-only through the API, and change through permission-checked functions.

Applied to live on 2026-11-03, with the private fee list. The screens are not published yet. The state before is in schema `bs_rollback` (`rollback/000_snapshot.sql`); `rollback/001_012_rollback.sql` restores it and loses all Business Setup data. `ROLLBACK_TEST=1 bash tests/run-local.sh` tests that on a throwaway database. Drop `bs_rollback` once the module has settled: it holds client records and password hashes.

| Migration | Holds |
|---|---|
| `001_foundation.sql` | Permissions, staff, settings, audit |
| `002_client_master_access.sql` | Client Master rights for Setup roles |
| `003_schema.sql` | Workflow tables |
| `004_hub_extension.sql` | `hub_documents` columns, receipt numbering, letter gate |
| `005_kyc_fees.sql` | KYC, partners, fee list |
| `006_quotes_tracker.sql` | Accept, reject, sign, service tracker |
| `007_payments.sql` | Ledger, receipts, voucher register |
| `008_workspace.sql` | Visas, tasks, files, read functions, dashboard |
| `009_onboarding.sql` | Client form and validation |
| `010_portal.sql` | What a client sees, client logins, invoices table |
| `011_accounts_handover.sql` | Send to Accounts, lock, review |
| `012_legacy_import.sql` | Staging and loading of old records |
| `private/007_fee_seed.sql` | Fee list. Git-ignored. Run after `005` |

Run in number order, after Client Base, Client Login Base, Services Base, Template Hub Base, Voucher Base, Accounting Base and Admin Base.

**Run these again if you re-run an earlier base:**

| If you re-run | Then re-run |
|---|---|
| Client Base `001` | `008` |
| Client Base `002` | `002` |
| Client Base `003` | Client Login Base `001`, then `009` |
| Voucher Base `002` | `007` |

**Tests:** `bash "Database Module/Business Setup Base/tests/run-local.sh"` runs every migration twice and all checks on a throwaway Postgres. Python: `pytest tests/test_legacy_load.py`.

**Old records:** `scripts/legacy_load.py` reads the files in `Business Setup Module/Resources` and writes rows, with `--sql-out` for the staging calls. Its output holds client data, so keep it out of the repository. Save and close the workbooks first.
