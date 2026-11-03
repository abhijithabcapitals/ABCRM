# Knowledge Client Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Knowledge to all CRM staff, replace copying with per-client sharing, and show shared items in the client portal.

**Architecture:** Builds on the existing `knowledge-module` branch, none of which is live, so migration `001` is edited in place. New migration `002` holds shares, reached only through `security definer` functions. The portal reads through the `client-portal` Edge Function, which takes the account from the client's session.

**Tech Stack:** Postgres (Supabase), Deno Edge Function, React with Vite, `node --test`, local throwaway Postgres for SQL tests.

**Spec:** `Knowledge Module/docs/2026-11-03-knowledge-module-design.md`. This plan replaces Task 8 of `2026-11-03-knowledge-module-plan.md`.

## Global Constraints

- Work in worktree `D:/Abhijith Projects/CRM-knowledge`, branch `knowledge-module`. Python: `D:/Abhijith Projects/CRM/.venv/Scripts/python.exe`.
- Nothing runs against Supabase project `pnnakrhfzyxudjaghoxx` without the user's approval for that step. Tasks 1 to 6 touch no live database.
- Prices never enter Git. Tests use invented values.
- Clients never receive: `status`, `visibility`, `source_ref`, approvals, `basis`, `payee`, `confidence`, `service_fee_min`, `service_fee_max`, `source`, `remarks`, `bank_fee_collected_by_ab`, staff names, other clients' shares.
- Only `Knowledge Module/services/knowledgeApi.js` imports the Supabase client inside `Knowledge Module`.
- Screen copy, exact: "Draft: confirm before quoting." · "Price may be out of date." · "Banking prices could not load" · "Hidden from client" · "Nothing has been shared with you yet."
- VAT sentences, exact: "Prices exclude VAT unless stated otherwise." · "AB Capital service fee includes VAT."
- End commit messages with: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

## Review Focus

- **Withdraw, then share again:** a new open share appears and the old row stays as the record. Test in Task 2.
- **Revoked portal login:** it isn't offered, and a direct share is refused. Test in Task 2.
- **Same bank with a null scheme, shared twice:** one open share, as a null must not defeat uniqueness. Test in Task 2.
- **Shared item edited, then approved again:** hidden while Draft, back without re-sharing. Test in Task 2.
- **Article with script in the client's portal:** removed on display, nothing runs. Test in Task 6.

---

### Task 1: Bring the branch up to date and open the tab to all staff

**Files:**
- Modify: `Main Module/src/tabs.js`, `Main Module/src/components/Sidebar.jsx`, `Main Module/db/edge-function-admin-users.ts`
- Test: `Main Module/tests/tabs.test.mjs`

**Interfaces:**
- Produces: `resolveView("knowledge", false, [])` returns `"knowledge"`; `GRANTABLE_TABS` has no `knowledge`.

- [ ] **Step 1: Merge `origin/main` into `knowledge-module`, then run `npm ci` in `Main Module`**

A dry run showed no conflicts. Expected: `node --test "Knowledge Module/tests/"` and `npm run build` pass.

- [ ] **Step 2: Write the failing tests**

```js
test("any member reaches knowledge with no grant", () => assert.equal(resolveView("knowledge", false, []), "knowledge"));
test("knowledge is not grantable", () => assert.ok(!GRANTABLE_TABS.some((t) => t.key === "knowledge")));
test("a member's first page ignores knowledge", () => assert.equal(resolveView("settings", false, ["hr"]), "hr"));
```

- [ ] **Step 3: Run to verify they fail**

Run: `node --test "Main Module/tests/tabs.test.mjs"`
Expected: FAIL on the first two.

- [ ] **Step 4: Implement**

`tabs.js`: export `OPEN_TABS = new Set(["knowledge"])`, checked at the top of `resolveView`. `Sidebar.jsx`: always show the item, in each person's saved order. `edge-function-admin-users.ts`: remove `"knowledge"` from `TABS`.

- [ ] **Step 5: Run, build, commit**

Expected: tests and build pass. Commit "Open the Knowledge tab to all staff".

### Task 2: Staff read rules, shares and sharing functions

**Files:**
- Modify: `Database Module/Knowledge Base/migrations/001_knowledge.sql`, `migrations/rollback/001_rollback.sql`, `tests/000_stub.sql`, `tests/010_knowledge_test.sql`, `tests/run-local.sh`, `README.md`
- Create: `Database Module/Knowledge Base/migrations/002_knowledge_shares.sql`, `migrations/rollback/002_rollback.sql`, `tests/020_shares_test.sql`

**Interfaces:**
- Consumes: `admin_is()`, `client_portal_accounts(id, banking_client_id, display_name, status)`, `banking_leads(client_id, picked_up_by, assigned_to)`, `banking_cases(client_id, assigned_to)`.
- Produces:
  - `knowledge_can_share(p_account uuid) -> boolean`
  - `knowledge_share(p_account uuid, p_entry uuid default null, p_price_line uuid default null, p_bank uuid default null, p_scheme uuid default null) -> uuid`, the share id
  - `knowledge_share_withdraw(p_share uuid) -> void`
  - `knowledge_share_targets() -> table(account_id uuid, display_name text, can_share boolean, owner_names text[])`
  - `knowledge_item_shares(p_entry uuid default null, p_price_line uuid default null, p_bank uuid default null, p_scheme uuid default null) -> table(share_id uuid, display_name text, shared_by_name text, shared_at timestamptz, hidden boolean, can_withdraw boolean)`
  - `client_portal_knowledge(p_account uuid) -> jsonb`, shaped `{ entries: [{ title, entry_type, category, body, shared_at }], price_lines: [{ template, line_group, item, amount_aed, valid_until, shared_at }], banking: [{ bank_name, scheme_name, account_opening_fee, initial_deposit, minimum_balance, other_bank_charges, service_fee, vat_mode, shared_at }] }`

- [ ] **Step 1: Write the failing tests**

Update `010`: staff without any tab now read categories, Internal rows, the view and `knowledge_banking_prices()`; deleted rows stay admin-only; `basis`, `payee`, `confidence` stay refused; writes stay refused; `anon` gets nothing.

Add `020`, using the `t.ok` / `t.fails` helpers:

| Check | Expected |
|---|---|
| Owner by `picked_up_by`, lead `assigned_to`, case `assigned_to` | `knowledge_can_share` true |
| Non-owner, client has an owner | False, and `knowledge_share` fails |
| Client with no owner; account with null `banking_client_id` | True for any staff |
| Admin, any client | True |
| Handover: `picked_up_by` and `assigned_to` move | New owner true, old owner false |
| Share Draft, Internal, deleted, past `valid_until`, retired or priceless Banking item | Fails |
| Share with zero or two item kinds | Fails |
| Same item shared twice | Same id, one open row |
| Same bank with null scheme shared twice | Same id, one open row |
| Withdraw, then share again | New open row; old row keeps `withdrawn_at` |
| Withdraw by a non-owner of an owned client | Fails |
| Revoked account | Not in `knowledge_share_targets()`; `knowledge_share` fails |
| Staff `select`, `insert` on `knowledge_client_shares` | Fails |
| `client_portal_knowledge` as `authenticated` or `anon` | Fails; works as `service_role` |
| Result for account A | Only A's items; none of B's |
| Serialised result | Has no Global Constraints hidden key |
| Shared line edited (back to Draft), then approved | Absent, `hidden` true, then present with no new share |
| Withdrawn, Internal, deleted or expired item | Absent |
| New Banking price row for a shared bank and scheme | Shows the new figure |
| `knowledge_share_targets()` for a blocked client | `can_share` false, `owner_names` filled |

- [ ] **Step 2: Run to verify they fail**

Run: `bash "Database Module/Knowledge Base/tests/run-local.sh"`
Expected: FAIL.

- [ ] **Step 3: Change `001_knowledge.sql`**

Replace each `'knowledge' = any(public.my_tabs())` check with signed-in staff access. Read policies: `admin_is() or deleted_at is null`, so Internal rows are readable. Split `knowledge_banking_prices()` into an internal `knowledge_banking_current()`, with no rights for any API role, and the public wrapper, which returns rows only when `auth.uid()` is not null and now includes `bank_id` and `scheme_id`. Keep the column-level read on `knowledge_price_lines`.

- [ ] **Step 4: Write `002_knowledge_shares.sql`**

The table follows the spec. Add check constraint "exactly one of entry, price line, bank" and three partial unique indexes where `withdrawn_at is null`: `(account_id, entry_id)`, `(account_id, price_line_id)`, `(account_id, bank_id, coalesce(scheme_id, '00000000-0000-0000-0000-000000000000'))`. RLS on, with no policies and all rights revoked. Functions use `on conflict do nothing` then select, so a double click is safe. `client_portal_knowledge` is granted to `service_role` only, as `Client Login Base` does. Run after Client Base and Client Login Base.

Business Setup owners are out of this migration, as those tables aren't on `main`. Note this in the README.

- [ ] **Step 5: Run to verify they pass**

The migration runs twice, then rollback leaves no `knowledge_*` object. Expected: every check prints `ok`, exit 0.

- [ ] **Step 6: Commit**

Commit "Add client shares and open Knowledge to staff".

### Task 3: Sharing and display logic

**Files:**
- Create: `Knowledge Module/logic/money.js`, `Knowledge Module/logic/clientText.js`
- Modify: `Knowledge Module/logic/status.js`, `Knowledge Module/tests/status.test.mjs`
- Delete: `Knowledge Module/logic/copyText.js`, `Knowledge Module/tests/copyText.test.mjs`
- Test: `Knowledge Module/tests/money.test.mjs`, `Knowledge Module/tests/clientText.test.mjs`

**Interfaces:**
- Produces:
  - `toAmount(value) -> number | null`, `aed(number) -> string`, moved unchanged with their tests
  - `canShare(item) -> boolean`: Approved and Shareable, not deleted, not past `valid_until`
  - `shareBlockReason(item, today) -> string | null`
  - `splitShareable(lines, today) -> { shareable, leftOut }`
  - `vatNote(kind, vatMode) -> string`, where `kind` is `"price"` or `"banking"`

- [ ] **Step 1: Write the failing tests**

```js
test("canShare only for Approved and Shareable");
test("canShare is false for a past valid_until, true on today's date");
test("shareBlockReason names Draft, Internal or expired, and is null when shareable");
test("splitShareable separates a mixed group, keeping order");
test("vatNote price is the exclude sentence", () => assert.equal(vatNote("price"), "Prices exclude VAT unless stated otherwise."));
test("vatNote banking follows the mode", () => {
  assert.equal(vatNote("banking", "exclusive"), "Prices exclude VAT unless stated otherwise.");
  assert.equal(vatNote("banking", "inclusive"), "AB Capital service fee includes VAT.");
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "Knowledge Module/tests/"`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement, moving `toAmount` and `aed` and removing `canCopy`, `needsConfirm`, `groupCopyItem`, `htmlToText` and the text builders**

`groupDisplayStatus` and `assertAllUpdated` stay. Task 4 removes the remaining imports, so the build only passes after it.

- [ ] **Step 4: Run, then commit**

Expected: logic tests pass. Commit "Replace copy logic with sharing rules".

### Task 4: Staff sharing screens

**Files:**
- Delete: `Knowledge Module/components/CopyButton.jsx`
- Create: `Knowledge Module/components/ShareDialog.jsx`, `Knowledge Module/components/ItemShares.jsx`
- Modify: `Knowledge Module/components/EntriesView.jsx`, `PricingView.jsx`, `KnowledgeModule.jsx`, `Knowledge Module/services/knowledgeApi.js`, `Knowledge Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 2 functions, Task 3 logic.
- Produces: `shareTargets()`, `shareItem(accountId, ref)`, `withdrawShare(shareId)`, `itemShares(ref)` in `knowledgeApi.js`, where `ref` is `{ entry } | { priceLine } | { bank, scheme }`.

- [ ] **Step 1: Write the failing static tests**

`static.test.mjs`: no file under `Knowledge Module` references `clipboard` or `CopyButton`; `knowledgeApi.js` has no direct read or write of `knowledge_client_shares`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "Knowledge Module/tests/static.test.mjs"`
Expected: FAIL on `CopyButton`.

- [ ] **Step 3: Implement**

- `ShareDialog`: searchable client list from `shareTargets()`. A blocked client can't be chosen and shows "Ask" with `owner_names`. A group shares `splitShareable(...).shareable` and reports "Shared N lines, left out M." Refused shares show the database's error; nothing claims success.
- `ItemShares`: shows `itemShares(ref)` on each item, with "Hidden from client" and **Withdraw** when `can_withdraw`. A failed withdrawal keeps the row open and shows the error.
- Cards: **Share with client** when `canShare`; otherwise `shareBlockReason`, as text. Banking rows use `{ bank, scheme }`.
- Members now see Internal rows, so show the Internal badge to everyone.

- [ ] **Step 4: Build and run tests**

Run in `Main Module`: `npm run build`. Then `node --test "Knowledge Module/tests/"`.
Expected: pass. No unresolved imports.

- [ ] **Step 5: Commit**

Commit "Share Knowledge items with clients from the staff screens".

### Task 5: Client portal Knowledge tab

**Files:**
- Modify: `Client Login Module/supabase/client-portal/index.ts`, `Client Login Module/portal/portalApi.js`, `Client Login Module/portal/ClientPortal.jsx`, `Client Login Module/admin/ClientPortalAdmin.jsx`, `Client Login Module/tests/logic.test.mjs`, `Client Login Module/README.md`
- Create: `Client Login Module/portal/KnowledgeTab.jsx`

**Interfaces:**
- Consumes: `client_portal_knowledge(p_account)`; `aed`, `toAmount`, `vatNote`, `SafeHtml` through the `@knowledge` alias.
- Produces: action `knowledge` (client session) and `admin_knowledge` (admin, with `account_id`); `api.knowledge() -> { entries, price_lines, banking }`.

- [ ] **Step 1: Write the failing static tests**

In `logic.test.mjs`, reading `index.ts` as text:

```js
test("knowledge action uses the session's account, never the request's", () => {
  // the "knowledge" case passes p_account: accountId and does not read body.account_id
});
test("admin_knowledge checks client_portal_is_admin before reading");
test("the portal has a Knowledge tab that goes through the api object");
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "Client Login Module/tests/logic.test.mjs"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`index.ts`: add the two actions beside `me` and `admin_preview`. `KnowledgeTab`: loads through `api.knowledge()`; entries through `SafeHtml`; prices grouped by template with `vatNote("price")`; banking with `vatNote("banking", vat_mode)`. Empty shows "Nothing has been shared with you yet." A failed load shows the error, not that message. No edit controls. Add `["knowledge", "Knowledge"]` to `TABS`. The admin preview's `api` calls `admin_knowledge`.

- [ ] **Step 4: Run tests and build**

Expected: `logic.test.mjs` and `npm run build` pass.

- [ ] **Step 5: Commit**

Commit "Show shared Knowledge in the client portal".

### Task 6: Browser check on the fake backend

**Files:**
- Modify: `Knowledge Module/tests/browser-check.md`

- [ ] **Step 1: Extend the local fake backend with shares and the portal's `knowledge` action, with invented data, and run it through `.claude/launch.json`**

The fake backend stays out of Git. Remove its launch entry afterwards.

- [ ] **Step 2: Run the check in the built-in browser and confirm:**

| Action | Expected |
|---|---|
| Member with no grants opens Knowledge, including Internal items | Works; no `basis`, `payee`, `confidence` |
| No copy button anywhere | None |
| Draft item | Warning, no share button, reason shown |
| Owner shares with their client; blocked client | Shared; blocked one can't be chosen and names the owner |
| Mixed price group | "Shared N lines, left out M." |
| Client logs in | Sees only that item; another client sees nothing and the empty message |
| Article with `<script>` and `onerror` in the portal | Removed, nothing runs |
| Withdraw, client reloads | Item gone |
| Item back to Draft | Hidden from client on staff side; gone in portal |
| Portal load fails | Error, not the empty message |
| Existing portal tabs | Still work |

- [ ] **Step 3: Record results, including that real login and rules weren't covered, and commit**

Commit "Record the Knowledge sharing browser check".

### Task 7: Rollout

Each step needs the user's approval at that time. Say what will change before asking. Before Step 1, confirm with the user that the public repository question is settled or knowingly deferred.

- [ ] **Step 1: Run `001_knowledge.sql` and `002_knowledge_shares.sql`, then `select * from audit_trail_attach_all();`**

Expected: `failed` is empty. Run `get_advisors` and fix any new finding on these objects.

- [ ] **Step 2: Rebuild the import, then run `data/knowledge_import.sql`**

Expected: counts match the report. Shareable entries are 0.

- [ ] **Step 3: Compare the deployed `client-portal` with `Client Login Module/supabase/client-portal/index.ts` as it was on `main`**

If they differ, stop and ask. Otherwise deploy as `Client Login Module/README.md` describes. Confirm existing portal tabs still work.

- [ ] **Step 4: Open the pull request, merge and deploy**

Bind it with the `ccd_pr` tools.

- [ ] **Step 5: Check on the real backend with a test staff member and a test client, created with approval**

Confirm search, sharing, the portal tab and withdrawal. Confirm `basis`, `payee` and `confidence`, other clients' items and direct share-table access are all refused. Delete the test client after.

- [ ] **Step 6: Hand over**

The import report, the flagged articles and the VAT question for Accounts.
