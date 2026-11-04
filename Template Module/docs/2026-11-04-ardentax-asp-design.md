# ArdentTax (ASP) tab: design

Date: 2026-11-04. Status: awaiting review. Branch: `ardentax-asp`, from `origin/main` at `3576e03`.

## 1. Purpose

Replace `D:\Abhijith Projects\Quote Generator\Ardentax_Quote_Generator.xlsm` with a CRM tab for single e-invoicing (ASP) quotations and engagement letters. Each document is issued with a database serial number, so numbers stay in order and are never shared.

The problem today: of the 17 documents in `Generated Quotes`, 13 share `Ardentax/EINV/<date>`, one is an old `ABC/CFO` file, and only three have a serial (`Q101`, `Q102`, `QO103`). Those were typed by hand into the sheet's formula.

### Success means

- A user fills one form and gets a Word file, a PDF and an email draft, all held in the CRM.
- Two users generating at the same moment always get different numbers.
- The Word file looks the same as the macro's output, because only text and the macro's formatting steps change.
- Mail leaves only after a person clicks Send.

### Decisions already made

| Topic | Decision |
|---|---|
| Quote number | `Ardentax/{YYYY}/{MM}/ADTQ{SERIAL}`, 3 digits, starts at `ADTQ001`, never restarts |
| Letter number | `Ardentax/{YYYY}/{MM}/ADTE{SERIAL}`, own count, starts at `ADTE001`, never restarts |
| Old documents | Stay as they are; not imported |
| PDF | Made inside the browser, subject to the test in section 6 |
| Email | Editable draft in the CRM, with a Send button |
| Bulk (Clients sheet) | Not built; single documents only |

## 2. Tab and access

- New sidebar tab "ArdentTax (ASP)", key `ardentax`, added to `GRANTABLE_TABS` in `Main Module/src/tabs.js` and to `App.jsx`.
- Code lives in `Template Module/ardentax/`: `components/`, `logic/`, `services/`, `templates/`. It loads lazily through the `@template-hub` alias.
- Admins and members granted the tab can use it. The database enforces this through `my_tabs()` / `admin_is()`, so hiding the tab is not the only control.

## 3. Screen

**Form**, in the workbook's order:

1. Document (Quote / Engagement Letter) and Quote type (Standard / Custom).
2. Client details. These fill from the Client Master through `useClientLookup` and stay editable. Only the client legal name is required, as in the macro; blank contact lines drop out of the document.
3. Package cards: three tiers plus the selected package, invoices per year, TRNs and invoices covered.
4. Options and terms: Option #1 / #2, paid TRNs, fee per TRN, overage, buy-out, one-time note.
5. Standard: the ten pricing rows `ONB SUP FULL GAP TRN ANN ENT CMP X1 X2`, each with include, title, old price, fee, fee note, type and description. Custom: up to 7 line items.
6. Live totals and the checks from the Quote sheet (rows 67 to 74) and the Custom Quote sheet (rows 27 to 29).

**Register**, replacing the Quote Log: number, version, type, client, package, invoices, annual fee, Year 1 total, date, created by, and Word / PDF / Email actions. Each quote also has **Make Engagement Letter**, and each document has **Revise**.

Workbook behaviours that change:

- Overage default uses the selected package (`annual / documents + 0.08`). The sheet's formula always used the Established package, whichever was selected.
- A card's monthly price fills as `annual / 12` and stays editable. The sheet left it for hand entry, so a blank printed as `AED 0`.
- The sheet's stray side calculations (`F58:G62`, "Pro Active LLC") are not carried over.

## 4. Data

### Numbering

- Reuses `hub_next_number`, which takes a row lock on `hub_number_counters`.
- Adds department `ArdentTax (ASP)` to `service_departments` and to `hub_settings.document_numbering`.
- Both formats appear on the Template Hub numbering page. This needs a new `NUMBERING_DEPARTMENTS` list, because `DEPARTMENTS` also drives the Service Desk tabs, where ArdentTax must not appear.

`hub_next_number` only checks `hub_documents` for an existing number. The new table therefore has its own `unique (document_number, version)`, so a mistaken counter reset causes an error and not a duplicate.

### New table `ardentax_documents`

Separate from `hub_documents`, so that Template Hub lists, Business Setup triggers and the shared create function stay untouched.

Columns: `id`, `doc_type` (`quote` / `letter`), `document_number`, `document_serial`, `version`, `revision_of`, `source_quote_id`, `quote_type`, `client_name`, `selected_package`, `volume`, `one_time`, `annual`, `year1_total`, `details` (jsonb: every form input), `word_path`, `pdf_path`, `mail_to`, `mail_cc`, `mail_subject`, `mail_body`, `mail_sent_at`, `mail_sent_by`, `created_at`, `created_by`.

Row-level security: read and write only through tab access; all writes go through functions.

### Functions

- `ardentax_document_create(p jsonb)` issues the number. It recalculates totals from `details` using the same rules as the screen and raises an error on any mismatch.
- `ardentax_document_revise(p_id, p jsonb)` keeps the number and sets `version + 1`.
- `ardentax_document_attach(p_id, p_word, p_pdf)` records the stored files.
- `ardentax_mail_update(p_id, ...)` saves draft edits.

A letter may have `source_quote_id` or stand alone, as in the workbook. A quote can have only one letter; further changes are revisions of that letter.

### Files

Word and PDF go in the existing private `hub-documents` bucket under `ArdentTax (ASP)/<id>/`. The Client Module's office-PC folder copy is not used.

### Voucher Register

- Adds `ardentax` to the `source` check, plus a trigger with `company = 'Ardentax'` and `department = 'ArdentTax (ASP)'`. Each version gets its own row.
- `savePendingToPc` skips `source = 'ardentax'`. Without this, `pcKind` would produce an invalid folder name and these rows would always show as pending.

## 5. Generation flow

1. Run the checks. Blocking problems stop here.
2. Render a trial Word file with a placeholder reference. A template or data failure is caught here, before any number is used.
3. Call `ardentax_document_create`; the number is issued.
4. Render the final Word file, then the PDF, and upload both.
5. Call `ardentax_document_attach` and fill the mail draft. The files open from the register; nothing downloads by itself.

If step 4 fails, the row stays and shows **Generate again**, which reuses the same number. So a failure doesn't leave a gap.

File name: `Ardentax-2026-11-ADTQ001 <short name>.docx`, with ` v2` added for revisions.

The reference takes its year and month from the issue date in Asia/Dubai. Changing the Quote date field changes the date printed in the letter, not the reference.

## 6. Documents

### Word

Templates: `Ardentax_QUOTATION_TEMPLATE.docx` and `Ardentax_ENGAGEMENT_LETTER_TEMPLATE.docx`, copied unchanged to `Template Module/ardentax/templates/`.

`logic/fillDocx.js` edits the file's XML with `jszip`, repeating `MakeQuote` in `QuoteGenerator.bas`:

- Replace every `{{PLACEHOLDER}}`, and delete the paragraph where the macro does (`RepOrDrop`, blank overage, blank one-time note).
- Update `mailto:` links to the POC email.
- Standard: fill the cards, highlight the selected card, strike the other two, copy the selected and unselected colours and shading from the template's own columns, add "(Most Popular & Selected Package)", and remove a card with no documents and no price.
- Custom: delete the cards table, change the "Every plan" sentence, drop rows 2 to 4, write line items into the plain rows.
- Old prices appear struck through. Rows not included are removed, using the same fee rules as `FeeLabel` and `Money`.
- Rewrite the exclusions paragraph as in `SetExclusions`, with its bolding.
- Set author to `Ardentax IT Solutions – FZCO`, set the title, and clear comments. No AI attribution anywhere.
- Fail if any `{{` remains. The macro only warned.

Every placeholder in both templates currently sits in a single text run, so replacement is safe. A test keeps this true if a template is replaced.

### PDF (test first)

Proposed route: `docx-preview` to draw the Word file, then `html2canvas` and `jsPDF`, all lazy-loaded. This produces page images, so text can't be selected and files are larger than Word's PDFs.

**This is tested before anything else is built**, by filling the Emirates Defence Technology quote and comparing it with the PDF Word made for that client. Pass needs all of:

- same page count and no pricing or card row split across pages
- cover, logos and header correct
- yellow highlight and strikethrough visible
- fonts readable, at A4
- file under 5 MB

If it fails, work stops and the options go back to the user. A failure doesn't change the rest of the design.

**Result, 2026-11-05:** on the test quote the browser made 5 pages against Word's 4. The rest passed on the pages checked; strikethrough was not shown by that quote. The user accepted this: the PDF may run a page longer than the Word file.

## 7. Email

- Draft fields: To (POC email), CC, subject, body, and "also attach Word". Defaults come from the Email sheet, with tokens `{POC_FIRST} {POC_NAME} {CLIENT} {TIER} {VOLUME} {ANNUAL} {ONE_TIME} {TOTAL} {ERP}`.
- The default text and signature are stored in `hub_settings`, so they can change without a release.
- **Send** opens a confirmation showing recipient, subject and attachments.
- New Edge Function `ardentax-mail-send`, with JWT verification on:
  - checks tab access
  - reads files from storage
  - sends through the mailbox's SMTP server
  - stores a copy in the Sent folder
  - writes `mail_sent_at` and `mail_sent_by` with the service role, so a user can't mark a mail sent without sending it
- Sender: `bharat@ardentaxit.tax`, read from `email_base.mailboxes`. The password stays in the existing per-mailbox server secret and never reaches the browser.
- `smtp.ts` in `ceo-mail-reply` only builds text and HTML mail, so this function needs attachment and inline-image support. It gets its own copy, and the CEO Agent's mail code stays untouched.
- A failed send leaves the draft unsent and shows the error. Sending again after a success asks for confirmation first.

## 8. Testing

- **Logic:** totals, checks, fee labels and token replacement, against workbook values (one-time 1,500 + annual 4,199 = `5,699 AED`; description `Year 1: one-time AED 1,500 + annual AED 4,199`; Option #1 / #2 shows `TBD`).
- **Word:** Standard, Custom and Option modes on both templates; assert no `{{` left, the right rows removed, and strike and highlight on the right cards.
- **Database,** on the local stack only:
  - number format
  - parallel creates never duplicate, using the existing `020_concurrency.sh` pattern
  - revisions keep the number
  - access denied without the tab
  - totals mismatch rejected
  - Voucher Register row written
- **Browser:** the full flow in the preview against the local stack, comparing output with a workbook-made quote.
- **Mail:** only to an address the user names, and only after approval.

No test touches the live counters, so the first live quote is `ADTQ001`.

## 9. Release

Each step needs the user's approval: live database migration, Edge Function deploy, merge to `main`, and the Cloudflare deploy to `abcrm` and `crm-abcapital.pages.dev`. Rollback SQL ships with the migration.

After go-live, staff stop using the workbook. Otherwise two number sources return.

## 10. Out of scope

Bulk generation, import of old documents, office-PC folder copies, Arabic documents, changes to template wording, and any change to Template Hub beyond the numbering list and `savePendingToPc`.

## 11. Open points for review

1. **Signature.** `Email Signature/signature.htm` reads CEO, AB Capital Services FZC, above an Ardentax banner, while the mail comes from an Ardentax mailbox. It is carried over unchanged unless the user wants new wording.
2. **Who may send.** Everyone with the tab can send as `bharat@ardentaxit.tax`. Limiting Send to named users is a small addition if wanted.
3. **Voucher Register visibility.** ArdentTax rows follow the Template Hub rule there: any signed-in user can read number, client and amount, even without the tab.
