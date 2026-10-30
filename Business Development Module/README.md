# Business Development Module

Source of the CRM's **Business Development** tab: BD dashboard, lead pipeline, lead lists, lead calendar,
follow-up centre, campaigns and sources, proposals, and won-lead onboarding handovers. Lead-generation
platform integrations (starting with Explee) will be added here.

| Path | Purpose |
|---|---|
| `components/BusinessDevelopment.jsx` | The page and all its sub-tabs. Takes `profile` |
| `components/BusinessDevelopment.css` | Its styles |
| `logic/businessDevelopmentData.js` | Supabase reads, writes and RPC calls for leads, activities, follow-ups, services and won/lost |
| `index.js` | Default export of the page, plus the data functions |

## How it is connected

The Main Module imports this folder directly; there is no copy to keep in sync.

- `Main Module/vite.config.js` maps `@business-development` to this folder, and `@app` to `Main Module/src`
  (the data layer uses `@app/supabase`). React and `@supabase/supabase-js` resolve from the Main Module.
- `Main Module/src/components/BusinessDevelopment.jsx` re-exports this page, so `App.jsx` and the sidebar
  entry are unchanged.
- Database: tables, row-level security and RPCs come from `Database Module/migrations/bd` (design notes in
  `Database Module/docs/BD_*.md`). `Main Module/db/business_development.sql` is retired; do not run it.
- The GitHub Pages build checks out the whole repo, so changes here deploy with the next push to `main`.

## Adding a lead source (next)

Keep provider API keys out of the browser and out of Git: store them as Supabase Edge Function secrets
(see `Integrations Module/registry.json` for naming) and call the provider from an Edge Function that writes
leads through the same RPCs the page uses, so duplicate checks and audit rules still apply.
