# Business Setup Workflow: Design Spec

Date: 2026-11-02. Status: awaiting approval. Nothing here is built or applied.

## 1. Purpose

Give the Business Setup department one place to take a client from KYC to a paid, tracked service, and to handle every later service for that client.

Services covered: company registration (mainland and free zone), visas (investor, employment, sponsor and others), legal documents for business registration and deregistration, and AML, each with rectification, renewal and cancellation.

The module is done when a member of staff can complete this flow in the CRM, and each document lands in the right folder:

KYC → select services → quote → accepted → agreement → full or part payment → receipt voucher → service tracked to completion.

## 2. Agreed decisions

| Topic | Decision |
|---|---|
| Compliance spec | This is built first. `2026-11-02-client-compliance-design.md` (worktree `CRM-setup`, unapproved) later becomes extra workspace tabs and must be adjusted to these tables |
| Fee list | Every amount is a client price, editable on the quote. VAT follows the quote's VAT treatment |
| After payment | Simple service tracker, not fixed steps per service |
| Quote and letter engine | Extend `hub_documents`. No copy of Banking's quote tables |
| Where data lives | Supabase, tables `business_setup_*`. `Database Module/Business Setup Base` holds migrations, tests and docs. The browser-hosted CRM cannot reach a folder on one PC; Banking Base works the same way |
| Client identity | `client_master` (`CL000001`). No second client table |
| Leads | No Leads tab. The flow starts at **+ New Client**: pick from Client Master or add one |
| KYC for a company being formed | Licence fields are not required |

## 3. Out of scope

Compliance tracking and public onboarding (see above), lead pipeline, Accounts handover, fixed step workflows per service, sending mail from the CRM, Arabic documents.

## 4. Screens

Tabs: **Dashboard · Clients · Services & Fees · Documents · Tasks · Settings**. Shell and permission pattern follow `BankingModule.jsx`, using `banking.css` and `@banking/components/shared`.

| Tab | Content |
|---|---|
| Dashboard | Open quotes, accepted without agreement, outstanding balances, active services, expiries in the next 90 days |
| Clients | All Business Setup clients: name, Client ID, active services, balance. Click opens the Workspace |
| Services & Fees | Fee master, editable without a software change |
| Documents | All quotes, letters and receipts for the department, including older documents |
| Tasks | Open tasks across clients |
| Settings | Numbering link, roles, Word template status |

**Client Workspace** tabs:

| Tab | Holds |
|---|---|
| Overview | Client details, outstanding balance, active services, upcoming expiries, **+ New Service** |
| KYC | Company, partner and UBO details, **Fill from documents** |
| Services | Tracker lines |
| Quotes & Agreements | Each quote and letter with status and mail draft |
| Payments | Ledger and receipt vouchers |
| Documents | Uploaded client files and generated files |
| Tasks & Activity | Follow-ups and full history |

A returning client starts at **+ New Service** and does not repeat KYC. A warning shows if KYC is incomplete, and quoting is blocked until the required fields are filled.

## 5. Workflow

### 5.1 KYC
Identity fields (name, email, phone, licence, TRN) are saved to `client_master` through `client_master_save`. Everything else goes to the KYC tables.

Required: client name, contact person, email, phone, proposed or current business activity, company status (New or Existing), and at least one partner with name and nationality. An existing company also needs licence number, licence expiry and issuing authority.

Document reading goes through `DOC OCR Module` via `readDocuments`. Extracted values fill the form for a person to check. With the Client Module off, staff type the details.

### 5.2 Select services
Staff choose from `service_items` or fee items, set an action for each line (New, Renewal, Rectification, Cancellation), and confirm the fee. The fee master fills the amount and it stays editable.

Lines in `hub_documents.lines` keep their current fields and gain `service_name`, `action` and `fee_item_id`. `description` shows the action in front of the name, except for New. The engagement letter's limitations lookup in `ServiceDesk.finish` currently matches on the description, so it must match on `service_name` when present.

### 5.3 Quote
Generates `BSQ` through `hub_document_create`, with Word file and mail draft.

| Status | Meaning |
|---|---|
| Issued | Waiting for the client |
| Accepted | Accepted, with date and person. Creates tracker lines |
| Rejected | Rejected, with date, person and reason |
| Superseded | Replaced by a revision |

A revision is a new quote with `revises_id`, allowed only while the old one is Issued. An expired quote can still be accepted after a warning. Only one quote in a revision chain can be Accepted.

### 5.4 Agreement
Generates `BSE`, only from an accepted Business Setup quote, enforced in `hub_document_create`. The existing rule of one letter per quote stays. Staff then record signing with date and signed scan.

### 5.5 Payment and receipt
Each payment belongs to an accepted quote. Recording one creates its receipt in the same transaction, numbered `ABC/YYYY/MM/BSR001`.

- Outstanding = quote total minus net payments on it.
- A payment above the outstanding balance is refused unless the user holds `setup.payments.override` and gives a reason.
- Payments and receipts are never edited or deleted. A mistake is fixed by a reversal entry, which needs a reason, and the receipt shows as Reversed.
- Work may start before payment. The balance stays visible.

The Word receipt is rendered from `Fee_Receipt_Voucher_Template.docx`, with the quote number in its case reference field.

### 5.6 Service tracker
Accepting a quote creates one `business_setup_services` row per line. Fields: service, action, owner, status, start date, completion date, expiry date, notes.

Statuses: Not started, In progress, Waiting on government, Completed, Cancelled. Every change writes to the status history. Cancelling needs a reason and does not change any payment; a refund is a separate ledger entry.

An expiry date shows on the Dashboard and Overview. A renewal is a new quote; the renewal line links back to the earlier service through `renews_service_id`. No automatic reminders in this phase.

## 6. Data

Migrations go in `Database Module/Business Setup Base/migrations`, all re-runnable, and run after Client Base, Services Base, Template Hub Base and Voucher Base.

**`hub_documents` gains** `client_id` (references `client_master`), `status`, `status_at`, `status_by`, `status_reason`, `revises_id`, `signed_at`, `signed_path`. All are nullable or defaulted. Accounting and Tax documents behave as before.

**New tables:**

| Table | Holds | Writes |
|---|---|---|
| `business_setup_kyc_profiles` | One per client: company status, activity, jurisdiction, licence, business details | RPC |
| `business_setup_kyc_partners` | Partners, shareholders, UBO flag, passport and Emirates ID | RPC; reading needs `setup.kyc.sensitive` |
| `business_setup_fee_items` | Group, name, default amount, optional `service_item_id`, active flag | RPC |
| `business_setup_services` | Tracker lines | RPC |
| `business_setup_service_history` | Status changes | Append-only |
| `business_setup_payments` | Ledger: date, amount, method, reference, type (Payment, Refund, Reversal), `reverses_id` | Append-only |
| `business_setup_receipts` | Receipt number, payment, file locations | Append-only except file locations |
| `business_setup_documents` | Uploaded client files, in private bucket `business-setup-documents` | RPC |
| `business_setup_tasks` | Client, owner, due date, status | RPC |
| `business_setup_activity` | History of every action; identity numbers masked | Append-only |

**Functions to extend:**

| Function or object | Change |
|---|---|
| `hub_number_counters` check, `hub_next_number`, `hub_serial_of`, `hub_numbering_status`, `hub_numbering_save` | Accept kind `receipt` |
| `document_numbering` setting | Add Business Setup receipt format |
| `hub_document_create` | Take `client_id`; Business Setup letters need an accepted quote |
| `voucher_register` source check and read policy | Add source `business_setup`; receipts register through a trigger |
| `voucher_set_local` | Update the receipt's local path for that source |
| `client_base_list()` | Add the Business Setup line |

**New RPCs:** `business_setup_my_access`, `_kyc_save`, `_partner_save`, `_partner_delete`, `_fee_item_save`, `_quote_accept`, `_quote_reject`, `_letter_sign`, `_payment_add`, `_payment_reverse`, `_receipt_attach`, `_service_update`, `_task_save`, `_document_add`, `_client_list`, `_workspace`, `_dashboard`.

**Older documents:** the six `BSQ` and `BSE` files already generated keep their numbers. Their rows stay Issued with no `client_id`; no acceptance is assumed. They are listed under **Documents**, where staff can link one to a client.

**Template Hub:** it can still create Business Setup quotes. Its letter button for that department is replaced by a note to continue in the Business Setup tab, since the database refuses a letter without an accepted quote.

## 7. Fee master seed

The list is the company's price list and the repository is public, so the seed goes in the git-ignored `Business Setup Base/private/`, as Banking's does. Names are stored as the user typed them, apart from the visit visa labels, which are corrected from `30ays` and `Outisde UAR`. Group names marked * are assumed and editable.

| Group | Item | AED |
|---|---|---|
| Applications* | Real Estate RERA APP | 10,000 |
| Applications* | Investment Commericial | 10,000 |
| Applications* | VAcation Home - DTCM App | 3,000 |
| Mainland | Company Update | 950 |
| Mainland | New Client | 1,300 |
| Mainland | Visa cancellation | 750 |
| Mainland | Work Permit Cancel | 750 |
| Visa processing* | Company Update Offer Letter | 650 |
| Visa processing* | Dubai Wapp Insurance | 190 |
| Visa processing* | Labour Fees | 3,000 |
| Visa processing* | Entry Permit | 1,160 |
| Visa processing* | Change Status | 720 |
| Visa processing* | Medical | 320 |
| Visa processing* | EIP App | 380 |
| Visa processing* | Visa Stamp | 560 |
| Visa processing* | Final Submission | 285 |
| Visa renewal | Labour Fee (option 1) | 3,500 |
| Visa renewal | Labour Fee (option 2) | 4,000 |
| Visa renewal | Labour Insurance | 190 |
| Visa renewal | Medical & EID | 885 |
| Visa renewal | Visa Stamp | 650 |
| Visa renewal | ILUE | 130 |
| Visit visa | Outside UAE, 30 days | 400 |
| Visit visa | Outside UAE, 60 days | 600 |

The pasted service hierarchy is mostly in `service_categories` already (groups 1, 8, 9, 10). The plan compares it item by item and adds only what is missing.

## 8. Files

Word files go to private storage (`hub-documents`) and, through the Client Module, to:

```
Database Module/Generated Documents/Business Setup/
  Quotes Generated/       setup_quote (exists)
  Engagements Generated/  setup_letter (exists)
  Receipts Generated/     setup_receipt (new key in Client Module/config.json)
```

`pcKind` in `hubApi.js` already resolves `setup_receipt` for a receipt in this department. With the Client Module off, the online copy is kept, the row shows **Not in PC folder**, and it can be saved later.

Signed agreements and client uploads go to `business-setup-documents` only.

## 9. Permissions

Reuse the banking role system and `banking_can`. New permissions:

| Permission | Allows |
|---|---|
| `setup.access` | Open the tab |
| `setup.kyc.manage` | Edit KYC |
| `setup.kyc.sensitive` | See partner passport and ID values |
| `setup.quotes.manage` | Issue, accept, reject, revise, generate letters |
| `setup.payments.manage` | Record and reverse payments |
| `setup.payments.override` | Accept a payment above the balance |
| `setup.services.manage` | Update the tracker and tasks |
| `setup.fees.manage` | Edit the fee master |

Tables are read-only through the API, with changes through the RPCs. CRM admins get all permissions. Staff roles are assigned in Settings.

## 10. Code layout

| Path | Purpose |
|---|---|
| `components/BusinessSetup.jsx` | Shell, permissions, navigation |
| `components/{Dashboard,Clients,Workspace,FeeMaster,Documents,Tasks,Settings}.jsx` | Pages |
| `components/workspace/*.jsx` | One file per Workspace tab |
| `components/NewServiceFlow.jsx` | Service selection and quote |
| `logic/*.js` | Pure rules: KYC completeness, balances, line building, status labels |
| `services/businessSetupApi.js` | RPC and storage calls |
| `tests/` | `node --test` |

`ServiceDesk` stays as it is for other departments. Its document generation (`renderTemplate`, `saveFile`, `quoteData`, `letterData`, `mailDraft`) is reused from `Template Module`, not copied.

## 11. Errors

- Blocked actions return one plain sentence naming what is missing.
- If a Word file fails after its record is saved, the number is kept and the row offers **Create file**, as `ServiceDesk` does.
- A missing migration shows the setup message pattern used in Banking.

## 12. Testing

- SQL on a throwaway Postgres (`tests/run-local.sh`), run as signed-in users: gates, balance calculation, overpayment, reversals, append-only triggers, row-level security, other departments' documents unchanged, migrations run twice.
- `node --test`: logic and UI-to-database function names.
- Click-through of the full flow, part payment and reversal in the real app against a non-production database, or against live only after approval.

## 13. Delivery

1. New branch from `origin/main`, which already holds the shell, `hub_documents` and Voucher Base.
2. Build and test on the throwaway database.
3. With the user's separate approval: back up, apply migrations to Supabase project `pnnakrhfzyxudjaghoxx`, then merge. Applying first avoids users seeing a setup message.

Rollback: drop `business_setup_*`, the bucket and the added `hub_documents` columns; revert the merge. The numbering and voucher changes are additive.

## 14. Open items that do not block the build

- Whether the Labour Fee choice between 3,500 and 4,000 follows a rule. Until told, staff pick.
- Corrected names for `ILUE`, `Dubai Wapp Insurance`, `Investment Commericial`.
- Group names marked * in section 7.
