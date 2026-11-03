# Client Login Module

What a client sees after signing in with their portal username: their record, document uploads, requests to change details and the progress of their banking case. Staff manage logins and review what clients send from the CRM's Clients and Settings pages.

| Path | Purpose |
|---|---|
| `portal/ClientPortal.jsx` | The client's only screen. Admins see it read-only |
| `portal/portalApi.js` | Calls the Edge Function. The session token stays in the browser tab |
| `admin/ClientPortalAdmin.jsx` | Admin screen: give access, new password, revoke, restore, view as client |
| `supabase/client-portal/index.ts` | Edge Function, deployed with `--no-verify-jwt` because it checks its own sessions |
| `logic/progress.js` | Turns a banking case's stage and outcome into a percent and a label for the client |
| `logic/fields.js` | The 16 record fields clients can ask to change, and each field's pending, rejected or locked state |
| `tests/logic.test.mjs` | Rule tests: `node --test "Client Login Module/tests/logic.test.mjs"` |
| `docs/` | Design and build plan |

The portal code used to live in the Client Module as `@client-module/portal` and `crm/ClientPortalAdmin`; it has moved here, and those old paths no longer exist.

## Release

Database first, then function, then site:

1. Apply `Database Module/Client Login Base/migrations/001_portal_views.sql`, then `002_change_requests.sql`.
2. Run `select public.audit_trail_attach_all();` so the new table goes straight into the audit trail.
3. Deploy the Edge Function from a temporary working folder holding `supabase/functions/client-portal/index.ts` (copied from `supabase/client-portal/index.ts` here): `supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api`.
4. Deploy the site.

To undo the database part, run `Database Module/Client Login Base/rollback/001_002_rollback.sql`. **It deletes clients' pending edits** (`client_portal_change_requests`). Straight after it, redeploy the earlier function version and revert the site. Until then `submit_change`, `gallery_url` and Information Changes fail, because the functions they call are gone.

Checks before release: `bash "Database Module/Client Login Base/tests/run-local.sh"`, `node --test "Client Login Module/tests/logic.test.mjs"`, and `npm run build` in `Main Module`.

The app reaches this folder through the `@client-login` alias. Staff screens that use it (`ClientsHub.jsx`, `ClientInputs.jsx`) stay in the Client Module.
