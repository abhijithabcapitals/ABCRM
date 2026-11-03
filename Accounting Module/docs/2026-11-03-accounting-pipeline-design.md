# Accounting Team pipeline: design

Date: 2026-11-03. Status: awaiting user review. Nothing here is built.

## 1. Purpose

The Accounting Team tracks client work in the old CRM board, which holds no file records, fees or payments. This module tracks each job from the files a client sends through to the final payment.

Done means:

- Staff can see, for any job, which files arrived, when, and how.
- Every open job shows its status, and a Pending job says what is pending.
- New clients get a quotation, an engagement letter and a receipt voucher from the existing document tools.
- A completed job can have its Zoho invoice recorded against it.
- A completed job with money still owed appears in a follow-up list until it is settled.
- All 118 tasks from the old CRM export are in the pipeline.

## 2. Decisions

| Decision | Choice | Source |
|---|---|---|
| Saving files to OneDrive | Pending. Staff file by hand and tick a box | User, 2026-11-03 |
| Coverage | All Accounting Team work: accounting, bookkeeping, audit, CT, VAT, TRC and others | User |
| Files and jobs | One job has many dated file batches, and is invoiced once | User |
| Payment record | Recorded in the CRM, with the Zoho balance added once Zoho is live | User |
| Access | The existing ACCOUNTS role. Everyone in it sees all jobs | User |
| File copies in the CRM | None. Only file names are recorded | Design, approved 2026-11-03 |
| New client steps | A checklist that does not block work | Design, approved 2026-11-03 |
| Sending mail | Staff send. The CRM only drafts | Design, approved 2026-11-03 |

## 3. Workflow

| Step | What staff do | Record |
|---|---|---|
| 1. Open job | Choose client, service, period, assignees, and new or existing client | `accounting_jobs` |
| 2. File batch | Enter date received, mode of receipt and file names. Tick "Saved to client folder" once filed. Repeat per delivery | `accounting_job_batches`, `accounting_job_files` |
| 3. New client steps | Generate the quotation and engagement letter, and record the payment that issues the receipt voucher | `hub_documents`, `accounting_payments`, `accounting_receipts` |
| 4. Work | Done outside the CRM. Staff update the status and remarks | `accounting_jobs`, `accounting_job_events` |
| 5. Invoice | After Completed, enter the Zoho invoice number, date and amount | `accounting_jobs` |
| 6. Follow-up | Log each contact and the next date until the balance is zero | `accounting_followups` |

A job is one service for one period, such as "CT Filing FY2025". Two services for a client means two jobs.

**Service** comes from the live catalogue, using the Accounting and Tax Compliance departments. The job stores the service name as text and its department, so a later catalogue change does not alter old jobs.

**Mode of receipt:** Email, WhatsApp, Hand delivery, Courier, Shared link, Other. Other needs a note.

### Work status

| Status | Rule |
|---|---|
| To Do | The starting status |
| In Progress | |
| Pending | Remarks are required, saying what is pending |
| Completed | Stamps who and when. Unlocks the invoice step |
| Client Cancelled | Remarks are required. Leaves the follow-up list |

Any status can move to any other, with one limit. A job with an invoice recorded cannot leave Completed. To reopen one, staff first clear the invoice, giving a reason. Every change writes an event with the user and time.

### Payment status

This is worked out, never typed. The first row that fits applies.

| Status | Meaning |
|---|---|
| Not tracked | An old job with no fee entered. Creates no reminders |
| No fee | Fee not entered yet |
| Overpaid | Balance below zero, for example after a lower invoice. Shown as a warning for staff to resolve outside the CRM |
| Settled | Balance is zero |
| Part paid | Balance above zero, something paid |
| Invoiced | Invoice recorded, nothing paid |
| Not invoiced | Fee known, no invoice recorded, nothing paid |

**Amount due** is the invoice amount once recorded, otherwise the fee. **Balance** is the amount due minus payments, counting reversals. All amounts are AED totals including any VAT. A fee taken from a quote is the quote's `total_amount`, and a typed fee is treated the same way.

A job paid in full before invoicing shows Settled and still appears under To invoice, because that filter looks only at whether an invoice is recorded.

## 4. New client steps

The job shows three checks when "new client" is ticked: quotation, engagement letter, receipt. Existing clients do not see them, though any job can use them.

- **Quotation and letter:** reuse `ServiceDesk` and `hub_document_create`. `ServiceDesk` gains two optional props: details to fill the form with, and a callback that saves the new document's ID on the job. The current behaviour stays when they are absent. Its department is the job's department, so the existing numbering applies: `ACQ` and `ACE` for Accounting, `TCQ` and `TCE` for Tax Compliance.
- **Fee:** generating a quote from a job sets the job's fee from the quote total if no fee is set. If a fee exists and differs, staff choose which to keep.
- **Receipt:** recording a payment on any job issues a receipt voucher. Numbers come from a new single series for all jobs, `ABC/{YYYY}/{MM}/ACR{SERIAL}`, added under `Accounting` in `hub_settings`.
- **Agreement:** this means the engagement letter. Tracking of signed copies is left out.

## 5. Payments and follow-up

**Payments** follow the Business Setup pattern: `accounting_payment_add` writes the payment and its receipt in one transaction. Payments are never edited. A mistake is fixed by a reversal, which marks the receipt as reversed in the voucher register.

- A payment needs a fee on the job, and cannot exceed the balance.
- A payment may be recorded before completion, as an advance.
- The receipt file uses `receiptDocx` from `@banking/logic/documents`, as Business Setup does. It is stored in the private online storage used for Business Setup receipts, and also downloaded.
- If saving the receipt file fails, the payment stands and the job offers "Create file".
- Payment methods: Bank transfer, Cash, Cheque, Card, Other.

**Follow-ups tab** lists jobs that are Completed with a balance above zero, oldest first. The tab shows the number of jobs due, meaning those with no next date, or a next date of today or earlier in Asia/Dubai time.

Each follow-up records the date, channel, note and next date. The next date defaults to 7 days ahead. The log is append-only.

A **draft mail** states the job, invoice number and balance. It offers Copy and Open in email, as `ServiceDesk` does. It is not stored, and nothing is sent from the CRM.

The **To invoice** filter on the Pipeline tab lists Completed jobs with no invoice recorded, except Not tracked jobs. A job with a fee and no invoice appears in both places, since money is owed. A job with no fee appears only under To invoice, marked "Fee missing".

## 6. Zoho

**First release:** a manual form holds the invoice number, date and amount. Saving needs the job to be Completed. The invoice amount may differ from the fee, and the panel shows the difference.

**Once Zoho is live:** `ZohoPanel` is added to the job. The Zoho design needs these additions, which are not built here:

| Item | Change |
|---|---|
| `zoho_documents.department` | Add `Accounting` |
| `source_table`, `source_id` | `accounting_jobs` and the job |
| `reference_number` | The job number |
| Line items | One line: the service name and amount due |
| Permission | `accounts.review` |
| Read-back | Saves the Zoho number, date and total on the job. If Zoho's balance differs from the CRM's, the job is flagged and neither value is overwritten |

Zoho links need a `client_master` ID, so a job must be linked to a Client Master record before it gets a Zoho draft. Manual invoices have no such need.

## 7. Data

All in `Database Module/Accounting Base`, from migration `002`. Row level security on every table. Reads need `banking_can('accounts.review')`. All writes go through security definer functions that call `banking_require('accounts.review')`. All tables get the audit trail trigger from `Admin Base/migrations/003_audit_trail.sql`.

**`accounting_jobs`**

| Column | Notes |
|---|---|
| `id`, `job_number` | `job_number` is `JOB-000001`, from a sequence |
| `client_id` | Nullable. References `client_master` |
| `client_name` | Required text |
| `service_name`, `service_department` | From the catalogue. Old jobs may hold an old label, see section 8 |
| `period_label`, `due_date` | Optional |
| `is_new_client` | Boolean |
| `assignee_ids`, `legacy_assignees` | `uuid[]`, and text for old names with no CRM user |
| `work_status`, `remarks` | Check constraint as in section 3 |
| `completed_at`, `completed_by` | |
| `fee_amount`, `payment_tracked` | `payment_tracked` is false only on old Done jobs with no fee. Entering a fee sets it to true |
| `quote_id`, `letter_id` | Reference `hub_documents` |
| `invoice_number`, `invoice_date`, `invoice_amount`, `invoiced_by`, `invoiced_at` | Zoho's number, entered by hand |
| `next_follow_up_on` | Copied from the latest follow-up |
| `legacy_key`, `legacy_raw` | Unique import key, and the original row as JSON |
| `created_at`, `created_by`, `updated_at` | Old jobs use the old CRM's created date |

**`accounting_job_batches`:** `job_id`, `received_on`, `receipt_mode`, `mode_note`, `saved_to_folder`, `saved_by`, `saved_at`, `notes`, `created_by`. The date cannot be in the future, and a batch needs at least one file name. A later OneDrive build adds its own columns.

**`accounting_job_files`:** `batch_id`, `file_name`, `notes`. Names only, with no file content.

**`accounting_job_events`:** append-only. `job_id`, `event`, `from_value`, `to_value`, `remarks`, `created_by`, `created_at`.

**`accounting_payments`:** append-only. `job_id`, `paid_on`, `amount`, `method`, `reference`, `note`, `reverses_id`, `created_by`, `created_at`. A reversal is a row with a negative amount.

**`accounting_receipts`:** `payment_id`, `receipt_number`, `issued_on`, `storage_path`.

**`accounting_followups`:** append-only. `job_id`, `contacted_on`, `channel`, `note`, `next_follow_up_on`, `created_by`, `created_at`.

**`accounting_legacy_rows`:** import staging. `legacy_key`, `raw`, `state` (`staged`, `committed`, `held`), `reason`, `job_id`.

**`accounting_job_list`:** a view with the worked-out amount due, paid total, balance and payment status, so the list, the Follow-ups tab and the badge agree.

**Voucher register:** the `source` check gains `accounting`, and a trigger on `accounting_receipts` adds the register row. The register needs no change to `voucher_set_local`, because this module keeps no PC copies.

## 8. Old CRM import

The source is `Accounting Module/Resources/Accounting_Team_export_all_2026-11-03.csv`, which is git-ignored. The flow copies Banking's import: a script loads staging rows, a dry run reports, then an apply function commits.

| Old column | New field |
|---|---|
| Task Name | `client_name` |
| Type of work | `service_name`, see below |
| Status | To Do, In Progress and Client Cancelled unchanged. Done becomes Completed |
| Assignee | `assignee_ids` where the name matches one CRM profile, otherwise `legacy_assignees` |
| Date Created, Date Done, Due Date | `created_at`, `completed_at`, `due_date`. One Done task has no Date Done, so its `completed_at` stays empty |
| Comment (short text), Remarks, Description | `remarks`. An empty `<p></p>` is ignored |
| All columns | `legacy_raw` |

**Type mapping**

| Old type | Service | Tasks |
|---|---|---|
| CT Filing | Corporate Tax Return Filing | 37 |
| CT Registration | Corporate Tax Registration | 15 |
| CT Deregistration | Corporate Tax Deregistration | 10 |
| VAT Registration | VAT Registration | 14 |
| VAT Refund | VAT Refund Assistance | 1 |
| TRC | UAE Tax Residency Certificate Assistance | 5 |
| Accounting | Accounting Services | 14 |
| Audit, Liquidation report, Clearance Certificate, CRN TRN, NETWORTH, Other | Keep the old label, since no catalogue service matches exactly | 22 |

**Rules**

- **Key:** the export has no task ID, so `legacy_key` is a hash of the name, type and created date. A later export reloads safely, and a row whose key exists is skipped.
- **Repeats:** when a key appears twice, both rows are held for review. Today that is one client (invented name here: SAMPLE REPEAT CO), CT Filing, 2026-03-07.
- **Same client, same type, other date:** imported as separate jobs. Today that is one client (invented name here: SAMPLE HOLDING LIMITED), CT Filing.
- **Client link:** set only when the name exactly matches one `client_master` record. Live has one record today, so nearly all stay as text. Name variants such as ZENITH TRADING FZCO and ZENITH TRADING - FZCO (invented names) are not merged.
- **Payments:** Done jobs have `payment_tracked` false. Open jobs start with no fee.
- **Old comments about money:** rows whose comment mentions payment are listed in the dry run report, so staff can enter a fee and start tracking them. Today that is 3 rows: 1 Done and 2 In Progress.
- **Assignees:** on 2026-11-03, two staff names matched a profile, others did not. The names that did not match stay as text unless the profiles exist by import time.

## 9. Screens

The **Accounting** tab of `AccountingModule.jsx` gets three inner tabs. The other Accounting tabs are unchanged.

| Tab | Content |
|---|---|
| Pipeline | Job list with status chips, search, and filters for service, assignee, Pending and To invoice. A New job button |
| Follow-ups | Jobs owed money, with the due count on the tab |
| Quotes and Agreements | `ServiceDesk`, as it is today |

The **job workspace** opens from a row and has these sections: Summary and status, File batches, New client steps (when ticked), Payments, Invoice, Follow-ups, History. It reuses Banking's shared components and styles through the `@banking` alias.

| Path | Purpose |
|---|---|
| `components/Pipeline.jsx` | List and filters |
| `components/JobForm.jsx` | New and edit |
| `components/JobWorkspace.jsx` | The job's sections |
| `components/FollowUps.jsx` | Follow-up list, log and draft mail |
| `logic/jobs.js` | Pure rules: file list parsing, remarks rule, Dubai date, draft mail text. Payment status, balance and the due check live only in `accounting_job_list` |
| `services/jobsApi.js` | Calls to the database functions |
| `scripts/legacy_load.py` | Loads the CSV into staging |

## 10. Failures

| Case | Behaviour |
|---|---|
| Pending or Cancelled with no remarks | Save refused, field flagged |
| Invoice on a job not Completed | Refused by the database |
| Payment above the balance, or with no fee | Refused, with the reason |
| Receipt file fails after payment saved | Payment stands, "Create file" offered |
| Two people save the same job | The later save is refused and asks them to reload, by comparing `updated_at` |
| Client lookup fails | The form still works by hand, as today |
| User without the role | The existing "Only the Accounts team" notice |

## 11. Testing

- **Database:** SQL tests in `Accounting Base/tests`, run through the local harness pattern used in `Admin Base/tests`. They cover status rules, payment limits, reversals, the view's payment status, access refused without the role, append-only tables, and import repeats.
- **Logic:** unit tests for `logic/jobs.js`.
- **Import:** a dry run on the real CSV. It must report 118 rows: 116 to commit and 2 held.
- **Browser:** the whole path with a test job, using a real login. This has to be done on live or by the user, since no test Supabase project exists. Test records need the user's agreement, because receipts take real serial numbers.

## 12. Dependencies and risks

- **Branch:** a new worktree from `origin/main`, on branch `accounting-pipeline`. No other branch is needed for the first release.
- **Live ahead of main:** live already has Business Setup migrations that `main` lacks, including its voucher `source` value and the current `hub_next_number`. Migration `002` is written against live and must keep `business_setup` in the check.
- **Business Setup merge:** re-running its migration `007`, or any later change to the voucher `source` check, must keep `accounting`. The check on those files happens at merge time.
- **Access:** nobody holds ACCOUNTS on live today. Until an admin assigns it, only admins can open the page. The role also opens Salaries and Expenses, as the user chose.
- **Client records:** with one Client Master record live, most jobs cannot get a Zoho draft until records are added.
- **Rollback:** each migration gets a script in `migrations/rollback`, as in Banking Base.

## 13. Release order

Each live step needs separate approval.

1. Apply migrations to live.
2. Stage the import, and let the user review the dry run report.
3. Apply the import.
4. Publish the screens to `main` and GitHub Pages.
5. An admin assigns ACCOUNTS to the team.
6. Add Zoho once that connection is live.

## 14. Open questions

These have defaults, which apply unless changed.

| Question | Default |
|---|---|
| Receipt number format | `ABC/{YYYY}/{MM}/ACR{SERIAL}` |
| Should old Audit tasks map to one catalogue service? | No, they keep the label "Audit" |
| Follow-up gap | 7 days, editable on each entry |
| Payment methods | As in section 5 |

## 15. Not in this version

Saving to OneDrive, file uploads or OCR, automatic mail or scheduled reminders, recurring job creation, client portal access, signed agreement tracking, one payment across several jobs, refunds on cancelled jobs, and the Zoho connection itself.
