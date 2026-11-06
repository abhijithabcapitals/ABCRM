# CRM-wide document signing: design

Date: 2026-11-06. Status: awaiting user review. Branch: `crm-signing` from `main` at 6f0165f. Nothing is built.

## Goal

Every client document the CRM makes can carry the company signature and stamp, added only by an approver of that company, at the moment it is sent or downloaded to send. Unsigned documents can still go out. One shared signing step serves every document family.

The same release fixes how mail signatures look: lines written as `*Regards,*` print in bold without asterisks, and the draft's own closing is left out when a signature is chosen.

**Done means:** an approver can sign any quote, proposal, engagement letter, agreement or receipt voucher in the CRM. Everyone else sends or downloads unsigned. The signature image is never readable by non-approvers. Every signing is recorded with who and when, and the unsigned copy is kept.

## Decisions made by the user (2026-11-06)

| Topic | Decision |
|---|---|
| Who may sign | Approvers only |
| Which documents | All client documents in the CRM |
| Must letters and agreements be signed? | No. Signing is optional for everything, letters and agreements included. |
| Approver lists | One list per company (AB Capital, Ardentax), not per department |
| Approach | One design for everything, then build family by family |

This relaxes a rule now live: an Accounting agreement currently cannot be sent until approved. Under this design, Approve becomes Sign, and an unsigned agreement may be sent.

## Document families

| Family | Documents | Rows | Files today | Sent from the CRM |
|---|---|---|---|---|
| Accounting | Quote, agreement | `hub_documents` (`AB Capital/Accounting …`) | Word and PDF | Yes, `accounting-proposal-mail-send` |
| Business Setup proposal | Proposal | `hub_documents` (`AB Capital/Proposal`) | Word and PDF | Yes, `proposal-mail-send` |
| Business Setup cases | Quote, engagement letter | `hub_documents` with `case_id` | Word | No |
| Service Desk old form | Quotation, engagement letter (Accounting, Tax Compliance, Business Setup) | `hub_documents` | Word | No (mail draft only) |
| Company Templates | AB Capital quote and letter, Company Library fills | `hub_documents` (`library_template`) | Word | No |
| Business Banking | Quotation, engagement letter, fee receipt voucher | `banking_quotations`, `banking_engagement_letters`, `banking_receipts` | Word | No |
| Ardentax | Quote, engagement letter | `ardentax_documents` | Word and PDF | Yes, `ardentax-mail-send` |

The company of a document is Ardentax for `ardentax_documents` and Ardentax library templates, and AB Capital for everything else.

## Signing companies and approvers

One setting, `hub_settings` key `document_signing`:

```json
{ "companies": {
    "ab_capital": { "name": "AB Capital Services FZE", "approvers": ["<uuid>"], "signature_path": "...", "uploaded_at": "...", "uploaded_by": "<uuid>" },
    "ardentax":   { "name": "Ardentax", "approvers": [], "signature_path": null, "uploaded_at": null, "uploaded_by": null } } }
```

- The migration moves the Accounting approver and signature path out of `accounting_proposal_defaults` into `ab_capital`, and Accounting reads from here afterwards.
- **Approver rule:** a listed approver for that company, or, while the list is empty, a CRM administrator (`admin_is()`). Hub admins and managers do not count.
- Only a CRM administrator edits approver lists and uploads images, in Template Hub > Settings > Signing, which replaces the Accounting section's approver and signature fields.
- **Images:** private bucket `hub-documents`, under `signatures/<company>/`. Restrictive storage policies let only that company's approvers read, and only administrators insert, update or delete. Accounting's existing image and policies under `accounting-signature/` move to `signatures/ab_capital/` in the migration, and the old policies are dropped.

## The signing record

New table `document_signatures`:

| Column | Meaning |
|---|---|
| `id` | key |
| `source_table` | `hub_documents`, `banking_quotations`, `banking_engagement_letters`, `banking_receipts`, `ardentax_documents` |
| `source_id` | the document row |
| `company` | `ab_capital` or `ardentax` |
| `signed_by`, `signed_at` | who signed and when |
| `word_path`, `pdf_path` | the signed files |
| `unsigned_word_path`, `unsigned_pdf_path` | what the document held when it was signed |
| `document_changed_at` | the document's change stamp read by the signer |
| `superseded_at`, `superseded_reason` | set when the document changes after signing |

At most one live (unsuperseded) signature per document. The document row keeps its own unsigned files, so nothing downstream breaks. Readers that want the signed copy look up the live signature.

**Functions**

| Function | Purpose |
|---|---|
| `doc_sign_can(p_company text) returns boolean` | Approver check, used by screens and storage policies |
| `doc_sign_record(p jsonb)` | Requires an approver of the document's company, which is derived from the row, never trusted from the caller. Checks the document exists and that the caller may read it, the signed paths sit under that document's own prefix, and the change stamp still matches. Supersedes any older live signature and records the new one. |
| `doc_sign_live(p_table text, p_id uuid)` | The live signature for a document, or null |
| `doc_sign_supersede(p_table text, p_id uuid, p_reason text)` | Called from each family's edit and regenerate paths, and from Accounting's agreement edit |

**Change stamp:** each document needs a reliable "last changed" value. `hub_documents` uses `agreement_changed_at` for Accounting agreements and `created_at` for documents that never change, and families that can be edited get a trigger setting `content_changed_at`. The plan lists each family's stamp.

**Signed file paths**, beside the unsigned ones:
- `<family prefix>/<id>/signed/<uuid>.pdf` and `.docx`
- Ardentax: `ArdentTax (ASP)/<id>/signed/...`
- Banking: under its own storage prefix

Each path stays readable by exactly the people who can read the unsigned file.

## Templates

Every Word template gets an "Authorized Signatory" block for the company: a blank line plus the raw tag `{@signature_xml}`, filled only when signing. Unsigned documents look as today, plus the empty signatory line. The renderer is the shared JSZip image step, taken out of `Template Module/logic/accountingDocx.js` into `Template Module/logic/signDocx.js`, with the Accounting tests kept.

Templates and their builders:
- `Template Module/templates/Service_*`, `AB_Capital_Proposal_Template.docx`, `AB_Capital_Accounting_*`
- `Template Module/ardentax/templates/*`
- `Banking Module/templates/*`

Each builder adds the block, so a rebuild keeps it. The repo is public: templates hold tags only.

## Signing on screen

**Shared service `Template Module/services/signing.js`:**

`signDocument({ table, doc, company, rebuild }, deps)`, in this order:
1. Check `doc_sign_can`.
2. Load the company image.
3. Rebuild the Word file with the signature, using the family's own render function passed as `rebuild(doc, signature)`.
4. Make the PDF with `docxToPdf`.
5. Upload under `signed/`.
6. Call `doc_sign_record`.

A failure before the record leaves nothing signed. Uploaded files from a failed attempt are removed best effort, and only where the bucket allows.

**Where it appears**
- **Families with a Send dialog** (Accounting, proposal, Ardentax): a "Sign before sending" tick, shown only to approvers of the document's company. Ticked, signing runs, then the send uses the signed PDF. A document already signed shows "Signed by <name> on <date>", with the signed copy selected.
- **Families without one:** a "Sign" button on the document's row, approvers only, beside Open and Download. After signing the row shows the signer and date, and offers "Signed copy" and "Unsigned copy". Files that are downloaded and sent by hand get a PDF of the signed copy too.
- Non-approvers see no signing controls, only the status.

## Sending

Each mail function takes `signed: true|false`:
- **`signed: true`:** reads the live signature with the service role, after checking the caller may send this document. It attaches the signed PDF, checking its path sits under that document's signed prefix. With no live signature, it refuses with "This document is not signed. Sign it first or send unsigned."
- **`signed: false`, the default:** attaches the unsigned PDF, as today.

Every existing guard stays: the double-send claim, PDF only, and mailbox ownership in Accounting.

**Accounting changes**
- `hub_acct_can_send` and the claim no longer require approval for agreements.
- `hub_acct_approve` is replaced by the shared signing step.
- `approved_by` and `approved_at` stay as history and are no longer written.
- Editing an agreement supersedes its signature.
- Read-only Accounting screens show the signature status instead of "Awaiting approval".

## Mail signature formatting (all three senders)

- **Bold lines:** a whole line wrapped in asterisks (`*Regards,*`) is bold in the HTML part and printed without asterisks in plain text. This is the same rule as `BOLD_LINE` in `ceo-mail-reply/smtp.ts`, moved into `ardentax-mail-send/rules.ts` `htmlBody`, which all three senders share, and tested there.
- **Closings:** when a signature is chosen, the draft's own closing is left out. Each family's draft builder marks its closing, for example `Kind regards,\nAB Capital Services FZE`, so the sender can drop exactly that block, never guessed text.

## What does not change

- Numbering, the Voucher Register, Zoho, the client login and OneDrive saving.
- Unsigned documents keep their files and paths.
- The CEO tab and Business Development mailers, which already have their own signatures.

## Data and release order

Each step is tested, reviewed, and released live only on the user's approval:

1. **Shared base:**
   - migration `011_document_signing.sql`, with the table, functions, setting and storage policies;
   - the move of Accounting's approvers, image and policies;
   - `signDocx.js`, `signing.js` and Settings > Signing;
   - the bold-line and closing fix.
2. **Accounting** on the shared step: Approve becomes Sign, and the approval requirement is removed.
3. **Business Setup proposal.** The linked session `proposal-template-res-2` owns this code: coordinate with it before editing, and do not edit its files while it is running.
4. **Ardentax:** needs its signature image and approver names.
5. **Business Banking.**
6. **Business Setup case documents.**
7. **Service Desk old form.**
8. **Company Templates.**

Each family's step:
- adds its template block;
- passes its `rebuild` function and `source_table`;
- adds the Sign control and, where it sends, the `signed` flag;
- calls `doc_sign_supersede` on its edit and regenerate paths.

## Errors

| Situation | Behaviour |
|---|---|
| Not an approver | No signing controls; the server refuses `doc_sign_record` |
| No image for that company | "Upload the <company> signature in Settings > Signing first" |
| Document changed after the signer opened it | Refused: "The document changed. Open it again and sign." |
| Rendering or PDF fails | Nothing recorded, unsigned copy unchanged |
| Send asks for signed, no live signature | Refused with a named message |
| Document edited after signing | Signature superseded, row shows "Signature withdrawn: document changed" |

## Testing

- **SQL:**
  - approver rule per company;
  - company derived from the row, never from the caller;
  - path prefix checks;
  - change-stamp refusal;
  - one live signature;
  - supersede on edit;
  - storage policies per company;
  - migration of Accounting's settings, image and policies;
  - rollback.
- **Unit:**
  - `signDocx` (image, relationships, draft vs signed);
  - `signing.js` order and failure paths with fake deps;
  - bold-line HTML and plain text;
  - closing removal.
- **Per family:**
  - template block present and blank when unsigned;
  - signed render contains the image;
  - Sign control only for approvers;
  - send uses the signed PDF when asked.
- **Security:** a non-approver cannot read any company image, cannot record a signature, and cannot send a "signed" document without a live signature.
- **Output check per family:** an unsigned and a signed sample of each document, shown to the user before that family goes live.

## Open items for the user

- The Ardentax signature image and its approvers.
- Whether receipt vouchers need a signature block at all. They are included by default.
- Unsigned documents print an empty "Authorized Signatory" line. Say so if you'd rather it be left out entirely when unsigned.
