# AB Capital design templates and work types: design and plan

Date: 2026-11-05. Status: awaiting user review. Branch: `library-fill`. Adds to the two earlier designs of this date; where they differ, this file wins.

## Goal

Every AB Capital quotation and engagement letter in the CRM uses the two designs the user supplied: `AB_Capital_Quotation_Template_Original_Design.docx` and `AB_Capital_Engagement_Letter_Template_Original_Design.docx`. On the Company Templates screens, a saved work type pre-fills the wording and fees.

## Decisions made by the user

| Topic | Decision |
|---|---|
| Where | All AB Capital documents: Company Templates, Service Documents, Business Setup, Accounting, Tax Compliance, Business Banking |
| Section wording | Saved per work type, editable on each document |

## Templates

Both designs hold no prices or bank details, so they are built into the repo. A script makes four files, keeping your layout and header:

| File | Used by | Source |
|---|---|---|
| `Template Module/templates/Service_Quotation_Template.docx` | Service Documents, Business Setup, Accounting, Tax Compliance, Company Templates | Quotation design |
| `Template Module/templates/Service_Engagement_Template.docx` | Same | Engagement design |
| `Banking Module/templates/Quotation_Template.docx` | Business Banking | Quotation design |
| `Banking Module/templates/Engagement_Letter_Template.docx` | Business Banking | Engagement design |

**Small additions to your design:**
- Engagement letter: a Ref line under Date, for the serial number.
- Fee table: a Total row, and a VAT row that appears only when VAT applies.
- Payment terms: bank details printed under them, from Settings.

**Not printed any more:** contact person, email, phone, licence and TRN, because your design has only To and Address. They stay on the record. The form keeps them where the record needs them.

**Unchanged:** the receipt voucher, Ardentax templates, and the browser print views in Business Banking, unless the user asks.

## Section sources

| Section | Existing flows | Company Templates |
|---|---|---|
| To, Address, Date, Ref | Document fields | Form |
| Introductory message (quote) | Blank | Work type, editable |
| Understanding | "We understand that you require ..." from the services; Business Banking from its saved terms | Work type, editable |
| Scope | List of services | Work type, editable |
| Fee wording (letter) | Saved `fee_intro` | Work type, else saved `fee_intro`, editable |
| Fee table | Document lines | Form fee rows |
| Payment terms | Saved `payment_terms`, then bank details | Work type, else saved terms, editable, then bank details |
| Representations (letter) | Saved `reps` | Work type, else saved, editable |
| Other terms (letter) | Saved responsibilities and limitations | Work type, else saved, editable |
| Additional terms (quote) | Document notes and validity date | Work type, editable, and validity if set |

Business Banking's own items, such as deposit, minimum balance, discount and case ref, go into Scope or Additional terms, so nothing it prints today is lost.

## Work types

- A work type is a row in `hub_library_templates` with company `AB Capital`: name, fee rows, USD rate and new `sections jsonb`, which holds quote and letter wording.
- Five to start: IFZA, Rakez, SHAMS, Mainland, Liquidation.
- **Starting wording** is taken from the old files by a local script and loaded into the private database. Bank details are left out, because Settings prints them. The user reads it through once. Fee rows stay empty until the user enters them.
- **Settings > Library Templates:** AB Capital rows take no file. They gain a **Wording** editor beside **Fee rows**.
- **Quote screen:** the Template dropdown becomes Work type. The form shows the client fields, the sections as text boxes, and fee rows. It no longer reads tags from a file.
- **Engagement Letter screen:** adds an optional Work type dropdown for wording. A letter from a quote copies client and fees, and takes wording from that quote's work type.
- A work type never changes documents already made.
- **USD:** the new design has no USD column, so the USD rate no longer matters for AB Capital. The field stays for now.

## Business Setup zone quotes

Zone files were never uploaded and none has been issued. `fileQuote` always uses the service quotation from now on, and the new design prints the zone only through the services and wording. The zone list in Business Setup stays as a label.

## Data change

New migration `Database Module/Template Hub Base/migrations/007_work_types.sql`:
- `hub_library_templates.sections jsonb not null default '{}'`.
- `hub_library_template_save` also stores `sections`, and keeps them when not sent.
- `hub_library_create`: AB Capital no longer needs a file. Ardentax still does.
- `hub_library_letter_create`: also stores `library_template` as the work type's key when one is chosen, else as today.

Rollback removes the column and restores both functions. Live function text is compared again before applying.

## Files

| File | Change |
|---|---|
| `scripts/build_ab_capital_templates.py` | New: makes the four files from the two designs |
| `scripts/extract_work_types.py` | New: reads old files into a JSON file outside the repo, with bank lines removed. Holds no wording itself |
| `logic/abDocument.js` | New, pure: section text for each flow, and the shared data for the two designs |
| `logic/serviceDocs.js` | `quoteData`, `letterData` use `abDocument` |
| `Banking Module/logic/documents.js` | `quoteMerge`, `letterMerge` add the new section fields, keeping existing ones |
| `Business Setup Module/services/documents.js` | `fileQuote` always uses the service quotation |
| `logic/libraryFields.js`, `logic/libraryLetter.js` | AB Capital form fields and section fields |
| `services/libraryGenerate.js` | AB Capital quotes render the built-in design |
| `components/AbCapitalGenerator.jsx`, `LibraryForm.jsx`, `LibrarySettings.jsx` | Work types and wording |
| `components/CompanyLibrary.jsx` | Lists only rows that have a file |

## Plan

### Task 1: Templates
Script, then four files. Tests render each file with each flow's real data, and fail on any tag left over or a value missing:
- `service quotation prints ref, client, address, date, lines, total, payment terms, bank details and notes`
- `VAT row shows only when VAT applies`
- `service letter prints ref, understanding, scope, fee wording, reps and other terms`
- `banking quotation keeps deposit, minimum balance, discount and case ref`
- `banking letter prints its scope, fees and terms`
Check: `node --test` in Template Module and Banking Module tests, then open all four in Word, and export previews for the user.

### Task 2: Database
Migration 007, rollback, local tests:
- `AB Capital document needs no file`; `Ardentax still needs a file`
- `sections saved and kept when not sent`; `non-manager cannot save sections`
- `letter stores the chosen work type`
Check: `bash "Database Module/Template Hub Base/tests/run-local.sh"`.

### Task 3: Screens and generation
Tests for: section pre-fill from a work type, editing not changing the saved wording, Generate order unchanged, Retry using stored sections. Check: tests and build.

### Task 4: Starting wording
Run the extract script on the old files. Show the user the wording for review, with no bank lines. Load it only after they agree.

### Task 5: Verify and release
Each step waits for the user:
1. Apply 007 live, after comparing live functions.
2. Load the wording. The user enters fee rows and uploads Ardentax Master only.
3. Browser check on every flow as far as generating.
4. One real test document per flow, agreed first.
5. Merge latest `main`, then deploy to both Cloudflare sites, and confirm old template files no longer load.
