# Integrations Module

One list of every external service the CRM may connect to (AI models, WhatsApp, Meta, Google, Microsoft,
n8n/Zapier, accounting software, payments) and the exact Supabase secret names each one uses.

| Path | Purpose |
|---|---|
| `registry.json` | The list: integration, status (`in_use` / `ready` / `planned`), what uses it, and each secret's name, purpose and where to get it. Names only, never values |
| `components/IntegrationsPanel.jsx` | **Settings → Integrations** tab (admins only): searchable list with a dot per secret showing whether it is set |
| `supabase/integrations-status/index.ts` | Edge Function that tells admins which secrets have a value. Returns true/false only, never a value |
| `supabase/_shared/secrets.ts` | Helper every new Edge Function should use: `requireSecret("NAME")` gives a clear "add it in Supabase" error when missing |

## Adding a value

Supabase → Edge Functions → Secrets → add the name exactly as listed. No redeploy is needed. The
Integrations tab shows it as set after **Refresh**.

## Building a new integration

1. Make sure its secrets are in `registry.json`; set `status` to `in_use` once deployed code reads them.
2. In the function, `import { requireSecret } from "./secrets.ts"` and read every secret through it.
3. Deploy the function with `secrets.ts` and `registry.json` placed next to its `index.ts` (the deployed
   bundle is flat). The same applies when redeploying `integrations-status` after editing `registry.json`.

Real values belong only in Supabase secrets: never in this repo, in code, in chat or in a `.env` that is committed.
