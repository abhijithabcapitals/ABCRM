# CRM Agent

The main agent that handles the CRM (agent `AGT-14-CRM`). The CEO Agent is a separate agent in
`Agent Module/11_Personal_Agent` and has no MCP endpoint.

| Path | Purpose |
|---|---|
| `src/index.ts` | Cloudflare Worker `crm-agent`: MCP Streamable HTTP endpoint at `/mcp` |
| `components/ClaudeConnectionPanel.jsx` | Settings > Agents card with the endpoint address and connection notes |
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

Claude OAuth, subscription usage and tool activity reporting are not implemented.

## Deploy

Run from this folder:

```powershell
npm install
npx wrangler secret put MCP_AUTH_TOKEN
npx wrangler secret put CRM_READ_TOKEN
npm run deploy
```

The token must be at least 32 characters. Clients send it as `Authorization: Bearer <token>`. Without it the
endpoint answers 503. Never commit the token.

## Local test

Put `MCP_AUTH_TOKEN=<random value>` in `.dev.vars` (git-ignored), then run `npm run dev`.
