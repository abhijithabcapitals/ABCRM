# Knowledge Base data

The CRM's **Knowledge Base** tab (formerly Wiki, `Main Module/src/components/Wiki.jsx`) reads the
`wiki_categories`, `wiki_articles`, `wiki_history` and `wiki_attachments` tables. This folder holds the
tools that copy those articles from another CRM database (Rahul's live project) into ours.

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
