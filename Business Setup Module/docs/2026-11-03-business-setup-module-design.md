# Business Setup Module: Design Spec

Date: 2026-11-03. Status: awaiting the user's review. Nothing here is built or applied.

This spec is the source of truth for the module. Where the two 2026-11-02 specs disagree with it, this one wins:

- `2026-11-02-business-setup-workflow-design.md`: still applies for quote, letter, payment and receipt rules not restated here.
- `2026-11-02-client-compliance-design.md` (branch `business-setup-compliance`): parked. Only its foundation code is reused.

## 1. Purpose

Give the Business Setup department one place to take a client from first form to a service handed to Accounts, and give each client a login to follow their own work.

The module is done when this flow works in the CRM with the user's PC off:

Client login issued → client completes form and uploads documents → staff validate → KYC done → services selected → quote → accepted → engagement letter → full or part payment → receipt voucher → service tracked → output uploaded → completed → sent to Accounts.

Services: company registration (mainland and free zone), deregistration and liquidation, visas (investor, employment, sponsorship and others), AML, Ejari, Emirates ID, tenancy contracts, utility bills, passport and KYC, each with New, Renewal, Rectification and Cancellation.

## 2. Decisions

| Topic | Decision | Source |
|---|---|---|
| Starting point | Reuse branches `business-setup-workflow` and `business-setup-compliance` | User, 2026-11-03 |
| Client form | No Google form. One form inside the CRM, saved in the database | User, 2026-11-03 |
| Client access | Login, showing only this module's view of their own status, payments, invoices, vouchers and details | User, 2026-11-03 |
| Quote templates | IFZA, RAKEZ, SHAMS, Mainland and Liquidation for now. More can be added | User, 2026-11-03 |
| Phones and emails | Only in Client Master. The user fills gaps | User, 2026-11-03 |
| Zoho, part payment rule, process steps, reminders, pricing sign-off, scope | Open, to integrate later. Defaults in section 3 | User, 2026-11-03 |
| Client identity | `client_master` (`CL000001`). No second client table | 2026-11-02 |
| Document reading | `DOC OCR Module` through `readDocuments`, in the staff browser only. No cloud OCR | 2026-11-02 |
| Permissions | Business Setup's own tables and `business_setup_can`. Accounts permission stays `accounts.review` | This spec, see 5.1 |

Dropped from the compliance spec: the 30-day public link, the VPS OCR server, automatic email, compliance records, regulatory entries and the Tax Agent intake.

## 3. Defaults for open items

| Item | Default | Changes later by |
|---|---|---|
| Zoho | Not connected. A non-blocking invoice panel sits between completion and Accounts in both Business Setup and Banking. It only says Zoho is not connected yet. The client's Invoices section stays empty | Zoho integration |
| Part payment | Any net payment above zero allows a service to start. A holder of `setup.services.override` may start without one, giving a reason. A quote with a zero total needs no payment | Setting or code change |
| Process steps | Simple statuses per service, no fixed steps | New step tables |
| Reminders | Dashboard list only. Nothing is sent to anyone | Notification work |
| Pricing | Staff enter or edit amounts on each quote. The 24-item fee list in `private/007_fee_seed.sql` is the starting point. No sign-off step | Price list from old quotes, once supplied |
| Accounts handover unit | One accepted quote, sent when every line is Completed or Cancelled, because payments belong to a quote | User's decision |

## 4. Out of scope

Zoho API, sending mail or WhatsApp from the CRM, fixed step workflows, a form builder screen, more quote templates, a lead pipeline, Arabic documents, D:\ filing of client uploads beyond what Client Inputs already does.

`Client Login Module` and `Database Module/Client Login Base` are empty and stay unused. The login extends the existing Client Portal.

## 5. Reconciling the two branches

Neither branch has been merged. The plan's first task confirms on the live database that no `business_setup_*` table exists. If any does, work stops and the user is told.

### 5.1 Permissions

`business-setup-workflow` calls `banking_can` and seeds `banking_role_permissions`. `business-setup-compliance` has its own `business_setup_staff`, `business_setup_role_permissions`, `business_setup_user_permissions` and `business_setup_can`, so Banking administrators cannot change Business Setup rights.

Use the compliance version. Every workflow policy and RPC moves to `business_setup_can`, including a `business_setup_require` guard. Migration `002_client_master_access.sql` is kept, so Setup staff reach Client Master without a Banking role.

`business_setup_permissions()` becomes:

| Permission | Allows |
|---|---|
| `setup.access` | Open the tab and read non-sensitive records |
| `setup.kyc.manage` | Edit KYC and validate forms |
| `setup.kyc.sensitive` | See partner passport and ID values |
| `setup.quotes.manage` | Issue, accept, reject, revise and generate letters |
| `setup.payments.manage` | Record and reverse payments |
| `setup.payments.override` | Accept a payment above the balance |
| `setup.services.manage` | Update tracker and tasks, send to Accounts |
| `setup.services.override` | Start without payment, complete without an output file |
| `setup.fees.manage` | Edit fee list and quote template list |
| `setup.portal.manage` | Issue, reset and revoke client logins |
| `setup.import.manage` | Review and apply imported rows |
| `setup.audit.view` | Read the audit log |
| `setup.settings.manage` | Roles and settings. Admins only |
| `kyc.view`, `kyc.manage` | Client Master through `002_client_master_access.sql` |

The compliance branch's other permissions, for applications, compliance records and regulatory entries, are removed.

### 5.2 Tables

| Overlap | Decision |
|---|---|
| `business_setup_client_profiles` and `business_setup_kyc_profiles` | Keep `business_setup_kyc_profiles`, adding `client_status`, `ejari_provider` and imported licence extras. Drop the other |
| `business_setup_audit_log` and `business_setup_activity` | Keep `business_setup_audit_log`. Writers mask identity numbers. Drop the other |
| `business_setup_notifications` | Drop until reminders are built |
| `business_setup_settings` | Keep |

### 5.3 Migration order

All in `Database Module/Business Setup Base/migrations`, re-runnable, each tested by running twice.

| File | Holds | From |
|---|---|---|
| `001_foundation.sql` | Permissions, staff, settings, audit | Compliance, trimmed |
| `002_client_master_access.sql` | Client Master rights | Compliance |
| `003_schema.sql` | Workflow tables | Workflow `001`, moved to `business_setup_can` |
| `004_hub_extension.sql` | `hub_documents` columns, receipt numbering, letter gate | Workflow `002` |
| `005_kyc_fees.sql` | KYC, partner, fee RPCs | Workflow `003` |
| `006_quotes_tracker.sql` | Accept, reject, sign, tracker | Workflow `004`, plus section 9 |
| `007_payments.sql` | Ledger, receipts, voucher register | New, per workflow spec 5.5 |
| `008_workspace.sql` | Tasks, files, visas, read RPCs, bucket, `client_base_list` | New, per workflow spec 6 |
| `009_onboarding.sql` | Form, validation | New, section 7 |
| `010_portal.sql` | Client view | New, section 8 |
| `011_accounts_handover.sql` | Send, lock, invoices table | New, section 10 |
| `012_legacy_import.sql` | Staging, apply | New, section 12 |
| `private/007_fee_seed.sql` | Fee list, git-ignored | Exists. Keeps its file name |

## 6. Staff screens

Tabs: **Dashboard · Onboarding · Clients · Services & Fees · Documents · Tasks · Import · Settings**. Shell and styling follow `BankingModule.jsx` and `banking.css`. The Settings shell from the compliance branch is kept.

| Tab | Content |
|---|---|
| Dashboard | Forms waiting, open quotes, accepted without letter, outstanding balances, active services, ready for Accounts, reverted by Accounts, expiries |
| Onboarding | Forms by status. Opening one shows answers, documents, Validate and Return |
| Clients | Business Setup clients: name, Client ID, status, KYC state, active services, balance, missing contact flag |
| Services & Fees | Fee list and quote template list |
| Documents | All quotes, letters and receipts |
| Tasks | Open tasks across clients |
| Import | Dry-run report and held rows |
| Settings | Roles, numbering link, USD rate, form version |

Client Workspace tabs: Overview, KYC, Services, Quotes & Agreements, Payments, Documents, Tasks & Activity, Client Login. Workflow spec section 4 applies to all except Client Login, which issues, resets and revokes that client's login and previews the client's view.

**Expiries:** licences, visas and Ejari with status Upcoming (within 90 days) or Past date. Past date reads "Check this date", because imported dates may be stale.

## 7. Client form and validation

### 7.1 Issuing the login

Staff with `setup.portal.manage` pick or create the Client Master row, then issue a username and generated password through the existing `client_portal_admin_save`. The CRM does not send it. Staff pass it to the client. Creating a login also creates that client's form.

### 7.2 The form

There is one form. Its definition is a versioned JSON row in `business_setup_form_versions`, with no editing screen. Each submission records the version it used.

| Section | Fields |
|---|---|
| Contact | Client name, phone, email |
| Request | Services wanted, New or Existing company, proposed or current activity, preferred zone |
| Existing company | Licence number, licence expiry, issuing authority. Required only for Existing |
| Partners | Name, nationality, share, UBO flag, one block per partner |
| Current documents | Passport, Emirates visa, Emirates ID |
| Address proof | At least one of Ejari, bank statement, utility bill |
| Renewal documents | Old visa, old Emirates ID, other. Shown only when a renewal is requested, and optional |

`business_setup_onboarding_forms`: `client_id`, `account_id`, `form_version`, `answers` jsonb, `status`, `submitted_at`, `reviewed_by`, `reviewed_at`, `return_note`. One open form per client.

| Status | Meaning | Client can edit |
|---|---|---|
| Draft | Client is filling it in. Saves as they go | Yes |
| Submitted | Waiting for staff | No |
| In review | A staff member has taken it | No |
| Returned | Sent back with a note | Yes |
| Validated | KYC done | No |

Uploads reuse `client_portal_documents` and its bucket, with a new nullable `form_id`. Each document is validated or rejected one at a time. `client_inputs_can` is widened to also allow `setup.kyc.manage`.

### 7.3 Validation

`business_setup_form_validate` runs in one transaction and refuses if any required field or document is not validated. It:

1. Writes name, phone and email to `client_master` under the existing row-version check.
2. Writes the KYC profile and partners.
3. Sets the form to Validated and the client's KYC state to Done, and writes the audit entry.

A client's typed values never reach `client_master` before this step. If Client Master already holds a different phone or email, staff see both and choose. Staff may run **Fill from documents** on validated files through `readDocuments`, and a person checks each value.

Clients imported from the old CRM have no form. Their KYC state comes from the import, and a returning client starts at **+ New Service**.

## 8. Client login view

The portal keeps its separation: clients are not Supabase Auth users, and only the `client-portal` Edge Function, using the service role, reads data for them.

New functions take `p_account`, are callable only by the service role, and return named fields only. The client ID is resolved from the account on the server and is never accepted from the browser.

| Section | Client sees |
|---|---|
| Form | Their form, status and return note |
| Services | Service name, action, status, start, completion and expiry |
| Quotes & agreements | Number, date, total and status of Issued, Accepted and Rejected quotes, with their files |
| Payments | Date, amount, type, reference, receipt number, net paid, balance per quote, receipt files |
| Invoices | Rows in `business_setup_invoices`. Empty until Zoho |
| Documents | Their uploads, plus outputs staff mark as client-visible |
| My details | Record from Client Master and KYC |

Never returned: internal notes, service owner, commission fields, KYC risk, other clients' data, staff names, fee list defaults, superseded quotes, the audit log.

Changes to existing portal code:

- `client_portal_me`: email and phone come from Client Master first.
- The comment in `003_client_portal.sql` saying fees never leave becomes untrue for this client's own quotes and payments. It is updated in `010_portal.sql`, and the Banking fields stay hidden as they are.
- `client-portal/index.ts`: new actions `setup_view`, `form_get`, `form_save`, `form_submit` and `setup_file`. `setup_file` checks the file belongs to this account's client before issuing a short signed URL.
- A client with no Business Setup records sees the portal as it is today.

## 9. Services and completion

Quotes, letters, payments and receipts follow workflow spec sections 5.2 to 5.5, with these changes:

**Start gate:** moving a service to In progress applies the part payment default in section 3. This replaces "Work may start before payment".

**Statuses:** Not started, In progress, Waiting on client, Waiting on government, Completed, Cancelled.

**Quote templates:** `business_setup_quote_templates` holds key, label, jurisdiction, storage path and active flag. It is seeded with the five templates and the existing `Service_Quotation_Template.docx` for visa and other service quotes. Adding a template means uploading a file and adding a row, with no code change. A quote picks one template.

Before use, copies of the five Word files are corrected. The originals in `Resources/Templates` stay untouched.

- Use `business_activity` under activity headings. `business_name` stays only in Liquidation, where it is the company name.
- Fixed add-on USD figures are recalculated from one rate, stored in Settings with default 3.6725. Quote line USD is calculated from the same rate.
- Differing add-on AED amounts between templates, such as VAT Filing at 750 and 850, are left as they are for the department to check.

Word files go in private storage, not the public repository.

**Completion:** `business_setup_service_complete` needs at least one uploaded output file, unless the user holds `setup.services.override` and gives a reason. New fields: `output_details` jsonb and a `client_visible` flag on each output.

For company registration lines, staff enter licence number, issue date, expiry and authority. These update Client Master through `client_master_save` and set the service's expiry date.

## 10. Accounts handover

Follows Banking's `011_banking_handover_accounts.sql` pattern.

1. When every line of an accepted quote is Completed or Cancelled, **Send to Accounts** appears, with the Zoho panel above it. It needs `setup.services.manage`.
2. On sending, the quote, its services, payments and receipts are locked by trigger and leave the team's active lists.
3. The Accounting Module's empty Business Setup tab lists the queue with `accounts.review`. A new `components/SetupValidation.jsx` holds the review.
4. **Validate and close** makes it read-only. **Revert** returns it to the team with remarks. Reviews are append-only in `business_setup_accounts_reviews`.

An unpaid balance shows on the send screen and in the Accounts review, and does not block sending.

`business_setup_invoices` holds quote, number, date, amount, file path, source and Zoho ID. No screen writes to it in this release.

**Banking:** `BankProcess.jsx` gains the same non-blocking panel above **Mark complete and send to Accounts**. No Banking table or rule changes.

## 11. Data model additions

Beyond workflow spec section 6 and the tables above:

| Table | Holds | Writes |
|---|---|---|
| `business_setup_form_versions` | Form definitions | Migration |
| `business_setup_onboarding_forms` | Answers and status | Portal functions, RPC |
| `business_setup_quote_templates` | Template list | RPC |
| `business_setup_accounts_reviews` | Accounts decisions | Append-only |
| `business_setup_invoices` | Reserved for Zoho | None yet |
| `business_setup_visas` | Person, client, occupation, issue, expiry, status, source | RPC, import |
| `business_setup_import_rows` | Staged rows, match result, decision | Import only |

Tables stay read-only through the API, with writes through `security definer` RPCs.

## 12. Importing existing data

All files are in `Business Setup Module/Resources`, which is git-ignored. Client data never enters the repository. A script `Database Module/Business Setup Base/scripts/legacy_load.py` stages rows, and an apply RPC commits them, as in Banking's `012`.

| Source | Rows | Goes to |
|---|---|---|
| `Work Sheet AB Capital 27102026.xlsx`, Master List | 248 | Client Master match or new row, KYC profile. Authority for licence data |
| `Master_List` CSV | 249 | Client status only. Its other custom columns are empty |
| `Business Setup Master.xlsx` | 142 | `business_setup_visas`. Authority for visa dates |
| `VISA_Master_List` CSV | 140 | Visa status, such as cancelled or resigned |
| `Ejari List.xlsx` | 43 | `ejari_provider` |
| `Business_Set_up_Team` CSV | 165 | Services marked historical, with status, assignee, zone and payment status |
| `Quotations_by_CRM` CSV | 12 | Not imported as quotes, because prices are blank. Listed in the report for staff |

Rules:

- Matching uses a normalised company name. Exact matches link. Anything else is held for a person. No fuzzy match is applied automatically.
- About 135 team tasks will not match by name, based on the first count of 28 of 163. Many task names are not company names. These are held, and a held row never blocks the rest.
- The 27 free-form zone values go through a mapping table, reviewed in the dry run.
- A date that is not a real date is held, not guessed.
- Historical payment status is shown as a label. It creates no ledger entries or receipts.
- Existing Client Master values are not overwritten. Differences appear in the report.
- No logins are issued and nothing is sent to clients.

The dry-run report shows counts per source: matched, new, held, missing phone, missing email. `Business Setup Master.xlsx` must be saved and closed before loading.

## 13. Errors

- Blocked actions return one plain sentence naming what is missing.
- A portal session that has expired returns the client to login. Their saved draft stays.
- If a Word file fails after its record saves, the number is kept and the row offers **Create file**.
- Two staff taking or validating one form: one wins, and the other is told who took it.
- A stale Client Master version on validation is refused, with a prompt to review the new values.
- A missing migration shows the setup message used in Banking.

## 14. Testing

SQL on a throwaway Postgres (`tests/run-local.sh`), running migrations twice, as signed-in users:

- One client's account cannot read another client's form, service, quote, payment or file, including through `setup_file` with another client's ID.
- A revoked login loses access at once.
- Portal functions cannot be called by `anon` or `authenticated`.
- Forbidden fields do not appear in the client view output.
- Validation is refused with missing items, and contact values reach Client Master only on validation.
- Start gate, overrides, payment reversal returning the balance, overpayment.
- Completion without output is refused.
- Locks while held by Accounts, and revert reopening.
- Two sessions accepting one quote or validating one form.
- Banking, Accounting and Tax documents behave as before.
- Import run twice creates no duplicates.

`node --test` covers pure logic and RPC names. A real click-through covers the whole flow, including a real client login, against a non-production database, or live only after approval. Word output for all five templates is checked by opening the files.

## 15. Delivery

1. New branch from `origin/main` in its own worktree, combining both branches' useful commits.
2. Build and test on the throwaway database.
3. Import dry run, with the report given to the user. Client data stays local.
4. With the user's separate approval: back up, apply migrations to project `pnnakrhfzyxudjaghoxx`, deploy the `client-portal` Edge Function, apply the import, then merge.

Rollback: drop `business_setup_*` and the bucket, remove added `hub_documents` and `client_portal_documents` columns, restore the previous `client_portal_me` and Edge Function, and revert the merge. Client Master rows created or changed by the import are listed in the JSON backup taken beforehand, so they can be restored.

## 16. Open items that do not block the build

| Item | Effect until answered |
|---|---|
| Folder of old quotes and agreements | Prices entered by staff |
| Zoho product, organisations and invoice rule | Panel only |
| Handover per quote or per service | Per quote |
| Reminder timing and recipients | Dashboard only |
| Process steps per service | Simple statuses |
| Required document list per service and visa type | One form's list in section 7.2 |
| Add-on price differences between templates | Left as they are |
| Fee list names `ILUE`, `Dubai Wapp Insurance`, `Investment Commericial`, Labour Fee option rule | As typed |
| Who is assigned each Business Setup role | Admins until set |
