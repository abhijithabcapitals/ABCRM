# Business Setup Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the live Business Setup module into a case-based pipeline from lead to per-service Accounts handover.

**Architecture:** A new `business_setup_cases` table is the unit of work. Triggers on forms, quotes, payments and invoices call one function, `business_setup_case_sync`, which is the only place that moves a case forward automatically. Screens read cases through RPCs, and all existing quote, payment, portal and audit code is extended rather than replaced.

**Tech Stack:** Supabase Postgres (plpgsql, `security definer` RPCs), React with Vite (`Main Module` shell), Deno Edge Function (`client-portal`), `node --test`, throwaway Postgres 18 through `tests/run-local.sh`.

**Spec:** `Business Setup Module/docs/2026-11-04-business-setup-restructure-design.md`. Read it with this plan. It holds the stage table, dashboard definitions and rules.

## Global Constraints

- Branch `business-setup-restructure`, in a new worktree from `origin/main`. Local `main` is 177 commits behind and must not be the base.
- Migrations are in `Database Module/Business Setup Base/migrations`, from `013`, re-runnable, and tested by running twice.
- Do not edit migrations `001` to `012`. Redefine functions in new files, starting from the latest definition in migration order.
- Tables stay read-only through the API. Writes go through `security definer` RPCs that start with `business_setup_require(...)`. Each new function has explicit `revoke` and `grant` lines.
- Blocked actions raise one plain sentence naming what is missing.
- Client data, prices and `Resources/` never enter the repository.
- Banking, Accounting and Template Hub documents must calculate exactly as before.
- Keep every key `business_setup_dashboard` returns today, because `Dashboard Module/services/summaryApi.js` also reads it. New keys are additions.
- Clients are not Supabase Auth users. New portal functions take `p_account`, resolve the client on the server, and are callable by the service role only.
- Each migration gets its reverse in `rollback/013_019_rollback.sql`, restoring earlier functions by re-running the file that last defined them. `ROLLBACK_TEST=1` in `run-local.sh` must pass.
- Nothing goes live, is pushed or is merged without the user's separate approval per phase (Tasks 6, 10, 14, 16).
- Every release deploys to both Cloudflare targets, `abcrm` and `crm-abcapital.pages.dev`. `main` alone updates only GitHub Pages.
- The old CRM import stays on hold until phase 1 is live.

**Test commands:**
- SQL: `bash "Database Module/Business Setup Base/tests/run-local.sh"`. Expected: exits 0.
- Logic: `node --test "Business Setup Module/tests/"`. Expected: all pass.

New SQL tests follow `tests/050_handover_test.sql` for setup and acting users (`public.bs_as`). The assertion blocks below list what each test must prove.

## Review Focus

1. **Quote revised after an advance payment:** the balance uses the new total and the same payments. Test in Task 8.
2. **The only payment reversed after the letter is issued:** the case does not move back, Receivables rises, and a service that has not started is refused at the start gate. Test in Task 8.
3. **Share link for a client who already has a login or an open form:** the login is reused, no second form is created and no password is reset. Test in Task 2.
4. **A quote where every line has VAT 0, or a zero total:** VAT is 0, and the Paid item is met only for a zero total. Tests in Tasks 7 and 8.
5. **The last open service cancelled after its siblings went to Accounts, or a closed case's service reverted:** the first moves the case to Completed, and the second returns it to In service. Test in Task 12.

---

## Setup before Task 1

- [ ] Create the worktree: `git worktree add "D:/Abhijith Projects/CRM-bs-restructure" -b business-setup-restructure origin/main`.
- [ ] Copy the brief, spec and this plan from the main checkout's `Business Setup Module/docs`, and commit them. `Add Business Setup restructure brief, spec and plan`
- [ ] Run both test commands once. Expected: all pass, before any change.

---

## Phase 1: Pipeline

### Task 1: Case table, stages and sync

**Files:**
- Create: `Database Module/Business Setup Base/migrations/013_cases.sql`, `tests/070_cases_test.sql`, `rollback/013_019_rollback.sql`
- Modify: `tests/run-local.sh` (the `for n in 01 … 12` list and the test list)

**Interfaces:**
- Produces: table `business_setup_cases` with the spec's section 10 columns. `stage` is checked against the spec's ten stage names.
- Produces: `business_setup_case_set_stage(p_case uuid, p_to text, p_note text) returns void`, internal, not granted to `authenticated`. It writes the audit entry.
- Produces: `business_setup_case_sync(p_case uuid) returns void`, internal. It holds these rules, and only moves forward:
  - `Services` to `Documentation` when a non-superseded quote with this `case_id` exists.
  - `Documentation` to `Assignment` when `business_setup_case_docs(p_case)` shows every item met.
  - `In service` to `Completed` or `Cancelled` per the spec.
- Produces: `business_setup_case_docs(p_case uuid) returns jsonb`, with keys `quote`, `signed`, `paid`, `letter`, `invoice`, each `true` or `false`. In this phase, `signed` means an accepted quote, and `invoice` is always `true`. Tasks 8 and 9 redefine it.
- Produces: nullable `case_id` on `hub_documents`, `business_setup_payments` and `business_setup_onboarding_forms`.
- Produces: `hub_document_create` copies `case_id` from `p`, and a letter or revision inherits it.
- Produces: triggers calling sync: forms on status change, `hub_documents` on insert and status change, payments on insert.
- Produces: forms trigger mapping: Submitted or In review to `Review`, Returned to `Contact`, Validated to `Services`.
- Produces: permissions `setup.leads.manage` (Admin, Manager, Sales Executive, Document Executive) and `setup.cases.approve` (Admin, Manager), added to `business_setup_permissions()` and seeded.

- [ ] **Step 1: Add `013` and `070` to the runner, and write the failing test**

```text
case_sync_forward_only: set stage In service, run sync, stage is unchanged
form_trigger: Submitted→Review, Returned→Contact, Validated→Services
quote_trigger: issuing a quote with case_id moves Services→Documentation
docs_ready: accepted quote + payment + letter moves Documentation→Assignment
backfill: an existing quote chain gets one case, and running the migration twice leaves one
banking_quote_unaffected: a Banking quote with no case_id creates no case and keeps its total
permissions: Sales Executive holds setup.leads.manage, not setup.cases.approve
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL, `business_setup_cases` does not exist.
- [ ] **Step 3: Implement `013_cases.sql`, including the backfill per spec section 10, and its rollback section.** `case_number` format is `BSC` plus a sequence of at least 6 digits.
- [ ] **Step 4: Run the SQL tests.** Expected: PASS, and existing tests still pass.
- [ ] **Step 5: Commit.** `Add Business Setup cases and stage sync`

### Task 2: Leads and ownership functions

**Files:**
- Create: `migrations/014_leads_ownership.sql`, `tests/080_leads_test.sql`
- Modify: `rollback/013_019_rollback.sql`

**Interfaces:**
- Consumes: `business_setup_case_set_stage`, `business_setup_case_sync` (Task 1), `client_master_save`, `business_setup_form_create`.
- Produces:
  - `business_setup_case_new(p jsonb) returns uuid`. Keys: `lead_name` (required), `contact_person`, `phone`, `email`, `source`, `notes`, `client_id`. With a `client_id` whose KYC state is Done, it starts at `Services`.
  - `business_setup_case_take(p_case uuid) returns void`. At `Assignment`, it also moves to `In service`.
  - `business_setup_case_link_client(p_case uuid, p_client text default null, p_allow_duplicate boolean default false) returns text`. It creates the client through `client_master_save` from the lead fields, or links `p_client`, and reuses an existing link on retry.
  - `business_setup_case_shared(p_case uuid) returns void`. It needs a linked client with an active login, attaches the open form, and moves `Lead` to `Contact`, or to `Services` if KYC is Done.
  - `business_setup_case_lost(p_case uuid, p_reason text) returns void`.
  - `business_setup_case_confirm(p_case uuid) returns void`. Owner or approver, `Assignment` to `In service`.
  - `business_setup_case_assign(p_case uuid, p_to uuid, p_note text) returns void`. Needs `setup.cases.approve`.
  - `business_setup_reassign_request(p_case uuid, p_to uuid, p_reason text) returns uuid` and `business_setup_reassign_respond(p_id uuid, p_approve boolean, p_note text) returns void`, on table `business_setup_reassign_requests`, with one pending per case. Pattern: Banking `011`.
  - `business_setup_form_staff_save(p_id uuid, p_answers jsonb) returns void`. Needs `setup.kyc.manage`, works only while the form is In review, merges and audits the change. `business_setup_form_doc_add(p_id uuid, p_kind text, p_path text) returns uuid` adds a document for the client to the same `client_portal_documents` list.
  - `business_setup_case_list(p_view text) returns jsonb`. Views: `leads`, `documentation`, `cases`, `all`. Each row holds case fields, owner name, `docs` and pending reassignment.

- [ ] **Step 1: Write the failing test**

```text
take_race: second taker is refused, and the message names the first
case_needs_name: an empty lead_name is refused
share_needs_login: case_shared without an active login is refused
share_existing_login_reused: a client with a login and an open form keeps both; form count stays 1
link_retry: link_client called twice returns the same client_id
returning_client: new case with KYC Done starts at Services
lost_blocked_paid: refused with net payment above zero, and refused at In service
lost_revokes: login goes inactive if the client has no other open case
lost_keeps_login: login stays active with another open case, an active service, or a Banking case
reassign: one pending only; owner cannot approve own request; approver can change directly
no_permission: a READ_ONLY user is refused on each write function
staff_completes_form: a reviewer fills a missing field and uploads a document, then validation passes; refused when the form is not In review
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL, function does not exist.
- [ ] **Step 3: Implement `014_leads_ownership.sql`.** Find the Banking case's client link in `Banking Base` for `lost_keeps_login`.
- [ ] **Step 4: Run the SQL tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `Add lead and case ownership functions`

### Task 3: Dashboard figures

**Files:**
- Modify: `migrations/014_leads_ownership.sql`, `Business Setup Module/components/Dashboard.jsx`, `tests/080_leads_test.sql`, `Business Setup Module/tests/static.test.mjs`

**Interfaces:**
- Produces: `business_setup_dashboard()` keeps all current keys and adds `processes_pending`, `receivables`, `advances`, `cases_completed_month`, `cases_completed_total`, `pipeline` (object of stage to count), `forms_to_review`, `pending_after_kyc`.

- [ ] **Step 1: Write the failing test**

```text
dash_keys: every old key is still present
dash_receivables: accepted 1050, paid 400 gives 650; overpaid case counts 0; issued-only quote counts 0
dash_advances: payment on a case with no accepted quote appears in advances only
dash_pipeline: counts per stage exclude Completed, Cancelled, Lost
dash_after_kyc: a case at Services counts; one at Documentation does not
dash_history: a service with no case is left out of processes_pending
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Redefine the function, and change `Dashboard.jsx` to six clickable figures, a stage breakdown, then Expiries.** Links: Cases, Clients, Cases, Leads, Review, Documentation.
- [ ] **Step 4: Run the SQL and logic tests.** Expected: PASS.
- [ ] **Step 5: Commit.** `Show pipeline figures on the Business Setup dashboard`

### Task 4: New tabs and lead screens

**Files:**
- Create: `Business Setup Module/components/Leads.jsx`, `components/DocumentationPage.jsx`, `components/Cases.jsx`, `components/ShareLink.jsx`
- Modify: `logic/nav.js`, `components/BusinessSetup.jsx`, `components/Settings.jsx`, `components/Onboarding.jsx` (title), `components/Workspace.jsx`, `components/NewServiceFlow.jsx`, `services/businessSetupApi.js`, `tests/static.test.mjs`, `README.md`
- Remove from nav: `documents`, `import`, `onboarding` keys, replaced as below. `Documents.jsx` is reused as the register view. `Import.jsx` renders inside Settings.

**Interfaces:**
- Consumes: Task 2 RPCs. `ClientLogin.jsx`'s existing login save and password email.
- Produces: `NAV` order, keys and permissions: `dashboard` `setup.access`, `leads` `setup.access`, `review` `setup.kyc.manage`, `documentation` `setup.access`, `cases` `setup.access`, `clients` `setup.access`, `services` `setup.access`, `tasks` `setup.access`, `settings` `setup.access`.
- Produces: `NewServiceFlow` accepts a `caseId` prop and passes `case_id` to `createDocument`.

- [ ] **Step 1: Write the failing test in `static.test.mjs`**

```js
assert.deepEqual(NAV.map(([k]) => k), ["dashboard","leads","review","documentation","cases","clients","services","tasks","settings"]);
assert.ok(!visibleNav((p) => p === "setup.access").some(([k]) => k === "review"));
```

- [ ] **Step 2: Run the logic tests.** Expected: FAIL.
- [ ] **Step 3: Build the screens per spec section 4.**
  - `Leads`: sub-tabs Unassigned, Mine, All. Actions New lead, Take, Share link, Mark lost, Request reassignment.
  - `ShareLink`: link or create client, issue login, send password email, then `business_setup_case_shared`. A failed email leaves the login, and offers Resend.
  - `DocumentationPage`: case rows with the checklist from `docs`, and opening one shows New quote, Payments and Letter, reusing `workspace/Quotes.jsx` and `Payments.jsx`. A second view renders `Documents`.
  - `Onboarding` (Review tab): the reviewer can edit answers and upload documents through `business_setup_form_staff_save` and `business_setup_form_doc_add`.
  - `Cases`: rows from `cases` view. Assign and Confirm buttons. Service detail keeps today's `workspace/Services.jsx` until Task 11.
  - Clients workspace: Cases section, **+ New Case** calling `business_setup_case_new` with the `client_id`.
  - The permission-denied setup message stays as it is today.
- [ ] **Step 4: Run the logic tests and `npm run build` in `Main Module`.** Expected: PASS, and the build succeeds.
- [ ] **Step 5: Commit.** `Restructure Business Setup tabs around cases`

### Task 5: Phase 1 browser walk

- [ ] **Step 1: Run the preview `crm-bs` (port 5181), and walk on the TEST client only.** It points at live, so before phase 1 is applied, use it for layout only, with no writes.
- [ ] **Step 2: Fix what the walk finds, re-run all tests, and commit.**

### Task 6: Phase 1 release (user approval needed)

- [ ] **Step 1: Stop and ask the user for approval, showing migrations, rollback result and walk notes.**
- [ ] **Step 2: On approval: back up, run `ROLLBACK_TEST=1`, apply `013` and `014`, merge, push and deploy to `abcrm` and `crm-abcapital.pages.dev`.**
- [ ] **Step 3: Verify on live: dashboard loads, TEST client's case shows the right stage, Banking quote screen still works, Dashboard Module cards still load.**

---

## Phase 2: Documentation

### Task 7: Fee items and line VAT

**Files:**
- Create: `migrations/015_documentation.sql`, `tests/090_documentation_test.sql`
- Modify: `rollback/013_019_rollback.sql`, `tests/run-local.sh`

**Interfaces:**
- Produces: `business_setup_fee_items.default_amount` nullable with the `>= 0` check kept. New `vat_rate numeric(5,2) not null default 5 check (vat_rate in (0,5))`. `business_setup_fee_item_save` accepts `vat_rate` and an empty amount.
- Produces: three new items in group `Company`, with null amount: `Company registration`, `Company renewal`, `Visa`.
- Produces: quote lines carry `vat_rate` and `scope`. For department `Business Setup` only, `hub_document_create` sets `vat_mode = 'exclusive'`, reads each line's rate server-side from `fee_item_id` (5 if none), sums `round(amount * rate / 100, 2)` per line, and ignores any rate the browser sends.

- [ ] **Step 1: Write the failing test**

```text
vat_mixed: lines 1000 at 5 and 500 at 0 give net 1500, vat 50, total 1550
vat_rounding: 33.33 at 5 gives line vat 1.67
vat_browser_ignored: sending vat_rate 0 on a 5% item still charges 5%
vat_all_zero: every line at 0 gives vat 0, and total equals net
banking_totals_same: Banking inclusive 1050 gives vat 50, total 1050, as before
fee_null: a fee item saves with no amount; a negative amount is refused
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement this part of `015`.**
- [ ] **Step 4: Run the SQL tests.** Expected: PASS.
- [ ] **Step 5: Change the UI.**
  - `logic/lines.js`: add `scope` and `vat_rate`. Add `lineTotals(rows) -> { net, vat, total }` and `lineError(rows) -> string | null`, which `issue()` calls.
  - `NewServiceFlow.jsx`: `amount` no longer autofills. The input's `placeholder` shows the stored amount, grey by default, with a **Use {amount}** button. An empty cell shows when there is none. Add Scope of work. Remove the VAT select. Show net, VAT and total.
  - `FeeMaster.jsx`: VAT rate select, and an empty amount allowed.
  - `services/documents.js` and `scripts/fix_templates.py`: all six templates show net, VAT and total. Open each generated Word file to confirm.
- [ ] **Step 6: Add to `tests/logic.test.mjs`, and run.**

```js
assert.deepEqual(lineTotals([{amount:1000,vat_rate:5},{amount:500,vat_rate:0}]), {net:1500,vat:50,total:1550});
assert.equal(lineError([{service_name:"Visa",amount:"",stored_amount:900}]), "Each line needs a service and a fee.");
assert.equal(lineError([{service_name:"Visa",amount:0}]), null);
```

- [ ] **Step 7: Commit.** `Add suggested amounts and per-item VAT to quotes`

### Task 8: Signed copy, payment by case and letter gate

**Files:**
- Modify: `migrations/015_documentation.sql`, `tests/090_documentation_test.sql`, `components/workspace/Quotes.jsx`, `components/workspace/Payments.jsx`, `services/businessSetupApi.js`
- Create: `migrations/018_portal.sql`, `tests/100_portal_signed_test.sql`
- Modify: `Client Login Module/supabase/client-portal/index.ts`, `Client Login Module/portal/SetupView.jsx`, `Client Login Module/portal/portalApi.js`

**Interfaces:**
- Produces: table `business_setup_signed_quotes`: `id`, `quote_id`, `storage_path`, `source` (`Client` or `Staff`), `status` (`Uploaded`, `Confirmed`, `Refused`), `note`, created columns.
- Produces: `business_setup_signed_add(p_quote uuid, p_path text) returns uuid` (staff), and `business_setup_signed_decide(p_id uuid, p_confirm boolean, p_note text) returns void`. Confirm calls `business_setup_quote_accept`.
- Produces: `business_setup_quote_accept` is refused without a `Confirmed` signed copy. `business_setup_signed_decide` sets `Confirmed` before calling it. Issuing a revision refuses any `Uploaded` copy of the old quote.
- Produces: `business_setup_portal_signed_add(p_account uuid, p_quote uuid, p_path text) returns uuid`, service role only, checking the quote belongs to that account's client. Edge action `setup_signed_upload` uses the existing upload start and finish pattern.
- Produces: `business_setup_payment_add(p jsonb)` accepts `case_id` or `quote_id`, and needs a client on the case. The overpayment check applies only once a quote is accepted. `business_setup_net_paid(p_quote)` sums by the quote's `case_id` when it has one, otherwise by `quote_id`.
- Produces: `business_setup_case_paid_override(p_case uuid, p_reason text) returns void`, needing `setup.payments.override`.
- Produces: `business_setup_case_docs` now has `signed` from the confirmed copy, and `paid` from net paid above zero, zero total or the override.
- Produces: for Business Setup, `hub_document_create` refuses a letter until `signed` and `paid` are true.
- Produces: the quote message on `Quotes.jsx` has the portal link and login ID, never the password. The password email button sits beside it.

- [ ] **Step 1: Write the failing tests**

```text
accept_needs_signed: accept without a confirmed copy is refused
refuse_note: refused copy shows its note in the portal view; a new upload is allowed
revision_refuses_old: revising a quote sets its Uploaded copy to Refused
advance_payment: payment on a case before any quote succeeds, with a receipt and voucher
revised_balance: pay 500, issue revision total 1050, accept; balance is 550
reversal_after_letter: reverse the only payment after the letter; stage unchanged, receivables +, start gate refuses
payment_needs_client: case with no client is refused, with a plain message
overpay: above balance is refused without the override, only after acceptance
letter_gate: no payment refused; part payment allowed; zero total allowed; override needs reason and permission
portal_other_client: account A cannot upload to or read client B's quote
portal_roles: anon and authenticated cannot call business_setup_portal_signed_add
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement the SQL.** Also check `voucher_from_business_setup_payment` for a null `quote_id`.
- [ ] **Step 4: Run the SQL tests.** Expected: PASS.
- [ ] **Step 5: Build the screens and the Edge action.** On `Payments.jsx`, **Record payment** on a client-less case first runs `business_setup_case_link_client`.
- [ ] **Step 6: Run the logic tests and build.** Expected: PASS.
- [ ] **Step 7: Commit.** `Add signed quotes, payment by case and the letter gate`

### Task 9: Invoice record

**Files:**
- Modify: `migrations/015_documentation.sql`, `tests/090_documentation_test.sql`, `components/DocumentationPage.jsx`, `components/workspace/Quotes.jsx`

**Interfaces:**
- Produces: `business_setup_invoice_record(p jsonb) returns uuid`. Keys: `case_id`, `quote_id`, `invoice_number`, `invoice_date`, `amount`, `file_path`. Needs `setup.payments.manage`. Source is `Manual`.
- Produces: `business_setup_case_invoice_override(p_case uuid, p_reason text) returns void`, needing `setup.payments.override`.
- Produces: trigger on `business_setup_invoices` calls sync. `business_setup_case_docs.invoice` is true on an invoice or the override.

- [ ] **Step 1: Write the failing test**

```text
assignment_needs_invoice: accepted, paid and letter stay at Documentation with no invoice
invoice_moves: recording one moves the case to Assignment
two_invoices: a second is allowed; a duplicate number on one quote is refused
invoice_override: needs permission and reason
portal_invoice: recorded invoice appears in the client's Invoices section
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement, and add the invoice form to `DocumentationPage.jsx`.** Remove `ZohoInvoicePanel` from `workspace/Quotes.jsx`. Banking keeps the component.
- [ ] **Step 4: Run all tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `Record invoices and complete the documentation step`

### Task 10: Phase 2 release (user approval needed)

- [ ] **Step 1: Show the user all six generated Word quotes, and upload the corrected templates under Settings once they agree.**
- [ ] **Step 2: Stop and ask the user for approval.**
- [ ] **Step 3: On approval: back up, run `ROLLBACK_TEST=1`, apply `015` and the `018` so far, deploy `client-portal`, merge, push and deploy to both Cloudflare targets.**
- [ ] **Step 4: Walk on TEST: quote, client signed upload with login `test.business.setup.client.llc`, confirm, advance payment, letter, invoice, then Assignment.**

---

## Phase 3: Service work

### Task 11: Checkpoints

**Files:**
- Create: `migrations/016_checkpoints.sql`, `tests/110_checkpoints_test.sql`, `components/ServiceCheckpoints.jsx`
- Modify: `components/Cases.jsx`, `components/FeeMaster.jsx`, `rollback/013_019_rollback.sql`, `tests/run-local.sh`

**Interfaces:**
- Produces: the three tables in spec section 8. `business_setup_fee_items.checkpoint_set_id`. A seed set linked to `Company registration`, with labels exactly: `Document collection`, `Registration pending for approval`, `Approval`, `Issue of the license`, `Completed`.
- Produces: `business_setup_quote_accept` copies steps per service.
- Produces: `business_setup_checkpoint_done(p_id uuid, p_note text default null, p_reason text default null) returns void`, and `business_setup_checkpoint_back(p_service uuid, p_note text) returns void`. Both need the case owner or `setup.cases.approve`.
- Produces: `business_setup_checkpoint_set_save(p jsonb) returns uuid`, needing `setup.fees.manage`.
- Produces: `business_setup_case_list` rows gain `progress` per service, as `{ done, total }`.

- [ ] **Step 1: Write the failing test**

```text
copied_on_accept: Company registration gets 5 steps in order; a service with no set gets none and keeps statuses
snapshot: editing the set later leaves running services unchanged
in_order: step 3 before step 2 is refused
back_needs_note: moving back without a note is refused; history has both moves
first_step_gate: first step with no payment is refused; override needs reason
last_step_output: last step without an output file is refused, then completes the service with one
hold_flag: Waiting on client does not change progress
not_owner: another team member is refused; a manager is allowed
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement `016`, and build the screens.** `ServiceCheckpoints` shows progress, next step, back with note and hold flags. Services with no list render today's status control. `FeeMaster` lists and edits checkpoint sets.
- [ ] **Step 4: Run all tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `Add service checkpoints`

### Task 12: Per-service Accounts handover

**Files:**
- Create: `migrations/017_service_handover.sql`, `tests/120_service_handover_test.sql`
- Modify: `tests/050_handover_test.sql` (new behaviour), `Accounting Module/components/SetupValidation.jsx`, `components/workspace/Services.jsx`, `components/Cases.jsx`, `rollback/013_019_rollback.sql`, `tests/run-local.sh`

**Interfaces:**
- Produces: table `business_setup_service_handovers`, keyed by `service_id`, with the columns of `business_setup_handovers`. Existing rows are copied, one per service. `business_setup_accounts_reviews.service_id`.
- Produces: `business_setup_send_to_accounts(p_service uuid, p_remarks text default null) returns void`, replacing the quote version. Drop the old signature.
- Produces: `business_setup_accounts_review(p_service uuid, p_action text, p_remarks text default null) returns void`, replacing the quote version.
- Produces: `business_setup_accounts_queue() returns jsonb`, one row per service, with `service`, `quote_number`, `quote_total`, `net_paid`, `balance`, `invoices`, `other_services`.
- Produces: `business_setup_quote_locked(p_quote)` is true only when every non-cancelled service on the quote is with Accounts or closed.

- [ ] **Step 1: Write the failing test**

```text
send_only_completed: In progress service is refused
send_locks_one: sending service A locks A; sibling B still updates
payment_stays_open: payment allowed until all non-cancelled services are sent, then refused
revert_one: reverting A reopens A only
close_read_only: closed service cannot be changed
unpaid_shown: balance above zero does not block, and appears in the queue row
last_cancelled_completes: A with Accounts, B cancelled moves the case to Completed
revert_reopens_case: a Completed case whose service is reverted returns to In service
migrated_row: an old quote handover becomes one row per service
accounts_permission: only accounts.review can read the queue and review
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement `017`, and update both screens.** Sync needs the revert path, which is the only backward move it allows.
- [ ] **Step 4: Run all tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `Send services to Accounts one at a time`

### Task 13: Portal progress

**Files:**
- Modify: `migrations/018_portal.sql`, `tests/100_portal_signed_test.sql`, `Client Login Module/portal/SetupView.jsx`

**Interfaces:**
- Produces: `business_setup_portal_view` services gain `checkpoints` (`label`, `done` only) and `progress`.

- [ ] **Step 1: Write the failing test**

```text
portal_steps: client sees labels and progress
portal_forbidden: no notes, done_by, owner, staff names or override reasons anywhere in the view
```

- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Implement, and show steps in `SetupView.jsx`.**
- [ ] **Step 4: Run all tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `Show service progress in the client login`

### Task 14: Phase 3 release (user approval needed)

- [ ] **Step 1: Stop and ask the user for approval.**
- [ ] **Step 2: On approval: back up, run `ROLLBACK_TEST=1`, apply `016`, `017` and the rest of `018`, deploy `client-portal`, merge, push and deploy to both Cloudflare targets.**
- [ ] **Step 3: Walk on TEST: assign, all five checkpoints, output, send, Accounts close and revert, then client view.**

---

## Phase 4: Connections

### Task 15: Business Development transfer and payment

The spec needs a handover with queue `Business Setup`, but the Won form sends no queue today, so all handovers default to `Client Onboarding Queue`. This task adds the choice.

**Files:**
- Create: `migrations/019_bd_transfer.sql`, `tests/130_bd_transfer_test.sql`
- Modify: `Business Development Module/components/BusinessDevelopment.jsx` (Won form), `Business Development Module/logic/businessDevelopmentData.js`, `components/NewServiceFlow.jsx`, `rollback/013_019_rollback.sql`, `tests/run-local.sh`

**Interfaces:**
- Consumes: `bd_onboarding_handovers`, `bd_lead_services`, `bd_can_edit_lead`, `business_setup_case_link_client`.
- Produces: a trigger on `bd_onboarding_handovers` insert. With `onboarding_queue = 'Business Setup'`, it creates one case at `Lead` with `source = 'Business Development'`, and lead fields from `bd_leads`. `business_setup_case_take` sets the handover to `Accepted`, and `assigned_onboarding_user_id` to the taker.
- Produces: `business_setup_case_bd_services(p_case uuid) returns jsonb`, with accepted services and agreed fees for the quote prefill.
- Produces: `business_setup_bd_payment_add(p_lead uuid, p jsonb) returns jsonb`, gated by `bd_can_edit_lead`. It finds the case, links the client if needed, and calls the payment logic through a shared internal function, so `setup.payments.manage` is not needed.
- Produces: Won form gets a **Hand over to** select, with `Business Setup` and `Client Onboarding Queue`.

- [ ] **Step 1: Write the failing test**

```text
queue_creates_case: Business Setup queue creates one case at Lead
other_queue_ignored: Client Onboarding Queue creates none
retry_no_duplicate: a retried Won with the same idempotency_key leaves one case
take_accepts: taking sets the handover to Accepted with the owner
prefill: accepted services and fees are returned; rejected ones are not
bd_payment: a BD editor records one with a receipt, in the same numbering and balance
bd_payment_refused: a user who cannot edit that lead is refused; a lead not with Business Setup is refused
```

- [ ] **Step 2: Run the SQL tests, including `Database Module/migrations/bd/tests/010_ui_api_test.sql`, which covers the Won flow.** Expected: new tests FAIL, and the existing one passes.
- [ ] **Step 3: Implement `019`, the Won form select, a Record payment action on the lead, and the quote prefill.** The prefilled fee is a real entered value, because Business Development agreed it. Staff can edit it.
- [ ] **Step 4: Run all tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit.** `Transfer won Business Development leads to Business Setup`

### Task 16: Phase 4 release and close-out (user approval needed)

**Files:**
- Modify: `Business Setup Module/README.md`, `Database Module/Business Setup Base/README.md`

- [ ] **Step 1: Update both READMEs for cases, new tabs and migrations.**
- [ ] **Step 2: Stop and ask the user for approval.**
- [ ] **Step 3: On approval: back up, run `ROLLBACK_TEST=1`, apply `019`, merge, push and deploy to both Cloudflare targets.**
- [ ] **Step 4: Full walk: team lead and Business Development lead, from lead to Accounts close, with a real client login on TEST data.**
- [ ] **Step 5: Tell the user the import can now be scheduled, and list spec section 15's items still open.**
