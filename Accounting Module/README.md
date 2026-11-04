# Accounting Module

The CRM's **Accounting** page, with a **Business Banking** tab (case validation) , a **Business Setup** tab (quotes the team has finished, in `components/SetupValidation.jsx`), an **Accounting** tab (the job pipeline: jobs, payments, receipts and follow-ups) and the **Salaries** and **Expenses** tabs.

When the business team finishes an approved banking case and sends it to Accounts, the case leaves their lists and cannot be changed by anyone. Accounts reviews it here, then:

- **Validate and close:** the case is Closed, read-only and greyed out in a collapsed section under the business team's lists.
- **Revert:** the case returns to the business team with Accounts' remarks. They fix it and send it again.

| Path | Purpose |
|---|---|
| `components/AccountingModule.jsx` | Page, access check and tabs |
| `components/BankingValidation.jsx` | Business Banking queue and review |
| `components/AccountingDesk.jsx` | Accounting tab: job pipeline, job list and follow-ups |
| `components/Pipeline.jsx`, `components/JobForm.jsx`, `components/JobWorkspace.jsx` | Job list, new job form and the job workspace |
| `components/PaymentsPanel.jsx`, `components/FollowUps.jsx` | Payments and receipts, and follow-up logging |
| `logic/jobs.js` | Pure rules: statuses, receipt modes, payment methods, follow-up channels, Dubai dates |
| `services/jobsApi.js`, `services/receipts.js` | Supabase RPC calls for jobs, payments and receipt filing |
| `index.js` | Module entry point |
| `HR Module/components/SalariesPanel.jsx` | Salaries tab: Payable, Paid and Outstanding from approved pay runs |
| `HR Module/components/ExpensesPanel.jsx` | Expenses tab: claims a Finance Manager approved, and their payment |
| `Database Module/Accounting Base` | Review records, jobs, payments, legacy import, ACCOUNTS role, handover functions |
| `Database Module/Banking Base/migrations/011_banking_handover_accounts.sql` | Case lock and access rules |
| `docs/` | Design spec and implementation plan for the pipeline |
| `tests/logic.test.mjs`, `tests/static.test.mjs` | Unit tests for `logic/jobs.js`, and checks that the RPC calls and constants match the migrations |

The page needs the `accounts.review` permission. Giving someone the Accounting tab grants it; the ACCOUNTS and ADMIN data roles also carry it.

## Tests

```bash
node --test "Accounting Module/tests/"
```

No database is needed. The database tests are in `Database Module/Accounting Base/tests/`; see that README.

## Zoho

The Zoho design is not on `origin/main`. First release uses a manual invoice form on the job (invoice number, date and amount; saving needs the job to be Completed). The invoice amount may differ from the fee, and the panel shows the difference.

Once Zoho is live, `ZohoPanel` is added to the job. These additions are not built here:

| Item | Change |
|---|---|
| `zoho_documents.department` | Add `Accounting` |
| `source_table`, `source_id` | `accounting_jobs` and the job |
| `reference_number` | The job number |
| Line items | One line: the service name and amount due |
| Permission | `accounts.review` |
| Read-back | Saves the Zoho number, date and total on the job. If Zoho's balance differs from the CRM's, the job is flagged and neither value is overwritten |

A job must be linked to a Client Master record before it gets a Zoho draft. Manual invoices have no such need.
