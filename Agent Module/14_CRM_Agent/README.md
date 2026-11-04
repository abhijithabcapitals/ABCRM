# CRM Agent

The main agent that handles the CRM (agent `AGT-14-CRM`). The CEO Agent is a separate agent in
`Agent Module/11_Personal_Agent` and has no MCP endpoint.

| Path | Purpose |
|---|---|
| `src/index.ts` | Cloudflare Worker `crm-agent`: MCP Streamable HTTP endpoint at `/mcp` |
| `components/ClaudeSubscriptionPanel.jsx` | Settings > Claude Subscription tab: plan notes, connection details, token rotation, tool-call usage |
| `components/mcpToken.js` | Creates a token and its SHA-256 hash in the browser; only the hash is sent to the database |
| `index.js` | Exports the panel; `Main Module/vite.config.js` maps it as `@crm-agent` |

## MCP endpoint

Stateless Streamable HTTP at `https://crm-agent.ceo-intelligence-agent.workers.dev/mcp`. It advertises
`get_crm_lead_status`, `update_crm_lead` and `trigger_agent_workflow`.

`get_crm_lead_status` is live and read-only. It calls the database function `crm_agent_lead_status`
(`Database Module/migrations/bd/011_bd_crm_agent_lead_status.sql`) with the `CRM_READ_TOKEN` secret, whose SHA-256
hash is stored in `crm_agent_access`. It takes an exact lead number or id, and returns stage, status, priority, owner
and follow-up dates only. Contact details, tax numbers, budgets and notes are not returned.

`update_crm_lead` and `trigger_agent_workflow` are authenticated placeholders. They return `not_implemented` and do
not change CRM data or start workflows. Real handlers still have to be connected through the router and authorized
CRM procedures.

Every request needs a Bearer token. The Worker checks it with the database function `crm_agent_check_mcp_token`
(valid, invalid or unset). `MCP_AUTH_TOKEN` is only the fallback: it is used while no token has been generated in
Settings (`unset`). If the database cannot be reached, the endpoint answers 503 and does not use the fallback.

Each tool call is logged through `crm_agent_log_call`: tool name, success, error code and duration. Lead numbers,
tool inputs and results are never stored. A logging failure never changes the tool result. Calls the SDK rejects for invalid input are not logged, so the failure count can be slightly understated.

Claude OAuth is not implemented.

## Claude plan usage

Settings > Claude Subscription shows the plan and limit percentages. An hourly scheduled task in the Claude desktop app
reads them and saves them with `crm_agent_report_plan_usage` over the database connection
(`Database Module/Admin Base/migrations/012_crm_agent_plan_usage.sql`). Readings stop while the laptop or the app is
off, and the tab marks a reading out of date after 2 hours. There is no public API for these figures, so an app update
could break the task.

## Deploy

Run from this folder:

```powershell
npm install
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put CRM_READ_TOKEN
npm run deploy
```

`MCP_AUTH_TOKEN` (at least 32 characters) is now only the fallback until a token is generated in Settings. Clients
send the token as `Authorization: Bearer <token>`. With no generated token and no secret the endpoint answers 503.
Never commit a token.

## Local test

Put `MCP_AUTH_TOKEN=<random value>` in `.dev.vars` (git-ignored), then run `npm run dev`.

`npm test` starts a mock Supabase on port 8799 and two local `wrangler dev` processes (ports 8798 and 8797) with test
tokens only. It needs those ports free and touches nothing live.
