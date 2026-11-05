# Company Library Fill and Generate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff fill a Company Library template in the CRM, using OCR and manual entry, and generate a saved Word document with a serial Ref.

**Architecture:** Templates move to private storage, listed by two new tables. Generated documents are `hub_documents` rows, numbered through `hub_next_number`. All rendering and OCR run in the browser; the server only numbers and stores.

**Tech Stack:** React 19, Supabase (Postgres, Storage), docxtemplater, pizzip, JSZip, DOC OCR Module through `readDocuments`, `node --test`, local PostgreSQL 18 for database tests.

**Spec:** `Template Module/docs/2026-11-05-library-fill-design.md`

## Global Constraints

- Work in `D:\Abhijith Projects\CRM-library-fill` on branch `library-fill`. Do not push, merge, or change live data without the user's approval.
- No `.docx` holding prices or bank details may be committed. Real files stay outside the repo.
- AB Capital Ref: `hub_next_number('Business Setup', 'quote')`. Ardentax Ref: `hub_next_number('Ardentax Documents', 'document')`, format `Ardentax/{YYYY}/{MM}/ADTD{SERIAL}`, digits 3, restart `never`.
- Bucket: `hub-documents`. Template paths: `library-templates/<Company>/<uuid>.docx`. Generated paths: `<department>/<id>/<uuid>.docx`.
- OCR only through `readDocuments` and `buildAutofill`. Uploaded ID files are not stored.
- Passport and Emirates ID numbers never go on a document.
- No VAT: `vat_mode = 'none'`.
- Before changing `hub_numbering_status`, `hub_numbering_save` or `hub_doc_read`, copy the current definition from live with `pg_get_functiondef` or `pg_policy`. Later migrations replaced the early ones.
- Code comments and UI text follow the existing plain style. Dates use Asia/Dubai.

## Review Focus

1. A second staff member retries another person's failed document: `hub_document_attach` updates only `created_by = auth.uid()`, so Retry shows only to the creator (Task 7).
2. Business Setup's Create file on a library quote with no file: must refuse, not use the service template (Task 7).
3. Double-brace text split across Word runs, or tags in text boxes and headers: must still be detected (Task 2).
4. Pasted control characters in a field, which make Word reject the file: stripped before render (Task 3).
5. A template replaced after a document failed: Retry uses that document's original file, not the newest (Task 7).

---

### Task 1: Database

**Files:**
- Create: `Database Module/Template Hub Base/migrations/004_library_fill.sql`
- Create: `Database Module/Template Hub Base/rollback/004_rollback.sql`
- Create: `Database Module/Template Hub Base/tests/run-local.sh`, `tests/000_as.sql`, `tests/010_library_test.sql`
- Modify: `Database Module/Template Hub Base/README.md`

**Interfaces:**
- Produces, callable by `authenticated`:
  - `hub_library_my_access() returns jsonb` with `{ab, ardentax, manage}`: `business_setup_can('setup.quotes.manage')`, `ardentax_can()`, `banking_can('settings.manage')`.
  - `hub_library_template_save(p jsonb) returns text`, keys `template_key, company, folder, name, fee_rows, usd_rate, active`.
  - `hub_library_template_upload(p_key text, p_name text, p_path text) returns bigint`.
  - `hub_library_create(p jsonb) returns hub_documents`, keys `template_key, file_id, client_id, client_name, contact_name, contact_email, contact_phone, client_address, field_values, lines`.
- Tables and columns as in the spec's Data changes.

- [ ] **Step 1: Write `run-local.sh` and `000_as.sql`**

Copy from `Database Module/ArdentTax Base/tests/`. `MINE` is `004_library_fill.sql`; the base list adds `ArdentTax Base/migrations/001_ardentax.sql` and `Template Hub Base/migrations/003_brand_name.sql`. Test people: `manager` (settings.manage and setup.quotes.manage), `quoter` (setup.quotes.manage only), `ardent` (ardentax tab only), `outsider` (none).

- [ ] **Step 2: Write the failing tests in `010_library_test.sql`, using `at_check`**

```
'AB Capital continues the BSQ series after a Service Documents quote'
'Ardentax starts at ADTD001 and leaves the ADTQ counter unchanged'
'library rows are skipped by the Voucher Register, AB Capital rows are recorded'
'total_amount is recalculated from lines, ignoring a total sent by the browser'
'company comes from the template row: a browser company is ignored'
'retired template is refused'
'outsider cannot create AB Capital: setup.quotes.manage required'
'quoter cannot create Ardentax; ardent can'
'AB Capital needs at least one line; Ardentax may have none'
'outsider cannot read library rows or Ardentax template rows; AB Capital templates readable'
'quoter cannot save a template; manager can; path must start library-templates/'
'hub_numbering_status still returns every department, and Ardentax Documents has only document'
'hub_numbering_save accepts document only where the setting has it'
'accepted library quote can take the engagement letter step; unaccepted is refused'
```

Add `020_concurrency.sh` from the ArdentTax copy: parallel `hub_library_create` calls give distinct numbers.

- [ ] **Step 3: Run the tests**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: FAIL at the migration step, because the file does not exist.

- [ ] **Step 4: Write `004_library_fill.sql`, re-runnable**

Adds everything in the spec's Data changes. `hub_library_create` for AB Capital calls `hub_document_create` with `doc_type 'quote'`, department `Business Setup`, `vat_mode 'none'`, `services` from line descriptions, then updates `library_template`, `library_file_id`, `field_values`. For Ardentax it checks `ardentax_can()`, then inserts directly with `doc_type 'library'`, department `Ardentax Documents`, `company 'Ardentax'`, the serial from `hub_serial_of('Ardentax Documents', 'document', number)`. Add `library` to the `doc_type` check and `document` to the `kind` check. `file_id` must belong to the template. Storage policies follow the `hub_docs_ardentax_*` block.

- [ ] **Step 5: Write `004_rollback.sql`**

Refuses while library documents exist unless `library.rollback_force = 'yes'`. Restores the checks, the policy, and the live copies of both numbering functions.

- [ ] **Step 6: Run the tests**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: every line `ok`, exit 0, including migration passes 1 and 2 and rollback.

- [ ] **Step 7: Commit**

```bash
git add "Database Module/Template Hub Base"
git commit -m "Add library templates and generated documents to the database"
```

### Task 2: Reading fields from a template

**Files:**
- Create: `Template Module/logic/libraryFields.js`
- Create: `Template Module/tests/libraryFields.test.mjs`

**Interfaces:**
- Produces:
  - `readTags(buffer, JSZip) -> Promise<{fields: string[], loop: string[], hasTags: boolean}>`
  - `fieldsFor(tags, company) -> Array<{name, label, required, type, full}>`, the shape `FormGrid` takes.
  - `checkRequired(fields, values, rows, company) -> string | null`

- [ ] **Step 1: Write the failing tests**

Tests build a small `.docx` with JSZip inside the test. No real template is used.

```js
test("finds tags split across runs", ...)        // <w:t>{{ da</w:t><w:t>te }}</w:t> gives "date"
test("finds tags in text boxes, headers and footers", ...)
test("items loop tags go to loop, not fields", ...) // label, amount, amount_usd, remarks, rate, sl
test("system tags are not form fields", ...)     // ref_no, total, total_usd
test("no tags gives hasTags false", ...)
test("unknown tag becomes optional text labelled from its name", ...) // business_sector gives "Business sector"
test("AB Capital requires client, contact, email, phone; address optional", ...)
test("Ardentax requires only client_name", ...)
test("checkRequired names the empty fields", ...)
test("AB Capital needs one fee row; Ardentax does not", ...)
test("checkRequired rejects a bad email", ...)
```

- [ ] **Step 2: Run them**

Run: `node --test "Template Module/tests/libraryFields.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `libraryFields.js`**

Read `word/document.xml` and every `word/header*.xml` and `word/footer*.xml`. Join `<w:t>` text per paragraph before matching `{{ ... }}`. `date` is a form field defaulting to today.

- [ ] **Step 4: Run them**

Run: `node --test "Template Module/tests/libraryFields.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/logic/libraryFields.js" "Template Module/tests/libraryFields.test.mjs"
git commit -m "Read form fields from library templates"
```

### Task 3: OCR mapping and document data

**Files:**
- Create: `Template Module/logic/libraryOcr.js`, `Template Module/logic/libraryContext.js`
- Modify: `Template Module/logic/buildContext.js:1` (import `./helpers.js`, so it runs under node)
- Test: `Template Module/tests/libraryData.test.mjs`

**Interfaces:**
- Consumes: `buildContext(record, fields, seq, usdRate, extraRows)`.
- Produces:
  - `mergeAutofill(values, autofill) -> {values, filled: string[], conflicts: Record<string, string[]>}`, where `autofill` is the result of `buildAutofill`.
  - `fromClientMaster(row) -> values`, where `row` is `{client_id, data}`.
  - `libraryContext(values, rows, usdRate, refNo) -> object` for docxtemplater.
  - `toLines(rows) -> Array<{description, amount, remarks, rate}>`.

- [ ] **Step 1: Write the failing tests**

```js
test("fills empty fields only and never overwrites a typed value", ...)
test("disagreeing documents become conflicts with both readings", ...)
test("first person on an ID fills contact_name", ...)
test("no ID number reaches values", ...)  // passport_number absent even if autofill has it
test("Client Master keys map to tags", ...) // "Client Legal Name" to client_name, "Primary Contact" to contact_name
test("context has ref_no, items and totals", ...) // 1000 + 500 gives total "1,500.00" as fmtMoney prints it
test("USD column sums rounded lines at the given rate", ...)
test("rate and remarks stay on each item", ...)
test("control characters are stripped from every value", ...) // "A\x0BB" gives "AB"
test("empty rows are dropped", ...)
```

- [ ] **Step 2: Run them**

Run: `node --test "Template Module/tests/libraryData.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files and fix the import**

`libraryContext` calls `buildContext(values, [], 0, usdRate, rows)`, re-attaches `rate` by index, sets `ref_no`, and removes `quotation_no`. Default USD rate is 3.6725 when the template's is empty, matching `DEFAULT_USD_RATE` in `Business Setup Module/logic/quoteData.js`.

- [ ] **Step 4: Run all Template Module tests**

Run: `node --test "Template Module/tests/"`
Expected: PASS, including the existing `serviceDocs` tests.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/logic" "Template Module/tests"
git commit -m "Map OCR results and build library document data"
```

### Task 4: Template edit script

**Files:**
- Create: `Template Module/scripts/update_library_templates.py`

**Interfaces:**
- Produces: `python update_library_templates.py "<originals>" "<output>"` writes six edited files. Refuses an output folder inside a git repo. Then `--check "<output>"` prints each file's tags.

- [ ] **Step 1: Write the script**

Follow `Business Setup Module/scripts/fix_templates.py`. Edits as in the spec's Template changes. Copy the formatting of the neighbouring paragraph or table when inserting the client block. Fails loudly if an expected anchor text is missing.

- [ ] **Step 2: Run it on the real files**

Originals come from `git show origin/main:"Template Module/Template Docs/..."`, into a folder outside the repo. Output: `D:\Abhijith Projects\CRM Private\Library Templates\`.

Run: `python update_library_templates.py "<originals>" "D:\Abhijith Projects\CRM Private\Library Templates"` then `--check`.
Expected: all five AB Capital files list `ref_no, client_name, contact_name, contact_email, contact_phone`; Rakez, SHAMS and Mainland list `business_activity`; Ardentax Master shows no `[` placeholder.

- [ ] **Step 3: Confirm nothing private is staged**

Run: `git status --short`
Expected: only the script. No `.docx`.

- [ ] **Step 4: Commit**

```bash
git add "Template Module/scripts/update_library_templates.py"
git commit -m "Add script that prepares library templates"
```

### Task 5: Service calls and numbering screen

**Files:**
- Modify: `Template Module/services/hubApi.js`
- Modify: `Template Module/components/HubNumbering.jsx:9`
- Modify: `Template Module/logic/serviceDocs.js` (`NUMBERING_DEPARTMENTS` adds `Ardentax Documents`)
- Modify: `Template Module/tests/serviceDocs.test.mjs` (the department list assertion)

**Interfaces:**
- Consumes: Task 1 functions.
- Produces in `hubApi.js`:
  - `libraryAccess()`, `listLibraryTemplates()` (with latest file), `saveLibraryTemplate(p)`
  - `uploadLibraryFile(templateKey, company, file)`, `libraryFileBuffer(fileId)`, `libraryFileUrl(fileId)`
  - `createLibraryDocument(p)`, `listLibraryDocuments()` (rows where `library_template` is set), `searchClients(name)` (returns `client_id, data`)
- `listDocuments` adds `.neq("doc_type", "library")`.

- [ ] **Step 1: Update the department test, run it, see it fail**

Run: `node --test "Template Module/tests/serviceDocs.test.mjs"`
Expected: FAIL on the department list.

- [ ] **Step 2: Add the service calls and the department**

`KINDS` in `HubNumbering.jsx` adds `["document", "Documents"]`. The existing `if (!d) return null` already hides rows a department lacks.

- [ ] **Step 3: Run the tests**

Run: `node --test "Template Module/tests/"`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "Template Module/services/hubApi.js" "Template Module/components/HubNumbering.jsx" "Template Module/logic/serviceDocs.js" "Template Module/tests/serviceDocs.test.mjs"
git commit -m "Add library service calls and the Documents numbering row"
```

### Task 6: Settings screen

**Files:**
- Create: `Template Module/components/LibrarySettings.jsx`
- Modify: `Template Module/components/HubNumbering.jsx` (render it after `MasterTemplates`, passing `manage`)

**Interfaces:**
- Consumes: Task 5 calls; `readTags` from Task 2; `Panel`, `Button`, `FormModal`, `FilePick`, `DataTable`, `ErrorNote` from `@banking/components/shared`.

- [ ] **Step 1: Build the panel**

One row per template with company, folder, name, file name, upload date. Actions: Add, Replace file, Fee rows (label, AED, remarks, rate, USD rate), Retire. Upload runs `readTags` first and shows "This file has no fields, so it can only be downloaded" when `hasTags` is false. An invalid tag is refused by a trial render with empty data. Without `manage`, the panel is read-only.

- [ ] **Step 2: Check in the browser on a local build**

Expected: upload, replace, fee rows and retire each update the list, with no console errors.

- [ ] **Step 3: Commit**

```bash
git add "Template Module/components/LibrarySettings.jsx" "Template Module/components/HubNumbering.jsx"
git commit -m "Add Library Templates to Template Hub settings"
```

### Task 7: Fill screen and generated list

**Files:**
- Create: `Template Module/components/LibraryFill.jsx`
- Create: `Template Module/services/libraryGenerate.js`
- Modify: `Template Module/components/CompanyLibrary.jsx` (database list, Fill, generated list; remove `import.meta.glob`)
- Modify: `Business Setup Module/services/documents.js` (`fileQuote` guard)
- Test: `Template Module/tests/libraryGenerate.test.mjs`

**Interfaces:**
- Consumes: Tasks 2, 3 and 5; `renderDocx(buffer, data)`; `saveFile(doc, kind, blob, fileName)`; `fileNameFor(number, client)`.
- Produces: `generateLibraryDocument(input, deps) -> {doc, file?, error?}` and `retryLibraryDocument(doc, deps) -> {doc, file?, error?}`. `deps` holds `create, loadFile, render, save`, so tests use fakes.

- [ ] **Step 1: Write the failing tests**

```js
test("missing required field calls neither create nor render", ...)
test("unloadable template file calls no create, so no number is used", ...)
test("render failure returns the doc with its Ref and an error", ...)
test("upload failure returns the doc with its Ref and an error", ...)
test("retry renders with the document's own file_id and stored values, and makes no new row", ...)
test("template file is loaded before create", ...)
```

- [ ] **Step 2: Run them**

Run: `node --test "Template Module/tests/libraryGenerate.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `libraryGenerate.js`**

Order: check required, load file, create, render, save. Loading before create is what keeps a bad file from using a number.

- [ ] **Step 4: Run them**

Run: `node --test "Template Module/tests/libraryGenerate.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Build `LibraryFill.jsx` and update `CompanyLibrary.jsx`**

Follows the spec's Staff flow. Conflicts show both readings with a choice. OCR failure shows a note and leaves the form usable. **New from this** opens the form from a document's `field_values` and `lines`. Retry shows only when `storage_path` is empty and `created_by` is the current user; others see "File not saved". `kind` for `saveFile` is `setup_quote` for AB Capital; Ardentax passes the kind the Client Module accepts, confirmed with `grep -n "generated/" "Client Module"` during this step.

- [ ] **Step 6: Add the guard to `fileQuote`**

Throw `This document came from Company Library. Use Retry there.` when `doc.library_template` is set.

- [ ] **Step 7: Check in the browser**

Upload a scanned test ID (not a real client's), fill, generate, and open the Word file. Expected: OCR fills empty fields, typed values survive, Ref appears in the file, the row is in the generated list, and a forced upload failure shows Retry. No console errors.

- [ ] **Step 8: Commit**

```bash
git add "Template Module/components" "Template Module/services/libraryGenerate.js" "Template Module/tests/libraryGenerate.test.mjs" "Business Setup Module/services/documents.js"
git commit -m "Fill library templates, generate documents and list them"
```

### Task 8: Remove the public copies and document

**Files:**
- Delete: the six `Template Module/Template Docs/*/*/*.docx` files
- Modify: `Template Module/README.md`
- Modify: `Main Module/vite.config.js`, only if it references the deleted paths

- [ ] **Step 1: Delete the files and update the README**

README states where templates live, how to prepare and upload them, and that history still holds the old copies.

- [ ] **Step 2: Confirm the build carries no template**

Run: `npm run build` in `Main Module`, then search `dist` for `IFZA`, `Rakez`, `AE120400000372949069001`.
Expected: build succeeds, with no `.docx` for those templates and no matching text.

- [ ] **Step 3: Run every test**

Run: `node --test "Template Module/tests/"` and `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A "Template Module"
git commit -m "Remove library templates from the repository"
```

## Release (each step waits for the user)

1. Show the user all six filled files for layout review, and fix the script if needed.
2. With approval: apply `004_library_fill.sql` live, then confirm the storage policies exist.
3. The user uploads the six files in Settings and enters fee rows. This needs a build with the Settings screen, so run the local build against live for this step.
4. With approval: merge to `main`, then `npm run deploy:cloudflare` from a checkout matching `main`. Confirm abcrm and crm-abcapital serve the new build and that the old `IFZA` asset no longer loads.
5. Real test on both companies. Note the first Refs issued.
6. Tell the user the old copies remain in git history and in past `gh-pages` commits, and ask whether to rewrite them.
