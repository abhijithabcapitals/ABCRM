# ArdentTax (ASP) Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CRM tab that generates single Ardentax quotations and engagement letters as Word, PDF and an email with a Send button, numbered from the CRM database.

**Architecture:** React tab in `Template Module/ardentax/`. Pure logic computes the quote from one `details` object and edits the Word template's XML in the browser. A new `ardentax_documents` table and functions issue numbers through the existing `hub_next_number`. A new Edge Function sends mail.

**Tech Stack:** React 19, Vite, jszip, docx-preview, html2canvas, jsPDF, Supabase (Postgres, Storage, Deno Edge Functions), `node --test`, `deno test`, local PostgreSQL 18.

**Spec:** `Template Module/docs/2026-11-04-ardentax-asp-design.md`

## Global Constraints

- Work only in `D:\Abhijith Projects\CRM-ardentax`, branch `ardentax-asp`. Run `npm ci` in `Main Module` first.
- Quote format `Ardentax/{YYYY}/{MM}/ADTQ{SERIAL}`, letter format `Ardentax/{YYYY}/{MM}/ADTE{SERIAL}`, 3 digits, restart `never`.
- Department name: `ArdentTax (ASP)`. Company: `Ardentax`. Tab key: `ardentax`.
- Nothing touches live Supabase, live counters, the Cloudflare sites or `main` until Task 8, and each step there needs the user's approval.
- No real client data in the repo. It is treated as public. Fixtures use the fictional client `Sample Trading LLC`. Files from `Generated Quotes` are never committed.
- Never open or print anything under `Api Secrets/`, and never put a mail password in code, logs or the browser.
- Client documents carry no AI attribution in text, comments or file properties.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage named files only.
- Mail is sent only by the Send click. Automated tests never send real mail.

## Review Focus

1. Double click on Generate, or two browser tabs: one click uses one number. Task 3 tests `request_id`.
2. Client name with `&`, `<`, quotes, `/` or Arabic: valid Word file and a safe file name. Task 2 tests it.
3. Fee of blank, `0`, `Free`, or an old price: the same results as the macro. Task 2 tests it.
4. A PC without Aptos or Calibri: PDF stays readable and within the page count. Task 1 tests it.
5. Browser closed after the number was issued: document shows "File pending" and Generate again keeps the number; mail refuses to send it. Tasks 4 and 5 test it.

---

### Task 1: PDF test (gate)

Runs first. **If it does not pass, stop and report to the user. Do not start Task 2.**

Known risk: `docx-preview` does not calculate Word's page breaks. It honours explicit breaks and saved `lastRenderedPageBreak` marks. A filled template may need slicing at table-row boundaries in this module.

**Files:**
- Create: `Template Module/ardentax/logic/docxToPdf.js`
- Create: `Main Module/ardentax-dev.html`, `Main Module/src/ardentaxDev.jsx` (dev-only page; `vite build` does not include it)
- Modify: `Main Module/package.json` (`docx-preview`, `html2canvas`, `jspdf`), `Main Module/.gitignore` (`public/_ardentax_test/`), `.claude/launch.json`

**Interfaces:**
- Produces: `docxToPdf(docxBlob: Blob, opts?: { host?: HTMLElement }) => Promise<Blob>`. A4, one image per page, libraries lazy-loaded.

- [ ] **Step 1:** Copy `D:\Abhijith Projects\Quote Generator\Generated Quotes\Quotations\EMIRATES DEFENCE TECHNOLOGY\Ardentax_ASP_E-Invoicing_COMMERCIAL_PROPOSAL_EMIRATES DEFENCE TECHNOLOGY_1.docx` and `.pdf` to the git-ignored `Main Module/public/_ardentax_test/`.
- [ ] **Step 2:** Implement `docxToPdf`, and a dev page that loads the test file, runs it and offers the PDF. Add launch config `ardentax-dev` (`npm run dev` in `Main Module`).
- [ ] **Step 3:** Open it with `preview_start`, generate the PDF, and render every page of both PDFs to PNG in the scratchpad.
- [ ] **Step 4:** Check each criterion and record it in a table:
  - page count equals Word's PDF; no card or pricing row split
  - cover, logos and header correct
  - yellow highlight and strikethrough visible
  - fonts readable, A4
  - file under 5 MB
- [ ] **Step 5:** Repeat with Aptos and Calibri unavailable by forcing a fallback font in the render's CSS. If the page count changes, add a metric-compatible web font (Carlito for Calibri) and test again.
- [ ] **Step 6:** Show the user the side-by-side pages and results, and wait for their decision. Failure: stop, report options.
- [ ] **Step 7:** On pass, commit `docxToPdf.js`, the dev page, `package.json`, `package-lock.json`, `.gitignore`, `launch.json`, the spec and this plan. Delete `public/_ardentax_test/`.

### Task 2: Quote logic and Word filling

**Files:**
- Create: `Template Module/ardentax/logic/quoteModel.js`, `logic/fillDocx.js`
- Create: `Template Module/ardentax/templates/Ardentax_QUOTATION_TEMPLATE.docx`, `Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx` (byte copies; SHA-256 start `c9249df1b9bd` and `1b2759765f83`)
- Create: `Template Module/ardentax/tests/quoteModel.test.mjs`, `tests/fillDocx.test.mjs`, `tests/fixtures/totals.json`
- Reference: `D:\Abhijith Projects\Quote Generator\Source Code\QuoteGenerator.bas` (`Money`, `FeeLabel`, `Tokens`, `MakeQuote` lines 424-812, `SetFee`, `SetExclusions`); Quote sheet formulas in the workbook

**Interfaces:**
- Produces, `details` shape, used everywhere and stored as jsonb:
  `{ docType: "quote"|"letter", quoteType: "Standard"|"Custom", date, client: { legal, letterName, short, poc, pocDesig, phone, email, city, address, signName, signDesig, erp }, tiers: { E|S|C: { entity, docs, year, month, legal } }, selected: "Emerging"|"Established"|"Corporate", trns, coverage, options: { showOptions, paidTrns, trnFee, overage, buyout, oneTimeNote }, rows: { ONB|SUP|FULL|GAP|TRN|ANN|ENT|CMP|X1|X2: { inc, title, old, fee, note, type, desc } }, custom: { volume, coverage, items: [{ title, desc, fee, note, type }] } }`
- Produces: `defaultDetails(today): details`, with the workbook's default titles, types, notes and descriptions, including X1 = Annual Maintenance Contract and X2 = Training Employees.
- Produces: `computeQuote(details): { volume, annual, perMonth, oneTimeAll, oneTime, annualTotal, year1, opt1Total, opt2Total, renewal, rate, totalText, totalDesc, oneTimeNote, derivedRows }`
- Produces: `quoteChecks(details, totals): string[]`, `feeLabel(fee, type): string`, `money(n): string`, `mailTokens(text, details, totals): string`, `fileNameFor(number, short, version): string`
- Produces: `fillDocx(templateBytes: Uint8Array, details, totals, reference: string, xml: { parse, serialize }): Promise<Uint8Array>`. It throws `Error("Template fields not filled: ...")` if `{{` remains. `xml` is `DOMParser` / `XMLSerializer` in the browser and `@xmldom/xmldom` from `Main Module/node_modules` in tests (add as a devDependency if not already resolvable).

- [ ] **Step 1: Write failing `quoteModel` tests.** Assertions:
  - Workbook case (Established, 3,600 docs, 4,199, ONB fee 1,500): `oneTime` 1500, `year1` 5699, `perMonth` 300, `totalText` `5,699 AED`, `totalDesc` `Year 1: one-time AED 1,500 + annual AED 4,199`, default overage `4199/3600+0.08`.
  - Overage default uses the selected package (Corporate differs from Established).
  - Options on: `totalText` `TBD`; `totalDesc` starts `Upon client preference: Option 1 - AED`; integration titles start `Option #1: ` and `Option #2: `.
  - `feeLabel`: blank → `""`, `0` → `Included`, `1500` → `1,500 AED`, `1500.5` → `1,500.50 AED`, `Free` → `Free`, type `Included` → `Included`. `Free` counts 0 in totals.
  - Each of the 8 Quote checks and 2 Custom checks fires with its exact workbook wording.
  - `mailTokens` replaces all 9 tokens; a blank POC gives `Sir/Madam`; Custom gives `custom` for `{TIER}`.
  - `fileNameFor("Ardentax/2026/11/ADTQ001", "A&B / Co", 2)` is `Ardentax-2026-11-ADTQ001 AB Co v2.docx`.
  - Same cases in `fixtures/totals.json` as `[{ details, expect: { one_time, annual, year1 } }]`, reused by Task 3.
- [ ] **Step 2:** Run `node --test "Template Module/ardentax/tests/"`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `quoteModel.js`. Run tests. Expected: PASS.
- [ ] **Step 4: Write failing `fillDocx` tests**, on both templates with the fixture client. Read result with jszip. Assertions:
  - No `{{` left. Client `Sample & <Trading> "LLC" شركة` round-trips, and the XML parses.
  - Blank POC, phone, email and address drop their paragraphs. Zero overage drops its paragraph. Blank one-time note drops its paragraph.
  - Selected card: no `w:strike`, `w:highlight` yellow, label `(Most Popular & Selected Package)`. Other cards: `w:strike`, no highlight, with colours from the template's column 1 (row 10 uses row 9's). Selected colours come from column 3.
  - Empty unselected card: its column is gone from every row and from `w:tblGrid`.
  - Table 3 row count matches included rows; total row last; old price struck through; `Included` has no note.
  - Custom: table 2 removed, `The service is UAE FTA compliant`, ONB, SUP and FULL rows dropped, at most 7 items.
  - Exclusions paragraph matches `SetExclusions` for a covered and an uncovered list, with the listed terms bold.
  - `mailto:` link updated. `docProps/core.xml` creator is `Ardentax IT Solutions – FZCO`, comments empty.
  - Images and `word/header1.xml` bytes unchanged.
- [ ] **Step 5:** Run tests. Expected: FAIL.
- [ ] **Step 6:** Implement `fillDocx.js`. Table numbers as in the macro: `tbl[1]` cards, `tbl[2]` pricing. Pricing rows are k+2 in order `ONB SUP FULL GAP TRN ANN ENT CMP X1 X2`; row 12 is Total. `{{...}}` always sit in one text run, and a test asserts that for both templates.
- [ ] **Step 7:** Run tests. Expected: PASS. Commit.

### Task 3: Database

**Files:**
- Create: `Database Module/ArdentTax Base/migrations/001_ardentax.sql`, `rollback/001_rollback.sql`, `README.md`
- Create: `Database Module/ArdentTax Base/tests/run-local.sh`, `000_as.sql`, `010_ardentax_test.sql`, `020_concurrency.sh`
- Reference: `Business Setup Base/tests/run-local.sh` and `020_concurrency.sh` (pattern, BASE list, `PRIVATE_ROOT`); `Accounting Base/migrations/003_payments_followups.sql:68-84` (restrictive storage policy, latest voucher `source` check)

**Interfaces:**
- Consumes: `fixtures/totals.json`, `hub_next_number`, `hub_serial_of`, `admin_is()`, `my_tabs()`.
- Produces SQL:
  - `ardentax_can() returns boolean`: `admin_is() or 'ardentax' = any(my_tabs())`
  - `ardentax_totals(details jsonb) returns jsonb`: `{one_time, annual, year1}`
  - `ardentax_document_create(p jsonb) returns ardentax_documents`; `p`: `{request_id, doc_type, source_quote_id?, details, totals, mail_to, mail_subject, mail_body}`
  - `ardentax_document_revise(p_id uuid, p jsonb) returns ardentax_documents`
  - `ardentax_document_attach(p_id uuid, p_word text, p_pdf text) returns void`
  - `ardentax_mail_update(p_id uuid, p_to text, p_cc text, p_subject text, p_body text, p_attach_word boolean) returns void`
- Table: spec section 4 columns, plus `request_id uuid unique`, `mail_cc`, `mail_attach_word boolean default false`, and `unique (document_number, version)`. All function writes go through security definer; `ardentax_mail_sent(p_id uuid, p_user uuid) returns timestamptz` is service-role only.

- [ ] **Step 1:** Write `run-local.sh`: same throwaway cluster and BASE list as Business Setup's, plus its migrations (they replace `hub_next_number`) and Accounting 003, then `001_ardentax.sql` twice for idempotence, then the tests.
- [ ] **Step 2: Write failing tests** in `010_ardentax_test.sql`:
  - First quote `Ardentax/YYYY/MM/ADTQ001`, next `ADTQ002`, first letter `ADTE001`, with serials 1, 2, 1.
  - Same `request_id` twice returns the same row and uses no number.
  - Revise keeps the number and sets version 2 with `revision_of`.
  - Second letter for a quote refused; standalone letter allowed.
  - Every fixture's `ardentax_totals` equals its `expect`. Wrong `totals` raises.
  - A user without the tab is refused on create, revise, attach, mail update and table select; a user with the tab succeeds.
  - Voucher Register gets `source='ardentax'`, `company='Ardentax'`, the right type, version and paths. A second version adds a row.
  - Numbering page: `hub_numbering_status` includes `ArdentTax (ASP)` quote and letter.
  - Storage: without the tab, the restrictive policy hides `ArdentTax (ASP)/...` objects and blocks inserts there; other hub paths are unaffected.
  - Existing Template Hub and Business Setup quote numbers still work.
- [ ] **Step 3:** Write `020_concurrency.sh`: 20 parallel creates give 20 distinct consecutive serials.
- [ ] **Step 4:** Run `bash "Database Module/ArdentTax Base/tests/run-local.sh"`. Expected: FAIL at the missing migration.
- [ ] **Step 5:** Implement the migration:
  - Department and numbering rows, without overwriting existing values.
  - Table and RLS. `ardentax_totals` matches `computeQuote`.
  - Letter from a quote copies `details` with `docType` changed, when `details` is not supplied.
  - Voucher `source` check = the latest list + `ardentax`, read policy includes it like `hub`, trigger added.
  - `hub_docs_ardentax` restrictive policies for select and insert.
  - `hub_settings.ardentax_mail` `{ subject, body, signature_html }`, using the Email sheet's subject and C11 text and `Email Signature/signature.htm` verbatim, with `on conflict do nothing`.
- [ ] **Step 6:** Write rollback that removes everything and restores the voucher check and policy. It must refuse if `ardentax_documents` has rows, unless told otherwise. Add a rollback check to `run-local.sh`.
- [ ] **Step 7:** Run. Expected: all `ok`, exit 0. Commit.

### Task 4: Tab, form and generation

**Files:**
- Create: `Template Module/ardentax/services/ardentaxApi.js`, `services/generate.js`, `services/fakeApi.js` (dev only)
- Create: `Template Module/ardentax/components/ArdentTaxTab.jsx`, `QuoteForm.jsx`, `Register.jsx`, `ardentax.css`
- Create: `Template Module/ardentax/tests/generate.test.mjs`
- Modify: `Main Module/src/tabs.js` (add `{ key: "ardentax", label: "ArdentTax (ASP)" }`), `Main Module/tests/tabs.test.mjs`, `Main Module/src/App.jsx` (lazy import, view line near `:547`, sidebar item near the `quotations` entry), `Main Module/src/ardentaxDev.jsx`
- Modify: `Template Module/logic/serviceDocs.js` (`NUMBERING_DEPARTMENTS = [...DEPARTMENTS, "ArdentTax (ASP)"]`), `components/HubNumbering.jsx` (uses it), `components/VoucherRegister.jsx` and `services/hubApi.js` (`needsPcCopy` and `savePendingToPc` skip `source === "ardentax"`)

**Interfaces:**
- Consumes: Task 1 `docxToPdf`; Task 2 logic; Task 3 RPCs.
- Produces: `generateDocument(api, { details, requestId }, deps) => Promise<{ doc, wordBlob, pdfBlob }>`, `regenerate(api, doc, deps)`, `reviseDocument(api, doc, details, deps)`, `makeLetter(api, quote, deps)`, where `deps` is `{ xml, toPdf }`. `api` is `ardentaxApi` or `fakeApi`, with one interface: `create, revise, attach, list, updateMail, upload, signedUrl, sendMail, mailSettings, loadTemplate`.
- Default export `ArdentTaxTab({ profile })`. The tab reuses `Panel`, `Button`, `DataTable`, `ErrorNote`, `Spinner`, `useLoad` from `@banking/components/shared` and `useClientLookup`, `ClientLists`, `applyClient` for the client details.

- [ ] **Step 1: Write failing `generate` tests** with a fake `api`:
  - Order: trial `fillDocx` → `create` → final fill with the issued number → PDF → upload → `attach`.
  - Trial failure calls no `create`, so no number is used.
  - PDF or upload failure after `create`: error returned, no `attach`; `regenerate` reuses the number and never calls `create`.
  - `generateDocument` with the same `requestId` twice sends the same id.
  - Storage paths start `ArdentTax (ASP)/<id>/`; file names come from `fileNameFor`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement services. The tab passes the browser `xml` and `docxToPdf` as `deps`; tests pass `@xmldom/xmldom` and a stub, so they stay in Node. Run. Expected: PASS.
- [ ] **Step 4:** Add a test in `tabs.test.mjs` that `ardentax` is grantable and `resolveView` blocks members without it. Implement the wiring. Run `node --test "Main Module/tests/"`. Expected: PASS.
- [ ] **Step 5:** Build form and register per spec section 3:
  - Generate button disabled while running, with a new `requestId` per form change.
  - Checks shown in red above it; the "two long rows" check warns but does not block, while empty required fields block.
  - Register shows `File pending` with Generate again when `word_path` is null, plus Make Engagement Letter (quotes without a letter) and Revise (loads saved `details`).
  - Quote date defaults to today in Asia/Dubai.
- [ ] **Step 6:** Mount the tab in `ardentaxDev.jsx` with `fakeApi`. Using the preview, generate Standard, Custom and Options quotes, a letter from a quote, a standalone letter and a revision. Force an upload failure to see `File pending` recover. Check console errors and screenshots, and that the real numbers aren't touched: `fakeApi` makes no network calls.
- [ ] **Step 7:** Run `npm run build` and `npm run lint` in `Main Module`. Expected: success, `ardentax-dev` absent from `dist`, PDF libraries in lazy chunks only. Commit.

### Task 5: Mail function

**Files:**
- Create: `Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/index.ts`, `mime.ts`, `mime_test.ts`, `rules.ts`, `rules_test.ts`
- Reference, not modified: `../ceo-mail-reply/smtp.ts` (import `SmtpClient`), `../ceo-mail-reply/index.ts:86-100` (`credential_get`, `MAIL_PASSWORD_<ADDRESS>`), `:454-469` (Sent copy), `../ceo-mail-sync/imap.ts`

**Interfaces:**
- Produces: POST `{ document_id: uuid, resend?: boolean }` → `{ ok: true, sent_at, warnings: string[] }` or `{ error }` with status 400/403/409/502.
- Produces: `buildMail({ from, fromName, to, cc, subject, html, text, inline: [{ cid, name, type, bytes }], attachments: [{ name, type, bytes }] }): { messageId, raw: Uint8Array }`.
- Produces: `sendRefusal(doc, { resend }): string | null`; `parseRecipients(s): string[]`.
- Consumes: `hub_settings.ardentax_mail`, `ardentax_mail_sent`, banner at `ArdentTax (ASP)/assets/banner.png` with cid `ardentax-banner` (as in `signature.htm`).

- [ ] **Step 1: Write failing tests:**
  - `buildMail` gives `multipart/mixed` > `multipart/related` > `multipart/alternative`.
  - Correct base64 for the PDF, filename with non-ASCII encoded.
  - Newlines in subject or recipient can't add a header.
  - `sendRefusal`: no `pdf_path` refuses, no recipient refuses, already sent without `resend` gives the "already sent" refusal, already sent with `resend` passes.
  - `parseRecipients` rejects invalid addresses and splits on `,` and `;`.
- [ ] **Step 2:** Run `deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/"`. Expected: FAIL.
- [ ] **Step 3:** Implement `mime.ts`, `rules.ts`. Run. Expected: PASS.
- [ ] **Step 4:** Implement `index.ts`:
  - Verify the JWT, then check `ardentax_can()` with the caller's token.
  - Load document and files with the service role.
  - Send from `bharat@ardentaxit.tax`, using `mailboxes` and the same credential lookup.
  - Write `ardentax_mail_sent` only after SMTP accepts. A failed Sent copy is a warning, not a failure.
  - Log no body, recipient list or password.
- [ ] **Step 5:** Run `deno check` on `index.ts`. Expected: no errors. Commit.

### Task 6: Mail screen

**Files:**
- Create: `Template Module/ardentax/components/MailPanel.jsx`
- Modify: `Template Module/ardentax/components/Register.jsx`, `services/ardentaxApi.js`, `services/fakeApi.js`, `services/generate.js`
- Test: `Template Module/ardentax/tests/generate.test.mjs`

**Interfaces:**
- Consumes: `updateMail`, `sendMail(id, resend)`, `mailTokens`, `mailSettings`.
- Produces: `<MailPanel doc api onChanged />`.

- [ ] **Step 1:** Add failing tests: generation fills `mail_to` from the POC email and subject and body with tokens replaced; a revision re-creates the draft from settings.
- [ ] **Step 2:** Run. Expected: FAIL. Implement. Run. Expected: PASS.
- [ ] **Step 3:** Build the panel:
  - To, CC, subject, body, "also attach Word", signature preview, Save.
  - Send opens a confirmation listing recipient, CC, subject and attachment names.
  - Sent state shows who and when. A second send needs a second confirmation saying it was already sent.
  - Send disabled and explained while `File pending`.
- [ ] **Step 4:** Check in the dev page with `fakeApi`: edit, save, send, resend, failed send leaves it unsent. Commit.

### Task 7: Whole-branch check

**Files:** none new, unless a fix is needed.

- [ ] **Step 1:** Run all: `node --test "Template Module/tests/" "Template Module/ardentax/tests/" "Main Module/tests/"`, `deno test` on the function folder, `run-local.sh`, `npm run build`, `npm run lint`. Expected: all pass. Existing failures are reported, not hidden.
- [ ] **Step 2:** In the dev page, fill the Emirates Defence Technology figures from the workbook with the fixture client's details. Compare Word and PDF with the workbook-made files page by page. Convert the Word file with Word on this PC if it is scriptable. Show the user the comparison.
- [ ] **Step 3:** Write `Template Module/ardentax/README.md`, a section in `Template Module/README.md`, and the Database Module README entry. Commit.
- [ ] **Step 4:** Whole-branch code review. Fix findings. Report results to the user.

This does not prove the real database path through a browser, since no local Supabase API exists here. SQL tests cover the database and `fakeApi` covers the screen; the first live quote in Task 8 is the first full join.

### Task 8: Release (each step needs the user's explicit approval)

- [ ] **Step 1:** Ask the user about spec section 11: signature wording, who may send, Voucher Register visibility. Apply answers.
- [ ] **Step 2:** Confirm the mailbox password was changed and its stored credential updated, because it was exposed in a session log on 2026-11-04.
- [ ] **Step 3 (approval):** Merge `origin/main` into the branch and repeat Task 7 Step 1. Apply `001_ardentax.sql` live. Verify with read-only queries: counters absent or at 0, `hub_numbering_status` shows both formats.
- [ ] **Step 4 (approval):** Upload the banner to `hub-documents`. Deploy `ardentax-mail-send` with JWT verification on, through the CEO Agent folder's Supabase CLI. Test only a refusal case first (document that doesn't exist).
- [ ] **Step 5 (approval):** Merge to `main` and deploy with `npm run deploy:cloudflare` to `abcrm` and `crm-abcapital.pages.dev`. Confirm both serve the new tab.
- [ ] **Step 6 (approval):** The user grants the tab and issues the first real quote, `ADTQ001`. Check the database row, the Voucher Register, both files, and a mail to an address the user names.
- [ ] **Step 7:** Tell the user to stop using the workbook for new documents. Update the project memory.
