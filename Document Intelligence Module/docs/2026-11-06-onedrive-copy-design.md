# OneDrive copy: old folder into CRM AB CAPITAL (design)

Date: 2026-11-06. Status: design agreed in conversation; this written spec awaits the user's review.
Part of the AI Document Intelligence module (`2026-11-06-architecture-and-plan.md`): this is the file move-in that comes before indexing.

## Goal

Every file of the old business folder ends up, once, in the new CRM folder, organised by department and client, while the old folder stays exactly as it is. Files live only in OneDrive; Supabase holds only the map.

| | Path (on the user's PC) | OneDrive |
|---|---|---|
| Source (old, read-only) | `C:\Users\User\OneDrive - AB Capital Services FZE\AB Capital One Drive` | the user's business OneDrive |
| Destination (new) | `C:\Users\User\OneDrive - AB Capital Services FZE\CRM AB CAPITAL` | the same OneDrive |

## User decisions (2026-11-06)

1. **Copy, never move.** Nothing in the old folder is deleted, moved, renamed or changed.
2. **Space:** the OneDrive has 1 TB; the copy adds at most about 132 GB (162 GB less duplicates).
3. **Duplicates are not copied.** Two files are duplicates only when their **content** is identical: same size and same Microsoft content hash (`quickXorHash`), regardless of name. Name-only matches are not duplicates.
4. **Microsoft access:** reuse the existing certificate app `CRM-Email-Archive` (secrets `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CERT_THUMBPRINT`, `MS_CERT_PRIVATE_KEY`, app-only, `Sites.Selected`), with one more grant: write on the user's OneDrive site. The older `MICROSOFT_CLIENT_*` app is not used.
5. **Destination:** the existing `CRM AB CAPITAL` folder in the user's OneDrive (not a new SharePoint site).
6. **Supabase stores no files**, only directories and mapping.

## Non-goals

No reading of file contents, no OCR, no AI, no embeddings (later phases). No change to Client Master. No new client records.

## Components

| Unit | Does |
|---|---|
| Schema `od_copy` (migration in `Database Module/Document Base/`) | the map and the work queue (tables below); Row Level Security: admins and CEO read, service role writes |
| Edge Function `onedrive-copy` | one function, four stages, called by `pg_cron` every minute while `od_copy.settings.stage` is not `idle`; every call stops after 120 s and resumes next minute |
| Shared `graph.ts` | app-only certificate token (from the archive job's `archive.ts`), paging, retry on 429/503 with `Retry-After`, copy monitor, never calls DELETE/PATCH on the source drive |
| CRM screen (Settings or Document Intelligence tab, admins only) | progress, duplicate report, unmatched report, plan summary, **Approve copy** button, pause/resume |
| Client profile | "Documents in OneDrive" box: the client's folders with links (from `od_copy.client_folders`) |

## Tables (`od_copy` schema)

| Table | Holds |
|---|---|
| `settings` | single row: drive id, source folder item id, destination folder item id, `stage` (`idle`, `inventory`, `plan`, `approved`, `copying`, `verifying`, `done`, `paused`), batch size, last run result |
| `source_items` | one row per old file: item id (unique), parent path, name, size, `quickxor_hash`, modified time, top area, service area, old client folder name |
| `content_groups` | one row per distinct content (size + hash): the chosen source item, count of copies |
| `client_matches` | old client folder (area + name) → `client_id` (Client Master), method (`exact`, `close`, `manual`), confidence, reviewed by |
| `plan` | one row per file to copy: source item id, target relative path, target folder, department, client id, reason, status (`planned`, `approved`, `copying`, `copied`, `verified`, `failed`, `skipped_duplicate`, `rolled_back`), destination item id, attempts, error |
| `client_folders` | `client_id`, department, destination folder item id, web URL, created by the copy or the CRM: the link the client profile shows |
| `operations` | append-only log: action, source id, destination id, time, result |

Size estimate: about 172,000 source rows and 130,000 plan rows at roughly 0.5 KB each with indexes: about 150-200 MB. The database is 144 MB of a 500 MB limit, so this fits; `source_items` can be trimmed to hashes and ids after the copy.

## Stages

1. **Inventory (read-only).** Graph delta on the source folder lists every file with size and `quickXorHash` (`GET /drives/{drive}/items/{source}/delta`, `$select` of id, name, size, file hashes, parentReference, lastModifiedDateTime). Stores `source_items` and the delta link. Files without a hash (rare: some very old or zero-byte files) are planned by size + name + modified time and marked "unverified duplicate check" (never treated as duplicates).
2. **Plan (no writes to OneDrive).**
   - Duplicate groups by size + hash. The kept copy: first one inside a matched client folder; else the newest; ties by shortest path. Others: `skipped_duplicate`, listed in the duplicate report with all their locations.
   - Client matching of old client folders against `client_master.legal_name` (normalised: punctuation and legal-form words removed). Exact → automatic; close → shown for review; none → unmatched. Two codes with the same normalised name (for example FZCO vs LLC) → review, never automatic.
   - Target paths (rules below). Every target is checked: inside `CRM AB CAPITAL`, valid OneDrive name, length under 400 characters (long paths shortened in the middle, original path kept in the row).
   - Summary report on the CRM screen: files to copy, GB, duplicates skipped, matched / review / unmatched folders.
3. **Approval.** Nothing is copied until an admin presses **Approve copy** (or approves per area). Review items stay in the unmatched area until approved.
4. **Copy and verify.**
   - Destination folders are created with `conflictBehavior: fail` (an existing folder is reused, never replaced).
   - Each file is copied server-side: `POST /drives/{drive}/items/{source}/copy` with the destination parent and name, `conflictBehavior: rename` (never overwrite). The returned monitor URL is polled until done.
   - Verify: the destination's size and `quickXorHash` must equal the source's. Then `verified`. A mismatch or failure: `failed`, retried up to 5 times, then listed.
   - Folders already in `CRM AB CAPITAL` (the 224 created earlier, the test client) are reused.
5. **Undo.** "Roll back batch" removes only destination copies that this job created and that still match the recorded hash, moving them to the OneDrive recycle bin (never a permanent delete). The source is never touched.

## Target path rules

Department by old area:

| Old area | Department in CRM AB CAPITAL |
|---|---|
| `2. Accounting Clients`, `3. Corporate Tax`, `4. VAT Clients`, `5. Audit Clients` | `Accounting` |
| `Company Formation Clients`, `LIQUIDATION`, `GOLDEN VISAS` | `Business Setup` |
| `Banking ACCOUNT ABC\Bank Account Clients`, `LOAN CLIENTS` | `Business Banking` |
| other `Banking ACCOUNT ABC\*` | `Business Banking\00 Bank Partner Documents\...` |
| `1. AB Capital Documents` | `CEO\00 Company Records (AB Capital)\...` (employment list to `HR`) |
| `Employee Folders\<name>` | `EMPLOYEES\<Full Name> - <Code>\OTHERS\...` when the name matches `hr_employees`, else `EMPLOYEES\00 Unmatched\<name>\...`; `EX Employees` to `EMPLOYEES\00 EX EMPLOYEES\...` |
| `Freezone and Mainland Pricing`, `AB Capital Logo & letterhead`, `Agreements` | `04 Shared Library\...` |
| `Social Media` | `Business Development\00 Marketing and Social Media\...` |
| `Traction Consulting Services`, `Various Other Work`, `Desktop`, `Documents`, `Pictures`, `RARE`, `Attestation`, root files | `08 Archive\From old OneDrive\<area>\...` (kept, not organised) |

Client folders: `<Department>\<Client Name> - <Client Code>\<FOLDER>\<Service>\<original sub-path>`. `<Service>` (for example `VAT`, `Audit`, `Accounting`, `Corporate Tax\CT Filing Returns`) keeps files from different old service folders apart, so nothing collides. Unmatched: `<Department>\00 Unmatched - to link\<old area>\<old client folder>\<original sub-path>` (structure kept as is).

`<FOLDER>` from the first sub-folder name under the old client folder (case-insensitive, contains):

| Old sub-folder name contains | FOLDER |
|---|---|
| kyc, passport, emirates id, eid, visa, company doc, co doc, license, licence, moa, aoa, incorporation, certificate | `KYC` |
| bank statement, statement, soa, financial, audit, signed audit, vat return, ct return, tax return, a year (2019-2030) | `FINANCIALS INFORMATION` |
| accounting work, tally, ledger, sales, purchase, turnover, books, working | `ACCOUNTING DATA` |
| invoice, inv, receipt, voucher, bill, payment | `VOUCHERS` |
| proposal, quotation, quote | `PROPOSALS` |
| agreement, engagement, contract | `ENGAGEMENT LETTERS` |
| anything else, and files directly in the client folder | `OTHERS` |

The mapping table lives in the database (`od_copy.folder_rules`) so it can be changed without code.

## Safety

- Code never sends DELETE, PATCH or PUT to an item outside the destination folder; a guard checks every write's parent chain is under `CRM AB CAPITAL`. Unit tests cover it.
- No permanent deletes anywhere; rollback uses the recycle bin and only for this job's own copies.
- No sharing links are created; no permissions are changed.
- Tokens and the private key stay in Supabase secrets; errors are logged without tokens or URLs with tokens.
- Rate limits: at most 4 copies in flight per run; respects `Retry-After`.

## Admin step (once, by a SharePoint or Global admin)

Grant the existing app `CRM-Email-Archive` write on the user's OneDrive site (exact Graph Explorer steps go in the module README): find the OneDrive site id, then `POST /sites/{site-id}/permissions` with `roles: ["write"]` for the app's client id. No new tenant-wide permission.

## Testing

- Deno unit tests: target path rules, folder rules, duplicate choice, name cleaning and length, the write guard.
- SQL tests: plan generation on seeded rows; stage changes; Row Level Security.
- Dry run on the real drive: inventory and plan only (no copy), with the report reviewed by the user.
- Pilot copy: one small matched client (for example under 50 files), verified, then the user checks it in OneDrive before approving the rest.

## Rollout

1. Admin grant. 2. Migration + function deployed with `stage = idle`. 3. Inventory + plan (read-only). 4. User reviews reports. 5. Pilot client. 6. Approve by area. 7. Client profile links switched on.
