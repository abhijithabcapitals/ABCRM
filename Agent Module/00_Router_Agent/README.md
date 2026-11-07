# Router Agent (Bruno)

Bruno is the chat agent every CRM staff user has. Bruno docks on the right of every page, beside the Messenger dock; closed, it leaves a draggable tab on the right edge. Bruno sends a question to an agent the person has access to and shows that agent's reply word for word. When no agent gives information, the reply is exactly `Opps! I dont Know`.

Design: `docs/2026-11-04-router-agent-design.md`. Plan: `docs/2026-11-04-router-agent-plan.md`. Database: `Database Module/Router Base`.

| Path | Purpose |
|---|---|
| `components/BrunoPet.jsx` | Right-edge tab and dock, loads with the app |
| `components/BrunoExtra.jsx` | Lets a page show its own content at the top of the open dock (BD mini calendar) |
| `components/BrunoPanel.jsx` | Chat panel, loads on first open |
| `components/AgentNameField.jsx` | Rename field on the Profile page |
| `logic/` | Name and chat rules for the screens |
| `supabase/router-agent/index.ts` | Edge Function: access checks, choosing an agent, calling it |
| `supabase/router-agent/logic.js` | Routing rules, including `ROUTES`, the fixed list of callable agents |
| `tests/` | `node --test "Agent Module/00_Router_Agent/tests/"` |

## The chain

1. A person asks Bruno. `router-agent` picks at most two sub agents, using Bruno's model and rules from Settings > Agents.
2. The sub agent runs in `agent-gateway` from its row in Settings > Agents: role, instructions, extra content, knowledge, model and API key.
3. For CRM data, the sub agent calls its one tool, `ask_crm_agent`. `crm-agent` answers with the person's own login, limited to the tables in that sub agent's Database access. It cannot change anything on this path.
4. The sub agent replies, and Bruno returns that reply word for word, or `Opps! I dont Know`.

The CEO Agent keeps its own function and does not read these settings. See its warning below.

Check the chain with no live calls: `deno run -A --no-check chain.deno.ts` in `tests/`.

### Release of the chain

Each step needs approval. Apply `Database Module/AI Base/migrations/004_agent_gateway.sql`. Deploy `agent-gateway`, then `crm-agent`, then `router-agent`, with JWT verification on. Then merge to `main` and deploy per the CRM deploy steps. To undo, restore the previous `router-agent` and `crm-agent`, then run `rollback/004_agent_gateway_rollback.sql`.

## Who can use which agent

Set in Settings > Agents. An agent is used only when it is switched on, the person is ticked, the person has credit left, the agent's budget (if set) is not used up, and the agent is in `ROUTES`. Today `ROUTES` holds Support, Business Development, CEO and CRM (`crm-agent`, which answers lead status questions with no AI model). Admins need ticks and credit too.

The function logs a short reason code for each fixed reply, such as `no_credit` or `agent_403`, never message text.

## Go-live order

Each step needs approval. Keep this order. Run the commands from `Database Module/tools` in Git Bash, using the CLI set up in its README.

> **Warning:** step 6 removes the Support chat from Hot Alerts. If it goes live before step 5, staff lose that chat and Bruno answers `Opps! I dont Know` to everyone without access.

> **Warning:** do not redeploy `ceo-agent` from the repo. That code reads `public.email_saved_facts` and `public.email_drafts`, which do not exist live. The live function is older code plus router mode.

Already live: `Router Base` migrations 001 and 002, `Admin Base/migrations/013_crm_agent_claude.sql` and `014_crm_agent_chat.sql`, Bruno's screens, and `support-agent`, `bd-agent` and `ceo-agent` with router mode.

1. Raise the OpenRouter budget, then apply `Database Module/Admin Base/migrations/016_crm_agent_openrouter.sql` to project `pnnakrhfzyxudjaghoxx`.
2. Deploy `crm-agent`, then `router-agent`, with JWT verification on:

   ```bash
   rm -rf supabase/functions/crm-agent supabase/functions/router-agent
   mkdir -p supabase/functions/crm-agent supabase/functions/router-agent
   cp "../../Agent Module/14_CRM_Agent/supabase/crm-agent/"* supabase/functions/crm-agent/
   cp "../../Agent Module/00_Router_Agent/supabase/router-agent/"* supabase/functions/router-agent/
   npx supabase functions deploy crm-agent --project-ref pnnakrhfzyxudjaghoxx --use-api
   npx supabase functions deploy router-agent --project-ref pnnakrhfzyxudjaghoxx --use-api
   ```

3. Tick testers for the CRM Agent in Settings > Agents, and give them credit, which Bruno requires although this agent is free. Admins need this too.
4. Test through a local copy of these screens, with the real Messenger dock, because merging is otherwise their first real test. Use an admin and a non-admin. Try a lead they may view, one they may not, and a question with no lead number.
5. Switch agents on, tick staff and give them credit.
6. Merge to `main`, push and run `npm run deploy:cloudflare` in `Main Module`. This removes the Support chat and Email Agent tab.

Bruno's choice between several agents uses `OPENROUTER_API_KEY` too. If that call fails, Bruno tries the person's first two agents in order. The CRM Agent, BD and CEO all fail until the OpenRouter budget is fixed, and Support until its error is found.

To undo, restore the previous `router-agent`, then run `Admin Base/migrations/rollback/016_crm_agent_openrouter_rollback.sql`. `Router Base/migrations/rollback/001_rollback.sql` also deletes all saved names and chats.
