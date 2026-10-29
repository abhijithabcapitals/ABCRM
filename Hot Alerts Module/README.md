# Hot Alerts Module

Source of the CRM's **Hot Alerts** page (first item in the sidebar, formerly My Tasks). It lists the
tasks assigned to the signed-in user, ordered by due date, with overdue ones flagged.

| Path | Purpose |
|---|---|
| `components/HotAlerts.jsx` | The page. Takes `profile`, `supabase` and `fmtDate` as props |
| `index.js` | Default export of the page |

## How it is connected

The Main Module imports this folder directly; there is no copy to keep in sync.

- `Main Module/vite.config.js` maps the alias `@hot-alerts` to this folder and resolves React from the
  Main Module's `node_modules`, so this folder needs no install of its own.
- `Main Module/src/components/MyTasks.jsx` renders `<HotAlerts>` and passes the app's Supabase client and
  date formatter.
- The GitHub Pages build checks out the whole repo, so changes here deploy with the next push to `main`.

Import only `react` here. Anything else the page needs (database client, helpers) is passed in as a prop.
