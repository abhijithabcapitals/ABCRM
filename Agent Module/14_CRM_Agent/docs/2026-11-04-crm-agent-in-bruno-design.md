# CRM Agent in Bruno: design

Date: 2026-11-04. Status: replaced by `2026-11-04-crm-agent-claude-design.md`. Kept for history; do not build from it. Branch: `router-agent`, worktree `D:Abhijith ProjectsCRM-router`.

## Goal

Staff use the CRM Agent inside the CRM through Bruno, the chat already built on this branch, instead of only from
Claude. This also releases Bruno.

Success means:

1. A person ticked for the agent asks Bruno "What's the status of LD-2026-000002?" and gets the real answer from
   `CRM Agent`.
2. A person who may not view that lead gets the same reply as for a lead that does not exist.
3. Bruno's existing agents still work after the release, each checked in a real chat.

## Decisions

- **Part of Bruno.** Chosen by the user over a separate admin chat. The CRM Agent is one more entry in Bruno's fixed
  list, and Bruno keeps its access, credit and fixed-reply rules.
- **No AI model in this agent.** It finds lead numbers with a pattern and fills in a fixed reply, so it cannot invent a
  status and costs nothing. It only understands lead numbers. A model can be added when the agent has more tools.
- **Per-person lead access.** The chat applies the existing `bd_can_view_lead` rule through the caller's own login. The
  Claude connector's shared read token and `crm_agent_lead_status` are not used here, because they can read any lead.
- **Read-only.** No tool changes data. Updates need limits and a record of who made each change, and are out of scope.

## Limits

- "How's HMR doing?" gets `Opps! I dont Know`, because there is no lead number.
- `bd_can_view_lead` lets the roles `super_admin`, `bd_manager`, `team_leader`, `marketing_executive`,
  `onboarding_executive`, `management` and `read_only` view every lead. Other people see leads assigned to or acquired
  by them. This is the existing Business Development rule, unchanged.
- Bruno still refuses anyone with zero credit, although this agent is free, so people need some credit.
- When a person can use several agents, Bruno makes one small paid call to choose. It may choose the BD Agent for a
  lead question, and that agent uses a model. The live test checks this.
- A direct call to the new function skips the Settings > Agents tick, the known gap Bruno's design already records for
  the other agents. It reveals only what the person may already view under the rule above.

## Database

New migration `Database Module/Admin Base/migrations/013_crm_agent_chat.sql`, with a rollback. It is the next free
number across all branches. Run it after `012` and after `Database Module/migrations/bd/011`.

### `public.crm_agent_lead_status_for_me(p_lead text) returns jsonb`

`security definer`, fixed `search_path`, granted to `authenticated` only. Revoked from `public`, `anon` and
`service_role`.

- With no `auth.uid()`, it raises `sign in first`.
- It matches an exact lead number (trimmed, uppercased) on a lead that is not archived.
- It returns the same fields as `crm_agent_lead_status`: `lead_id`, `lead_number`, `name`, `stage`, `status`, `priority`,
  `assigned_to`, `onboarding_status`, `last_activity_at`, `next_followup_at`, `updated_at`.
- A lead that does not exist, is archived, or fails `bd_can_view_lead` returns `{"error":"not_found"}`, so a person
  cannot tell these apart.
- Each call adds a row to `crm_agent_tool_calls` with tool `get_crm_lead_status`, `ok`, `error_code` and a null
  `duration_ms`. The lead number is not stored. It also removes rows older than 90 days, as `crm_agent_log_call` does.

These calls appear in the tab's CRM Agent usage table beside connector calls.

### Agent description

Update `public.agents` where `id = 'AGT-14-CRM'`, only if `role` still has the seeded text:

- `name`: `CRM Agent`
- `role`: `Reads the current status of a Business Development lead from its exact lead number, such as LD-2026-000002.`

Bruno's ranking uses this text, and the old text would send it questions it cannot answer. The rollback restores the
seeded name and role.

## Function `crm-agent`

New Supabase Edge Function in `Agent Module/14_CRM_Agent/supabase/crm-agent/`: `index.ts` and `logic.js`. JWT
verification on. No secrets beyond the platform's URL and anon key, and no service role.

Request, as Bruno sends it: `POST { messages: [{ role, content }], router: true }`.

Response: `{ reply: string, cost_usd: 0 }`.

`logic.js`, pure and shared with Node tests:

- `findLeadNumbers(messages)`:
  - Uses the last message with role `user`, matching `LD-\d{4}-\d+` in any case, uppercased and without repeats.
  - With no match there, it uses the most recent earlier `user` message that has one, so "who owns it?" works.
  - Keeps at most 5.
- `formatLead(lead)`: one line with no labels added beyond these words. Empty values are left out:
  `LD-2026-000002, HMR Konsultan: New Lead, Open, Normal priority, assigned to Abhijith. Onboarding Not Started. Last activity 30 Oct 2026. Next follow-up 31 Oct 2026.`
  Dates use `en-GB` format in the `Asia/Dubai` time zone.
- `buildReply(numbers, results)`:
  - No numbers, or no number with a visible lead: `NO_INFO`.
  - Otherwise one line per number, in the order asked. A number with no visible lead gets `LD-2026-000099: no information.`

`index.ts` reads the lead through `crm_agent_lead_status_for_me` using the caller's `Authorization` header.

| Situation | Response |
|---|---|
| Not signed in | 401 |
| Bad body | 400 |
| Method other than POST | 405 |
| Database error on a lookup | 200 with `NO_INFO` and a short log code |

Logs hold short codes only, never message text or lead numbers. Bruno turns `NO_INFO` into its fixed reply.

A request to change a lead gets the current status only. The reply never says anything was changed. The lead name is
database text returned as text, and no model reads it, so it cannot act as an instruction here.

## Bruno changes

In `Agent Module/00_Router_Agent/supabase/router-agent/logic.js`, add `"AGT-14-CRM": { fn: "crm-agent" }` to `ROUTES`.
`agentRequest` already sends `{ messages, router: true }` by default. Update the README's agent list and go-live order.

## Bringing the branch up to date

`router-agent` is 70 commits behind main at the time of writing, with content conflicts in `Main Module/src/App.jsx`,
`Main Module/src/components/Profile.jsx` and `Main Module/src/tabs.js`. Merge `origin/main` into it first.

- Keep main's Messenger, Claude Subscription and Profile work, and add Bruno's pet, name field and tab removal.
- The CEO function moved to `Agent Module/11_Personal_Agent/CEO Agent Module`, so the README's deploy paths need
  updating, and any path the merge did not follow.
- Check on desktop and phone width that the pet does not cover the Messenger's dock and rail. If they overlap, move the
  pet within the corner. The user asked for bottom right.
- Update the Bruno README's statement of what the release removes if main has changed those screens.

## Errors

| Situation | Person sees |
|---|---|
| No lead number, unknown lead, or a lead they may not view | `Opps! I dont Know` |
| Some numbers visible and some not | Lines for each, with `no information.` for the others |
| `crm-agent` fails or times out | Bruno tries the next ranked agent, then gives `Opps! I dont Know` |
| No tick or no credit | `Opps! I dont Know`, with the reason code in Bruno's log |

## Testing

- **Node**, `Agent Module/14_CRM_Agent/tests/crmAgentChat.test.mjs`:
  - lowercase numbers, repeats, more than 5 numbers
  - a follow-up taken from earlier messages, including that assistant messages are ignored
  - `NO_INFO` cases, the mixed reply, empty values and the Dubai date around midnight UTC
- **Node**, Bruno's tests: `eligibleAgents` includes `AGT-14-CRM`, and `agentRequest` sends the expected body.
- **SQL**, `Database Module/Admin Base/tests/080_crm_agent_chat_test.sql`, stopping the run on failure:
  - assigned person, acquiring person, a manager role, and a person with no connection, who gets `not_found`
  - archived lead, unknown lead, and a person with no connection gets the same result as an unknown lead
  - `anon` and `service_role` refused; lead number not in the log; calls logged, including failures
  - no contact, tax, budget or note fields returned
  - agent text updated only when it still has the seeded text, and restored by rollback
- **Existing suites** after the merge: all of `run-local.sh`, Bruno's Node and SQL tests, and `npm run build`. The CRM
  Agent Worker tests are unreliable on this PC (`wrangler did not start`), and this work does not change the Worker.
- **Browser** with fake data: pet and Messenger on desktop and phone width.
- **Live**, after release steps 1 to 5: an admin and a non-admin login, each trying a permitted lead, a lead outside
  their access, a question with no number, and each other agent, including a question it cannot answer. The user runs
  these sign-ins.

## Release order

Each live step needs approval. Bruno's screens go last, so people keep the Support chat until Bruno is proven.

1. Merge main into the branch and run the suites. Local only.
2. Apply `Database Module/Router Base/migrations/001_router.sql` and `Admin Base` migration `013`.
3. Deploy `support-agent`, `bd-agent` and `ceo-agent` with their router mode, then `crm-agent` and `router-agent`.
4. The user switches agents on in Settings > Agents, ticks people and gives them credit. Admins need ticks too.
5. Live test. Bruno's screens are not on the main site yet, so the test calls `router-agent` from a local build signed in
   by the user.
6. Merge to main, push, and run `npm run deploy:cloudflare` in `Main Module`. This removes the Email Agent tab and the
   Support chat from Hot Alerts.

Rollback: before step 6, nothing staff use has changed; `rollback/013` and the Router Base rollback undo the database
parts, and the latter deletes saved names and chats. After step 6, revert the merge on main and deploy again.

## Out of scope

- Search by name, lead lists, or any model in this agent.
- Changing CRM data, `update_crm_lead` and `trigger_agent_workflow`.
- Other lead types, such as Banking.
- The larger CRM Manager agent that changes code and settings.
- Removing `/api/mcp` from the CEO Worker.
- Fixing the unreliable Worker tests.
