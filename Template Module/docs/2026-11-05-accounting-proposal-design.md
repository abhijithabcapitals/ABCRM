# Accounting quote and agreement format: design

Date: 2026-11-05. Status: awaiting user review. Base: `main` at b58a28f. Branch: `accounting-proposal`. Nothing is built or live.

## Goal

Template Hub > Service Documents > Accounting generates a new quote and then the signed-style Accounting agreement in the format of the old files in `Desktop\Accounting Template`. The form asks only for what those documents need.

**Done means:** staff generate a multi-option quote under `ACQ`, generate the agreement under `ACE` from the accepted option, an approver releases it with the signature and stamp, View opens the PDF, Word and PDF are kept in the CRM, both are copied to the client's OneDrive folder from this PC, Send mails only the PDF, and staff record the countersigned copy.

## Decisions made by the user

| Topic | Decision |
|---|---|
| Scope | Accounting only. The Business Setup proposal work on branch `proposal-format` stays parked and unpushed. |
| Documents | No old quote format exists, so a new quote is built on the Business Setup logic. The folder's format becomes the agreement, the second document. |
| Signature and stamp | Printed only after approval. |
| Carried from Business Setup | Old form kept, multiple options in one file, sub services with amounts, saved sets that fill text and fee rows, Word and PDF kept, View opens PDF, OneDrive from this PC, Send mails PDF only, main numbering. |

## Assumptions, as presented on 2026-11-05 and not objected to

- Quotes print AED only, because no old Accounting file shows USD.
- Mail is sent from `accounts@abcapital.ae`, the address on the old files, proved by one real test mail to an address the user names.
- Approvers are a new Settings list. Until names are given, only admins may approve.
- The standard text gets these wording fixes: "complaint accounting" becomes "compliant accounting", the schedules use one name throughout ("Schedule 1: Scope of Services", "Schedule 2: Fees for Services"), and "the all accounting" loses "the".
- The Accounting job screen's own Generate quotation and engagement letter buttons stay on the old format in this work.
- Tax Compliance does not change.

## What does not change

- The old form, behind a Quote / Old Quotation switch on the Accounting tab. Quote is the default. Accounting's own tab gets the same switch.
- The Accounting job flow, Business Setup, Business Banking and Company Templates.
- The numbering settings screen.

## The flow

1. **Quote:** numbered from `hub_next_number('Accounting', 'quote')`, format `ABC/{YYYY}/{MM}/ACQ{SERIAL}`.
2. **Accept:** staff choose which option the client accepted.
3. **Agreement:** numbered from `hub_next_number('Accounting', 'letter')`, format `ABC/{YYYY}/{MM}/ACE{SERIAL}`. It starts from the accepted option's services and fees. One agreement per quote.
4. **Approve:** an approver reads the draft PDF and approves. The files are rebuilt with the signature and stamp, and Send unlocks.
5. **Send:** the PDF only.
6. **Signed:** staff record the date and upload the countersigned copy to the existing `signed_at` and `signed_path` columns.

Numbers are shared with old-form Accounting quotes and letters. A trial render runs before a number is taken.

## Quote form

**1. Client (not printed)**

| Field | Rule |
|---|---|
| Client name | Required. Existing client picker, which also fills the fields below and links the client code. |
| Contact person | Required |
| Email | Required and must be valid |
| Phone | Optional |

**2. Options.** At least one, with **+ Add option**.

| Field | Rule |
|---|---|
| Saved package | Optional. Fills the other fields. |
| Package name | Required |
| Description | Optional |
| Services | At least one |
| Notes | Optional list |

**Services**

- A service has a name, a fee basis, and an amount or sub services.
- Fee basis is one of Per month, Per quarter, Per year, One-time, Included, Charged separately, NA.
- The first four need an amount or sub services. The last three have no amount, and print the words "Included in the above mentioned fees", "Will be charged separately" or "NA".
- A sub service has a name and an amount and takes its service's basis. A service with sub services takes its amount from their sum, and it cannot be typed.
- Rows can be added, removed and moved.

**Calculations**

- Each option shows one total per basis, for example "Monthly AED x + VAT" and "One-time AED y + VAT".
- **Different bases are never added together. Options are never added together.**
- All amounts are exclusive of VAT, and VAT is not calculated. The printed text says "+ VAT". `vat_mode` is `exclusive`, with `vat_amount` 0, because recurring fees have no single VAT figure.
- The server recalculates, and it rejects a service whose amount disagrees with its sub services.

**The printed quote** follows the Business Setup costing style: logos, title, date, Ref, then for each option a heading (when more than one), a table of service, basis and AED with sub services indented, the totals per basis, and notes. Then, once: scope, payment terms, bank details, notes and contact. No client name prints, matching the Business Setup format.

## Agreement form

Opened from an accepted quote.

| Field | Source |
|---|---|
| Date | Automatic |
| Client name | From the quote |
| Address lines | Typed, required |
| Attention | Default "The Management", editable |
| Client signatory name and designation | Typed, required |
| Notices email | Client's email, editable. AB Capital's is `accounts@abcapital.ae`. |
| Scope sentence | Built from the service names, editable |
| Schedule 1 rows | Service name from the option, description from the package, editable |
| Scope notes | Start month, transaction range and deviation: typed, optional, printed only if filled |
| Schedule 2 rows | Description and fee wording, built from fee and basis, editable, for example "AED x/- + VAT per month starting from the month of ..." |
| Billing notes | Pick Monthly, Quarterly or On commencement, editable |
| Effective period | Default 12 months and 30 days' notice, editable |

Fixed text, with the wording fixes above: company intro, What We Offer, Our Team, Report to management, Notices and Communications, the standard scope and fee notes, payment mode, Please Note. Bank details come from Settings.

The document follows the old files: the AB Capital header with website, email and mobile, page numbers in the footer, the signature block, then the two schedules.

**Client names, signatories and any fees from the old files are not committed.**

## Signature and stamp

**Security rule:** the image exists only in the private `hub-documents` bucket, under a new `accounting-signature/` path, and the repo never holds it. The old files holding it are never committed.

- An admin uploads the image in Settings. It is stored with the upload date and uploader.
- **Reading the image:** the bucket's read policy allows any signed-in user, so the image is **not** read by the browser path used for other files. A new storage policy excludes `accounting-signature/` from general reads, and only `hub_acct_can_approve()` users may read it. Rebuilding on approval runs in the approver's browser.
- **Before approval:** the Word file and PDF show a blank signature line and a "Draft, not approved" mark, and Send is refused by the server.
- **On approval:** the server checks the approver list and records `approved_by` and `approved_at`. The browser rebuilds both files with the image and replaces the stored paths. Approved files are readable by every Hub user, so the signed PDF itself is not restricted.
- **An approver may not approve an agreement they created**, unless they are the only approver. This keeps the check meaningful.
- **Editing after approval** clears the approval and rebuilds the draft. The approved files are kept in history, not deleted, and the send record stays.
- **No image uploaded:** Approve is refused with a named message.

## Data

New migration `Database Module/Template Hub Base/migrations/008_accounting_proposals.sql`, with rollback and local tests. Live only with approval. Branch `proposal-format` also has a file numbered 008. Whichever lands second is renumbered, and shared columns use `add column if not exists`.

**`hub_documents`, new columns:** `word_path`, `onedrive_path`, `onedrive_saved_at`, `mail_sent_at`, `mail_sent_by`, `mail_sent_to`, `approved_by`, `approved_at`.

For these documents `storage_path` holds the PDF and `word_path` the Word file, so every existing reader gets the PDF.

**Quote row:** `doc_type` `quote`, department `Accounting`, `library_template` `AB Capital/Accounting Quote`, `vat_mode` `exclusive`.

**Agreement row:** `doc_type` `letter`, department `Accounting`, `library_template` `AB Capital/Accounting Agreement`, `parent_id` the quote.

**`field_values`** holds a full copy of what printed:

```js
// quote
field_values.quote = {
  accepted_option: null,            // 0-based
  options: [{
    package_key, name, description, notes: [string],
    services: [{ name, basis, amount, subs: [{ name, amount }] }],
  }],
  shared: { scope: [string], payment: [string], notes: [string] },
}
// agreement
field_values.agreement = {
  accepted_option, address: [string], attention, signatory_name, signatory_title, notices_email,
  scope_sentence, schedule1: [{ name, description }], scope_notes: [string],
  schedule2: [{ description, fee }], billing, billing_notes: [string], effective_months, notice_days,
}
```

**`lines`, `services`, `total_amount`** hold Option 1, until an option is accepted, and then that option. `total_amount` is the monthly total if there is one, otherwise the total of the first basis present in the order Per quarter, Per year, One-time, or 0 when no service has an amount. The register labels it, for example "AED 10,000 per month (Option 1 of 2)".

**New table `hub_accounting_packages`:** key, name, description, default services, notes, Schedule 1 descriptions, active, updated at, updated by. Read by signed-in users, written by Hub admins. Seeded from the 3 old files with no client details. Prices are seeded, so the seed runs from a file in `D:\Abhijith Projects\CRM Private` and is **not committed**. The form shows each package's last-updated date.

**New Settings values, key `accounting_proposal_defaults`:** approver user ids, signature image path and date, fixed-text sections, and contact details.

**Rights.** The old Accounting flow in Service Documents has no department right, and `accounts.review` belongs to the `ACCOUNTS` role, which has no holders yet, so requiring it would lock everyone out.

| Action | Who |
|---|---|
| Create quote, accept option, create agreement, save to OneDrive, record signed | The same check as today's Accounting quotes through `hub_document_create`, confirmed during the build |
| Send | The same, and only when approved |
| Approve | Approver list, or admins while the list is empty |
| Edit packages, defaults, signature image, approver list | Hub admins, except the approver list and image, which need `role = 'admin'`, because every manager is a Hub admin |

**New functions:** `hub_acct_quote_create(p)`, `hub_acct_accept(p_quote, p_option)`, `hub_acct_agreement_create(p)`, `hub_acct_agreement_update(p)`, `hub_acct_approve(p_id)`, `hub_acct_can_approve()`, `hub_acct_attach(p_id, p_pdf, p_word)`, `hub_acct_saved(p_id, p_path)`, `hub_acct_signed(p_id, p_date, p_path)`, `hub_acct_can_send(p_id)`, `hub_acct_package_save(p)`, `hub_acct_defaults_save(p)`.

A trigger refuses any letter under an Accounting quote unless it is an agreement with a valid accepted option, so the old route cannot create a second kind of letter on it.

## Files, View, OneDrive, Send

**Generate:** validate, trial render, take the number, render Word, make the PDF with the existing `docxToPdf`, upload both, attach, copy to OneDrive, create the mail draft. A failure after the number keeps the row and Ref, and **Retry** rebuilds from `field_values`.

**PDF:** drawn in the browser as page images. Text cannot be selected, and layout can differ slightly from Word. The agreement runs several pages of text, so this is a known risk: if the result is not acceptable in testing, the user is told before anything else is decided.

**View** opens the PDF in a new tab through a short-lived signed link with content type `application/pdf`. **Word** is a separate staff link.

**OneDrive**

- A Client Module route, `POST /api/proposal-folder`, modelled on `/api/clients-folder`, writes Word and PDF to `C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL\Accounting\<Client name - code>\Proposals`, or `<Client name>` with no code.
- The folder root is a config value. Names are cleaned, and nothing is overwritten.
- **Limit, accepted by the user:** this works only where the Client Module runs. Elsewhere the row shows **Not in OneDrive**, with **Save now**.
- "Saved" means written to the folder, not that OneDrive finished syncing.
- After approval the signed files are copied too. The draft stays in the folder under its own name.

**Send**

- A new Edge Function, `accounting-proposal-mail-send`, with JWT verification on, modelled on `ardentax-mail-send`.
- It attaches only `storage_path`, and it has no Word option.
- It refuses a quote without a PDF, an agreement without approval, a bad address, and a repeat without Resend.
- It records `mail_sent_*` after the mail server accepts.
- The draft stays editable, quotes the Ref, and never sums options or bases. The app shows the recipient for confirmation before sending.

## Other systems

- **Zoho:** the `zoho-books` handler already refuses a `hub_documents` quote whose department is not Business Setup. So these documents do not reach Zoho from Template Hub, and no change is needed there.
- **Accounting jobs:** `accounting_job_link_document` takes `total_amount` as the job fee. **Rule:** a job's document picker leaves out a multi-option quote with no accepted option. After acceptance, the job fee shows the labelled total, and staff can change it. The build confirms how the picker lists documents.
- **Client Login:** because `storage_path` is the PDF, a client who can open a document gets the PDF. The build confirms no route exposes `word_path`, and that a draft agreement is not shown to clients before approval.

## Errors

| Situation | Behaviour |
|---|---|
| Missing field or bad amount | Named message, field highlighted, no number taken |
| Package edited after a quote | Quote not affected, as it holds its own copy |
| PDF fails after numbering | Ref kept, Retry offered, Send disabled |
| Client Module off | Generate still succeeds and shows Not in OneDrive |
| Approve with no image, or by a non-approver | Named refusal, nothing changes |
| Approval rebuild fails | Approval is not recorded, draft stays |
| Mail fails | Error shown, not marked sent, can be tried again |

## Testing

- Unit: per-basis totals, sub service rules, no sums across bases or options, fee wording, scope sentence.
- SQL: rights, recalculation, numbering shared with old quotes, accepted option, letter trigger, approval and its clearing on edit, Send refused unapproved, rollback.
- **Security:** a non-approver cannot read `accounting-signature/`, by signed link or download. No committed file holds the image, a client name or a price from the old files.
- Client Module: path cleaning, no overwrite, CORS, using a temp root.
- Function: PDF-only attachment and refusals.
- **Output check:** rebuild the 3 old agreements through the form and compare Word and PDF with the originals by eye. Check a 2-option quote and a quote with sub services. Show the user samples with test data.
- Browser: the whole flow on the dev server, then one signed-in run on the live site.
- One real test mail, only to an address the user names.

Test documents use the client `TEST CLIENT - DO NOT USE`.

## Release order

Each live step needs the user's approval.

1. Apply the migration live.
2. Load the seed from the private file. Admin uploads the signature image and sets approvers.
3. Deploy `accounting-proposal-mail-send`. Check the mailbox secret by name only.
4. Merge to `main`, which updates GitHub Pages.
5. Run `npm run deploy:cloudflare`, as standing instruction, and confirm `abcrm` and `crm-abcapital`.
6. Update the Client Module on this PC. **Blocker:** `D:\Abhijith Projects\CRM` is on `banking-new-lead-fix`, 303 commits behind `main`, with an uncommitted `Client Module/config.json`. It must move to `main`, or the module must run from another folder. The user chooses.
7. Real signed-in test and the test mail.

## Not in this work

- A Microsoft Graph OneDrive connection.
- Business Setup and Tax Compliance formats.
- New formats on the Accounting job screen.
- VAT calculation on recurring fees.

## Open items for the build

- Approver names, from the user.
- How the quote prints scope and payment terms has no old example. Text is proposed in the output check, for the user to correct.
- Which Accounting packages to seed beyond the 3 old files, for example by transaction tier, is the user's choice. The form works with any set.
