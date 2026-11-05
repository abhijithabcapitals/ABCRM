# Business Setup Client Flow: Design Spec

Date: 2026-11-05. Status: awaiting the user's review. Nothing here is built or applied.

This spec replaces the parts of `2026-11-04-business-setup-restructure-design.md` listed in section 2. That spec still applies for anything not restated here: cases, ownership, reassignment, line VAT, the grey suggested amount, and refunds.

The service lists are in `2026-11-05-business-setup-service-checklists.md`.

## 1. Purpose

Run each Business Setup client through one path, from a link the client fills in to Accounting's validation. Staff can see who referred each lead, and the client can see their quote, letter, invoices, vouchers and service progress in their login.

The work is done when this flow runs in the CRM for one test client:

Open link → client input pending review → assigned to a staff member → Client Onboarding → documents validated → quote issued → login emailed → client accepts quote → client accepts letter → Zoho invoice → Pipeline → payment and voucher at any time → every service confirmed → Completion → department admin sends to Accounting → Accounting validates.

## 2. Decisions

All are the user's, 2026-11-05.

| Topic | Decision | Replaces |
|---|---|---|
| Tabs | Dashboard, All Leads, Client Onboarding, Pipeline, Completion, Clients, Services & Fees, Tasks, Settings | Leads, Review, Documentation, Cases tabs |
| Open link | Per staff member, reusable, no client login. Each submission is a new lead marked with the link generator's name | Share link as the way in |
| Login timing | Issued when the quote is issued, after validation | Login at the Contact stage |
| Acceptance | Client clicks Accept or Reject in the portal, for the quote and then the letter. Staff can upload a signed copy for a client who signs on paper | Required signed copy; client upload of signed copy |
| Payment | Blocks nothing. Part or late payment is allowed, and the balance stays visible | Payment above zero before the letter and the work; paid override |
| Client marks paid | A claim only. The voucher comes when staff confirm the money | New |
| Zoho invoice | Drafts-only rule stays. A Publish to client button stores the final PDF in the client's login | Invoices recorded by hand as the only route |
| Completion | One handover per case, sent by a Manager or Admin | Per-service handover |
| Checklists | All 45 services, each item Mandatory, Optional or Not applicable, ticked in any order | In-order steps; one Company registration list |

## 3. Stages

| Stage | Tab | Meaning | Moves on when |
|---|---|---|---|
| Lead | All Leads | No client input yet | A form is submitted, or the owner moves it to Onboarding |
| Review | All Leads | Client input pending review | The owner moves it to Onboarding |
| Onboarding | Client Onboarding | Validation, quote, acceptance, letter, invoice | All items in section 6 are met |
| Pipeline | Pipeline | Service checklists being worked | Every service is Completed or Cancelled, with at least one Completed |
| Completion | Completion | Waiting for the department admin | Admin sends it to Accounting |
| With Accounts | Completion | Accounting is validating | Accounting validates, or reverts it to Completion |
| Completed | Clients | Finished | End |
| Cancelled | Clients | Every service was cancelled | End |
| Lost | All Leads, closed filter | Dropped before Pipeline, with a reason | End |

Existing cases map as follows: Lead and Contact to Lead, Review to Review, Services and Documentation to Onboarding, Assignment and In service to Pipeline. Completed, Cancelled and Lost stay. A case at Assignment with no owner shows as Unassigned in Pipeline.

The existing case rules stay: only database functions change a stage, and a case with a net payment above zero cannot be marked Lost until refunded.

Moving to Pipeline does not require payment. So a case can reach Lost only before Pipeline, and with no net payment.

## 4. All Leads tab

Three collapsible sections, in this order:

1. **Assigned to me:** my open cases at Lead or Review. Expanded by default.
2. **All Leads:** every open case at Lead or Review, plus open Business Development leads (section 11). Each unowned row has **Assign to me**. A row with an owner shows the owner, and reassignment follows the existing request and approve rules.
3. **Client Inputs pending review:** cases with a submitted form. Each row opens the answers and documents.

Each row shows name, source, referrer, owner, age and stage. **Move to Client Onboarding** needs an owner, and only the owner or a holder of `setup.cases.approve` can press it. It runs the existing duplicate-checked client step: staff create a client or link an existing one.

**New lead** stays for leads staff enter by hand. A manual lead has no referrer unless staff choose one. Staff can fill its form themselves in Onboarding.

### Open link panel

On the right of the tab, for holders of `setup.leads.manage`:

- **Generate link** creates a new link owned by the logged-in user, and records who generated it and when.
- Each link shows its address, a copy button, the number of submissions, and **Revoke**.
- A user sees their own links. A holder of `setup.cases.approve` sees and can revoke all links.
- A link has no expiry and any number of clients can use it, until revoked.

## 5. The open form

The address is the CRM site with `?intake=<token>`. `Main Module/src/Root.jsx` sends it to a small public page, outside the staff login and the client portal.

- The page uses the current form from `business_setup_form_versions` and the portal's form component, with document uploads.
- The page shows a short notice on why the data is collected, and a confirmation after submitting.
- There are no drafts and no returning. A client who needs to change something tells staff, and staff edit it in Onboarding.
- Staff correct or complete the form themselves. **Return to client** does not apply to a form from the link, because the client has no login yet.

Each submission creates a case at Review with `source = 'Open link'`, `intake_link_id` and `referred_by`, the link generator. The lead stays unassigned, so referral and ownership are separate. The history records "Referred by [name] through a link generated on [date]".

### Data

- New table `business_setup_intake_links`: `id`, `token` (random, 32 bytes), `created_by`, `created_at`, `revoked_at`, `revoked_by`.
- `business_setup_cases` gains `intake_link_id` and `referred_by`.
- `business_setup_onboarding_forms`: `client_id` and `account_id` become nullable, and it gains `case_id`. A check keeps both required unless the form came from a link.
- New table `business_setup_form_files`: `form_id`, `kind`, `storage_path`, `filename`, `size`, `validated_at`, `validated_by`. When the login is issued, these rows are also written to `client_portal_documents`, so the client sees their own files.

### Security

The form is open to anyone holding the link, so a new public Edge Function, `setup-intake`, handles it. The function holds no staff rights beyond these three actions, and the browser never talks to the tables or bucket directly.

| Action | Does |
|---|---|
| `open { token }` | Returns the form definition, or a plain "link no longer active" |
| `upload_start { token, submission_id, kind, filename, size }` | Returns a short-lived signed upload address for one file |
| `submit { token, submission_id, answers }` | Checks required fields on the server, and creates the case |

- Files go to a private bucket under `intake/<submission_id>/`. Nothing reads them back through this function.
- PDF, JPG and PNG only, 10 MB each, 15 files per submission.
- Limits: 30 submissions per link per day, and 5 per address per hour, with a hashed address and no raw IP stored. A hidden trap field refuses simple bots.
- A submission never reveals whether the client already exists. The duplicate check runs when staff move the case.
- Files with no submission are deleted after 7 days by a scheduled clean-up.
- **Mark as spam** is a Lost reason that also deletes the case's stored files. It needs `setup.cases.approve`.
- There is no captcha, so spam can reach the review queue. Revoking the link stops it.

## 6. Client Onboarding tab

One row per case at Onboarding, with a checklist. Opening a case shows the steps in order:

| Item | Met when | Who |
|---|---|---|
| Fields | Form answers are complete | Owner |
| Documents | Each document is validated | Owner |
| Quote | Issued from the AB Capital Template Hub template | Owner |
| Login | Issued with the quote | Automatic |
| Quote accepted | Client accepted, or staff confirmed a signed copy | Client or staff |
| Letter | Issued from the AB Capital template, needs an accepted quote | Owner |
| Letter accepted | Client accepted, or staff confirmed a signed copy | Client or staff |
| Invoice | Published to the client, or recorded by hand, or overridden with a reason | Owner |

When all are met, the case moves to Pipeline by itself.

### Fields and OCR

Carried data shows first. **Read documents** runs `DOC OCR Module/browser/readDocument.js` in the browser, in the same way as Banking's `KycDocumentFill`, so passports go to no third party. Read values fill empty fields only, and differing values are shown for staff to choose. Staff confirm before saving.

### Quote

The AB Capital template is the default, and the zone templates stay selectable. Line VAT and suggested amounts stay as built in Task 7. The picker lists the 45 services and the existing fee items.

`business_setup_fee_items` gains `is_service`. It is true for the 45. The existing 24 items are set to false, because they are mostly cost lines, and a false line creates no service to confirm. `setup.fees.manage` can change it. The three items added in Task 7 (Company registration, Company renewal, Visa) are dropped, since the 45 replace them. They are not live.

### Login

Issuing a quote also issues the login, if the client has none, through a new portal action `setup_issue_login`:

- It is open to holders of `setup.leads.manage`, because today only admins can email a login, which would block the owner.
- The server generates the password, stores the vault copy as today and emails it from info@abcapital.ae. Staff do not see it on screen.
- A failed email leaves the quote and login in place, and the row shows **Resend**. It resends the stored login without changing the password.

A returning client with a login gets a plain notice email that a new quote is waiting.

### Acceptance

New append-only table `business_setup_acceptances`: `document_id`, `kind` (Quote or Letter), `revision`, `decision` (Accepted or Rejected), `note`, `source` (Portal or Staff), `account_id`, `username`, `created_at`, `created_by`, `signed_quote_id`.

- The portal shows the document and **Accept** or **Reject**. Reject needs a note, which staff see.
- Accept records the time, login and document revision, and calls the existing accept logic, which creates the services.
- A revised quote cancels the earlier acceptance state, and the client decides again.
- An expired quote cannot be accepted. Staff reissue it.
- **Staff upload** uses `business_setup_signed_quotes`, with source Staff, and applies to letters too. The client's own `setup_signed_upload`, built in Task 8 and not live, is removed.
- A letter no longer needs a payment, only an accepted quote.
- The paid override from Task 8 is removed.

**Known limit:** admins can read client passwords, under the 2026-11-03 decision. A click is therefore weaker evidence than a signature, if a client disputes it. Staff can still take a signed copy where it matters.

### Invoice

- **Create Zoho draft** uses the existing `ZohoPanel` on the accepted quote. Staff review and send it in Zoho, as the drafts-only rule requires.
- **Publish to client** calls a new `zoho-books` action, `document_publish`. It refuses a document still in Draft status, reads the PDF, stores it, and writes `business_setup_invoices`.
- **Record invoice** stays through `business_setup_invoice_record`, by hand with an uploaded PDF. It covers a second invoice for a part payment, and any time Zoho is unavailable.
- The existing invoice override, with a reason and `setup.payments.override`, stays.

## 7. Payments

Staff can record a payment at any stage once the case has a client. Payments continue through Pipeline, Completion and With Accounts until Accounting closes the case, as the existing ledger rules allow.

### Client marks as paid

New table `business_setup_payment_claims`: `case_id`, `account_id`, `amount`, `paid_on`, `reference`, `proof_path`, `status` (Pending, Confirmed, Refused), `decided_by`, `decided_at`, `note`, `payment_id`.

- The portal offers **I have paid** on each invoice, with amount, date, reference and an optional proof file.
- The claim shows on the case and on the Dashboard. It does not change the balance.
- **Confirm** opens the payment form with the claim's values. Saving adds the payment and creates the receipt voucher through the existing functions.
- **Refuse** needs a note the client can see.
- Client sees Pending, Confirmed or Refused, and each voucher.

## 8. Pipeline tab and checklists

One row per case at Pipeline: owner, services, progress, balance and hold flags. Opening a case shows each service with its own list.

### Data

| Table | Holds |
|---|---|
| `business_setup_checkpoint_sets` | Name, category, active. Linked from the fee item by `checkpoint_set_id` |
| `business_setup_checkpoint_steps` | Set, order, label, `requirement` (Mandatory or Optional) |
| `business_setup_service_checkpoints` | A copy per service: label, order, requirement, `state` (Open, Done, Not applicable), reason, done by and time |

The seed comes from the checklist file. An item with "(if ...)" or "(where ...)" starts as Optional. Others start as Mandatory. Holders of `setup.fees.manage` can edit lists in Services & Fees with no code change. Lists are copied when the quote is accepted, so later edits leave running services unchanged.

### Rules

- Items can be ticked in any order. Only the owner or a holder of `setup.cases.approve` can change them.
- Not applicable needs a reason. Unticking needs a note. Each change goes to the service history.
- Progress is Done items divided by all items except Not applicable.
- **Confirm service** needs every Mandatory item to be Done or Not applicable. It turns any open Optional item into Not applicable, with the reason "Not needed", and reaches 100%.
- Confirming calls `business_setup_service_complete`, which still needs an output file unless overridden with a reason.
- The service payment start gate is removed for services on a case. Imported services keep their rules.
- Waiting on client and Waiting on government stay as hold flags.
- A service with no list, such as a typed line, keeps simple statuses and is confirmed the same way.
- The portal shows item labels and progress, and never reasons, notes or staff names.

## 9. Completion tab

- A case arrives when every service is Completed or Cancelled, with at least one Completed.
- A row shows services, quote total, net paid, balance, invoices, vouchers and pending claims.
- **Mark completed and send to Accounting** needs `setup.cases.approve`. An unpaid balance is shown and does not block.
- It uses the existing `business_setup_handovers`, keyed by accepted quote, and the existing Accounting `SetupValidation.jsx` screen. The stage becomes With Accounts, and services and documents lock.
- Accounting's Validate and close makes the case Completed. Revert with remarks returns it to Completion, and the admin reopens what is needed.

A case has one accepted quote chain, so per-quote handover is per-case. `business_setup_service_handovers` from the earlier spec is not built.

## 10. Client portal

| Section | Client can |
|---|---|
| Details | See their details, and request changes as today |
| Quotes | View, Accept or Reject |
| Letters | View, Accept or Reject |
| Invoices | View published invoices, and mark as paid |
| Vouchers | View each receipt voucher |
| Services | See each service's list and progress |
| Documents | See their own uploads |

New portal actions: `setup_decide`, `setup_payment_claim`, and `setup_issue_login` (staff). Every read and write is scoped to the logged-in account.

## 11. Business Development

The 2026-11-05 rule stays: any open Business Development lead can be picked up with Assign to me, the BD owner stays, and Won attaches to the existing case. A handover with queue `Business Setup` creates a case at Lead when none exists. Accepted services and agreed fees prefill the quote. BD payment recording stays as in the earlier spec.

Open link leads stay in Business Setup, and do not appear in Business Development's All Leads.

## 12. Dashboard

The earlier figures stay, with these changes:

| Figure | Definition |
|---|---|
| Client inputs to review | Submitted forms |
| Awaiting client | Quotes and letters issued and not decided |
| Payment claims | Pending claims |
| At Completion | Cases waiting for the department admin |

Forms to review and Pending after KYC are removed. Each figure opens its list.

## 13. Data and code

Work continues on branch `business-setup-restructure`, after merging `origin/main`. The two template `.docx` conflicts are settled by taking `main`'s copies and re-running `Template Module/scripts/build_service_templates.py` if the branch's changes are still needed.

`015` and `018` are not live, so they are edited in place.

| File | Holds |
|---|---|
| `015_documentation.sql` | Drops the paid gate, the paid override, and the three fee items. Adds `is_service` |
| `016_client_flow.sql` | New stages and mapping, acceptances, payment claims, start gate change |
| `018_portal.sql` | Portal view, decide and claim. Removes client signed upload |
| `019_intake.sql` | Links, nullable form columns, form files, intake functions |
| `020_checkpoints.sql` | Three tables, 45 services and lists, completion functions |
| `021_bd_transfer.sql` | Business Development pick-up and handover |

Edge Functions: new `setup-intake`, changed `client-portal`, and changed `zoho-books` (`document_publish`).

Screens: `logic/nav.js`, new `AllLeads.jsx`, `IntakeLinks.jsx`, `ClientOnboarding.jsx`, `Pipeline.jsx`, `Completion.jsx`, a public `IntakeForm.jsx`, and portal sections in `ClientPortal.jsx`. `Leads.jsx`, `Onboarding.jsx`, `DocumentationPage.jsx`, `Cases.jsx` and `ShareLink.jsx` are reused or removed as the plan sets out.

Styling stays as it is today. Each migration is re-runnable with a tested rollback.

## 14. Errors

- A blocked action returns one plain sentence naming what is missing.
- A revoked or wrong link shows a plain message and no form.
- An upload that fails leaves the form as filled in, and only that file retries.
- A double click on submit creates one case, because `submission_id` is unique.
- Two people pressing Assign to me: one wins, and the other is told who took it.
- Zoho unavailable: **Record invoice** stays open.

## 15. Testing

SQL tests on throwaway Postgres (`tests/run-local.sh`), running migrations twice:

- Each stage move, each refusal, and the mapping of existing stages.
- A link: multiple submissions, each tagged with the generator, none assigned. A revoked link refused. Limits enforced.
- A public caller unable to read any case, form or file.
- Move to Onboarding refused with no owner, and by a non-owner.
- Quote issue issues one login, and a retry issues no second login.
- Client acceptance, including another client's document refused, an expired quote refused, and revision clearing acceptance.
- Letter refused before quote acceptance, allowed with no payment.
- Pipeline reached with zero payment. Part payment balance correct.
- A claim leaves the balance unchanged, and only confirmation creates a voucher.
- `document_publish` refused on a Draft.
- Mandatory item blocks Confirm. Optional item does not. Not applicable needs a reason. Later list edits leave running services unchanged.
- Completion needs every service closed, and a non-admin is refused. Unpaid balance does not block. Revert returns to Completion.
- Forbidden fields absent from the portal view.
- Banking and Accounting behaviour unchanged.

`node --test` covers navigation, progress and pure logic. A browser walk covers the whole flow with the TEST client. The live link is tested with one test submission, and that case is then marked Lost.

## 16. Delivery

| Phase | Holds |
|---|---|
| A Core flow | Merge main, stages, tabs, All Leads sections, Onboarding, acceptance, letter, invoice, claims. Cases screen becomes Pipeline with simple statuses |
| B Open link | `setup-intake`, public form, link panel, clean-up |
| C Service work | 45 lists, Pipeline checklists, Completion |
| D Connections | Business Development pick-up and transfer |

Each phase needs the user's approval to go live. Each release takes a backup, applies migrations to project `pnnakrhfzyxudjaghoxx`, deploys changed functions, merges and pushes `main`, and deploys to `abcrm` and `crm-abcapital.pages.dev`. A rollback script is written and tested with each migration.

## 17. Out of scope

Automatic reminders. A connection to the Accounting Team job pipeline. Changes to Banking rules. Editing or sending Zoho documents from the CRM. Running the old CRM import. Arabic documents. Captcha. Removing readable client passwords.

## 18. Open items that do not block the build

| Item | Effect until answered |
|---|---|
| Nobody holds the `ACCOUNTS` role | Cases sent to Accounting cannot be validated by a real user |
| One-client Zoho test still open, and staff were asked not to press Create | Use Record invoice by hand |
| Assigning Syyed and Garima as `MANAGER` on live | Needs the user's go-ahead at release. CRM admins act until then |
| Prices for the 45 services | Empty fee cells, and staff enter each figure |
| Corrected zone templates not uploaded | Zone quotes lack Net and VAT rows, and the AB Capital template is unaffected |
| AB Capital templates and logo still carry the old name | Quotes and letters show it until replaced |
| Wording of the notice on the public form | A short plain default is used; the user should check it against privacy advice |
| `bs_rollback` schema holds client records and password hashes | Stays until the user approves dropping it |

Settled by the user on 2026-11-05: VAT of 5% goes on top of every quoted price, government fees included. The 24 stored amounts are agreed. Anyone onboarding a client can issue a login. Invoices use the existing Zoho token. The open link panel also shows on the Client Onboarding tab.
