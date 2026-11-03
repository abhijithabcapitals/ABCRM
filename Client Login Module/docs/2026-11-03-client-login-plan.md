# Client Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the live Client Portal so clients see their services with %, accounts, documents and information, can propose edits that staff validate, and admins manage logins from a full client list.

**Architecture:** Clients stay outside Supabase Auth. Everything a client reads or writes passes through the `client-portal` Edge Function into `service_role`-only SQL functions that return named fields for the session's own account. Staff screens call `authenticated` SQL functions guarded by `client_inputs_can()` or `client_portal_is_admin()`.

**Tech Stack:** React 19 and Vite (Main Module), `@banking/components/shared` UI, Supabase Postgres, Deno Edge Function, `node --test`, local Postgres 18 test cluster.

**Spec:** `Client Login Module/docs/2026-11-03-client-login-design.md`

## Global Constraints

- Work only on branch `client-login` in `D:\Abhijith Projects\CRM-client-login`. Never touch the main checkout at `D:\Abhijith Projects\CRM`.
- Nothing is applied to live, deployed or merged before Task 9's approval gate.
- New SQL functions: revoke from `public, anon, authenticated`, then grant by name, as at the end of `Client Base/migrations/003_client_portal.sql`. Migrations must be idempotent (the harness runs them twice).
- Never shown to clients: risk fields, source of funds, turnover, `remarks`, `received_by`, `reference_note`, `import_row_id`, approval fields, commission, staff names, `banking-documents` storage paths (no path field in any response; the only exposure is inside a client's own signed link).
- Signed links last 120 seconds. IBAN is masked to its last 4 characters.
- Keep existing `client_portal_me` keys (`record`, `services`, `master_services`, `documents`) because the old site must keep working during rollout. Only add keys.
- Match the surrounding style: one-line comments on why, `bk-*` classes, plain client-facing English.

## Review Focus

1. Case with `is_historical` true and no payments: client sees the "not held" message, and no amount reaches the browser even in the network response. Pinned in Task 2.
2. Client opens or changes another client's document or request by guessing an id: refused with "not found". Pinned in Tasks 2, 3.
3. Date field with an invalid value (`31/02/2026`, or text): refused at submit, and never fails later at validate. Pinned in Task 3.
4. Client clears a field or submits only spaces: refused with a message. Pinned in Task 3.
5. Staff validate after the official value changed: refused until confirmed, then written. Pinned in Task 3.

---

### Task 1: Move the portal into its module, and add the rules

**Files:**
- Move (`git mv`): `Client Module/portal/ClientPortal.jsx` and `portalApi.js` to `Client Login Module/portal/`; `Client Module/crm/ClientPortalAdmin.jsx` to `Client Login Module/admin/`; `Client Module/supabase/client-portal/index.ts` to `Client Login Module/supabase/client-portal/index.ts`
- Modify: `Main Module/vite.config.js` (alias `@client-login` = `../Client Login Module`), `Main Module/src/Root.jsx`, `Main Module/src/components/Login.jsx`, `Main Module/src/components/Settings.jsx`, `Client Module/crm/ClientsHub.jsx`, `Client Module/crm/ClientInputs.jsx`, `Client Module/README.md:82`
- Create: `Client Login Module/README.md`, `Client Login Module/logic/progress.js`, `Client Login Module/logic/fields.js`, `Client Login Module/tests/logic.test.mjs`

**Interfaces:**
- Produces:
  - `bankingProgress({ current_stage, outcome }) -> { state: "approved"|"rejected"|"open", percent: number|null, label: string }`
  - `FIELDS: [{ key, label, group, type: "text"|"date"|"email"|"url", masterOnly?: true }]`, with groups `Company`, `Licence`, `Contact`, `Tax`, and the 16 keys in Step 1
  - `fieldState(field, record, changes) -> { value, pending: string|null, rejectedNote: string|null, locked: boolean }`, where `locked` means staff hold it `in_review`, and `pending` is the proposed value of a `pending` or `in_review` request

- [ ] **Step 1: Write the failing tests** in `tests/logic.test.mjs` (`node:test`; import with relative paths)

```js
bankingProgress({ current_stage: 1, outcome: null }).percent === 7
bankingProgress({ current_stage: 13, outcome: null }).percent === 87
bankingProgress({ current_stage: 14, outcome: null }).percent === 93
bankingProgress({ current_stage: 17, outcome: null }).percent === 93
bankingProgress({ current_stage: 18, outcome: null }).percent === 100
bankingProgress({ current_stage: 8, outcome: "Approved" })  // { state: "approved", percent: 100, label: "Account opened" }
bankingProgress({ current_stage: 17, outcome: "Rejected" }) // { state: "rejected", percent: null, label: "Not approved" }
bankingProgress({ current_stage: 8, outcome: null }).label === "Document Collection & Verification"
FIELDS.map((f) => f.key).sort() // deepEqual the 16 keys:
// business_activity, company_email, company_phone, ct_registration_number, financial_year_end, issuing_authority,
// legal_name, legal_structure, license_expiry_date, license_issue_date, license_number, office_address,
// registered_address, trade_name, vat_trn, website
fieldState(f, { trade_name: "A" }, [{ field_key: "trade_name", status: "pending", new_value: "B" }]) // value "A", pending "B", locked false
fieldState(f, { trade_name: "A" }, [{ field_key: "trade_name", status: "in_review", new_value: "B" }]).locked === true
fieldState(f, { trade_name: "A" }, [{ field_key: "trade_name", status: "rejected", review_note: "No" }]).rejectedNote === "No"
```

Also add a static test: no file in `Main Module/src` or `Client Module/crm` contains `@client-module/portal`, `crm/ClientPortalAdmin` or `../portal/ClientPortal`.

- [ ] **Step 2: Run to confirm failure.** Run `node --test "Client Login Module/tests/logic.test.mjs"`. Expected: FAIL, module not found.
- [ ] **Step 3: Do the moves and the rules.** `git mv` the files, add the alias, update imports. `progress.js` imports `STAGES` and `uiStep` from `../../Banking Module/logic/constants.js`. `percent = Math.round(uiStep(stage) / 15 * 100)`. `ct_registration_number` and `financial_year_end` carry `masterOnly: true`.
- [ ] **Step 4: Run tests.** Same command. Expected: PASS.
- [ ] **Step 5: Build.** Run `npm ci` then `npm run build` in `Main Module`. Expected: build succeeds with no unresolved import.
- [ ] **Step 6: Commit** the spec, this plan and the task's files: `Move Client Portal into Client Login Module and add progress and field rules`.

### Task 2: Client read data (SQL)

**Files:**
- Create: `Database Module/Client Login Base/migrations/001_portal_views.sql`, `Database Module/Client Login Base/tests/000_stub.sql` (only if `Banking Base/tests/000_stub.sql` lacks what is needed), `tests/010_views_test.sql`, `tests/run-local.sh`, `Database Module/Client Login Base/README.md`

**Interfaces:**
- Consumes: `client_portal_accounts`, `client_portal_documents` from `Client Base/003`
- Produces (all `service_role` only except where stated):
  - `client_portal_me(p_account uuid) -> jsonb`: existing keys, plus
    - `record` gains every `FIELDS` key that is missing today (`license_issue_date`, `office_address`, `company_email`, `company_phone`)
    - `has_master boolean`
    - `banking_services: [{ case_id, case_ref, account_kind, bank, current_stage, outcome, account: { bank, account_name, opened_on, iban_masked } | null }]`
    - `accounts: [{ case_ref, bank, hidden: boolean, payable, paid, balance, direct_to_bank, lines: [{ payment_date, payment_ref, txn_type, amount, payment_method, receipt_number }] }]`
    - `filing_record: jsonb | null` (only the `client_master.data` keys `taxLogic.js` reads, plus `client_id`)
    - `gallery: [{ id, source: "kyc"|"generated", title, doc_type, doc_date, file_name, sensitive: boolean, can_open: boolean }]`
    - `changes: [{ field_key, new_value, status, review_note }]`, the latest request per field
  - `client_portal_gallery_path(p_account uuid, p_source text, p_id uuid) -> jsonb` as `{ storage_path, file_name }`, or null when not owned, deleted, sensitive or without a path
  - `client_portal_admin_clients() -> jsonb` (admin, `authenticated`): existing keys, plus `lines text[]`, `kyc_percent`, `email`, `phone`, `pending_edits`

- [ ] **Step 1: Write the harness.** `tests/run-local.sh` copies the file loading of `Banking Base/tests/run-local.sh` (local cluster on a free port, `PRIVATE_ROOT` default `/d/Abhijith Projects/CRM/Database Module`, stubs, then each dependency), adds `Client Base/migrations/003_*.sql` and `Client Login Base/migrations/*.sql`, runs all migrations twice, then every `0*_test.sql`.
- [ ] **Step 2: Write the failing tests** in `010_views_test.sql`, using `do` blocks with `raise exception` as `Banking Base/tests/010_workflow_test.sql` does. Seed clients A and B, each with a KYC profile, account, case and accepted quotation.

```sql
-- Open case, stage 8: banking_services[0].current_stage = 8, record keys present, no 'risk' or 'source_of_funds' key anywhere in the output text
-- Own case, quotation 1000, direct_to_bank 200, payments +600 and -100: payable 1000, paid 500, balance 500, direct_to_bank 200, hidden false
-- is_historical, no payments: hidden true, and payable, paid, balance, lines all null in the jsonb
-- is_imported quotation, no payments: hidden true
-- is_imported quotation with a payment: hidden false
-- Superseded quotation versions: payable uses the latest Accepted
-- Case with no quotation: payable and balance null, paid shown
-- Lines' text contains no 'remarks', 'received_by', 'reference_note', 'import_row_id'
-- account.iban_masked for 'AE070331234567890123456' = '••••3456'; no full IBAN or account_number anywhere in the output
-- Own non-sensitive doc: gallery can_open true; path function returns storage_path
-- Sensitive type: gallery sensitive true, can_open false; path function returns null
-- Deleted doc: absent from gallery; path function returns null
-- Client B's document id with account A: path function returns null
-- Generated doc with null storage_path: can_open false
-- Account with no KYC or case: returns [] arrays and no error
-- Execute rights: as authenticated, client_portal_me and client_portal_gallery_path raise permission denied
-- Admin list: non-admin refused; each row has kyc_percent; all clients appear whether or not they have an account
```

- [ ] **Step 3: Run to confirm failure.** Run `bash "Database Module/Client Login Base/tests/run-local.sh"`. Expected: FAIL on the first missing key.
- [ ] **Step 4: Write `001_portal_views.sql`.** `create or replace` the functions. `hidden` = `(c.is_historical or q.is_imported) and no payment rows`, and a hidden case returns null amounts from SQL itself. Latest quotation: `status = 'Accepted'` ordered by `version desc`. Master keys as in `FIELD_MAP` in `Client Module/crm/masterLogic.js:190`, and `TRN` for the VAT number.
- [ ] **Step 5: Run tests.** Same command. Expected: both migration passes OK and all checks pass.
- [ ] **Step 6: Commit:** `Add client portal views for services, accounts and documents`.

### Task 3: Change requests and validation (SQL)

**Files:**
- Create: `Database Module/Client Login Base/migrations/002_change_requests.sql`, `Database Module/Client Login Base/tests/020_changes_test.sql`, `Database Module/Client Login Base/tests/030_take_concurrency.sh`
- Modify: `Database Module/Client Login Base/tests/run-local.sh`, `Client Login Module/tests/logic.test.mjs`

**Interfaces:**
- Produces:
  - Table `client_portal_change_requests`: `id, account_id, field_key, old_value, new_value, status check (pending, in_review, validated, rejected, superseded), assigned_to, assigned_at, reviewed_by, reviewed_at, review_note, created_at`. RLS on, no browser grants. Unique partial index on `(account_id, field_key) where status in ('pending','in_review')`.
  - `client_change_submit(p_account uuid, p_field text, p_value text) -> uuid` (`service_role`)
  - `authenticated`, guarded by `client_inputs_can()`:
    - `client_changes_list() -> jsonb`: id, client, field_key, old_value, new_value, official_value, stale, status, assignee, assigned_to, can_decide, created_at, reviewer, reviewed_at, review_note
    - `client_changes_assignees() -> jsonb`: `[{ id, full_name }]`
    - `client_changes_take(p_id uuid) -> void`
    - `client_changes_assign(p_id uuid, p_to uuid) -> void`
    - `client_changes_release(p_id uuid) -> void`
    - `client_changes_decide(p_id uuid, p_status text, p_note text, p_force boolean default false) -> void`

- [ ] **Step 1: Write the failing tests** in `020_changes_test.sql`.

```sql
-- submit: unlisted key 'annual_turnover' raises; value equal to official raises; '   ' raises 'cannot be empty'; 501 chars raises
-- submit: license_expiry_date '31/02/2026' and 'soon' raise; '2027-01-31' accepted
-- submit: masterOnly field for a client with no master row raises
-- submit twice on one field: first becomes superseded, one pending remains
-- submit while in_review raises; 101st request in a day raises
-- pending request: banking_kyc_profiles.trade_name unchanged; client_portal_me.changes shows it
-- take: user without Clients tab raises; pending goes in_review with assigned_to; second take raises 'already taken'
-- assign: unassigned or own request to a member with the tab works; to a member without the tab raises; someone else's raises
-- release: other non-admin raises; assignee returns it to pending
-- decide: non-assignee non-admin raises; rejected with blank note raises; rejected leaves the record unchanged and note visible in me.changes
-- validate KYC field: value written, status validated, reviewed_by set, kyc completion_percent recalculated, admin_audit row present
-- validate license_number: both banking_kyc_profiles and banking_clients updated
-- validate master field: data updated, version + 1, client_master_history row with field, old_value, new_value
-- master-only account: legal_name writes data 'Client Legal Name' and the legal_name column
-- stale: official changed after submit; decide raises 'changed since'; with p_force true writes it
-- a closed case (accounts locked) does not block validating a KYC field
-- decide on an already decided request raises
-- no second account can read or decide through the service-role function: submit for A leaves B's list of changes empty
```

Add a Node test reading `002_change_requests.sql`: the key list in the SQL equals `FIELDS.map(f => f.key)`, so the two lists cannot drift. Add `030_take_concurrency.sh`, following `Business Setup Base/tests/020_concurrency.sh` on branch `business-setup-workflow`: two sessions take one request and exactly one succeeds.

- [ ] **Step 2: Run to confirm failure.** Same `run-local.sh`. Expected: FAIL, function missing.
- [ ] **Step 3: Write `002_change_requests.sql`.** Internal helpers `client_change_official(p_account, p_field) -> text` and `client_change_apply(p_account, p_field, p_value, p_actor) -> void`, `service_role` execute only and called from definer functions. Date values store as `date` in KYC. In `client_master.data` they use the format `fmtUae` writes, so `parseUaeDate` reads them back. A linked client with no KYC row gets one inserted. Field key to master key map: `legal_name` `Client Legal Name`, `trade_name` `Trade Name`, `legal_structure` `Entity Type`, `business_activity` `Main Business Activity`, `registered_address` `Registered Address`, `office_address` `Office Address`, `website` `Website`, `company_email` `General Email`, `company_phone` `General Phone`, `vat_trn` `TRN`, `license_number` `Trade License Number`, `license_issue_date` `License Issue Date`, `license_expiry_date` `License Expiry Date`, `issuing_authority` `License Issuing Authority`, `ct_registration_number` `CT Registration Number`, `financial_year_end` `Financial Year End`.
- [ ] **Step 4: Run all tests.** Run `run-local.sh` and `node --test "Client Login Module/tests/logic.test.mjs"`. Expected: PASS.
- [ ] **Step 5: Commit:** `Add client change requests with staff validation`.

### Task 4: Edge Function actions

**Files:**
- Modify: `Client Login Module/supabase/client-portal/index.ts`, `Client Login Module/portal/portalApi.js`
- Test: `Client Login Module/tests/logic.test.mjs` (static checks)

**Interfaces:**
- Consumes: `client_change_submit`, `client_portal_gallery_path`
- Produces:
  - Actions `submit_change { field, value } -> { id }` and `gallery_url { source, id } -> { url }`
  - `portalApi.submitChange(field, value)` and `portalApi.galleryUrl(source, id)`

- [ ] **Step 1: Write failing static tests.** The function source contains `case "submit_change"` and `case "gallery_url"`, each passes `accountId` and never reads an account from `body`. It signs gallery files from bucket `banking-documents` at 120 seconds. `portalApi` exports both methods.
- [ ] **Step 2: Run to confirm failure.** Run `node --test "Client Login Module/tests/logic.test.mjs"`. Expected: FAIL.
- [ ] **Step 3: Add the actions.** SQL exceptions from `client_change_submit` return as `InputError` text. A null path returns "Document not found." `source` must be `kyc` or `generated`.
- [ ] **Step 4: Verify.** Run the tests, then `deno check "Client Login Module/supabase/client-portal/index.ts"`. Expected: PASS, and no type errors.
- [ ] **Step 5: Commit:** `Add change submit and gallery links to the client-portal function`.

### Task 5: Portal screens

**Files:**
- Modify: `Client Login Module/portal/ClientPortal.jsx` (shell with four tabs, sign-out, change password)
- Create: `Client Login Module/portal/ServicesTab.jsx`, `AccountsTab.jsx`, `DocumentsTab.jsx`, `InformationTab.jsx`, `portal.css`

**Interfaces:**
- Consumes: `bankingProgress`, `FIELDS`, `fieldState`, the `client_portal_me` keys from Task 2, `portalApi` from Task 4, `compliance(rows, today)` from `@client-module/crm/taxLogic`
- Produces: `ClientPortal({ api, readOnly })`, unchanged, so View as client still works

- [ ] **Step 1: Write failing static tests.** Portal files contain no `.from(` or `supabase` import. `readOnly` appears in `InformationTab` and `DocumentsTab`. Exact strings present: `Payment history is not held in this system. Contact your account manager.`, `Held by AB Capital`, `Pending review`, `Not recorded yet`.
- [ ] **Step 2: Run to confirm failure.** Run `node --test "Client Login Module/tests/logic.test.mjs"`. Expected: FAIL.
- [ ] **Step 3: Build the tabs.**
  - **Services:** a card per `banking_services`, with a progress bar (`role="progressbar"` and `aria-valuenow`) and no bar when rejected.
  - **Accounts:** filing from `compliance([filing_record])` showing title, due date and status only; then a panel per case, with `DataTable` for ledger lines; a negative balance reads "In credit".
  - **Documents:** CSS grid of cards with category filter (All, Sent by you, Your KYC documents, From AB Capital), the existing `Upload` moved here.
  - **Information:** `FIELDS` grouped, hiding `masterOnly` when `has_master` is false. Edit opens `FormModal`. No edit controls when `readOnly` or `locked`. The preview API has no `submitChange` or `galleryUrl`, so cards do not open in `readOnly`.
- [ ] **Step 4: Verify.** Run the tests and `npm run build` in `Main Module`. Expected: PASS and build succeeds.
- [ ] **Step 5: Commit:** `Add services, accounts, documents and information tabs to the portal`.

### Task 6: Admin Settings client list

**Files:**
- Modify: `Client Login Module/admin/ClientPortalAdmin.jsx`
- Create: `Client Login Module/logic/adminFilters.js`
- Test: `Client Login Module/tests/logic.test.mjs`

**Interfaces:**
- Produces: `filterClients(rows, { access: ""|"on"|"revoked"|"none", kyc: ""|"complete"|"incomplete", line: "" | string }) -> rows`

- [ ] **Step 1: Write failing tests.**

```js
// rows: A { status: "active", kyc_percent: 100, lines: ["Business Banking"] }, B { status: "revoked", kyc_percent: 6, lines: [] }, C { status: null, kyc_percent: null, lines: [] }
filterClients(rows, { access: "on" })        // [A]
filterClients(rows, { access: "none" })      // [C]
filterClients(rows, { kyc: "complete" })     // [A]
filterClients(rows, { kyc: "incomplete" })   // [B, C]
filterClients(rows, { line: "Business Banking" }) // [A]
filterClients(rows, {})                      // all three
```

- [ ] **Step 2: Run to confirm failure.** Run the Node tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Columns per spec section 7. Replace the With access and All clients tabs with three select filters. Default is all clients. `DataTable` search already matches any returned value, so `email` and `phone` are searchable once returned. Give access stays open to every client.
- [ ] **Step 4: Verify.** Run the tests and `npm run build`. Expected: PASS and build succeeds.
- [ ] **Step 5: Commit:** `Extend the admin client list with KYC, filters and pending edits`.

### Task 7: Staff validation screen

**Files:**
- Create: `Client Login Module/admin/InformationChanges.jsx`, `Client Login Module/logic/fieldLabel.js` only if `FIELDS` cannot serve labels directly
- Modify: `Client Module/crm/ClientInputs.jsx` (a Documents and Information Changes switch at the top)
- Test: `Client Login Module/tests/logic.test.mjs` (static checks)

**Interfaces:**
- Consumes: `client_changes_*` from Task 3, `FIELDS`

- [ ] **Step 1: Write failing static tests.** `ClientInputs.jsx` imports `@client-login/admin/InformationChanges`. `InformationChanges.jsx` calls every `client_changes_*` function and passes `p_force`.
- [ ] **Step 2: Run to confirm failure.** Run the Node tests. Expected: FAIL.
- [ ] **Step 3: Build the screen,** following `ClientInputs.jsx`: Waiting, In review, Validated and Rejected views with counts. Columns: client, field label, current official value, proposed value, assignee, received. Actions: Take, Assign to (select from `client_changes_assignees`), Release, Validate, Reject (a required reason, via `FormModal`). A `stale` row shows both values, and Validate asks for confirmation before sending `p_force: true`. Errors show in `ErrorNote`, then the list reloads.
- [ ] **Step 4: Verify.** Run the tests and `npm run build`. Expected: PASS and build succeeds.
- [ ] **Step 5: Commit:** `Add Information Changes review to Client Inputs`.

### Task 8: Release preparation

**Files:**
- Create: `Database Module/Client Login Base/rollback/001_002_rollback.sql`
- Modify: `Client Login Module/README.md`, `Database Module/Client Login Base/README.md`, `Database Module/README.md`, `Client Module/README.md`

- [ ] **Step 1: Write the rollback.** It drops the new table and functions and restores `client_portal_me` and `client_portal_admin_clients` from `Client Base/003`. Run it on the local cluster and confirm `client_portal_me` then returns the old keys.
- [ ] **Step 2: Update READMEs,** including the run order and the deploy steps in Task 9. Mention the old `@client-module/portal` paths only as moved.
- [ ] **Step 3: Run everything.** Run `run-local.sh`, `node --test "Client Login Module/tests/logic.test.mjs"`, `node --test "Banking Module/tests/logic.test.mjs"`, and `npm run build` and `npm run lint` in `Main Module`. Expected: all pass, with no new lint errors in changed files.
- [ ] **Step 4: Commit:** `Add rollback and docs for Client Login`.

### Task 9: Live release (approval gate)

Stop and ask the user before each numbered action. Each one changes production.

- [ ] **Step 1: Ask to apply SQL and deploy the function.** On approval, work in this order: migrations, then `audit_trail_attach_all()`, then function, then site. Run `001`, then `002`, from `D:\Abhijith Projects\CRM\Agent Module\11_Personal_Agent\CEO Agent` with `npx --no-install supabase db query --linked --project-ref pnnakrhfzyxudjaghoxx -f <file>`. Then run `select public.audit_trail_attach_all();` the same way. Then deploy the Edge Function with `supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api`, from a temporary workdir holding `supabase/functions/client-portal/index.ts`. The site follows in Step 3. Confirm the live site still loads and a signed-in client flow on the old pages still works.
- [ ] **Step 2: Ask which client to test with.** Browser check on local dev (`npm run dev` against live Supabase): give access, sign in, all four tabs, open a document, propose an edit, take it, validate it, confirm the CRM record changed, View as client, phone width. Reverse the test edit, then revoke the test login.
- [ ] **Step 3: Ask to merge to `main`.** On approval, merge `client-login` and push. Pages deploys. Confirm the deployed site's login page loads.
- [ ] **Step 4: Save a memory note** of what is live and the open items from spec section 13.
