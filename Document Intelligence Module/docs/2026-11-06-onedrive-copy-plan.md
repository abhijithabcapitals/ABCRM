# OneDrive Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copy every non-duplicate file of `AB Capital One Drive` into `CRM AB CAPITAL` (same OneDrive), organised by department and client, keeping the old folder untouched and storing only the map in Supabase.

**Architecture:** A Postgres schema `od_copy` holds the inventory, plan, client-folder map and an append-only log; set-based SQL functions build the plan (duplicates by size + `quickXorHash`, client matching, target paths from rule tables). One Deno Edge Function `onedrive-copy`, run by `pg_cron` every minute, does the Microsoft Graph work per stage (inventory via delta, copy + verify, rollback) under a 120 s budget. A small CRM screen shows progress and has the approval button; the client profile shows the client's OneDrive folders.

**Tech Stack:** Supabase Postgres 17 + `pg_cron` + `pg_net`; Deno Edge Function; Microsoft Graph v1.0 (app-only certificate, `Sites.Selected`); React (existing CRM app shell, JSX runtime), `node --test` for front-end logic, `deno test` for the function, local PostgreSQL 18 for SQL tests.

**Spec:** `Document Intelligence Module/docs/2026-11-06-onedrive-copy-design.md`

## Global Constraints

- Never DELETE, PATCH, PUT or POST-copy **into** any item outside the destination folder `CRM AB CAPITAL`; the source folder `AB Capital One Drive` is read-only. Every write goes through one guard.
- Duplicates = identical size **and** identical `quickXorHash`. A file without a hash is never a duplicate.
- Copy with `conflictBehavior: rename`; create folders with `conflictBehavior: fail` and reuse an existing folder. Never overwrite.
- No permanent deletes; rollback only moves this job's own verified copies to the recycle bin (`DELETE` on a destination item).
- No sharing links, no permission changes.
- Secrets only from env: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CERT_THUMBPRINT`, `MS_CERT_PRIVATE_KEY`, `OD_COPY_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Never log tokens, keys or signed URLs.
- At most 4 copies in flight per run; honour `Retry-After`; stop taking work after 120 s.
- Destination folder names: client folder `<legal_name> - <client_id>`; the seven folders exactly `KYC`, `FINANCIALS INFORMATION`, `ACCOUNTING DATA`, `VOUCHERS`, `OTHERS`, `PROPOSALS`, `ENGAGEMENT LETTERS`; unmatched `00 Unmatched - to link`; archive `08 Archive\From old OneDrive`.
- Supabase Free plan: keep `od_copy` under 200 MB; no file content in the database.
- The ABCRM repository is public: no client names, paths with client names, ids or secrets in committed files or tests (use invented names in fixtures).
- Nothing is applied live, deployed or scheduled by this plan; release steps are listed in the README and each needs the user's approval.

## Review Focus

1. **A client appears under two old services (VAT and Accounting) with different spellings** → both land in the same `Accounting\<name> - <code>` folder, under `<FOLDER>\VAT\...` and `<FOLDER>\Accounting\...`; no second client folder. Test in Task 2.
2. **Two different legal entities normalise to the same name (FZCO vs LLC)** → status `review`, never auto-matched. Test in Task 2.
3. **A path longer than 400 characters or with characters OneDrive refuses (`" * : < > ? / \ |`, trailing dots/spaces)** → cleaned and shortened in the middle, original path kept in `plan.source_path`. Test in Task 2.
4. **Graph returns 429/503 mid-run or the copy monitor reports failure** → row stays `failed` with the error, retried up to 5 times, never marked verified. Test in Task 4.
5. **A destination file with the same name already exists** (for example the test client's proposal) → the copy is renamed by Graph (`(1)`), the existing file untouched, and verification uses the returned item. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `Database Module/Document Base/migrations/001_od_copy.sql` | schema, tables, rule tables with seed rows, RLS, grants |
| `Database Module/Document Base/migrations/002_od_copy_plan.sql` | `od_copy.normalize_name`, `od_copy.build_plan()`, `od_copy.approve(...)`, `od_copy.report` view |
| `Database Module/Document Base/tests/000_stub.sql`, `010_plan_test.sql`, `run-local.sh` | local Postgres test harness (pattern of `Email Base/tests/run-local.sh` on branch `email-base-cap-50`) |
| `Document Intelligence Module/supabase/onedrive-copy/msauth.ts` | certificate assertion + token (ported from `email-archive/archive.ts`: `thumbprintToX5t`, `pemToPkcs8`, `assertionParts`, `signAssertion`, `tokenUrl`, `isRetryable`, `retryDelayMs`) |
| `Document Intelligence Module/supabase/onedrive-copy/graph.ts` | `Graph` class: request with retry, delta paging, `getItem`, `ensureFolder`, `startCopy`, `pollCopy`, `recycle`, write guard |
| `Document Intelligence Module/supabase/onedrive-copy/stages.ts` | `runInventory`, `runCopy`, `runRollback` (pure orchestration over injected `Graph` and `Db`) |
| `Document Intelligence Module/supabase/onedrive-copy/index.ts` | HTTP entry: secret check, load settings, dispatch by stage, write `last_run_result` |
| `Document Intelligence Module/supabase/onedrive-copy/*_test.ts` | Deno tests with fake fetch / fake db |
| `Document Intelligence Module/services/odCopyApi.js` | reads `od_copy.report`, settings, client folders; calls `od_copy.approve`, set stage |
| `Document Intelligence Module/logic/odCopyView.js` | pure formatting of the report (GB, percentages, status labels) |
| `Document Intelligence Module/components/OneDriveCopyPanel.jsx` | admin screen |
| `Document Intelligence Module/components/ClientDocumentsBox.jsx` | client profile box |
| `Document Intelligence Module/tests/*.test.mjs` | `node --test` for logic and a static check |
| `Document Intelligence Module/README.md` | purpose, admin grant steps, release steps, run/pause/rollback SQL |
| `Main Module/src/components/Settings.jsx`, `Client Module/crm/ClientMaster.jsx` | mount the panel (admins) and the box (client profile) |

---

### Task 1: Schema and rule tables

**Files:**
- Create: `Database Module/Document Base/migrations/001_od_copy.sql`
- Create: `Database Module/Document Base/tests/000_stub.sql`, `Database Module/Document Base/tests/010_plan_test.sql` (schema part), `Database Module/Document Base/tests/run-local.sh`

**Interfaces:**
- Produces tables in schema `od_copy`:
  - `settings` (single row, `id boolean primary key default true check (id)`): `drive_id text`, `source_item_id text`, `dest_item_id text`, `stage text check (stage in ('idle','inventory','plan','approved','copying','done','paused','rollback'))` default `'idle'`, `delta_link text`, `batch_size int default 20`, `max_in_flight int default 4`, `last_run_at timestamptz`, `last_run_result jsonb`.
  - `source_items`: `item_id text primary key`, `parent_path text not null` (path relative to the source folder, `/`-separated), `name text not null`, `size bigint not null`, `quickxor_hash text`, `modified_at timestamptz`, `is_folder boolean default false`, `seen_at timestamptz default now()`.
  - `area_rules`: `area text primary key` (first path segment, or `Banking ACCOUNT ABC/Bank Account Clients` style two-segment prefix), `department text not null`, `kind text check (kind in ('client','fixed','archive','employees'))`, `service text`, `target_prefix text` (for `fixed`/`archive`). Seeded with every row of the spec's "Department by old area" table.
  - `folder_rules`: `id serial`, `pattern text` (lowercase substring, or `^(19|20)[0-9]{2}$` style regex when `is_regex`), `is_regex boolean default false`, `folder text check (folder in ('KYC','FINANCIALS INFORMATION','ACCOUNTING DATA','VOUCHERS','OTHERS','PROPOSALS','ENGAGEMENT LETTERS'))`, `priority int`. Seeded with the spec's table, first match by `priority`.
  - `client_matches`: `area text`, `folder_name text`, `client_id text references public.client_master(client_id)`, `method text check (method in ('exact','close','manual','none'))`, `status text check (status in ('auto','review','approved','rejected','unmatched'))`, `confidence numeric`, `reviewed_by uuid`, primary key `(area, folder_name)`.
  - `plan`: `source_item_id text primary key references source_items`, `source_path text`, `target_path text not null`, `department text`, `client_id text`, `status text check (status in ('planned','approved','copying','copied','verified','failed','skipped_duplicate','rolled_back'))`, `duplicate_of text`, `dest_item_id text`, `monitor_url text`, `attempts int default 0`, `error text`, `updated_at timestamptz default now()`.
  - `client_folders`: `client_id text`, `department text`, `dest_item_id text`, `web_url text`, primary key `(client_id, department)`.
  - `operations`: `id bigserial`, `at timestamptz default now()`, `action text`, `source_item_id text`, `dest_item_id text`, `result text`, `detail jsonb`; append-only trigger (reuse `public.banking_append_only()` if present, else a local one).
- RLS on every table; `select` for users where `public.is_admin()` or role CEO (use the existing admin check function the CRM uses; discover its name in `Database Module/Admin Base/migrations` and reuse it); writes only for `service_role`. `od_copy` added to the Data API exposed schemas the same way Email Base does (`alter role authenticator set pgrst.db_schemas`), keeping existing schemas.

- [ ] **Step 1: Write `000_stub.sql`** creating minimal `public.client_master(client_id text primary key, legal_name text)`, `public.hr_employees(employee_code text, full_name text, status text)`, the admin-check function used by RLS, and roles `authenticated`, `service_role`, so migrations run on a bare PostgreSQL 18.
- [ ] **Step 2: Write the schema assertions in `010_plan_test.sql`**: every table exists; `settings` has exactly one row with `stage = 'idle'`; `area_rules` has a row for `2. Accounting Clients` → `Accounting`/`client`/`Accounting` and for `Desktop` → `archive`; `folder_rules` maps `kyc` → `KYC` and `bank statement` → `FINANCIALS INFORMATION`; inserting into `operations` then updating it raises.
- [ ] **Step 3: Write `run-local.sh`**: creates a throwaway cluster/database on the local PostgreSQL 18 (`postgresql-x64-18`, port 5432 is the user's; use `initdb` into a temp dir on a free port like the Email Base harness), applies stub, `001`, `002` (when present) twice (idempotency), then the tests with `ON_ERROR_STOP=1`. Run: `bash "Database Module/Document Base/tests/run-local.sh"`. Expected: FAIL (migration missing).
- [ ] **Step 4: Write `001_od_copy.sql`** (idempotent: `create ... if not exists`, `insert ... on conflict do nothing`).
- [ ] **Step 5: Run the harness.** Expected: all schema assertions pass, second apply is clean.
- [ ] **Step 6: Commit** `Document Base: od_copy schema and rule tables`.

### Task 2: Plan builder in SQL

**Files:**
- Create: `Database Module/Document Base/migrations/002_od_copy_plan.sql`
- Modify: `Database Module/Document Base/tests/010_plan_test.sql`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces:
  - `od_copy.normalize_name(text) returns text` — lowercase, `&`→`and`, non-alphanumerics → space, legal-form and filler words removed (`llc`, `l l c`, `fzco`, `fze`, `fzc`, `fz`, `dmcc`, `dwc`, `spc`, `soc`, `ltd`, `limited`, `co`, `company`, `est`, `establishment`, `branch`, `trading`, `general`, `the`, `and`, `service`, `services`), spaces collapsed. Also returns the legal-form words found separately via `od_copy.legal_form(text) returns text` so FZCO vs LLC can be told apart.
  - `od_copy.clean_segment(text) returns text` — replaces `" * : < > ? / \ |` with `-`, trims dots/spaces, maps reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, `.lock`, `_vti_`) by prefixing `_`, max 120 chars keeping the extension.
  - `od_copy.build_plan() returns jsonb` — rebuilds `client_matches` (keeps `approved`/`rejected`/`manual` rows) and `plan` rows still in `planned` (never touches rows past `planned`); returns counts `{files, to_copy, duplicates, bytes_to_copy, matched_folders, review_folders, unmatched_folders}`.
  - `od_copy.approve(p_scope text default 'all', p_area text default null, p_client_id text default null) returns int` — `planned` → `approved` for files whose client match is `auto`/`approved` or whose area kind is not `client`; `p_scope = 'client'` approves only the rows of `p_client_id` (the pilot); review/unmatched client folders are approved only when `p_scope = 'unmatched'` (they go to `00 Unmatched - to link`); `p_area` narrows any scope to one old area.
  - View `od_copy.report` — one row per area: files, GB, duplicates, planned, approved, verified, failed.
- Matching: exact when `normalize_name(folder) = normalize_name(legal_name)` for exactly one client **and** legal forms do not conflict → `auto`, confidence 1.0; same normalised name for two or more clients, or conflicting legal forms → `review`; `similarity()` is not available without `pg_trgm`, so "close" = one name contains the other after normalisation with length ≥ 6 → `review`, confidence 0.7; else `unmatched`.
- Target path (all segments through `clean_segment`, joined with `/`, relative to `CRM AB CAPITAL`):
  - client area, matched (`auto`/`approved`): `<department>/<legal_name> - <client_id>/<FOLDER>/<service>/<rest>` where `<FOLDER>` is from `folder_rules` on the first sub-folder under the old client folder (files directly in it → `OTHERS`) and `<rest>` is the remaining old sub-path including that first sub-folder.
  - client area, review/unmatched: `<department>/00 Unmatched - to link/<area>/<old client folder>/<rest>`.
  - `3. Corporate Tax/<task>/<client>/...`: client folder is the third segment; `<service>` = `Corporate Tax/<task>`.
  - `fixed`: `<target_prefix>/<rest>`; `archive`: `08 Archive/From old OneDrive/<area>/<rest>`; `employees`: `EMPLOYEES/<full_name> - <employee_code>/OTHERS/<rest>` when the folder name matches an `hr_employees.full_name` (case-insensitive, first word match allowed only if unique), `EX Employees/...` → `EMPLOYEES/00 EX EMPLOYEES/<rest>`, else `EMPLOYEES/00 Unmatched/<folder>/<rest>`.
  - Path over 400 characters: keep the first two and last two segments, middle segments shortened to 20 chars each.
- Duplicates: group `source_items` (`is_folder = false`, `quickxor_hash is not null`, `size > 0`) by `(size, quickxor_hash)`; kept = first by (matched client folder first, `modified_at desc`, `length(parent_path)` asc, `item_id`); others `skipped_duplicate` with `duplicate_of` = kept item id.

- [ ] **Step 1: Add failing tests to `010_plan_test.sql`** with invented fixture rows (no real names):
  - `normalize_name('ACME Trading L.L.C') = normalize_name('Acme Trading LLC')` and `= 'acme'`.
  - Folders `4. VAT Clients/Acme Trading LLC/KYC/pass.pdf` and `2. Accounting Clients/ACME TRADING L.L.C/2025/bank.pdf` with `client_master('CL900001','ACME TRADING LLC')` → targets `Accounting/ACME TRADING LLC - CL900001/KYC/VAT/KYC/pass.pdf` and `Accounting/ACME TRADING LLC - CL900001/FINANCIALS INFORMATION/Accounting/2025/bank.pdf` (Review Focus 1).
  - `client_master` rows `('CL900002','Beta Advisors FZCO')`, `('CL900003','Beta Advisors LLC')` and folder `Beta Advisors` → match status `review`, target under `Accounting/00 Unmatched - to link/` (Review Focus 2).
  - A folder name `Gamma: "Co"?` and a 500-char path → `clean_segment` output has no forbidden characters and the target is ≤ 400 chars; `source_path` keeps the original (Review Focus 3).
  - Two files same size, same hash, different names → one `planned`, one `skipped_duplicate` pointing to it; two files same name and size, different hash → both `planned`; a file with null hash → `planned`.
  - `Desktop/notes.txt` → `08 Archive/From old OneDrive/Desktop/notes.txt`.
  - `build_plan()` run twice returns the same counts and does not reset a row set to `verified`.
  - `approve('all')` approves matched and fixed rows only; `approve('unmatched')` approves the unmatched ones.
- [ ] **Step 2: Run harness.** Expected: FAIL (functions missing).
- [ ] **Step 3: Implement `002_od_copy_plan.sql`** (`create or replace`, `security definer`, `set search_path = ''`, execute granted to `service_role` only; `report` view readable by the RLS-allowed users).
- [ ] **Step 4: Run harness.** Expected: PASS, including the second apply.
- [ ] **Step 5: Commit** `Document Base: od_copy plan builder, matching and duplicate rules`.

### Task 3: Microsoft auth and Graph client with write guard

**Files:**
- Create: `Document Intelligence Module/supabase/onedrive-copy/msauth.ts`, `graph.ts`, `graph_test.ts`

**Interfaces:**
- Consumes: env secrets (Global Constraints).
- Produces:
  - `msauth.ts`: `getToken(env: {tenantId, clientId, thumbprint, privateKeyPem}, fetchFn = fetch, now = Date.now): Promise<string>` (client-credentials with a signed JWT assertion, scope `https://graph.microsoft.com/.default`, cached until 60 s before expiry). Port the helpers listed in File Structure from `email-archive/archive.ts` (branch `email-onedrive-archive`), with their tests.
  - `graph.ts`: `class Graph { constructor(opts: { token: () => Promise<string>; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; driveId: string; destRootId: string; destRootPath: string }) }` with methods:
    - `delta(itemId: string, deltaLink?: string): AsyncGenerator<{ items: DriveItem[]; deltaLink?: string }>` — pages `GET /drives/{d}/items/{id}/delta?$select=id,name,size,file,folder,parentReference,lastModifiedDateTime,deleted`.
    - `getItem(itemId: string): Promise<DriveItem>`
    - `ensureFolder(relPath: string): Promise<string>` — walks segments from `destRootId`, `POST children` with `conflictBehavior: fail`; on 409 reads the existing child by path; caches ids per run.
    - `startCopy(sourceId: string, destParentId: string, name: string): Promise<string>` — `POST /drives/{d}/items/{sourceId}/copy?@microsoft.graph.conflictBehavior=rename` body `{ parentReference: { driveId, id: destParentId }, name }`; returns the `Location` monitor URL.
    - `pollCopy(monitorUrl: string): Promise<{ status: 'inProgress' | 'completed' | 'failed'; resourceId?: string; error?: string }>` — monitor URL is called **without** the auth header.
    - `recycle(itemId: string): Promise<void>` — `DELETE /drives/{d}/items/{id}`.
    - `assertUnderDestination(itemId: string): Promise<void>` — reads `parentReference.path` and throws `WriteGuardError` unless it starts with the destination root path; called by `ensureFolder` (for the parent), `startCopy` (for `destParentId`) and `recycle`.
  - `type DriveItem = { id: string; name: string; size?: number; file?: { hashes?: { quickXorHash?: string } }; folder?: object; parentReference?: { path?: string; id?: string }; lastModifiedDateTime?: string; deleted?: object }`.
  - Retries: on 429/503/504 wait `retryDelayMs(Retry-After, attempt)` up to 5 attempts; other errors throw `GraphError(status, code)` without URLs or tokens in the message.

- [ ] **Step 1: Write failing tests in `graph_test.ts`** with a fake fetch:
  - `getToken` posts `client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer` and caches (second call makes no request).
  - `delta` follows `@odata.nextLink` and yields the final `@odata.deltaLink`.
  - `ensureFolder('Accounting/X - CL900001/KYC')` creates three levels, and on a 409 reuses the existing id.
  - `startCopy` to a parent whose path is outside the destination throws `WriteGuardError` and sends no POST; `recycle` on a source-folder item throws `WriteGuardError` and sends no DELETE.
  - 429 with `Retry-After: 2` then 200 → one sleep of 2000 ms, success; five 503s → `GraphError`.
  - `pollCopy` sends no `Authorization` header.
- [ ] **Step 2: Run** `deno test "Document Intelligence Module/supabase/onedrive-copy/"`. Expected: FAIL.
- [ ] **Step 3: Implement `msauth.ts` and `graph.ts`.**
- [ ] **Step 4: Run tests.** Expected: PASS; `deno check index-free files` clean.
- [ ] **Step 5: Commit** `onedrive-copy: Graph client with certificate auth, retries and write guard`.

### Task 4: Stages and the Edge Function

**Files:**
- Create: `Document Intelligence Module/supabase/onedrive-copy/stages.ts`, `index.ts`, `stages_test.ts`

**Interfaces:**
- Consumes: `Graph` (Task 3); SQL functions (Task 2).
- Produces:
  - `interface Db { getSettings(): Promise<Settings>; saveSettings(p: Partial<Settings>): Promise<void>; upsertSourceItems(rows: SourceRow[]): Promise<void>; markDeleted(ids: string[]): Promise<void>; buildPlan(): Promise<Record<string, number>>; claim(status: 'approved' | 'copying', limit: number): Promise<PlanRow[]>; update(id: string, patch: Partial<PlanRow>): Promise<void>; log(op: Operation): Promise<void>; upsertClientFolder(row: ClientFolderRow): Promise<void> }` implemented in `index.ts` with supabase-js (service role, schema `od_copy`); `claim` uses a `for update skip locked` RPC `od_copy.claim(p_status, p_limit)` added to `002_od_copy_plan.sql` in this task.
  - `runInventory(g: Graph, db: Db, deadline: number): Promise<{ pages: number; items: number; done: boolean }>` — from `settings.delta_link` or the source item; stores files and folders with `parent_path` relative to the source root; on the final page saves `delta_link`, calls `db.buildPlan()` and sets `stage = 'plan'` (waits for approval).
  - `runCopy(g: Graph, db: Db, deadline: number, maxInFlight: number): Promise<{ started: number; verified: number; failed: number }>` — first polls rows in `copying` (monitor URL), then starts new `approved` rows: `ensureFolder(dirname(target_path))`, `startCopy`, store monitor, status `copying`. On `completed`: `getItem(resourceId)`, verify size and `quickXorHash` equal the source row → `verified`, log, and for client paths `upsertClientFolder` with the client folder's id and `webUrl`. On `failed` or mismatch: `attempts + 1`, `failed` with error; rows with `attempts < 5` go back to `approved`. When no `approved`/`copying` rows remain → `stage = 'done'`.
  - `runRollback(g: Graph, db: Db, deadline: number, scope: { area?: string; clientId?: string }): Promise<{ recycled: number }>` — only rows `verified` with `dest_item_id`; re-reads the destination item and recycles it only if size and hash still match; status `rolled_back`; logs.
  - `index.ts`: `POST` with header `x-od-copy-secret` equal to `OD_COPY_SECRET` (else 401); `stage` `idle`/`paused`/`plan`/`done` → returns `{ skipped: stage }`; `inventory` → `runInventory`; `approved`/`copying` → `runCopy`; `rollback` → `runRollback` with scope from `settings.last_run_result.rollback_scope`; always writes `last_run_at` and `last_run_result`; deadline `Date.now() + 120_000`.

- [ ] **Step 1: Write failing tests in `stages_test.ts`** with a fake `Graph` and in-memory `Db`:
  - inventory over two delta pages stores all files, saves the delta link, calls `buildPlan` once, ends in `stage = 'plan'`.
  - copy: an approved row → `copying` with monitor; next run, monitor `completed` with matching size/hash → `verified`, one `operations` row, client folder recorded.
  - Review Focus 4: monitor `failed` → `failed` with error and `attempts = 1`, back to `approved`; after the 5th failure it stays `failed`; a 429 during `startCopy` leaves the row `approved` (not `copying`).
  - Review Focus 5: destination name exists → the fake Graph returns a renamed item; verification uses `resourceId`, row `verified`.
  - Hash mismatch on the copied item → `failed`, never `verified`.
  - Deadline in the past → no new copies started.
  - Rollback recycles only `verified` rows whose current hash matches; a changed destination file is left and logged as `skipped_changed`.
  - `index.ts` handler: missing/wrong secret → 401; stage `idle` → `{ skipped: 'idle' }` and no Graph call.
- [ ] **Step 2: Run** `deno test "Document Intelligence Module/supabase/onedrive-copy/"`. Expected: FAIL.
- [ ] **Step 3: Implement `stages.ts`, `index.ts`, and add `od_copy.claim` to `002_od_copy_plan.sql`** with a SQL test (two concurrent claims never return the same row: claim inside two transactions in the harness).
- [ ] **Step 4: Run Deno tests and the SQL harness.** Expected: PASS.
- [ ] **Step 5: Commit** `onedrive-copy: inventory, copy, verify and rollback stages`.

### Task 5: CRM screens

**Files:**
- Create: `Document Intelligence Module/services/odCopyApi.js`, `logic/odCopyView.js`, `components/OneDriveCopyPanel.jsx`, `components/ClientDocumentsBox.jsx`, `tests/odCopyView.test.mjs`, `tests/static.test.mjs`
- Modify: `Main Module/src/components/Settings.jsx` (add the panel to the admin tab list; tabs must also be added to the list near `Settings.jsx:267`), `Client Module/crm/ClientMaster.jsx` (mount the box in the client profile)

**Interfaces:**
- Consumes: `od_copy.report`, `od_copy.settings`, `od_copy.client_folders`, `od_copy.plan` (read via RLS), RPCs `od_copy.approve`, and an RPC `od_copy.set_stage(p_stage text)` (admin-only, allowed transitions `idle→inventory`, `plan→approved` only via `approve`, any→`paused`, `paused→`previous) added to `002_od_copy_plan.sql` with a SQL test.
- Produces:
  - `odCopyApi.js`: `loadReport()`, `loadSettings()`, `loadClientFolders(clientId)`, `loadIssues(kind: 'duplicates' | 'review' | 'unmatched' | 'failed', limit = 200)`, `approve(scope, area)`, `setStage(stage)` — all through the shared supabase client import the other modules use (`ref_app_supabase` alias), schema `od_copy`.
  - `odCopyView.js`: `formatBytes(n)`, `progress(report) -> { total, verified, failed, pct }`, `stageLabel(stage)` (`idle` → "Not started", `inventory` → "Listing the old folder", `plan` → "Plan ready, waiting for approval", `approved`/`copying` → "Copying", `done` → "Done", `paused` → "Paused", `rollback` → "Undoing").
  - `OneDriveCopyPanel.jsx` (admins/CEO only): stage label, counts by area (files, GB, duplicates skipped, review, unmatched, verified, failed), tabs for duplicates / review / unmatched / failed lists (path shown, no file content), buttons **Start listing** (`idle→inventory`), **Approve matched and fixed**, **Approve unmatched**, **Pause**, **Resume**. Uses the shared `Button`, `Badge`, table components and the JSX runtime like other modules.
  - `ClientDocumentsBox.jsx`: "Documents in OneDrive" — one line per department folder with "Open in OneDrive" (`web_url`, `target="_blank"`, `rel="noopener noreferrer"`); empty state "No OneDrive folder linked yet."

- [ ] **Step 1: Write failing tests**: `odCopyView.test.mjs` (`formatBytes(1536) === '1.5 KB'`, `formatBytes(132e9) === '122.9 GB'`, `progress` with 10 total / 4 verified → `pct === 40`, every stage has a label); `static.test.mjs` (both components import only from existing aliases; the panel never renders without the admin check; no `dangerouslySetInnerHTML`).
- [ ] **Step 2: Run** `node --test "Document Intelligence Module/tests/"`. Expected: FAIL.
- [ ] **Step 3: Implement the service, logic and components; mount them in Settings and ClientMaster.**
- [ ] **Step 4: Run** the module tests, the Client Module and Main Module test suites, and `npm run build` in `Main Module` (run `npm ci` first if `node_modules` is missing). Expected: PASS and a clean build.
- [ ] **Step 5: Commit** `Document Intelligence: OneDrive copy panel and client documents box`.

### Task 6: README, release script and final checks

**Files:**
- Create: `Document Intelligence Module/README.md`, `Database Module/Document Base/README.md`, `Document Intelligence Module/supabase/deploy_onedrive_copy.sh`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation and a deploy script that is **not run** by this plan.

- [ ] **Step 1: Write `Document Intelligence Module/README.md`**: what it does; the admin grant (find the OneDrive site id in Graph Explorer with `GET https://graph.microsoft.com/v1.0/users/{owner upn}/drive?$select=id,sharepointIds`, then `POST /sites/{site-id}/permissions` with `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<MS_CLIENT_ID>","displayName":"CRM-Email-Archive"}}]}`, signed in as a SharePoint/Global admin with `Sites.FullControl.All`); setting `OD_COPY_SECRET` as an Edge Function secret and in Vault (`od_copy_secret`); release order (migrations → deploy function → set `settings.drive_id`, `source_item_id`, `dest_item_id` → schedule cron → **Start listing** → review reports → pilot client via `approve('client', null, '<client id>')` → **Approve** the rest); pause, resume and rollback SQL; troubleshooting (429s, failed rows, long paths).
- [ ] **Step 2: Write `deploy_onedrive_copy.sh`** mirroring `Email Base/deploy_archive.sh`: apply `001`, `002` with the CLI in `Database Module/tools`, stage the function into a temp `supabase/functions/onedrive-copy`, deploy with `--no-verify-jwt`, and print (not run) the `cron.schedule('od-copy', '* * * * *', ...)` statement that posts to the function with the Vault secret.
- [ ] **Step 3: Write `Database Module/Document Base/README.md`** (tables, sizes, tests command).
- [ ] **Step 4: Run all checks**: SQL harness, `deno test` and `deno check` on the function, `node --test` on the module, `npm run build` in Main Module; scan committed files for client names or secrets (`git diff --stat origin/main...` and a grep for `CL0000`/`@abcapital` outside fixtures). Expected: all pass, scan clean.
- [ ] **Step 5: Commit** `Document Intelligence: OneDrive copy README and release script`.
