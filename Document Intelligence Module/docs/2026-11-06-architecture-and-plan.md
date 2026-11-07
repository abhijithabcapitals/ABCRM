# AI Document Intelligence: architecture and implementation plan

Date: 2026-11-06. Based on `2026-11-06-phase1-audit.md`. Status: **proposal, awaiting the user's decisions and approval.** Nothing is built.
Items marked **(decision)** are open; the plan shows the recommended choice.

## 1. Shape of the system

```
OneDrive / SharePoint (Microsoft 365)
        │  Microsoft Graph, app-only certificate app "CRM-Agents-Document", Sites.Selected
        │  read-only until the organizer phase; delta queries for changes
        ▼
Ingestion worker (Python, Docling + OCR)            ── runs on this PC first; can move to a small VM later
  1 list (delta) → 2 download to a private temp folder → 3 extract text/tables/pages
  4 OCR scanned pages → 5 redact secrets → 6 match client → 7 classify → 8 chunk + embed
  9 write index → 10 delete the temp copy (never touches the local OneDrive sync folder)
        ▼
Index database (Postgres + pgvector)  (decision: Supabase Pro, recommended)
  di_documents, di_chunks (text + tsvector + vector), di_client_matches, di_classifications,
  di_duplicates, di_org_proposals, di_operations (reversible log), di_sync_state (delta links)
        ▼
CRM (existing React app) → new module "AI Document Intelligence"
  Dashboard · Document Explorer · AI Document Assistant · Organization Center
  Edge Functions: di-search (hybrid search with access filter), di-assistant (grounded answers with sources),
  di-organize (approved copies through Graph, writes di_operations)
```

Why a worker and not Edge Functions: Docling, OCR and large downloads need minutes of CPU and Python; Edge Functions stop after about 150 s and run Deno. The worker is stateless and resumable: every step records status in `di_documents`, so a stopped PC simply resumes.

Why Graph and not the local folder: 99.8% of files are cloud-only on this PC (audit section 4); reading them locally would download 162 GB onto a 42 GB disk.

## 2. Data model (new tables, prefix `di_`, Row Level Security on all)

| Table | Key columns |
|---|---|
| `di_documents` | `drive_id`, `item_id` (unique), `path`, `name`, `size`, `mime`, `modified_at`, `quickxor_hash`, `sha256`, `extraction_status`, `embedding_status`, `last_indexed_at`, `error`, `department`, `client_id` → `client_master.client_id`, `match_confidence`, `doc_type`, `service`, `doc_date`, `financial_year`, `period`, `class_confidence`, `recommended_destination`, `status` |
| `di_chunks` | `document_id`, `page`, `ordinal`, `text`, `tsv` (full-text), `embedding vector(1536)`, `has_table` |
| `di_client_matches` | `document_id`, `client_id`, `method` (code, TRN, licence, registration, legal name, trade name, AI), `evidence`, `confidence`, `reviewed_by`, `decision` |
| `di_duplicates` | `hash`, `document_ids[]`, `kept_id`, `decision` |
| `di_org_proposals` | `document_id`, `from_path`, `to_path`, `reason`, `confidence`, `status` (proposed / approved / rejected / done / rolled back), `approved_by` |
| `di_operations` | append-only log: action, item ids, from, to, result, error, `undo_of` (rollback) |
| `di_sync_state` | per drive: `delta_link`, last run, counts |

Client Master is read only. No client is created; no client field is changed. Suggested additions to Client Master (TRN, trade name, aliases) are reported, not written.

## 3. Client matching

Order (from the brief), with what the data allows today:

| Step | Signal | Available now | Confidence |
|---|---|---|---|
| 1 | Client code `CL000123` in path or text | rarely | high |
| 2 | TRN (15 digits, `100` + 12) in text | not in Client Master yet | high once added |
| 3 | Trade licence number in text | 229 clients | high |
| 4 | Registration number | none | n/a |
| 5 | Legal name, normalised, from folder name or text | 307 clients | high if exact, medium if close |
| 6 | Trade name / aliases | none | n/a |
| 7 | AI on first pages, with the candidate list | always | medium at most |

High (≥ 0.9): proposed automatically, shown for spot checks. Medium (0.6-0.9): a person confirms. Low: unclassified. Two legal forms (FZCO vs LLC) or two codes are never merged. Expected start: about 290 client folders matched by name, about 64 for review, about 870 unmatched until those clients exist in Client Master.

## 4. Extraction, OCR, classification

- PDF / Office / CSV / TXT / RTF / PPTX: Docling (pages and tables kept). XLS/XLSX: openpyxl/pandas summary per sheet.
- Scanned PDFs and images: OCR (Docling's OCR, or the existing Windows OCR in `docai`).
- ZIP: list contents and index names; extract into the worker's temp folder only, never into OneDrive.
- Tally data, video, executables: metadata only, logged as unsupported.
- **Secret redaction before any AI call or embedding:** passwords, PINs, API keys, tokens, card numbers, IBANs flagged and masked. Files named like credentials ("logins", "password") are indexed by name only.
- Classification: path and file-name rules first (free, most documents are already in service folders); AI only for the rest, on the first 2 pages. Taxonomy from the brief; new categories allowed through a table, not code.

## 5. Search and assistant

- Hybrid search: Postgres full-text (`tsvector`) plus vector similarity, merged by reciprocal rank. Exact identifiers (TRN, licence numbers, client codes) go through exact match, never vectors.
- Filters: client, department, document type, service, financial year, period.
- Access: every query runs as the signed-in user; Row Level Security limits documents to the departments and clients the user may see (department model from `crm-departments-access-model`). Until that model exists, admins and CEO only.
- Assistant: retrieves chunks, answers only from them, cites document name, page and an "Open in OneDrive/SharePoint" link; says "no document found" when retrieval is empty.

## 6. Organizer

- Read-only first: inventory, client matching report, classification report, duplicate report, proposed structure, movement plan, unclassified report.
- **(decision)** Destination. Recommended: approved files are **copied** into the SharePoint `CRM AB CAPITAL` client folders (KYC, FINANCIALS INFORMATION, ACCOUNTING DATA, VOUCHERS, OTHERS, PROPOSALS, ENGAGEMENT LETTERS), and the old OneDrive stays as the untouched original. Alternative: the brief's 12-folder reorganisation of the old OneDrive in place (moves).
- Every operation goes to `di_operations` with source and destination item ids; rollback reverses a batch. No deletes, no overwrites (name conflicts get ` (2)`), no permission changes, no anonymous links.

## 7. CRM module "AI Document Intelligence"

Built inside the existing app shell as one module folder (`Document Intelligence Module`), same patterns as other modules (components / logic / services / tests):
- Dashboard: total files, indexed, pending, failed, matched, unmatched, duplicates, awaiting organisation, last sync.
- Document Explorer: search by client, TRN, type, service, year, content; open the original; extracted text; classification; status.
- AI Document Assistant: chat with sources.
- Organization Center: proposals with reason and confidence; approve or reject (authorised roles only).

## 8. Phases and approvals

| Phase | Builds | Needs from the user before it starts | Live or external effect |
|---|---|---|---|
| 0 Prerequisites | daily encrypted DB backup; `pgvector`; secrets set up | decisions below; Entra app + consent; plan upgrade if chosen | yes: approval |
| 1 Metadata index | Graph delta reader, `di_documents`, dashboard counts | Phase 0 done | read-only on OneDrive |
| 2 Client matching | matching engine, review screen, match report | none | none (proposals only) |
| 3 Extraction + classification | worker with Docling/OCR, redaction, classification report | AI provider decision; start with 2025-2026 files of matched clients | AI calls (cost) |
| 4 Embeddings + search + assistant | `di_chunks`, hybrid search, assistant with sources | index size decision | AI calls (cost) |
| 5 Organizer | proposals, approval screen, copy with log and rollback | write grant on the destination site; approval per batch | writes to SharePoint |
| 6 Automation | new-file indexing via delta, missing KYC, expiring licences (from Client Master dates), completeness reports | none | none |

Each phase: code on its own branch, tests, review, then release with the user's approval (and Cloudflare deploy per standing rule).

## 9. Open decisions

1. **Index location (decision):** Supabase Pro (recommended; about USD 25/month, 8 GB database, backups) vs local PostgreSQL on this PC (free; search only while the PC is on) vs metadata-only on Free (no full-text/semantic search).
2. **AI provider (decision):** OpenAI as in the brief (embeddings `text-embedding-3-small`, small model for classification) vs Claude for classification and answers with OpenAI only for embeddings vs local models only.
3. **Organizer destination (decision):** copy into SharePoint `CRM AB CAPITAL` (recommended) vs reorganise the old OneDrive in place.
4. **Microsoft 365 admin:** who registers the Entra app and grants `Sites.Selected` on the OneDrive and the SharePoint site.
5. **Scope of the first index:** all 172,000 files vs 2025-2026 files of matched clients first (recommended).
6. **Client Master enrichment:** whether the CRM team adds missing VAT, audit and banking clients and TRNs through the CRM, so that more folders can be matched.

## 10. Credentials and access needed (never in chat or code)

- Entra app registration with certificate; `Sites.Selected`; read grant on the `AB Capital One Drive` site; later write grant on the SharePoint CRM site.
- OpenAI API key (if chosen) as a Supabase Edge Function secret and a worker environment variable.
- Supabase service role key for the worker, stored in the Windows credential store or an environment variable on the worker machine only.
- Database connection string for backups (environment variable).

## 11. Rough cost (to be refined after a 1,000-file sample)

| Item | Estimate |
|---|---|
| Embeddings (text-embedding-3-small), 1.5-3 million chunks | about USD 15-40 one-off |
| Classification with a small model on the about 30% not settled by path rules | about USD 20-80 one-off |
| Assistant answers | cents per question |
| Supabase Pro (if chosen) | about USD 25/month |
| OCR and Docling | free, local CPU time (days for the full set; hours for the priority set) |
