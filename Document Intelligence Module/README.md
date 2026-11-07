# Document Intelligence Module

## OneDrive copy job

Copies the old OneDrive folder `AB Capital One Drive` into the new folder `CRM AB CAPITAL`, sorted by client and
department. Design: `docs/2026-11-06-onedrive-copy-design.md`. Plan: `docs/2026-11-06-onedrive-copy-plan.md`.

What it does, in order:

1. Lists the old folder into `od_copy.source_items` (stage `inventory`). OneDrive for Business supports Graph delta
   only on the drive root, so the job reads the delta of the whole drive and keeps only items below the source folder
   (everything else, including `CRM AB CAPITAL` and any sibling named like the source, is ignored). Paths are stored
   relative to the source folder. No file content is stored, only names, sizes and hashes.
2. When the listing is complete the stage becomes `planning`; the **next** run builds the plan
   (`od_copy.build_plan()`, 30-40 s) at its start, then the stage becomes `plan`. The plan has the target folder per file,
   the client match and duplicates (identical size and identical `quickXorHash`; a file without a hash is never a duplicate).
3. A person reviews the report and approves: first one client (pilot), then the rest. Nothing is copied before approval.
4. Copies approved files (`conflictBehavior: rename`, at most 4 in flight, honours `Retry-After`, stops taking work after 120 s per run),
   then verifies each copy by size and hash.
5. Rollback moves only this job's own verified copies to the OneDrive recycle bin.

**One run at a time.** The cron job posts every minute and a run takes up to 120 s, so each run first takes the run lock
(`od_copy.try_lock`: `settings.running_until` + `run_token`, held 150 s at most). A run that cannot get it answers
`{ "skipped": "locked" }` and does nothing. The delta link is saved only while the run still holds the lock, so it never
moves backwards. A run that dies frees the lock by itself after 150 s.

Safety rules in the code: the old folder is **never modified** (read-only); every write goes through one guard that
refuses anything outside `CRM AB CAPITAL`; no overwrite, no permanent delete, no sharing links, no permission changes.

Pieces:

| Piece | Location |
|---|---|
| Edge Function `onedrive-copy` | `supabase/onedrive-copy/` (tests: `*_test.ts`) |
| Database (`od_copy` schema) | `Database Module/Document Base/` (see its README) |
| Admin panel | `components/OneDriveCopyPanel.jsx` |
| Client documents box (folder links) | `components/ClientDocumentsBox.jsx` |
| Release script (not run by the build) | `supabase/deploy_onedrive_copy.sh` |

## Microsoft access

The job reuses the Entra app **CRM-Email-Archive** (certificate sign-in, no client secret). Its Edge Function secrets
already exist for the email archive and are shared:

- `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CERT_THUMBPRINT`, `MS_CERT_PRIVATE_KEY`

New secrets for this job:

- `OD_COPY_SECRET`: a long random value. Set it as an Edge Function secret **and** in Vault under the name `od_copy_secret`
  (the cron job reads the Vault copy and sends it in the header `x-od-copy-secret`). Vault, in the SQL editor (type the
  value there, never in a file):
  ```sql
  select vault.create_secret('<value>', 'od_copy_secret');
  ```
- `SUPABASE_DB_URL`: already set on the project. `build_plan` uses it for a direct Postgres connection because the plan
  takes 30-40 s on about 170k rows, longer than the Data API allows.

Never paste any of these values into the repository, chat or a ticket.

### The one admin grant

The app needs write access to the user's OneDrive site (the `CRM AB CAPITAL` folder lives there). A SharePoint admin or
Global admin, signed in to Graph Explorer with the `Sites.FullControl.All` permission consented, does this once:

1. Find the drive id and the full site id of the OneDrive:
   - drive id: `GET https://graph.microsoft.com/v1.0/users/<owner-upn>/drive?$select=id`
   - site id: `GET https://graph.microsoft.com/v1.0/sites/<tenant>-my.sharepoint.com:/personal/<user_path>?$select=id`
     (`<user_path>` is the last part of the OneDrive URL, e.g. `first_last_company_com`). Use the **full composite id**
     Graph returns (`<host>,<site-collection-guid>,<web-guid>`); `sharepointIds.siteId` alone is only the middle part and
     the grant fails with it.
2. Grant the app write on that site:
   `POST https://graph.microsoft.com/v1.0/sites/<full-site-id>/permissions`
   ```json
   {"roles":["write"],"grantedToIdentities":[{"application":{"id":"<MS_CLIENT_ID>","displayName":"CRM-Email-Archive"}}]}
   ```
3. Find the two folder ids (item ids):
   - source: `GET /drives/<drive-id>/root:/AB Capital One Drive?$select=id,name`
   - destination (create `CRM AB CAPITAL` at the top of the drive first, by hand): `GET /drives/<drive-id>/root:/CRM AB CAPITAL?$select=id,name`

The destination root path is fixed in code as `CRM AB CAPITAL`. The function checks that `dest_item_id` really is that folder
and refuses to run otherwise.

## Settings to fill

In `od_copy.settings` (one row), by SQL editor:

```sql
update od_copy.settings
   set drive_id = '<drive-id>', source_item_id = '<source-folder-item-id>', dest_item_id = '<destination-folder-item-id>'
 where id;
```

## Release order

Nothing in this plan is applied live. Each step below **needs approval** from the user before it is done.

1. Apply migrations `001_od_copy.sql` then `002_od_copy_plan.sql` (needs approval). Re-run 002 after any re-run of 001.
   **Before applying 001**, check which schemas the Data API exposes, because 001 appends `od_copy` to that list:
   ```sql
   select r.rolname, s.setconfig from pg_db_role_setting s join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
   ```
   If `pgrst.db_schemas` is not there (the list is kept in the dashboard instead), 001 falls back to a built-in list;
   compare it with Settings > API > Exposed schemas and fix the list by hand if it differs.
2. Deploy the Edge Function `onedrive-copy` (needs approval). `supabase/deploy_onedrive_copy.sh` does steps 1 and 2 and prints the cron statement.
3. Do the admin grant above (needs approval; done by an admin in Graph Explorer).
4. Set `OD_COPY_SECRET` (Edge Function secret and Vault `od_copy_secret`) (needs approval).
5. Fill `drive_id`, `source_item_id`, `dest_item_id` (needs approval).
6. Schedule the cron job: run the statement the script prints (needs approval). It posts every minute; while the stage is `idle`, `done` or `paused` the function does nothing.
7. Press **Start listing** in the panel (needs approval). The function lists the old folder over one or more runs, then
   the stage becomes `planning` and the next run builds the plan. Stage becomes `plan`.
8. Review the reports (per old area: files, GB, duplicates, verified, failed), the lists in the panel (duplicates with every
   location, client matches to review, unmatched folders) and the client matches (needs approval of the matches).
   To accept a match that is under review (status `review`), or to link a folder by hand:
   ```sql
   update od_copy.client_matches set status = 'approved', client_id = '<client-id>', method = 'manual'
    where area = '<old-area>' and folder_name = '<old-folder-name>';
   ```
   To reject one: `set status = 'rejected', client_id = null` (it then goes to `00 Unmatched - to link`).
   After changing matches, **re-build the plan** so `approve` sees them (it decides "matched" from `plan.client_id`).
   Easiest is to let the function do it (it uses a direct connection with no timeout):
   ```sql
   update od_copy.settings set stage = 'planning' where id and stage = 'plan';
   ```
   or run `select od_copy.build_plan();` in the SQL editor. Rows already approved or copied are not changed.
9. Pilot one client (needs approval): type the client code in the panel and press **Copy one client (pilot)**
   (or `select od_copy.admin_approve('client', '<client-id>');` as an admin or the CEO). This approves that client's
   rows only and starts copying (stage `plan` or `done` -> `approved`). When the pilot rows are verified, check the result
   in OneDrive by eye before step 10.
10. Press **Approve matched and fixed**, then later **Approve unmatched** (each needs approval). Both stay disabled until at
    least one copy is verified (the database refuses bulk approval before that, too). An old area can be picked to
    approve one area at a time. The confirm dialog shows the number of files and the size; copying starts as soon as
    you confirm.
11. Watch the report until stage `done`; handle the failed rows (below).

The panel is for admins and the CEO (the same rule as `od_copy.can_read()`: `public.admin_is()` or the `ceo.profiles`
owner). Admins see it at once; anyone else only after the panel has asked `od_copy.can_read()`. Staff see only folder
links in the client documents box; real access is enforced by OneDrive permissions.

## Pause and resume

Use the panel buttons **Pause** and **Resume**, or SQL:

```sql
select od_copy.set_stage('paused');
select od_copy.set_stage('resume');
```

Pause works in `inventory`, `planning`, `plan`, `approved`, `copying` and `rollback`; Resume returns to the stage that
was paused.

## Rollback

The panel has **no rollback button**. Rollback is SQL only. It sends this job's own verified copies to the recycle bin (restorable)
and never touches the old folder. Choose a scope first; the function refuses to roll back without one.

```sql
-- one of:
update od_copy.settings set rollback_scope = '{"clientId":"<client-id>"}'::jsonb where id;   -- one client
update od_copy.settings set rollback_scope = '{"area":"<old-area-name>"}'::jsonb where id;   -- one old area
update od_copy.settings set rollback_scope = '{"all":true}'::jsonb where id;                 -- everything
select od_copy.set_stage('rollback');
```

Rollback works from stage `done` or `paused` and remembers the stage it came from (`done`, or the stage the pause
remembered). After a full pass the stage becomes `paused` (so it does not run every minute); **Resume** then returns to
that stage (usually `done`). To **stop a rollback** part-way, press **Pause** (or `select od_copy.set_stage('paused');`):
the stage becomes `paused` and Resume also returns to the stage from before the rollback, not to the rollback. Start it
again with `select od_copy.set_stage('rollback');`. Rolled-back rows get status `rolled_back`.

Rollback only touches rows `verified` with the `dest_item_id` this job recorded. A copy that could not be verified
(row `failed` with a `dest_item_id`, see below) is never recycled automatically: check it by hand.

## Failed rows

A row becomes `failed` (the panel lists them under the failed tab; SQL: `od_copy.failed_items`) when:

- **5 counted attempts** failed where no copy item is known to exist (Graph reported the copy failed, the copy POST
  failed, including 502/504, or a run was interrupted before the copy was recorded);
- **verify mismatch**: the copy's size or hash differs. The job re-reads the source: the error says either
  "the source changed since the listing" (list again so the new size and hash are known:
  `update od_copy.settings set stage = 'inventory' where id and stage in ('done', 'paused');` - the delta is incremental
  and quick - then retry the row as below) or "the copy differs from the unchanged source". It never copies again by
  itself; the copy's id stays in `dest_item_id` so it can be found;
- **unsettled for too long**: a copy whose state could not be learned (transient errors, the copy has no hash yet) is
  re-checked every run, but after **20 runs or 2 hours** it goes to failed so it stops holding one of the 4 slots;
- **a file is in the way**: a file in the destination has the name of a folder the target path needs. Only that row
  fails; the run goes on. Rename or move the file in OneDrive, then retry the row;
- the copy monitor or the copied item is gone (404), or a copy finished without an item id.

For each:

1. A person checks the destination in OneDrive: is the file there already (maybe from an interrupted copy)? When
   `dest_item_id` is set, that item is the job's own copy: `GET /drives/<drive-id>/items/<dest_item_id>`.
2. If it is missing (or the stray copy was deleted by hand), set the row back so the next run retries it:
   ```sql
   update od_copy.plan set status = 'approved', attempts = 0, error = null where source_item_id = '<source-item-id>';
   update od_copy.settings set stage = 'approved' where id and stage in ('done', 'plan');   -- only if copying is not running
   ```
   The earlier `dest_item_id` is written to `od_copy.operations` (result `earlier_copy`) before the new copy starts, so it
   is never lost.
3. If a copy exists and is correct, leave it or mark it by hand; if it is a stray, delete it in OneDrive by hand.

A failed keeper leaves its duplicates uncopied: the panel notes how many files skipped as duplicates of it.

## Employees

Old employee folders go to `EMPLOYEES/<Full Name> - <Code>/OTHERS/...` when the folder matches one employee in
`public.hr_employees`. Ex-employees (status `Left` or an `exit_date` set) go to
`EMPLOYEES/00 EX EMPLOYEES/<Full Name> - <Code>/OTHERS/...`. Folders that match nobody go to `EMPLOYEES/00 Unmatched`.

## Known limits and residual risks

- **Interruption (R9a):** if the function dies between starting a copy and saving its monitor URL, one extra copy named like `name (1).ext`
  can appear in the destination. Find them by that suffix and delete by hand.
- **Do not reorganise the old folder during the copy (R9b):** renamed or moved source folders are not tracked by the incremental delta.
- **Size-only verification (R11):** a file whose source has no `quickXorHash` is verified on size only (`plan.hash_checked = false`). The report counts them separately ("Size only").
- **Long paths:** targets must stay under 400 characters including `CRM AB CAPITAL/`. Over-long segments are shortened; if protected segments alone are too long the copy fails and the row is listed.
- **Path encoding:** `parentReference.path` is assumed percent-encoded (Graph docs); confirm in the first dry run.
- **Drive-root delta:** the first listing reads every item of the drive (also outside the source) and keeps only the
  source's. On OneDrive for Business delta items carry no path, so items are placed by parent id; a parent folder not
  seen yet is looked up once (`GET item`), not once per file.
- The old folder is never modified.

## Troubleshooting

- **429 / 503 from Graph:** normal under load. The job honours `Retry-After` and backs off; do nothing. If it persists, press **Pause** and resume later.
- **Copy POST returning 502/504:** not retried inside the same request (the POST is not idempotent), but counted as a
  failed attempt: the row goes back to `approved` and is copied again after the back-off (about 150 s), up to 5 attempts.
  If Microsoft had accepted the first POST despite the error, the destination can hold an extra `name (1).ext`; look for it
  when many 502/504 appear in `od_copy.operations`.
- **`{ "skipped": "locked" }` in the cron log:** normal; the previous run was still working. A lock left by a dead run
  expires after 150 s (`od_copy.settings.running_until`).
- **Many failed rows with the same error:** read `od_copy.failed_items` (path, attempts, error) before resetting any.
- **`401`/`403`:** check the admin grant and that `MS_CERT_*` secrets are intact.
- **Nothing happens:** check the stage in the panel, the cron job (`select * from cron.job_run_details order by start_time desc limit 5`) and the function logs.
- **Database size:** `od_copy` is kept under 200 MB for the Supabase Free plan; no file content is stored.

## Tests

```
bash "Database Module/Document Base/tests/run-local.sh"
cd "Document Intelligence Module/supabase/onedrive-copy" && deno test --allow-env && deno check index.ts
node --test "Document Intelligence Module/tests"
cd "Main Module" && npm run build
```
