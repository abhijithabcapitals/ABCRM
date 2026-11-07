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

## Login emails

Give access, New password, and the staff forms in Settings (Add member, Onboard member, Reset password) email the username and password from `info@abcapital.ae`, using the mailbox's own mail server. `supabase/_shared/credentialText.ts` holds the wording and `credentialMail.ts` sends it. No copy goes to the Sent folder, because the CRM syncs that mailbox and the password would be readable there. A failed email never removes the login: the admin sees the reason and shares the password another way. Each send is logged in `admin_audit` without the password.

AB Capital manages client passwords: clients cannot change them. Each is also kept encrypted in Supabase Vault (`client_portal_pw:<login id>`), so an admin can see it again with **Show password** in Settings > Client Portal, All Clients and Client Master. Only admins can read it, and each read is logged as `client_portal_password_viewed` in `admin_audit`. A password set before migration 004 has no readable copy until the admin uses New password.

Staff are different: someone with an emailed password must set their own at first sign-in. The workspace stops at `ForcePasswordChange.jsx` through their `must_change_password` user metadata.

Deploying `client-portal` or `admin-users` needs a temporary working folder holding, under `supabase/functions/`: `_shared/` (from `supabase/_shared` here), `ceo-mail-reply/smtp.ts`, and the function as `<name>/index.ts` (`admin-users` comes from `Main Module/db/edge-function-admin-users.ts`). `node scripts/stage-edge-functions.mjs` in `Main Module` builds that folder at `.edge-deploy/` (git-ignored) so the relative imports resolve; run `supabase functions deploy` from there. Deploy `client-portal` with `--no-verify-jwt`. Migrations `003_password_email.sql` then `004_admin_managed_passwords.sql` (in `Database Module/Client Login Base/migrations`) go first. To undo, run `rollback/004_rollback.sql`, which deletes the readable passwords, then `003_rollback.sql`. While `business-setup-module` is unmerged, the live `client-portal` also holds that branch's actions: deploy a merge of both, not this file alone.

## Release

Database first, then function, then site:

1. Apply `Database Module/Client Login Base/migrations/001_portal_views.sql`, then `002_change_requests.sql`.
2. Run `select public.audit_trail_attach_all();` so the new table goes straight into the audit trail.
3. Deploy the Edge Function from a temporary working folder holding `supabase/functions/client-portal/index.ts` (copied from `supabase/client-portal/index.ts` here): `supabase functions deploy client-portal --no-verify-jwt --project-ref pnnakrhfzyxudjaghoxx --use-api`.
4. Deploy the site.

To undo the database part, run `Database Module/Client Login Base/rollback/001_002_rollback.sql`. **It deletes clients' pending edits** (`client_portal_change_requests`). Straight after it, redeploy the earlier function version and revert the site. Until then `submit_change`, `gallery_url` and Information Changes fail, because the functions they call are gone.

Checks before release: `bash "Database Module/Client Login Base/tests/run-local.sh"`, `node --test "Client Login Module/tests/logic.test.mjs"`, and `npm run build` in `Main Module`.

The app reaches this folder through the `@client-login` alias. Staff screens that use it (`ClientsHub.jsx`, `ClientInputs.jsx`) stay in the Client Module.

## Request links

A request from Accounting > Follow-ups mails the client a link (`?client_link=...`). `Main Module/src/Root.jsx` sends it to `portal/LinkSignIn.jsx`, which removes it from the address bar and exchanges it (`link_login`) for a normal 12-hour session. `portal/RequestsPanel.jsx` shows the client what was asked and lets them say they have sent everything. The database part is `Database Module/Accounting Base/migrations/006_client_requests.sql`.
