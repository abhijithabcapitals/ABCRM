# Messanger Base data

The Messenger module links CRM records to chats, meetings and channels through one table, created by `migrations/001_communication_links.sql`.

| Object | Purpose |
|---|---|
| `crm_communication_links` | One row per link: `record_type` (client, lead, task), `record_id` (text), `link_type` (chat, meeting, channel), `reference`, `label`, `created_by`. Unique on type, record, link type and reference |
| `crm_link_parent_visible(type, id)` | Invoker function: true when the caller can see the parent row in `client_master`, `bd_leads` or `tasks`, so the parent's own row security decides |

Policies: read and add need access to the parent record (add also needs `created_by` to be the caller); delete is the creator or an admin; no update; no access for `anon`.
Needs `profiles` and `admin_is()` from Admin Base / HR Base 001. Links hold deep links and meeting IDs only, never KYC data.

Test on a throwaway local Postgres (nothing touches Supabase): `bash "Database Module/Messanger Base/tests/run-local.sh"`.
It runs the migration twice, the access tests, then `migrations/rollback/001_rollback.sql`.

## Microsoft connection (`migrations/002_microsoft_connection.sql`)

| Object | Purpose |
|---|---|
| `microsoft_connection` | One row only (`id` is always true): tenant, status, who connected, consent time, `client_secret_expires_on`. Admins read |
| `microsoft_user_links` | One row per person: Microsoft user ID, UPN, granted scopes, status, Teams app installed. A person reads their own row, an admin reads all |
| `microsoft_sync_log` | Action, status, error code, detail (no tokens, no message text). Admins read; `ms365_prune_logs()` removes rows older than 90 days |
| `ms_token_set / ms_token_get / ms_token_delete` | Refresh token in Vault as `ms_rt:<profile_id>`. Security definer, `service_role` only |

Browser users have `select` only. Every write goes through the service role (Edge Functions). Refresh tokens are unreachable from the browser: no grant on the functions, none on `vault`.
`migrations/schedule_prune.sql` holds the daily cron schedule. It is not part of the migration, the runner never runs it, and it needs separate approval before it runs live.
The runner also runs `002` twice, `tests/020_connection_test.sql`, and `migrations/rollback/002_rollback.sql` (which deletes `ms_rt:%` secrets) before the rollback of `001`.
