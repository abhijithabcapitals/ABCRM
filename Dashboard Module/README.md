# Dashboard Module

Source of the CRM's **Dashboard** page: task KPIs, status and priority charts, overdue ageing, due-soon
counts, and (for admins) the CEO overview.

| Path | Purpose |
|---|---|
| `components/Dashboard.jsx` | The page. Props: `spaces`, `profile`, `onNavigate`, `onSpaceSelect`, `onOpenScope` |
| `index.js` | Default export of the page |

## How it is connected

The Main Module imports this folder directly; there is no copy to keep in sync.

- `Main Module/vite.config.js` maps `@dashboard` to this folder, and `@app` to `Main Module/src` so the
  page can reuse the app's shared pieces. It also resolves React from the Main Module's `node_modules`.
- `Main Module/src/components/Dashboard.jsx` re-exports this page, so `App.jsx` is unchanged.
- Shared code stays in the Main Module because the Space Overview page uses it too:
  `@app/supabase`, `@app/components/charts`, `@app/chartUtils`, `@app/dateFormat`,
  `@app/components/DrilldownModal`, `@app/components/AssigneeTasksModal`.
- Data comes from the `dashboard_overview` and `ceo_overview` database functions.
- The GitHub Pages build checks out the whole repo, so changes here deploy with the next push to `main`.
