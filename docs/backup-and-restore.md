# Backup & Restore

Automated **daily backups** of the CRM to OneDrive, via GitHub Actions
(`.github/workflows/daily-backup.yml`). Each run:

1. `pg_dump`s the whole `public` schema (all app data), gzips it, and
   **encrypts** it with `BACKUP_PASSPHRASE` (gpg AES-256) →
   `onedrive:AB Capital Backups/db/db-<date>.sql.gz.gpg`.
2. Mirrors **Supabase Storage** files to `onedrive:AB Capital Backups/storage/current`,
   moving any changed/deleted files into `storage/archive/<date>/` so deletions
   stay recoverable.
3. Prunes DB dumps older than 30 days and file archives older than 90 days.

> Code is already backed up by GitHub. This protects the **data**, which on the
> Supabase Free tier has **no** automatic backups.
>
> The DB dump is gpg-encrypted with `BACKUP_PASSPHRASE` (keep it in a password
> manager — it's needed to restore). The Storage files are uploaded as-is.

---

## One-time setup

You do these once. After that it runs itself every day.

### 1. Install rclone locally (to create the config)

- macOS: `brew install rclone` (or `curl https://rclone.org/install.sh | sudo bash`)

### 2. Add the OneDrive remote

```bash
rclone config
# n) New remote
# name> onedrive
# Storage> onedrive
# follow the browser login; accept defaults; choose "OneDrive Personal or Business"
```

Test it: `rclone lsd onedrive:` should list your OneDrive folders.

### 3. Add the Supabase Storage remote (S3-compatible)

In Supabase: **Project Settings → Storage → S3 Access Keys → New access key**.
Note the **access key**, **secret**, **endpoint**, and **region** shown there
(endpoint looks like `https://<project-ref>.supabase.co/storage/v1/s3`).

Then append this block to your rclone config file
(`rclone config file` prints its path):

```ini
[supabase-storage]
type = s3
provider = Other
access_key_id = <the access key>
secret_access_key = <the secret>
endpoint = https://<project-ref>.supabase.co/storage/v1/s3
region = <region, e.g. us-east-1>
force_path_style = true
```

Test it: `rclone lsd supabase-storage:` should list your storage buckets.

### 4. Get the database connection string

Supabase: **Project Settings → Database → Connection string → "Session pooler"**
(NOT the transaction pooler — pg_dump needs a session connection). It looks like:

```
postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use the **Session pooler** URL because GitHub's runners are IPv4-only and the
direct `db.<ref>.supabase.co` host is IPv6-only.

### 5. Add the GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | the Session-pooler connection string from step 4 |
| `BACKUP_PASSPHRASE` | a strong passphrase you keep safe (needed to decrypt dumps) |
| `RCLONE_CONF_BASE64` | `base64 < "$(rclone config file | tail -1)"` — the whole rclone.conf, base64-encoded |

To produce `RCLONE_CONF_BASE64`:

```bash
base64 -i "$(rclone config file | tail -1)" | pbcopy   # macOS: now paste into the secret
```

> ⚠️ Keep `BACKUP_PASSPHRASE` somewhere safe and separate (a password manager).
> Without it the encrypted dumps cannot be restored.

### 6. Test it

Repo → **Actions → Daily backup → Run workflow**. Watch it go green, then
confirm the files landed under `AB Capital Backups/` in OneDrive.

---

## Restore

### Restore the database

Download the dump for the day you want, then decrypt + load it.

> **Restore into a fresh/scratch Supabase project first** if you only need to
> recover *some* accidentally-deleted rows — that way you can copy back just
> what you need without overwriting good data. Restore over the live database
> only if the whole dataset is lost.

```bash
# 1. Download the chosen dump from OneDrive
rclone copy "onedrive:AB Capital Backups/db/db-2026-07-31_0200.sql.gz.gpg" .

# 2. Decrypt the gpg layer + decompress
gpg --batch --decrypt --passphrase "<BACKUP_PASSPHRASE>" \
    db-2026-07-31_0200.sql.gz.gpg | gunzip > restore.sql

# 3. Load into the target database (a scratch project's Session-pooler URL)
psql "postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres" \
     -f restore.sql
```

To recover a single deleted table/rows without a full restore, load the dump
into a scratch database as above, then `INSERT ... SELECT` the missing rows
back into the live DB (or use the Supabase SQL editor to copy them).

### Restore Storage files

Current mirror lives at `storage/current`; deleted/changed versions are under
`storage/archive/<date>/`.

```bash
# Recover a file that was deleted on 2026-07-30 (found in that day's archive)
rclone copy "onedrive:AB Capital Backups/storage/archive/2026-07-30/<bucket>/<path>" ./recovered/

# Or restore an entire bucket's current mirror back into Supabase Storage
rclone copy "onedrive:AB Capital Backups/storage/current/<bucket>" "supabase-storage:<bucket>"
```

---

## What is and isn't covered

- ✅ All application data in the `public` schema (tasks, statuses, lists,
  folders, spaces, automations, notifications, field values, comments, etc.).
- ✅ Uploaded files in Supabase Storage.
- ⚠️ **Auth users** (`auth.users`) and Storage object *metadata* are managed by
  Supabase and are **not** in the `public`-schema dump. For a full
  disaster-recovery to a brand-new project, users would need to be re-created /
  re-invited. For the common case (someone deleted app data/files), the above
  fully covers recovery.
- ⏱️ Backups are point-in-time daily snapshots — changes since the last run
  are not captured. Adjust the cron in the workflow for more frequency.

## Tuning

- **Frequency**: edit the `cron:` in `.github/workflows/daily-backup.yml`.
- **Retention**: edit `DB_RETENTION_DAYS` / `STORAGE_ARCHIVE_RETENTION_DAYS`.
- **Destination folder**: edit `ONEDRIVE_DIR`.
