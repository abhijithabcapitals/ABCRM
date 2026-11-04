# Integrations Module

Admin screens for connecting the CRM to outside services, and the store for their credentials.

| Path | Purpose |
|---|---|
| `components/EmailAccountsPanel.jsx` | **Settings → Email Accounts**: add a mailbox by username and password; it syncs into Email Base |
| `components/IntegrationsPanel.jsx` | **Settings → Integrations**: every app in `registry.json`, plus custom apps, with write-only fields |
| `components/AgentsPanel.jsx`, `logic/agents.js` | **Settings → Agents**: each agent's configuration, per-person access and monthly usage credit. Tables are in `Database Module/AI Base/migrations/002_agents.sql`. Saving runs nothing: the agent gateway must read and enforce these settings |
| `registry.json` | The app list: status (`in_use` / `ready` / `planned`), what uses it, each credential's name, purpose and source. Names only, never values. `envOnly` apps are read directly by background functions and stay in Supabase secrets |
| `supabase/crm-connections/index.ts` | Edge Function for both screens (admins only). Tests a mailbox login before saving. Never returns a value |
| `supabase/migrations/001_credentials.sql` | `admin_credential_set`, `admin_credential_delete`, `credential_get`, `integration_credentials`, `email_base.mailboxes.login_user` |
| `supabase/_shared/secrets.ts` | Helper for new Edge Functions: `requireSecret(adminClient, "NAME")` |

## How credentials are stored

Values are encrypted in Supabase Vault as `crm_cred:<NAME>`. Admins can write and remove them through
`admin_credential_set` / `admin_credential_delete`. Only the service role (Edge Functions) can read one, through
`credential_get`, so no browser, including an admin's, can read a value back. Each change is written to
`admin_audit` with the credential's name and never its value. `integration_credentials` holds labels only.

A value saved in Settings wins over an Edge Function secret of the same name.

## Email accounts

The password is stored as `MAIL_PASSWORD_<ADDRESS>`, the same name the older Edge Function secrets use, so
`ceo-mail-sync` and `ceo-mail-reply` read Vault first and then the secret. `ceo-mail-sync` syncs every enabled
mailbox in `email_base.mailboxes`; each run's budget is shared, so more mailboxes means slower backfill.

Limits: implicit TLS only (usually ports 993 and 465; the clients do not support STARTTLS on 587). Providers that
refuse password sign-in, such as Microsoft 365 and Outlook.com, need OAuth and cannot be added this way. Gmail,
Yahoo and similar need an app password. Pausing keeps the stored mail; there is no delete from this screen.

## What is connected

Saving a credential does not build a connection. Only apps with status `in_use` do anything today. To build one:

1. In the function, read each value with `requireSecret` and deploy `secrets.ts` next to `index.ts`.
2. Set the app's `status` to `in_use` and fill in `usedBy` in `registry.json`.

### Zoho Books

Connected through the `zoho-books` function. Admins use **Settings -> Integrations -> Zoho Books**: save the
settings, press Test, then pick the 5% VAT code. Credential values are never shown or logged.

The refresh token must hold exactly these six scopes: `ZohoBooks.invoices.READ`, `ZohoBooks.invoices.CREATE`,
`ZohoBooks.estimates.READ`, `ZohoBooks.estimates.CREATE`, `ZohoBooks.contacts.READ` and `ZohoBooks.settings.READ`.
Per Zoho's scope list, `settings.READ` is what covers organisations, taxes and items. The function sends no update
or delete request to Zoho.

Actions today are `connection_test`, `taxes_list`, `contacts_search`, `contact_link` and `contact_get`. Creating draft
estimates and invoices is allowed by the Zoho client but not built yet.

This repo folder has no `supabase/functions/` layout. Copy `supabase/zoho-books` into a `supabase/functions/`
folder to deploy. `secrets.ts` already sits next to `index.ts`, so nothing else needs copying:

`supabase functions deploy zoho-books --project-ref pnnakrhfzyxudjaghoxx --use-api`

Deploy this function before the front end ships. Without it the card shows "In use" and its Test fails.

### Zoho Books financials (zoho-finance)

A separate, read-only function for the Dashboard's financial cards. It reads `ZOHO_FINANCE_CLIENT_ID`,
`ZOHO_FINANCE_CLIENT_SECRET` and `ZOHO_FINANCE_REFRESH_TOKEN` (plus the shared `ZOHO_BOOKS_ORG_ID` and `ZOHO_DC`) and never
the drafts login used by `zoho-books`. It only sends GET requests to the Books API. Admins use
**Settings -> Integrations -> Zoho Books -> Financial Dashboard**: **Test** shows the organisation name, and the temporary
**Run check** shows the structure of the Zoho data (no amounts, names or IDs) as text to copy.

Deploy from a `supabase/functions/` folder: `supabase functions deploy zoho-finance --project-ref pnnakrhfzyxudjaghoxx --use-api`

## Deploying crm-connections

It imports the IMAP and SMTP clients from its siblings, so copy these into one `supabase/functions` folder and
deploy with `--project-ref pnnakrhfzyxudjaghoxx --use-api`: `crm-connections`,
`ceo-mail-sync` and `ceo-mail-reply` (from `Agent Module/11_Personal_Agent/CEO Agent Module/supabase`).
