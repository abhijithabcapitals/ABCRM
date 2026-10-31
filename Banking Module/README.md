# Banking Module

The CRM's **Business Banking** tab: the bank account opening lifecycle from lead to account opened.
Data lives in `Database Module/Banking Base` (tables `public.banking_*` in the CRM Supabase project).

## How it is connected

Same pattern as the Business Development Module. The Main Module imports this folder directly.

- `Main Module/vite.config.js`: alias `@banking`. `src/App.jsx`: view `business-banking`. `Sidebar.jsx`: nav item.
- Shared Supabase client and auth through `@app/supabase`; users are `public.profiles`.
- Client Master stays the Client Module CSV (`CL000001`), on this PC only. `banking_clients` is a cross-reference holding a name and licence key for de-duplication plus `client_master_id`. It is not a second master.

## Folder map

| Path | Purpose |
|---|---|
| `components/BankingModule.jsx` | Shell, permissions, navigation |
| `components/NewLeadWizard.jsx` | New lead: upload documents, autofill, fill what is missing |
| `components/CaseWorkspace.jsx` | Case header, guided 18 steps, plan picker |
| `components/{Dashboard,Leads,Cases,KycForm,KycList,Masters,WorkLists,Reports,ExcelImport,Settings}.jsx` | Pages |
| `logic/excelImport.js`, `paymentNotes.js` | Workbook reading, status/colour rules, payment note parsing |
| `logic/pricing.js` | Live quotation preview; the database recalculates on save |
| `logic/documents.js` | Quotation, letter, receipt, report output |
| `services/bankingApi.js` | Supabase access, private file storage, Client Master lookup |
| `templates/` | Word templates used by the CRM. Master copies: `Resources/Banking`. Rebuild: `scripts/build_templates.py` |
| `tests/` | `node --test "Banking Module/tests/"` |
| `docs/USER_MANUAL.md` | Staff guide |

## Decisions the brief left open

| Decision | Choice | Why |
|---|---|---|
| Where data is saved | Supabase; `Banking Base` holds migrations, tests and docs | The CRM is browser-hosted and cannot reach a file on this PC. Email Base follows the same layout |
| Client Master link | Cross-reference table | Postgres cannot read the local CSV |
| Bank fee paid directly to the bank | Shown as a memo, outside the total | Outstanding = total minus received would otherwise overstate what AB Capital is owed |
| VAT | Default "inclusive", on AB Capital's charges only | Old agreements say inclusive; a bank fee is a pass-through. Change in Settings |
| Example "500 BT 01/10 BT 500 24/10" | Two payments; the AED 500 balance is calculated | A balance is not a transaction, so a third record would inflate receipts |
| Excel WIP | Maps to "Document Collection", case flagged historical, Excel status kept | The source does not say how far a WIP row got |
| Payment Pending | Not an application status: the status stays and the balance shows on the ledger | The brief's 18 statuses do not include it |
| Approval threshold | Fee or discount more than 10% off default needs `pricing.approve` | Assumption, editable in Settings |
| Quotation validity | 15 days | Assumption, editable in Settings |
| PDF | Browser print dialog ("Save as PDF") | No new dependency. The PDF is not stored; signed copies are uploaded |
| Send to client | Records the send and opens a prefilled email; a person attaches and sends | Nothing leaves the CRM unattended |
| Mashreq and Sharjah Islamic Bank | Added to the bank master | Not in the brief's 12, but in 100+ Excel rows and both old agreements |

## Assistant and OCR

New Lead autofill reads uploads through the local Document Module (`Client Module`, this PC only) and fills the form for a person to check. It works on licences, VAT and CT certificates, passports with a readable MRZ and similar; on another PC, or with the module off, staff type the details.

`banking_ai_suggestions` is the review queue for every engine. A rules engine fills it today: missing documents, expiring documents, possible duplicate clients. Staff accept (which can open a task) or dismiss.

Not built: comparison against KYC, communication summaries and quotation assistance. To add them, a service runs `DOC OCR Module` (`docai`) on the file and inserts a row with `engine = 'docai'`; nothing else changes. The database gives no suggestion a path to verify a document, confirm an account, change a payment or send a quotation.

## Tests

- `Database Module/Banking Base/tests/run-local.sh`: 109 checks of business rules and row-level security as signed-in users, on a throwaway Postgres.
- `node --test "Banking Module/tests/"`: payment notes, pricing, status rules, the real workbook when present, UI-to-database function and table names, and both Word templates.
- The UI has only been click-tested against a stub, not against a real database. Run `Database Module/Banking Base/README.md` step 3 after applying.
