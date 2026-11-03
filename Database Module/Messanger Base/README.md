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
