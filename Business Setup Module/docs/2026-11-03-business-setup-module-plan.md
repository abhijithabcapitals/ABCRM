# Business Setup Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Business Setup module from client login and form through quote, payment, tracked service and Accounts handover, and load the department's existing data.

**Architecture:** React pages in `Business Setup Module` call permission-checked Postgres RPCs named `business_setup_*`. Quotes and letters stay in `hub_documents`. Clients reach the module only through the `client-portal` Edge Function, which uses the service role and named-field functions.

**Tech Stack:** React and Vite (Main Module), Supabase Postgres, Storage and Edge Functions, docxtemplater, Python with openpyxl for the import, `node --test`, throwaway Postgres 18.

**Spec:** `Business Setup Module/docs/2026-11-03-business-setup-module-design.md`. Quote, letter, payment and receipt rules not restated there are in `2026-11-02-business-setup-workflow-design.md`. Table purposes, statuses and permission meanings are not repeated here.

## Global Constraints

- Paths are relative to the CRM repository root. Work only in worktree `D:/Abhijith Projects/CRM-bs-module` on branch `business-setup-module`, cut from `origin/main`.
- **Do not apply anything to Supabase project `pnnakrhfzyxudjaghoxx`, deploy an Edge Function, push or merge without the user's explicit approval.** Read-only checks are allowed only where a task says so.
- Every migration is re-runnable. Tests run migrations twice.
- Tables are read-only through the API. Writes go through `security definer` RPCs with `set search_path = public, pg_temp`, each starting with `business_setup_require('<permission>')`. Revoke from `public, anon`; grant to `authenticated`. Portal functions are granted to `service_role` only.
- Clients are created or changed only through `client_master_save`. Phones and emails live only in Client Master.
- Payments, receipts, history, audit log and Accounts reviews are append-only by trigger.
- No client data, prices or Word templates in git. The repository is public. `Business Setup Module/Resources/` and `Business Setup Base/private/` are git-ignored; confirm with `git check-ignore` before staging anything near them.
- All document reading goes through `readDocuments` from `@banking/services/bankingApi`, in the staff browser only.
- Dates are calculated in `Asia/Dubai`. Nothing is sent to clients from the CRM.
- Accounting, Tax and Banking document behaviour must not change. In Banking the only change is the non-blocking panel in Task 14.
- Code style follows Banking Module: shared components, `bk-` classes, one-line plain error messages.
- End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- An existing portal account linked only by `banking_client_id`, with no `client_master_id`: `setup_view` resolves the Client ID through `banking_clients`, and a client with no link gets the old portal with no error. Pinned in Task 6.
- A form with an upload that never finished (`upload_complete = false`): it does not count as a supplied document, and validation names what is missing. Pinned in Task 5.
- A payment reversed after a service started: the service stays In progress, the balance returns, and starting another line is blocked until a net payment exists again. Pinned in Task 3.
- All lines Cancelled with money still held: Send to Accounts is allowed, and the send screen and review both show the net paid amount. Pinned in Task 7.
- Import re-run after staff edited a client: staff values survive, nothing duplicates, and a row already applied is skipped. Pinned in Task 8.

---

## File Structure

| Path | Responsibility |
|---|---|
| `Database Module/Business Setup Base/migrations/001..012` | Spec section 5.3 |
| `Database Module/Business Setup Base/scripts/legacy_load.py` | Read source files, stage rows, print dry-run report |
| `Database Module/Business Setup Base/tests/run-local.sh` | Throwaway cluster runner |
| `.../tests/010_workflow_test.sql`, `020_concurrency.sh` | Staff rules |
| `.../tests/030_onboarding_test.sql`, `040_portal_test.sql`, `050_handover_test.sql`, `060_import_test.sql` | One file per area |
| `Business Setup Module/logic/*.js` | Pure rules: nav, KYC, balances, line building, expiries, form completeness, statuses |
| `Business Setup Module/services/businessSetupApi.js` | RPC and file calls |
| `Business Setup Module/components/*.jsx` | Pages per spec section 6 |
| `Business Setup Module/components/workspace/*.jsx` | One file per Workspace tab |
| `Business Setup Module/components/ZohoInvoicePanel.jsx` | Shared non-blocking panel |
| `Business Setup Module/tests/*.test.mjs` | `node --test` |
| `Client Module/portal/SetupView.jsx`, `SetupForm.jsx` | Client's view and form |
| `Client Module/supabase/client-portal/index.ts` | New portal actions |
| `Accounting Module/components/SetupValidation.jsx` | Accounts queue and review |

---

### Task 1: Worktree, branch merge and foundation

**Files:**
- Create: worktree `D:/Abhijith Projects/CRM-bs-module`
- Create from `business-setup-compliance`: `migrations/001_foundation.sql`, `migrations/002_client_master_access.sql`, `tests/001_storage_stub.sql`, `components/Settings.jsx`, `components/SetupContext.jsx`, `logic/nav.js`, `services/businessSetupApi.js`, `tests/static.test.mjs`, `components/BusinessSetup.jsx`
- Create from `business-setup-workflow`: `tests/run-local.sh`, `tests/010_workflow_test.sql`, `tests/020_concurrency.sh`
- Copy from main checkout: both 2026-11-03 docs

**Interfaces:**
- Produces: `business_setup_can(p_permission text) returns boolean`, `business_setup_require(p_permission text) returns void`, `business_setup_permissions() returns text[]`, `business_setup_audit(...)`, `business_setup_my_access() returns jsonb`, runner `bash "Database Module/Business Setup Base/tests/run-local.sh"`.

- [ ] **Step 1: Preflight on live, read-only.** Run `select tablename from pg_tables where tablename like 'business_setup_%'` on the project. Expected: zero rows. If any row exists, stop and tell the user.
- [ ] **Step 2: Create the worktree.** `git worktree add -b business-setup-module "D:/Abhijith Projects/CRM-bs-module" origin/main`, then copy the files above with `git show <branch>:<path>`. Do not merge either branch.
- [ ] **Step 3: Write failing checks in `010_workflow_test.sql`.**

```sql
select bs_check('permission list', business_setup_permissions() @> array['setup.portal.manage','setup.import.manage','setup.services.override','setup.fees.manage','setup.audit.view','kyc.view','kyc.manage']);
select bs_check('old permissions gone', not business_setup_permissions() && array['setup.applications.view','setup.compliance.view','setup.regulatory.view']);
select bs_check('dropped tables absent', to_regclass('public.business_setup_client_profiles') is null and to_regclass('public.business_setup_notifications') is null);
select bs_expect_error('select business_setup_require(''setup.access'')', 'permission');  -- as a user with no role
```

- [ ] **Step 4: Run the runner to see them fail.** Expected: `FAIL permission list`.
- [ ] **Step 5: Trim `001_foundation.sql`** to spec 5.1 and 5.2: replace the permission list, drop `business_setup_client_profiles` and `business_setup_notifications`, and seed role permissions with the workflow branch's seven roles using the new names. Update `business_setup_my_access` and `logic/nav.js` to match.
- [ ] **Step 6: Update `run-local.sh`.** Add `001_storage_stub.sql` after the stub, include `Client Base` `003`, and loop through migrations 001 to 012 with `nullglob`, with the private seed after `005`. Run the three further test files when they exist.
- [ ] **Step 7: Run the runner and `node --test "Business Setup Module/tests/"`.** Expected: all ok.
- [ ] **Step 8: Commit** with message `Combine Business Setup foundation from both branches`.

### Task 2: Workflow schema on Business Setup permissions

**Files:**
- Create: `migrations/003_schema.sql`, `004_hub_extension.sql`, `005_kyc_fees.sql`, `006_quotes_tracker.sql`, from the workflow branch's `001` to `004`
- Modify: `tests/010_workflow_test.sql`, `tests/020_concurrency.sh`

**Interfaces:**
- Consumes: `business_setup_can`, `business_setup_require`, `business_setup_audit` from Task 1.
- Produces: `business_setup_service_update(p_id uuid, p_status text, p_fields jsonb default '{}', p_reason text default null)`, `business_setup_service_complete(p_id uuid, p_output_details jsonb, p_reason text default null)`, `business_setup_net_paid(p_quote uuid) returns numeric`, `business_setup_status_allowed(p_status text) returns boolean`, `business_setup_quote_template_save(p jsonb)`, columns in `business_setup_services`: `action`, `started_at`, `expiry_date`, `output_details`, `historical`, `locked`. `business_setup_kyc_profiles` gains `client_status`, `kyc_state`, `ejari_provider`, `licence_extras jsonb`.

- [ ] **Step 1: Copy the workflow files and their tests.** Replace every `banking_can` and `banking_require` with the Business Setup versions, remove the `banking_role_permissions` seed and replace `business_setup_activity` with `business_setup_audit`. Keep `business_setup_mask`.
- [ ] **Step 2: Write failing checks.**

```sql
select bs_check('statuses include waiting on client', business_setup_status_allowed('Waiting on client'));
select bs_expect_error($$select business_setup_service_update(:'svc_unpaid','In progress')$$, 'payment');
-- with setup.services.override and a reason, the same call succeeds
select business_setup_service_update(:'svc_zero','In progress');  -- zero total: must not raise
select bs_check('zero total starts without payment', (select status from business_setup_services where id = :'svc_zero') = 'In progress');
select bs_expect_error($$select business_setup_service_complete(:'svc_no_file','{}')$$, 'output');
-- company registration completion with licence details updates client_master and expiry_date
select bs_check('licence reaches client master', (select data->>'Trade License Number' from client_master where client_id = :'cl') = 'T-1');
```

Keep every existing workflow test unchanged in meaning, including the concurrency checks.

- [ ] **Step 3: Run to see them fail.** Expected: `FAIL` on the new checks only.
- [ ] **Step 4: Implement the start gate and completion in `006_quotes_tracker.sql`.** Net paid comes from `business_setup_net_paid` and returns 0 until Task 3 fills the ledger. Check the exact Client Master key names in `Client Module/crm/masterLogic.js` before writing licence fields, and use them in the test.
- [ ] **Step 5: Add `business_setup_quote_templates` to `003_schema.sql`** with `key`, `label`, `jurisdiction`, `storage_file`, `active`, seeded with `ifza`, `rakez`, `shams`, `mainland`, `liquidation` and `service`. `hub_documents` gains `template_key` in `004`.
- [ ] **Step 6: Run the runner.** Expected: all ok, migrations pass twice.
- [ ] **Step 7: Commit** with message `Move workflow schema to Business Setup permissions and add the start and completion rules`.

### Task 3: Payments and receipts

**Files:**
- Create: `migrations/007_payments.sql`
- Modify: `tests/010_workflow_test.sql`

**Interfaces:**
- Consumes: `business_setup_payments`, `business_setup_receipts`, `hub_next_number`.
- Produces: `business_setup_payment_add(p jsonb) returns jsonb` returning `{payment_id, receipt_id, receipt_number}`; `business_setup_payment_reverse(p_id uuid, p_reason text) returns jsonb`; `business_setup_receipt_attach(p_id uuid, p_path text)`; `business_setup_quote_balance(p_quote uuid) returns jsonb` returning `{total, net_paid, outstanding}`.

- [ ] **Step 1: Write failing checks.**

```sql
select bs_check('receipt number format', (business_setup_payment_add(:'part')->>'receipt_number') ~ '^ABC/\d{4}/\d{2}/BSR\d{3}');
select bs_check('part payment balance', (business_setup_quote_balance(:'q')->>'outstanding')::numeric = 600);
select bs_expect_error($$select business_setup_payment_add(:'over')$$, 'balance');
select bs_expect_error($$select business_setup_payment_reverse(:'rev_id','again')$$, 'reversal');
select bs_expect_error($$update business_setup_payments set amount = 1$$, 'append');
-- Review Focus: reversal after start
select bs_check('started service stays in progress after reversal', (select status from business_setup_services where id = :'started') = 'In progress');
select bs_check('balance returns', (business_setup_quote_balance(:'q')->>'net_paid')::numeric = 0);
select bs_expect_error($$select business_setup_service_update(:'second_line','In progress')$$, 'payment');
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement per workflow spec 5.5,** including the voucher register trigger with source `business_setup`, `voucher_set_local`, and `setup.payments.override` with reason for overpayment. Refused when the quote is locked.
- [ ] **Step 4: Run the runner.** Expected: all ok.
- [ ] **Step 5: Commit** with message `Add Business Setup payment ledger and receipts`.

### Task 4: Workspace reads, tasks, files and expiries

**Files:**
- Create: `migrations/008_workspace.sql`
- Modify: `tests/010_workflow_test.sql`

**Interfaces:**
- Produces: `business_setup_client_list() returns jsonb` with `client_id, legal_name, client_status, kyc_state, active_services, balance, missing_contact`; `business_setup_workspace(p_client text) returns jsonb`; `business_setup_dashboard() returns jsonb`; `business_setup_expiries(p_days int default 90) returns jsonb` with `kind, client_id, label, date, state` where state is `Upcoming` or `Past date`; `business_setup_task_save(p jsonb)`; `business_setup_document_add(p jsonb)`; bucket `business-setup-documents`.

- [ ] **Step 1: Write failing checks.**

```sql
select bs_check('past date state', (select e->>'state' from jsonb_array_elements(business_setup_expiries()) e where e->>'label' = 'past visa') = 'Past date');
select bs_check('91 days excluded', not exists (select 1 from jsonb_array_elements(business_setup_expiries()) e where e->>'label' = 'far visa'));
select bs_check('missing contact flag', (select (c->>'missing_contact')::boolean from jsonb_array_elements(business_setup_client_list()) c where c->>'client_id' = :'no_phone'));
select bs_check('partner ID masked without sensitive right', business_setup_workspace(:'cl')::text !~ 'A1234567');
select bs_check('client with no KYC profile renders', business_setup_workspace(:'bare') is not null);
```

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** `business_setup_visas` is created here so expiries can read it. Add the Business Setup line to `client_base_list()`. Dashboard counts are those in spec section 6.
- [ ] **Step 4: Run the runner.** Expected: all ok.
- [ ] **Step 5: Commit** with message `Add Business Setup workspace reads, tasks and expiries`.

### Task 5: Onboarding form and validation

**Files:**
- Create: `migrations/009_onboarding.sql`, `tests/030_onboarding_test.sql`, `Business Setup Module/logic/formDefinition.js`

**Interfaces:**
- Consumes: `client_portal_documents`, `client_master_save`, `business_setup_kyc_save`, `business_setup_partner_save`.
- Produces: portal functions, service role only: `business_setup_form_get(p_account uuid) returns jsonb`, `business_setup_form_save(p_account uuid, p_answers jsonb) returns jsonb`, `business_setup_form_submit(p_account uuid) returns jsonb`. Staff RPCs: `business_setup_form_list(p_status text default null)`, `business_setup_form_take(p_id uuid)`, `business_setup_form_return(p_id uuid, p_note text)`, `business_setup_form_validate(p_id uuid, p_contact jsonb, p_version integer)`, `business_setup_form_missing(p_id uuid) returns text[]`. `client_portal_documents.form_id` added. `client_inputs_can` widened.

- [ ] **Step 1: Write failing checks in `030_onboarding_test.sql`.**

```sql
select bs_check('login creates form', exists (select 1 from business_setup_onboarding_forms where account_id = :'acc' and status = 'Draft'));
select bs_check('one open form', (select count(*) from business_setup_onboarding_forms where client_id = :'cl' and status <> 'Validated') = 1);
select bs_expect_error($$select business_setup_form_save(:'submitted_acc','{}')$$, 'submitted');
-- Review Focus: unfinished upload
select bs_check('unfinished upload is missing', 'Passport' = any(business_setup_form_missing(:'f_partial')));
select bs_expect_error($$select business_setup_form_validate(:'f_partial','{}',1)$$, 'Passport');
select bs_check('no contact before validation', (select data->>'Email' from client_master where client_id = :'cl') is null);
-- after validate
select bs_check('contact on validation', (select data->>'Email' from client_master where client_id = :'cl') = 'a@b.test');
select bs_check('KYC done', (select kyc_state from business_setup_kyc_profiles where client_id = :'cl') = 'Done');
select bs_expect_error($$select business_setup_form_validate(:'f_stale','{}',1)$$, 'version');
select bs_check('address proof needs only one', not 'Address proof' = any(business_setup_form_missing(:'f_one_address')));
select bs_check('existing company needs licence', 'Licence number' = any(business_setup_form_missing(:'f_existing')));
select bs_check('new company needs no licence', not 'Licence number' = any(business_setup_form_missing(:'f_new')));
```

Use the real Client Master email and phone keys from `masterLogic.js`. Add two-session `form_take` and `form_validate` checks to `020_concurrency.sh`, where the loser's message names who took it.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The form definition is seeded into `business_setup_form_versions` as version 1 with the sections in spec 7.2. `formDefinition.js` holds only labels and rendering helpers; the database row is authoritative. Add a trigger on `client_portal_accounts` insert to create the form when a `client_master_id` is present.
- [ ] **Step 4: Run the runner.** Expected: all ok.
- [ ] **Step 5: Commit** with message `Add client onboarding form and validation`.

### Task 6: Client view and portal actions

**Files:**
- Create: `migrations/010_portal.sql`, `tests/040_portal_test.sql`, `Client Module/tests/setupPortal.test.mjs`
- Modify: `Client Module/supabase/client-portal/index.ts`

**Interfaces:**
- Consumes: `client_portal_session(p_token) returns uuid`, form functions from Task 5, `business_setup_quote_balance`.
- Produces: `business_setup_portal_view(p_account uuid) returns jsonb` with keys `form, services, quotes, payments, invoices, documents, details`; `business_setup_portal_file(p_account uuid, p_kind text, p_id uuid) returns jsonb` returning `{bucket, path}` or raising; `business_setup_portal_client(p_account uuid) returns text`. Edge actions `setup_view`, `form_get`, `form_save`, `form_submit`, `setup_file`.

- [ ] **Step 1: Write failing checks in `040_portal_test.sql`.**

```sql
select bs_check('own quote visible', business_setup_portal_view(:'acc_a')::text ~ 'BSQ-A');
select bs_check('other client hidden', business_setup_portal_view(:'acc_a')::text !~ 'BSQ-B');
select bs_expect_error($$select business_setup_portal_file(:'acc_a','quote',:'quote_b')$$, 'not found');
select bs_check('forbidden fields absent', business_setup_portal_view(:'acc_a')::text !~* 'internal note text|commission|owner|risk|reviewed_by');
select bs_check('superseded hidden', business_setup_portal_view(:'acc_a')::text !~ 'BSQ-OLD');
select bs_check('hidden output hidden', business_setup_portal_view(:'acc_a')::text !~ 'internal-output.pdf');
select bs_check('invoices empty array', business_setup_portal_view(:'acc_a')->'invoices' = '[]'::jsonb);
-- Review Focus: older account
select bs_check('banking-linked account resolves', business_setup_portal_client(:'acc_banking') = :'cl_banking');
select bs_check('unlinked account gets empty view', business_setup_portal_view(:'acc_none')->'services' = '[]'::jsonb);
select bs_check('contact from client master', client_portal_me(:'acc_a')->'record'->>'email' = 'master@a.test');
set role authenticated; select bs_expect_error($$select business_setup_portal_view(:'acc_a')$$, 'permission'); reset role;
set role anon; select bs_expect_error($$select business_setup_form_get(:'acc_a')$$, 'permission'); reset role;
```

- [ ] **Step 2: Add a static test in `setupPortal.test.mjs`.** Assert that every new action reads the account from `client_portal_session`, and that no request body field named `client_id` or `account_id` is read in those branches.
- [ ] **Step 3: Run both to see them fail.**
- [ ] **Step 4: Implement.** Replace `client_portal_me` in `010_portal.sql`, changing only email, phone and the fee comment. `setup_file` issues a signed URL of 300 seconds. A revoked session already fails in `client_portal_session`; add a check proving it.
- [ ] **Step 5: Run the runner and `node --test "Client Module/tests/setupPortal.test.mjs"`.** Expected: all ok.
- [ ] **Step 6: Commit** with message `Add client view of Business Setup records to the portal`.

### Task 7: Accounts handover

**Files:**
- Create: `migrations/011_accounts_handover.sql`, `tests/050_handover_test.sql`

**Interfaces:**
- Produces: `business_setup_send_to_accounts(p_quote uuid, p_remarks text default null) returns void`, `business_setup_accounts_review(p_quote uuid, p_action text, p_remarks text default null) returns void` with action `validate` or `revert`, `business_setup_accounts_queue() returns jsonb`, `business_setup_handover_state(p_quote uuid) returns jsonb` with `{ready, blockers, net_paid, outstanding, state}`. Table `business_setup_invoices` with no write RPC.

- [ ] **Step 1: Write failing checks.**

```sql
select bs_expect_error($$select business_setup_send_to_accounts(:'q_open')$$, 'not completed');
select bs_check('sends with balance due', (business_setup_handover_state(:'q_done')->>'outstanding')::numeric = 100);
-- after sending
select bs_expect_error($$select business_setup_service_update(:'svc_locked','In progress')$$, 'Accounts');
select bs_expect_error($$select business_setup_payment_add(:'pay_locked')$$, 'Accounts');
select bs_check('queue lists it', business_setup_accounts_queue()::text ~ :'q_done_num');
select bs_expect_error($$select business_setup_accounts_review(:'q_done','revert',null)$$, 'remarks');
-- revert reopens; validate closes
select bs_check('revert unlocks', not (select locked from business_setup_services where id = :'svc_locked'));
select bs_expect_error($$update business_setup_accounts_reviews set remarks = 'x'$$, 'append');
-- Review Focus: all cancelled with money held
select bs_check('all cancelled can send', (business_setup_handover_state(:'q_cancelled')->>'ready')::boolean);
select bs_check('net paid shown', (business_setup_handover_state(:'q_cancelled')->>'net_paid')::numeric = 500);
select bs_check('invoices not writable', not has_table_privilege('authenticated','public.business_setup_invoices','insert'));
```

The review functions require `banking_can('accounts.review')`, the existing Accounts permission.

- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement,** following the lock trigger pattern in Banking `011`.
- [ ] **Step 4: Run the runner.** Expected: all ok.
- [ ] **Step 5: Commit** with message `Add Business Setup handover to Accounts`.

### Task 8: Legacy import

**Files:**
- Create: `migrations/012_legacy_import.sql`, `scripts/legacy_load.py`, `tests/060_import_test.sql`, `tests/test_legacy_load.py`

**Interfaces:**
- Produces: `business_setup_import_stage(p_import uuid, p_rows jsonb)`, `business_setup_import_report(p_import uuid) returns jsonb` with per-source `matched, new, held, missing_phone, missing_email`, `business_setup_import_apply(p_import uuid) returns jsonb`, `business_setup_import_decide(p_row uuid, p_client text, p_decision text)`. CLI: `python legacy_load.py --resources <folder> --out <json>`; the upload step uses `--import-id` and is run only with approval.

- [ ] **Step 1: Write failing Python tests with invented sample rows.** Do not use real client data.

```python
def test_zone_mapping(): assert map_zone("DET") == map_zone("DED") == "Dubai Mainland"
def test_zone_unknown_held(): assert map_zone("ZZZ") is None
def test_name_normal(): assert norm("ABC Trading L.L.C") == norm("abc trading llc")
def test_bad_date_held(): assert parse_date("NEEDS TO ENTER") is None
def test_file_open_refused(tmp_path): # a ~$ lock file beside the workbook raises FileLocked
def test_csv_empty_columns_ignored(): assert master_csv_row(sample)["license_number"] is None
```

Show the full zone mapping to the user in the dry-run report. Use the sources and authorities in spec section 12.

- [ ] **Step 2: Write failing SQL checks.**

```sql
select bs_check('exact match links', (select match_client from business_setup_import_rows where source_key = 'exact') = :'cl');
select bs_check('near match held', (select decision from business_setup_import_rows where source_key = 'near') = 'held');
select bs_check('held does not block', (business_setup_import_apply(:'imp')->>'applied')::int > 0);
select bs_check('payment label only', not exists (select 1 from business_setup_payments where client_id = :'cl_hist'));
select bs_check('history is historical', (select historical from business_setup_services where name = 'hist svc'));
select bs_check('no login issued', not exists (select 1 from client_portal_accounts where client_master_id = :'cl_new'));
-- Review Focus: re-run after a staff edit
select bs_check('staff value survives', (select data->>'Email' from client_master where client_id = :'cl') = 'staff@a.test');
select bs_check('no duplicates on re-run', (select count(*) from business_setup_visas where client_id = :'cl') = 1);
select bs_check('difference reported', business_setup_import_report(:'imp')::text ~ 'differences');
```

- [ ] **Step 3: Run both to see them fail.**
- [ ] **Step 4: Implement.** Imported clients with KYC Form `Done` get `kyc_state = 'Done'`. Licence and status values come only from the authorities in spec section 12.
- [ ] **Step 5: Run the runner and the Python tests.** Run Python with `-I` and `pytest` from the scripts folder. Expected: all ok.
- [ ] **Step 6: Run a local dry run** on the real files, writing JSON to the scratchpad only, and save the counts for Task 15.
- [ ] **Step 7: Commit** migrations, script and tests. Do not stage any output file.

### Task 9: Quote templates

**Files:**
- Modify: `Template Module/logic/serviceDocs.js`, `Template Module/services/hubApi.js`
- Create: `Business Setup Module/logic/quoteData.js`, `Business Setup Module/tests/quoteData.test.mjs`, `Business Setup Module/scripts/fix_templates.py`
- Local output only: corrected `.docx` in `Business Setup Module/Resources/Templates/corrected/`

**Interfaces:**
- Produces: `quoteContext(quote, template, usdRate) returns {date, business_name, business_activity, items:[{sl,label,amount,amount_usd,remarks}], total, total_usd}`. `pcKind` and template lookup accept a template key from `business_setup_quote_templates`.

- [ ] **Step 1: Write failing tests.**

```js
test("USD uses one rate", () => assert.equal(quoteContext(q750, ifza, 3.6725).items[0].amount_usd, "204"));
test("total USD from rate", () => assert.equal(quoteContext(q1000, ifza, 3.6725).total_usd, "272"));
test("activity and name separate", () => { const c = quoteContext(q, mainland, 3.6725); assert.equal(c.business_activity, "Trading"); assert.equal(c.business_name, "Acme"); });
test("zero total renders", () => assert.equal(quoteContext(qZero, ifza, 3.6725).total, "0"));
```

- [ ] **Step 2: Run to see them fail.** `node --test "Business Setup Module/tests/quoteData.test.mjs"`
- [ ] **Step 3: Implement `quoteContext`.** The rounding rule is whole dollars, nearest.
- [ ] **Step 4: Implement `fix_templates.py`.** It edits copies only: `business_name` becomes `business_activity` under activity headings in Mainland, Rakez and SHAMS, and fixed add-on USD cells are recalculated at 3.6725. AED cells stay unchanged. Liquidation keeps `business_name`.
- [ ] **Step 5: Render all five with sample data and open each result.** Expected: no raw `{{`, correct activity, totals and images intact. Report which USD cells changed.
- [ ] **Step 6: Commit** code and script. Do not stage `.docx` files.

### Task 10: Staff shell, Dashboard, Clients and Fees

**Files:**
- Modify: `Business Setup Module/components/BusinessSetup.jsx`, `logic/nav.js`, `services/businessSetupApi.js`, `tests/static.test.mjs`
- Create: `components/Dashboard.jsx`, `Clients.jsx`, `FeeMaster.jsx`, `Documents.jsx`, `Tasks.jsx`, `logic/expiries.js`, `tests/logic.test.mjs`

**Interfaces:**
- Consumes: Task 4 RPCs, `business_setup_my_access`.
- Produces: `BusinessSetupApi` named functions, one per RPC.

- [ ] **Step 1: Write failing tests.** `NAV` equals `Dashboard, Onboarding, Clients, Services & Fees, Documents, Tasks, Import, Settings` and hides by permission. `expiries.js` labels Past date as "Check this date". `static.test.mjs` already fails on any RPC name or parameter the migrations do not define.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement the pages** per spec section 6, using `@banking/components/shared`. Extend `components/Settings.jsx` with the USD rate (setting key `usd_rate`, default 3.6725), the numbering link, roles and the current form version as read-only text.
- [ ] **Step 4: Run `node --test` and `npm run build` in `Main Module`.** Expected: pass, build succeeds.
- [ ] **Step 5: Commit** with message `Add Business Setup shell and list pages`.

### Task 11: Client Workspace

**Files:**
- Create: `components/Workspace.jsx`, `components/NewServiceFlow.jsx`, `components/workspace/{Overview,Kyc,Services,Quotes,Payments,Documents,Activity}.jsx`, `logic/{kyc,lines,balances,statuses}.js`
- Modify: `Template Module/components/ServiceDesk.jsx` only as workflow spec 5.2 requires, `tests/logic.test.mjs`, `tests/static.test.mjs`

**Interfaces:**
- Consumes: Tasks 2 to 4, `readDocuments`, `quoteContext`, `renderTemplate`, `saveFile`, `quoteData`, `letterData`, `mailDraft`.

- [ ] **Step 1: Write failing tests.** `kycMissing` names each required field and needs no licence for New. `buildLines` carries `service_name`, `action`, `fee_item_id`, and the description prefixes the action except for New. `balance` handles part payment, reversal and zero total. `canStart` returns false with net paid 0, true with net paid above 0 or total 0. `canComplete` returns false without a file. The status list matches the database.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement.** The quote picks a template from `business_setup_quote_templates`. The Services tab offers a start override with reason and completion with output upload, licence fields for company registration, and a `client_visible` tick. **Create file** appears when Word generation failed.
- [ ] **Step 4: Run `node --test` and the build.** Expected: pass.
- [ ] **Step 5: Commit** with message `Add Business Setup client workspace and service flow`.

### Task 12: Onboarding tab and Client Login tab

**Files:**
- Create: `components/Onboarding.jsx`, `components/workspace/ClientLogin.jsx`
- Modify: `Client Module/crm/ClientPortalAdmin.jsx` to export `AccessModal`, `Client Module/crm/ClientInputs.jsx` only to export per-document actions, `tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 5 staff RPCs, `client_portal_admin_save`, `client_portal_admin_set_status`, `staffCall`, `admin_preview`.

- [ ] **Step 1: Write a failing test in `logic.test.mjs`.** `contactChoice(master, form)` returns `{conflict:true}` when values differ, and the master value when the form is blank.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** The Onboarding page has status filter, Take, per-document Validate and Reject, Return with note, Fill from documents, conflict choice, and Validate listing what is missing. Client Login holds issue, reset, revoke and preview. The password is shown once to staff, never stored in the page after closing, and nothing is emailed.
- [ ] **Step 4: Run `node --test` and the build.** Expected: pass.
- [ ] **Step 5: Commit** with message `Add onboarding review and client login management`.

### Task 13: Client portal screens

**Files:**
- Create: `Client Module/portal/SetupView.jsx`, `Client Module/portal/SetupForm.jsx`
- Modify: `Client Module/portal/ClientPortal.jsx`, `Client Module/portal/portalApi.js`, `Client Module/tests/setupPortal.test.mjs`

**Interfaces:**
- Consumes: Edge actions from Task 6, `formDefinition.js` from Task 5.

- [ ] **Step 1: Write failing tests.** `formProgress(definition, answers)` lists missing required fields and shows renewal documents only when a renewal is requested. `portalSections(view)` returns no Business Setup sections for an empty view, so a Banking-only client sees today's portal. A static check confirms the portal imports nothing from staff modules except the existing shared components.
- [ ] **Step 2: Run to see them fail.**
- [ ] **Step 3: Implement** sections per spec section 8. The form autosaves with a debounce, shows the return note, locks while Submitted or In review, and uses the existing upload actions with `form_id`. An expired session returns to login, with the draft kept on the server. It must work at phone width.
- [ ] **Step 4: Run `node --test` and the build.** Expected: pass.
- [ ] **Step 5: Commit** with message `Add client form and status screens to the portal`.

### Task 14: Accounts tab and invoice panel

**Files:**
- Create: `Accounting Module/components/SetupValidation.jsx`, `Business Setup Module/components/ZohoInvoicePanel.jsx`
- Modify: `Accounting Module/components/AccountingModule.jsx`, `Business Setup Module/components/workspace/Services.jsx`, `Banking Module/components/BankProcess.jsx`, `Banking Module/tests/*` if a static check lists components

**Interfaces:**
- Consumes: Task 7 RPCs. `ZohoInvoicePanel` takes no required props and renders only the text "Invoice: Zoho is not connected yet. You can still send this to Accounts."

- [ ] **Step 1: Write a failing static test.** `BankProcess.jsx` renders `ZohoInvoicePanel` before `bk-complete`, and the panel has no `disabled`, `onClick` or RPC call.
- [ ] **Step 2: Run to see it fail.**
- [ ] **Step 3: Implement.** The Setup tab follows `BankingValidation.jsx`. The send screen shows outstanding and net paid. Banking gets only the panel, with no change to the button logic.
- [ ] **Step 4: Run `node --test` across Business Setup, Banking and the build.** Expected: pass.
- [ ] **Step 5: Commit** with message `Add Business Setup Accounts review and Zoho invoice panel`.

### Task 15: Import screen and report

**Files:**
- Create: `Business Setup Module/components/Import.jsx`, `Business Setup Module/docs/import-mapping.md` with no client data
- Modify: `tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 8 RPCs.

- [ ] **Step 1: Extend the static test** to include the import RPC names and `setup.import.manage`.
- [ ] **Step 2: Implement the page.** It shows counts per source, held rows with a client picker, decisions and differences. Apply needs a confirmation that states the row count.
- [ ] **Step 3: Run `node --test` and the build.** Expected: pass.
- [ ] **Step 4: Give the user the Task 8 counts and zone mapping.** Client data stays local. Record any corrections they give.
- [ ] **Step 5: Commit** with message `Add Business Setup import review`.

### Task 16: Whole-flow check and README

**Files:**
- Modify: `Business Setup Module/README.md`, `Database Module/Business Setup Base/README.md`, `Accounting Module/README.md`

- [ ] **Step 1: Run everything.** The runner, all `node --test` suites, Python tests and the Main Module build. Expected: all pass.
- [ ] **Step 2: Click through the real app** against the throwaway or a non-production database with invented data, using the browser preview: issue login, client fills the form on a phone-width view, staff return it, client fixes it, staff validate, quote from each of the five templates, accept, letter, part payment, receipt, start, complete with licence, client sees all of it, send to Accounts, revert, resend, validate. Take screenshots. If no non-production Supabase is available for the Edge Function, say so and list what stayed unverified. Do not use live instead.
- [ ] **Step 3: Update the READMEs,** including migration order and the fact that re-running Client Base `002` or `003` means re-running this base's `002` and `010`.
- [ ] **Step 4: Commit** with message `Document the Business Setup module`.

### Task 17: Go live (only on the user's separate approval)

- [ ] **Step 1: Ask for approval,** stating exactly what will run: migrations list, the Edge Function, the import row counts and the merge.
- [ ] **Step 2: Back up.** Export a JSON backup of `client_master`, `client_portal_*`, `hub_documents` and affected functions to git-ignored `Business Setup Base/data/backup-<date>/`.
- [ ] **Step 3: Apply migrations 001 to 012 and the private seed** in order, then run `get_advisors` for security. Expected: no new warning on `business_setup_*`.
- [ ] **Step 4: Deploy `client-portal`.** Check an existing portal login still works, using a login the user provides or tests themself. Do not enter a real password without their explicit go-ahead.
- [ ] **Step 5: Apply the import** once the user has accepted the dry-run report, then compare counts.
- [ ] **Step 6: Push and merge** after the user's approval, then confirm the GitHub Pages build. After opening a PR, use the `ccd_pr` tools.
- [ ] **Step 7: Report** what ran, what was verified with a real login, and what was not.
