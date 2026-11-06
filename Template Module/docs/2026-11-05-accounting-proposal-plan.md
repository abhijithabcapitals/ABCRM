# Accounting Quote and Agreement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Service Documents > Accounting generates a multi-option quote (`ACQ`), then the agreement (`ACE`) from the accepted option, releases it with signature and stamp only after approval, keeps Word and PDF, opens the PDF on View, copies both to the client's OneDrive folder from this PC, and mails only the PDF.

**Architecture:** Both documents are ordinary `hub_documents` rows, with their content in `field_values` and the current option mirrored into `lines`. New pure logic, services and screens sit beside the old form. The signature image sits behind a restrictive storage policy.

**Tech Stack:** React 19, Supabase Postgres and Edge Functions, docxtemplater, JSZip, existing `docxToPdf`, FastAPI Client Module, `node --test`, local PostgreSQL 18 runner, pytest, Deno test.

**Spec:** `Template Module/docs/2026-11-05-accounting-proposal-design.md`

**Worktree:** `D:\Abhijith Projects\CRM-accounting-proposal`, branch `accounting-proposal`, base `main` at b58a28f. All paths are relative to it.

## Global Constraints

- Quote: `doc_type` `quote`, department `Accounting`, `library_template` `AB Capital/Accounting Quote`, `vat_mode` `exclusive`, `vat_amount` 0. Number `hub_next_number('Accounting', 'quote')`.
- Agreement: `doc_type` `letter`, department `Accounting`, `library_template` `AB Capital/Accounting Agreement`, `parent_id` the quote. Number `hub_next_number('Accounting', 'letter')`.
- Fee bases, exact: `month`, `quarter`, `year`, `once`, `included`, `separate`, `na`. Labels: Per month, Per quarter, Per year, One-time, Included, Charged separately, NA. Printed words for the last three: "Included in the above mentioned fees", "Will be charged separately", "NA".
- Never add different bases together. Never add options together.
- `storage_path` is the PDF and `word_path` the Word file. Only the PDF is ever attached to mail.
- Create, accept, agreement, OneDrive, signed and send: any signed-in user, matching `hub_document_create` for Accounting (`auth.uid()` not null). Send also needs approval on an agreement.
- Approve: approver list, or `role = 'admin'` while the list is empty. An approver cannot approve an agreement they created unless they are the only approver.
- Packages and standard notes: `hub_is_admin()`. Approver list and signature image: `role = 'admin'` only.
- Signature image path prefix: `accounting-signature/`. It is never committed, and non-approvers cannot read it.
- Sender `accounts@abcapital.ae`. Storage paths `Accounting/<doc.id>/<uuid>.pdf` and `.docx`.
- OneDrive root: `C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL`. Target `Accounting\<Client name - code>\Proposals`, or `<Client name>` with no code.
- **The repo is public.** No prices, bank details, client names, signatories or old files are committed. Test amounts are invented. Seeds stay in `D:\Abhijith Projects\CRM Private`.
- Test client name `TEST CLIENT - DO NOT USE`.
- No live change (SQL, function deploy, merge, deploy, real mail) without the user's approval for that step. Never edit the old form's output.
- Do not run `npm run build` while the dev server runs: it kills it with EBUSY.

## Shared data shape

```js
field_values.quote = {
  accepted_option: null,
  options: [{
    package_key, name, description, notes: [string],
    services: [{ name, basis, amount, subs: [{ name, amount }] }], // amount null for included, separate, na
  }],
  shared: { scope: [string], payment: [string], notes: [string] },
}
field_values.agreement = {
  accepted_option, address: [string], attention, signatory_name, signatory_title, notices_email,
  scope_sentence, schedule1: [{ name, description }], scope_notes: [string],
  schedule2: [{ description, fee }], billing, // 'monthly' | 'quarterly' | 'commencement'
  billing_notes: [string], effective_months, notice_days,
}
```

`hub_settings` key `accounting_proposal_defaults`: `{ approvers: [uuid], signature_path: null, signature_uploaded_at: null, signature_uploaded_by: null, standard: { scope_notes: [string], fee_notes: [string], please_note: [string], billing: { monthly: string, quarterly: string, commencement: string } }, contact: { name, phone, email, website } }`. Standard wording comes from the old files with the spec's wording fixes and holds no prices.

## Review Focus

1. **Old route on a new quote:** the next-step button or `hub_document_create` must not make a plain letter on an Accounting quote. Tests in Tasks 1 and 10.
2. **Job screen embeds `ServiceDesk`:** it must keep the old form and never list the new documents. Test in Task 10.
3. **Editing an approved agreement, or approving while another tab edits:** approval clears, and a stale approval cannot attach old files. Test in Task 1.
4. **A quote where every service is Included or NA:** no blank totals, `total_amount` 0, and the register label reads sensibly. Test in Task 2.
5. **Client names with `&`, `/`, `'` or Arabic, and long multi-line addresses:** valid Word file, safe folder names. Tests in Tasks 4 and 6.

---

### Task 1: Database and signature protection

**Files:**
- Create: `Database Module/Template Hub Base/migrations/008_accounting_proposals.sql`, `Database Module/Template Hub Base/rollback/008_rollback.sql`, `Database Module/Template Hub Base/tests/050_accounting_proposal_test.sql`
- Modify: `Database Module/Template Hub Base/tests/run-local.sh`, `Database Module/Template Hub Base/README.md`
- Add to the commit: the spec and this plan

**Interfaces:**
- Produces:
  - columns `word_path`, `onedrive_path`, `onedrive_saved_at`, `mail_sent_at`, `mail_sent_by`, `mail_sent_to`, `approved_by`, `approved_at` on `hub_documents`, all `add column if not exists`
  - table `hub_accounting_packages`: `package_key` pk, `name`, `description`, `services` jsonb, `notes` jsonb, `schedule1` jsonb, `active`, `updated_at`, `updated_by`
  - `hub_acct_quote_create(p jsonb)`: keys `client_id, client_name, contact_name, contact_email, contact_phone, quote`
  - `hub_acct_accept(p_quote uuid, p_option int)`
  - `hub_acct_agreement_create(p jsonb)`: keys `quote_id, agreement`
  - `hub_acct_agreement_update(p_id uuid, p_agreement jsonb)`
  - `hub_acct_can_approve() returns boolean`
  - `hub_acct_approve(p_id uuid, p_pdf text, p_word text, p_seen timestamptz)`
  - `hub_acct_attach(p_id uuid, p_pdf text, p_word text)`, `hub_acct_saved(p_id uuid, p_path text)`, `hub_acct_signed(p_id uuid, p_date date, p_path text)`, `hub_acct_can_send(p_id uuid) returns boolean`
  - `hub_acct_package_save(p jsonb)`, `hub_acct_defaults_save(p jsonb)`, `hub_acct_admin_save(p jsonb)` (approvers and signature)
  - each returning `hub_documents` where it changes a document, and `updated_at`-style check through `p_seen`, compared with a new column `agreement_changed_at`

- [ ] **Step 1: Write failing tests**

Using the helpers in `030_letter_test.sql`, assert:
- `numbers`: a new quote between two old `hub_document_create` Accounting quotes takes the next `ACQ`, and the agreement the next `ACE`. No gaps or repeats.
- `mirrors option 1`: two options give `lines` and `services` from Option 1. `total_amount` is the monthly total; with no monthly, the first of quarter, year, once; 0 when no service has an amount.
- `no cross sums`: monthly 100 plus once 500 gives `total_amount` 100.
- `rejects`: no options, blank package name, unknown basis, `month` with no amount, `included` with an amount, negative amount, sub services disagreeing with the amount, bad email, blank contact. Each gives a named message and takes no number.
- `accept`: sets `accepted_option`, `status` `accepted`, `status_at`, `status_by`, and re-mirrors `lines`, `services`, `total_amount` to that option. Out-of-range option raises.
- `agreement needs acceptance`: `hub_acct_agreement_create` on an unaccepted quote raises. A second agreement on the same quote raises.
- `letter guard`: `hub_document_create({doc_type:'letter', parent_id:<acct quote>})` raises `Use the Accounting agreement`. Letters on old Accounting quotes still work.
- `approve rights`: list member passes. Non-member fails. Empty list: only `role = 'admin'` passes, and a manager who is a Hub admin fails.
- `self approval`: creator fails when another approver exists, and passes when sole approver.
- `no image`: approve with no `signature_path` raises `Upload the signature first`.
- `stale approval`: `p_seen` older than `agreement_changed_at` raises `The agreement changed`, and nothing is recorded.
- `edit clears`: `hub_acct_agreement_update` clears `approved_by` and `approved_at`, and sets `agreement_changed_at`. Old paths are pushed to `field_values.file_history`.
- `can send`: quote with a PDF true; quote without false; unapproved agreement false; approved agreement true.
- `admin only`: a Hub-admin manager fails on `hub_acct_admin_save`, and passes on `hub_acct_package_save`.
- `storage policy`: as a non-approver, select on `storage.objects` under `accounting-signature/` returns 0 rows, and other `hub-documents` paths remain readable. Insert under that prefix by a non-admin fails. As an approver, it returns the row.
- Migration runs twice, and rollback removes all of it and keeps old quotes.

- [ ] **Step 2: Add the files to `run-local.sh` and run**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: FAIL, `hub_acct_quote_create` does not exist.

- [ ] **Step 3: Write the migration and rollback**

Security definer with `set search_path = public, pg_temp` and grants as in `007_work_types.sql`. Storage: restrictive select and insert policies modelled on `hub_docs_accounting_receipts` in `Database Module/Accounting Base/migrations/003_payments_followups.sql`, inside the `storage.buckets` guard. Letter guard: a `before insert` trigger on `hub_documents`. Use `library_template = 'AB Capital/Accounting Quote'` on the parent, and require `new.library_template = 'AB Capital/Accounting Agreement'`.

- [ ] **Step 4: Run tests**

Run: `bash "Database Module/Template Hub Base/tests/run-local.sh"`
Expected: exit 0, no failed checks.

- [ ] **Step 5: Commit**

```bash
git add "Database Module/Template Hub Base" "Template Module/docs/2026-11-05-accounting-proposal-design.md" "Template Module/docs/2026-11-05-accounting-proposal-plan.md"
git commit -m "Add Accounting quote and agreement records with protected signature"
```

### Task 2: Quote model

**Files:**
- Create: `Template Module/logic/accountingQuote.js`, `Template Module/tests/accountingQuote.test.mjs`

**Interfaces:**
- Produces:
  - `BASES`: ordered array of `{ key, label, printed, priced }`
  - `blankOption()`, `optionFromPackage(pkg)`
  - `serviceAmount(service): number | null`
  - `totalsByBasis(option): [{ basis, label, total }]`, only priced bases present
  - `registerAmount(option): { amount, basis }`, `registerLabel(doc): string`
  - `checkQuote(form, quote): string | null`, `toQuotePayload(form, quote, clientId): object`
  - `isAccountingQuote(doc)`, `isAccountingAgreement(doc)`
  - `quoteContext(doc, settings): object`, the data for the quote template

- [ ] **Step 1: Write failing tests**

Invented amounts only.
- `totalsByBasis` with monthly 100, monthly with subs 30 and 20, and once 500 returns month 150 and once 500, and no sum.
- `serviceAmount` of an `included` service is null, and subs sum correctly.
- `registerLabel`: "AED 150 per month (Option 1 of 2)", "AED 500 one-time", and for all-included "No fixed fee (Option 1 of 1)".
- `checkQuote` names the problem for: no options, blank name, month with blank amount, `-1`, `abc`, a service with typed amount and subs, bad email. `toQuotePayload` turns `1,000` into 1000.
- `quoteContext`: `show_option_heading` false with one option, true with two; sub rows flagged; no-price bases print their exact words; no key holds a sum across options or bases; date is `dd/mm/yyyy` in Asia/Dubai.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/accountingQuote.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `accountingQuote.js`**

Bank from `settings.company.bank`, contact from `settings.accounting_proposal_defaults.contact`.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test "Template Module/tests/accountingQuote.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/logic/accountingQuote.js" "Template Module/tests/accountingQuote.test.mjs"
git commit -m "Add the Accounting quote calculations and form rules"
```

### Task 3: Agreement model

**Files:**
- Create: `Template Module/logic/accountingAgreement.js`, `Template Module/tests/accountingAgreement.test.mjs`

**Interfaces:**
- Consumes: `BASES`, `serviceAmount`.
- Produces: `agreementFromQuote(quoteDoc, pkg, defaults): Agreement`, `feeWording(service, startMonth): string`, `scopeSentence(names): string`, `checkAgreement(agreement): string | null`, `agreementContext(doc, settings, signed: boolean): object`.

- [ ] **Step 1: Write failing tests**

- `feeWording`: month 100 with start "January 2030" gives `AED 100/- + VAT per month starting from the month of January 2030`; quarter and year use "per quarter" and "per year"; once gives `AED 500/- + VAT`; included, separate and na give their exact printed words.
- `scopeSentence(["Accounting and Book-Keeping"])` gives "...relating to Accounting and Book-Keeping."; three names use commas and "and".
- `agreementFromQuote` uses `accepted_option`, not Option 1, and throws when it is null. Schedule 1 takes descriptions from the package, blank when absent. A service with subs gives one Schedule 2 row plus indented sub rows.
- `checkAgreement` names: no address, no signatory name, no designation, bad notices email, empty schedule, effective months 0.
- `agreementContext`: `signed` false gives `draft_mark` true and `has_signature` false; `signed` true the reverse. Scope notes print only if filled. Billing notes are chosen by `billing`. `effective_months` and `notice_days` appear in the period text. Default attention is "The Management". Date is `dd-Month-yyyy`, as the old files.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/accountingAgreement.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `accountingAgreement.js`**

- [ ] **Step 4: Run to verify it passes**

Run: `node --test "Template Module/tests/accountingAgreement.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/logic/accountingAgreement.js" "Template Module/tests/accountingAgreement.test.mjs"
git commit -m "Add the Accounting agreement content rules"
```

### Task 4: Word templates and render

**Files:**
- Create: `Template Module/scripts/build_accounting_templates.py`, `Template Module/templates/AB_Capital_Accounting_Quote_Template.docx`, `Template Module/templates/AB_Capital_Accounting_Agreement_Template.docx`, `Template Module/logic/accountingDocx.js`, `Template Module/tests/accountingDocx.test.mjs`

**Interfaces:**
- Consumes: `quoteContext`, `agreementContext`.
- Produces: `renderAccountingDoc(templateBuffer, context, signature, deps): Promise<Blob>`, with `signature = { bytes, type, width, height } | null` and `deps = { PizZip, Docxtemplater }`.

- [ ] **Step 1: Write failing tests**

Using the real templates and JSZip:
- `quote one and two options`: no `{` tags left, heading only with two, page break before Option 2, shared sections once.
- `agreement draft`: the "Draft, not approved" mark and a blank line, no `w:drawing` in the signature cell, and no signature media.
- `agreement signed`: signature media and relationship present, aspect ratio kept, draft mark gone.
- `signed but null image`: throws `Signature image is missing`, rather than issuing an unsigned "approved" file.
- `escapes`: a client of `A & "B" <C/D>` and an address of 6 lines produce well-formed XML.
- `no secrets in templates`: template XML has no match for `/AE\d{10,}/`, `/\b\d{10,}\b/` or `/AED\s*\d/`, and each template's media are only header logos under 15 KB each.
- `wording fixes`: agreement has "compliant" and no "complaint", and "Schedule 1: Scope of Services", with no "Schedule I".

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/accountingDocx.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the builder and build both templates**

`python "Template Module/scripts/build_accounting_templates.py" "<path to the private source proposal, the one with no signature image>"`. That source has no signature image. The script keeps its header, footer and styles, replaces the whole body with fixed text and tags, and stops if the source holds an image over 15 KB. Fixed text comes from the source's generic sections. The quote body follows the costing style of the old Business Setup layout: title bar, Particulars, Basis and AED columns. Raw tags: `{@signature_xml}`, `{@page_break}`.

- [ ] **Step 4: Check no client details in the templates**

For each of the 3 old files' client and signatory names, typed in the shell and not saved: `unzip -p "<template>" word/document.xml | grep -c -i "<name>"`.
Expected: 0 for each.

- [ ] **Step 5: Implement `renderAccountingDoc`**

docxtemplater with `{ paragraphLoop: true, linebreaks: true, nullGetter: () => "" }`, then a JSZip step adds media, relationship and content type.

- [ ] **Step 6: Run to verify it passes**

Run: `node --test "Template Module/tests/accountingDocx.test.mjs"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "Template Module/scripts/build_accounting_templates.py" "Template Module/templates/AB_Capital_Accounting_Quote_Template.docx" "Template Module/templates/AB_Capital_Accounting_Agreement_Template.docx" "Template Module/logic/accountingDocx.js" "Template Module/tests/accountingDocx.test.mjs"
git commit -m "Add the Accounting Word templates and render step"
```

### Task 5: Generate, approve and retry services

**Files:**
- Create: `Template Module/services/accountingGenerate.js`, `Template Module/services/accountingApi.js`, `Template Module/tests/accountingGenerate.test.mjs`

**Interfaces:**
- Consumes: Tasks 1 to 4.
- Produces:
  - `generateQuote(input, deps)`, `generateAgreement(input, deps)`, `retryDocument(doc, deps)`: return `{ doc, wordBlob, pdfBlob, onedrive } | { error } | { doc, error }`
  - `approveAgreement(doc, deps): Promise<{ doc } | { error }>`
  - `editAgreement(doc, agreement, deps)`, `saveToOneDrive(doc, deps)`
  - `deps = { check, create, loadTemplate, loadSignature, render, toPdf, upload(doc, blob, ext), attach, approve, update, saveLocal, markSaved, createMail }`
  - `accountingApi.js`: `loadPackages()`, `savePackage(p)`, `saveDefaults(p)`, `saveAdmin(p)`, `createQuote(p)`, `acceptOption(id, i)`, `createAgreement(p)`, `updateAgreement(id, a)`, `approveDoc(id, pdf, word, seen)`, `attachDoc(id, pdf, word)`, `markSaved(id, path)`, `recordSigned(id, date, file)`, `saveFolder(doc, wordBlob, pdfBlob)`, `sendDoc(id, resend)`, `openWord(path)`, `canApprove()`. PDF uploads use `contentType: "application/pdf"`.

- [ ] **Step 1: Write failing tests with fake deps**

- `quote order`: check, trial render, create, render, toPdf, upload pdf, upload docx, attach, saveLocal, markSaved, createMail.
- `bad template takes no number`; `check fails` calls no `create`.
- `pdf fails after number`: returns `{ doc, error }`; `retryDocument` rebuilds from `field_values` and takes no number.
- `client module off`: succeeds with `onedrive: null`.
- `double click`: two concurrent calls on one guard make one `create`.
- `approve order`: loadSignature, render signed, toPdf, upload, `approve(id, pdf, word, seen)`, then saveLocal. A failed `loadSignature` or render never calls `approve`. A failed `approve` returns `{ error }` and keeps the draft.
- `draft render`: `generateAgreement` never calls `loadSignature`.
- `edit`: `update` then rebuild unsigned then attach.
- `mail draft`: text has the Ref, and no sum across options or bases.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/accountingGenerate.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement both files**

File names through `fileNameFor`, with `.pdf` swapped in. `toPdf` is `docxToPdf` from `Template Module/ardentax/logic/docxToPdf.js`, imported dynamically. `seen` is the `agreement_changed_at` loaded on the document.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test "Template Module/tests/accountingGenerate.test.mjs"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/services/accountingGenerate.js" "Template Module/services/accountingApi.js" "Template Module/tests/accountingGenerate.test.mjs"
git commit -m "Add Accounting generation, approval and retry"
```

### Task 6: Client Module OneDrive route

**Files:**
- Modify: `Client Module/clientmodule/api.py` (route beside `/api/clients-folder`, CORS path list at line 142), `Client Module/clientmodule/config.py`, `Client Module/config.json` (add only `proposalRoot`)
- Test: `Client Module/tests/test_module.py`

**Interfaces:**
- Produces: `POST /api/proposal-folder`, form fields `word`, `pdf`, `client`, `client_id`, `department`. Allowed `department`: `Accounting` only for now. Returns `{ "path", "word", "pdf" }`. No configured root returns 503.

- [ ] **Step 1: Write failing tests, with a temp `proposalRoot`**

`test_proposal_folder_saves_both` (`<root>/Accounting/Acme - CL000001/Proposals/`), `_no_code`, `_no_overwrite` (` (2)`), `_cleans_names` (`A/B: ..\..\x` stays inside the root), `_types` (400, nothing written), `_size` (over 25 MB gives 400), `_department` (other value gives 400), `_cors` (allowed origin only).

- [ ] **Step 2: Run to verify it fails**

Run: `python -m pytest "Client Module/tests/test_module.py" -k proposal_folder -v`
Expected: FAIL, 404.

- [ ] **Step 3: Implement the route and config**

`Settings.proposal_root: Path | None`. Reuse the cleaning in `save_client_document`.

- [ ] **Step 4: Run to verify it passes**

Run: `python -m pytest "Client Module/tests/test_module.py" -v`
Expected: PASS, including older tests.

- [ ] **Step 5: Commit**

```bash
git add "Client Module/clientmodule" "Client Module/tests/test_module.py" "Client Module/config.json"
git commit -m "Save Accounting documents into the client's OneDrive folder from this PC"
```

### Task 7: Mail function

**Files:**
- Create in `Agent Module/11_Personal_Agent/CEO Agent Module/supabase/accounting-proposal-mail-send/`: `index.ts`, `rules.ts`, `rules_test.ts`

**Interfaces:**
- Consumes: `buildMail` from `../ardentax-mail-send/mime.ts`, `SmtpClient`, `ImapClient`, the password lookup pattern of `ardentax-mail-send/index.ts`.
- Produces: `POST { document_id, resend? }` returns `{ ok: true, sent_at, warnings }` or `{ error }`. Exports `attachmentsFor(doc): string[]`, `refusal(doc, { resend }): string | null`.

- [ ] **Step 1: Write failing tests**

- `attachmentsFor` returns only `storage_path`, even with `word_path` set.
- `refusal` for: not one of the two `library_template` values; no `storage_path`; agreement with no `approved_at`; path not under `Accounting/<id>/`; no draft subject; bad address; already sent with no `resend`. Approved agreement passes. Quote needs no approval.

- [ ] **Step 2: Run to verify it fails**

Run: `deno test "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/accounting-proposal-mail-send/rules_test.ts"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

The caller's JWT must pass `hub_acct_can_send(id)`. Subject and body come from the child `mail` row. The sent mark is written with the service role only after SMTP accepts. Sender `accounts@abcapital.ae`, secret by the existing `MAIL_PASSWORD_<ADDRESS>` naming. Logs carry no mail text, recipients or passwords.

- [ ] **Step 4: Run to verify it passes**

Run: the same `deno test`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "Agent Module/11_Personal_Agent/CEO Agent Module/supabase/accounting-proposal-mail-send"
git commit -m "Add the Accounting mail function, PDF only"
```

### Task 8: Quote and agreement screens

**Files:**
- Create: `Template Module/components/AccountingDesk.jsx`, `Template Module/components/AccountingOption.jsx`, `Template Module/components/AccountingAgreementForm.jsx`, `Template Module/components/AccountingDocuments.jsx`
- Modify: `Template Module/components/ServiceDesk.jsx` (the switch only)

**Interfaces:**
- Consumes: Tasks 2, 3 and 5, existing `ClientPicker`, `flagMissing`, `Panel`, `Button`, `DataTable`, `FormModal`.
- Produces: `<AccountingDesk profile={profile} />`, shown by `ServiceDesk` when the department is Accounting, the switch is on Quote (the default), and no `onDocument` prop was passed.

- [ ] **Step 1: Build `AccountingOption.jsx`**

Package picker with last-updated date, name, description, notes. Services with basis select; the amount is hidden for no-price bases and read-only when subs exist. Sub services add and remove. Rows move up and down. Totals per basis.

- [ ] **Step 2: Build `AccountingDesk.jsx`**

Client panel with only name, contact, email, phone. Options with + Add option. Shared scope, payment and notes. Generate button disabled while busy.

- [ ] **Step 3: Build `AccountingAgreementForm.jsx`**

Opens from an accepted quote with `agreementFromQuote`. Fields as the spec's table. Same form for editing, with a warning when the agreement is already approved that saving clears approval.

- [ ] **Step 4: Build `AccountingDocuments.jsx`**

Rows for the two `library_template` values: type, Ref, client, `registerLabel`, date, status. Actions: **View**, **Word**, OneDrive state with Save now, Mail panel with Send, a recipient confirmation and Resend. **Accept option** on a quote (radio with totals). **Agreement** on an accepted quote. **Edit** and **Approve** on an agreement, Approve shown only when `canApprove()`. Send disabled with "Awaiting approval" until approved. **Record signed** with date and file. Retry when `storage_path` is null.

- [ ] **Step 5: Add the switch in `ServiceDesk.jsx`**

Quote / Old Quotation tabs for Accounting only, and only when `onDocument` is not set. Old Quotation renders today's form untouched.

- [ ] **Step 6: Run all module tests**

Run: `node --test "Template Module/tests/"`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "Template Module/components"
git commit -m "Add the Accounting quote and agreement screens"
```

### Task 9: Settings and the private seed

**Files:**
- Create: `Template Module/components/AccountingSettings.jsx`
- Modify: `Template Module/components/HubNumbering.jsx` (mount it beside `LibrarySettings`)
- Create outside the repo: `D:\Abhijith Projects\CRM Private\accounting_packages_seed.sql`

**Interfaces:**
- Consumes: `loadPackages`, `savePackage`, `saveDefaults`, `saveAdmin`.

- [ ] **Step 1: Build `AccountingSettings.jsx`**

For Hub admins: list, edit and archive packages; edit standard notes and contact. For `role = 'admin'` only: approver list and signature upload to `accounting-signature/`, with a preview for those allowed to read it. It never logs the image or path contents.

- [ ] **Step 2: Write the private seed**

Three packages shaped from the old files, with no client names, addresses or signatories: an accounting-only set, an accounting with VAT and Corporate Tax set, and an accounting with audit and Corporate Tax set. Descriptions come from Schedule 1. Amounts come from Schedule 2.

- [ ] **Step 3: Check the seed on the local runner**

Run the seed after `008_accounting_proposals.sql` on the throwaway cluster.
Expected: 3 rows, with the amounts matching the old files by eye.

- [ ] **Step 4: Confirm nothing private is staged**

Run: `git status --short`
Expected: no seed, old file or signature image listed.

- [ ] **Step 5: Commit**

```bash
git add "Template Module/components/AccountingSettings.jsx" "Template Module/components/HubNumbering.jsx"
git commit -m "Let admins edit Accounting packages, approvers and the signature"
```

### Task 10: Keep other readers correct

**Files:**
- Modify: `Template Module/components/ServiceDesk.jsx` (old list filter), `Template Module/services/hubApi.js` (`listLibraryDocuments`, `listLetterableQuotes` if they return these rows)
- Test: `Template Module/tests/accountingReaders.test.mjs`

**Interfaces:**
- Consumes: `isAccountingQuote`, `isAccountingAgreement`.

- [ ] **Step 1: Write failing tests**

- `oldDeskRows(rows)`, exported from `logic/serviceDocs.js`, leaves out both new `library_template` values and keeps rows with null. The old list, and so the job screen modal, never shows them or offers Engagement Letter.
- `listLibraryDocuments` and `listLetterableQuotes` filter both values in JS, and keep null rows.
- `ServiceDesk` with `onDocument` set renders the old form with no switch. Assert through a pure `showAccountingDesk({ department, onDocument, mode })` helper.

- [ ] **Step 2: Run to verify it fails**

Run: `node --test "Template Module/tests/accountingReaders.test.mjs"`
Expected: FAIL.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Check the client login**

Read `Database Module/Business Setup Base/migrations/018_portal.sql` and later portal functions.
Expected: they list only `department = 'Business Setup'` documents, so Accounting drafts never reach a client. If not, add that filter in a test-covered change, and record what was found.

- [ ] **Step 5: Run tests**

Run: `node --test "Template Module/tests/"` and `bash "Database Module/Template Hub Base/tests/run-local.sh"`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "Template Module"
git commit -m "Keep the old desk, job screen and library lists clear of the new documents"
```

### Task 11: Output check

**Files:**
- Modify only what this check shows is wrong in Tasks 4 and 8.

- [ ] **Step 1: Rebuild the 3 old agreements locally**

A small script in the scratchpad using `renderAccountingDoc` and `docxToPdf`, with a test signature image, not the real one. Also a 2-option quote and a quote with sub services. Run the form through the dev server with `TEST CLIENT - DO NOT USE`, against a non-live path.

- [ ] **Step 2: Compare by eye with the originals**

Word and PDF, page by page: header, schedules, signature block, page breaks, long tables. List the differences.

- [ ] **Step 3: Report PDF quality and proposed quote wording**

If `docxToPdf` is not acceptable on the agreement, stop and tell the user. Otherwise send samples with test data only through `SendUserFile`, with the proposed scope and payment wording, and wait for the user's approval of the look.

- [ ] **Step 4: Commit any fixes**

```bash
git add "Template Module"
git commit -m "Match the Accounting output to the old files"
```

### Task 12: Release (each step needs the user's yes)

- [ ] **Step 1:** Whole-branch review, merge current `main` into the branch, and rerun all tests from Tasks 1 to 10. Renumber the migration if `proposal-format` landed first.
- [ ] **Step 2:** Apply the migration live. Read back columns, table, functions and both storage policies. `storage.objects` is owned by `supabase_storage_admin`, so check the policies exist, as the ArdentTax README warns.
- [ ] **Step 3:** Load the private seed live. The user or an admin uploads the signature image and sets the approvers, whose names the user gives. Confirm a non-approver account cannot read the image.
- [ ] **Step 4:** Deploy `accounting-proposal-mail-send` with JWT on. Check the mailbox secret exists, by name only.
- [ ] **Step 5:** Merge to `main` and push.
- [ ] **Step 6:** In `Main Module`, run `npm run deploy:cloudflare`, then confirm `abcrm` and `crm-abcapital` serve the new build.
- [ ] **Step 7:** Client Module: the user chooses between moving `D:\Abhijith Projects\CRM` to `main` (first discarding its uncommitted `Client Module/config.json`, which only matches `main`) or running the module from another folder. Restart it and check `/api/proposal-folder` writes to the real OneDrive folder with a test file, then remove that file only.
- [ ] **Step 8:** Signed-in live run with `TEST CLIENT - DO NOT USE`: 2-option quote, accept Option 2, agreement draft with no signature, approve, signed PDF, Word, OneDrive, Voucher Register, record signed. Record the numbers used, because they take real serials.
- [ ] **Step 9:** One real test mail to an address the user names. Check only the PDF is attached and the sent mark is set.
- [ ] **Step 10:** Update the memory notes: status, numbers used, and what is still open.
