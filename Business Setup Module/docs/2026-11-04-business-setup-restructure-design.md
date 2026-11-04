# Business Setup Restructure: Design Spec

Date: 2026-11-04. Status: awaiting the user's review. Nothing here is built or applied.

The source request is in `2026-11-04-business-setup-restructure-brief.md`. Where this spec differs from `2026-11-03-business-setup-module-design.md`, this one wins. That spec still applies for anything not restated here, such as form fields, portal separation and legacy import rules.

## 1. Purpose

Run every Business Setup client through one visible pipeline, from lead to Accounts. Each person can see what is waiting, who owns it, how far each service has progressed, and how much the client still owes.

The restructure is done when this flow works in the CRM, for a team-entered lead and a Business Development lead:

Lead → contact and login → client submits → team review → services and scope → quote with VAT → signed quote → payment and voucher → engagement letter → invoice → assignment → service checkpoints → sent to Accounts per service.

## 2. Decisions

| Topic | Decision | Source |
|---|---|---|
| Client link | The login is issued at the Contact stage. The link leads to the existing portal form | User, 2026-11-04 |
| Who records payments | Business Setup and Business Development, in one ledger with one voucher numbering | User, 2026-11-04 |
| Ownership | One owner from pick-up. At Assignment, the owner confirms or the manager reassigns | User, 2026-11-04 |
| Grey amount | A suggestion only. The employee enters a figure, with one click to copy the suggestion | User, 2026-11-04 |
| VAT | Set per fee item, default 5%, added on top. Finance should confirm pass-through fees | User, 2026-11-04 |
| Part payment | Any net payment above zero allows the letter and the start of work. A manager can override with a reason | User, 2026-11-04 |
| Accounts handover | Per service, showing the quote's payment position in the review | User, 2026-11-04 |
| Manager and team | The existing `MANAGER` role and Setup roles. Names to be supplied. CRM admins act until then | User to supply |

## 3. Core concept: the case

A **case** is one client engagement: one lead, one quote revision chain and that quote's services. A client can have several cases over time, and more than one open at once. A case is the unit shown in Leads, Documentation and Cases.

### Stages

| Stage | Meaning | Moves on when |
|---|---|---|
| Lead | Entered by the team or transferred from Business Development | Share link is used |
| Contact | Client row and login exist, and the form is with the client | Client submits |
| Review | Team is reviewing the form | Form is validated |
| Services | KYC is done. Team selects services and scope | Quote is issued |
| Documentation | Quote, signature, payment, letter and invoice are in progress | All items in section 7 are met |
| Assignment | Waiting for an owner to confirm or be assigned | Owner confirms or takes the case |
| In service | Checkpoints are being worked | Every service is Completed or Cancelled |
| Completed | At least one service is Completed, and none is still open | End |
| Cancelled | Every service was cancelled | End |
| Lost | Dropped before service work began, with a reason | End |

Only database functions change the stage, in the same transaction as the event that caused it. Documentation progress is worked out from the records, not stored, because payment can come before or after the quote.

A returning client whose KYC state is Done starts a new case at Services. Otherwise, the case starts at Lead.

A case cannot be marked Lost once it reaches In service, or while it has a net payment above zero. The payment must be refunded first.

Marking a case Lost revokes the client's login only if that client has no other open case, active service or Banking case. The login is shared across the portal, so other work must not lose access.

## 4. Screens

Tabs: **Dashboard · Leads · Review · Documentation · Cases · Clients · Services & Fees · Tasks · Settings**. Styling stays as it is today.

| Tab | Content |
|---|---|
| Dashboard | Section 5 |
| Leads | Sub-tabs: Unassigned, Mine, All. New lead, Take, Share link, Mark lost, Request reassignment |
| Review | The current Onboarding screen, renamed. The reviewer can also complete missing fields and upload documents for the client |
| Documentation | One row per case in Services or Documentation, with a checklist: Services, Quote, Signed, Paid, Letter, Invoice. A second view is the document register, which replaces the Documents tab |
| Cases | One row per case from Assignment onward: owner, services, progress and hold flags. Opening a case shows each service's checkpoints |
| Clients | As today. The workspace gains a Cases section, and **+ New Service** becomes **+ New Case** |
| Services & Fees | Fee list with stored amount and VAT rate, plus the checkpoint lists |
| Tasks | As today |
| Settings | As today, plus Import, which moves here |

## 5. Dashboard

Each figure opens the list behind it. Expiries stay below the figures.

| Figure | Definition |
|---|---|
| Processes pending | Services not Completed or Cancelled |
| Receivables | For each accepted quote, total including VAT less net payments, never below zero |
| Cases completed | Cases at Completed, shown for this month and all time |
| Cases in the pipeline | Cases not at Completed, Cancelled or Lost, with a count per stage |
| Forms to review | Forms that are Submitted or In review |
| Pending after KYC | Cases at Services, meaning KYC is done and no quote has been issued |

Advances on cases with no accepted quote are shown beside Receivables as a separate figure. Imported historical services have no case, so they are left out of these figures.

## 6. Leads and ownership

**Team lead:** name, contact person, phone, email, source and notes are held on the case until a client row exists.

**Business Development lead:** `bd_mark_lead_won` already writes `bd_onboarding_handovers`, but nothing reads it. A handover with queue `Business Setup` creates a case at Lead, and sets the handover to Accepted when someone takes it. The lead's accepted services and agreed fees prefill the quote. A handover to any other queue is ignored. Won still needs an accepted service with an agreed fee, as it does today.

**Share link:** this checks for a duplicate through `client_master_save`, and staff can link an existing client instead. It then issues the login with the existing password email, and creates the form. From this point, Client Master is the source for phone and email. This is the only exception to the rule that contacts live only in Client Master, and it applies only to leads with no client row.

**Taking and reassigning:**
- Anyone with `setup.leads.manage` can take a case that has no owner.
- An owner requests reassignment, and a holder of `setup.cases.approve` approves or refuses it. One request can be pending per case.
- A holder of `setup.cases.approve` can assign or reassign directly, with the change recorded.
- This follows the pattern of `banking_reassign_request` and `banking_reassign_respond`.

**Who can edit:** everyone with `setup.access` can see all cases. Only the owner or a holder of `setup.cases.approve` can update checkpoints.

**New permissions:** `setup.leads.manage` for Admin, Manager, Sales Executive and Document Executive. `setup.cases.approve` for Admin and Manager.

## 7. Documentation

A case leaves Documentation for Assignment when all of these are met:

| Item | Met when | Override |
|---|---|---|
| Quote signed | Staff confirm the signed copy, which marks the quote accepted | None |
| Paid | Net payments are above zero, or the quote total is zero | `setup.payments.override`, with a reason |
| Letter | Engagement letter is issued | None |
| Invoice | An invoice is recorded | `setup.payments.override`, with a reason |

### Services and fees

- Each row has a service, an action, a scope of work and a fee.
- A service with a stored amount shows it as a grey placeholder, with a button to copy it. The placeholder is never saved unless copied or typed.
- A service with no stored amount shows an empty cell.
- `business_setup_fee_items.default_amount` becomes nullable.
- Three items are added with no amount: Company registration, Company renewal and Visa. Today's 24 items are mostly visa cost components, and none is a company service.

### VAT

- `business_setup_fee_items` gains `vat_rate`: 5 or 0, default 5. Only `setup.fees.manage` can change it.
- A quote line takes its rate from the fee item. A typed service with no fee item uses 5.
- For Business Setup, `hub_document_create` sums VAT line by line, rounded per line, and always stores the mode as exclusive. The VAT dropdown is removed from this flow.
- Banking and other departments keep their current calculation.
- The quote screen and Word output show net, VAT and total. All templates must be checked for this.

### Issuing the quote

Issuing needs the client's email and phone, as it does today. The quote message holds the portal link and login ID, and staff can email it or copy it.

**The password is not placed in this message.** Staff use the existing password email to resend it, because only admins can read a stored password, and each view is logged.

### Signed copy

- The client downloads the quote and uploads the signed copy in the portal, through a new `setup_signed_upload` action. Staff can upload it for them.
- Staff confirm or refuse it, with a note the client can see.
- Confirming calls `business_setup_quote_accept`, which now requires a signed copy. It still creates the services and now also creates their checkpoints.
- Revising a quote after an upload refuses the old copy.

### Payments

- `business_setup_payments` gains `case_id`. A payment can be recorded at any stage once the case has a client.
- Net paid is calculated per case, so an advance counts toward the quote without changing an append-only row.
- The overpayment check applies once a quote is accepted.
- Every payment gets a receipt voucher, as it does today.
- If a case has no client when money arrives, **Record payment** runs the same duplicate-checked step as Share link, without issuing a login.
- Business Development records payments from its own lead screen through `business_setup_bd_payment_add`, gated by `bd_can_edit_lead`, for leads transferred to Business Setup.

### Letter

For Business Setup, `hub_document_create` allows a letter only if the quote is accepted and the Paid item is met.

### Invoice

- A new `business_setup_invoice_record` writes number, date, amount and file to the existing `business_setup_invoices`. The client's Invoices section then fills in.
- A case can hold several invoices, such as for part payments.
- This release records invoices by hand. Zoho drafts follow later under the existing drafts-only rule.
- `ZohoInvoicePanel` leaves this module's Accounts step. Banking keeps it.

## 8. Service checkpoints

| Table | Holds |
|---|---|
| `business_setup_checkpoint_sets` | A named list, linked from a fee item through `checkpoint_set_id` |
| `business_setup_checkpoint_steps` | Set, order, label |
| `business_setup_service_checkpoints` | A copy of the steps per service, with done time, done by and note |

Steps are copied when the quote is accepted, so later edits to a list do not change running services.

The only list seeded now is on Company registration: Document collection, Registration pending for approval, Approval, Issue of the license, Completed. The user will supply other lists. They can be added in Services & Fees with no code change. A service with no list keeps today's simple statuses.

Rules:

- Steps are completed in order. Moving back needs a note. Every change goes to the service history.
- Progress is steps done divided by total steps.
- The first step applies the existing start gate and moves the service to In progress.
- The last step calls `business_setup_service_complete`, which still needs an output file unless overridden with a reason.
- Waiting on client and Waiting on government stay as hold flags, and do not count as progress.
- In the portal, clients see step labels and progress, but never notes or staff names.

## 9. Accounts handover per service

- New `business_setup_service_handovers`, keyed by service, replaces the per-quote `business_setup_handovers`. `business_setup_accounts_reviews` gains `service_id`.
- **Send to Accounts** appears on each Completed service, and locks that service and its documents.
- The Accounting Module's `SetupValidation.jsx` lists services, and shows the quote total, net paid, balance, invoices and the other services on that quote.
- Validate and close, or Revert with remarks, applies to that service alone. Revert reopens only that service.
- Payments on a quote stay open until every non-cancelled service on it is with Accounts or closed. `business_setup_quote_locked` changes to match.
- An unpaid balance is shown, and still does not block sending.

The separate Accounting Team job pipeline is not connected by this work.

## 10. Data changes

All in `Database Module/Business Setup Base/migrations`, from `013` onward, re-runnable and tested by running twice.

| File | Holds |
|---|---|
| `013_cases.sql` | `business_setup_cases`, stages, permissions, `case_id` on `hub_documents`, `business_setup_payments` and forms, backfill |
| `014_leads_ownership.sql` | Lead functions, Share link, take, reassignment requests, dashboard |
| `015_documentation.sql` | Nullable amounts, VAT rate, new fee items, line VAT, signed copy, payment by case, letter gate, invoice record |
| `016_checkpoints.sql` | Three checkpoint tables, seed list, quote accept change |
| `017_service_handover.sql` | Per-service handover, reviews, locks |
| `018_portal.sql` | Portal view with progress, signed copy actions |
| `019_bd_transfer.sql` | Reading the Business Development handover, payment from Business Development |

`business_setup_cases` holds: `id`, `case_number`, `client_id` (nullable until Share link), `stage`, `owner_id`, `source`, `bd_handover_id` (unique), `lead_name`, `contact_person`, `phone`, `email`, `notes`, `lost_reason`, `paid_override_reason`, `invoice_override_reason`, and the usual created and updated columns.

Tables stay read-only through the API, with writes through `security definer` functions, as they do today.

**Backfill:** each existing quote chain and form gets a case at the stage its records show. Live holds only test data. Old quote handovers move to the new table, one row per service.

**Import:** `012_legacy_import.sql` is unchanged. Imported historical services have no case. Staff start a case for new work. The import stays on hold until phase 1 is live.

## 11. Errors

- Blocked actions return one plain sentence naming what is missing.
- Two people taking one case: one wins, and the other is told who took it.
- A case whose Share link fails after the client row saves can retry, and reuses the row.
- If the password email fails, the login still exists, and staff can resend it.
- If a Word file fails after the quote saves, the row offers **Create file**, as it does today.

## 12. Testing

SQL tests on throwaway Postgres (`tests/run-local.sh`), running migrations twice:

- Each stage move, and each refusal when a requirement is missing.
- Advance payment before a quote, then the correct balance after the quote is accepted.
- Part payment allowing the letter, no payment refusing it, and the override needing a reason and a permission.
- Line VAT with mixed rates, while Banking and Accounting document totals stay the same.
- A placeholder amount never saved unless entered.
- Reassignment: only one pending, owner cannot self-approve, manager direct change recorded.
- A non-owner refused on checkpoints. Checkpoints in order, moving back needing a note, last step needing an output.
- Later edits to a checkpoint list not changing running services.
- Per-service lock and revert, with sibling services unaffected, and payment lock only once all are sent.
- Lost refused with a net payment. Login kept if the client has other work.
- A client unable to read or upload to another client's quote, and forbidden fields absent from the portal view.
- Business Development: only the `Business Setup` queue creates a case, and a retry creates no duplicate.

`node --test` covers navigation and pure logic. A browser walk covers the whole flow with a real client login, on the existing TEST client.

## 13. Delivery

Build on a new worktree from `origin/main`, on branch `business-setup-restructure`. Local `main` is 177 commits behind, so it must not be the base.

| Phase | Holds | Files |
|---|---|---|
| 1 Pipeline | Cases, Leads, ownership, tabs, dashboard | `013`, `014` |
| 2 Documentation | Fees, VAT, signed copy, payment, letter, invoice | `015`, part of `018` |
| 3 Service work | Checkpoints, per-service handover, portal progress | `016`, `017`, rest of `018` |
| 4 Connections | Business Development transfer and payment | `019` |

Each phase needs the user's separate approval to go live. Each release takes a backup, applies migrations to project `pnnakrhfzyxudjaghoxx`, deploys `client-portal` when it changed, merges, and deploys to both Cloudflare targets, `abcrm` and `crm-abcapital.pages.dev`.

Rollback: restore the previous function versions, drop the new tables and columns, and revert the merge. A rollback script is written and tested with each migration.

## 14. Out of scope

Zoho API calls, including Part B. A connection to the Accounting Team job pipeline. Changes to Banking rules. Automatic reminders. Checkpoint lists other than Company registration. Running the old CRM import. Arabic documents.

## 15. Open items that do not block the build

| Item | Effect until answered |
|---|---|
| Names of the manager and team members | CRM admins act, and only they can approve |
| Finance's view on VAT for pass-through fees | Every item stays at 5% |
| Department agreement on the 24 stored amounts | They show as suggestions, and staff must confirm each figure |
| Checkpoint lists for other services | Simple statuses |
| New Zoho token and Part B | Invoices recorded by hand |
| Schema `bs_rollback`, which still holds client records and password hashes | Stays until the user approves dropping it |
