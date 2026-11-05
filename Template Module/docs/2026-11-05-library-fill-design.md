# Company Library fill and generate: design

Date: 2026-11-05. Status: awaiting user review. Branch: `library-fill`, from `main` at caf5d04.

## Goal

Staff fill a Company Library template inside the CRM (Template Hub > Company Library), using OCR to capture client details and typing whatever is missing. The CRM then generates the Word document, saves it, lists it, and gives it a serial reference number.

## Decisions made by the user

| Topic | Decision |
|---|---|
| OCR target | Add a client block to the templates, so OCR has something to fill |
| AB Capital Ref | Share the Business Setup quote series, `ABC/YYYY/MM/BSQ###` |
| Ardentax Ref | Own new series, `Ardentax/YYYY/MM/ADTD###`, separate from the ArdentTax tab's `ADTQ` |
| Ardentax Master | In the first version |
| Fees | Saved default rows per template, editable on each document |
| Template storage | Private storage, not the repo. The repo is public and these files hold bank details and prices |

## Current state (checked on `main` and live, 2026-11-05)

- `components/CompanyLibrary.jsx` lists `Template Docs/*/*/*.docx` at build time and only offers download. Those six files are in a public GitHub repo and are served as plain site files.
- IFZA, Rakez, SHAMS, Mainland and Liquidation have `{{tags}}`: date, one business field, and an `{{#items}}` fee loop. None has a Ref or client details.
- Rakez, SHAMS and Mainland use `{{ business_name }}` under a "Business Activity" or "License Activity" label, while IFZA uses `{{ business_activity }}`.
- Ardentax Master uses `[bracket]` placeholders, including its own `[DOC-YYYY-###]`, and already has a client table.
- `quotation_templates` has 0 rows. `business_setup_fee_items` has 24 service prices, none tied to a template, so saved rows per template are still new data.
- Business Setup > New Service already issues zone quotes from files with these same names (`business_setup_quote_templates`), loaded from master templates uploaded in Settings. None are uploaded and no zone quote has been issued. That flow reads single-brace tags, so it does not use the `Template Docs` copies.
- `hub_documents.doc_type` allows quote, letter and mail. `hub_number_counters.kind` allows quote, letter and receipt.
- Live Business Setup quotes have reached `BSQ004`. `hub_next_number` checks `hub_documents` so a number cannot repeat.
- The `voucher_hub` trigger copies quote and letter rows into the Voucher Register.

## Staff flow

1. Company Library lists the active templates from the database. A **Fill** button appears beside download on any template that has `{{tags}}`, for people allowed to generate it. A template with no tags stays download only.
2. Client details: search Client Master, or start blank.
3. OCR: upload a passport, Emirates ID or trade licence. OCR fills empty fields only and never overwrites a typed value. If two documents disagree, both readings are shown and staff choose.
4. Manual entry: staff type what is missing. Required fields are marked, and Generate names any that are empty.
5. Fees: rows pre-fill from the template's saved list. Staff can edit, add or remove rows for this document.
6. Generate: the CRM takes the Ref, creates the Word file, saves it and opens it.
7. Generated list, below the library: Ref, template, client, date, staff member, open and download, with a company filter.

## Fields

The form is built from the tags found in the template, so a new `.docx` with `{{tags}}` gets a form as soon as it is uploaded in Settings.

- `logic/libraryFields.js` holds labels, types, required flags and sources for known tags. An unknown tag becomes an optional text field labelled from its name.
- The system fills `ref_no` and `date`. `date` defaults to today in Asia/Dubai and can be changed.
- Passport and Emirates ID numbers are never placed on a document.

| Tag | Label | Required | OCR or Client Master source |
|---|---|---|---|
| `client_name` | Client name | Yes | `legal_name`, or `Client Legal Name` |
| `contact_name` | Contact person | Yes | person name on the ID, or `Primary Contact` |
| `contact_email` | Email | Yes | `company_email`, or `General Email` |
| `contact_phone` | Phone | Yes | `company_phone`, or `General Phone` |
| `business_activity` | Business activity | Yes where the tag exists | `business_activity` |
| `business_name` | Business name | Yes where the tag exists | `trade_name` or `legal_name` |

**Client address** is optional on the form. The live `hub_document_create` does not require it for Business Setup. It is stored on the record and not printed in the client block.

Ardentax Master adds trade name, signatory, licence, TRN, address, city and the free-text sections as fields. Of these, only the client name is required, since the Master covers many kinds of document.

## Template changes

The six Word files leave the repo. They are kept in the private `hub-documents` bucket, and only signed-in staff can reach them.

`scripts/update_library_templates.py <originals folder> <output folder>` makes the edits, following `Business Setup Module/scripts/fix_templates.py`. It holds no prices or bank details, never touches its input, and writes outside the repo.

- All five AB Capital files: add `{{ ref_no }}` and a client block (name, contact, email, phone) near the date.
- Rakez, SHAMS, Mainland: rename `{{ business_name }}` to `{{ business_activity }}`, to match the label above it. Liquidation keeps `{{ business_name }}`, because "For ..." there means the company.
- Ardentax Master: convert brackets to tags and `[DOC-YYYY-###]` to `{{ ref_no }}`. Its fee table repeats with Service as `label`, Scope as `remarks`, Rate as `rate`, Amount as `amount`.
- The user reviews all six filled files before release, because a new block can shift the layout. Liquidation and IFZA use text boxes and need particular care.

**Settings > Library Templates**, for `settings.manage` holders: add a template (company, folder, name, file), replace its file, set fee rows and USD rate, retire it. The user uploads the six edited files here once, after the migration and before the release that removes the repo copies.

**Separate from Business Setup masters.** These templates do not use `hub_master_templates`. Business Setup reads `IFZA.docx` and the others from there with single-brace tags, while library files use double braces, so sharing a key would break that flow. Business Setup is unchanged, apart from the guard under Generating.

**Removal from the repo:** the release deletes `Template Docs/*/*/*.docx` from `main`. The old copies stay in git history. Removing them from history is a separate rewrite and is not part of this work.

## Generating

Rendering reuses `logic/renderDocx.js`. Fee rows, USD values and totals reuse the row logic in `logic/buildContext.js`. No VAT is calculated, since the templates say "Plus, Applicable Taxes". Rows are stored with `vat_mode = 'none'`.

Order of work:

1. Check required fields and that the template loads, so a bad form uses no number.
2. Call `hub_library_create`, which takes the number and writes the row in one transaction.
3. Render with that Ref.
4. Upload to the `hub-documents` bucket under `<department>/<id>/<uuid>.docx`, then record the path with `hub_document_attach`. Save a PC copy through the existing `saveFile` when the Client Module is reachable.

If step 3 or 4 fails, the row keeps its Ref, shows "File not saved" and offers **Retry** to the person who created it, which rebuilds from the stored values and the same template file. A number is never lost or reused.

`fileQuote` in `Business Setup Module/services/documents.js` refuses a document with `library_template` set, so Business Setup's Create file cannot fill a library Ref with the wrong template.

The file name is the Ref with `/` replaced by `-`, then the client name.

## Corrections

A generated document is not edited. **New from this** opens the form pre-filled from an old document, and generating gives it a new Ref. The old document stays.

## Data changes

New migration `Database Module/Template Hub Base/migrations/004_library_fill.sql`. Re-runnable, with a rollback file. Each function changed below must first be read from live, because later migrations have replaced earlier definitions.

**`hub_documents`**
- New columns: `library_template text`, `library_file_id bigint`, `field_values jsonb`.
- `doc_type` also allows `library`, used by Ardentax Master documents only.
- AB Capital library documents stay `doc_type = 'quote'`, so the Voucher Register and engagement letter step work unchanged.
- Fee rows go in the existing `lines` column as `{description, amount, remarks, rate}`, and the existing engagement letter code reads `description` and `amount`.

**Numbering**
- `hub_number_counters.kind` also allows `document`.
- `hub_settings.document_numbering` gains `Ardentax Documents` with `document: {format: "Ardentax/{YYYY}/{MM}/ADTD{SERIAL}", digits: 3, restart: "never"}`.
- `service_departments` gains `Ardentax Documents`, which `hub_numbering_save` requires.
- `hub_numbering_status` and `hub_numbering_save` treat `document` the way they treat `receipt`: it appears only where the setting has it. `hub_numbering_status` also skips quote and letter where a department's setting lacks them, because it would otherwise fail on the new department.
- `components/HubNumbering.jsx` gains a "Documents" row for that department and hides quote and letter rows for it.

**`hub_library_create(p jsonb)`**
- Security definer, requires sign-in.
- AB Capital: calls the existing `hub_document_create` with `doc_type = 'quote'`, department `Business Setup`, `vat_mode = 'none'`, then sets `library_template` and `field_values`. So it keeps that function's checks, including `setup.quotes.manage`: only holders of that right (Admin, Manager, Sales Executive) can generate AB Capital documents.
- A client picked from Client Master sets `client_id`. As with every Business Setup quote, the document then shows in that client's Business Setup workspace and client login. Starting blank leaves `client_id` empty.
- Ardentax: requires `ardentax_can()`, `hub_next_number('Ardentax Documents', 'document')`, `doc_type = 'library'`.
- The server reads the company from the `hub_library_templates` row, not from the browser, and refuses a retired template.
- The server recalculates `total_amount` from the rows.

**`hub_library_templates`**
- Columns: `template_key text primary key` (`<Company>/<Folder>/<Name>`), `company` (`AB Capital` or `Ardentax`), `folder`, `name`, `fee_rows jsonb`, `usd_rate numeric`, `active boolean`, `updated_by`, `updated_at`.
- Written only through `hub_library_template_save`, which requires `banking_require('settings.manage')`.
- Changing it does not touch generated documents.

**`hub_library_template_files`**
- One row per upload, old rows kept: `id`, `template_key`, `file_name`, `storage_path`, `uploaded_by`, `uploaded_at`. The latest row is in use.
- Written through `hub_library_template_upload`, same right. The path must start `library-templates/`.

**`hub_library_my_access()`** returns `{ab, ardentax, manage}`, so the screen hides Fill rather than failing after the form is filled.

**Access**
- `hub_doc_read` becomes `doc_type <> 'library' or ardentax_can()`.
- Both new tables are read by signed-in users, with Ardentax rows limited to `ardentax_can()`.
- Storage gains restrictive read and insert policies for `Ardentax Documents/%` and `library-templates/Ardentax/%`, copying the `hub_docs_ardentax_*` pattern. `storage.objects` is owned by `supabase_storage_admin` on live, so the release must confirm these policies exist.

## Files

| File | Change |
|---|---|
| `components/CompanyLibrary.jsx` | Fill button, generated list |
| `components/LibraryFill.jsx` | New: form, OCR, fee rows, generate |
| `components/LibrarySettings.jsx` | New: upload, replace, retire, fee rows, in Template Hub > Settings |
| `components/HubNumbering.jsx` | Documents row, hosts LibrarySettings |
| `logic/libraryFields.js` | New, pure: read tags from a docx, field definitions, required check |
| `logic/libraryOcr.js` | New, pure: map `buildAutofill` results and Client Master rows to tags, empty fields only |
| `services/hubApi.js` | Library calls. `listDocuments` leaves out `doc_type = 'library'` |
| `scripts/update_library_templates.py` | New: template edits |
| `Template Docs/*/*/*.docx` | Six files removed from the repo |
| `Business Setup Module/services/documents.js` | Guard in `fileQuote` |

OCR goes only through `readDocuments` and `buildAutofill` in `Banking Module`, which run the DOC OCR Module in the browser. Uploaded ID files are read in the browser and not saved. Only values the user accepts are stored.

## Errors

- OCR fails or reads nothing: a note says so and the form stays usable by hand.
- Template has an invalid tag: Fill shows which file is at fault and no number is taken.
- No saved fee rows yet: the form starts with one empty row.
- At least one fee row is required on AB Capital documents. Ardentax Master may have none.

## Out of scope

PDF output, sending mail, Arabic text, editing issued documents, and Traction and Catalyst, which have no Word files on `main`.

## Testing

- Unit: tag detection on small test files built in the test, so no price or bank detail enters the repo, field definitions, OCR mapping that never overwrites, fee and USD totals.
- Database, using the pattern in `Database Module/ArdentTax Base/tests`: BSQ continues after Service Documents, ADTD starts at 001 and stays separate from ADTQ, concurrent calls give distinct numbers, a non-ArdentTax user cannot create or read `library` rows or their files, non-managers cannot save fee rows.
- Engagement letter: an accepted library quote can take the existing letter step. The live function refuses a letter until the quote is marked accepted, which applies here as it does to any Business Setup quote.
- Browser: full flow on a local build with a scanned ID, then open the Word file and confirm Ref, client block, fee rows and totals.
- Word validity: each of the six filled files opens in Word without a repair prompt. This uses the real files, kept outside the repo.

## Release

Order: live migration with approval, user uploads the six files in Settings, then merge with approval, which removes the repo copies. A library page with no uploads shows an empty list, so the old build keeps working until the merge. After merging, run `npm run deploy:cloudflare` from a checkout matching `main`, and confirm abcrm and crm-abcapital serve the new build.
