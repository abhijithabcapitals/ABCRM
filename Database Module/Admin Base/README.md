# Admin Base

What Settings needs for the admin's technical panel. It lives in the CRM Supabase project; this folder holds what defines it.

| Path | Purpose |
|---|---|
| `migrations/001_admin_panel.sql` | Tab access per member, the audit log, and admin-only checks: members, health, storage, AI usage and scheduled jobs |

Creating logins, passwords and suspensions go through the `admin-users` Edge Function (`Main Module/db/edge-function-admin-users.ts`), because they need the service key. Tab access controls which pages a member can open. What data they can read is controlled separately by database policies and, for Business Banking and Clients, by their data role. Run after HR Base and AI Base.
