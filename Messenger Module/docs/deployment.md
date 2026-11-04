# Deployment: Messenger Phase 2

Nothing in this guide has been run on the live system. **Every live step needs the user's separate approval, given for that step.** Do not chain them.

Order of the whole rollout. **Merging to `main` means live**: `.github/workflows/deploy-pages.yml` deploys every push to `main`, and until migration `001` has run the Teams panel on client and lead pages cannot load its saved chats. So the database comes first.
1. Checks A, B and D below (read-only), then report. Check C waits for migration `002`.
2. Migration `001`, then migration `002`, each approved on its own. Then check C.
3. Push and merge (this deploys the screens). For the chat bubble, first run `003_chat.sql` on the live database with Realtime on (see "Chat bubble rollout" below). The merge from `messenger-bubble` removes the Messenger tab.
4. The `admin-users` redeploy is no longer needed: the Messenger tab no longer exists, so nothing grants it.
5. Deploy `ms365`.
6. Entra setup by the tenant admin (`entra-setup.md`) and settings saved.
7. Run `tests/browser-check.md` on the tenant.
8. Only then, and only if approved: `schedule_prune.sql`.

## Checks before any live change (read-only)

### A. Database size limit
The live database is above its 500 MB plan size (reported as 972 MB against a 500 MB plan). Before the first migration, find out what the limit does to writes: whether Supabase has put the project into read-only mode, or will do so. If writes are blocked, `ms_token_set`, the log and the connection row all fail. Check the project's Database > Usage page and the Supabase notices; run `select pg_size_pretty(pg_database_size(current_database()));` as a read-only query. Report the result. The migrations add small tables only.

### B. Can a member change their own profile row?
`Main Module/db/00_base_schema.sql:2041-2043` creates own-row update policies on `public.profiles` ("Update own profile", "Users can update own profile"). `Main Module/db/security_fixes.sql:20-25` drops them and leaves an admin-only update policy. If an own-row update policy is live, a member could set their own `email` (so a different Microsoft account matches and skips review) or their own `role`. Run:

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles' order by policyname;
```
Also check column grants: `select grantee, privilege_type, column_name from information_schema.column_privileges where table_name = 'profiles' and grantee in ('authenticated','anon');`
**If any policy lets a non-admin update their own row, stop and report. Do not run any migration or deploy the function.**

### C. Vault stores the token encrypted
After migration `002` is applied (so this check is the one that waits for it), through the service role only, run `ms_token_set` and `ms_token_get` once with a throwaway value for a throwaway UUID, then confirm that `vault.secrets.secret` holds an encrypted value, not the plaintext:

```sql
select public.ms_token_set('00000000-0000-0000-0000-000000000001', 'test-value-not-a-token');
select public.ms_token_get('00000000-0000-0000-0000-000000000001');                 -- returns the value
select secret <> 'test-value-not-a-token' as encrypted from vault.secrets where name = 'ms_rt:00000000-0000-0000-0000-000000000001';   -- must be true
select public.ms_token_delete('00000000-0000-0000-0000-000000000001');
```
If `encrypted` is false, stop and report. Do not use a real person's ID. Clean up as shown.

### D. The real parent tables and `admin_is()`
The local tests use a stub. Before migration `001` runs, check the real objects it relies on:
- `client_master`, `bd_leads` and `tasks`: row security is enabled, and the policies decide who sees which rows (`select tablename, rowsecurity from pg_tables ...`; `select * from pg_policies ...`). `crm_link_parent_visible` defers to those policies, so a link is only as private as its parent row.
- `admin_is()` exists, returns true for an admin, false for a member, and is not `security definer` in a way that leaks. Compare its definition with the stub in `Database Module/Messanger Base/tests/000_stub.sql`.
Report any difference before going on.

## Migrations
Folder: `Database Module/Messanger Base/migrations/`. Both are idempotent (run twice in the local test).

| Order | File | Rollback |
|---|---|---|
| 1 | `001_communication_links.sql` | `rollback/001_rollback.sql` |
| 2 | `002_microsoft_connection.sql` (needs `profiles`, `admin_is()`, Vault and the `service_role` role; independent of 001) | `rollback/002_rollback.sql` |

Run `001` before the merge, so the Phase 1 panels have their table. Run `002` before deploying `ms365`.
Local rehearsal (a throwaway Postgres, nothing live): `bash "Database Module/Messanger Base/tests/run-local.sh"`.

### `schedule_prune.sql`
Not a migration. It schedules `ms365_prune_logs()` daily at 03:00 UTC with pg_cron, deleting log rows older than 90 days. The test runner never runs it. It needs pg_cron enabled on the live database and **its own approval**.

## Redeploying `admin-users`
No longer needed. The `messenger` tab key is removed from `Main Module/db/edge-function-admin-users.ts`, so the deployed function can stay as it is. Any `messenger` grant already stored on a member is ignored by the CRM.

## Chat bubble rollout
Each step needs its own approval, in this order:
1. Run `Database Module/Messanger Base/migrations/003_chat.sql` on the live database **before the merge**, with Realtime enabled for the chat tables. Rehearse first with `tests/run-local.sh`.
2. Check the Realtime limits on the live project (concurrent connections, messages per second) against the number of staff.
3. Merge to `main`. This deploys the bubble and removes the Messenger tab.
4. Change the Desktop shortcut to the plain CRM address (no `?view=messenger`). The installed app's `start_url` is now `./`.
5. Schedule the prune: `schedule_chat_prune.sql` is not a migration and needs its own approval (and pg_cron).
Then run the bubble section of `tests/browser-check.md` with two real staff logins.

## Deploying `ms365`

```
supabase functions deploy ms365 --project-ref pnnakrhfzyxudjaghoxx --use-api --no-verify-jwt
```
- `--no-verify-jwt` is required: Microsoft's redirect carries no Supabase JWT. Every POST checks the JWT itself in `index.ts`, and the GET callback accepts only a request whose signed state verifies. Without the flag the sign-in return fails with 401.
- Deploy the folder's files together (`index.ts`, `handlers.ts`, `auth.ts`, `graph.ts`, `secrets.ts`). Do not deploy the `*.test.ts` files.
- Needs migration `002` first. The function reads the Settings > Integrations values through `credential_get`.
- Redirect address in Entra must equal `https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ms365`.

## Settings
Saved in Settings > Integrations: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_STATE_SECRET`, `MESSENGER_APP_URL`. Steps in `entra-setup.md`. `MESSENGER_APP_URL` must be the live CRM address; set it before the first connect, or the return fails with a plain-text 500.
Then, in Settings > Integrations > Microsoft, an admin records the client secret expiry date.

## Connection status `revoked`
`microsoft_connection.status` is `revoked` only if someone sets it by SQL; no screen or action sets it. It only blocks new connects by members: `connect_start` and the callback refuse a non-admin with "An admin must connect Microsoft first." while the status is not `active`. People already connected keep working. An admin can still connect, and a successful admin connect writes the status back to `active`. To reopen without an admin sign-in, set it to `active` by SQL.

## Rollback
1. Undeploy or stop using the function: `supabase functions delete ms365 --project-ref pnnakrhfzyxudjaghoxx` (approval needed). The Microsoft row in Settings > Integrations then shows an error; the Teams panels and the chat bubble keep working.
2. If scheduled, remove the prune job: `select cron.unschedule('ms365-prune-logs');`.
3. `rollback/002_rollback.sql` (also drops the token clean-up trigger). **It deletes every stored Microsoft sign-in (`ms_rt:%` in Vault)**, the connection, the links and the log. People connect again after a redeploy.
4. `rollback/001_rollback.sql` only if the chat links must go too; it deletes the saved chat links.
5. Revert the merge on `main` if the screens must go.
6. In Entra, delete the app registration or the secret if access must end entirely.

## Full page and chat parity rollout

Each step needs approval. Run `bash "Database Module/Messanger Base/tests/run-local.sh"` first.

1. Run `004_chat_parity.sql` on the live database. The screens need it before merging; the dock's plain messages keep working either way.
2. Merge to `main`, then run `npm run deploy:cloudflare`.
3. Log in as a member and an admin, and check the Messenger page, edits and reactions arriving live in a second window, and a mention reaching Activity.
4. Files are separate: follow `files-setup.md`. Until then, sharing a file says it is not set up.

## Teams and channels rollout

Each step needs approval, and follows the rollout above. Run `005_teams_channels.sql` on the live database first, then merge and run `npm run deploy:cloudflare`.
Check with two logins that a private channel stays hidden, that a post and a thread reply arrive live, and that unread counts clear.

## Calls rollout

Each step needs approval. Follow `calls-setup.md`.
