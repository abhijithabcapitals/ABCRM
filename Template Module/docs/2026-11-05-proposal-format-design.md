# Business Formation Proposal format: design

Date: 2026-11-05. Status: awaiting user review. Base: `main` at b58a28f. Nothing is built or live.

## Goal

Template Hub > Service Documents > Business Setup generates the Business Formation Proposal that AB Capital sends to clients, in the format of the old proposals in `Desktop\Business Proposal`. The form asks only for what that format needs. One quote can hold several proposal options. A service's fee breakup is entered as sub services with amounts.

**Done means:** staff generate a proposal with one or more options under one main AB Capital reference, View opens the PDF in the browser, Word and PDF are kept in the CRM, both are copied to the client's OneDrive folder, and Send mails only the PDF.

## Decisions made by the user

| Topic | Decision |
|---|---|
| Multiple proposals | One file. Each option has its own head, logo, description, costing table and red notes. Shared sections print once at the end. |
| Choosing an authority | Fills saved text and fee rows, with last-agreed amounts. Staff change the amounts. |
| Files | Word and PDF are both kept in the CRM. Only the PDF goes to the client. |
| View | Opens the document in the browser instead of downloading it. |
| OneDrive | The same copy is saved in the client's OneDrive folder, through the Client Module on this PC. No Microsoft connection is built. |
| Sending | A Send button in the CRM mails the PDF. |
| Numbering | The main AB Capital quote numbering, with no separate series. |
| Old form | Kept. |

## Assumptions, as presented on 2026-11-05 and not objected to

- Only the Business Setup tab gets this. Accounting, Tax Compliance and Business Banking do not change.
- The Ref prints under the date. The client name does not print.
- Bank details print on every proposal.
- The sender mailbox is `info@abcapital.ae`, proved by one real test mail to an address the user names.
- Proposals print no VAT calculation. The existing "Plus, Applicable Taxes" note stays. `vat_mode` is `none`.

## What does not change

- The old form, reached by a Proposal / Old Quotation switch at the top of the Business Setup tab. Proposal is the default.
- The Business Setup case flow and the Company Templates quote and letter generators.
- The numbering settings screen.

## The form

**1. Client (not printed)**

| Field | Rule |
|---|---|
| Client name | Required. Uses the existing client picker, which also fills the fields below and links the client code. |
| Contact person | Required |
| Email | Required and must be valid |
| Phone | Optional |

**2. Proposal options.** At least one. **+ Add option** adds another, and each option can be removed.

| Field | Rule |
|---|---|
| Licence authority | Required. Chooses a saved set and fills the option. |
| Business activity | Required. Typed. The label prints as "Business Activity". |
| Description | Prefilled, editable |
| Table title | Prefilled from the authority, for example "Business Formation-IFZA", editable |
| Services | At least one. See below. |
| Package includes | Prefilled, editable, prints only if not empty |
| Red notes | Prefilled, editable |

Logo and timeline image come from the saved set and print when the set has them. They are not edited per quote.

**Services**

- A service has a name, an optional remark, and either an amount or sub services.
- A sub service has a name and an amount.
- A service with sub services takes its amount from their sum, and it cannot be typed.
- Zero is allowed, for lines like "Complimentary CT Registration". Blank is not.
- Rows can be added, removed and moved up or down.
- The form shows AED and USD totals per option.

**3. Shared sections, printed once.** Prefilled from Option 1's authority. Changing Option 1's authority refills them only after a warning, because staff edits would be lost.

| Section | Content |
|---|---|
| Add-on services | Rows of name and amount, or name and text such as "Rate will be customized" |
| Documents required, payment terms, scope of work, notes | Editable lists |

Bank details and contact come from Settings and are not edited on the form.

## Calculations

- Service amount with sub services = sum of its sub services.
- Option total = sum of its service amounts.
- USD = AED / rate, rounded to whole dollars. The rate comes from a new Settings value, default 3.6725, and is stored with each quote. An option's USD total is calculated from its AED total, not by adding rounded rows.
- **Options are alternatives. They are never added together, and no grand total prints.**
- The server recalculates all totals and rejects a service whose amount disagrees with its sub services.

## The document

Letter size and style follow the old proposals: bordered pages, Traction and AB Capital logos in the header, the office address in the footer, and the red table theme.

```
Business Formation Proposal
Date, Ref
Option 1 (the "Option n" heading prints only when there is more than one option)
  Business Activity / License Authority
  Authority logo, description
  Approximate Costing of Company Incorporation
  Table: title, Particulars, AED, USD, Remarks, rows, Total
  Package includes, red notes, timeline image
Option 2 ... on a new page
Add-on services
Terms & Conditions: documents required, payment terms
Bank details, scope of work, notes, contact
```

The Remarks column prints only for options where a row has a remark. A service with sub services prints as a bold row with its subtotal and its sub services indented below it. A service without sub services prints as one plain row.

**How it is built:** a new `AB_Capital_Proposal_Template.docx`, made by a script and holding tags only, no prices or bank details. It is filled with docxtemplater in the browser, like other Hub documents. Logo and timeline images go in through raw-XML tags plus a JSZip step that adds the media files.

**PDF:** made in the browser from the Word file with the existing Ardentax `docxToPdf`. Its pages are images, so text cannot be selected, and layout can differ slightly from Word. If it does not reproduce these tables acceptably in testing, this is reported to the user before anything else is decided.

## Reference numbers

- `hub_next_number('Business Setup', 'quote')`, format `ABC/{YYYY}/{MM}/BSQ{SERIAL}`, as set in Settings.
- One counter is shared with old-form quotes, Company Templates quotes and case quotes.
- One quote takes one number whatever its option count.
- The trial render runs before the number is taken, so a bad template uses no number.
- The Voucher Register records it through the existing trigger.
- The next real number is expected to be `BSQ006`, because test documents used up to 005. Numbers used by others before release move this.

## Data

New migration in `Database Module/Template Hub Base/migrations/`, with rollback and local tests. Live only with approval.

**`hub_documents`, new columns**

| Column | Purpose |
|---|---|
| `word_path` | The Word file. For proposals, `storage_path` holds the **PDF**, so View and every existing reader of `storage_path` get the PDF and never the Word file. |
| `onedrive_path`, `onedrive_saved_at` | Where and when it was copied |
| `mail_sent_at`, `mail_sent_by`, `mail_sent_to` | The send record |

**A proposal row:** `doc_type` `quote`, department `Business Setup`, `library_template` `AB Capital/Proposal`, `vat_mode` `none`.

- `field_values.proposal` holds `{ usd_rate, options: [...], shared: {...} }`, a full copy of what printed, so Retry and later views do not depend on the saved sets.
- `lines`, `services` and `total_amount` hold **Option 1**, so the register and other existing readers work.
- The register shows the option count beside the total, for example "AED 10,000 (Option 1 of 2)".

**New table `hub_proposal_authorities`:** key, name, kind (free zone or mainland), description, logo and timeline paths, table title, default service rows, package includes, red notes, add-ons, documents, payment, scope, notes, active, updated at, updated by. Read by signed-in users, written by Hub admins (`hub_is_admin`). Images are stored in the private `hub-documents` bucket.

**Seed:** IFZA, RAKEZ, SHAMS, DET and Abu Dhabi Mainland, from the old proposals. The seed holds prices, so it runs from a file in `D:\Abhijith Projects\CRM Private` and is **not committed**. Known errors are not copied: USD is calculated, and Abu Dhabi's table title is corrected from "Dubai Mainland (DET)". The form shows each set's last-updated date, so staff check its amounts.

**New functions**

| Function | Purpose |
|---|---|
| `hub_proposal_create(p)` | Requires `setup.quotes.manage`. Validates, recalculates, numbers and inserts. |
| `hub_proposal_choose(p)` | Requires `setup.quotes.manage` and an issued proposal. Records the client's option. See below. |
| `hub_proposal_letter_create(p)` | Requires `setup.quotes.manage`. Accepted proposals only. See below. |
| `hub_proposal_attach(id, pdf, word)`, `hub_proposal_saved(id, path)` | Record the files |
| Authority save and archive | Hub admins only. Archived sets stay readable. |

**New Settings values:** USD rate and proposal contact (name, phone, email, website).

## Engagement letter from a proposal

The order is: record the client's choice, accept, then make the letter.

1. **Record the client's choice.** On an issued proposal, the generated documents list shows **Record client's choice**: one radio per option with its authority and total. `hub_proposal_choose` sets `accepted_option` and copies that option's lines, services and total to the quote. The proposal stays issued, and the choice can change while it is issued. A proposal with one option needs no choice.
2. **Accept.** Acceptance goes through the existing paths, which call `business_setup_quote_accept_body`: a signed copy confirmed in the client workspace (Quotes & Agreements), or the client's acceptance in the portal. That body checks the client link, the KYC, the revision chain and the client's evidence, creates the `business_setup_services` rows of the chosen option and writes the audit. A trigger refuses to accept a proposal that has several options and no choice, by any path. The portal lists a proposal only once its choice is set.
3. **Engagement Letter + Mail.** Offered only once the proposal is accepted. The dialog asks for any detail the letter needs that the proposal did not collect (phone, address, licence number, TRN). `hub_proposal_letter_create` requires an accepted proposal and takes the option recorded on the quote; it changes nothing on the quote and refuses an `option` that differs from the choice.

The letter takes only that option's rows, one line per service, and records `accepted_option`. It uses the existing `BSE` series, template and one-letter-per-quote rule. A letter the client rejected is replaced as `hub_document_create` does: the old letter lets go of the quote, becomes superseded, and the new letter points back at it through `revises_id`.

A trigger refuses any letter on a proposal without `accepted_option`, so the older routes cannot silently copy Option 1. In the Company Templates letter generator, proposals are left out of the quote dropdown.

## Files, View, OneDrive, Send

**Generate**, in order:

1. Validate.
2. Trial render.
3. Take the number and create the row.
4. Render Word and make the PDF.
5. Upload both to `hub-documents`.
6. Attach them.
7. Copy to OneDrive.
8. Create the mail draft.

If a step after 3 fails, the row and Ref are kept, and **Retry** rebuilds from `field_values.proposal`.

**View** opens the PDF in a new browser tab through a short-lived signed link, uploaded with content type `application/pdf`. A separate **Word** link downloads the Word file for staff. Old documents keep their current behaviour.

**OneDrive**

- A new Client Module route, modelled on `/api/clients-folder`, writes both files to `C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL\Business Setup\<Client name - code>\Proposals`, or `<Client name>` when no client code is linked.
- The root is a config value. Names are cleaned, as that route already does, and nothing is overwritten: a repeat gets a `(2)` suffix.
- The OneDrive app on this PC syncs the folder.
- **Limit, accepted by the user:** this works only where the Client Module runs. Elsewhere the document shows **Not in OneDrive**, and **Save now** on this PC copies it later from CRM storage. The CRM storage copy is always the safe one.
- The CRM cannot confirm that OneDrive has finished syncing. "Saved" means written to the folder.

**Send**

- A new Edge Function, `proposal-mail-send`, modelled on `ardentax-mail-send` and with JWT verification on, requires `setup.quotes.manage`.
- It attaches only the PDF at `storage_path`. It has no Word option.
- It refuses when there is no PDF or a bad address. A repeat send needs a Resend confirmation.
- It records `mail_sent_*` on the quote.
- The draft stays editable before sending. It quotes the Ref and each option's authority and total, never a sum of options.
- The app asks for confirmation showing the recipient before sending.

## Other systems

- **Client Login:** because `storage_path` is the PDF, a client who can open a proposal gets the PDF. The build must confirm the portal's file name and type handling, and that no route exposes `word_path`.
- **Zoho:** a proposal with more than one option has no single amount until accepted. **Rule: no Zoho draft from a multi-option proposal until an option is accepted.** The build must find how drafts start for `hub_documents` and hold them. If that requires changing the Zoho flow, the user is told first.

## Errors

| Situation | Behaviour |
|---|---|
| Missing field or bad amount | Named message, field highlighted, no number taken |
| Saved set archived or edited after a quote | The quote is not affected, as it holds its own copy |
| PDF fails after numbering | Ref kept, Retry offered, Send disabled |
| Client Module off | Generate still succeeds and shows Not in OneDrive |
| Mail fails | Error shown, not marked sent, can be tried again |

## Testing

- Unit: calculations, rounding, sub service rules, form-to-record mapping.
- SQL: rights, recalculation, rejected mismatches, numbering shared with old quotes, letter trigger, rollback.
- Client Module: path cleaning, no overwrite, CORS, using a temp root.
- Function: PDF-only attachment and refusals.
- **Output check:** rebuild all 5 old proposals through the form and compare Word and PDF with the originals by eye. Also check a 2-option and a 3-option quote, and one with sub services.
- Browser: run the whole flow on the dev server, then one signed-in run on the live site.
- One real test mail, only to an address the user names.

Test documents use the client `TEST CLIENT - DO NOT USE`.

## Release order

Each live step needs the user's approval.

1. Apply the migration and rollback-tested SQL live.
2. Load the seed from the private file.
3. Deploy `proposal-mail-send`, and set its mailbox secret if needed.
4. Merge to `main`, which updates GitHub Pages.
5. Run `npm run deploy:cloudflare`, as standing instruction, and confirm `abcrm` and `crm-abcapital`.
6. Update the Client Module on this PC. **Blocker:** the CRM checkout at `D:\Abhijith Projects\CRM` is on `banking-new-lead-fix`, 303 commits behind `main`, with an uncommitted `Client Module/config.json`. It must move to `main`, or the module must run from another folder. The user chooses.
7. Real signed-in test and the test mail.

## Not in this work

- A Microsoft Graph OneDrive connection.
- Proposal format for other departments.
- Moving the old form's existing documents.
- A client name on the printed proposal.
- Editing the authority logo per quote.

## Open items for the build

- `Proposal-Business Formation-IFZA` has no Word file, only a PDF, so its logo and timeline come from the PDF. A better image from the user is welcome.
- Which old proposals carry a timeline image is confirmed while seeding.
- Header logos follow the old proposals, and the CRM's rebranding note says the logo image still reads AB Capital. Same logo as the old format unless the user says otherwise.
