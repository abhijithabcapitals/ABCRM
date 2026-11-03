# Knowledge Base data

The staff **Knowledge** tab reads three tables, two functions and one view, created by `migrations/001_knowledge.sql`.
Members need the `knowledge` tab grant to read; only admins write. Design: `Knowledge Module/docs/2026-11-03-knowledge-module-design.md`.

| Object | Purpose |
|---|---|
| `knowledge_categories` | Business Setup, Banking, Accounting, Tax, Visas, General |
| `knowledge_entries` | Procedures, checklists, plans and client answers (HTML body) |
| `knowledge_price_lines` | Business Setup price lines in AED, by template and line group |
| `knowledge_banking_prices()` | Customer-facing columns of the prices in effect today from `banking_pricing`, for users without Banking access. Leaves out retired banks and schemes, fills a blank service fee from the default, and returns the Banking VAT mode |
| `knowledge_price_line_review()` | Admin only: `id`, `basis`, `payee` and `confidence` of each price line. No rows for anyone else |
| `v_knowledge_search` | Entries, price lines, banking prices and active services in one list |
| `knowledge_touch()` | Trigger: stamps edits, records who approved, and returns an Approved row to Draft when its content changes |

An Approved entry returns to Draft when `title` or `body` changes. An Approved price line returns to Draft when `template`,
`line_group`, `item`, `amount_aed` or `payee` changes. Changing only visibility, validity or confidence keeps it Approved.
`knowledge_price_lines` has column-level read: `basis`, `payee` and `confidence` are refused to every API user, so select named columns, never `*`. Admins read those three through `knowledge_price_line_review()` and can still write them.
Prices never go into Git: import output belongs in the git-ignored `data/` folder. Agent commission figures do not belong in these tables.

Test on a throwaway local Postgres (nothing touches Supabase): `bash "Database Module/Knowledge Base/tests/run-local.sh"`.
It runs the migration twice, once more over an old table-wide read grant, the access tests, then `migrations/rollback/001_rollback.sql`.
Before going live, run `audit_trail_attach_all()`; it exists live.

## Legacy Wiki copy tools

The CRM's old **Knowledge Base** tab (formerly Wiki, `Main Module/src/components/Wiki.jsx`) reads the
`wiki_categories`, `wiki_articles`, `wiki_history` and `wiki_attachments` tables. The tools below copy those articles
from another CRM database (Rahul's live project) into ours. They are unchanged by the Knowledge tab.

The articles are stored in the database, not in the Git repo, so copying the repo brings the code only.

| Path | Purpose |
|---|---|
| `export_from_source.sql` | Read-only `SELECT` that returns every category, article, history entry and attachment record as one JSON value |
| `build_import_sql.py` | Turns that JSON into `data/knowledge_base_import.sql` |
| `data/` | The export (`knowledge_base_export.json`) and the generated import SQL. It holds company content, so it is not committed |
| `schema/` | Copies of the Wiki table migrations from `Main Module/db` (`wiki_attachments.sql`, `wiki_history_action.sql`). The base tables are in `Main Module/db/00_base_schema.sql` |

## Copy the articles

1. Open the source project's Supabase SQL Editor, run `export_from_source.sql`, copy the `knowledge_base`
   cell and save it as `data/knowledge_base_export.json`. The query only reads, so it changes nothing there.
2. Build the import:
   ```
   ..\..\.venv\Scripts\python.exe build_import_sql.py
   ```
3. Run `data/knowledge_base_import.sql` in our project's SQL Editor (`pnnakrhfzyxudjaghoxx`).

The import keeps the original ids. Rows that already exist are skipped, so you can run it again after a
fresh export to bring over new articles. An article linked to a space or folder that does not exist in our
database is imported with that link cleared.

Attachment files live in the `wiki-attachments` storage bucket and are not part of the export. The import
copies their records only; download the files from the source bucket and upload them to ours under the same
`storage_path` for them to open.
