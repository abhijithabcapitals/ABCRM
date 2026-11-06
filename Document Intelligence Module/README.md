# Document Intelligence Module

## OneDrive copy job

Copies the old OneDrive folder `AB Capital One Drive` into the new folder `CRM AB CAPITAL`, sorted by client and
department. Design: `docs/2026-11-06-onedrive-copy-design.md`. Plan: `docs/2026-11-06-onedrive-copy-plan.md`.

What it does, in order:

1. Lists the old folder (Graph delta) into `od_copy.source_items`. No file content is stored, only names, sizes and hashes.
2. Builds a plan (`od_copy.build_plan()`): target folder per file, client match, duplicates (identical size and
   identical `quickXorHash`; a file without a hash is never a duplicate).
3. A person reviews the report and approves. Nothing is copied before approval.
4. Copies approved files (`conflictBehavior: rename`, at most 4 in flight, honours `Retry-After`, stops taking work after 120 s per run),
   then verifies each copy by size and hash.
5. Rollback moves only this job's own verified copies to the OneDrive recycle bin.

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
  (the cron job reads the Vault copy and sends it in the header `x-od-copy-secret`).
- `SUPABASE_DB_URL`: already set on the project. `build_plan` uses it for a direct Postgres connection because the plan
  takes 30-40 s on about 170k rows, longer than the Data API allows.

Never paste any of these values into the repository, chat or a ticket.

### The one admin grant

The app needs write access to the user's OneDrive site (the `CRM AB CAPITAL` folder lives there). A SharePoint admin or
Global admin, signed in to Graph Explorer with the `Sites.FullControl.All` permission consented, does this once:

1. Find the site id of the OneDrive:
   `GET https://graph.microsoft.com/v1.0/users/<owner-upn>/drive?$select=id,sharepointIds`
   Note `id` (the drive id) and `sharepointIds.siteId` (the site id; use the full value Graph returns).
2. Grant the app write on that site:
   `POST https://graph.microsoft.com/v1.0/sites/<site-id>/permissions`
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
2. Deploy the Edge Function `onedrive-copy` (needs approval). `supabase/deploy_onedrive_copy.sh` does steps 1 and 2 and prints the cron statement.
3. Do the admin grant above (needs approval; done by an admin in Graph Explorer).
4. Set `OD_COPY_SECRET` (Edge Function secret and Vault `od_copy_secret`) (needs approval).
5. Fill `drive_id`, `source_item_id`, `dest_item_id` (needs approval).
6. Schedule the cron job: run the statement the script prints (needs approval). It posts every minute; while the stage is `idle`, `done` or `paused` the function does nothing.
7. Press **Start listing** in the panel (needs approval). The function lists the old folder and builds the plan. Stage becomes `plan`.
8. Review the reports (per old area: files, GB, duplicates, unmatched, path warnings) and the client matches (needs approval of the matches).
   If the matches are changed, **re-run `od_copy.build_plan()`** so `approve` sees the new matches (it decides "matched" from `plan.client_id`).
9. Pilot one client (needs approval):
   ```sql
   select od_copy.approve('client', null, '<client-id>');
   ```
   The pilot approval only marks rows `approved`; copying runs only in stage `approved`, so then start it (needs approval):
   ```sql
   update od_copy.settings set stage = 'approved' where id and stage = 'plan';
   ```
   When the pilot rows are verified, check the result in OneDrive by eye before step 10.
10. Press **Approve matched and fixed**, then later **Approve unmatched** (each needs approval). Copying starts as soon as you confirm.
11. Watch the report until stage `done`; handle the failed rows (below).

The panel is admin/CEO only. Staff see only folder links in the client documents box; real access is enforced by OneDrive permissions.

## Pause and resume

Use the panel buttons **Pause** and **Resume**, or SQL:

```sql
select od_copy.set_stage('paused');
select od_copy.set_stage('resume');
```

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

Rollback works from stage `done` or `paused`. After a full pass the stage becomes `paused` (so it does not run every minute);
press **Resume** or set a new stage when you want to continue. Rolled-back rows get status `rolled_back`.

## Failed rows

A row becomes `failed` after repeated errors. The panel lists them under the failed tab. For each:

1. A person checks the destination in OneDrive: is the file there already (maybe from an interrupted copy)?
2. If it is missing, set the row back so the next run retries it:
   ```sql
   update od_copy.plan set status = 'approved', attempts = 0, error = null where source_item_id = '<source-item-id>';
   update od_copy.settings set stage = 'approved' where id and stage = 'done';   -- only if the job already finished
   ```
3. If a copy exists and is correct, leave it or mark it by hand; if it is a stray, delete it in OneDrive by hand.

A failed keeper leaves its duplicates uncopied: the panel notes how many files skipped as duplicates of it.

## Known limits and residual risks

- **Interruption (R9a):** if the function dies between starting a copy and saving its monitor URL, one extra copy named like `name (1).ext`
  can appear in the destination. Find them by that suffix and delete by hand.
- **Do not reorganise the old folder during the copy (R9b):** renamed or moved source folders are not tracked by the incremental delta.
- **Size-only verification (R11):** a file whose source has no `quickXorHash` is verified on size only (`plan.hash_checked = false`). The report counts them separately ("Size only").
- **Long paths:** targets must stay under 400 characters including `CRM AB CAPITAL/`. Over-long segments are shortened; if protected segments alone are too long the copy fails and the row is listed.
- **Path encoding:** `parentReference.path` is assumed percent-encoded (Graph docs); confirm in the first dry run.
- The old folder is never modified.

## Troubleshooting

- **429 / 503 from Graph:** normal under load. The job honours `Retry-After` and backs off; do nothing. If it persists, press **Pause** and resume later.
- **Copy POST returning 502/504:** not retried automatically (it may already have copied). The row is checked next run; look for a `(1)` duplicate.
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
