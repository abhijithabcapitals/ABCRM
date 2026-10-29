# Hot Alerts Module

Source of the CRM's **Hot Alerts** page (first item in the sidebar, formerly My Tasks). It lists the
tasks assigned to the signed-in user, ordered by due date, with overdue ones flagged.

| Path | Purpose |
|---|---|
| `components/HotAlerts.jsx` | The page. Takes `profile`, `supabase` and `fmtDate` as props |
| `components/SupportChat.jsx` | Chat box on the right side of the page, talking to the Support Agent |
| `supabase/support-agent/index.ts` | Edge Function `support-agent`: the Support Agent (`Agent Module/08_Support_Agent`) |
| `index.js` | Default export of the page |

## Support Agent chat

The chat sends the conversation to the `support-agent` Edge Function, which calls Claude (`claude-opus-5-5`)
with two read-only tools: `list_my_tasks` and `search_knowledge_base`. It reads the database with the
signed-in user's token, so it only sees what that user can see. It never writes, sends or closes anything;
drafts are labelled DRAFT. Nothing from the chat is stored.

Setup on the Supabase project: the function is deployed with JWT verification on. Add the secret
`ANTHROPIC_API_KEY` under Edge Functions → Secrets; until then the chat shows a setup message. To redeploy
after editing `index.ts`, deploy it again as `support-agent`.

## How it is connected

The Main Module imports this folder directly; there is no copy to keep in sync.

- `Main Module/vite.config.js` maps the alias `@hot-alerts` to this folder and resolves React from the
  Main Module's `node_modules`, so this folder needs no install of its own.
- `Main Module/src/components/MyTasks.jsx` renders `<HotAlerts>` and passes the app's Supabase client and
  date formatter.
- The GitHub Pages build checks out the whole repo, so changes here deploy with the next push to `main`.

Import only `react` here. Anything else the page needs (database client, helpers) is passed in as a prop.
