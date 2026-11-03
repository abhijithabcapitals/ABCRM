# Client Login: Design Spec

Date: 2026-11-03. Status: awaiting review. Nothing here is built or applied.

## 1. Purpose

Every onboarded client gets a login from an admin. Signed in, the client sees how they appear in AB Capital's CRM: their services and how far along each one is, their accounts position, their documents and their information. A client can correct their information, but a change counts only after a department employee takes it and validates it.

The module is done when:

- An admin can find any client in Admin Settings, see their KYC %, and give, reset or revoke a login.
- A client can sign in and see all four tabs in section 5, with only their own data.
- A client can edit a field, staff can validate or reject it, and only a validated value reaches the CRM record.

## 2. Agreed decisions

| Topic | Decision |
|---|---|
| Login | Extend the live Client Portal. No second login system |
| Client identity | Separate username and password, not Supabase Auth. Many staff tables allow any `authenticated` user, so an Auth login would reach internal data |
| Who can get a login | The admin decides per client. KYC % is shown and filterable but blocks nobody |
| Banking progress | Stage based, from the case step |
| Business Setup progress | Waits until that module is live. Not built here |
| Accounting | No %. Filing status, amounts payable and paid, and a ledger |
| Who validates edits | Staff with the Clients tab, as Client Inputs works today |

## 3. What exists today

Live since `Client Base/migrations/003_client_portal.sql`, with 0 client accounts and 0 uploads at the time of writing:

- Tables `client_portal_accounts`, `client_portal_sessions`, `client_portal_documents`, and the private bucket `client-portal`.
- Edge Function `client-portal`: sign-in, session, uploads, staff review, admin preview.
- `ClientPortal.jsx`: read-only record, services list, upload, uploads table.
- `ClientPortalAdmin.jsx` in Settings > Client Portal: give, reset, revoke, restore, View as client.
- `ClientInputs.jsx`: staff take, release, validate or reject uploaded documents.

Live data checked on 2026-11-03 that shapes this design:

| Fact | Effect |
|---|---|
| 837 banking clients, each with one KYC profile | The admin list holds all of them |
| 3 profiles at 100% KYC, 834 at 6% | KYC % is information only, see section 2 |
| `client_master` has 0 rows | Client Master fields are empty, see sections 5.2 and 5.4 |
| 953 quotations, all Accepted, most imported; payments exist on only 2 cases | Imported amounts must not be shown as owed, see section 5.2 |
| 32 banking documents | The gallery starts small for most clients |

## 4. Folders

| Path | Holds |
|---|---|
| `Client Login Module/portal/` | `ClientPortal.jsx` and the tabs, `portalApi.js` (moved from `Client Module/portal`) |
| `Client Login Module/admin/` | `ClientPortalAdmin.jsx` (moved from `Client Module/crm`), `InformationChanges.jsx` |
| `Client Login Module/logic/` | Pure rules with tests: progress %, ledger totals, field list |
| `Client Login Module/supabase/client-portal/` | The Edge Function (moved from `Client Module/supabase`) |
| `Client Login Module/tests/` | Node tests for `logic/` |
| `Database Module/Client Login Base/migrations/` | New SQL. `Client Base/003` stays where it is because it is already applied |

Main Module gets a new Vite alias `@client-login`. Imports in `Root.jsx`, `Login.jsx`, `Settings.jsx`, `ClientsHub.jsx` and `ClientInputs.jsx` change to it. `ClientInputs.jsx` stays in Client Module and gains a link to the new view.

## 5. What the client sees

Four tabs. An admin sees the same screens read-only through View as client.

### 5.1 Services

One card per banking case: bank, account type, current step name, % and a progress bar.

| Case state | Shows |
|---|---|
| `outcome = Approved` | 100%, "Account opened" |
| `outcome = Rejected` | "Not approved", no % |
| `outcome = Returned`, `Cancelled` or `Closed` | The outcome as a plain label, no % and no bar |
| Open, `is_historical` true | "In progress", no % and no bar. All such cases sit at one import placeholder stage, so a percent would mislead. Any outcome above wins |
| Open | `round(uiStep(current_stage) / 15 * 100)`, with the step name from `STEPS` |

A Cancelled or Returned case shows paid only on the Accounts tab, with no payable, balance or direct-to-bank note, so nothing reads as owed.

Approved cases also show the bank, account name, opening date and the IBAN masked to its last 4 characters, from `banking_client_accounts`. Step descriptions, staff names, remarks and commission are not shown.

Business Setup is added here once that module is live. Its brief is being revised separately, so this spec fixes no stages for it.

### 5.2 Accounts

**Filing status.** VAT and Corporate Tax status, registration numbers and due dates from `client_master`, using the existing rules in `taxLogic.js`. With no Client Master row the section says "Not recorded yet".

**Amounts and ledger.** Per case: payable, paid and balance, and a dated ledger.

| Item | Source |
|---|---|
| Payable | `total_amount` of the latest Accepted `banking_quotations` version |
| Paid | Sum of `banking_payments.signed_amount`, so refunds and reversals net off |
| Balance | Payable minus paid |
| Ledger lines | `banking_payments`: date, reference, type, amount, method. Receipt number from `banking_receipts` |

`direct_to_bank_total` is shown as a separate note because the client pays that to the bank, not to AB Capital. The schema excludes it from `total_amount`, so it is never added to the balance.

**Imported cases.** A case with `is_historical` true, or whose quotation has `is_imported` true, and with no payment rows shows "Payment history is not held in this system. Contact your account manager." It shows no payable or balance. Otherwise nearly every old client would see their full fee as owed when the payment was simply never recorded here.

### 5.3 Documents

A gallery of cards with file name, type, date and status, filterable by category.

| Category | Source | Opens |
|---|---|---|
| Sent by you | `client_portal_documents` | Yes, with review status and any rejection message |
| Your KYC documents | `banking_documents`, latest `banking_document_versions` | Yes, unless the type is sensitive |
| From AB Capital | `banking_generated_documents` (quotations, engagement letters, receipts) | Yes |

Types with `banking_document_types.is_sensitive` true (for example a partner's passport) show as a card marked "Held by AB Capital", with no download. Their title and file name are null in the response, so the name never reaches the browser. One company login can be used by several people, and those files belong to individuals.

A generated document is left out of the gallery, and gets no signed link, while its quotation is Draft or Approval Required or its letter is Draft or Cancelled.

Deleted documents (`deleted_at`) never appear. Upload stays as it is today. Files open through signed links lasting 120 seconds, and the Edge Function checks the document belongs to the signed-in client's banking client first.

### 5.4 My Information

The client's details as held in the CRM, grouped as Company, Licence, Contact and Tax. Each field can be edited, one change request per field.

| Field | Written to |
|---|---|
| Legal name, trade name, legal structure, business activity, registered address, office address, website, company email, company phone, VAT TRN | `banking_kyc_profiles` |
| Licence number | `banking_kyc_profiles` and `banking_clients` |
| Licence issue date, licence expiry date, issuing authority | `banking_kyc_profiles` |
| CT registration number, financial year end | `client_master.data`. Hidden when the client has no Client Master row |

A client with only a Client Master row has these fields written to `client_master.data` wherever a matching key exists.

Risk fields, source of funds, turnover and other KYC answers are not shown or editable in this version.

A field with an open request shows the official value, a "Pending review" badge and the proposed value. A rejected request shows the reason until the client edits that field again.

## 6. Edit and validation

New table `client_portal_change_requests`: id, account, field key, old value, new value, status (`pending`, `in_review`, `validated`, `rejected`, `superseded`), assigned to, assigned at, reviewed by, reviewed at, review note, created at. Browser roles have no table access, as with the other portal tables.

**Client side**

- The Edge Function accepts only field keys on the list in section 5.4, enforced again in SQL.
- Values are trimmed, limited to 500 characters and dates must parse. A value equal to the official one is refused.
- A new edit replaces the client's own `pending` request on that field (old one becomes `superseded`). It is refused while staff hold it `in_review`.
- Limit of 100 requests per client per day, matching the upload limit.

**Staff side:** Clients > Client Inputs gains an **Information Changes** view, with a pending count also shown on the Settings list.

| Action | Rule |
|---|---|
| Take | Atomic: of two people clicking together, one gets it |
| Assign to a colleague | Anyone with the Clients tab can hand an unassigned or own request to another member with that tab |
| Release | Assignee or admin |
| Validate | Assignee or admin. Writes the value in one transaction with the status change |
| Reject | Assignee or admin. A reason is required and shown to the client |

**Validate details**

- If the official value differs from the request's old value, staff see both and must confirm before it writes. The CRM is not silently overwritten.
- KYC writes use a direct update, so the existing triggers still run: `banking_kyc_percent` recalculates KYC % and `banking_kyc_profiles_audit` logs it.
- Client Master writes also add a `client_master_history` row and bump `version`, matching `client_master_save`.
- Each decision also goes to `admin_audit`.
- A validator needs only the Clients tab, not `kyc.manage`. So anyone with that tab can change these KYC fields through this queue, see section 13.

## 7. Admin Settings list

Settings > Client Portal is extended. Admins only, enforced in SQL.

- Columns: client, business lines, licence, KYC %, access (On, Revoked, None), pending edits, last sign-in, actions.
- Search on client, licence, username, email and phone.
- Filters: access state, KYC (100% or below), business line.
- Row actions stay: Give access, New password, Revoke, Restore, View as client.
- Default view changes from "With access" to all clients, since no one has access yet.

`client_portal_admin_clients` is replaced to return the new columns.

## 8. Security

- All client data goes through the Edge Function using the session token. Each read and write is limited to the session's own account, resolved server side and never taken from the request.
- `client_portal_me` and the new read functions return named fields only, and execute only for `service_role`.
- Ledger reads leave out internal columns: `remarks`, `received_by`, `reference_note`, `import_row_id`, approval fields and commission.
- `banking-documents` paths are never sent to the browser as a field. The client sends a document id, and the server resolves and checks it with the session token. The only exposure is inside a client's own 120-second signed link.
- Sessions stay at 12 hours and the lockout stays at 5 attempts for 15 minutes.

Known limit: the browser has no virus scan on uploads. Files stay in the private bucket and staff open them only as downloads, as today.

## 9. Error handling

| Case | Behaviour |
|---|---|
| Expired or revoked session | Signed out to the login page |
| Client with no KYC profile or case | Tabs show a plain "Nothing recorded yet" |
| Client whose banking client has been merged or removed | Account's link is set null by the foreign key; portal shows the empty state and the admin list flags it |
| Failed validate | Transaction rolls back, request stays `in_review`, staff see the error |
| Request taken by someone else | "Someone else has already taken this" and the list refreshes |

## 10. Testing

- **Node tests** for `logic/`: % for each stage including 14 to 18, Approved and Rejected, payable and paid with reversals, imported case rule, field list.
- **SQL tests** on a local or branch database: client A cannot reach client B's data, documents or requests; an unlisted field key is refused; validate writes the value and rejected or pending does not; two simultaneous takes give one winner; non-admin is refused on admin functions.
- **Browser check** on local dev with a test client account: all four tabs, an edit through to validation, View as client, phone width.

## 11. Rollout

1. Build on branch `client-login` in `D:\Abhijith Projects\CRM-client-login`.
2. On approval only: apply the migration to live with a matching rollback file, deploy the Edge Function, merge to `main`. GitHub Pages then deploys.
3. The Edge Function deploys before the new site goes out. Old pages keep working because existing actions do not change.

## 12. Out of scope

Business Setup progress, Zoho invoices, an accounting ledger outside Business Banking, email notifications to clients or staff, self-service password reset, Arabic, client-to-staff messaging, and access to the local `D:\` file copies.

## 13. Open items for the user

1. **Filing status stays empty until Client Master is filled.** `client_master` has 0 rows live, so all 837 clients show "Not recorded yet".
2. **Accounts for old clients.** Imported cases show no amounts, because payments were not imported. Importing that history would be a separate task.
3. **Who validates.** Validation follows the Clients tab, as agreed. Staff with that tab but without `kyc.manage` gain a route to change the listed KYC fields, always from a client's request and always logged. Requiring `kyc.manage` as well is a one-line change if preferred.
