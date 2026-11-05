# AB Capital quote and engagement generators: design and plan

Date: 2026-11-05. Status: awaiting user review. Branch: `library-fill`. Adds to `2026-11-05-library-fill-design.md`; where they differ, this file wins.

## Goal

Under Template Hub > Company Templates, choosing **AB Capital Services FZE** gives a Quote generator and an Engagement Letter generator, in the same style as Ardentax. Staff select a client from Client Master, the details fill in, they complete what is missing, and **Generate** makes the Word file.

## Decisions made by the user

| Topic | Decision |
|---|---|
| Location | Company Templates, AB Capital in the Company dropdown |
| Documents | Both quote and engagement letter |
| Client details | Selected from Client Master and filled in automatically |
| Engagement letter | Made directly from a client, or from an existing quote; no accepted quote needed on these screens |

## Assumptions to confirm

- The Freezone Quotations tab is removed from Template Hub. It has no templates or data. Its code stays in the repo for reuse.
- Company Library keeps download for all templates and the generated list. **Fill** there stays for Ardentax Master only, so AB Capital has one way in.
- All freezones share the wording of `Service_Engagement_Template.docx`, because AB Capital has no letter file of its own.

## Screens

**Company Templates, AB Capital.** The Quote column gets **Open Quote** and the Engagement Letter column gets **Open Engagement Letter**. Without `setup.quotes.manage`, each shows "Needs the Business Setup quotes right from an admin". The Email and Social columns are unchanged.

**Quote.** Same steps as the fill form, shown in the page, not a pop-up:
1. Template dropdown: active AB Capital templates that have a file.
2. Client Master search; selecting a client fills name, contact, email, phone, address.
3. OCR for gaps, then typing.
4. Fee rows from the template's saved list, editable.
5. **Generate**. Ref from the `BSQ` series. The document list below shows AB Capital quotes.

**Engagement Letter.**
1. Start from: **A client** or **An existing quote**.
2. From a quote: a dropdown of Business Setup quotes with status issued or accepted that have no letter. It copies client and fee rows.
3. Same client search, OCR and fee rows. Trade licence number and TRN are optional fields, because the letter prints them.
4. **Generate**. Ref from the `BSE` series. The document list below shows AB Capital letters made here.

Both lists use the same columns as the Company Library list: Ref, client, date, staff, open, download, Retry, New from this.

## Rules

- **Who:** `setup.quotes.manage`, on the server, for both documents.
- **Direct letter:** has no `parent_id`. Nothing links it to accepted fees, as the user accepted.
- **Letter from a quote:** sets `parent_id`, so one letter per quote still applies, and a second gets a clear message. The quote need not be accepted.
- **Quotes in a Business Setup case** cannot be picked. Their letter comes from the case, because the case tracks its documents and its stage depends on them.
- **Business Setup's own flow is unchanged:** its letter still needs an accepted quote, through `hub_document_create`.
- **Client login:** a letter from a client-linked quote shows in that client's login, as today. A direct letter does not, because the portal finds letters through their quote.
- **VAT:** none calculated, `vat_mode = 'none'`, same as library quotes.
- **Same Generate behaviour:** checks and a trial render before the number is taken; a failed save keeps the Ref and offers Retry; the form clears so a second click cannot take another number.

## Data change

New migration `Database Module/Template Hub Base/migrations/006_library_letter.sql`, with rollback and local tests. No existing function changes.

`hub_library_letter_create(p jsonb) returns hub_documents`, security definer:
- `business_setup_require('setup.quotes.manage')`.
- Keys: `parent_id` (optional), `client_id`, `client_name`, `contact_name`, `contact_email`, `contact_phone`, `client_address`, `license_number`, `vat_trn`, `field_values`, `lines`.
- Requires client name, contact, email, phone and at least one line with an amount of zero or more. Server totals the lines.
- With `parent_id`: quote must exist, be Business Setup, have status issued or accepted, have no `case_id`, and have no letter yet.
- `hub_next_number('Business Setup', 'letter')`, `doc_type 'letter'`, department `Business Setup`, `vat_mode 'none'`, `library_template = 'AB Capital/Engagement Letter'`.
- Voucher Register records it through the existing trigger.

## Files

| File | Change |
|---|---|
| `components/LibraryForm.jsx` | New: the form body taken out of `LibraryFill.jsx`, used in a pop-up and in the page |
| `components/LibraryFill.jsx` | Wraps `LibraryForm` in the pop-up |
| `components/LibraryRegister.jsx` | New: the document list taken out of `CompanyLibrary.jsx`, with a filter |
| `components/AbCapitalGenerator.jsx` | New: template or quote chooser, form, list |
| `components/CompanyTemplatesPage.jsx` | AB Capital generators and access |
| `components/CompanyLibrary.jsx` | Uses `LibraryRegister`; Fill for Ardentax only |
| `components/TemplateHub.jsx` | Removes the Freezone Quotations tab |
| `logic/libraryLetter.js` | New, pure: letter form fields, data for `letterData`, quote to form values |
| `services/libraryGenerate.js` | `generateLetter` and Retry for letters |
| `services/hubApi.js` | `createLibraryLetter`, `listLetterableQuotes` |

## Plan

### Task A: Database
Files: migration, rollback, `tests/010_library_test.sql`, `tests/run-local.sh`, README.
Tests, written first:
- `direct letter takes the next BSE number and needs no quote`
- `letter from an issued quote sets parent_id and needs no acceptance`
- `second letter for a quote is refused`
- `quote in a case is refused`
- `rejected or superseded quote is refused`
- `outsider is refused`; `missing contact is refused`; `no lines is refused`
- `total is recalculated from lines`
- `letter appears in the Voucher Register`
- `Business Setup letter through hub_document_create still needs an accepted quote`
Check: `bash "Database Module/Template Hub Base/tests/run-local.sh"` exits 0.

### Task B: Letter logic
Files: `logic/libraryLetter.js`, `services/libraryGenerate.js`, tests.
Tests, written first:
- `letter fields include licence and TRN as optional`
- `quote to form copies client, contact and fee rows`
- `letter data has number, lines, total and no VAT sentence that contradicts the quote`
- `missing field uses no number`; `render failure before create uses no number`
- `save failure keeps the Ref`; `Retry on a letter makes no new row and uses stored values`
Check: `node --test "Template Module/tests/"`.

### Task C: Screens
Files: the components above.
Move the form and list out without changing behaviour, then add `AbCapitalGenerator` and the Company Templates wiring. Remove the tab. Check: tests and `npm run build`.

### Task D: Verify and release
Each step waits for the user:
1. Apply `006_library_letter.sql` live, after comparing live functions again.
2. User signs in on the local build and uploads the six files and fee rows.
3. Browser check of Quote and Engagement Letter up to Generate.
4. One real test document per type, agreed first, since each takes a real Ref.
5. Merge, deploy to both Cloudflare sites, and confirm the old template files no longer load.
