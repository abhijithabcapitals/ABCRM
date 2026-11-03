# Knowledge Module design

Date: 2026-11-03, revised the same day for client sharing. Status: awaiting review.

## Purpose

Staff need one place to find what they can tell a client: prices, plans, procedures, document lists and standard answers. Today this sits in spreadsheets, a CSV of old articles and separate module tables.

Knowledge stays private inside the CRM. A client sees only the items an employee has shared with that client, in the client's own portal login.

Success means a staff member can search, find the right answer or price, and share it with one client without exposing internal figures or anything shared with another client.

## Decisions

| Topic | Decision | Source |
|---|---|---|
| Staff access | All CRM staff, with no per-member grant | User |
| Client access | Read-only, only items shared with that client, through the portal | User |
| Client logins | Existing portal. An admin decides; KYC % blocks nobody, 100% is not required | User |
| Who shares | The employee recorded on the client, or any staff member when the client has no recorded owner. Admins always | User |
| Assignment | Existing pick-up and assignment records. No new button | User |
| Approach | New `knowledge_*` tables with one search | User |
| Draft prices | Shown to staff, marked Draft, with a warning. Approved line by line. Can't be shared until Approved | User, then design |
| Tab name | **Knowledge**, key `knowledge` | Design |
| Internal items | All staff can read them. They can never be shared | Design, accepted in review |
| Edit and approve | Admins only | Design default, accepted in review |
| Copy button | Removed. Sharing through the portal replaces it | Design, accepted in review |
| Banking prices | Read live from `banking_pricing`, never copied into Knowledge tables | Design |
| Old Wiki | `Wiki.jsx` and live `wiki_*` tables are not touched | Design |

## Data

Migrations go in `Database Module/Knowledge Base/migrations/`. Files are numbered from `001`.

### `knowledge_categories`

`id`, `name` (unique), `sort_order`. Seeded with Business Setup, Banking, Accounting, Tax, Visas and General.

### `knowledge_entries`

Procedures, checklists, plans and client answers.

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `category_id` | References `knowledge_categories` |
| `entry_type` | `procedure`, `checklist`, `plan` or `client_answer` |
| `title`, `body` | `body` is HTML, as written by the editor or imported from the CSV |
| `status` | `Draft` or `Approved`. Default `Draft` |
| `visibility` | `Shareable` or `Internal`. Default `Internal` |
| `source_ref` | Unique when present. Stops a re-import duplicating or overwriting a row |
| `approved_by`, `approved_at` | Set on approval |
| `created_at`, `created_by`, `updated_at`, `updated_by` | Standard fields |
| `deleted_at` | Soft delete |

### `knowledge_price_lines`

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `category_id` | References `knowledge_categories` |
| `template` | IFZA, RAKEZ, SHAMS, Mainland or Liquidation in the first import. Free text, so more can be added |
| `line_group` | Licence, Government, Visa, AB Capital, Office, Zone or Third party in the first import |
| `item` | Line name |
| `amount_aed` | numeric(12,2) |
| `payee` | The study's "Who gets it" |
| `confidence` | `High`, `Medium`, `Low` or null |
| `basis` | The study's "Basis". Admin only, refused to members by the database, never shared |
| `valid_until` | Optional date |
| `status`, `visibility`, `source_ref`, `approved_by`, `approved_at` | Same as `knowledge_entries` |
| Standard fields | Same as `knowledge_entries` |

Column-level read: `authenticated` has SELECT on every `knowledge_price_lines` column except `basis`, `payee` and `confidence`, so the API refuses those three to everyone.

`knowledge_price_line_review()`: `security definer` function, admin only (no rows for anyone else), returning `id`, `basis`, `payee` and `confidence` for the admin screens.

### `knowledge_banking_prices()`

A `security definer` function. `banking_pricing` only opens to Banking users, so this function gives Knowledge users selected columns.

- Requires a signed-in CRM user. Clients sign in separately and have no Supabase Auth session, so they can't reach it.
- Returns `bank_id`, `scheme_id`, bank name from `banking_partners`, scheme name from `banking_schemes`, `account_opening_fee`, `initial_deposit`, `minimum_balance`, `other_bank_charges`, `service_fee`, `effective_date`, `expiry_date` and `vat_mode`.
- A blank `service_fee` returns the `default_service_fee` setting. `vat_mode` comes from the `vat` setting and falls back to `inclusive`.
- Leaves out inactive or deleted banks and schemes. On a same-day tie, the newest row wins.
- Returns only prices in effect today.
- Never returns `service_fee_min`, `service_fee_max`, `source`, `remarks` or `bank_fee_collected_by_ab`.
- Banking prices count as Approved and Shareable, because the Banking team already manages them.

### `v_knowledge_search`

A view with `security_invoker = on`, so database rules still apply. It combines entries, price lines, `knowledge_banking_prices()` and active `service_items`. Each row has kind, source id, title, department, searchable text, status and visibility. Search uses `ilike` on title and text, which is enough at this size.

### `knowledge_client_shares`

One row per item shared with one client login.

| Column | Notes |
|---|---|
| `id` | uuid primary key |
| `account_id` | References `client_portal_accounts` |
| `entry_id` | References `knowledge_entries`, or null |
| `price_line_id` | References `knowledge_price_lines`, or null |
| `bank_id`, `scheme_id` | The Banking price's bank, and scheme or null, when the share is a Banking price |
| `shared_by`, `shared_at` | Set by the database |
| `withdrawn_by`, `withdrawn_at` | Set on withdrawal. The row is kept as the record |

Exactly one of entry, price line or bank is set. One open share per item and client. A Banking share names the bank and scheme, not a price row, so the client sees Banking's current price after it changes.

### Who can share

`knowledge_can_share(account_id)` returns true when any of these holds:

1. The caller is an admin.
2. The caller is an owner of the client. Through the account's `banking_client_id`, that means `picked_up_by` or `assigned_to` on one of the client's `banking_leads`, or `assigned_to` on one of its `banking_cases`. Business Setup's `taken_by` and `owner_id` join this list when that module is live, because those tables aren't on `main` yet.
3. The client has no owner at all, including an account with no `banking_client_id`. Any staff member can share.

A Banking handover moves the right to the new employee, because it updates those same columns.

**Known limit:** an employee in another team can't share with a client who already has an owner, and needs that owner or an admin. The CRM doesn't record which team a client belongs to.

### Sharing functions

Staff write only through these `security definer` functions. Each sets `search_path`, is revoked from `public` and `anon`, and checks `knowledge_can_share` where it changes a share.

- `knowledge_share(account_id, entry_id, price_line_id, bank_id, scheme_id)`: refuses Draft, Internal, deleted, past `valid_until` and retired Banking items. Sharing an item already open returns the existing row.
- `knowledge_share_withdraw(share_id)`: sets the withdrawal fields.
- `knowledge_share_targets()`: clients with an active portal login, each with `can_share`.
- `knowledge_item_shares(entry_id, price_line_id, bank_id, scheme_id)`: open shares on an item, with client name, who shared it and when.

### What the client receives

`client_portal_knowledge(account_id)` is callable only by the `client-portal` Edge Function (service role), with the account from the client's session. It never takes an account from the client's request.

It returns only open shares for that account whose item is still Approved, Shareable, not deleted and not past `valid_until`, or a Banking price in effect today. Otherwise the item is left out until it's fixed, and staff see **Hidden from client** on the share.

| Returned | Never returned |
|---|---|
| Entry: title, type, category name, body | `status`, `visibility`, `source_ref`, approvals |
| Price line: template, group, item, `amount_aed`, `valid_until` | `basis`, `payee`, `confidence` |
| Banking: bank, scheme, the same fee columns staff see, `vat_mode` | `service_fee_min`, `service_fee_max`, `source`, `remarks`, `bank_fee_collected_by_ab` |
| Share date | Staff names, other clients' shares |

### Access rules

Row level security on all `knowledge_*` tables. Clients have no Supabase Auth session, so `authenticated` means CRM staff.

- Read categories, entries and price lines: any signed-in CRM user. Deleted rows: admins only. Internal rows are readable by staff.
- Insert, update, delete on categories, entries and price lines: `admin_is()` only.
- `knowledge_client_shares`: no direct access. Staff use the functions above.
- `anon` has no access to any of it.

Agent commission figures must not enter these tables.

Run `audit_trail_attach_all()` after the migration so every change, including shares and withdrawals, reaches the audit trail. Only admins can read the audit trail.

## Screens

Code goes in `Knowledge Module`, with the same shape as `HR Module`: `index.js`, `components/`, `services/`, `logic/`, `tests/`.

A search box sits above four views:

| View | Shows |
|---|---|
| Pricing | Filter by department, then zone or bank. Business Setup from `knowledge_price_lines`, grouped by template. Banking from `knowledge_banking_prices()` |
| Plans & Services | `plan` entries, plus `service_items` by group, read-only and without prices |
| Procedures & Documents | `procedure` and `checklist` entries |
| Client Answers | `client_answer` entries. Starts empty |

Each result shows title, department, last updated, and status and visibility badges.

- Draft items show: "Draft: confirm before quoting."
- Items past `valid_until` show: "Price may be out of date."
- An empty view says what is missing, so it can't be read as "no prices exist".

### Sharing

- **Share with client** appears only on items that can be shared: Approved and Shareable, or a Banking price. Draft and Internal items say why they can't be shared.
- A price group shares each of its Approved and Shareable lines. The confirmation says how many lines were shared and how many were left out.
- The client list shows clients with an active portal login. A client the employee can't share with is marked with who to ask, and can't be chosen.
- Each item lists the clients it's shared with, who shared it, when, **Hidden from client** where that applies, and **Withdraw** for those allowed.
- The database enforces all of this, not only the screen.

### Admin controls

- Add and edit entries and price lines. The body editor uses the existing `@tiptap/react`.
- Approve one line or a selected group. Approval records who and when.
- Set visibility.
- A **Needs review** filter lists Draft, Internal and Low confidence items.

### HTML display

Imported HTML and editor output are cleaned with DOMPurify before display. `dompurify` is a new `Main Module` dependency.

## Client portal

A new read-only **Knowledge** tab in `Client Login Module/portal/ClientPortal.jsx`, loaded through a new `knowledge` action in the `client-portal` Edge Function.

- Shows only what `client_portal_knowledge` returns, grouped by type, with prices grouped by template.
- An empty tab says: "Nothing has been shared with you yet."
- A load failure shows an error, not the empty message.
- Bodies are cleaned with DOMPurify before display.
- Business Setup prices end: "Prices exclude VAT unless stated otherwise." Accounts has not confirmed VAT per line.
- Banking prices follow the Banking VAT setting: when `vat_mode` is `exclusive` they end "Prices exclude VAT unless stated otherwise."; otherwise they end "AB Capital service fee includes VAT."
- An admin's existing **view as client** preview shows the same tab, read-only.

## CRM wiring

Small edits in `Main Module`:

- `vite.config.js`: add the `@knowledge` alias.
- `src/App.jsx`: lazy import and `view === "knowledge"`.
- `src/components/Sidebar.jsx`: add the Knowledge tab.
- `src/tabs.js`: `knowledge` is open to every staff member and isn't in `GRANTABLE_TABS`. `resolveView` always allows it, and a member's first page is unchanged.
- `db/edge-function-admin-users.ts`: undo the `knowledge` entry, since nothing grants this tab.

The `wiki` view code stays as it is.

## Import

`Database Module/Knowledge Base/build_knowledge_import.py` reads the sources and writes `data/knowledge_import.sql`. The `data/` folder is git-ignored, so prices stay out of the repo. Re-running adds new rows by `source_ref` and never overwrites edited rows. It prints counts imported, skipped and held.

### `Pricing Study 2026-11-03.xlsx`, sheet `Proposed Prices` (55 lines)

The header row is found by its `Template` cell. All lines import as Draft.

| Lines | Visibility |
|---|---|
| Low confidence (9) | Internal, whatever the payee |
| Payee `Third party` (5), unless already Low | Internal until reviewed |
| All other lines | Shareable |

The USD column is not imported. Multi-year prices are not in the study and are not imported.

### `wiki_articles_rows.csv` (54 rows)

- Skip deleted rows (6), leaving 48.
- Map the old category to a new one: Business Set Up to Business Setup, Banking Team to Banking, Accounting and Tax Compliances to Accounting, and everything else to General.
- Titles containing `Documents` import as `checklist`, others as `procedure`.
- Everything imports as Draft and Internal, so a person checks each article before it is shareable.
- "How to apply Import/Export Code on Dubai Trade" appears twice with different text. Keep the longer one and list both in the report.
- The report separately lists articles with a title starting `Sponsor Visa Cost` or `Services Price List for`, because they may hold vendor costs or client-specific prices. These stay Internal until a person has read them.

## Errors

- Banking read fails: Pricing shows "Banking prices could not load" and the rest still works.
- Save fails: the form stays open and shows the error.
- Search fails: the box shows the error, not "no results".
- Share refused: the error says why, and nothing is shared.
- Withdraw fails: the share stays listed as open, with the error shown.

## Testing

Logic tests in `Knowledge Module/tests`, as `.test.mjs` files like `HR Module/tests`:

- Text shown to a client leaves out `basis`, `confidence`, `payee` and status, and uses the right VAT sentence.
- Which items offer sharing, and the `valid_until` warning.
- Import rules: Low confidence hold, Third party hold, deleted rows skipped, duplicate handling, and re-run leaves edited rows alone.

Database checks, with test staff and test client accounts:

- Staff read Internal rows but not `basis`, `payee` or `confidence`, and can't insert, update, delete or approve.
- Owner shares with their client. A non-owner is refused. A client with no owner accepts any staff member. An admin can always share. After a handover, the new owner can share and the old one can't.
- Draft, Internal, deleted, past `valid_until` and retired Banking items are refused.
- Direct access to `knowledge_client_shares` is refused.
- `client_portal_knowledge`: refused for `authenticated` and `anon`; returns only that account's items; never another client's; never a hidden column; an item returned to Draft, withdrawn or expired disappears; a changed Banking price shows the new figure.
- `knowledge_banking_prices()` returns none of the hidden columns.

Browser check of search, sharing, withdrawal, admin approval and the portal tab, against test data.

## Rollout

Each live step needs the user's approval first.

1. Bring branch `knowledge-module` up to date with `main`.
2. Run the migration and `audit_trail_attach_all()` on `pnnakrhfzyxudjaghoxx`.
3. Run the import.
4. Compare the deployed `client-portal` function with Git. If they differ, stop and ask. Deploy the new version.
5. Before merging, confirm the existing portal tabs still work.
6. Merge and deploy.
7. With a test staff member and a test client on the real backend, confirm search, sharing, the portal tab, withdrawal, and that hidden columns and other clients' items are refused. Delete the test client after.

To undo: revert the site and redeploy the earlier `client-portal` function, then drop the `knowledge_*` tables, `v_knowledge_search` and the Knowledge functions. **Dropping `knowledge_client_shares` deletes the record of what was shared**, so export it first.

After launch, the team reviews Draft prices and Internal articles. Plans and Client Answers start empty until content is supplied.

## Out of scope

- Sending email or messages from the tab, and copying text out of it.
- Notifying a client when something is shared.
- A new button or table for taking up a client.
- Team-level sharing rules.
- AI-written answers.
- File attachments.
- Feeding prices into quotes.
- Removing `wiki_articles_rows.csv` from Git. It is already tracked and includes cost tables, so it needs a separate decision.
