# Knowledge Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a staff Knowledge tab with one search across prices, plans, procedures and client answers, where only Shareable content can be copied.

**Architecture:** New `knowledge_*` tables with row level security hold entries and price lines. A `security definer` function exposes selected banking price columns, and a `security_invoker` view provides search. A React module in `Knowledge Module` is mounted in `Main Module`. A Python script builds the private import SQL.

**Tech Stack:** Postgres (Supabase), React with Vite, `@tiptap/react`, `dompurify`, Python 3.12 with `openpyxl`, `node --test`, `unittest`, local throwaway Postgres for SQL tests.

**Spec:** `Knowledge Module/docs/2026-11-03-knowledge-module-design.md`

## Global Constraints

- Branch `knowledge-module` from `main`, in worktree `D:/Abhijith Projects/CRM-knowledge`. All paths are relative to that worktree.
- Nothing runs against Supabase project `pnnakrhfzyxudjaghoxx` without the user's approval for that step. Tasks 1 to 7 touch no live database.
- Prices never enter Git. Import output goes in the git-ignored `Database Module/Knowledge Base/data/`. Test fixtures use invented prices.
- Agent commission figures must not enter these tables.
- `Wiki.jsx`, the `wiki` view code and live `wiki_*` tables are not touched.
- Only `Knowledge Module/services/knowledgeApi.js` imports the Supabase client, as in `HR Module`.
- Vocabulary, exact: status `Draft` | `Approved`; visibility `Shareable` | `Internal`; entry type `procedure` | `checklist` | `plan` | `client_answer`.
- Screen copy, exact: "Draft: confirm before quoting." · "Price may be out of date." · "Banking prices could not load"
- Copied price text ends, exactly: "Prices exclude VAT unless stated otherwise."
- `main` lacks 7 commits from `banking-new-lead-fix`, including the sidebar tab order. Find edit points by text, not line number.

## Review Focus

- **Approved price edited later:** an admin changes the amount on an Approved line. It must return to Draft, or an unchecked price stays marked Approved. Test in Task 1.
- **Blank or text AED cell in the study:** must be skipped and reported, never imported as 0. Test in Task 2.
- **Article tables in copied text:** visa cost and checklist bodies are HTML tables. Rows must stay readable in plain text. Test in Task 3.
- **Search text with `%`, `_` or a comma:** must match literally and not break the query. Test in Task 3.
- **`valid_until` equal to today, in Dubai time:** still valid today, expired tomorrow. Test in Task 3.

---

### Task 1: Database schema, access rules and banking read

**Files:**
- Create: `Database Module/Knowledge Base/migrations/001_knowledge.sql`
- Create: `Database Module/Knowledge Base/migrations/rollback/001_rollback.sql`
- Create: `Database Module/Knowledge Base/tests/000_stub.sql`, `010_knowledge_test.sql`, `run-local.sh`
- Modify: `Database Module/Knowledge Base/README.md`

**Interfaces:**
- Consumes: `admin_is()`, `my_tabs()`, `banking_partners.bank_name`, `banking_schemes.scheme_name`, `service_items`, `service_categories.department`.
- Produces: tables and columns as in the spec; `knowledge_banking_prices()`; view `v_knowledge_search(kind, source_id, title, department, search_text, status, visibility, updated_at)`, where `kind` is `entry` | `price` | `banking` | `service`.

- [ ] **Step 1: Create the worktree and copy in the spec and this plan**

```bash
git worktree add "../CRM-knowledge" -b knowledge-module main
```

Copy both files from `Knowledge Module/docs/` in the main checkout, where they are untracked.

- [ ] **Step 2: Write the failing SQL test**

Copy the `run-local.sh` shape and the `t.ok` / `t.fails` helpers from `Database Module/Admin Base/tests`. Stub only what the migration needs. Test as `authenticated` with `request.jwt.claims`, for an admin, a member with the tab and a member without it:

| Check | Expected |
|---|---|
| Member with tab reads Shareable Draft and Approved rows | Visible |
| Member with tab reads Internal or soft-deleted row | Not visible |
| Member without tab reads any row, or calls `knowledge_banking_prices()` | No rows |
| Member insert, update, delete, or setting `status = 'Approved'` | Fails or affects 0 rows |
| Admin reads Internal, inserts and approves | Works; `approved_by` and `approved_at` are set |
| Approved line: change `amount_aed`; Approved entry: change `body` | Status is `Draft`; approval fields cleared |
| Approved line: change only `visibility` or `valid_until` | Stays `Approved` |
| `knowledge_banking_prices()` result columns | No `service_fee_min`, `service_fee_max`, `source`, `remarks`, `bank_fee_collected_by_ab` |
| Banking price expired or not yet effective | Not returned |
| `v_knowledge_search` as member with tab | No Internal rows; Banking and service rows present |
| Duplicate `source_ref` insert | Fails; multiple nulls allowed |

- [ ] **Step 3: Run it to verify it fails**

Run: `bash "Database Module/Knowledge Base/tests/run-local.sh"`
Expected: FAIL because the `knowledge_*` tables don't exist.

- [ ] **Step 4: Write the migration and rollback**

Follow the spec's Data section. Use `create table if not exists`, re-runnable policies, check constraints on the vocabulary and `amount_aed >= 0`, and a plain `unique (source_ref)`. Seed the 6 categories with `on conflict do nothing`.

Trigger `knowledge_touch()` before insert or update on both tables:
- Sets `updated_at` and `updated_by`.
- Status changing to `Approved`: sets `approved_by = auth.uid()` and `approved_at = now()`.
- Approved row with a changed content column (`title`, `body`, or `template`, `line_group`, `item`, `amount_aed`, `payee`): sets `Draft` and clears the approval fields.

The migration must not reference the audit trail, because `main` lacks that file. Rollback drops the view, function and tables.

- [ ] **Step 5: Run the test to verify it passes, twice over**

Run the migration twice in `run-local.sh` to prove it can re-run.
Expected: every check prints `ok`.

- [ ] **Step 6: Update the README and commit**

Replace the README's opening with the new tables and keep the Wiki copy tools documented as legacy.

```bash
git add "Database Module/Knowledge Base" "Knowledge Module/docs"
git commit -m "Add Knowledge tables, access rules and the banking price read"
```

### Task 2: Import builder

**Files:**
- Create: `Database Module/Knowledge Base/build_knowledge_import.py`
- Test: `Database Module/Knowledge Base/tests/test_build_knowledge_import.py`

**Interfaces:**
- Produces: `parse_price_rows(rows) -> (lines, skipped)`, `parse_articles(rows, categories) -> (entries, skipped, flagged)`, `build_sql(lines, entries) -> str`, and CLI `main()` writing `data/knowledge_import.sql` and printing the report.

- [ ] **Step 1: Write the failing tests**

Use `unittest` with invented values:

```python
def test_header_found_by_template_cell(self): ...  # title rows above the header are ignored
def test_low_confidence_is_internal(self): ...     # even with payee "AB Capital"
def test_third_party_is_internal(self): ...
def test_other_lines_are_shareable_draft(self): ...
def test_blank_or_text_amount_is_skipped_not_zero(self): ...  # appears in skipped with a reason
def test_usd_not_imported(self): ...
def test_source_ref_stable_across_runs(self): ...  # "study:2026-11-03:<template>|<group>|<item>"
def test_repeated_price_key_gets_row_number(self): ...
def test_deleted_articles_skipped(self): ...
def test_articles_all_draft_internal(self): ...    # source_ref "wiki:<id>"
def test_type_from_title(self): ...                # "documents", any case, is checklist; else procedure
def test_category_map(self): ...                   # Business Set Up, Banking Team, Accounting and Tax Compliances; else General
def test_duplicate_title_keeps_longer_and_reports_both(self): ...
def test_sponsor_and_price_list_titles_flagged(self): ...
def test_sql_escapes_quotes(self): ...
def test_sql_never_overwrites(self): ...           # every insert has "on conflict (source_ref) do nothing"
```

- [ ] **Step 2: Run to verify they fail**

Run: `.venv/Scripts/python.exe -m unittest discover -s "Database Module/Knowledge Base/tests" -p "test_*.py"`
Expected: FAIL with an import error.

- [ ] **Step 3: Implement the builder**

Price lines take the category Business Setup. Insert categories by name lookup. Set `csv.field_size_limit` high, as bodies are long.

- [ ] **Step 4: Run tests, then the real sources**

Run the tests, then `.venv/Scripts/python.exe "Database Module/Knowledge Base/build_knowledge_import.py"`.
Expected: tests PASS. Report shows 55 study lines read (9 Low confidence), 54 CSV rows, 6 deleted, 47 entries after the duplicate. `git status` shows no file from `data/`.

- [ ] **Step 5: Commit**

```bash
git add "Database Module/Knowledge Base/build_knowledge_import.py" "Database Module/Knowledge Base/tests/test_build_knowledge_import.py"
git commit -m "Add the Knowledge import builder with its review rules"
```

### Task 3: Copy, status and search logic

**Files:**
- Create: `Knowledge Module/logic/copyText.js`, `logic/status.js`, `logic/search.js`
- Test: `Knowledge Module/tests/copyText.test.mjs`, `status.test.mjs`, `search.test.mjs`

**Interfaces:**
- Produces:
  - `canCopy(item) -> boolean`, `needsConfirm(item) -> boolean`
  - `htmlToText(html) -> string`
  - `priceLinesToText(lines, title) -> string`, `bankingPriceToText(row) -> string`, `entryToText(entry) -> string`
  - `isExpired(validUntil, today) -> boolean`, `needsReview(item) -> boolean`
  - `escapeLike(query) -> string`, `groupPriceLines(lines) -> [{template, groups: [{line_group, lines}]}]`

- [ ] **Step 1: Write the failing tests**

```js
test("canCopy is false for Internal, true for Shareable Draft and Approved");
test("needsConfirm is true only for Draft");
test("priceLinesToText leaves out Internal lines even when given a mixed group");
test("priceLinesToText never contains basis, confidence, payee or the word Draft");
test("priceLinesToText formats amounts", () => assert.match(text, /Visa stamp: AED 1,250/));
test("price text ends with the VAT sentence", () => assert.ok(text.endsWith("Prices exclude VAT unless stated otherwise.")));
test("a group with only Internal lines gives empty text");
test("htmlToText keeps table rows as lines, cells split by ' | ', and decodes &nbsp; and &amp;");
test("htmlToText drops script and style content");
test("isExpired: null false; today false; yesterday true");
test("needsReview: true for Draft, Internal or Low confidence; false for Approved Shareable High");
test("escapeLike escapes %, _ and backslash, and keeps commas literal");
test("groupPriceLines keeps template and group order");
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test "Knowledge Module/tests/"`
Expected: FAIL with module not found.

- [ ] **Step 3: Implement the three files**

No browser APIs here, so the tests run in Node. Pass `today` as a Dubai date string; callers get it from `dubaiToday` in `HR Module/logic/attendance.js`.

- [ ] **Step 4: Run to verify they pass**

Run: `node --test "Knowledge Module/tests/"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Knowledge Module/logic" "Knowledge Module/tests"
git commit -m "Add Knowledge copy, status and search logic"
```

### Task 4: Data service and static checks

**Files:**
- Create: `Knowledge Module/services/knowledgeApi.js`
- Test: `Knowledge Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: `escapeLike` from Task 3; `@app/supabase`.
- Produces: `search(query)`, `listPriceLines()`, `listBankingPrices()`, `listEntries(types)`, `listServices()`, `listCategories()`, `saveEntry(row)`, `savePriceLine(row)`, `approve(table, ids)`, `setVisibility(table, ids, visibility)`, `softDelete(table, id)`. Each throws `Error` on failure, using the `check` shape from `HR Module`.

- [ ] **Step 1: Write the failing static test**

Copy the shape of `HR Module/tests/static.test.mjs`:
- Every `knowledge_` table enables row level security, with a floor of 3 tables.
- Only `services/knowledgeApi.js` imports the Supabase client.
- No file in `Knowledge Module` reads `service_fee_min`, `service_fee_max` or `banking_pricing` directly.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Knowledge Module/tests/static.test.mjs"`
Expected: FAIL because `services/knowledgeApi.js` doesn't exist.

- [ ] **Step 3: Implement the service**

`search` uses `.ilike("search_text", ...)` with `escapeLike`, not `.or()`, so commas stay literal. It returns at most 50 rows. `approve` sets only `status`; the trigger records who and when.

- [ ] **Step 4: Run, then commit**

Run: `node --test "Knowledge Module/tests/"`
Expected: PASS.

```bash
git add "Knowledge Module/services" "Knowledge Module/tests/static.test.mjs"
git commit -m "Add the Knowledge data service"
```

### Task 5: Screens

**Files:**
- Create: `Knowledge Module/index.js`, `README.md`
- Create in `Knowledge Module/components/`: `KnowledgeModule.jsx`, `PricingView.jsx`, `ServicesView.jsx`, `EntriesView.jsx`, `ResultCard.jsx`, `CopyButton.jsx`, `EditForm.jsx`, `NeedsReview.jsx`, `SafeHtml.jsx`, `knowledge.css`

**Interfaces:**
- Consumes: Tasks 3 and 4; `ErrorNote`, `Spinner`, `useLoad` from `@banking/components/shared`; `@banking/components/banking.css`.
- Produces: default export `KnowledgeModule({ profile })`. Admin means `profile?.role === "admin"`, as in `Sidebar.jsx`.

- [ ] **Step 1: Build the shell and four views**

Search box above tabs: Pricing, Plans & Services, Procedures & Documents, Client Answers. `EntriesView` takes `types`, so it serves the last two views and shows `plan` entries inside Plans & Services. Empty views state what is missing, and members see that items may be awaiting review.

- [ ] **Step 2: Build `ResultCard` and `CopyButton`**

Badges and warnings use the exact copy in Global Constraints. `CopyButton` renders nothing when `canCopy` is false. For Draft, it requires the tick before writing to the clipboard, and it shows an error if the clipboard write fails.

- [ ] **Step 3: Build `PricingView` error handling**

Load banking and Business Setup separately. A banking failure shows "Banking prices could not load" and Business Setup prices still render. Search failure shows the error, not "no results".

- [ ] **Step 4: Build admin controls**

`EditForm` uses `@tiptap/react` for bodies, and stays open with the error if a save fails. `NeedsReview` lists Draft, Internal and Low confidence items, with approve and visibility actions on selected rows. `basis` and `confidence` appear only here and in `EditForm`. All are hidden unless admin.

- [ ] **Step 5: Build `SafeHtml`**

Wraps `DOMPurify.sanitize` before `dangerouslySetInnerHTML`. Task 6 adds the dependency.

- [ ] **Step 6: Commit**

```bash
git add "Knowledge Module"
git commit -m "Add the Knowledge screens"
```

### Task 6: CRM wiring

**Files:**
- Modify: `Main Module/vite.config.js`, `Main Module/src/App.jsx`, `Main Module/src/components/Sidebar.jsx`, `Main Module/src/tabs.js`, `Main Module/package.json`, `Main Module/package-lock.json`

**Interfaces:**
- Consumes: `KnowledgeModule` from Task 5.
- Produces: view and tab key `knowledge`, alias `@knowledge`.

- [ ] **Step 1: Add the dependency and aliases**

Run `npm install dompurify` in `Main Module`. In `vite.config.js`, add `@knowledge`, plus a `dompurify` alias pointing at `./node_modules/dompurify`, because sibling module folders have no `node_modules`. Use the `@tiptap/react` import the same way if the build can't resolve it.

- [ ] **Step 2: Wire the tab**

- `tabs.js`: add `{ key: "knowledge", label: "Knowledge" }` to `GRANTABLE_TABS`.
- `Sidebar.jsx`: add `{ key: "knowledge", Icon: IconFile, label: "Knowledge" }` after the `tax` item.
- `App.jsx`: `const Knowledge = lazy(() => import("@knowledge"));` and `{view === "knowledge" && <Knowledge profile={profile} />}`.

- [ ] **Step 3: Build and lint**

Run in `Main Module`: `npm run build` and `npx eslint src/tabs.js src/App.jsx`
Expected: build succeeds with no unresolved imports, no new lint errors.

- [ ] **Step 4: Commit**

```bash
git add "Main Module/vite.config.js" "Main Module/src/App.jsx" "Main Module/src/components/Sidebar.jsx" "Main Module/src/tabs.js" "Main Module/package.json" "Main Module/package-lock.json"
git commit -m "Add the Knowledge tab to the CRM"
```

### Task 7: Browser check on test data

**Files:**
- Create: `Knowledge Module/tests/browser-check.md`

- [ ] **Step 1: Prepare a safe test target**

Use a Supabase branch or local stack with the migration and invented test rows. The check must not write to the live project. If neither is available, stop and ask the user.

- [ ] **Step 2: Run the check in the built-in browser**

Use `preview_start` with a `.claude/launch.json` entry for `Main Module`. Confirm:

| Action | Expected |
|---|---|
| Member with tab searches `a%b` and a normal word | Literal match, no error |
| Member views Pricing | Draft warning shown; no Internal line, `basis` or `confidence` |
| Copy a Draft line | Tick needed; clipboard has no "Draft"; ends with the VAT sentence |
| Banking read blocked | "Banking prices could not load", other prices still show |
| Admin approves a line, then edits its amount | Approved, then back to Draft |
| Member without the tab | Redirected away |
| Phone width | No sideways page scroll |

Check the console for errors with `read_console_messages`.

- [ ] **Step 3: Record results and commit**

```bash
git add "Knowledge Module/tests/browser-check.md"
git commit -m "Record the Knowledge browser check"
```

### Task 8: Rollout

Each step needs the user's approval at that time. Say what will change before asking.

- [ ] **Step 1: Run the migration on `pnnakrhfzyxudjaghoxx`, then `select * from audit_trail_attach_all();`**

Expected: `failed` is empty. `knowledge_categories` has 6 rows. Run `get_advisors` and fix any new security finding on these objects.

- [ ] **Step 2: Rebuild the import from the latest sources, then run `data/knowledge_import.sql`**

Expected: table counts match the builder's report. A count of Shareable entries returns 0.

- [ ] **Step 3: Open a pull request, merge and deploy**

Follow the repo's existing deploy path, and bind the pull request with the `ccd_pr` tools.

- [ ] **Step 4: Check the deployed tab as an admin**

Expected: Pricing shows Business Setup and live Banking prices. No console errors.

- [ ] **Step 5: Grant the `knowledge` tab to the members the user names**

Hand over: the builder's report, and the list of flagged articles for the team's review.
