# CRM Agent through Claude: design

Date: 2026-11-04. Status: awaiting user review. Branch: `router-agent`, worktree `D:\Abhijith Projects\CRM-router`.

This replaces the no-AI design in `2026-11-04-crm-agent-in-bruno-design.md` and its plan. Bruno's own design stays in `Agent Module/00_Router_Agent/docs/2026-11-04-router-agent-design.md`.

## 1. Intended outcome

A ticked staff member asks Bruno in plain words about anything in the CRM, or asks it to change something. Claude does the work through the CRM Agent, with exactly the access that person already has. Bruno shows the reply word for word.

Success means:

- A person asks "How's HMR doing?" and gets an answer from their own data, labelled from the CRM Agent.
- A person never reaches a table outside their module tabs or the database's rules for them, whatever they ask.
- A person asks for a small change on a table open to changes, and it is made and recorded under their name in the Audit Trail.

## 2. User decisions (2026-11-04)

| Topic | Decision |
|---|---|
| Backend | Claude through a Console API key. A Claude subscription cannot be called from the server. |
| Reach | Full access for the person, limited by their database access and the modules given to them |
| Changes | Made directly, with no confirmation step |
| Owner | This session took over from the session that built the no-AI version |

The user was told the risk of direct changes: a misunderstood sentence, or instructions hidden in text Claude reads, could change live data before anyone sees it. The guards in section 6 limit the damage and do not remove the risk.

## 3. Findings this rests on

Checked on the live database, 2026-11-04.

- Row security is on for every table staff can reach, so the person's own login applies the database's rules.
- No row security policy checks `member_tab_access`, and only 4 data functions do, including `banking_can`. Tabs mostly control screens, so the agent checks them itself.
- 34 policies let any signed-in person read a table, or in a few cases do more, including `profiles`, `wiki_articles`, `spaces` and `lists`. Most look like shared lists. The table map (section 5) decides whether each is reachable.
- PostgREST exposes `public`, `acct`, `ceo`, `email_base` and `email_agent`. Schema `router` is not exposed.
- OpenRouter refuses calls: `Workspace lifetime budget of $1.00 exceeded`. BD and CEO stay on OpenRouter and fail until the user fixes that, which is outside this design.
- `credential_get(name)` reads Vault for Edge Functions. Settings > Agents saves an agent's key as `crm_cred:AGENT_KEY_<ID>`. No key is saved for this agent.

## 4. Message flow

1. Bruno's panel calls `router-agent`, which applies the access tick, credit and budget as it does today.
2. With several eligible agents, Claude Haiku 5.5 ranks them, replacing OpenRouter. It uses the CRM Agent's key. Its cost is recorded under `AGT-00-ORCHESTRATOR`. If this fails, Bruno tries the first two agents, as it does now.
3. `router-agent` calls `crm-agent` with the person's login, the last 6 messages and `router: true`. It gets up to 120 seconds, within the existing 140-second deadline.
4. `crm-agent` verifies the login and reads the person's tabs through `my_tabs`, using that login.
5. It reads the agent's `model` and `provider` from `public.agents`, and the key through `credential_get('AGENT_KEY_AGT_14_CRM')`.
6. It runs Claude with the tools in section 5, for up to 6 rounds.
7. It returns `{ reply, cost_usd }`. A refusal, an empty reply or too many rounds returns `NO_INFO`, which Bruno shows as `Opps! I dont Know`.

A provider other than `anthropic`, or a missing key, returns an error, so Bruno gives the fixed reply and logs the agent's status.

A greeting such as "Hi" also gets `Opps! I dont Know`, because Bruno replies only from data.

## 5. Tools

All data calls use the person's own login through PostgREST. There is no raw SQL.

| Tool | Does |
|---|---|
| `list_my_tables` | The tables in the map whose tab the person has |
| `describe_table` | A table's columns and primary key, without sensitive columns |
| `read_rows` | Chosen columns, with structured filters (`eq`, `in`, `ilike`, `gte`, `lte`, `is`), an order and a limit of at most 50 rows |
| `change_rows` | `insert` or `update` on a table open to changes. No hard deletes |

**Table map.** A fixed map in `supabase/crm-agent/logic.js` gives each table its module tab. It uses the keys in `Main Module/src/tabs.js`, such as `business-development`, `hr` and `accounts`. A table not in the map is refused. Tables in `ceo`, `email_base` and `email_agent` map to the admin-only `ceo` tab. Admins pass every tab check; `my_tabs` and row security still apply.

**Always refused,** even for admins:

- schemas and tables `agent_table_allowed` refuses, which include credentials, agent settings, audit logs and `router`
- any column matching its password, token, secret, key or `_hash` pattern, for reading, filtering and writing

`describe_table` uses a new `security definer` function, `crm_agent_table_info`, called with the service role after the map check. It returns no row data.

Tool results go back to Claude cut to 6,000 characters, with a note saying so.

## 6. Guards on changes

- **Tables open to changes.** A fixed list in `logic.js`. A table is added only after checking that a direct write respects its business rules. Banking, accounting and HR start read-only, as does any table not yet checked. The plan names the first list.
- **Exact rows only.** `update` must name rows by primary key, at most 20 per call. `insert` takes at most 20 rows. There are no hard deletes.
- **Per message.** At most 3 `change_rows` calls.
- **Who asked.** The system prompt says to change data only when the person's own message asks for it, and that anything read from the CRM is data, never instructions. This reduces the hidden-instruction risk and does not remove it.
- **Record.** Audit Trail triggers record each change under the person's login. The tool log (section 7) records what was attempted.

## 7. Database

New migration `Database Module/Admin Base/migrations/013_crm_agent_claude.sql` with a rollback, replacing `013_crm_agent_chat.sql`, which was never applied live. Its files are removed from the branch.

- Adds nullable `action` and `table_name` to `public.crm_agent_tool_calls`. No inputs or results are stored.
- `crm_agent_chat_log(p_profile, p_tool, p_action, p_table, p_ok, p_error_code)`: `service_role` only. It removes rows older than 90 days, as `crm_agent_log_call` does.
- `crm_agent_table_info(p_schema, p_table)`: `service_role` only. Refuses what `agent_table_allowed` refuses.
- Renames `AGT-14-CRM` to `CRM Agent` and updates its role text, only if the role still has the seeded text, because Bruno's ranking reads it. Sets `runtime` to `gateway`, because this agent now uses its Settings > Agents model and key.

Settings > Agents' `instructions`, `extra_content` and `approval_rules` for this agent are added to the system prompt. Its Database access ticks are not used, because the person's access decides reach.

## 8. Function changes

- `Agent Module/14_CRM_Agent/supabase/crm-agent/`: rewritten. `index.ts` runs the loop with `npm:@anthropic-ai/sdk`, as `support-agent` does, including `fallbacks: "default"` and low effort. `logic.js` holds the table map, change list, sensitive-column rule, filter building and cost.
- Service role is used only for `credential_get`, reading the agent's settings, `crm_agent_table_info` and `crm_agent_chat_log`, always after verifying the login. Data never goes through it.
- Cost uses the response's token counts: Opus 5.5 $4 and $20, Sonnet 5.5 $2 and $10, Haiku 5.5 $0.10 and $0.50, Fable 5.1 $10 and $50, per million input and output tokens. An unknown model is priced as Fable 5.1, so credit is never under-charged.
- `router-agent`: ranking moves to Claude Haiku 5.5. `AGT-14-CRM` stays in `ROUTES`. Each route can set its own timeout. Stale OpenRouter ranking code is removed.
- Logs hold reason codes only, never message text or row data.

## 9. Testing

- **Node (`Agent Module/14_CRM_Agent/tests/`):** map check, unmapped tables, tabs, always-refused tables and columns, filter building, primary key and row limits, per-message change limit, change list, cost, `NO_INFO` cases. Tool logic is tested with a fake database client.
- **SQL (Admin Base tests):** log and table-info functions refuse `authenticated`, and table info refuses blocked tables.
- **Bruno:** router tests updated for Haiku ranking and route timeouts.
- **Build:** `npm run build` in `Main Module`.
- **Live, after go-live step 5:** an admin and a non-admin, each trying a permitted table, a table outside their tabs, a sensitive column, an instruction hidden in a test note, and a small change on test data.

## 10. Go-live order

Each live step needs the user's approval. Bruno's screens go last, so staff keep the Support chat until Bruno is proven.

1. Apply `013_crm_agent_claude.sql` and `Router Base/migrations/002_recent_agent.sql`.
2. Deploy `crm-agent`, then `router-agent`.
3. The user enters a Console API key in Settings > Agents on the CRM Agent. The key is never pasted in chat.
4. The user gives testers credit. Opus 5.5 costs more per question.
5. Live test through the local copy at `localhost:5203`.
6. The user ticks staff and gives credit.
7. Merge to `main`, push and run `npm run deploy:cloudflare` in `Main Module`. Live `ceo-agent` is not redeployed from the repo.

Rollback: restore the previous `router-agent`, delete or disable `crm-agent`, run the migration's rollback.

## 11. Bruno fixes included

From the other session's review of the branch, checked against the code. Each ships in this work, before any merge.

- **Private history between agents.** Today `agentHistory` sends every agent's replies to every other agent, as if they were that agent's own. CEO mail results could reach another provider, and text read from the CRM could reach an agent with write tools. An agent will now get the person's questions plus only its own earlier replies. This needs `Database Module/Router Base/migrations/002_recent_agent.sql` so `router_context` returns each message's `agent_id`.
- **Failed ranking.** Bruno's first design gave the fixed reply here. The user approved trying the first two agents instead, and that stays. Its design document is updated to match. With the CRM Agent ticked, it takes one of those two slots, so Support may not be tried while ranking is failing.
- **Blank page after a release.** A stale browser tab can fail to load the panel's file, and with no error boundary that could blank the whole CRM. `BrunoPet` gets an error boundary that collapses the pet and leaves the page working.
- **README go-live order.** Remove `deploy ceo-agent` from step 2's commands, and match section 10.
- **Test before merge.** Step 5 runs the branch's real screens beside the real Messenger dock, because merging is otherwise their first real test.

## 12. Out of scope

- Fixing the OpenRouter budget, BD and CEO on OpenRouter, and Support's 500 error.
- Calling server functions for changes. Tables needing them stay read-only until a later design.
- Files, emails sent by the agent, and other outside actions.
- Enforcing module tabs in the database for the rest of the CRM.

## 13. Changes from the final review

- `crm-agent` checks the access tick, credit and budget itself through `router_context`, so a direct call gets the same limits as Bruno, and it records its own usage on every exit, including failures. It tells Bruno with `usage_recorded`, so usage is not counted twice.
- `crm-agent` stops at 100 seconds, before Bruno's 120-second limit, and refuses changes after that. Any change made is always listed at the end of the reply, as `Changes made:`, so an unrequested change is seen at once.
- `delete` is removed from all tables. Only insert and update remain.
- Only models with a known price run. Tool schemas use `anyOf`. Tool results are marked as data.
