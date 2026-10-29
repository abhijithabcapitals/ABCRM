# CEO Agent Module

The CRM's **CEO Agent** tab (admins only). It is the user interface of the CEO Intelligence Agent in
`Agent Module/11_Personal_Agent/CEO Agent`, ported into the CRM so it opens inside the CRM shell.

| Path | Purpose |
|---|---|
| `components/CeoAgent.jsx` | Sign-in, TOTP MFA, quick capture (text saved; voice recorded locally only) and recent captures |
| `index.js` | Default export of the page |

## Where the data lives

The `ceo` schema is in the CRM Supabase project (`pnnakrhfzyxudjaghoxx`), applied as migration
`initial_ceo_schema` on 29/10/2026. It is kept apart from the CRM tables by schema and row-level security:
every `ceo` table only returns rows where `user_id` is the signed-in user, anonymous users have no access,
and the CRM's own code never queries `ceo`. The tab reuses the CRM sign-in, so there is no second login.

The same rules as the original apply: owner provisioned in `ceo.profiles` (done for
abhijith.abcapitals@gmail.com, role `owner`), an authenticator app (TOTP) is required when `require_mfa` is
true, voice upload stays locked until audio retention and a cleanup worker exist, and there is no AI
extraction, CRM sync, reminders or external actions yet.

To give another person a CEO workspace, insert their row in `ceo.profiles` (see
`Agent Module/11_Personal_Agent/CEO Agent/CONFIGURATION.md`). Without a row the tab says the account is not
provisioned.

`ceo` was added to the API's exposed schemas with
`alter role authenticator set pgrst.db_schemas = 'public, graphql_public, acct, ceo'`.

## Moving to a separate project later

If the CEO data should move to its own Supabase project, apply the same migration there, set
`VITE_CEO_SUPABASE_URL` and `VITE_CEO_SUPABASE_PUBLISHABLE_KEY` (in `Main Module/.env` and as GitHub
repository secrets) and redeploy. The tab then uses that project with its own sign-in (stored under
`ceo-agent-auth`).

## How it is connected

`Main Module/vite.config.js` maps `@ceo-agent` to this folder and resolves `react` and
`@supabase/supabase-js` from the Main Module. `Main Module/src/components/CeoAgent.jsx` adds the page header
and passes the two settings; the sidebar shows **CEO Agent** to admins only.

The standalone Next.js app in `Agent Module/11_Personal_Agent/CEO Agent` is unchanged and can still run on
its own. Port later features (extraction, reminders, approvals) here as they are built there.
