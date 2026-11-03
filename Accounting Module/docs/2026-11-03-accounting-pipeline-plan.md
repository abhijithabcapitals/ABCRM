# Accounting Team Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track each Accounting Team job from files received through to final payment, and load the 118 old CRM tasks.

**Architecture:** New `accounting_*` tables in `Database Module/Accounting Base`, written only through security definer functions and read through the view `accounting_job_list`, which alone works out balances and payment status. New screens in `Accounting Module` reuse Banking's shared components, Template Hub's `ServiceDesk`, Banking's receipt template and the voucher register.

**Tech Stack:** React and Vite (`Main Module`), Supabase Postgres and Storage, `node --test`, a throwaway local Postgres 18 for SQL tests, Python 3.12 for the import script.

**Spec:** `Accounting Module/docs/2026-11-03-accounting-pipeline-design.md`

## Global Constraints

- Work on branch `accounting-pipeline`, in worktree `D:\Abhijith Projects\CRM-accounting`, cut from `origin/main`.
- Nothing touches live until Task 10, and each step of Task 10 needs the user's approval.
- All reads need `banking_can('accounts.review')`. All writes go through functions calling `banking_require('accounts.review')`. No table grants insert, update or delete to `authenticated`.
- Migrations are re-runnable, and each has a script in `migrations/rollback`.
- The CRM sends no mail and writes nothing to Zoho or OneDrive.
- Receipt format: `ABC/{YYYY}/{MM}/ACR{SERIAL}`, 3 digits, restart never.
- Dates that decide "today" use Asia/Dubai.
- `Resources/` and generated import SQL hold client data and are never committed.
- Modes of receipt: Email, WhatsApp, Hand delivery, Courier, Shared link, Other.
- Work statuses: To Do, In Progress, Pending, Completed, Client Cancelled.
- Payment methods: Bank transfer, Cash, Cheque, Card, Other.

## Review Focus

1. A cancelled job with money already paid or owed: it leaves Follow-ups, and its payments stay. Test in Task 3.
2. Reversing a payment twice, or reversing a reversal: refused. Test in Task 3.
3. A job due for follow-up at 00:30 Dubai time, which is still the previous day in UTC: counts as due that Dubai day. Tests in Tasks 1 and 3.
4. Running the import again after staff edited a job: the job is untouched and nothing doubles. Test in Task 4.
5. A pasted file list with blank lines, repeats and spaces: stored once each, and a list of only blanks is refused. Tests in Tasks 1 and 2.

---

## File Structure

| Path | Responsibility |
|---|---|
| `Database Module/Accounting Base/migrations/002_jobs.sql` | Jobs, batches, files, events, job and invoice functions |
| `.../003_payments_followups.sql` | Payments, receipts, voucher hooks, follow-ups, receipt numbering, `accounting_job_list` |
| `.../004_legacy_import.sql` | Staging table and apply function |
| `.../rollback/00N_rollback.sql` | Undo for each |
| `Database Module/Accounting Base/tests/` | `000_stub.sql`, `run-local.sh`, one test file per migration |
| `Database Module/Accounting Base/scripts/legacy_load.py` | CSV to staging SQL |
| `Accounting Module/logic/jobs.js` | Pure rules: file list parsing, remarks rule, Dubai date, draft mail |
| `Accounting Module/services/jobsApi.js` | Database calls |
| `Accounting Module/services/receipts.js` | Builds and files the receipt |
| `Accounting Module/components/Pipeline.jsx`, `JobForm.jsx`, `JobWorkspace.jsx`, `PaymentsPanel.jsx`, `FollowUps.jsx`, `AccountingDesk.jsx` | Screens |
| `Accounting Module/tests/` | `logic.test.mjs`, `static.test.mjs` |

---

### Task 1: Worktree and pure rules

**Files:**
- Create: `Accounting Module/logic/jobs.js`
- Test: `Accounting Module/tests/logic.test.mjs`

**Interfaces:**
- Produces: `parseFileNames(text: string) -> string[]`, `needsRemarks(status: string) -> boolean`, `dubaiToday(now?: Date) -> "YYYY-MM-DD"`, `nextFollowUpDefault(now?: Date) -> "YYYY-MM-DD"`, `followUpMail(job, sender) -> {subject, body}`, `WORK_STATUSES`, `RECEIPT_MODES`, `PAYMENT_METHODS`, `FOLLOW_UP_CHANNELS`.

- [ ] **Step 1: Create the worktree and bring the docs**

```bash
git -C "D:/Abhijith Projects/CRM" worktree add "D:/Abhijith Projects/CRM-accounting" -b accounting-pipeline origin/main
```

Move `Accounting Module/docs/` from the main checkout into the worktree. Do not touch anything else in the main checkout.

- [ ] **Step 2: Write the failing tests**

```js
test("parseFileNames trims, drops blanks and repeats", () => {
  assert.deepEqual(parseFileNames(" a.pdf \n\n b.pdf\na.pdf\r\n  "), ["a.pdf", "b.pdf"]);
  assert.deepEqual(parseFileNames(" \n "), []);
});
test("needsRemarks", () => {
  assert.equal(needsRemarks("Pending"), true);
  assert.equal(needsRemarks("Client Cancelled"), true);
  assert.equal(needsRemarks("In Progress"), false);
});
test("dubaiToday uses Asia/Dubai", () => {
  assert.equal(dubaiToday(new Date("2026-11-03T20:30:00Z")), "2026-11-04");
});
test("nextFollowUpDefault is 7 days from the Dubai date", () => {
  assert.equal(nextFollowUpDefault(new Date("2026-11-03T20:30:00Z")), "2026-11-11");
});
test("followUpMail states job, invoice and balance", () => {
  const m = followUpMail({ client_name: "ACME", service_name: "VAT Registration", period_label: "2026", job_number: "JOB-000001", invoice_number: "INV-9", balance: 1250.5 }, "Tara");
  assert.match(m.subject, /JOB-000001/);
  for (const part of ["ACME", "VAT Registration", "INV-9", "1,250.50", "Tara"]) assert.match(m.body, new RegExp(part));
});
test("followUpMail omits the invoice line when no invoice is recorded", () => {
  assert.doesNotMatch(followUpMail({ client_name: "A", service_name: "S", job_number: "J", invoice_number: null, balance: 1 }, "N").body, /[Ii]nvoice/);
});
```

- [ ] **Step 3: Run and see it fail**

Run: `node --test "Accounting Module/tests/"`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `logic/jobs.js`**

No imports, so tests run without Vite. Use `Intl.DateTimeFormat` with `timeZone: "Asia/Dubai"`. Do not use `today()` from Banking's `shared.jsx`, which returns the UTC date. `FOLLOW_UP_CHANNELS`: Phone, Email, WhatsApp, In person, Other.

- [ ] **Step 5: Run and see it pass**

Run: `node --test "Accounting Module/tests/"`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "Accounting Module/docs" "Accounting Module/logic" "Accounting Module/tests"
git commit -m "Add Accounting pipeline spec, plan and rules"
```

---

### Task 2: Jobs, batches and invoice in the database

**Files:**
- Create: `Database Module/Accounting Base/migrations/002_jobs.sql`, `migrations/rollback/002_rollback.sql`, `tests/000_stub.sql`, `tests/run-local.sh`, `tests/010_jobs_test.sql`

**Interfaces:**
- Consumes: live `banking_can(text)`, `banking_require(text)`, `banking_append_only()`, `hub_documents`, `client_master(client_id text, legal_name text)`.
- Produces, all security definer and all requiring `accounts.review`:
  - `accounting_job_save(p jsonb) returns accounting_jobs`. Creates with no `id`, edits with `id` and `expected_updated_at`.
  - `accounting_job_set_status(p_job uuid, p_status text, p_remarks text, p_expected timestamptz) returns void`
  - `accounting_job_set_fee(p_job uuid, p_amount numeric) returns void`
  - `accounting_job_link_document(p_job uuid, p_kind text, p_doc uuid, p_use_quote_total boolean) returns void`
  - `accounting_job_link_client(p_job uuid, p_client text) returns void`
  - `accounting_batch_add(p jsonb) returns uuid`, with `p.files` a JSON array of names
  - `accounting_batch_set_saved(p_batch uuid, p_saved boolean) returns void`
  - `accounting_invoice_set(p_job uuid, p_number text, p_date date, p_amount numeric) returns void`
  - `accounting_invoice_clear(p_job uuid, p_reason text) returns void`

Tables are as in spec section 7, with these additions: `accounting_jobs.updated_at`, `accounting_job_batches.created_at`, `accounting_job_files.id`. `job_number` comes from sequence `accounting_job_seq`, formatted `JOB-000001`.

- [ ] **Step 1: Write the harness**

`run-local.sh` follows `Admin Base/tests/run-local.sh` on port 55435. It runs migrations 002 onward twice, then each test file, and prints lines matching `ok |FAILED|ERROR`. Any such failure line must exit non-zero.

`000_stub.sql` stubs `anon`, `authenticated`, `auth.uid()` read from `test.uid`, `profiles`, `client_master`, `hub_documents` (with `id, doc_type, total_amount`), `hub_settings`, `voucher_register` with today's live columns and `source` check, `voucher_serial`, a working `hub_next_number`, and `banking_append_only`. No audit trail stub is needed. `banking_can` and `banking_require` return true only when `test.uid` is the stub's ACCOUNTS user.

- [ ] **Step 2: Write the failing tests in `010_jobs_test.sql`**

Each prints `ok <name>` or raises `FAILED <name>`:

- `job_number_format`: first job is `JOB-000001`
- `client_and_service_required`: blank `client_name` or `service_name` is refused
- `no_role_refused`: another user's save raises, and a direct `select` under role `authenticated` returns 0 rows
- `direct_write_refused`: `insert` as `authenticated` raises permission denied
- `pending_needs_remarks`: `Pending` with blank remarks raises, and with `'Waiting for bank statement'` works
- `cancelled_needs_remarks`
- `completed_stamps`: sets `completed_at` and `completed_by`, and leaving Completed clears both
- `bad_status_refused`: `'Done'` raises
- `stale_save_refused`: an old `p_expected` raises text containing `reload`
- `event_written`: a status change adds an event with `from_value`, `to_value`
- `events_append_only`: update and delete on events raise
- `batch_needs_files`: empty `files`, or only blank names, raises
- `batch_no_future_date`: tomorrow in Dubai raises
- `batch_other_needs_note`: mode `Other` with no `mode_note` raises
- `batch_bad_mode_refused`: `Fax` raises
- `batch_repeats_stored_once`: `["a.pdf"," a.pdf "]` stores 1 row
- `saved_tick_stamps`: sets `saved_by`, `saved_at`, and unticking clears them
- `invoice_needs_completed`: on In Progress raises
- `invoice_needs_number_and_positive_amount`
- `completed_with_invoice_locked`: moving away raises until `accounting_invoice_clear` runs
- `invoice_clear_needs_reason`: blank reason raises, and a good reason writes an event holding the old number
- `fee_sets_tracked`: `payment_tracked` false becomes true when a fee is entered
- `invoice_sets_tracked`: the same when an invoice is recorded on an old job with no fee
- `fee_not_negative`
- `link_quote_takes_total`: `p_use_quote_total` true sets the fee to `total_amount`, false keeps it, and a null fee is always filled
- `link_wrong_doc_type_refused`: a `letter` as `quote` raises
- `link_client_must_exist`

- [ ] **Step 3: Run and see it fail**

Run: `bash "Database Module/Accounting Base/tests/run-local.sh"`. Expected: FAILED, migration missing.

- [ ] **Step 4: Write `002_jobs.sql` and `rollback/002_rollback.sql`**

Enable row level security with one select policy per table using `banking_can('accounts.review')`. Grant `select` only to `authenticated`. `accounting_job_files` and batches are not append-only, since the saved tick changes. Revoke execute on all functions from `public` and `anon`, and grant to `authenticated`. Set `updated_at` in every write function. Audit triggers come from the live `audit-trail-attach` job, so the migration adds none.

- [ ] **Step 5: Run and see it pass**

Run the harness. Expected: both migration passes, and every test `ok`.

- [ ] **Step 6: Commit**

```bash
git add "Database Module/Accounting Base"
git commit -m "Add Accounting jobs, file batches and invoice records"
```

---

### Task 3: Payments, receipts, follow-ups and the job list view

**Files:**
- Create: `Database Module/Accounting Base/migrations/003_payments_followups.sql`, `migrations/rollback/003_rollback.sql`, `tests/020_payments_test.sql`
- Modify: `tests/run-local.sh`

**Interfaces:**
- Consumes: Task 2's tables.
- Produces:
  - `accounting_payment_add(p jsonb) returns jsonb`. Keys in: `job_id, amount, paid_on, method, reference, note`. Keys out: `payment_id, receipt_id, receipt_number, amount, paid_on, method, reference`.
  - `accounting_payment_reverse(p_payment uuid, p_reason text) returns void`
  - `accounting_receipt_attach(p_id uuid, p_path text) returns void`
  - `accounting_followup_add(p jsonb) returns uuid`. Keys: `job_id, contacted_on, channel, note, next_follow_up_on`.
  - View `accounting_job_list`: all job columns, plus `amount_due, paid_total, balance, payment_status, needs_invoice, follow_up_listed, follow_up_due`.

Add `note text` to `accounting_payments`, for the reversal reason. A reversal is a row with a negative amount and `reverses_id`. `paid_total` is the sum of `amount`.

View rules, in this order for `payment_status`:

```sql
case
  when not payment_tracked and fee_amount is null then 'Not tracked'
  when fee_amount is null and invoice_amount is null then 'No fee'
  when balance < 0 then 'Overpaid'
  when balance = 0 then 'Settled'
  when paid_total > 0 then 'Part paid'
  when invoice_number is not null then 'Invoiced'
  else 'Not invoiced'
end
```

- `needs_invoice`: Completed, no invoice, and not Not tracked.
- `follow_up_listed`: Completed and `balance > 0`.
- `follow_up_due`: listed, and `next_follow_up_on` is null or on or before `(now() at time zone 'Asia/Dubai')::date`.

The view uses `security_invoker = true`, so table policies apply. Voucher register: drop and re-add the `source` check with `'banking','hub','template','business_setup','accounting'`. Do not replace `voucher_set_local`. Add `receipt` under `Accounting` in `hub_settings.document_numbering` only when absent, keeping all other keys.

- [ ] **Step 1: Write the failing tests in `020_payments_test.sql`**

- `payment_writes_receipt`: number matches `ABC/YYYY/MM/ACR001`, and one voucher row has source `accounting`, type `Receipt`, status `Valid`
- `payment_needs_fee`: with no fee and no invoice, raises text containing `fee`
- `payment_above_balance_refused`: fee 1000, pay 1000.01 raises
- `payment_bad_amount`: 0, negative, and 1.234 raise
- `payment_no_future_date`
- `payment_bad_method`
- `advance_allowed`: works on an In Progress job
- `payments_append_only`
- `reverse_restores_balance`: fee 1000, paid 400, reversed: `balance` 1000, voucher `Reversed`
- `reverse_needs_reason`
- `double_reverse_refused`: raises the second time
- `reverse_of_reversal_refused`
- `attach_updates_voucher`: path lands on receipt and voucher rows
- `status_not_tracked`: `payment_tracked` false, no fee
- `status_no_fee`
- `status_not_invoiced`: fee 1000
- `status_invoiced`: invoice 1000, nothing paid
- `status_part_paid`: invoice 1000, paid 400, balance 600
- `status_settled`: paid in full
- `status_overpaid`: paid 1000, invoice then 900, balance -100
- `invoice_overrides_fee`: fee 1000, invoice 1050, amount due 1050
- `settled_before_invoice_still_needs_invoice`: paid in full, Completed, no invoice: Settled and `needs_invoice` true
- `no_fee_needs_invoice_not_followup`: Completed with no fee: `needs_invoice` true, `follow_up_listed` false
- `not_tracked_never_listed`: both false
- `fee_no_invoice_in_both`: Completed, fee, no invoice: `needs_invoice` and `follow_up_listed` both true
- `incomplete_not_listed`: In Progress with a balance: not listed
- `cancelled_leaves_followups`: Completed with balance and part paid, moved to Client Cancelled: not listed, `paid_total` unchanged
- `followup_needs_note_channel`
- `followup_sets_next_date`: job's `next_follow_up_on` updates, and the log is append-only
- `followup_past_next_date_refused`: a next date before today in Dubai raises
- `due_uses_dubai_date`: with `next_follow_up_on` equal to the Dubai date at a moment when the UTC date is one day earlier, `follow_up_due` is true. Compute both dates in the test using `now()`, and skip with `ok` only when they coincide
- `not_due_when_future`
- `view_hidden_without_role`: 0 rows as another user
- `numbering_kept`: `Accounting.quote` still present after a second migration pass, and an existing `receipt` setting is not overwritten
- `voucher_check_keeps_business_setup`: inserting source `business_setup` works

- [ ] **Step 2: Run and see it fail**

Run the harness. Expected: FAILED, function missing.

- [ ] **Step 3: Write `003_payments_followups.sql` and its rollback**

Copy the amount parsing and validation of `business_setup_payment_add` from `Database Module/Business Setup Base/migrations/007_payments.sql` on branch `business-setup-module`, without its override path. Lock the job row `for update` before reading the balance, so two payments cannot both pass. The voucher triggers follow `voucher_from_business_setup_receipt` and `voucher_from_business_setup_payment` in that file, with `department` set to `Accounting` and `client_name` from the job.

- [ ] **Step 4: Run and see it pass**

Run the harness. Expected: every test `ok`.

- [ ] **Step 5: Commit**

```bash
git add "Database Module/Accounting Base"
git commit -m "Add Accounting payments, receipts, follow-ups and job list"
```

---

### Task 4: Old CRM import

**Files:**
- Create: `Database Module/Accounting Base/migrations/004_legacy_import.sql`, `migrations/rollback/004_rollback.sql`, `scripts/legacy_load.py`, `tests/030_legacy_test.sql`, `tests/test_legacy_load.py`
- Modify: `tests/run-local.sh`, `.gitignore` if `Database Module/Accounting Base/data/` is not already ignored

**Interfaces:**
- Consumes: Task 2's `accounting_jobs`.
- Produces:
  - `legacy_load.py <csv> --out <file.sql>`: prints the dry run report, writes `insert` statements. Pure functions: `legacy_key(name, type, created) -> str`, `map_row(row) -> dict`, `mark_repeats(rows) -> rows`, `parse_args`.
  - `accounting_legacy_rows(id, row_no, legacy_key, raw jsonb, mapped jsonb, state, reason, job_id)`, unique on `(legacy_key, row_no)`.
  - `accounting_legacy_apply() returns jsonb` with `committed, already_there, held, linked_clients`. Execute is revoked from `authenticated`, so it runs only from the Supabase CLI.

- [ ] **Step 1: Write failing Python tests, using `unittest`**

```python
def test_key_ignores_case_and_spaces(self):
    self.assertEqual(legacy_key(" Acme ", "CT Filing", "2026-03-07"), legacy_key("ACME", "CT Filing", "2026-03-07"))
def test_type_map(self):
    self.assertEqual(map_row(row(type="CT Filing"))["service_name"], "Corporate Tax Return Filing")
    self.assertEqual(map_row(row(type="TRC"))["service_department"], "Tax Compliance")
    self.assertEqual(map_row(row(type="Audit"))["service_name"], "Audit")
def test_done_is_completed_untracked(self):
    m = map_row(row(status="Done", done="2026-04-03"))
    self.assertEqual((m["work_status"], m["payment_tracked"], m["completed_at"]), ("Completed", False, "2026-04-03"))
def test_open_is_tracked(self):
    self.assertTrue(map_row(row(status="In Progress"))["payment_tracked"])
def test_remarks_join_and_empty_html(self):
    self.assertEqual(map_row(row(comment="Applied", remarks="", description="<p></p>"))["remarks"], "Applied")
def test_repeats_hold_both(self):
    self.assertEqual([r["state"] for r in mark_repeats([row(), row()])], ["held", "held"])
def test_real_csv_counts(self):  # skipped when the git-ignored CSV is absent
    # 118 rows, 116 staged, 2 held (invented name here: SAMPLE REPEAT CO), 3 rows flagged for money comments
```

Full type map from spec section 8. `service_department`: CT, VAT and TRC types are `Tax Compliance`, all others `Accounting`.

- [ ] **Step 2: Write failing SQL tests in `030_legacy_test.sql`**

- `apply_creates_jobs`: staged rows become jobs with `created_at` from the old date and an `imported` event
- `apply_skips_held`: held rows make no job
- `assignee_alias`: `Geo AB Capital` matches profile `GEO`, `TARA QUILL` matches `Tara Quill` in any case, `Omar Fictus` stays in `legacy_assignees`
- `assignee_two_profiles_stay_text`: a name matching two profiles is kept as text
- `client_link_exact_only`: links on one exact `legal_name` match, ignoring case and outer spaces, and not on `ZENITH TRADING FZCO` against `ZENITH TRADING - FZCO`
- `rerun_no_double`: second apply creates nothing
- `rerun_keeps_staff_edits`: after a job's fee and status are changed, staging the same key again and applying leaves them, and the staging row becomes `committed` with reason `already there`
- `apply_refused_for_staff`: `authenticated` lacks execute

- [ ] **Step 3: Run both and see them fail**

Run: `python -m unittest discover -s "Database Module/Accounting Base/tests" -p "test_*.py"`, then the harness. Expected: FAIL.

- [ ] **Step 4: Write `legacy_load.py` and `004_legacy_import.sql`, with its rollback**

Read with `csv` and `encoding="utf-8-sig"`. `ALIASES = {"Geo AB Capital": "GEO"}`. Parse only `Date Created`, `Date Done` and `Due Date`, which are ISO in the export. Keep the whole row in `raw`. The script connects to nothing. Output belongs in `Database Module/Accounting Base/data/`, which stays git-ignored. The report prints totals by status and type, held rows, and money comment rows. Profile matching happens in `accounting_legacy_apply`, whose result lists names left as text.

- [ ] **Step 5: Run and see them pass**

Run both commands from Step 3. Then run the script on `D:\Abhijith Projects\CRM\Accounting Module\Resources\Accounting_Team_export_all_2026-11-03.csv`, which is git-ignored and so exists only in the main checkout, writing to a scratch file outside the repo. `test_real_csv_counts` reads the same absolute path. Expected: `118 rows, 116 staged, 2 held`.

- [ ] **Step 6: Commit**

```bash
git add "Database Module/Accounting Base" .gitignore
git commit -m "Add old CRM Accounting import"
```

---

### Task 5: Database calls, receipt filing and ServiceDesk props

**Files:**
- Create: `Accounting Module/services/jobsApi.js`, `Accounting Module/services/receipts.js`, `Accounting Module/tests/static.test.mjs`
- Modify: `Template Module/components/ServiceDesk.jsx`

**Interfaces:**
- Consumes: Tasks 2 and 3's functions, `rpc` and `run, table` from `@banking/services/bankingApi`, `receiptDocx(p, client, c, company)` from `@banking/logic/documents`, `loadHubSettings` from `@template-hub/services/hubApi`.
- Produces:
  - `jobsApi.js`: `listJobs()`, `getJob(id)` (job row plus batches with files, payments with receipts, follow-ups, events), `saveJob(p)`, `setStatus(job, status, remarks, expected)`, `setFee(job, amount)`, `linkDocument(job, kind, doc, useTotal)`, `linkClient(job, clientId)`, `addBatch(p)`, `setBatchSaved(batch, saved)`, `setInvoice(job, number, date, amount)`, `clearInvoice(job, reason)`, `addPayment(p)`, `reversePayment(id, reason)`, `addFollowUp(p)`, `listFollowUps()`, `followUpsDueCount()`, `storeReceipt(receiptId, blob, fileName)`.
  - `receipts.js`: `fileReceipt(payment, job) -> Promise<void>`. Throws on failure, with the payment already saved.
  - `ServiceDesk` new optional props: `initial` (form values, plus `service`) and `onDocument(doc)`, called after a quote or letter is filed.

- [ ] **Step 1: Write the failing static test**

Checks that every `rpc("name"` in `services/` exists as `create or replace function public.name` in `Accounting Base/migrations`, and that every status, mode and method constant in `logic/jobs.js` appears in the migrations' checks, following `Banking Module/tests/static.test.mjs`.

- [ ] **Step 2: Run and see it fail**

Run: `node --test "Accounting Module/tests/"`. Expected: FAIL.

- [ ] **Step 3: Implement the two services**

`storeReceipt` follows `Business Setup Module/services/businessSetupApi.js` on branch `business-setup-module`, with the path `Accounting/receipts/${receiptId}/${crypto.randomUUID()}.docx` in bucket `hub-documents`. `fileReceipt` copies the `receiptDocx` call in that branch's `services/documents.js`, with `{ display_name: job.client_name }` and `{ case_ref: job.job_number }`, then downloads the file.

Check first on live, read-only, that `storage.objects` policies for `hub-documents` allow an ACCOUNTS user to insert under `Accounting/`:

```sql
select policyname, cmd, qual, with_check from pg_policies where schemaname = 'storage' and tablename = 'objects';
```

If they do not, add the needed policy to migration `003`, its rollback, and report it in the task summary.

- [ ] **Step 4: Add the `ServiceDesk` props**

Seed `form` and the first line's service from `initial` when present. Call `onDocument?.(doc)` at the end of `finish`. Existing callers pass neither, so nothing changes for them.

- [ ] **Step 5: Run tests and the build**

Run: `node --test "Accounting Module/tests/"`, then `npm --prefix "Main Module" run build`. Expected: PASS, and the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add "Accounting Module" "Template Module/components/ServiceDesk.jsx"
git commit -m "Add Accounting job calls, receipt filing and ServiceDesk hooks"
```

---

### Task 6: Pipeline screen and job form

**Files:**
- Create: `Accounting Module/components/AccountingDesk.jsx`, `Pipeline.jsx`, `JobForm.jsx`
- Modify: `Accounting Module/components/AccountingModule.jsx:29`

**Interfaces:**
- Consumes: Task 5's `jobsApi`, `loadCatalogue` from `@template-hub/services/hubApi`, `ClientLists` from `@banking/components/ClientLookup`, `clientOptions` from `jobsApi` (`client_lookup` gives ACCOUNTS no Client Master rows), Banking's `DataTable, Badge, Button, Panel, FormModal, useLoad`.
- Produces: `AccountingDesk({ profile })`, `Pipeline({ onOpen })`, `JobForm({ job, onSaved, onClose })`. Task 7 adds `JobWorkspace({ jobId, profile, onClose })`, and Task 8 adds `FollowUps({ onOpen })`.

- [ ] **Step 1: Build `AccountingDesk`**

Three inner tabs using `bk-tabs`: Pipeline, Follow-ups, Quotes and Agreements. The last renders `<ServiceDesk department="Accounting" profile={profile} />` unchanged. Follow-ups shows `followUpsDueCount()`, and hides the count at zero. Replace line 29 of `AccountingModule.jsx` with `<AccountingDesk profile={profile} />`.

- [ ] **Step 2: Build `Pipeline`**

`DataTable` columns: Job, Client, Service, Period, Assignees (names plus `legacy_assignees`), Work status, Payment status, Remarks, Created. Status chips with counts. Filters: service, assignee, Pending, To invoice (`needs_invoice`). A row opens the job. Completed and Client Cancelled sit in Banking's `ClosedSection` unless a filter asks for them, but To invoice always shows its rows. Show `Fee missing` when `needs_invoice` and `payment_status` is `No fee`.

- [ ] **Step 3: Build `JobForm`**

Fields: client with lookup, client ID kept only when the lookup's row is a Client Master record, service as a select grouped by category for the Accounting and Tax Compliance departments only, period, due date, assignees from `profiles()`, new client tick, fee. A `saveJob` refusal for a stale save shows "Someone changed this job. Reload it to see their changes."

- [ ] **Step 4: Check it**

Run: `npm --prefix "Main Module" run build`, then `node --test "Accounting Module/tests/"`. Expected: both pass. Screens cannot be checked in a browser until Task 10, so say so in the task summary.

- [ ] **Step 5: Commit**

```bash
git add "Accounting Module"
git commit -m "Add Accounting pipeline list and job form"
```

---

### Task 7: Job workspace

**Files:**
- Create: `Accounting Module/components/JobWorkspace.jsx`, `Accounting Module/components/PaymentsPanel.jsx`

**Interfaces:**
- Consumes: Task 5's `jobsApi` and `fileReceipt`, `parseFileNames`, `needsRemarks`, `dubaiToday` from Task 1, `ServiceDesk` with `initial` and `onDocument`, and `openStored` from `hubApi`.
- Produces: `JobWorkspace({ jobId, profile, onClose })`, `PaymentsPanel({ job, onChange })`.

- [ ] **Step 1: Build the sections**

| Section | Behaviour |
|---|---|
| Summary and status | `KeyVals` with balance and payment status. Status select. `needsRemarks` makes the remarks required, and `flagMissing` marks it. `Link client` uses client lookup, and shows a note that Zoho needs a Client Master record |
| File batches | Add form: date (default `dubaiToday()`, no future), mode, note when Other, file names in a textarea, one per line, through `parseFileNames`. List with date, mode, names, and the "Saved to client folder" tick |
| New client steps | Only when `is_new_client`. Three checks from `quote_id`, `letter_id`, and any unreversed payment. Generating opens `ServiceDesk` in a `Modal`, with `department={job.service_department}`, and `onDocument` calls `linkDocument`. When the job has a fee differing from the quote total, ask which to keep and pass `useTotal` |
| Invoice | Disabled note until Completed. Form: number, date, amount, defaulting to the fee. Shows the difference from the fee. "Clear invoice" asks for a reason |
| History | Events, newest first |

Payments and follow-ups sections mount `PaymentsPanel` and Task 8's log.

- [ ] **Step 2: Build `PaymentsPanel`**

Table: date, amount, method, reference, receipt number, status. Record payment uses `FormModal`. After `addPayment`, call `fileReceipt`. If that throws, show `Payment saved as <number>, but the file was not created: <message>`, and offer `Create file` on that row, as Business Setup's `Payments.jsx` does. View opens the stored file. Reverse asks for a reason and is hidden on reversal rows and reversed payments.

- [ ] **Step 3: Check it**

Run: `npm --prefix "Main Module" run build`, then `node --test "Accounting Module/tests/"`. Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add "Accounting Module"
git commit -m "Add Accounting job workspace and payments"
```

---

### Task 8: Follow-ups

**Files:**
- Create: `Accounting Module/components/FollowUps.jsx`
- Modify: `Accounting Module/components/JobWorkspace.jsx`, `Accounting Module/components/AccountingDesk.jsx`

**Interfaces:**
- Consumes: `listFollowUps()`, `addFollowUp(p)`, `followUpMail`, `nextFollowUpDefault`, `dubaiToday`, `clientOptions`.
- Produces: `FollowUps({ onOpen })`, and `FollowUpLog({ job, profile, onChange })`, used in `JobWorkspace`.

- [ ] **Step 1: Build them**

List: `follow_up_listed` rows, oldest completion first. Columns: Job, Client, Service, Invoice (or `Not invoiced`), Balance, Last contact, Next date, and a `Due` badge from `follow_up_due`. The log form holds date, channel, note, and next date defaulting to `nextFollowUpDefault()`.

Draft mail panel: editable subject and body from `followUpMail(job, profile.full_name)`, Copy, and Open in email with the address from client lookup, using the same `mailto` shape as `ServiceDesk.jsx:116`. It is not stored.

- [ ] **Step 2: Check it**

Run: `npm --prefix "Main Module" run build`, then `node --test "Accounting Module/tests/"`. Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add "Accounting Module"
git commit -m "Add Accounting payment follow-ups"
```

---

### Task 9: Docs and whole-branch check

**Files:**
- Modify: `Accounting Module/README.md`, `Database Module/Accounting Base/README.md`

- [ ] **Step 1: Update both READMEs**

Add the new paths, the tests' commands, the run order (after Banking Base, Voucher Base, Template Hub Base and Business Setup Base `007`), and the warning from spec section 12 about keeping `accounting` in the voucher `source` check.

The Zoho design is not on `origin/main`. Record the Accounting additions from spec section 6 in `Accounting Module/README.md`, under a "Zoho" heading.

- [ ] **Step 2: Run everything**

```bash
node --test "Accounting Module/tests/"
```

```bash
bash "Database Module/Accounting Base/tests/run-local.sh"
```

```bash
python -m unittest discover -s "Database Module/Accounting Base/tests" -p "test_*.py"
```

```bash
node --test "Banking Module/tests/"
```

```bash
npm --prefix "Main Module" run build
```

Expected: all pass. Banking's tests guard the `ServiceDesk` change and shared files.

- [ ] **Step 3: Check no client data is staged**

Run: `git log origin/main..HEAD --name-only --format= | sort -u`. Expected: no `Resources/`, no `data/`, no CSV.

- [ ] **Step 4: Commit**

```bash
git add "Accounting Module/README.md" "Database Module/Accounting Base/README.md"
git commit -m "Document the Accounting pipeline"
```

---

### Task 10: Release. Each step needs the user's approval first

Do not start this task without a separate yes for each numbered step. All live commands run from `Agent Module/11_Personal_Agent/CEO Agent`, using `npx --no-install supabase db query --linked --project-ref pnnakrhfzyxudjaghoxx --file <file>`.

- [ ] **Step 1: Back up and apply the migrations**

Save the voucher `source` check definition and the current `document_numbering` value to `Database Module/Accounting Base/data/`. Apply `002`, `003` and `004`, then run `select * from audit_trail_attach_all();` so the new tables get audit triggers now, not at the next hourly job. Expected: tables exist, `select count(*) from accounting_jobs` is 0, and the voucher `source` check still lists `banking`, `hub`, `template` and `business_setup`.

`storage.objects` on live is owned by `supabase_storage_admin`, so confirm the receipt policy was created: `select policyname, permissive from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'hub_docs_accounting_receipts';` must return one row, `RESTRICTIVE`.

- [ ] **Step 2: Stage the import**

Generate SQL with `legacy_load.py`, and load it. Show the user the report. Expected: 116 staged, 2 held.

- [ ] **Step 3: Apply the import**

Run `select accounting_legacy_apply();`. Expected: `committed` 116. Then show the user how many jobs fall under each status.

- [ ] **Step 4: Publish**

With approval, merge `accounting-pipeline` to `main` and push, which publishes to GitHub Pages. Check the workflow result.

- [ ] **Step 5: Browser check with a real login**

The user signs in and walks one test job through batch, status, quote, payment, receipt, invoice and follow-up. A test payment takes a real `ACR` serial, so ask first and reverse it after. Verify the voucher register shows it Reversed.

Walk the job with a real ACCOUNTS user, not an admin. An admin passes every permission check and would hide a missing one.

- [ ] **Step 6: Assign the role**

An admin assigns ACCOUNTS to the team in Business Banking settings. Remind the user that this also opens Salaries and Expenses.
