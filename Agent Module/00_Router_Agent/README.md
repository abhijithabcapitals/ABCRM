# Router Agent (Bruno)

Bruno is the chat agent every CRM staff user has. A small pet sits in the corner of every page and opens a chat panel. Bruno sends a question to an agent the person has access to and shows that agent's reply word for word. When no agent gives information, the reply is exactly `Opps! I dont Know`.

Design: `docs/2026-11-04-router-agent-design.md`. Plan: `docs/2026-11-04-router-agent-plan.md`. Database: `Database Module/Router Base`.

| Path | Purpose |
|---|---|
| `components/BrunoPet.jsx` | Pet button, loads with the app |
| `components/BrunoPanel.jsx` | Chat panel, loads on first open |
| `components/AgentNameField.jsx` | Rename field on the Profile page |
| `logic/` | Name and chat rules for the screens |
| `supabase/router-agent/index.ts` | Edge Function: access checks, choosing an agent, calling it |
| `supabase/router-agent/logic.js` | Routing rules, including `ROUTES`, the fixed list of callable agents |
| `tests/` | `node --test "Agent Module/00_Router_Agent/tests/"` |

## Who can use which agent

Set in Settings > Agents. An agent is used only when it is switched on, the person is ticked, the person has credit left, the agent's budget (if set) is not used up, and the agent is in `ROUTES`. Today `ROUTES` holds Support, Business Development, CEO and CRM (`crm-agent`, which answers lead status questions with no AI model). Admins need ticks and credit too.

The function logs a short reason code for each fixed reply, such as `no_credit` or `agent_403`, never message text.

## Go-live order

Each step needs approval. Keep this order.

> **Warning:** step 6 removes the Support chat from Hot Alerts. If it goes live before step 4, staff lose that chat and Bruno answers `Opps! I dont Know` to everyone, because nobody has access or credit yet.

1. Apply `Database Module/Router Base/migrations/001_router.sql` to project `pnnakrhfzyxudjaghoxx`.
2. Deploy the agents with their `router` mode, from `Database Module/tools` in Git Bash, using the CLI set up in its README. Copy each from its module folder first:

   ```bash
   mkdir -p supabase/functions/support-agent supabase/functions/bd-agent supabase/functions/ceo-agent
   cp "../../Hot Alerts Module/supabase/support-agent/"* supabase/functions/support-agent/
   cp "../../Business Development Module/supabase/bd-agent/"* supabase/functions/bd-agent/
   cp "../../Agent Module/11_Personal_Agent/CEO Agent Module/supabase/ceo-agent/"* supabase/functions/ceo-agent/
   npx supabase functions deploy support-agent --project-ref pnnakrhfzyxudjaghoxx
   npx supabase functions deploy bd-agent --project-ref pnnakrhfzyxudjaghoxx
   npx supabase functions deploy ceo-agent --project-ref pnnakrhfzyxudjaghoxx
   mkdir -p supabase/functions/crm-agent
   cp "../../Agent Module/14_CRM_Agent/supabase/crm-agent/"* supabase/functions/crm-agent/
   npx supabase functions deploy crm-agent --project-ref pnnakrhfzyxudjaghoxx
   ```

   Do not deploy `ceo-agent` from `main` or this branch. That code reads `public.email_saved_facts` and `public.email_drafts`, which do not exist live. The live `ceo-agent` is the old live code plus router mode.

3. Deploy `router-agent` with JWT verification on. It needs the `OPENROUTER_API_KEY` secret, which the project already has:

   ```bash
   mkdir -p supabase/functions/router-agent
   cp "../../Agent Module/00_Router_Agent/supabase/router-agent/"* supabase/functions/router-agent/
   npx supabase functions deploy router-agent --project-ref pnnakrhfzyxudjaghoxx
   ```

4. In Settings > Agents, switch agents on, tick people and give them credit.
5. Try each agent through Bruno, including a question it cannot answer. The no-information rule is an instruction to a model, so check that the agent replies `Opps! I dont Know` and does not answer from general knowledge.
6. Merge to `main`, which deploys the screens and removes the Support chat and Email Agent tab.

To undo the database part, `Database Module/Router Base/migrations/rollback/001_rollback.sql` removes all saved names and chats.
