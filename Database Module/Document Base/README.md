# Document Base

Database side of the OneDrive copy job (schema `od_copy`). Operating guide: `Document Intelligence Module/README.md`.

## Migrations

| File | Contents |
|---|---|
| `migrations/001_od_copy.sql` | Schema, tables, seed rules, row-level security, append-only trigger on `operations` |
| `migrations/002_od_copy_plan.sql` | Name and path helpers, `build_plan`, `approve`, `claim`, `rollback_candidates`, `set_stage`, `admin_approve`, views |

Both are idempotent. **Re-run 002 after re-running 001** (001 resets the `client_folders` policy and grants).

## Tables

| Table | Holds |
|---|---|
| `settings` | One row: `drive_id`, `source_item_id`, `dest_item_id`, `stage`, `delta_link`, `batch_size`, `max_in_flight`, `rollback_scope`, `last_run_at`, `last_run_result` |
| `source_items` | Inventory of the old folder: id, parent path, name, size, `quickxor_hash`, folder flag |
| `area_rules`, `folder_rules` | Old area to department/kind; keyword to one of the seven client folders |
| `client_matches` | Folder name to client id, for review |
| `plan` | One row per source file: target path, department, client, status (`planned`, `approved`, `copying`, `copied`, `verified`, `failed`, `skipped_duplicate`, `rolled_back`), `hash_checked`, error |
| `client_folders` | Client id to destination folder link (readable by every signed-in CRM user) |
| `operations` | Append-only audit log of every write and stage change |

Views: `item_map`, `report` (per old area: files, GB, duplicates, verified, size only, failed), `failed_items`.

Stages: `idle`, `inventory`, `plan`, `approved`, `copying`, `done`, `paused`, `rollback`.

## Size

Free plan limit: keep `od_copy` under 200 MB. About 170k source rows plus plan and operations rows is well inside it; no file content is stored.

Check:

```sql
select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c
join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'od_copy' and c.relkind = 'r';
```

## Tests

Runs on a throwaway local PostgreSQL (port 55437), applies each migration twice and runs the SQL tests:

```
bash "Database Module/Document Base/tests/run-local.sh"
```

Needs PostgreSQL 18 at `C:\Program Files\PostgreSQL\18\bin` (or set `PG_BIN`). Touches neither Supabase nor the service on 5432.
