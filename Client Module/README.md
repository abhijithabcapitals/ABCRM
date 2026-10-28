# Client Module

Staff onboarding for AB Capital Services FZE. It combines:
- the **Client Master** interview: 15 stages, a fixed 134-column master, one client = one row, duplicate checks, validation flags and a completion score;
- the document handling from **Client Onboarding**, now the shared **Document Module** (`..\Document Module`).

Upload a new client's documents first. Their details are checked, read and proposed for the interview, and the files are filed into the DataBase service folders when the client is saved.

## Run it

Double-click `Start-ClientModule.cmd`. It opens <http://127.0.0.1:8792>, which is reachable from this PC only.

The launcher uses the shared CRM environment `D:\Abhijith Projects\CRM\.venv` (Python 3.12, packages pinned in `requirements.txt`). A `.venv` inside this folder takes precedence if you create one.

## Workflow

1. **Documents** (stage 1). Drop in the trade licence, VAT and Corporate Tax certificates, MOA, passports, Emirates IDs, bank statements and financials.
   - The Document Module validates and virus-scans each file with Windows Defender, then reads it (file text or Windows OCR), classifies it and extracts its details.
   - It proposes updates to the interview:
     - **Ready** updates are pre-ticked: printed on an official document, high confidence, no conflict, field empty.
     - **Review** updates are left unticked and show the reason, for example documents disagree, medium confidence, read by OCR, or the field already holds another value.
   - Values below high confidence are saved as `Provided – Verification Required`, so they appear under Items Requiring Review.
   - People found in the documents can be added as a contact, shareholder or UBO. Their role is never assumed.
   - **AI extraction** is optional and paid. It sends document text, never credential files, to Claude through the Claude Code CLI. It is capped per run and per month in `config.json`.
2. **Stages 2–15.** Complete the interview. Use the "Not provided", "N/A" and "Verify" buttons on any field. Fields that don't apply become N/A automatically.
3. **Final Review.** Check the summary, missing information, review items, any duplicate warning and (for an existing client) the changes. Tick the confirmation, then save.
   - A new client gets the next **Client ID**: `CL000001`, `CL000002` and so on. IDs are never reused.
   - Documents are copied into `<storageRoot>\<service folder>\<Legal Name> - CL000001\<category>\` for every selected service. The mapping is `serviceFolders` in `config.json`, and the layout matches `D:\Abhijith Projects\DataBase\STORAGE-MAP.md`.
   - If no service is selected yet, documents wait in the inbox and are filed on the next save.

## Files

| Path | Purpose |
|---|---|
| `data/client-master.csv` | **Master client database**: fixed 134-column header, one row per legal entity |
| `data/Client_Master.xlsx` | Formatted Excel copy, rebuilt by "Export to Excel" (not the master) |
| `data/change-log.csv` | Field-level history of every save (timestamp Asia/Dubai, old, new, user) |
| `data/backups/` | Copy of the master taken before every write |
| `data/client-id-counter.txt` | Highest Client ID issued |
| `data/inbox/` | Upload batches waiting to be filed (Document Module staging) |
| `data/documents.csv` | Register of every filed document copy |
| `data/logs/pipeline-*.jsonl` | Per-document pipeline stage log |
| `data/ai-usage.csv` | AI extraction cost ledger |
| `config.json` | Storage root, port, Document Module path, virus scan, AI caps, service → folder mapping |
| `clientmodule/schema.json` | The 134 columns, interview stages, options, required fields and N/A conditions |
| `clientmodule/master.py` | Master rules: duplicates, validation, score, save, Excel export |
| `clientmodule/documents.py` | `ClientMasterAdapter` (document fields → columns) and service folder mapping |
| `clientmodule/api.py`, `static/index.html` | Server and the staff interface |

## Tests

```bash
"D:\Abhijith Projects\CRM\.venv\Scripts\python.exe" -m pytest tests
```

The tests use temporary folders and the fictional sample documents in `..\Document Module\tests\samples`. They never touch the real master or the DataBase folder.

## Relation to the earlier projects

- `D:\Abhijith Projects\Agents\Client Master`: the PowerShell version of the interview. This module replaces it; that folder is left unchanged.
- `D:\Abhijith Projects\Client Onboarding`: the client-facing portal and its backend. Its document classification, naming, verified copying and folder layout now live in the Document Module. Its 69-column `MASTER DATA CLIENT.xlsx` is not used here. That folder is left unchanged.
