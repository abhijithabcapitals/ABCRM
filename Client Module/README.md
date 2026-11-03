# Client Module

Staff onboarding for AB Capital Services FZE. It combines:
- the **Client Master** interview: 15 stages, a fixed 134-column master, one client = one row, duplicate checks, validation flags and a completion score;
- the document handling from **Client Onboarding**, now the shared **Document Module** (`..\DOC OCR Module`).

Upload a new client's documents first. Their details are checked, read and proposed for the interview, and the files are filed into the DataBase service folders when the client is saved.

## Run it

Double-click `Start-ClientModule.cmd`. It opens <http://127.0.0.1:8792>, which is reachable from this PC only.

The launcher uses the shared CRM environment `D:\Abhijith Projects\CRM\.venv` (Python 3.12, packages pinned in `requirements.txt`). A `.venv` inside this folder takes precedence if you create one.

### Centralized OCR server (Business Banking)

The Client Module can run in a restricted remote mode for Business Banking document processing. Keep the existing per-PC setup for the Client Master UI; remote mode exposes `/api/health` and only the authenticated batch-create, file-upload and staged-file-delete endpoints needed by Business Banking.

1. Use a Windows server on the company network with the Document Module's Windows OCR language pack and Windows Defender available. Run it as a dedicated service account with access only to its configured `dataDir` and staging storage.
2. In Cloudflare Zero Trust, create a named Tunnel on the server and add a public hostname such as `ocr.<your-domain>` routed to `http://127.0.0.1:8792`. This provides HTTPS without opening an inbound firewall port. The hostname is reachable through Cloudflare, but the API requires a valid Supabase session and a Banking permission for every operation; do not add a Cloudflare Access interactive login in front of this API. If policy requires network-level VPN-only access, configure Cloudflare WARP private-network routing instead and make the hostname available only to managed WARP devices.
3. In `config.json`, set `remoteMode` to `true`, `host` to `127.0.0.1` when using a reverse proxy on the same server (or a VPN-only interface when proxying elsewhere), and `allowedHosts` to the exact proxy hostname. Keep `embedOrigins` restricted to the CRM origins that actually serve the app.
4. Provide `SUPABASE_URL` and `SUPABASE_ANON_KEY` as process environment variables on the server. These are used only to validate each CRM session and check its `banking_my_access` permissions; do not use a Supabase service-role key.
5. In GitHub repository Settings > Secrets and variables > Actions, add the optional secret `VITE_DOCUMENT_MODULE_URL` with the HTTPS hostname. The deployment workflow passes it into the Pages build. Keep `VITE_CLIENT_MODULE_URL` unchanged; it still points to the local Client Module UI.
6. Test signed-in users with and without `docs.manage`, `kyc.manage` or `leads.manage`, plus expired sessions. Remote mode rejects other Client Module APIs and routes.

The actual host name, VPN access, HTTPS certificate and Windows OCR/Defender availability must be configured and tested on the server before staff use it. Keep the existing local mode (`remoteMode: false`) for PC-based OCR.

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

The tests use temporary folders and the fictional sample documents in `..\DOC OCR Module\tests\samples`. They never touch the real master or the DataBase folder.

## Client Portal

Clients sign in on the CRM's normal page with a username (no @). Admins issue, reset and revoke logins from
Clients > All Clients (open a row), Clients > Client Portal, or Settings > Client Portal.

| Path | Purpose |
|---|---|
| `../Client Login Module/portal/ClientPortal.jsx` | The client's only screen: their record, uploads and each document's status. Admins see it read-only |
| `../Client Login Module/portal/portalApi.js` | Calls the Edge Function. The session token stays in the browser tab |
| `../Client Login Module/admin/ClientPortalAdmin.jsx` | Admin screen: give access, new password, revoke, restore, view as client |
| `crm/ClientInputs.jsx` | Staff review: assign to me, open, validate or reject, save to PC |
| `../Client Login Module/supabase/client-portal/index.ts` | Edge Function, deployed with `--no-verify-jwt` because it checks its own sessions |
| `../Database Module/Client Base/migrations/003_client_portal.sql` | Tables, private bucket and permissions |

Clients are not Supabase Auth users, because many staff tables allow any `authenticated` user. Only the Edge
Function (service role) reads their data, and `client_portal_me` returns named fields only: add a field there
to show it to clients. Five wrong passwords lock a login for 15 minutes; sessions last 12 hours; revoking ends them.

A validated file is copied to `filed/<client>/<type>/` in the `client-portal` bucket. When this module runs on
the reviewer's PC, a copy also goes to the client's folder under `storageRoot`: the existing
`<Legal Name> - <Client ID>` folder when the client has a Client Master ID, otherwise
`5. Others/Client Portal/<client>`. Uploads are not virus scanned.

## Relation to the earlier projects

- `D:\Abhijith Projects\Agents\Client Master`: the PowerShell version of the interview. This module replaces it; that folder is left unchanged.
- `D:\Abhijith Projects\Client Onboarding`: the client-facing portal and its backend. Its document classification, naming, verified copying and folder layout now live in the Document Module. Its 69-column `MASTER DATA CLIENT.xlsx` is not used here. That folder is left unchanged.
