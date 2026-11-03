# Business Setup Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Business Setup tab's client workspace and its flow from KYC through quote, agreement, payment and receipt to a tracked service.

**Architecture:** React pages in `Business Setup Module` call permission-checked Postgres RPCs in `business_setup_*`. Quotes and letters stay in `hub_documents` with added columns; payments, receipts, KYC and the tracker get new tables. Word generation and filing reuse `Template Module`.

**Tech Stack:** React and Vite (Main Module), Supabase Postgres and Storage, docxtemplater, `node --test`, throwaway Postgres 18.

**Spec:** `Business Setup Module/docs/2026-11-02-business-setup-workflow-design.md`. Table purposes, statuses, permission meanings and the fee list are defined there and not repeated.

## Global Constraints

- Paths are relative to the CRM repository root. Work on a new branch `business-setup-workflow` from `origin/main`, in its own worktree. Do not use the `CRM-setup` worktree or touch its compliance docs.
- Copy both docs from the main checkout into the new branch in Task 1; they are uncommitted there.
- **Do not apply anything to Supabase project `pnnakrhfzyxudjaghoxx`, deploy, push or merge without the user's explicit approval.**
- Every migration is re-runnable. Tests run migrations twice.
- Tables are read-only through the API. Writes go through `security definer` RPCs with `set search_path = public, pg_temp`, each starting with `banking_require('<permission>')`. Revoke from `public, anon`; grant to `authenticated`.
- Clients are created or changed only through `client_master_save`. No second client table.
- Payments, receipts, history and activity are append-only by trigger, same pattern as `banking_payments`.
- Fee list seed stays in git-ignored `Database Module/Business Setup Base/private/`. No client data or prices in the repository, which is public.
- All document reading goes through `readDocuments` from `@banking/services/bankingApi`. No other OCR.
- Dates are calculated in `Asia/Dubai`. Nothing is sent from the CRM; mail stays a draft.
- Accounting, Tax and Banking document behaviour must not change.
- Code style follows Banking Module: same shared components, `bk-` classes, plain one-line error messages.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- Two staff accept the same quote or revision chain at once: exactly one wins, and tracker lines are created once.
- A payment recorded and then reversed: the balance returns, a reversal cannot be reversed, and a later payment up to the restored balance is accepted.
- The Word file fails or the Client Module is off after a payment is saved: the payment and receipt number stay, and the file can be created again without a new number.
- A quote with a total of zero: it can be accepted and tracked, with nothing to pay and no division or empty-state failure.
- A client with no KYC profile or an older document with no `client_id`: pages render, and acceptance is refused with a message naming the missing link.

---

## File Structure

| Path | Responsibility |
|---|---|
| `Database Module/Business Setup Base/migrations/001_schema.sql` | New tables, triggers, RLS, role permissions |
| `.../002_hub_extension.sql` | `hub_documents` columns, `receipt` numbering, letter gate |
| `.../003_kyc_fees.sql` | KYC, partner and fee RPCs |
| `.../004_quotes_tracker.sql` | Accept, reject, sign, link, tracker RPCs |
| `.../005_payments.sql` | Ledger, receipts, voucher register |
| `.../006_workspace.sql` | Tasks, files, activity, read RPCs, bucket, `client_base_list` |
| `.../private/007_fee_seed.sql` | Fee list (git-ignored) |
| `.../tests/run-local.sh`, `tests/010_workflow_test.sql` | Throwaway database tests |
| `Business Setup Module/logic/*.js` | Pure rules |
| `Business Setup Module/services/businessSetupApi.js` | RPC and file calls |
| `Business Setup Module/components/…` | Spec section 10 |

---

### Task 1: Branch, test harness and schema

**Files:**
- Create: `Database Module/Business Setup Base/migrations/001_schema.sql`, `tests/run-local.sh`, `tests/010_workflow_test.sql`
- Modify: `.gitignore` (add `Database Module/Business Setup Base/private/`)
- Add: both docs under `Business Setup Module/docs/`

**Interfaces:**
- Consumes: `banking_can`, `banking_require`, `banking_role_permissions(role, permission, allowed)`, `client_master(client_id)`
- Produces: the tables in spec section 6; test helper `bs_as(user uuid)` setting `request.jwt.claim.sub` and role `authenticated`

- [ ] **Step 1: Create the worktree and branch**, then copy in both docs.

```bash
git worktree add "../CRM-bs-workflow" -b business-setup-workflow origin/main
```

- [ ] **Step 2: Write `run-local.sh`.** Copy `Banking Base/tests/run-local.sh`, keep its migration chain with paths adjusted, use port `55434`, append this folder's `migrations/00[1-6]_*.sql` and `private/007_*.sql` in number order inside the two-pass loop, and run `010_workflow_test.sql`. If `private/007_*.sql` is absent, skip it with a printed note.

- [ ] **Step 3: Write failing tests** in `010_workflow_test.sql`, using the style of `Banking Base/tests/010_workflow_test.sql`:

```sql
-- payments cannot be changed
select bs_expect_error($$update business_setup_payments set amount = 1$$, 'append-only');
select bs_expect_error($$delete from business_setup_service_history$$, 'append-only');
-- signed-in users cannot write directly
select bs_expect_error($$insert into business_setup_fee_items (name) values ('x')$$, 'permission denied');
-- role mapping
select bs_check('MANAGER has override', exists(select 1 from banking_role_permissions where role='MANAGER' and permission='setup.payments.override'));
select bs_check('SALES has no override', not exists(select 1 from banking_role_permissions where role='SALES_EXECUTIVE' and permission='setup.payments.override'));
```

- [ ] **Step 4: Run.** `bash "Database Module/Business Setup Base/tests/run-local.sh"`. Expected: fails on the missing tables.

- [ ] **Step 5: Implement `001_schema.sql`.** Tables per spec section 6, `business_setup_services.renews_service_id`, `quote_id`, `client_id`; RLS with `setup.access` read, `setup.kyc.sensitive` for partners. Payment `amount` is `numeric(18,2)`, positive, with `type` deciding sign. A partial unique index allows only one reversal per `reverses_id`. Seed these role permissions:

| Role | `setup.*` |
|---|---|
| ADMIN, MANAGER | all |
| SALES_EXECUTIVE | access, kyc.manage, quotes.manage, services.manage |
| DOCUMENT_EXECUTIVE | access, kyc.manage, kyc.sensitive, services.manage |
| FINANCE | access, payments.manage |
| BANKING_EXECUTIVE | access, services.manage |
| READ_ONLY | access |

The spec leaves this mapping open; it is the working default and is editable in Settings.

- [ ] **Step 6: Run tests.** Expected: migrations pass twice, checks pass.
- [ ] **Step 7: Commit** as `Add Business Setup tables and test harness`.

### Task 2: Extend `hub_documents`, numbering and the letter gate

**Files:** Create `migrations/002_hub_extension.sql`. Test: `tests/010_workflow_test.sql`.

**Interfaces:**
- Consumes: `hub_document_create(p jsonb)`, `hub_next_number`
- Produces: `hub_documents.{client_id,status,status_at,status_by,status_reason,revises_id,signed_at,signed_path}`; `hub_next_number('Business Setup','receipt')`

- [ ] **Step 1: Write failing tests:**

```sql
-- Business Setup letter needs an accepted quote
select bs_expect_error(format($$select hub_document_create('{"doc_type":"letter","parent_id":"%s"}')$$, :'issued_quote'), 'accepted');
-- Other departments unchanged
select bs_check('Accounting letter still free', (hub_document_create(jsonb_build_object('doc_type','letter','parent_id', :'acct_quote'))).id is not null);
-- Numbering
select bs_check('receipt number', hub_next_number('Business Setup','receipt') ~ '^ABC/[0-9]{4}/[0-9]{2}/BSR[0-9]{3}$');
-- client_id carried from quote to letter, and bad client refused
select bs_check('letter keeps client', (select client_id from hub_documents where id = :'bs_letter') = :'client');
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Add columns; `status` default `issued`, check in (`issued`,`accepted`,`rejected`,`superseded`), applied meaningfully to quotes. Widen the `hub_number_counters.kind` check. Add `{"receipt":{"format":"ABC/{YYYY}/{MM}/BSR{SERIAL}","digits":3,"restart":"never"}}` under Business Setup by `jsonb_set`, never overwriting an edited format. Make `hub_next_number`, `hub_serial_of` and the receipt collision check read receipts from `business_setup_receipts`; `hub_numbering_status` and `hub_numbering_save` handle `receipt` only for departments whose setting has it.

Replace `hub_document_create` here, adding only: `client_id` and `revises_id` taken from `p` (letters copy `client_id` from the quote); refusal message `Mark the quote as accepted first` when `q.department = 'Business Setup' and q.status <> 'accepted'`; and when `revises_id` is given, inside the same transaction, lock the old quote, require `issued`, and mark it `superseded`.

This migration must be re-run after `Template Hub Base/001`, because that file also defines the function. State so in the Base README.

- [ ] **Step 4: Run tests.** Expected: PASS, including the existing Banking checks in the chain.
- [ ] **Step 5: Commit** as `Add client link, status and receipt numbering to service documents`.

### Task 3: KYC and fee RPCs

**Files:** Create `migrations/003_kyc_fees.sql`, `private/007_fee_seed.sql`. Test: `tests/010_workflow_test.sql`.

**Interfaces — produces:**
- `business_setup_kyc_save(p_client text, p jsonb) returns jsonb` — returns `{percent int, missing text[]}`
- `business_setup_kyc_status(p_client text) returns jsonb` — same shape
- `business_setup_partner_save(p_client text, p jsonb) returns uuid`; `business_setup_partner_delete(p_id uuid) returns void`
- `business_setup_fee_item_save(p jsonb) returns uuid`

- [ ] **Step 1: Write failing tests:** a New company with no licence is complete once the spec 5.1 fields and one partner are given; an Existing company with no licence lists `licence number`, `licence expiry`, `issuing authority` in `missing`; a user without `setup.kyc.sensitive` reads no partner rows; a partner delete sets `deleted_at`; `fee_item_save` refuses a negative amount and a user without `setup.fees.manage`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Identity values stay in `client_master` and are read from there for the completeness check. Masked values go to `business_setup_activity`.
- [ ] **Step 4: Write `private/007_fee_seed.sql`** with the 24 rows of spec section 7 exactly, `on conflict (grp, name) do nothing` so edited amounts are not overwritten. Test: `select count(*) = 24`, skipped when the file is absent.
- [ ] **Step 5: Run tests.** Expected: PASS.
- [ ] **Step 6: Commit** `Add Business Setup KYC and fee functions`. Confirm `git status` does not list `private/`.

### Task 4: Quote lifecycle and tracker

**Files:** Create `migrations/004_quotes_tracker.sql`. Test: `tests/010_workflow_test.sql`.

**Interfaces — produces:**
- `business_setup_quote_accept(p_id uuid, p_allow_expired boolean default false) returns jsonb`
- `business_setup_quote_reject(p_id uuid, p_reason text) returns void`
- `business_setup_quote_link(p_id uuid, p_client text) returns void`
- `business_setup_letter_sign(p_id uuid, p_date date, p_path text) returns void`
- `business_setup_service_update(p_id uuid, p jsonb) returns void`

- [ ] **Step 1: Write failing tests:**

```sql
-- accept creates one tracker line per line, with action and service name
select bs_check('lines', (select count(*) from business_setup_services where quote_id = :'q') = 2);
-- second accept and accept of a sibling revision refused
select bs_expect_error(format($$select business_setup_quote_accept('%s')$$, :'q'), 'already');
-- no client link
select bs_expect_error(format($$select business_setup_quote_accept('%s')$$, :'old_quote'), 'Link this quote to a client');
-- incomplete KYC
select bs_expect_error(format($$select business_setup_quote_accept('%s')$$, :'q_no_kyc'), 'KYC');
-- expired needs the flag
select bs_expect_error(format($$select business_setup_quote_accept('%s')$$, :'q_expired'), 'expired');
-- zero total can be accepted
select bs_check('zero', (business_setup_quote_accept(:'q_zero')) is not null);
-- rejecting needs a reason; cancelling a service needs a reason and writes history
select bs_expect_error(format($$select business_setup_quote_reject('%s','')$$, :'q2'), 'reason');
-- Accounting quote refused
select bs_expect_error(format($$select business_setup_quote_accept('%s')$$, :'acct_quote'), 'Business Setup');
```

Add a concurrency check by locking: the function takes `select … for update` on the root quote of the revision chain, and a partial unique index allows one accepted quote per chain root (`root_quote_id` column on `hub_documents`, equal to `id` when not a revision).

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `service_update` accepts owner, status, dates, notes; every status change inserts into `business_setup_service_history`. `renews_service_id` comes from a line's `renews_service_id`. Set `root_quote_id` in `hub_document_create` by editing `002`.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add quote acceptance and service tracker`.

### Task 5: Payments and receipts

**Files:** Create `migrations/005_payments.sql`. Test: `tests/010_workflow_test.sql`.

**Interfaces — produces:**
- `business_setup_payment_add(p_quote uuid, p_date date, p_amount numeric, p_method text, p_reference text default null, p_note text default null, p_override_reason text default null) returns jsonb` — `{payment_id, receipt_id, receipt_number, outstanding}`
- `business_setup_refund_add(p_quote uuid, p_date date, p_amount numeric, p_method text, p_reason text) returns uuid`
- `business_setup_payment_reverse(p_payment uuid, p_date date, p_reason text) returns uuid`
- `business_setup_receipt_attach(p_receipt uuid, p_storage text, p_local text) returns void`
- `business_setup_quote_balance(p_quote uuid) returns jsonb` — `{total, received, outstanding}`

- [ ] **Step 1: Write failing tests:**

```sql
-- part then full on a 1,000 quote
select bs_check('part', (business_setup_payment_add(:'q',current_date,400,'Bank Transfer')->>'outstanding')::numeric = 600);
select bs_check('full', (business_setup_payment_add(:'q',current_date,600,'Cash')->>'outstanding')::numeric = 0);
-- over the balance
select bs_expect_error(format($$select business_setup_payment_add('%s',current_date,1,'Cash')$$, :'q'), 'above the balance');
-- override needs the permission and a reason
-- reverse restores the balance; reversing again or reversing a reversal refused
-- not accepted, zero amount, future-dated refused
-- attach keeps the number; receipts appear in voucher_register with source 'business_setup'
select bs_check('voucher', exists(select 1 from voucher_register where source='business_setup' and voucher_type='Receipt' and voucher_number = :'num'));
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Lock the quote row before reading the balance. A refund cannot exceed net received. Widen `voucher_register_source_check` to include `business_setup`, using the policy pattern of `Voucher Base/002`, with read needing `setup.access`. Insert with a trigger on `business_setup_receipts`; a reversal sets the voucher status to `Reversed`. `voucher_set_local` gains a `business_setup` branch updating the receipt.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Business Setup payments and receipt vouchers`.

### Task 6: Workspace reads, tasks, files

**Files:** Create `migrations/006_workspace.sql`. Test: `tests/010_workflow_test.sql`.

**Interfaces — produces:**
- `business_setup_my_access() returns jsonb` — same shape as `banking_my_access`
- `business_setup_client_list(p_search text default null) returns jsonb`
- `business_setup_workspace(p_client text) returns jsonb` — `{client, kyc, services, quotes, payments, receipts, documents, tasks, activity, totals}`
- `business_setup_dashboard() returns jsonb` — `{open_quotes, unsigned, outstanding_total, active_services, expiring_90}`
- `business_setup_task_save(p jsonb) returns uuid`; `business_setup_document_add(p_client text, p_name text, p_path text, p_type text) returns uuid`

- [ ] **Step 1: Write failing tests:** the client list holds a client having any Business Setup quote, service or KYC profile; a client with no KYC returns `kyc: null` without error; `workspace` hides partner identity values from a user without `setup.kyc.sensitive`; `expiring_90` counts a service expiring in 90 days and not one in 91, using Dubai's date; `client_base_list()` shows a `Business Setup` line; a user with no setup role is refused.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Create private bucket `business-setup-documents` guarded by `to_regclass('storage.buckets')`, as `Template Hub Base/001` does, with `setup.access` policies. Extend `client_base_list` per `Client Base/README.md`; re-run note in the Base README.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Business Setup workspace functions`.

### Task 7: Logic and API layer

**Files:**
- Create: `Business Setup Module/logic/lines.js`, `logic/status.js`, `services/businessSetupApi.js`
- Modify: `Template Module/logic/serviceDocs.js`, `Template Module/components/ServiceDesk.jsx:59`
- Test: `Business Setup Module/tests/logic.test.mjs`, `tests/static.test.mjs`

**Interfaces — produces:**
- `buildLine({ service_name, action, amount, fee_item_id, renews_service_id }) -> { description, service_name, action, amount, fee_item_id, renews_service_id }`
- `addSetupLine(lines, line) -> { lines } | { error }`
- `QUOTE_STATUS`, `SERVICE_STATUS` — value to `{label, tone}`; `balanceLabel(outstanding) -> string`
- `receiptData(payment, receipt, quote, company) -> object` for `Fee_Receipt_Voucher_Template.docx`
- API: one named export per RPC, plus `saveReceiptFile(receipt, blob, fileName)`

- [ ] **Step 1: Write failing tests:**

```js
assert.equal(buildLine({ service_name: "Investor Visa", action: "New", amount: 100 }).description, "Investor Visa");
assert.equal(buildLine({ service_name: "Investor Visa", action: "Renewal", amount: 100 }).description, "Renewal: Investor Visa");
// the same service may appear with a different action, not with the same one
assert.ok(addSetupLine([buildLine({ service_name: "A", action: "New", amount: 1 })], { service_name: "A", action: "New", amount: 1 }).error);
assert.ok(addSetupLine([buildLine({ service_name: "A", action: "New", amount: 1 })], { service_name: "A", action: "Renewal", amount: 1 }).lines);
assert.ok(addSetupLine([], { service_name: "A", action: "New", amount: -1 }).error);
assert.equal(receiptData(pay, rec, quote, {}).case_ref, quote.document_number);
assert.equal(fileNameFor("ABC/2026/11/BSR001", "A & B LLC"), "ABC-2026-11-BSR001 A  B LLC.docx");
```

`static.test.mjs` follows `Banking Module/tests/static.test.mjs`: every `rpc("…")` name in this module exists in a migration, and each template tag in `receiptData` matches the template.

- [ ] **Step 2: Run** `node --test "Business Setup Module/tests/"`. Expected: FAIL.
- [ ] **Step 3: Implement.** `saveReceiptFile` uses the same steps as `saveFile` in `hubApi.js`, kind `setup_receipt`, then `business_setup_receipt_attach`. In `ServiceDesk.jsx`, the limitations lookup also matches `doc.lines[].service_name`. `doc.services` stays the plain service names so mail and letter wording stay clean.
- [ ] **Step 4: Run tests.** Expected: PASS, and `node --test "Banking Module/tests/"` still passes.
- [ ] **Step 5: Commit** `Add Business Setup logic and API`.

### Task 8: Shell, Clients, Dashboard, Services & Fees

**Files:**
- Modify: `Business Setup Module/components/BusinessSetup.jsx`, `README.md`
- Create: `components/{Dashboard,Clients,FeeMaster,Settings,context}.jsx`
- Test: `tests/static.test.mjs`

**Interfaces — produces:** `useSetup() -> { profile, can, people, personName, openClient(id, tab), goTo(page) }`; `Workspace` props `{ clientId, initialTab, onBack }`.

- [ ] **Step 1: Write a failing static test:** the shell lists the six tabs of spec section 4 and imports no `banking_` table directly.
- [ ] **Step 2: Implement.** Shell follows `BankingModule.jsx`: access from `business_setup_my_access`, setup message on missing function, refusal with no `setup.access`. Provide `BankingContext` as well so shared components that call `useBanking` work. **+ New Client** uses `client_lookup` to pick, or `client_master_save` to add, with its duplicate handling. **Settings** links numbering and shows role mapping. FeeMaster is editable only with `setup.fees.manage`. Add the Vite alias only if `@business-setup` subpaths need it.
- [ ] **Step 3: Run tests and `npm run build` in `Main Module`.** Expected: PASS, build succeeds.
- [ ] **Step 4: Commit** `Add Business Setup shell and lists`.

### Task 9: Workspace, KYC, tracker, tasks

**Files:** Create `components/Workspace.jsx`, `components/workspace/{Overview,Kyc,Services,Tasks,Files}.jsx`, `logic/kycFields.js`. Test: `tests/logic.test.mjs`.

**Interfaces:**
- Consumes: Task 6 and 3 RPCs, `readDocuments`, `buildAutofill` and `compareWithCurrent` from `@banking/logic/kycAutofill`
- Produces: `KYC_SECTIONS`, `kycMissing(values, partners) -> string[]`

- [ ] **Step 1: Write failing tests:** `kycMissing` returns the same list as `business_setup_kyc_status` for the New and Existing cases, using the spec 5.1 fields.
- [ ] **Step 2: Implement.** **Fill from documents** follows `KycDocumentFill`'s rule: empty fields ticked, a differing value unticked. Do not reuse that component, since it queries banking tables; write a small one using the same logic functions. Overview's **+ New Service** is disabled with the missing list when KYC is incomplete. Render a client with no KYC or no services with plain empty messages.
- [ ] **Step 3: Run tests and build.** Expected: PASS.
- [ ] **Step 4: Commit** `Add client workspace, KYC and service tracker`.

### Task 10: New service, quotes and agreements

**Files:** Create `components/NewServiceFlow.jsx`, `components/workspace/Quotes.jsx`. Test: `tests/logic.test.mjs`.

**Interfaces — consumes:** `buildLine`, `addSetupLine`, `createDocument`, `renderTemplate`, `saveFile`, `quoteData`, `letterData`, `mailDraft`, `loadCatalogue`.

- [ ] **Step 1: Write a failing test:** `quotePayload(client, form, lines)` carries `client_id`, `department: "Business Setup"`, and `services` holding plain service names.
- [ ] **Step 2: Implement.** Picker groups catalogue services and fee items; choosing a fee item fills the amount. Labour Fee shows both options by name. Client details fill from `client_master`. Generate, file and draft as `ServiceDesk.finish` does; extract `finish`'s body into an exported helper in `Template Module/logic` and use it from both, rather than copying. Quotes tab offers Accept (with expired warning), Reject (reason), Revise (opens the flow with `revises_id`), Generate Letter only when accepted, Record Signature (date and scan upload), Create file, View, Open in Folder and the mail icon.
- [ ] **Step 3: Run tests and build; run `node --test "Banking Module/tests/"`.** Expected: PASS.
- [ ] **Step 4: Commit** `Add new service flow, quotes and agreements`.

### Task 11: Payments UI and receipt filing

**Files:**
- Create: `components/workspace/Payments.jsx`
- Modify: `Client Module/config.json` (add `setup_receipt`)
- Create folder: `Database Module/Generated Documents/Business Setup/Receipts Generated`
- Test: `tests/static.test.mjs`

- [ ] **Step 1: Write a failing static test:** `config.json` has `generatedFolders.setup_receipt` ending in `Business Setup\Receipts Generated`. If `config.json` is git-ignored, make this test skip when absent and put the key in its example config.
- [ ] **Step 2: Implement.** Each accepted quote shows total, received, outstanding, its ledger and receipts. **Record Payment** calls `payment_add`, then renders and saves the receipt. When the file step fails, keep the payment, show the receipt number with a warning and offer **Create file**, reusing the same number. Override asks for a reason only for users holding the permission. Reversal and refund each ask for a reason. A quote with a zero total shows "Nothing to pay".
- [ ] **Step 3: Run tests and build.** Expected: PASS.
- [ ] **Step 4: Commit** `Add payment recording and receipt filing`. The new folder holds a `.gitkeep` only if `Generated Documents` is tracked.

### Task 12: Documents page, Template Hub, catalogue, docs

**Files:**
- Create: `components/Documents.jsx`, `components/Tasks.jsx`, `Business Setup Module/docs/USER_MANUAL.md`
- Modify: `Template Module/components/ServiceDesk.jsx`, `Business Setup Module/README.md`, `Database Module/Business Setup Base/README.md`, `Database Module/Voucher Base/README.md`, `Database Module/Client Base/README.md`
- Create if needed: `migrations/008_catalogue_additions.sql`

- [ ] **Step 1: Compare the user's pasted service hierarchy with `service_items`** in `Services Base/migrations/001`. The pasted list is in the conversation record and spec section 7 references it; if an executor does not have it, ask the user. Add only missing names, with `on conflict do nothing`, and add a test that a re-run adds nothing. Add a test too that `Database Module/Services Base` existing names are unchanged.
- [ ] **Step 2: Implement Documents:** all department documents, with **Link to client** for rows with no `client_id` through `business_setup_quote_link`. Row links to the Workspace when linked.
- [ ] **Step 3: In `ServiceDesk.jsx`,** for Business Setup when no `department` prop is set (Template Hub), replace the letter button with a note to continue in the Business Setup tab.
- [ ] **Step 4: Write the docs.** Base README: migration order and the re-run notes from Tasks 2 and 6, deployment steps, rollback from spec section 13. Manual: the normal path for staff.
- [ ] **Step 5: Run everything:** `bash "Database Module/Business Setup Base/tests/run-local.sh"`, `bash "Database Module/Banking Base/tests/run-local.sh"`, `node --test "Business Setup Module/tests/" "Banking Module/tests/"`, `npm run build` in `Main Module`. Expected: all pass.
- [ ] **Step 6: Commit** `Add Business Setup documents page and guides`.

### Task 13: Click-through and hand-off

- [ ] **Step 1: Run the Main Module against a non-production database.** The throwaway Postgres has no API layer. If no such environment is available, say so, do not use live, and leave this step open for after approved deployment. Stubbing the API may be used for layout only, and the report must say so.
- [ ] **Step 2: Walk the flow:** new client, New company KYC with no licence, select two services with different actions, quote, accept, letter, sign, part payment, reversal, full payment, tracker to Completed with expiry, **+ New Service** renewal. Confirm files in the three `Generated Documents\Business Setup` folders, then repeat one payment with the Client Module off.
- [ ] **Step 3: Report results** to the user, with what could not be checked. Ask for approval before any live migration, push or merge. Update `Business Setup Base/README.md` status only after that.
