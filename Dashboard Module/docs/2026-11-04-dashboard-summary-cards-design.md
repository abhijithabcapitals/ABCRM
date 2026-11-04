# Dashboard Summary Cards: Design

Date: 2026-11-04. Status: awaiting user review. Branch: `dashboard-summary-cards`, from `origin/main` at 1474cca.

## 1. Purpose

Admins and staff open the Dashboard and see, at a glance, where each department stands. Admins also see the company's financial position from Zoho Books.

Success means:

- Each person sees a card for each department they have access to.
- Every card can be collapsed, expanded and rearranged, and stays that way on the next visit.
- The cards feel lively through animation, without slowing the page.
- All Zoho financial data is read-only. Nothing in this feature can change Zoho.

## 2. Decisions

| Decision | Choice | Source |
|---|---|---|
| Module cards | Business Development, Business Banking, Business Setup, Accounting, HR, Tax Compliance, Notifications | User, 2026-11-04 |
| Zoho cards | Company Health, Accounts Receivable, Accounts Payable, Financial Ratios, Revenue, Cost, and most other items of a financial dashboard | User, 2026-11-04 |
| Controls | Expand, collapse and rearrange | User, 2026-11-04 |
| Zoho access | Read-only for all financial data and the dashboard | User, 2026-11-04 |
| Placement | New section below the existing Dashboard content | Assumption stated to the user |
| Who sees Zoho cards | Admins only | Assumption stated to the user |
| Saved layout | Per person, per browser | Assumption stated to the user |
| Report paths | Documented API only, no `/reports/*` | Design, section 3 |

## 3. Zoho access

### Lock 1: a separate read-only token

The existing `ZOHO_REFRESH_TOKEN` holds `invoices.CREATE` and `estimates.CREATE`, so this feature does not use it. A new token holds only:

```
ZohoBooks.invoices.READ
ZohoBooks.bills.READ
ZohoBooks.expenses.READ
ZohoBooks.banking.READ
ZohoBooks.accountants.READ
ZohoBooks.settings.READ
```

| Scope | Used for |
|---|---|
| `invoices.READ` | Receivable balances and aging |
| `bills.READ` | Payable balances and aging |
| `expenses.READ` | Cost fallback, see section 8 |
| `banking.READ` | Cash by bank account |
| `accountants.READ` | Chart of accounts balances and account transactions |
| `settings.READ` | Organisation name and base currency |

Zoho's official scope list has no reports scope, and its API reference has no Reports section. Third-party blogs mention `/reports/profitandloss`, but those paths are undocumented, so this design does not use them. Figures are calculated from documented data.

### Lock 2: the Zoho user

The token cannot exceed the role of the Zoho user who generates it. That user must be able to see all the modules above.

### Lock 3: a separate function with a GET-only allowlist

A new Edge Function, `zoho-finance`, is separate from `zoho-books`. Its client has no POST, PUT or DELETE code path, and any path outside this list is refused before a request leaves the server:

| Method | Path | Use |
|---|---|---|
| GET | `/organizations` | Connection test, base currency |
| GET | `/invoices` | Open receivables |
| GET | `/bills` | Open payables |
| GET | `/bankaccounts` | Cash |
| GET | `/chartofaccounts` | Balances, with `showbalance=true` |
| GET | one account-transactions path | Revenue and cost by month |
| GET | `/expenses` | Cost fallback, section 8 |

Zoho's documentation page renders the account-transactions path as `/chartofaccounts/accounttransactions`, and it also shows `/chartofaccounts/transactions/{id}` for delete. The live probe in section 8 settles which GET path works. Only that one path is added to the allowlist.

### Credentials

The function reads three new Vault values through `requireSecret`, and shares two existing ones:

| Name | New or shared |
|---|---|
| `ZOHO_FINANCE_CLIENT_ID` | New |
| `ZOHO_FINANCE_CLIENT_SECRET` | New |
| `ZOHO_FINANCE_REFRESH_TOKEN` | New |
| `ZOHO_BOOKS_ORG_ID` | Shared |
| `ZOHO_DC` | Shared |

A refresh token only works with the client that created it. Keeping a separate client ID and secret means this token can be replaced or revoked without touching the drafts token. The fields are live since caaf30a, under Settings > Integrations > Zoho Books > Financial Dashboard. That sub tab was added at the user's request, so saving there cannot replace the Invoices and Quotes values. The two shared values appear only on Invoices and Quotes. Values are never put in chat, code or logs.

### Proof of read-only

After the token is saved, the user sends one `PUT /invoices/0` with an empty body from a throwaway local script, using their own copy of the token. The ID matches no record, so no real document is at risk.

- A scope or authorisation error proves the lock.
- "Not found" is inconclusive. Stop and ask the user.
- Success means the token is wrong. Stop, tell the user and revoke it.

## 4. Zoho data flow

```
Dashboard opens (admin)
  -> read zoho_finance_snapshot
  -> show saved numbers with their "as of" time
  -> if older than 60 minutes, ask zoho-finance to refresh in the background
```

Zoho allows 100 calls a minute and between 1,000 and 10,000 a day depending on plan. The plan is not known, so cards never call Zoho directly.

**Table `zoho_finance_snapshot`.** One row: `id` (fixed at 1), `data` (jsonb), `as_of`, `status` (`ok`, `partial` or `failed`), `calls_used`, `refreshing_since`, `last_attempt_at`. Admins can select. Only the service role can write. Migration `Database Module/Admin Base/migrations/008_zoho_finance.sql`, with a rollback and a test.

**Function `zoho-finance`.** Admin only, checked the same way as `zoho-books`.

| Action | Does |
|---|---|
| `connection_test` | Calls `/organizations`, returns the organisation name |
| `refresh` | Rebuilds the snapshot, subject to the limits below |

**Refresh limits.**

- At most one refresh runs at a time. A `refreshing_since` older than 5 minutes counts as abandoned.
- An automatic refresh runs only when the snapshot and the last attempt are both over 60 minutes old. The Refresh button works once both are over 5 minutes old. A failed attempt counts, so opening the Dashboard does not keep spending calls on a failing refresh.
- Each refresh stops at 90 Zoho calls. Sections it did not finish are marked partial and their cards say so. A partial total is never shown as complete.
- A failed refresh keeps the previous numbers, with their old "as of" time and an error line.

There is no scheduled job. Zoho is called only when an admin opens the Dashboard or presses Refresh.

**Errors.** Reuse the `zoho-books` approach: raw detail goes to the server log, scrubbed of secrets, and the browser gets a plain message.

## 5. Calculations

All amounts are in the organisation's base currency. Pure functions in `Integrations Module/supabase/zoho-finance/figures.ts`, with tests. The period is the current calendar year to date unless stated, because the Zoho fiscal year is not yet known; section 8 checks it.

| Figure | Rule |
|---|---|
| Accounts Receivable | Sum of `balance` on open invoices |
| Receivable aging | Current, 1-30, 31-60, 61-90 and 90+ days past `due_date` |
| Accounts Payable, aging | The same, using open bills |
| Top overdue | Five largest overdue customers, and five largest overdue vendors |
| Cash | Sum of bank and cash account balances, listed per account |
| Revenue | Income account transactions by month, 12 months |
| Cost | Expense and cost of goods sold transactions by month, 12 months |
| Top costs | Five largest expense accounts in the period |
| Net profit, net margin | Revenue minus cost, then divided by revenue |
| Gross margin | Revenue minus cost of goods sold, divided by revenue |
| Current ratio | Current assets divided by current liabilities |
| Quick ratio | Current assets excluding stock, divided by current liabilities |
| Cash ratio | Cash divided by current liabilities |
| Debt to equity | Current plus long-term liabilities, divided by equity |
| DSO | Accounts Receivable divided by the last 90 days' revenue, times 90 |
| DPO | Accounts Payable divided by the last 90 days' cost, times 90 |

Current assets are `accounts_receivable`, `cash`, `bank`, `stock` and `other_current_asset`. Current liabilities are `accounts_payable`, `credit_card` and `other_current_liability`.

**Reconciliation.** Aging totals are compared with the chart of accounts balance for Accounts Receivable and Accounts Payable. A difference over AED 1 shows on the card as a visible line. It can arise from unapplied credits.

**Other currencies.** An open document in another currency is converted with its own exchange rate. If the rate is missing, the document is excluded and the card shows how many were left out.

**Missing data.** A ratio with a zero divisor shows "n/a", never zero.

**These figures are management estimates, not statutory accounts.** The cards say so.

### Company Health

This is the CRM's own score, not a Zoho figure. Each factor scores 20 for good, 10 for watch and 0 for poor. The score is points earned divided by points available, as a percentage. A factor showing "n/a" is left out and named on the card.

| Factor | Good | Watch | Poor |
|---|---|---|---|
| Current ratio | 1.5 or more | 1 to below 1.5 | Below 1 |
| Cash cover (cash divided by average monthly cost, last 3 months) | 3 months or more | 1 to below 3 | Below 1 |
| Net margin, year to date | 10% or more | 0% to below 10% | Below 0% |
| Receivables overdue share | 20% or less | Over 20% to 40% | Over 40% |
| Payables overdue share | 20% or less | Over 20% to 40% | Over 40% |

Bands: 70 or more is Healthy, 40 to 69 is Watch, below 40 is At risk. The card always lists each factor with its value and rating. The thresholds are proposed for the user's approval.

## 6. Module cards

Each card uses the function or table its module already uses, under the signed-in person's own access. No new database function is needed.

| Card | Tab key | Source | Shows |
|---|---|---|---|
| Business Development | `business-development` | `bd_ui_leads` | Total leads, bars per stage. The call is capped at 500 rows, so a capped total shows as "500+" |
| Business Banking | `business-banking` | `banking_dashboard` | `cards` counts, `alerts`, and `finance` when the person may see it |
| Business Setup | `business-setup` | `business_setup_dashboard` | Forms waiting, open quotes, accepted without letter, outstanding, active services, expiries |
| Accounting | `accounts` | `accounting_job_list` | Jobs by `work_status`, follow-ups due, jobs needing an invoice, total balance due |
| HR | `hr` | `hr_dashboard` | The numbers the HR dashboard shows |
| Tax Compliance | `tax` | `compliance()` over `client_master` | Overdue, due in 14 days, due in 30 days, missing data |
| Notifications | none, always shown | `notifications` | Unread count, latest five |

Admins see every card. A card a person has no tab for is not shown and loads nothing. If a person has the tab but lacks the data role, the card shows "No access to this data" rather than an error.

Clicking a card's body opens that module through the existing `onNavigate`. Zoho cards have no module to open, so they expand instead.

## 7. Interface

**Placement.** A new `SummaryBoard` below the existing content in `Dashboard.jsx`, with two groups, "Departments" and "Zoho Financials". It also renders when the task count is zero, when the page otherwise shows only the empty state. The Zoho group is omitted for non-admins, and shows a setup message for admins until the token is saved.

**Collapse and expand.** A collapsed card shows only its title bar and does not fetch. Expanding it fetches once. Each group has "Expand all" and "Collapse all".

**Rearrange.** Drag a card by its handle, using the native drag approach and `moveTab` logic from the sidebar. Cards move within their own group. Move up and move down buttons on each card cover touch screens and keyboard users. A "Reset layout" link restores the default.

**Saved layout.** `localStorage` key `crm-dashboard-layout:<userId>`, holding order and collapsed state per group. A new card goes last, a retired one is ignored, and unreadable storage falls back to the default. The default layout is every card expanded.

**Animation.** CSS with no new library:

- Cards enter in sequence, fading and rising.
- Numbers count up with `requestAnimationFrame`, once per load.
- Bars and the health gauge grow from zero.
- Collapse and expand animate height.
- A dragged card lifts, and others slide into place.
- Loading shows a shimmer in the card's shape.

Under `prefers-reduced-motion`, all of this switches off and values appear at once.

**States.** Each card has its own loading, error (with Retry), empty and data states. One failing card does not affect the others.

**Files.**

| File | Purpose |
|---|---|
| `Dashboard Module/components/SummaryBoard.jsx` | Groups, layout, drag |
| `Dashboard Module/components/SummaryCard.jsx` | Header, collapse, lazy load, states |
| `Dashboard Module/components/summaryCards/*.jsx` | One body per card |
| `Dashboard Module/components/summary.css` | Layout and animation |
| `Dashboard Module/logic/summaryLayout.js` | Pure layout read, merge and move |
| `Dashboard Module/logic/summaryFigures.js` | Pure card numbers from each source |
| `Dashboard Module/services/summaryApi.js` | One fetcher per card, plus the snapshot and refresh calls |
| `Integrations Module/supabase/zoho-finance/*` | Function, client, figures, tests |
| `Integrations Module/components/ZohoFinanceConnection.jsx` | Test button on the Financial Dashboard sub tab |
| `Main Module/src/App.jsx` | Passes `tabs` to `Dashboard` |

## 8. Live probe

This runs after the credentials are saved and before the Zoho cards are built. It is read-only.

1. Confirm which account-transactions GET path works.
2. Confirm how `current_balance` behaves: its sign per account type, and whether income and expense balances are lifetime or period totals.
3. Confirm the organisation's fiscal year start. If it is not January, year-to-date figures use it.
4. Confirm whether open invoices and bills in other currencies carry an exchange rate in the list response.
5. Count the income and expense accounts and the calls a 12-month refresh needs.

If 12 months of account transactions exceeds the 90-call limit or the endpoint is unusable, the fallback is: Revenue from invoices by date, Cost from bills plus `/expenses` by date. That is why `expenses.READ` is on the token. It may mean figures on an accrual basis without journals, which the cards would state, and the user decides whether that is acceptable.

**Accuracy check.** Revenue, Cost and Net profit for one closed month and year to date, compared with the same figures on Zoho's own Profit and Loss screen. The user checks the screen or supplies the figures. A difference must be explained or fixed before the Zoho cards go live.

## 9. Testing

- `Dashboard Module/logic` tests with `node --test`, in `Main Module/tests/` as existing tests do: layout merge, move, bad storage, and each card's numbers from sample data.
- `zoho-finance` Deno tests: every non-GET method and unlisted path refused, non-admin refused, aging boundaries, ratios, zero divisors, health scoring, the 90-call stop, and a failed refresh keeping old numbers.
- SQL test: a non-admin reads no snapshot row.
- `npm run build` in `Main Module`.
- In the browser, with a local dev server: collapse, expand, drag, move buttons, reload to confirm the layout was kept, reset, one forced card failure, reduced motion, and phone width.

## 10. Release order

Each live step needs the user's approval when it is reached.

1. Done: the Settings fields went live at caaf30a. Release the module cards.
2. The user saves the three values in Settings.
3. Apply `008_zoho_finance.sql` and deploy `zoho-finance` with `connection_test`.
4. Run the proof of read-only and the live probe.
5. Build the figures from the probe results, deploy the function again, and run the accuracy check.
6. Release the Zoho cards.

Rollback: remove the section from `Dashboard.jsx`, delete the function, run the migration's rollback and revoke the token. Existing Zoho drafts are unaffected throughout.

## 11. Out of scope

- Any write to Zoho.
- Scheduled refresh, or alerts driven by these figures.
- Saving the layout across devices.
- Non-admin access to the Zoho cards.
- Date range filters on the cards.
- Budget against actual, and forecasts.
