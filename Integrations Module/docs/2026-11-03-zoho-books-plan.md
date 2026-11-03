# Zoho Books connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff create draft Zoho Books estimates and invoices from CRM quotes through one restricted Edge Function, and the CRM reads their status back.

**Architecture:** A `zoho-books` Edge Function is the only code that talks to Zoho. Pure modules hold the allowlist and the mapping, so they test without a network. Two tables track contact links and created drafts, and one shared React panel replaces `ZohoInvoicePanel`.

**Tech Stack:** Deno Edge Functions (`deno test`), Supabase Postgres (local cluster via `run-local.sh`), React with Vite, `node:test` for `.mjs` logic and static tests.

**Spec:** `Integrations Module/docs/2026-11-03-zoho-books-design.md`

## Global Constraints

- Work in a new worktree `D:\Abhijith Projects\CRM-zoho`, branch `zoho-books`, cut from `origin/main`. Never commit to `banking-new-lead-fix`, and never run functions or migrations against live without the approval steps in Tasks 5 and 10.
- Token scopes exactly: `ZohoBooks.invoices.READ`, `ZohoBooks.invoices.CREATE`, `ZohoBooks.estimates.READ`, `ZohoBooks.estimates.CREATE`, `ZohoBooks.contacts.READ`, `ZohoBooks.settings.READ`.
- Only the eight method and path pairs in spec section 3 can leave the function. `send` is always `false`.
- Tokens, secrets and auth codes never appear in responses, logs, the `error` column or tests. Read credentials only with `requireSecret`.
- Deploy from module folders, never from `Agent Module/11_Personal_Agent/CEO Agent`: `supabase functions deploy zoho-books --project-ref pnnakrhfzyxudjaghoxx --use-api`, with `secrets.ts` copied next to `index.ts`.
- `ZohoPanel` never disables or hides Send to Accounts or `bk-complete`.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- A double press, or two staff pressing at once: one draft results, and both see it.
- Staff delete a draft in Zoho, then want a new one: the CRM notices and allows it.
- An invoice is voided after a client has seen it: it disappears from Client Login.
- A Zoho contact billed in a currency other than AED: linking refuses it, since CRM amounts are AED.
- Credentials half saved, or the wrong data centre: a plain "not connected" or "Zoho refused" message, and Send to Accounts still works.

---

# Part A: connection (ships from `main`)

### Task 1: Restricted Zoho client

**Files:**
- Create: `Integrations Module/supabase/zoho-books/zohoClient.ts`
- Copy for deploy: `Integrations Module/supabase/_shared/secrets.ts`
- Test: `Integrations Module/supabase/zoho-books/zohoClient.test.ts`

**Interfaces:**
- Produces: `assertAllowed(method: string, path: string, query: Record<string,string>): void` (throws `NotAllowedError`), `scrub(text: string, secrets: string[]): string`, `hostsFor(dc: string): { accounts: string; api: string }`, `class ZohoHttpError { status: number; code?: number; message: string }`, `createZohoClient(cfg: { clientId; clientSecret; refreshToken; orgId; dc }, fetchFn = fetch): { get(path, query?), post(path, body, query?) }`.

- [ ] **Step 1: Write failing tests**

```ts
Deno.test("refuses anything not on the list", () => {
  for (const [m, p] of [["PUT","/invoices/1"],["DELETE","/invoices/1"],["POST","/contacts"],["GET","/users"],
    ["POST","/invoices/1/status/sent"],["POST","/invoices/1/email"],["GET","/invoices/../users"]])
    assertThrows(() => assertAllowed(m, p, {}), NotAllowedError);
});
Deno.test("allows the listed reads and creates", () => {
  for (const [m, p] of [["GET","/organizations"],["GET","/contacts"],["GET","/contacts/12"],["GET","/items"],
    ["GET","/settings/taxes"],["GET","/estimates/12"],["GET","/invoices"],["POST","/estimates"],["POST","/invoices"]])
    assertAllowed(m, p, { send: "false" });
});
Deno.test("a create with send=true is refused", () => assertThrows(() => assertAllowed("POST","/invoices",{send:"true"}), NotAllowedError));
Deno.test("ae uses the UAE servers", () => assertEquals(hostsFor("ae"), { accounts: "https://accounts.zoho.ae", api: "https://www.zohoapis.ae/books/v3" }));
Deno.test("an unknown data centre is refused", () => assertThrows(() => hostsFor("evil.example")));
Deno.test("post always sends send=false and organization_id", async () => { /* fake fetch records the URL */
  // assert url has send=false & organization_id=ORG, header Authorization "Zoho-oauthtoken T"
});
Deno.test("the access token is refreshed once, then reused", async () => { /* two gets, one token call */ });
Deno.test("a failed refresh names no secret", async () => { /* message excludes client secret and refresh token */ });
```

- [ ] **Step 2: Run** `deno test --allow-none "Integrations Module/supabase/zoho-books/zohoClient.test.ts"`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `zohoClient.ts`.** Valid data centres: `com, eu, in, com.au, jp, ca, com.cn, sa, ae`. Match paths with anchored regexes and digits-only IDs. Refresh by POST to `{accounts}/oauth/v2/token` with `grant_type=refresh_token`. Parse Zoho's `{ code, message }` into `ZohoHttpError`, and pass every message through `scrub`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add restricted Zoho Books client`.

### Task 2: Tables

**Files:**
- Create: `Database Module/Admin Base/migrations/004_zoho.sql`, `Database Module/Admin Base/migrations/rollback/004_rollback.sql`, `Database Module/Admin Base/tests/030_zoho_test.sql`
- Modify: `Database Module/Admin Base/tests/000_stub.sql` (add a minimal `client_master(client_id text primary key)`), `Database Module/Admin Base/tests/run-local.sh` (run `004_*.sql` and the new test)

**Interfaces:**
- Produces: `public.zoho_contact_links`, `public.zoho_documents` with spec section 6 columns, plus `crm_total numeric(18,2)`. `state` allows `creating, created, failed, unknown, gone`. Unique index `zoho_documents_one_per_source` on `(source_table, source_id, kind)`.

- [ ] **Step 1: Write failing SQL tests** using the file's `ok` / `FAILED` output style: `source_table` rejects other values; `kind` rejects `credit`; a second row for one source and kind fails; `authenticated` can select but insert, update and delete fail; `anon` cannot select; a bad `state` fails.
- [ ] **Step 2: Run** `bash "Database Module/Admin Base/tests/run-local.sh"`. Expected: `FAILED` on the new tests. Needs PostgreSQL at `PG_BIN`, default `C:\Program Files\PostgreSQL\18\bin`.
- [ ] **Step 3: Write `004_zoho.sql`,** idempotent like `003_audit_trail.sql`. RLS on, a select policy for `authenticated`, and no write grants, since only the service role writes. The hourly job in `003` adds the audit trigger, so add none here. Write the rollback too.
- [ ] **Step 4: Run again.** Expected: migrations pass twice, all tests `ok`, and earlier tests still pass.
- [ ] **Step 5: Commit** `Add Zoho link and document tables`.

### Task 3: Edge Function, connection and contact actions

**Files:**
- Create: `Integrations Module/supabase/zoho-books/index.ts`, `Integrations Module/supabase/zoho-books/handlers.ts`, `Integrations Module/supabase/zoho-books/handlers.test.ts`

**Interfaces:**
- Consumes: `createZohoClient`, `requireSecret`, tables from Task 2.
- Produces: `handle(action: string, body: any, deps: Deps): Promise<object>`, with `Deps = { isAdmin(): Promise<boolean>; can(department, permission): Promise<boolean>; db; zoho(): Promise<Client>; userId: string; now(): Date }`. Actions: `connection_test`, `taxes_list`, `contacts_search {query, department}`, `contact_link {client_id, zoho_contact_id, department}`, `contact_get {client_id}`.

- [ ] **Step 1: Write failing tests** with fake `Deps`.

```ts
Deno.test("connection_test and taxes_list are admin only");       // isAdmin false -> rejects "Only a CRM admin"
Deno.test("connection_test fails when the org is not returned");  // organizations lacks ORG -> message names the setting, not the value
Deno.test("contacts_search needs the department permission");     // can false -> rejects; Business Setup checks setup.quotes.manage, Banking checks cases.manage
Deno.test("contact_link saves the name Zoho returns, not one from the browser");
Deno.test("contact_link refuses a non-AED contact");              // currency_code USD -> rejects, nothing saved
Deno.test("missing credentials report connected:false");          // zoho() throws MissingSecretError -> { connected:false, message }
Deno.test("an unknown action is refused");
```

- [ ] **Step 2: Run** `deno test --allow-none "Integrations Module/supabase/zoho-books/handlers.test.ts"`. Expected: FAIL.
- [ ] **Step 3: Implement `handlers.ts`.** Search contacts with Zoho's `contact_name_contains`, returning `id, name, tax_reg_no, currency_code`. In `contact_link`, fetch `/contacts/{id}` and take name and currency from Zoho's reply.
- [ ] **Step 4: Implement `index.ts`,** following the auth and CORS pattern in `crm-connections/index.ts`. `can` calls `business_setup_can` or `banking_can` through the user's client, so a missing function or an error counts as no permission. `zoho()` reads the five credentials with `requireSecret`. Return plain-language errors, and log only scrubbed text.
- [ ] **Step 5: Run the tests.** Expected: PASS. Also run `deno check "Integrations Module/supabase/zoho-books/index.ts"`.
- [ ] **Step 6: Commit** `Add zoho-books function with connection and contact actions`.

### Task 4: Settings screen

**Files:**
- Create: `Integrations Module/components/ZohoConnection.jsx`, `Integrations Module/tests/static.test.mjs`
- Modify: `Integrations Module/components/IntegrationsPanel.jsx` (render inside the `zoho-books` card), `Integrations Module/registry.json`, `Integrations Module/README.md`

**Interfaces:**
- Consumes: `connection_test`, `taxes_list`. Saves the VAT choice as `ZOHO_VAT_TAX_ID` through the existing `crm-connections` `credential_set`.
- Produces: registry entry with `ZOHO_DC` and `ZOHO_VAT_TAX_ID` added, `status: "in_use"`, `usedBy: "zoho-books function"`.

- [ ] **Step 1: Write failing static tests:** the registry entry lists all six names with `source` and `use`; no source file under `Integrations Module/components` contains `client_secret` or `refresh_token`; `zoho-books/` has no `PUT` or `DELETE` string outside tests.
- [ ] **Step 2: Run** `node --test "Integrations Module/tests/static.test.mjs"`. Expected: FAIL.
- [ ] **Step 3: Build `ZohoConnection({ supabase })`:** a Test button showing the organisation name or the plain error, and a select of Zoho taxes that saves the choice. Use the `call` pattern from `IntegrationsPanel.jsx:34`.
- [ ] **Step 4: Update the README** with what is connected and the deploy command.
- [ ] **Step 5: Run the tests and** `npm run build` in `Main Module`. Expected: PASS, build succeeds.
- [ ] **Step 6: Commit** `Add Zoho connection to Settings`.

### Task 5: Live read-only proof

Needs the user. Stop if any answer is no.

- [ ] **Step 1: Ask the user to approve** applying `004_zoho.sql` and deploying `zoho-books` to live. State both in full.
- [ ] **Step 2: The user creates the token** with the scopes above and saves the six values in Settings. Never ask for the values in chat.
- [ ] **Step 3: Press Test.** Expected: the right organisation name. Then load the tax list and pick the 5% code.
- [ ] **Step 4: Prove Lock 1.** With the user's approval and a draft the user names, send one `PUT` from a throwaway local script outside the function. Expected: Zoho refuses it with a scope error. If Zoho accepts it, stop, tell the user, and revoke the token.
- [ ] **Step 5: Search one known client.** Expected: match returned, nothing changed in Zoho.
- [ ] **Step 6: Record results** in `Integrations Module/README.md` and commit `Record Zoho live check`.

---

# Part B: drafts and read-back

**Gate:** `business-setup-module` must be merged to `main` first. If not, stop and tell the user. Then bring `zoho-books` up to date with `main`.

### Task 6: Mapping

**Files:**
- Create: `Integrations Module/supabase/zoho-books/mapping.ts`, `Integrations Module/supabase/zoho-books/mapping.test.ts`

**Interfaces:**
- Produces: `type Source = { department; clientId: string|null; reference: string; status: string; total: number; vatMode: "inclusive"|"exclusive"|"none"; lines: {name: string; amount: number}[]; discount: number }`, `fromHub(row): Source`, `fromBanking(row, clientMasterId): Source`, `toZohoBody(src: Source, customerId: string, vatTaxId: string|null, today: string): object`, `totalsMatch(crm: number, zoho: number): boolean`, `canCreate(src: Source, kind): string|null`, `clientVisible(zohoStatus: string): boolean`, `dubaiToday(now: Date): string`.

- [ ] **Step 1: Before writing code, open Zoho's estimate and invoice docs** and confirm line item fields `name`, `rate`, `quantity`, `tax_id`, plus invoice-level `discount` and `is_inclusive_tax`. Note any difference in the test file.
- [ ] **Step 2: Write failing tests.**

```ts
Deno.test("hub lines use service_name, then description");
Deno.test("inclusive sets is_inclusive_tax and tax_id on every line");
Deno.test("exclusive sets is_inclusive_tax false with tax_id");
Deno.test("none sends no tax_id");
Deno.test("banking makes bank, service and supplementary lines, dropping zero ones");
Deno.test("banking discount_total goes in discount");
Deno.test("direct_to_bank_total and memo fields are never sent");
Deno.test("reference_number is the CRM number and no invoice_number is sent");
Deno.test("totalsMatch allows 0.01 and refuses 0.02");
Deno.test("a VAT quote with no tax code is refused");            // canCreate-level message
Deno.test("canCreate: an invoice needs an accepted quote; rejected and superseded quotes create nothing");
Deno.test("clientVisible: sent, overdue, paid, unpaid, partially_paid true; draft, void, pending_approval, unknown false");
Deno.test("dubaiToday rolls over at 20:00 UTC");
```

- [ ] **Step 3: Run** `deno test --allow-none "Integrations Module/supabase/zoho-books/mapping.test.ts"`. Expected: FAIL.
- [ ] **Step 4: Implement `mapping.ts`.** Unknown statuses are hidden from clients.
- [ ] **Step 5: Run the tests.** Expected: PASS.
- [ ] **Step 6: Commit** `Add quote to Zoho mapping`.

### Task 7: Create drafts

**Files:**
- Modify: `Integrations Module/supabase/zoho-books/handlers.ts`, `handlers.test.ts`, `index.ts`

**Interfaces:**
- Consumes: Task 6 and Task 2.
- Produces: action `document_create {source_table, source_id, kind}` returning `{ state, zoho_id, zoho_number, total_warning: boolean, earlier_draft: string|null, url }`.

- [ ] **Step 1: Write failing tests** with fake `Deps`.

```ts
Deno.test("Business Setup estimate needs setup.quotes.manage, invoice needs setup.services.manage, Banking needs cases.manage");
Deno.test("no contact link returns needs_contact and calls nothing");
Deno.test("a banking client with no client_master_id says so");
Deno.test("the row is written as creating before the POST");
Deno.test("a match on reference_number is adopted with no POST");
Deno.test("a double press: unique violation returns the existing row, one POST only");
Deno.test("a timeout after POST sets unknown; retry searches first and adopts");
Deno.test("a Zoho validation error sets failed with Zoho's message, and retry reuses the row");
Deno.test("a retry on gone creates again");
Deno.test("a total difference returns total_warning and keeps created");
Deno.test("a revised quote reports the earlier draft's number");
Deno.test("429 says Zoho is busy and leaves the row retryable");
```

- [ ] **Step 2: Run** the handler tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Load the source server-side only, never from the browser: `hub_documents` for `doc_type='quote'`, or `banking_quotations` joined through `banking_cases` to `banking_clients.client_master_id`. Build the Open in Zoho link from the data centre domain and `zoho_id`. For `earlier_draft`, follow `revises_id` or `supersedes_id`.
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Create draft estimates and invoices in Zoho`.

### Task 8: Panel in both departments

**Files:**
- Create: `Integrations Module/components/ZohoPanel.jsx`, `Integrations Module/logic/zohoPanel.js`, `Integrations Module/tests/zohoPanel.test.mjs`
- Modify: `Integrations Module/index.js`, `Business Setup Module/components/workspace/Quotes.jsx:62`, `Banking Module/components/BankProcess.jsx:176`, `Business Setup Module/tests/static.test.mjs`
- Delete: `Business Setup Module/components/ZohoInvoicePanel.jsx`

**Interfaces:**
- Consumes: `contact_get`, `contacts_search`, `contact_link`, `document_create`, `document_state` (Task 9).
- Produces: `<ZohoPanel supabase department sourceTable sourceId kinds canCreate />`, and `panelMode(state): "not_connected"|"needs_contact"|"ready"|"created"|"failed"|"unknown"|"gone"`.

- [ ] **Step 1: Write failing tests:** `panelMode` for each state; `ZohoPanel.jsx` source has no `disabled` tied to the Accounts action; `Quotes.jsx` and `BankProcess.jsx` import `ZohoPanel` and keep `Send to Accounts` and `bk-complete`; the old panel file is gone. Update the existing static test in `Business Setup Module/tests/static.test.mjs` that expects `ZohoInvoicePanel`.
- [ ] **Step 2: Run** `node --test "Integrations Module/tests/zohoPanel.test.mjs" "Business Setup Module/tests/static.test.mjs"`. Expected: FAIL.
- [ ] **Step 3: Build the panel** with the `bk-` classes and shared `Button` and `ErrorNote`. Keep the current notice when not connected. The contact picker shows name, TRN and currency. After a press, block the button while busy. Show the total warning and earlier draft warning as `bk-alert-warn`. Business Setup shows both kinds; `kinds` is `["estimate","invoice"]` in both departments.
- [ ] **Step 4: Run the tests and** `npm run build` in `Main Module`. Expected: PASS.
- [ ] **Step 5: Start the dev server with `preview_start`** and open a quote as a staff user. Expected: not connected notice with Send to Accounts usable. Screenshot it. If no test login exists, say this was not browser-tested.
- [ ] **Step 6: Commit** `Replace Zoho placeholder with working panel`.

### Task 9: Read-back and Client Login

**Files:**
- Create: `Database Module/Admin Base/migrations/005_zoho_invoices.sql`, `Database Module/Admin Base/migrations/rollback/005_rollback.sql`
- Modify: `Integrations Module/supabase/zoho-books/handlers.ts`, `handlers.test.ts`, `Database Module/Business Setup Base/tests/040_portal_test.sql`

**Interfaces:**
- Produces: action `document_state {source_table, source_id, force?}` returning the rows for that source. Unique index `business_setup_invoices_zoho_uq` on `zoho_id`.

- [ ] **Step 1: Write failing tests.**

```ts
Deno.test("no second Zoho call within 15 minutes unless forced");
Deno.test("a draft adds no business_setup_invoices row");
Deno.test("a sent invoice adds one row with number, date and total, source zoho");
Deno.test("reading twice leaves one row");
Deno.test("a void invoice removes the row");
Deno.test("an estimate never adds a row");
Deno.test("a Banking invoice adds a row with quote_id null");
Deno.test("404 from Zoho sets gone and removes any row");
Deno.test("a Zoho failure leaves the last status and reports it");
```

Add to `040_portal_test.sql`: the portal view shows only that client's rows, and a row with no file reports `has_file` false.

- [ ] **Step 2: Run** handler tests and `bash "Database Module/Business Setup Base/tests/run-local.sh"`. Expected: FAIL.
- [ ] **Step 3: Implement `document_state` and the migration.**
- [ ] **Step 4: Run both.** Expected: PASS.
- [ ] **Step 5: Commit** `Read Zoho status back and show sent invoices to clients`.

### Task 10: Live test

Needs the user at each step.

- [ ] **Step 1: Ask the user to approve** applying `005_zoho_invoices.sql`, deploying the function, and releasing the panel. State each in full.
- [ ] **Step 2: The user names one client.** Create one estimate and one invoice. Expected: both in Zoho as unsent drafts, totals equal, and no row in Client Login.
- [ ] **Step 3: The user sends the invoice in Zoho,** then presses Refresh. Expected: it appears in Client Login for that client only.
- [ ] **Step 4: The user voids and removes the test documents.** Press Refresh. Expected: gone from Client Login, and the panel offers a new draft.
- [ ] **Step 5: Press Send to Accounts on a case with Zoho errors or not connected.** Expected: still works. Skip if no safe case exists, and say so.
- [ ] **Step 6: Update `Integrations Module/README.md`, commit** `Record Zoho live test`.
