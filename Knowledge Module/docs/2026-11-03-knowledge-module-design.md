# Knowledge Module design

Date: 2026-11-03. Status: awaiting review.

## Purpose

Staff need one place to find what they can tell a client: prices, plans, procedures, document lists and standard answers. Today this sits in spreadsheets, a CSV of old articles and separate module tables.

Success means a staff member can search, find the right answer or price, and copy it to a client without exposing internal figures.

## Decisions

| Topic | Decision | Source |
|---|---|---|
| Users | Staff only. Clients get no direct access | Assumption, stated in review |
| Approach | New `knowledge_*` tables with one search | User |
| Draft prices | Shown, marked Draft, with a warning. Approved line by line | User |
| Tab name | **Knowledge**, key `knowledge` | Design |
| Internal items | Only admins can see them | Design default, accepted in review |
| Edit and approve | Admins only | Design default, accepted in review |
| Banking prices | Read live from `banking_pricing`, never copied | Design |
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
| `basis` | The study's "Basis". Admin only, refused to members by the database, never copied |
| `valid_until` | Optional date |
| `status`, `visibility`, `source_ref`, `approved_by`, `approved_at` | Same as `knowledge_entries` |
| Standard fields | Same as `knowledge_entries` |

Column-level read: `authenticated` has SELECT on every `knowledge_price_lines` column except `basis`, `payee` and `confidence`, so the API refuses those three to everyone.

`knowledge_price_line_review()`: `security definer` function, admin only (no rows for anyone else), returning `id`, `basis`, `payee` and `confidence` for the admin screens.

### `knowledge_banking_prices()`

A `security definer` function. `banking_pricing` only opens to Banking users, so this function gives Knowledge users selected columns.

- Requires `admin_is()` or `'knowledge' = any(my_tabs())`. Otherwise returns no rows.
- Returns bank name from `banking_partners`, scheme name from `banking_schemes`, `account_opening_fee`, `initial_deposit`, `minimum_balance`, `other_bank_charges`, `service_fee`, `effective_date`, `expiry_date` and `vat_mode`.
- A blank `service_fee` returns the `default_service_fee` setting. `vat_mode` comes from the `vat` setting and falls back to `inclusive`.
- Leaves out inactive or deleted banks and schemes. On a same-day tie, the newest row wins.
- Returns only prices in effect today.
- Never returns `service_fee_min`, `service_fee_max`, `source`, `remarks` or `bank_fee_collected_by_ab`.
- Banking prices count as Approved and Shareable, because the Banking team already manages them.

### `v_knowledge_search`

A view with `security_invoker = on`, so database rules still apply. It combines entries, price lines, `knowledge_banking_prices()` and active `service_items`. Each row has kind, source id, title, department, searchable text, status and visibility. Search uses `ilike` on title and text, which is enough at this size.

### Access rules

Row level security on all `knowledge_*` tables:

- Read categories: `admin_is()` or `'knowledge' = any(my_tabs())`.
- Read entries and price lines: `admin_is()`, or the tab is granted and `visibility = 'Shareable'` and `deleted_at is null`.
- Insert, update, delete: `admin_is()` only.

Agent commission figures must not enter these tables.

Run `audit_trail_attach_all()` after the migration so every change reaches the audit trail.

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

### Copy

- Copies plain text ready for email or WhatsApp.
- Appears only on Shareable items. Internal lines are never included, even for admins copying a group.
- Never includes `basis`, `confidence`, `payee`, status or the Draft label.
- Copying a Draft item first requires a tick confirming the staff member checked the price.
- Copied Business Setup prices state that they exclude VAT unless a line says otherwise. Accounts has not confirmed VAT per line.
- Copied banking prices follow the Banking VAT setting: when `vat_mode` is `exclusive` they end "Prices exclude VAT unless stated otherwise."; otherwise they end "AB Capital service fee includes VAT."

### Admin controls

- Add and edit entries and price lines. The body editor uses the existing `@tiptap/react`.
- Approve one line or a selected group. Approval records who and when.
- Set visibility.
- A **Needs review** filter lists Draft, Internal and Low confidence items.

### HTML display

Imported HTML and editor output are cleaned with DOMPurify before display. `dompurify` is a new `Main Module` dependency.

## CRM wiring

Small edits in `Main Module`:

- `vite.config.js`: add the `@knowledge` alias.
- `src/App.jsx`: lazy import and `view === "knowledge"`.
- `src/components/Sidebar.jsx`: add the Knowledge tab.
- `src/tabs.js`: add `knowledge` to `GRANTABLE_TABS`. Members have it off until an admin grants it.

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
- A member without the tab is redirected by the existing `resolveView`.

## Testing

Logic tests in `Knowledge Module/tests`, as `.test.mjs` files like `HR Module/tests`:

- Copied text leaves out Internal lines, `basis`, `confidence`, `payee` and the Draft label.
- Draft copy needs the confirm tick.
- `valid_until` warning.
- Import rules: Low confidence hold, Third party hold, deleted rows skipped, duplicate handling, and re-run leaves edited rows alone.

Database checks, using a test member account:

- Can't read Internal rows.
- Can't insert, update, delete or approve.
- No rows without the `knowledge` tab.
- `knowledge_banking_prices()` returns none of the hidden columns.

Browser check of search, copy and admin approval on the local dev server, against test data.

## Rollout

Each live step needs the user's approval first.

1. Build on a new branch from `main`, in a separate worktree.
2. Run the migration and `audit_trail_attach_all()` on `pnnakrhfzyxudjaghoxx`.
3. Run the import.
4. Merge and deploy.
5. Grant the `knowledge` tab to members.

To undo: remove the tab, then drop the `knowledge_*` tables, `v_knowledge_search` and `knowledge_banking_prices()`. Nothing else depends on them.

After launch, the team reviews Draft prices and Internal articles. Plans and Client Answers start empty until content is supplied.

## Out of scope

- Sending from the tab.
- AI-written answers.
- Client portal access.
- File attachments.
- Feeding prices into quotes.
- Removing `wiki_articles_rows.csv` from Git. It is already tracked and includes cost tables, so it needs a separate decision.
