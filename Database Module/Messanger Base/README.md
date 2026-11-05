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

## Team chat (`migrations/003_chat.sql`)

| Object | Purpose |
|---|---|
| `messenger_conversations` | One row per chat: `kind` (direct, group), `title` (groups), `direct_key` (the two profile IDs sorted, unique, so a pair has one chat), `last_message_at` |
| `messenger_members` | Who is in a chat: `role` (owner, member), `last_read_at`, `joined_at`. Cascades with the chat or the profile |
| `messenger_messages` | `body` 1 to 4000 characters, optional link (`client`, `lead`, `task`, `web`; `web` must start `https://`). The browser may supply `id` so a retry cannot send twice. `created_at` is always the server time. `sender_id` is set null if the profile is deleted |
| `messenger_is_member`, `messenger_start_direct`, `messenger_create_group`, `messenger_add_members`, `messenger_remove_member`, `messenger_rename_group`, `messenger_leave`, `messenger_mark_read` | Security definer functions for `authenticated`; they check the caller. Only owners add, remove and rename; leaving a one-to-one chat is refused |
| `messenger_chat_list()`, `messenger_read_state(chat)` | The caller's chats with preview and unread count (one query); the earliest `last_read_at` of the other members, for read ticks |
| `messenger_prune_messages()` | Deletes messages older than 365 days. `service_role` only. `migrations/schedule_chat_prune.sql` holds the daily cron schedule; it is not part of the migration, the runner never runs it, and it needs separate approval before it runs live |

Row security on all three tables: members read only their own chats, and there is no admin exception. The browser can read the tables and insert its own messages; nothing else is granted, so every change to chats and members goes through the functions. `messenger_messages` joins the `supabase_realtime` publication (rollback removes it first). Messages are plain text in the database, not end-to-end encrypted.
`tests/030_chat_test.sql` runs after the migration twice; `migrations/rollback/003_rollback.sql` runs first in the rollback order.

## Delivered and read ticks, and typing (`migrations/008_receipts_typing.sql`)

| Object | Purpose |
|---|---|
| `messenger_members.last_delivered_at` | When this person's CRM last received the chat's messages. Reading a chat also sets it. |
| `messenger_mark_delivered()` | Marks the caller's direct and group chats as received. Writes only where someone else has sent something newer. |
| `messenger_receipt_state(p_conversation)` | The earliest read and delivered times among the other members, so a group's ticks need everyone. Members only. |
| `messenger_signal_allowed(p_topic)` | True when the caller belongs to the chat in a `msgr:<chat id>` topic. Used by the two policies on `realtime.messages`. |

Typing goes over private Realtime Broadcast and is never stored. The migration also adds `messenger_members` to the `supabase_realtime` publication, so ticks change live, and makes `audit_trail_capture` skip member updates that change only these two times, so ticks add nothing to the audit trail. That function is shared across the CRM: the only change from `004b` is that one condition.

`messenger_read_state` stays, so screens already open keep working until they reload. `tests/080_receipts_test.sql` runs after the migration twice; `migrations/rollback/008_rollback.sql` undoes it.
