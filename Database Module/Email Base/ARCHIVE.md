# Email Base archive to SharePoint

This job moves the files in the Supabase Storage bucket `email-base` (`.eml` originals and attachments) to a SharePoint document library. It removes a file from Supabase only after its SharePoint copy is verified. The goal is to get Supabase Storage under the free plan's 1 GB limit without losing any mail file.

The job has two parts:
- Migration `migrations/009_onedrive_archive.sql` adds the queue, the settings, the copy report and the cron job.
- Edge Function `supabase/email-archive` copies the files, verifies each copy and deletes the Storage file when allowed.

## State on 2026-11-06

- The bucket holds 123,980 files, 36.1 GB:
  - 28,084 `.eml` files, 21.5 GB.
  - 95,896 attachments, 14.6 GB.
  - The largest file is 10.5 MB.
- `info@abcapital.ae` has 118,785 files (34.0 GB). `bharat@ardentaxit.tax` has 5,195 files (2.1 GB).
- `email_base.messages`, `attachments` and `threads` are empty, and the mail sync is stopped. The archive therefore works from the Storage paths alone, not from message rows.
- A dry run of migration 009, rolled back, queued all 123,980 files and found nothing yet deletable.

## How it works

1. Every 3 minutes, cron job `email-base-archive` calls `email-archive`. While `archive_settings.enabled` is false, the function returns at once.
2. `archive_enqueue()` adds one `archive_items` row for each bucket object that is older than `min_age_hours` and not yet listed. New files are picked up on later runs, so the job can be re-run safely.
3. `archive_claim(batch_size)` hands out the oldest pending or failed rows and locks them for 10 minutes. Two runs never copy the same file.
4. For each file the function does the following:
   1. It downloads the file from Storage.
   2. It uploads the file to `<root_folder>/<mailbox address>/<folder>/<uidvalidity>/<uid>/...` in the site's default library, with conflict behaviour `replace`. Files up to 4 MB use a simple PUT. Larger files use an upload session.
   3. It verifies the copy. The SharePoint size must equal the Storage size and the downloaded size. With `verify_mode = 'hash'` (the default), the quickXorHash computed from the downloaded bytes must also equal SharePoint's `file.hashes.quickXorHash`.
   4. It records the result. A verified copy stores `drive_item_id`, `web_url`, `sharepoint_path`, `remote_size`, `quickxor_hash`, `verified_at` and status `verified`. A failure stores `failed` with `last_error`. A failed file is retried up to `max_attempts` times.
5. The function deletes Storage files only when `delete_after_verify` is true. `archive_delete_candidates()` returns only verified rows whose Storage object still has the size and eTag that were copied. After the Storage delete, `archive_mark_deleted()` sets status `deleted`, but only for paths that are really gone.
6. Each run stops taking new files after 120 s and writes its result to `archive_settings.last_run_result`.

Characters that SharePoint refuses (`" * : < > ? / \ |`), reserved names (`CON`, `.lock`, `_vti_`), and leading or trailing dots and spaces are replaced. Path segments are shortened to 120 characters, keeping the extension. The exact SharePoint path of each file is in `archive_items.sharepoint_path`.

## Differences from ONEDRIVE_INTEGRATION.md

- This job uses its own app registration and its own site. It does not use the Document Agent app. This keeps the grant limited to mail.
- The standard asks for one `core.agent_action_log` row per Graph change. This job instead keeps one `archive_items` row per file. That row holds the action, the time and the result. Another 124,000 log rows would use database space that the free plan does not have.
- Graph IDs are stored in SQL as the standard requires (`drive_item_id`). Paths are kept for display only.
- The Messenger Module's `ms365` code was not reused. It uses delegated sign-in for each user, with refresh tokens and the `User.Read` scope. This job needs app-only access with a certificate.

## One-time setup

An Entra admin and a SharePoint admin must do steps 1 to 4.

1. **Create the site.** In the SharePoint admin centre, create a team or communication site, for example `MailArchive` (`https://abcapital.sharepoint.com/sites/MailArchive`). Make sure the site has more than 36 GB of storage.
2. **Register the app.** In Entra ID, go to App registrations and choose New registration. Name it `CRM-Email-Archive`, single tenant. Note the tenant ID and the client (application) ID.
3. **Add the certificate.** On an admin PC, run:
   ```bash
   openssl req -x509 -newkey rsa:2048 -nodes -days 730 -subj "/CN=CRM-Email-Archive" -keyout archive.key.pem -out archive.cert.pem
   ```
   ```bash
   openssl pkcs8 -topk8 -nocrypt -in archive.key.pem -out archive.pk8.pem
   ```
   Then upload `archive.cert.pem` under Certificates & secrets, Certificates. Note the thumbprint that Entra shows. Keep `archive.pk8.pem` secret and delete `archive.key.pem` afterwards.
4. **Grant access to this site only.**
   1. Under API permissions, add Microsoft Graph, Application permission `Sites.Selected`.
   2. Choose Grant admin consent.
   3. A SharePoint or Global admin grants write access on the one site. In Graph Explorer, signed in as that admin with `Sites.FullControl.All`, run:
      ```http
      GET https://graph.microsoft.com/v1.0/sites/abcapital.sharepoint.com:/sites/MailArchive?$select=id
      ```
      ```http
      POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
      Content-Type: application/json

      { "roles": ["write"], "grantedToIdentities": [{ "application": { "id": "<client id>", "displayName": "CRM-Email-Archive" } }] }
      ```
   Do not grant `Files.ReadWrite.All` or `Sites.ReadWrite.All`.
5. **Set the Edge Function secrets** in the Supabase project `pnnakrhfzyxudjaghoxx`:
   ```bash
   supabase secrets set MS_TENANT_ID=<tenant id> MS_CLIENT_ID=<client id> MS_CERT_THUMBPRINT=<thumbprint> ARCHIVE_SECRET=<random 32+ chars>
   ```
   ```bash
   supabase secrets set MS_CERT_PRIVATE_KEY="$(cat archive.pk8.pem)"
   ```
6. **Store the same `ARCHIVE_SECRET` in Vault** for the cron job:
   ```sql
   select vault.create_secret('<same random value>', 'email_base_archive_secret');
   ```
7. **Apply migration 009 and deploy the function** with one script. Make sure the `email_base` schema is exposed in the Data API, as it already is for `ceo-mail-sync`. The script uses the Supabase CLI in `Database Module/tools`. It does not enable the job.
   ```bash
   bash "D:/Abhijith Projects/CRM/Database Module/Email Base/deploy_archive.sh"
   ```
8. **Check the job is idle.** Within 3 minutes, `archive_settings.last_run_result` should read `{"skipped": "archive_settings.enabled is false"}`.
9. **Point the job at the site and start copying.** Deletion stays off.
   ```sql
   update email_base.archive_settings
      set site_ref = 'abcapital.sharepoint.com:/sites/MailArchive', enabled = true
    where id;
   ```

## Running and checking

The copy report:
```sql
select * from email_base.archive_report order by mailbox, status;
```
The last run:
```sql
select last_run_at, last_run_result from email_base.archive_settings;
```
Errors:
```sql
select storage_path, attempts, last_error from email_base.archive_items where status = 'failed' order by updated_at desc limit 50;
```
To retry files that used up their attempts:
```sql
update email_base.archive_items set attempts = 0 where status = 'failed';
```

Every file is copied when `archive_report` shows all rows as `verified`, with no `pending` or `failed` rows and `not_listed` at 0 files.

Tuning:
- If runs end with CPU or time errors, lower `batch_size` or `concurrency`.
- If hashing costs too much CPU, set `verify_mode = 'size'`. A size check is weaker. Rows record which check they passed in `verified_by`.

Throughput is roughly a few hundred files per run, so the first full copy takes about one to three days.

## Deleting from Supabase Storage

Get a person's approval before the first deletion. Then:

1. Check the report: verified count, bytes, and no failed rows. Open a few `web_url`s and confirm the `.eml` files open.
2. Run a small first batch:
   ```sql
   update email_base.archive_settings set delete_batch_size = 50, delete_after_verify = true where id;
   ```
3. After one run, check that 50 rows are `deleted` and their `web_url`s still open. Then raise `delete_batch_size`, for example to 500.
4. To stop deleting at any time:
   ```sql
   update email_base.archive_settings set delete_after_verify = false where id;
   ```

Once Storage is under 1 GB, leave the job enabled so that any new files are archived as they age.

## Supabase egress

Each file is downloaded once from Storage, about 36 GB in total. On the free plan, Storage downloads count towards the monthly egress quota, which is 5 GB. One full copy therefore goes over that quota. The other option is to read the original mail again from the IMAP server instead of from Storage. That option is not built.
