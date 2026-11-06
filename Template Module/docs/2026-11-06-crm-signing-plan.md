# CRM-wide Document Signing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An approver of a document's company can sign any client document in the CRM at send or download time. Everyone else sends unsigned. Mail signatures print bold lines without asterisks.

**Architecture:** One signing record table, one approver setting per company, and one front-end signing service that each document family calls with its own re-render function. Unsigned files stay where they are, and signed files sit beside them under `signed/`.

**Tech Stack:** Supabase Postgres, Storage and Edge Functions; React 19; docxtemplater, JSZip and `docxToPdf`; `node --test`; local PostgreSQL 18 runner; Deno test.

**Spec:** `Template Module/docs/2026-11-06-crm-signing-design.md`

**Worktree:** `D:\Abhijith Projects\CRM-accounting-proposal`, branch `crm-signing`, from `main` 6f0165f.

## Global Constraints

- Companies, exact keys: `ab_capital`, `ardentax`. A document's company is derived from its row: Ardentax for `ardentax_documents` and Ardentax library templates, AB Capital for everything else. It is never taken from the caller.
- Approver: the company's list in `hub_settings` key `document_signing`, or `admin_is()` while that list is empty. Hub admins and managers do not count.
- Only `admin_is()` edits approver lists and images.
- Images live under `signatures/<company>/` in `hub-documents`, plus Accounting's existing `accounting-signature/` path, which stays valid for `ab_capital`. Only that company's approvers can read them.
- Signing is optional for every document. Nothing may refuse a send or download because a document is unsigned.
- Signed files go to `<document prefix>/<id>/signed/<uuid>.pdf|.docx`, in the document's own bucket. Unsigned files are never overwritten.
- At most one live signature per document. An edit or regenerate supersedes it.
- `source_table` values, exact: `hub_documents`, `banking_quotations`, `banking_engagement_letters`, `banking_receipts`, `ardentax_documents`.
- Mail: a whole line `*text*` is bold in HTML and printed bare in plain text. The draft's marked closing is dropped when a signature is chosen.
- Public repo: no images, prices, client data or passwords committed. Templates hold tags only.
- Test client name `TEST CLIENT - DO NOT USE`.
- No live change (SQL, function deploy, merge, deploy, mail) without the user's approval for that step.
- The Business Setup proposal code (`proposal*` files, `proposal-mail-send`, `009_proposals.sql`) belongs to linked session `proposal-template-res-2`. Before Task 6, the controller asks that session for a hand-over. Do not edit those files while it is working.

## Review Focus

1. **Forged company or path:** a caller passing another company, or a signed path outside the document's own prefix, is refused. Test in Task 1.
2. **Signing a document that changed in another tab:** refused, and the old signature does not stay live. Test in Task 1.
3. **Approver removed between opening and signing:** refused by the server, even though the screen still shows the control. Test in Task 1.
4. **Signed send with no live signature, or a superseded one:** refused, and an unsigned send still works. Tests in Tasks 5 and 6.
5. **A signature with no bold lines, an empty line, or `*` inside a sentence:** left exactly as typed. Test in Task 4.

---

### Task 1: Shared signing database

**Files:**
- Create: `Database Module/Template Hub Base/migrations/011_document_signing.sql`, `rollback/011_rollback.sql`, `tests/060_signing_test.sql`
- Modify: `tests/run-local.sh`, `README.md`
- Add to the commit: the spec and this plan

**Interfaces (produces):**
- `hub_settings` key `document_signing`, seeded from `accounting_proposal_defaults` (approvers, signature path) into `ab_capital`, with `ardentax` empty
- Table `document_signatures(id uuid pk, source_table text, source_id uuid, company text, signed_by uuid, signed_at timestamptz, word_path text, pdf_path text, unsigned_word_path text, unsigned_pdf_path text, document_changed_at timestamptz, superseded_at timestamptz, superseded_reason text)`, with a partial unique index on `(source_table, source_id) where superseded_at is null`
- `doc_company(p_table text, p_id uuid) returns text`, not callable from the browser
- `doc_sign_can(p_company text) returns boolean`
- `doc_sign_record(p jsonb) returns document_signatures`, keys `source_table, source_id, word_path, pdf_path, seen`
- `doc_sign_live(p_table text, p_id uuid) returns document_signatures`
- `doc_sign_supersede(p_table text, p_id uuid, p_reason text)`
- `doc_sign_admin_save(p jsonb)`, keys `company, approvers?, signature_path?`
- `doc_changed_at(p_table, p_id) returns timestamptz`: the change stamp of a document, from `agreement_changed_at`, a new `content_changed_at` column added to each source table with an update trigger on its content columns, or `created_at`
- Storage policies `doc_sign_image_*` covering `signatures/<company>/` and `accounting-signature/`
- RLS on `document_signatures`: select for whoever can select the source row, writes only through functions
- `hub_acct_can_approve()` rewritten to call `doc_sign_can('ab_capital')`, so Accounting keeps working until Task 5

- [ ] **Step 1: Write failing tests in `060_signing_test.sql`**
  - Approver per company, including the admin fallback.
  - The company comes from the row, never the caller.
  - Paths outside `<prefix>/<id>/signed/` are refused for each table.
  - A stale `seen` is refused.
  - A second record supersedes the first.
  - Supersede on a content edit.
  - Non-approver refused.
  - Image read, insert and delete per company for approver, non-approver and admin.
  - The settings move keeps GEO and the existing path.
  - Migration runs twice, and rollback restores `accounting_proposal_defaults` approvers and path.
- [ ] **Step 2:** Add the files to the runner and run `bash "Database Module/Template Hub Base/tests/run-local.sh"`. Expected: fail on the missing `doc_sign_can`.
- [ ] **Step 3:** Write the migration and rollback. Find the prefix and bucket of each table from where its files are written today: `Banking Module/services/bankingApi.js` (bucket `banking-documents`), `Template Module/ardentax/services/generate.js`, `Template Module/services/hubApi.js`. If a family does not store its generated file today, its signed prefix is `<family>/<id>/signed/` in its bucket. Record each choice in the README.
- [ ] **Step 4:** Run the runner. Expected: exit 0, no FAIL.
- [ ] **Step 5:** Commit: `Add the shared document signing record and company approvers`.

### Task 2: Shared render and signing service

**Files:**
- Create: `Template Module/logic/signDocx.js`, `Template Module/services/signing.js`, `Template Module/tests/signing.test.mjs`
- Modify: `Template Module/logic/accountingDocx.js`, so it uses `signDocx.js` with identical output

**Interfaces:**
- Produces `addSignature(zip, xmlBefore, signature)` and `signatureXml(signature)`, moved from `accountingDocx.js`.
- Produces `signDocument({ table, doc, rebuild, seen }, deps)`, which returns `{ signature, wordBlob, pdfBlob } | { error }`.
- `deps = { canSign(company), company(table, doc), loadImage(company), toPdf, upload(path, blob, type), record(p), remove(paths), bucketPrefix(table, doc) }`

- [ ] **Step 1:** Failing tests:
  - Order is canSign, loadImage, rebuild, toPdf, upload pdf, upload docx, record.
  - Not an approver: nothing else is called.
  - Image missing: `{ error }` naming the company.
  - Rebuild or PDF fails: nothing uploaded or recorded.
  - Record fails: `remove` is called with both paths, and the original error is returned.
  - The existing `accountingDocx` tests still pass unchanged.
- [ ] **Step 2:** `node --test "Template Module/tests/"`. Expected: the new tests fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: all pass.
- [ ] **Step 5:** Commit: `Add the shared signing render and service`.

### Task 3: Settings > Signing

**Files:**
- Create: `Template Module/components/SigningSettings.jsx`, `Template Module/services/signingApi.js`
- Modify: `Template Module/components/AccountingSettings.jsx` (remove its approver and signature fields, link to Signing), `Template Module/components/HubNumbering.jsx` (mount)

**Interfaces:**
- `signingApi`: `loadSigning()`, `saveSigning(company, { approvers?, signature_path? })`, `uploadSignature(company, file)` (png or jpeg, under 2 MB, to `signatures/<company>/<uuid>.<ext>`), `canSign(company)`, `liveSignature(table, id)`, `recordSignature(p)`, `removeSigned(paths)`

- [ ] **Step 1:** A pure helper `signingView(settings, profile)` with tests: which companies show, the admin-only parts, and that the approver choice list is staff only.
- [ ] **Step 2:** Build the screen: per company, approvers and image, with a preview only for that company's approvers.
- [ ] **Step 3:** `node --test "Template Module/tests/"` and `npm run build` in `Main Module`. Expected: pass.
- [ ] **Step 4:** Commit: `Add Settings > Signing for each company`.

### Task 4: Mail signature formatting

**Files:**
- Modify: `Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ardentax-mail-send/rules.ts` (`htmlBody`, plus `plainText`), the three senders' `index.ts` (`accounting-proposal-mail-send`, `proposal-mail-send`, `ardentax-mail-send`), and their rules tests
- Modify: draft builders `Template Module/services/accountingGenerate.js` (`mailText`), `Template Module/services/proposalGenerate.js` (`proposalMail`), and the Ardentax draft in `Template Module/ardentax/`, so each ends with a marked closing block

**Interfaces:**
- `boldLines(text): { html, plain }`, following the rule of `BOLD_LINE` in `ceo-mail-reply/smtp.ts`
- `CLOSING_MARK`: a line `-- closing --` that the draft builders place above the closing. Senders drop the mark, and also the closing when a signature is chosen. The mark is never sent.

- [ ] **Step 1:** Failing Deno tests:
  - `*Regards,*` becomes `<b>Regards,</b>` in HTML, and `Regards,` in plain text.
  - A line with `*` mid-sentence is unchanged.
  - Empty lines are kept.
  - The closing is removed only when a signature is chosen.
  - The mark never appears in output.
  - Text without the mark is unchanged.
- [ ] **Step 2:** Implement, then run `deno test` and `deno check` for the three functions, and `node --test` for the draft builders.
- [ ] **Step 3:** Commit: `Print bold signature lines without asterisks and drop the draft closing under a signature`.

### Task 5: Accounting on the shared signing

**Files:**
- Create: `Database Module/Template Hub Base/migrations/012_accounting_signing.sql`, its rollback, tests
- Modify: `Template Module/components/AccountingDocuments.jsx`, `Template Module/services/accountingGenerate.js`, `Template Module/services/accountingDeps.js`, `logic/accountingUi.js`, `accounting-proposal-mail-send/index.ts` and `rules.ts`

**Rules:**
- `hub_acct_can_send` and the mail claim no longer require `approved_at`.
- `hub_acct_agreement_update` and `hub_acct_attach` call `doc_sign_supersede`.
- `hub_acct_approve` stays only for history and is no longer called.
- Approve becomes Sign, on quotes as well as agreements.
- The Send dialog gets "Sign before sending", for approvers only, plus a status line.
- `signed: true` sends the live signature's PDF, checked under the prefix. `signed: true` with no live signature is refused. The unsigned send is unchanged.

- [ ] **Step 1:** Failing SQL, Deno and node tests for the rules above, including the Review Focus 4 cases.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** Run every suite, and `npm run build`.
- [ ] **Step 4:** Commit: `Move Accounting onto shared signing; signing optional`.

### Tasks 6 to 11: One per family

The same shape for each family, done in this order:

| Task | Family | Files |
|---|---|---|
| 6 | Business Setup proposal | `Template Module/services/proposalGenerate.js`, `proposalDeps.js`, proposal components, `proposal-mail-send`, `AB_Capital_Proposal_Template.docx` and its builder. Controller hand-over from `proposal-template-res-2` first. |
| 7 | Ardentax | `Template Module/ardentax/**`, `ardentax-mail-send`, Ardentax templates. Company `ardentax`. |
| 8 | Business Banking | `Banking Module/logic/documents.js`, `services/bankingApi.js`, `components/CaseWorkspace.jsx`, `Banking Module/templates/*`, `scripts/build_templates.py` |
| 9 | Business Setup cases | `Business Setup Module/services/documents.js`, `components/workspace/Quotes.jsx`, `Service_*` templates where it uses them |
| 10 | Service Desk old form | `Template Module/components/ServiceDesk.jsx`, `Service_Quotation_Template.docx`, `Service_Engagement_Template.docx`, `scripts/build_ab_capital_templates.py` |
| 11 | Company Templates | `Template Module/components/AbCapitalGenerator.jsx`, `LibraryRegister.jsx`, `services/libraryGenerate.js`, the AB Capital design templates |

**Each family task:**
- [ ] **Step 1: Template.** Add the Authorized Signatory block with `{@signature_xml}` to each of the family's templates through its builder. Test: blank when unsigned, image present when signed.
- [ ] **Step 2: Rebuild.** Export `rebuild<Family>(doc, signature)`, which re-renders the stored document with the signature through `signDocx`. Test it against the family's existing render output: identical except the signature.
- [ ] **Step 3: Control.** Add "Sign" on the row, or "Sign before sending" where the family sends, shown only when `canSign(company)`. Add the status, plus "Signed copy" and "Unsigned copy". Put the visibility rule in a pure helper with tests.
- [ ] **Step 4: Supersede.** Call `doc_sign_supersede` on the family's edit, revise and regenerate paths. Test it.
- [ ] **Step 5: Send (Tasks 6 and 7 only).** Add the `signed` flag in the mail function, as in Task 5.
- [ ] **Step 6:** Run every suite and `npm run build`.
- [ ] **Step 7:** Commit: `Sign <family> documents`.

### Task 12: Output check and release

- [ ] **Step 1:** For each family, make an unsigned and a signed sample with test data and a dummy signature image. Convert them through Word on this PC, compare by eye, and send the samples to the user. Wait for approval of the look.
- [ ] **Step 2:** Final whole-branch review.
- [ ] **Step 3:** Release in order, each step with the user's yes:
  1. Migration 011, then check the policies exist.
  2. Migration 012.
  3. Redeploy the three mail functions.
  4. Merge to `main`, then `npm run deploy:cloudflare`, and confirm both sites.
  5. Ardentax image and approvers, set by an admin.
  6. A live signed send by GEO with the test client to `abhijith.abcapitals@gmail.com`.
- [ ] **Step 4:** Update memory and the ledger.
