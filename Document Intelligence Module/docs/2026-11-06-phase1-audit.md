# AI Document Intelligence: Phase 1 audit (read-only)

Date: 2026-11-06 (Asia/Dubai). Nothing was changed in the CRM, the database or OneDrive during this audit.
This repository is public: this report holds counts only, no client names, paths or identifiers.

## 1. CRM architecture

| Layer | What exists |
|---|---|
| Front end | React + Vite app shell in `Main Module`; feature modules plug in (Accounting, Banking, Business Development, Business Setup, Calendar, Client, Client Login portal, Dashboard, HR, Hot Alerts, Integrations, Knowledge, Messenger, Template). Hosted on Cloudflare (`abcrm` Worker, `crm-abcapital.pages.dev`) and GitHub Pages. |
| Back end | Supabase project `pnnakrhfzyxudjaghoxx` (Free plan): Postgres, Auth, Storage, about 23 Edge Functions in Deno, `pg_cron` jobs. A Cloudflare Worker for the CRM Agent (MCP). |
| Local helpers | `Client Module` (Python FastAPI, port 8792, writes proposals into the synced OneDrive folder) and `DOC OCR Module` (`docai`: upload, virus check, Windows OCR, classification, extraction, review, filing). Both run only on one PC. |
| AI | Anthropic (Claude) and OpenRouter in Edge Functions; Router agent (Bruno), CEO agent, CRM agent, BD agent, support agent, email agent (switched off). No OpenAI key in use. No embeddings or `pgvector` anywhere. |
| Integrations | Zoho Books, Microsoft Graph (Messenger, delegated per user), IMAP/SMTP mail, eTimeOffice biometrics, Explee (BD). |

The full code graph is in `CRM/graphify-out` (local, not committed).

## 2. Database

- 365 application tables outside Email Base and system schemas; about 62 MB of business data. Database total 144 MB of the Free plan's 500 MB; Storage 21 MB of 1 GB.
- Largest areas: Business Banking (49 tables, about 35,000 rows), audit trail (about 11,000 rows), Business Setup (33 tables), HR (25), Business Development (24), CEO agent (34), Accounting (32).
- Row Level Security is used throughout; access is split across `profiles.role`, `member_tab_access`, `banking_user_roles`, `bd_user_roles`, `business_setup_role_permissions` and HR checks (no single department model yet).
- 35 tables already store file paths, in 11 Storage buckets (`hub-documents`, `business-setup-documents`, `banking-documents`, `client-portal`, `hr-documents` and others).
- No database backup exists (the documented daily backup workflow is missing from the repository).

## 3. Client Master

Table `public.client_master`:

| Column | Type | Notes |
|---|---|---|
| `client_id` | text | the client code, `CL000001` onward; primary key |
| `legal_name` | text | filled for all |
| `data` | jsonb | the onboarding interview; 16 keys in use |
| `version`, `created_*`, `updated_*` | | audit columns |

307 clients. Identifier coverage in `data`:

| Identifier asked for in the brief | Field found | Filled |
|---|---|---|
| Client ID | `client_id` | 307 |
| Legal entity name | `legal_name` / `Client Legal Name` | 307 |
| Trade licence number | `Trade License Number` | 229 |
| Licence authority, issue and expiry dates | `License Issuing Authority`, `License Issue Date`, `License Expiry Date` | 245, 232, 231 |
| Client status | `Onboarding Status` | 62 |
| TRN (VAT / Corporate Tax) | none | 0 |
| Trade name, aliases | none | 0 |
| Registration number | none (licence number only) | 0 |

Other client lists: `banking_clients` holds 892 clients of Business Banking, only 62 linked to Client Master (`client_master_id`). Accounting jobs: 178, of which 79 are linked.

Possible duplicates in Client Master (same name after removing punctuation and legal-form words): 2 pairs. One pair differs only by punctuation; the other differs in legal form (FZCO vs LLC), so it may be two real entities. Neither is merged; a person decides.

## 4. OneDrive inventory

Source: `AB Capital One Drive` in the business OneDrive. Read from file-system metadata only (names, sizes, dates); no file was opened.

- **171,877 files, 162.2 GB.** (A count earlier the same day found 177,413; files changed during the day.)
- **99.8% are cloud-only** on this PC (Files On-Demand). Opening a file downloads it; the PC has 42 GB free. Content must therefore be read server-side through Microsoft Graph, never through the local sync folder.

Top-level areas:

| Area | Files | GB |
|---|---|---|
| Accounting clients | about 64,000 | 54.8 |
| Banking (bank account clients and bank documents) | about 17,700 | 15.0 |
| Social media (mostly video) | about 1,100 | 17.2 |
| Employee folders | about 9,600 | 15.5 |
| Company formation clients | about 14,700 | 9.1 |
| Audit clients | about 11,600 | 13.1 |
| VAT clients | about 20,000 | 11.1 |
| Corporate tax (by task, then client) | about 7,400 | 6.0 |
| Pictures | about 13,200 | 6.1 |
| AB Capital company documents | about 6,000 | 5.3 |
| Various other work | about 6,700 | 5.4 |
| Liquidation, golden visas, loans, pricing, other | about 5,000 | 3.1 |

## 5. File types

| Type | Files |
|---|---|
| PDF | 108,243 |
| PNG / JPG / JPEG | 29,504 |
| XLSX / XLS / CSV | 10,329 |
| DOCX | 6,862 |
| ZIP | 1,883 |
| TXT | 992 |
| Tally data (`.1800`, `.900`, `.tsf`) | 10,541 |
| Other unsupported (html, xlsm, mp4, gif, dll, rar, msg, exe, ...) | about 3,200 |

13,745 files are outside the brief's supported list (Tally data is the largest group: index name and metadata only). 859 files are empty; 3,595 paths exceed 250 characters.

## 6. Volume and change

- Modified by year: 2023 about 19,900; 2024 about 50,700; 2025 about 55,400; 2026 about 43,100; older about 2,900.
- Duplicate candidates (same file name and size): 24,090 groups, 42,113 extra copies, about 30.5 GB. To be confirmed by hash before any action.
- Estimated text volume: if 60% of PDFs are text-based and average 6 pages, full-text extraction gives roughly 400,000 to 600,000 pages, about 1.5 to 3 million chunks of 500 tokens. Embeddings at 1,536 dimensions take about 6 KB each, so 9 to 18 GB of vectors before indexes.

## 7. Existing document storage

- CRM uploads go to Supabase Storage (11 buckets). Proposals are also copied to the OneDrive folder `CRM AB CAPITAL` by the local Client Module (PC must be on).
- `docai` pipeline exists locally (Windows OCR, rule-based classification, review queue).
- `CRM AB CAPITAL` folder tree (224 folders: departments, client template KYC / FINANCIALS INFORMATION / ACCOUNTING DATA / VOUCHERS / OTHERS / PROPOSALS / ENGAGEMENT LETTERS, `EMPLOYEES`) was created 2026-11-06; the user chose to move it to a company SharePoint site.
- A separate job (PR #3, branch `email-onedrive-archive`) copies the old email files to SharePoint with an app-only certificate app and verifies every copy by quickXorHash.
- House standard `Agent Module/00_Shared_Standards/ONEDRIVE_INTEGRATION.md`: app-only Graph, `Sites.Selected`, certificate, Graph item ids as keys, never permanent delete, no anonymous links.

## 8. Client folder matching estimate

1,219 client folders under the client areas, compared with Client Master names (punctuation and legal-form words removed):

| Result | Folders |
|---|---|
| Exact match | 287 |
| Close, needs a person | 64 |
| No match in Client Master | 868 |

By area, exact matches: company formation 165 of 320, VAT 35 of 287, banking 34 of 285, accounting 23 of 129, liquidation 18 of 45, audit 12 of 131. 243 of 307 Client Master clients have at least one folder.

Most VAT, audit and banking clients are not in Client Master at all. Under the brief's rules (no new client records, low confidence stays unclassified) they would stay unmatched until those clients are added to Client Master through the CRM.

## 9. Gaps

| # | Gap | Effect |
|---|---|---|
| 1 | No server access to OneDrive (no Entra app with consent) | Nothing can be read without downloading to the PC |
| 2 | Supabase Free: 500 MB database | Holds a metadata index; cannot hold 9-18 GB of embeddings |
| 3 | No `pgvector` | Must be enabled |
| 4 | No OpenAI account in the CRM | Brief prefers OpenAI; CRM uses Claude/OpenRouter |
| 5 | Client Master lacks TRN, trade names, aliases, status for most clients; VAT, audit and banking clients largely missing | Matching priority 2, 6 cannot work; about 70% of client folders unmatched |
| 6 | Permissions split across module role tables | RAG must filter by a department model that does not exist yet |
| 7 | Two destination structures proposed (12-folder reorganisation of the old OneDrive vs the SharePoint `CRM AB CAPITAL` client folders) | Organizer target must be chosen |
| 8 | 42,000 duplicate candidates, 13,700 unsupported files, 3,600 long paths | Need handling rules |
| 9 | No database backup | Must exist before any write-heavy phase |
