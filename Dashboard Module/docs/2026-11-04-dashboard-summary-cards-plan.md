# Dashboard Summary Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add animated, collapsible, rearrangeable department and Zoho financial summary cards below the existing Dashboard.

**Architecture:** A `SummaryBoard` in the Dashboard Module renders cards from a list, with pure logic for layout and numbers. Department cards call each module's existing data source under the person's own access. Zoho cards read one admin-only snapshot row, filled by a new GET-only Edge Function, `zoho-finance`.

**Tech Stack:** React 19, Vite, plain CSS, Supabase (Postgres, Edge Functions on Deno), `node --test`, `deno test`.

**Spec:** `Dashboard Module/docs/2026-11-04-dashboard-summary-cards-design.md`

Work in `D:\Abhijith Projects\CRM-dashboard`, branch `dashboard-summary-cards`.

## Global Constraints

- All Zoho data is read-only. `zoho-finance` exposes only `get`. Its only POST is the token refresh to the accounts host.
- `zoho-finance` reads `ZOHO_FINANCE_CLIENT_ID`, `ZOHO_FINANCE_CLIENT_SECRET`, `ZOHO_FINANCE_REFRESH_TOKEN`, `ZOHO_BOOKS_ORG_ID`, `ZOHO_DC`. It never reads `ZOHO_REFRESH_TOKEN`.
- No undocumented `/reports/*` paths.
- Zoho cards and the snapshot are admin-only.
- No new npm packages. Animation is CSS plus `requestAnimationFrame`, and all of it stops under `prefers-reduced-motion`.
- Credentials never appear in chat, code, logs or browser responses.
- Each live step (push to `main`, migration, function deploy) needs the user's approval at that moment. Deploy with `--project-ref pnnakrhfzyxudjaghoxx --use-api`.
- Do not change anything in the Invoices and Quotes sub tab, or the `zoho-books` function.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The Dashboard has zero tasks, which today returns only the empty state: the board must still render. Test in Task 3.
- Two admins open the Dashboard at once with a stale snapshot: only one refresh runs, and the other sees the old numbers. Test in Task 8.
- A person has the tab but lacks the data role, so the function raises `42501`: the card says "No access to this data", not an error with Retry. Test in Task 2.
- The token is not saved or was revoked: admins see a setup or reconnect message and any old numbers, and the rest of the Dashboard works. Test in Task 8 and Task 9.
- A saved layout comes from an older version, or a person loses a tab: unknown cards are ignored and new ones go last. Test in Task 1.

---

## Part A: Department cards

### Task 1: Card list and layout logic

**Files:**
- Create: `Dashboard Module/logic/summaryLayout.js`
- Test: `Main Module/tests/summaryLayout.test.mjs`

**Interfaces:**
- Consumes: `moveTab(keys, from, to)`, imported by relative path from `../../Main Module/src/tabs.js`, so `node --test` can load it.
- Produces:
  - `SUMMARY_CARDS`: `[{ id, title, group, tab, view }]`. `group` is `"departments"` or `"zoho"`.
  - `visibleCards(cards, { isAdmin, tabs }) -> cards`
  - `mergeLayout(saved, cards) -> { order: { departments: string[], zoho: string[] }, collapsed: string[] }`
  - `readLayout(userId, cards) -> layout`, `saveLayout(userId, layout)`, using key `crm-dashboard-layout:<userId>`, with try/catch
  - `moveCard(layout, group, from, to) -> layout`, `stepCard(layout, group, id, delta) -> layout`
  - `toggleCollapsed(layout, id) -> layout`, `setGroupCollapsed(layout, ids, collapsed) -> layout`

Card ids, tab keys and views:

| id | group | tab | view |
|---|---|---|---|
| `bd` | departments | `business-development` | `business-development` |
| `banking` | departments | `business-banking` | `business-banking` |
| `setup` | departments | `business-setup` | `business-setup` |
| `accounting` | departments | `accounts` | `accounts` |
| `hr` | departments | `hr` | `hr` |
| `tax` | departments | `tax` | `tax` |
| `notifications` | departments | none | none |
| `health`, `ar`, `ap`, `ratios`, `revenue`, `cost`, `cash` | zoho | none, admin only | none |

- [ ] **Step 1: Write the failing tests**

Tests, with assertions in `node:assert/strict`:
- `visibleCards` for an admin returns all 14. For `isAdmin: false, tabs: ["hr"]` it returns `hr` and `notifications`. For `tabs: null` it returns `notifications` only.
- `mergeLayout(null, cards)` gives list order and `collapsed: []`.
- `mergeLayout` with a saved `order.departments` of `["hr", "gone", "bd"]` over cards `bd, hr, tax` gives `["hr", "bd", "tax"]`.
- `mergeLayout("rubbish", cards)` and `mergeLayout({ order: 5 }, cards)` give the default.
- `collapsed` drops ids no longer in `cards`.
- `readLayout` returns the default when `localStorage.getItem` throws, and when it holds invalid JSON. `saveLayout` does not throw when `setItem` throws.
- `moveCard` onto itself returns the same order. Moving across groups does nothing.
- `stepCard` at the first position with `delta: -1`, and at the last with `delta: 1`, returns the same order.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd "Main Module" && node --test tests/summaryLayout.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `Dashboard Module/logic/summaryLayout.js`**

No React or Supabase imports.

- [ ] **Step 4: Run tests and confirm they pass**

Same command. Expected: all pass.

- [ ] **Step 5: Commit**

Include both docs. Message: `Add dashboard summary card list and layout logic`.

### Task 2: Card numbers and fetchers

**Files:**
- Create: `Dashboard Module/logic/summaryFigures.js`, `Dashboard Module/services/summaryApi.js`
- Test: `Main Module/tests/summaryFigures.test.mjs`

**Interfaces:**
- Produces, in `summaryFigures.js`, with no imports except `BD_STAGES` passed in as an argument:
  - `bdFigures(rows, stages, cap = 500) -> { total: number | "500+", stages: [{ label, value }] }`, counting `row.stage`
  - `bankingFigures(d) -> { cards: [{ label, value }], alerts: [{ label, value }], finance: object | null }`, from `d.cards`, `d.alerts`, `d.finance`. Use the same labels as `CARDS` and `ALERTS` in `Banking Module/components/Dashboard.jsx`, for the keys `total_leads`, `documents_pending`, `submitted`, `approved`, and for all alerts.
  - `setupFigures(d) -> { forms, openQuotes, noLetter, outstanding, activeServices, expiringUpcoming, expiringPast }`, from `business_setup_dashboard`. `forms_waiting` may be a number or an object: read how `Business Setup Module` shows it and match that.
  - `accountingFigures(rows) -> { byStatus: [{ label, value }], followUpsDue, needInvoice, balanceDue }`, using `work_status`, `follow_up_due`, `needs_invoice`, and the sum of positive `balance`
  - `hrFigures(d) -> { headcount, pendingLeave, expiringDocuments }`, from `headcount`, `pending_leave`, `expiring_documents`
  - `taxFigures(result) -> { overdue, due14, due30, missing, clients }`, from `compliance()`'s `summary` and `clientsChecked`
  - `notificationFigures(rows) -> { unread, latest }`, with `latest` the first five
  - `isNoAccess(error) -> boolean`, true when `error.code === "42501"`
- Produces, in `summaryApi.js`:
  - `summaryApi`: an object keyed by card id, each `async () -> figures`. Exposing it as an object lets the board accept a fake in Task 3.
  - Calls use `supabase` from `@app/supabase` directly, keeping `error.code`. They throw an `Error` with `.noAccess = true` when `isNoAccess(error)`.

Sources: `bd_ui_leads { p_limit: 500 }`, `banking_dashboard`, `business_setup_dashboard`, `accounting_job_list` (`select work_status, balance, follow_up_due, needs_invoice`), `hr_dashboard`, `client_master` (`select data`, limit 5000, then `compliance` from `@client-module/crm/taxLogic`), `notifications` for the person's own `user_id`, newest first, limit 50.

- [ ] **Step 1: Write the failing tests**

Tests:
- `bdFigures` with 500 rows gives `total: "500+"`. With 3 rows gives `3`. A stage missing from `stages` is counted under `"Other"`.
- `accountingFigures` sums only positive balances: rows of `100`, `-20`, `null` give `balanceDue: 100`.
- `taxFigures` maps `summary.due_14` to `due14`.
- `notificationFigures` with 7 rows, 2 unread, gives `unread: 2` and 5 latest.
- `isNoAccess({ code: "42501" })` is true. `isNoAccess({ code: "PGRST116" })` and `isNoAccess(null)` are false.
- Each function given empty input returns zeros, not a throw.

- [ ] **Step 2: Run tests and confirm they fail**

Run: `cd "Main Module" && node --test tests/summaryFigures.test.mjs`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files**

- [ ] **Step 4: Run tests and confirm they pass**

- [ ] **Step 5: Commit**

Message: `Add dashboard summary card numbers and fetchers`.

### Task 3: Board, card, animation and department bodies

**Files:**
- Create: `Dashboard Module/components/SummaryBoard.jsx`, `SummaryCard.jsx`, `summary.css`, `AnimatedNumber.jsx`, `summaryCards/DepartmentBodies.jsx`
- Modify: `Dashboard Module/components/Dashboard.jsx`, `Main Module/src/App.jsx` (the `<Dashboard` call, near line 483)
- Modify: `Dashboard Module/README.md`
- Test: `Main Module/tests/summaryBoard.test.mjs`

**Interfaces:**
- Consumes: Task 1 and Task 2 exports.
- Produces:
  - `<SummaryBoard profile tabs onNavigate api={summaryApi} zoho={null | ReactNode} />`
  - `<SummaryCard card collapsed onToggle onMove dragHandlers load onOpen>{(data) => body}</SummaryCard>`. It calls `load` the first time it is expanded, and not when collapsed. It handles loading (shimmer), error (message and Retry), `noAccess` ("No access to this data") and data.
  - `<AnimatedNumber value format />`: counts up once per load with `requestAnimationFrame`, and shows the value at once under reduced motion or for a non-number such as `"500+"`.

Behaviour, from spec section 7:
- Two groups, "Departments" and "Zoho Financials", the second only when `zoho` is passed.
- "Expand all" and "Collapse all" per group. "Reset layout" link.
- Native drag on a handle, within a group. Move up and Move down buttons with `aria-label`s.
- Saves through `saveLayout` on every change.
- The header toggles collapse. Clicking the body calls `onNavigate(card.view)` when there is a `view`.
- CSS: staggered entry using an `--i` custom property, bars grown with `transform: scaleX`, collapse by animating `grid-template-rows` from `0fr` to `1fr`, lifted drag state, and other cards sliding into place by measuring positions before and after a reorder (FLIP).
- `@media (prefers-reduced-motion: reduce)` sets `animation: none; transition: none`.
- Use the design tokens already used by `Dashboard.jsx` cards: same border, radius and `var(--accent)`.
- Phone width: one column with no sideways scroll.

`Dashboard.jsx`: render `<SummaryBoard>` after the existing content, outside the `total === 0` branch, so it shows even with the empty state. Accept a new `tabs` prop. `App.jsx` passes `tabs={tabs}`.

- [ ] **Step 1: Write the failing test**

A static test in `summaryBoard.test.mjs`, in the style of `Integrations Module/tests/static.test.mjs`:
- `summary.css` contains `prefers-reduced-motion`.
- `Dashboard.jsx` renders `SummaryBoard` outside the `total === 0` ternary: assert its position in the file is after the closing of that expression's `</div>`, using the `content-area` wrapper.
- No file in `Dashboard Module/components` imports `framer-motion`, `react-dnd` or `@dnd-kit`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd "Main Module" && node --test tests/summaryBoard.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement the components and CSS**

- [ ] **Step 4: Run tests and build**

Run: `cd "Main Module" && node --test tests/summary*.test.mjs && npm run build`
Expected: all pass, build succeeds.

- [ ] **Step 5: Verify in the browser with fake data**

Sign-in is not available locally, so add a temporary page `Main Module/tmp-summary.html` that mounts `<SummaryBoard>` with a fake `api` and `profile` (one card rejecting, one with `noAccess`, one slow). Start with preview config `crm-dashboard`. Check:
- Cards animate in, numbers count up.
- Collapse a card and confirm its `load` did not run again. A card saved as collapsed does not load at all.
- Drag, Move up, Move down, reload and confirm the layout was kept. Reset restores it.
- The failing card shows Retry and others still work.
- `resize_window` with mobile preset: no sideways scroll.
- Emulate reduced motion: values appear at once.

Delete `tmp-summary.html` before committing.

- [ ] **Step 6: Commit**

Message: `Add animated dashboard summary board with department cards`.

### Task 4: Release department cards

**Files:** none.

- [ ] **Step 1: Ask the user to approve the push to `main`**

State that it publishes the department cards to all staff through `deploy-pages.yml`.

- [ ] **Step 2: Update from `origin/main`, rerun tests and build, push**

Run: `git fetch origin && git rebase origin/main`, the Task 3 test command, then `git push origin HEAD:main`.

- [ ] **Step 3: Confirm the deploy**

Expected: the `deploy-pages.yml` run for that commit concludes `success`, and the live bundle contains `crm-dashboard-layout`. Ask the user to look at the live Dashboard, because this needs their sign-in.

---

## Part B: Zoho cards

### Task 5: Snapshot table

**Files:**
- Create: `Database Module/Admin Base/migrations/009_zoho_finance.sql`, `migrations/rollback/009_zoho_finance_rollback.sql`, `tests/050_zoho_finance_test.sql`
- Modify: `Database Module/Admin Base/tests/run-local.sh`

**Interfaces:**
- Produces: `public.zoho_finance_snapshot` with `id int primary key default 1 check (id = 1)`, `data jsonb`, `as_of timestamptz`, `status text check (status in ('ok','partial','failed'))`, `error text`, `calls_used int`, `refreshing_since timestamptz`. The migration seeds the row `id = 1`.

RLS on. Revoke all from `public`, `anon`, `authenticated`, `service_role`. Grant `select` to `authenticated` with a policy that the caller is an admin. Grant `select, update` to `service_role`. Follow the header style and idempotence of `005_zoho.sql`.

- [ ] **Step 1: Write the failing SQL test**

In the style of `040_zoho_test.sql`: an admin reads one row. A non-admin reads zero rows. `authenticated` cannot update or insert. A second row (`id = 2`) fails. A bad `status` fails. Add it to `run-local.sh`.

- [ ] **Step 2: Run and confirm it fails**

Run: `bash "Database Module/Admin Base/tests/run-local.sh"`
Expected: `050` reports an error on the missing table.

- [ ] **Step 3: Write the migration and rollback**

- [ ] **Step 4: Run and confirm all pass**

Same command. Expected: migrations run twice cleanly, no `FAILED`.

- [ ] **Step 5: Commit**

Message: `Add Zoho finance snapshot table`.

### Task 6: `zoho-finance` function with connection test and probe

**Files:**
- Create: `Integrations Module/supabase/zoho-finance/zohoClient.ts`, `handlers.ts`, `index.ts`, `secrets.ts` (exact copy of `_shared/secrets.ts`), `zohoClient.test.ts`, `handlers.test.ts`
- Create: `Integrations Module/components/ZohoFinanceConnection.jsx`
- Modify: `Integrations Module/components/IntegrationsPanel.jsx` (show it when `tab?.id === "financials"`)
- Modify: `Integrations Module/tests/static.test.mjs`, `Integrations Module/README.md`

**Interfaces:**
- Produces:
  - `createFinanceClient(cfg, fetchFn) -> { get(path, query) }`. There is no `post`. Base it on `zoho-books/zohoClient.ts`: same token refresh, `scrub`, `redirect: "error"` and error classes.
  - `assertAllowed(method, path)`: only GET, and paths matching `/organizations`, `/invoices`, `/bills`, `/bankaccounts`, `/chartofaccounts`, `/chartofaccounts/transactions`, `/chartofaccounts/accounttransactions`, `/expenses`. The two transactions paths are both allowed for the probe only, and Task 8 cuts them to one.
  - `handle(action, body, deps)` with `deps = { isAdmin(), zoho(), db, now() }`. Actions: `connection_test -> { connected, organisation }` and `probe -> ProbeResult`. Both are admin only.
  - `browserMessage(e)`, as in `zoho-books`.

`ProbeResult` holds structure only, and never an amount, name or ID:
```
{ transactionsPath: { "/chartofaccounts/transactions": status, "/chartofaccounts/accounttransactions": status },
  transactionFields: string[],
  dateParamsWorked: boolean,
  fiscalStartMonth, baseCurrency,
  accountTypes: [{ type, count, balanceSign: "pos" | "neg" | "mixed" | "zero" }],
  incomeOrExpenseBalanceChangesWithDate: boolean | "unknown",
  openFilters: { invoices: { status_unpaid, status_overdue, status_partially_paid }, bills: { open, overdue, partially_paid } },
  otherCurrency: { invoices, bills, listHasExchangeRate },
  callsNeededFor12Months }
```
`openFilters` holds a count per filter, so overlap can be seen. `callsNeededFor12Months` is estimated from page counts on two sample accounts.

`ZohoFinanceConnection.jsx`: a **Test** button showing the organisation name, and a temporary **Run check** button showing `ProbeResult` as text the user can copy. It holds no credential words.

- [ ] **Step 1: Write the failing tests**

`zohoClient.test.ts`:
- `assertAllowed` refuses `POST /invoices`, `PUT /invoices/1`, `DELETE /bills/1`, `GET /reports/profitandloss`, `GET /invoices/1/email`.
- The returned client has no `post` key.
- A failed call's message contains none of the secrets.

`handlers.test.ts`:
- A non-admin gets `UserError` on both actions.
- `probe` output, run on sample data containing names and amounts, contains none of them when stringified.
- `connection_test` returns `connected: false` with a plain message on `ZohoAccessError`.

`static.test.mjs`:
- No `\b(PUT|DELETE)\b` in non-test `zoho-finance` files.
- `zoho-finance/secrets.ts` matches `_shared/secrets.ts`.
- `index.ts` contains `ZOHO_FINANCE_REFRESH_TOKEN`, and does not contain `"ZOHO_REFRESH_TOKEN"`.

- [ ] **Step 2: Run and confirm they fail**

Run: `deno test "Integrations Module/supabase/zoho-finance/"` and `node --test "Integrations Module/tests/static.test.mjs"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and build**

Same commands, then `npm run build` in `Main Module`. Expected: all pass.

- [ ] **Step 5: Commit**

Message: `Add read-only zoho-finance function with connection test`.

### Task 7: Live read-only proof and probe

Needs the user. Stop if any answer is no. No amounts or names go into chat or the repo.

**Files:**
- Create: `Integrations Module/docs/2026-11-04-zoho-finance-probe.md`

- [ ] **Step 1: Ask the user to approve three live steps**

Apply `009_zoho_finance.sql`, deploy `zoho-finance`, and push to `main` to publish the Test button. State each in full.

- [ ] **Step 2: Confirm the three values are saved**

Expected: the Financial Dashboard sub tab shows 3 of 3.

- [ ] **Step 3: The user presses Test**

Expected: AB Capital Services FZC.

- [ ] **Step 4: Prove the lock**

The user sends one `PUT /invoices/0` with an empty body, using a throwaway local script outside the function and their own copy of the token. A scope or authorisation error passes. "Not found" is inconclusive: stop and ask. Success: stop, tell the user and revoke the token.

- [ ] **Step 5: The user presses Run check and pastes the result into chat**

It holds structure only.

- [ ] **Step 6: Record the result in the probe file and decide**

Record the path, date parameters, filters, balance signs, fiscal month, and calls needed. If `callsNeededFor12Months` is over 90 or the path is unusable, stop and ask the user about the spec section 8 fallback before Task 8.

- [ ] **Step 7: Commit**

Message: `Record zoho-finance probe results`.

### Task 8: Figures and refresh

**Files:**
- Create: `Integrations Module/supabase/zoho-finance/figures.ts`, `figures.test.ts`, `refresh.ts`, `refresh.test.ts`
- Modify: `zohoClient.ts` (one transactions path only), `handlers.ts`, `index.ts` (remove `probe`, add `refresh`)
- Modify: `Integrations Module/components/ZohoFinanceConnection.jsx` (remove **Run check**)

**Interfaces:**
- Consumes: the probe file, for path, query parameters, filters, signs and fiscal month.
- Produces, in `figures.ts`:
  - `agingBuckets(docs, today) -> { current, d1_30, d31_60, d61_90, d90p, total }`
  - `topOverdue(docs, today, nameField, n = 5) -> [{ name, amount }]`
  - `buildFigures(input, today) -> SnapshotData`
  - `healthScore(factors) -> { score, band, factors, missing }`
- `SnapshotData`:
```
{ currency, period: { from, to },
  ar: { total, aging, top, ledger, difference, excluded },
  ap: { total, aging, top, ledger, difference, excluded },
  cash: { total, accounts: [{ name, balance }] },
  monthly: [{ month, revenue, cost, cogs }],
  ytd: { revenue, cost, profit, netMargin, grossMargin },
  topCosts: [{ name, amount }],
  ratios: { current, quick, cash, debtToEquity, dso, dpo },
  health,
  partial: string[] }
```
- Produces, in `refresh.ts`: `refresh({ force }, deps) -> { status: "ok" | "partial" | "failed" | "busy" | "fresh" }`, and `MAX_CALLS = 150`.
- Figures follow spec section 5 exactly. A zero divisor gives `null`, which the card shows as "n/a".

- [ ] **Step 1: Write the failing figures tests**

`figures.test.ts`, with `today = 2026-11-04`:
- `agingBuckets`: due today is `current`. 1 day past is `d1_30`. 30 is `d1_30`. 31 is `d31_60`. 60 is `d31_60`. 61 is `d61_90`. 90 is `d61_90`. 91 is `d90p`.
- Current assets exclude fixed assets. A quick ratio excludes `stock`. Debt to equity includes long-term liabilities.
- Zero current liabilities, zero revenue and zero equity each give `null`.
- A difference over AED 1 between aging total and ledger is reported, and exactly 1 is not.
- A foreign document with a rate converts. One with no rate is excluded and counted.
- `healthScore`: current ratio `1.5` good, `1` watch, `0.99` poor. Cash cover `3` good, `1` watch, `0.99` poor. Net margin `10` good, `0` watch, `-0.01` poor. Overdue share `20` good, `20.01` watch, `40` watch, `40.01` poor.
- All good gives 100 and Healthy. All poor gives 0 and At risk. Scores of 70 Healthy, 69 Watch, 40 Watch, 39 At risk (test the band function directly).
- One `null` factor is left out, named in `missing`, and the score is points over points available.

- [ ] **Step 2: Write the failing refresh tests**

`refresh.test.ts`, with a fake `db` and `zoho`:
- A second refresh while `refreshing_since` is 1 minute old returns `busy` and makes no Zoho call.
- With `refreshing_since` 6 minutes old, it runs.
- `force: false` with `as_of` 59 minutes old returns `fresh`. 61 minutes old runs.
- `force: true` with `as_of` 4 minutes old returns `fresh`. 6 minutes old runs.
- At the 91st call it stops, `status` is `partial`, and `data.partial` names the unfinished sections.
- A section that did not finish has no total in `data`.
- A Zoho failure keeps `data` and `as_of`, sets `status: "failed"` and a plain `error`, and clears `refreshing_since`.
- `ZohoAccessError` stores the message "Zoho access has stopped. An admin must reconnect."
- A non-admin gets `UserError`.
- `MissingSecretError` returns `{ status: "failed", error: "not_connected" }`, and leaves any stored data alone.

The lock is claimed with an update filtered on `refreshing_since` being null or over 5 minutes old. Zero rows updated means `busy`.

- [ ] **Step 3: Run and confirm they fail**

Run: `deno test "Integrations Module/supabase/zoho-finance/"`
Expected: FAIL.

- [ ] **Step 4: Implement**

- [ ] **Step 5: Run tests and confirm they pass**

Update the `assertAllowed` tests to assert the unused transactions path is now refused.

- [ ] **Step 6: Commit**

Message: `Calculate Zoho financial figures and refresh the snapshot`.

### Task 9: Zoho card bodies

**Files:**
- Create: `Dashboard Module/components/summaryCards/ZohoBodies.jsx`, `Dashboard Module/components/ZohoSection.jsx`
- Modify: `Dashboard Module/services/summaryApi.js`, `SummaryBoard.jsx`, `Dashboard.jsx`, `summary.css`
- Test: `Main Module/tests/summaryFigures.test.mjs`

**Interfaces:**
- Consumes: `SnapshotData` from Task 8.
- Produces:
  - `readSnapshot() -> { data, as_of, status, error }`, `refreshSnapshot(force) -> { status }`, in `summaryApi.js`
  - `snapshotState(row, now) -> "empty" | "stale" | "fresh" | "failed"`, and `fmtRatio(v) -> string`, showing `"n/a"` for `null`, in `summaryFigures.js`

Bodies, one per card, reading the single snapshot once so seven cards make one query:
- Company Health: gauge with the score, the band, and every factor with its value and rating. Any left-out factor is named.
- AR and AP: total, aging bars, top five, and the difference line when reported.
- Ratios: each ratio.
- Revenue: 12-month bars, year to date, net profit.
- Cost: 12-month bars, top five costs.
- Cash: total and each account.

Above the group: "As of <time>", a **Refresh** button, and "Management estimates, not statutory accounts." A stale snapshot refreshes in the background once on open. A card named in `partial` shows that it is incomplete. An empty snapshot, with `refreshSnapshot` returning `error: "not_connected"`, shows "Add the read-only Zoho login in Settings > Integrations > Zoho Books > Financial Dashboard." The group renders only for admins.

- [ ] **Step 1: Write the failing tests**

- `snapshotState`: no `as_of` is `empty`. 59 minutes old is `fresh`, 61 is `stale`. `status: "failed"` with old data is `failed`.
- `fmtRatio(null)` is `"n/a"`. `fmtRatio(1.234)` is `"1.23"`.

- [ ] **Step 2: Run and confirm they fail**

Run: `cd "Main Module" && node --test tests/summaryFigures.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests and build**

Run: `cd "Main Module" && node --test tests/summary*.test.mjs && npm run build`
Expected: all pass.

- [ ] **Step 5: Verify in the browser with a fake snapshot**

Use the temporary page approach from Task 3, with sample data only. Check each card, `partial`, `failed` with old numbers, the empty setup message, `n/a`, and phone width. Delete the temporary page.

- [ ] **Step 6: Commit**

Message: `Add Zoho financial cards to the dashboard`.

### Task 10: Accuracy check and release

Needs the user.

**Files:**
- Modify: `Integrations Module/README.md`, `Dashboard Module/README.md`

- [ ] **Step 1: Ask the user to approve deploying the updated `zoho-finance`**

- [ ] **Step 2: The user runs the check on the local dev server**

Start preview config `crm-dashboard`, copying the Supabase `.env` file from the main checkout if the worktree has none. The user signs in themselves and presses **Refresh**. The cards reach the live function but are not yet published to anyone. Compare Revenue, Cost and Net profit for one closed month and year to date, compared with Zoho's Profit and Loss screen. The user compares them, or supplies the figures. A difference must be explained or fixed first.

- [ ] **Step 3: Check Accounts Receivable and Accounts Payable**

Compare totals with Zoho's own Receivables and Payables figures, and read the difference line.

- [ ] **Step 4: Ask the user to approve the push to `main`**

State that it publishes the Zoho cards to admins.

- [ ] **Step 5: Update from `origin/main`, rerun all tests and build, push, confirm deploy**

Run the Task 3 test command, `node --test "Integrations Module/tests/static.test.mjs"`, and `deno test "Integrations Module/supabase/zoho-finance/"`. Expected: all pass, and the deploy run concludes `success`.

- [ ] **Step 6: Record what is live in both READMEs and commit**

Message: `Record Zoho financial cards as live`. Push with the user's approval.
