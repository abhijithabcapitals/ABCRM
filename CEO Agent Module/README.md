# CEO Agent Module

The CRM's **CEO Agent** tab (admins only). It is the user interface of the CEO Intelligence Agent in
`Agent Module/11_Personal_Agent/CEO Agent`, ported into the CRM so it opens inside the CRM shell.

| Path | Purpose |
|---|---|
| `components/CeoAgent.jsx` | Sign-in, TOTP MFA, quick capture (text saved; voice recorded locally only) and recent captures |
| `index.js` | Default export of the page |

## Data stays separate from the CRM

By the agent's design, it uses its **own Supabase project** and the `ceo` schema. This page never reads or
writes the CRM database and has its own sign-in (stored under `ceo-agent-auth`, apart from the CRM session).
The same rules as the original apply: public sign-up off, owner provisioned in `ceo.profiles`, MFA when
`require_mfa` is set, voice upload locked until audio retention and a cleanup worker exist, no AI extraction,
CRM sync, reminders or external actions.

## Connecting it

1. Create the dedicated Supabase project and apply
   `Agent Module/11_Personal_Agent/CEO Agent/supabase/migrations/202610290001_initial_ceo_schema.sql`
   (follow that folder's `CONFIGURATION.md`, including choosing the region deliberately).
2. In that project: Settings → Data API → add `ceo` to Exposed schemas.
3. Set two values (the publishable key is safe for the browser; never use a secret/service-role key):
   - `Main Module/.env`: `VITE_CEO_SUPABASE_URL=...` and `VITE_CEO_SUPABASE_PUBLISHABLE_KEY=...`
   - GitHub repository secrets with the same names, for the GitHub Pages build.
4. Push to `main` (or re-run the Pages workflow). Until both values exist the tab shows a setup card.

## How it is connected

`Main Module/vite.config.js` maps `@ceo-agent` to this folder and resolves `react` and
`@supabase/supabase-js` from the Main Module. `Main Module/src/components/CeoAgent.jsx` adds the page header
and passes the two settings; the sidebar shows **CEO Agent** to admins only.

The standalone Next.js app in `Agent Module/11_Personal_Agent/CEO Agent` is unchanged and can still run on
its own. Port later features (extraction, reminders, approvals) here as they are built there.
