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

The app reaches this folder through the `@client-login` alias. Staff screens that use it (`ClientsHub.jsx`, `ClientInputs.jsx`) stay in the Client Module.
