# Admin Base

What Settings needs for the admin's technical panel. It lives in the CRM Supabase project; this folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_admin_panel.sql` | Tab access per member, the audit log, and admin-only checks: members, health, storage, AI usage and scheduled jobs |
| `migrations/002_triggers.sql` | Admin-made timers: the task catalogue, the `admin-trigger-dispatcher` cron job and the `admin_trigger_*` functions |
| `migrations/003_audit_trail.sql` | The audit trail: `audit_trail`, a trigger on every table, and the `audit-trail-attach` hourly job that covers new tables. Undo: `migrations/rollback/003_rollback.sql` |
| `tests/run-local.sh` | Runs the migrations twice and the trigger and audit trail tests on a throwaway local Postgres. Nothing touches Supabase |

Triggers are stored in Dubai time and one dispatcher job checks every minute for what is due. To add a task, add it to `admin_trigger_catalogue()` and to the `case` in `admin_trigger_start()`. Tasks with no backend yet stay in the catalogue with an `unavailable` reason, and the server refuses them.

Creating logins, passwords and suspensions go through the `admin-users` Edge Function (`Main Module/db/edge-function-admin-users.ts`), because they need the service key. Tab access controls which pages a member can open. What data they can read is controlled separately by database policies and, for Business Banking and Clients, by their data role. Run after HR Base and AI Base.
