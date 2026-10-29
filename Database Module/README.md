# Database Module

The CRM's client database. It sits beside the existing accounting database in `D:\Abhijith Projects\DataBase\Accounting`, and the two are kept apart.

| Path | Purpose |
|---|---|
| `SQL Data/CRM_Onboarding_Database.xlsx` | Workbook with one column for every input on the Client Module onboarding form |
| `SQL Data/FIELD_MAP.md` | Each form field mapped to its sheet, its column and its `client-master.csv` column (also the **Field Map** sheet in the workbook) |
| `build_onboarding_workbook.py` | Rebuilds both files from `Client Module/clientmodule/schema.json` and `config.json` |

```bash
"D:\Abhijith Projects\CRM\.venv\Scripts\python.exe" build_onboarding_workbook.py
```
The rebuild **overwrites** the workbook. Run it only while the workbook holds no real client rows, for example after a schema change.

## Business Development (BD) backend: design stage, kept separate from the UI

The backend for the `Business Development Module` UI, which is still under development and will be linked later. **Nothing has been applied to any CRM database yet.**

| Path | Purpose |
|---|---|
| `docs/BD_BACKEND_SPEC.md` | The user's specification, unedited |
| `docs/BD_MIGRATION_PLAN.md` | What exists in the CRM and what is reused, the rules enforced, **the decisions needed (D1–D6)**, rollout, backup and rollback |
| `docs/BD_ER_DIAGRAM.md` | ER diagram (Mermaid) |
| `docs/BD_API_CONTRACT.md` | Endpoints, roles, conventions and dashboard metric definitions |
| `migrations/bd/001_bd_schema.sql`, `002_bd_seed.sql` | Draft PostgreSQL schema and seed data. They run more than once safely and were tested on a throwaway cluster only. |
| `SQL Data/BD_Field_Mapping.xlsx` | Every spec field mapped to its database column, plus the BD-to-Client-Master prefill and the reuse decisions. Built by `build_bd_field_mapping.py` |

## Knowledge Base

`Knowledge Base/` holds the export and import tools for the CRM's Knowledge Base articles (the `wiki_*` tables). See its README.

## Workbook layout

| Sheet | Rows | Holds |
|---|---|---|
| Legend | – | How to use the workbook, header colours, data-entry and sensitive-data rules |
| Clients | 1 per client | Every single-value field (Company, Business, VAT, CT, Accounting, Banking status, Payroll, Audit, Handover, Engagement, Risk, Team, Notes), the auto columns, and the two Final Review inputs |
| Contacts | 1 per contact | Name, designation, department, email, mobile, WhatsApp, preferred method, and one Yes/No column per role |
| Shareholders | 1 per shareholder | Name, ownership %, nationality, type, plus a formula that checks the client's total is 100% |
| UBOs | 1 per UBO | Name, nationality, basis |
| Bank Accounts | 1 per account | Bank, currency, type, last 4 digits of the IBAN only, bank feed |
| Services | 1 per service | Service, plus a formula giving the DataBase filing folder (from `config.json`) |
| Compliance Flags | 1 per flag | Flag |
| Document Checklist | 1 per client per document | The 30 checklist documents of stage 12, each with a status |
| Documents Uploaded | 1 per file | Stage 1 uploads: file name, type, category, period, filed location (the Document Module register) |
| Field Map | 1 per input | Stage, type, required, condition, options and rules, sheet, column |
| Lists | – | Dropdown values used by the data validation |

Row 1 shows the onboarding stage and row 2 the headers. Header colours: navy means required, slate means optional, grey means auto or formula. Hover a header to see the form's rule for it. Row 3 (yellow, italic) is a fictional example client, `CL000000 Example Trading LLC`, with no real KYC data. The example's document checklist runs to row 32. Dropdowns and checks (dates, whole numbers, AED amounts, email, a 15-digit TRN, IBAN last 4 digits) **warn** rather than block, so `Not Provided`, `N/A` and `(Provided – Verification Required)` can still be entered, as they can on the form.

## How onboarding submissions reach this workbook (proposal, not yet wired)

Today, when staff save a client on the Client Module dashboard, the save runs through `POST /api/save` and then `ClientMaster.save()` in `Client Module/clientmodule/master.py`. That writes the client's single row to `Client Module/data/client-master.csv` (134 columns, a change log and backups). Uploaded files are recorded in `Client Module/data/documents.csv`. Nothing writes to this workbook yet.

Proposed wiring, so that each new onboarding adds rows here:

1. Add `crmdb.py` to this folder with `sync_client(record, documents)`. It would:
   - **upsert** the client's row on **Clients**, matched by Client ID, so an update replaces the row and a new client adds one;
   - **replace** that client's rows on the child sheets. It would split the master's list cells (`Name – Key: value; …`) into Contacts, Shareholders, UBOs and Bank Accounts rows. It would split the `Doc: Status; …` cells into Document Checklist rows, and the `; `-separated multi-selects into Services and Compliance Flags rows;
   - convert dates, AED amounts and percentages to real Excel values;
   - write to a temporary file and swap it in, as the Client Module already does with the CSV. If the workbook is open in Excel, the sync would leave it untouched and report "close the workbook and save again".
2. Call it from `ClientMaster.save()` right after the CSV write succeeds. That is one call, inside the existing lock, wrapped so that a workbook error never blocks the CSV save. The CSV stays the master; the workbook is a structured copy.
3. Add a "Rebuild from master" command that re-syncs every row of `client-master.csv`, for the clients already onboarded and for recovery.

The step 2 hook is a change to the Client Module's code, so it needs your go-ahead first. Step 1 and the rebuild command live entirely in this folder.

**Confidentiality:** once real clients are synced, this workbook is client data. The proposal also adds `Database Module/SQL Data/*.xlsx` to `.gitignore`, the same treatment `Client Module/data/` gets. Until then, it holds only the fictional example row.
