# Router Agent ("Bruno"): design

Status: awaiting user review, 2026-11-04. Nothing is built or live.

## 1. Intended outcome

Every CRM user has one chat agent inside the CRM, called Bruno until they rename it. Bruno is the interface to the other agents. It sends the question to an agent the person has access to and shows only what that agent returned. When no agent returns information, the reply is exactly `Opps! I dont Know` (the user's spelling, kept on purpose).

Success means:

- A signed-in staff user sees the pet on every page, opens it, asks a question, and gets an agent's reply word for word, or the fixed reply.
- A person can never reach an agent they were not given in Settings > Agents, whatever the browser sends.
- Bruno adds no words of its own to an answer.

## 2. User decisions (2026-11-04)

| Topic | Decision |
|---|---|
| Look | Small pet in the bottom-right corner that expands to a chat panel and collapses again |
| Name | Default "Bruno"; each person renames it in their profile |
| Email Agent tab | Removed |
| CEO Agent tab | Stays for admins, unchanged, including its chat, Inbox and Calendar |
| Support chat on Hot Alerts | Removed; Support is reached through Bruno |
| BD Agent panel | Stays, because it works with the open lead and its skill picker |
| Code folder | `Agent Module/00_Router_Agent` |
| Database folder | `Database Module/Router Base` |

Assumption, open to correction: chat history is stored in the database, capped at the last 50 messages per person. The user named a database folder but did not answer the storage question directly.

## 3. Existing work this builds on

- `Database Module/AI Base/migrations/002_agents.sql` holds `agents`, `agent_user_access`, `agent_user_credit` and `agent_usage`. These are live. Nothing enforces them yet, because no gateway exists. `router-agent` becomes the enforcer for calls made through Bruno.
- There is no agent-to-agent connection setup. In this design a "connection" is three things together: the agent's on switch, the person's access tick, and an entry in Bruno's fixed list of callable functions (section 6).
- All agents start disabled. Nobody starts with access, and credit defaults to zero.

## 4. Agents Bruno can reach

| Agent id | Function | Request body | Notes |
|---|---|---|---|
| `AGT-08-SUPPORT` | `support-agent` | `{ messages, router: true }` | Read-only |
| `AGT-05-BIZDEV` | `bd-agent` | `{ action: "chat", messages, router: true }` | Keeps its Business Development role check |
| `AGT-11-CEO` | `ceo-agent` | `{ messages, threadId, idempotencyKey, router: true }` | Keeps its owner rules. It saves each message as a capture and can create items, the same as in the CEO tab |

Not reachable in this version:

- `AGT-13-EMAIL` runs on a schedule and has no chat. It keeps running and sending notifications. Its follow-up screen has no page after the tab is removed; the component stays in `Agent Module/13_EMail_Agent`.
- `AGT-14-CRM` and all specification-only agents have no code that answers. Ticking them has no effect until they are added to the fixed list.

## 5. Message flow

1. The panel calls `router-agent` with `{ message }`, at most 4,000 characters. The history comes from the server, never from the browser.
2. The function verifies the login and takes the person's id from it.
3. `router_context` returns the person's eligible agents, their CEO thread and their recent messages.
4. An agent is eligible only when all of these hold: enabled, access ticked, in the fixed list, the person's monthly credit is not used up, and the agent's monthly budget (if set) is not used up. Months use Dubai time, as in `admin_agent_usage_this_month`.
5. With no eligible agent, the reply is the fixed reply and no paid call is made.
6. With one eligible agent, Bruno uses it directly. With several, a low-cost model (`deepseek/deepseek-v4.1-flash` through OpenRouter) ranks up to two, seeing only the question and each agent's name and role. Any id not on the eligible list is discarded. An empty ranking gives the fixed reply.
7. Bruno calls the first agent with the person's own login and the last 6 messages. If that agent has no answer, Bruno calls the second one. It never calls more than two.
8. The first usable reply is returned unchanged, with the agent's name as a separate field. The panel shows that name as a small label ("from Support Agent") under the reply.
9. The question and the reply are saved. Each call's cost is recorded in `agent_usage`.

Bruno's fixed replies are excluded from the messages sent to agents, so they cannot steer an agent.

### When the fixed reply is used

The reply is exactly `Opps! I dont Know` for all of these:

- no eligible agent, including no credit left
- the ranking returns nothing or fails
- the agent refuses access or returns an error
- timeout
- the agent reports no information
- the agent's reply is empty

The real reason goes to the function log as a short code such as `no_credit` or `agent_403`, with no message text. The only other message the panel shows is a connection error when `router-agent` itself cannot be reached, so a network fault does not look like an answer from Bruno.

### How an agent reports "no information"

Today's agents answer in free text. When a request has `router: true`, each of the three functions:

- adds a system rule: answer only from what your tools and data return, and if they do not give the answer, reply with exactly `NO_INFO`
- returns its existing canned fallbacks (for example Support's "I don't have an answer for that.") as `NO_INFO`
- returns `cost_usd` beside the reply

Requests without the flag behave exactly as they do today, so the CEO tab and BD panel are unaffected.

A reply that contains `NO_INFO` anywhere counts as no information.

Known limit: the rule is an instruction to a model, not a guarantee. An agent could still answer from general knowledge. This must be tried against each live agent before go-live (section 11, step 5).

### Limits

The whole request has a 140-second deadline, under the platform's 150-second limit. The ranking gets 15 seconds and each agent up to 70, within what remains.

Credit is checked before each paid call, so one message can overshoot the remaining credit slightly. This is accepted.

## 6. Security

- **Server-side access.** All checks run in `router-agent`. The browser only sends the message. It cannot name an agent.
- **Fixed function list.** The agent-to-function map is in code. The database cannot make Bruno call a new address.
- **Person's own login.** Agents are called with the caller's token, so row security and each agent's own checks still apply. The service role is used only for the `router_context`, save and usage writes, always with the verified person's id.
- **Untrusted text.** Replies are shown as plain text, never as HTML. Ranking output is checked against the eligible list. Question text is treated as data in the ranking prompt.
- **Known gap, not closed here.** The CEO tab and BD panel still call their functions directly, and `support-agent` can still be called directly by any signed-in person. Access ticks and credit apply only through Bruno. Closing this needs a change inside each agent and is left for later.

## 7. Database (`Database Module/Router Base`)

Files: `migrations/001_router.sql`, `migrations/rollback/001_rollback.sql`, and `tests/` with a `run-local.sh`, following `Database Module/AI Base`.

Tables are in a new schema `router`, not `public`:

- `router.settings`: `profile_id` primary key, `agent_name` (default `Bruno`, 1 to 30 characters after trimming), `ceo_thread_id`, `updated_at`.
- `router.messages`: `id`, `profile_id`, `role` (`user` or `assistant`), `content` (at most 8,000 characters), `agent_id` (null for the fixed reply), `created_at`. Index on `(profile_id, id desc)`. A trigger keeps the newest 50 per person.

**Why a separate schema.** The hourly job `audit_trail_attach_all` adds audit triggers to every new table in `public`. That would let admins read private chats through the audit trail, and it would grow storage on every message and trim. The job does not touch a `router` schema. This also avoids changing PostgREST's exposed schemas, which is a live configuration change.

Row security is on, with no policies and no grants to `anon` or `authenticated`, so the tables are unreachable directly. If a policy is ever added, it must wrap the call as `(select auth.uid())`.

Access is only through `security definer` functions in `public`, with a pinned `search_path`:

| Function | Caller | Purpose |
|---|---|---|
| `router_my_agent_name()` | signed-in person | Own name, `Bruno` when no row exists |
| `router_set_agent_name(text)` | signed-in person | Rename; rejects blank or over-long names |
| `router_history()` | signed-in person | Own saved messages |
| `router_clear()` | signed-in person | Delete own messages |
| `router_context(uuid)` | `service_role` only | Eligible agents, CEO thread, recent messages, with credit and budget applied |
| `router_save_message(uuid, text, text, text)` | `service_role` only | Save one message |
| `router_set_ceo_thread(uuid, uuid)` | `service_role` only | Remember the CEO thread, so Bruno does not start a new CEO thread for each message |

Changes to AI Base:

- `agent_table_allowed` must also refuse the `router` schema, so private chats can never be offered to an agent in Settings > Agents. This is changed in `002_agents.sql` and re-created in `001_router.sql`.
- `AGT-05-BIZDEV` is seeded as `not_connected` although it has its own code. The migration sets it to `own_code` only if it is still `not_connected`, and `build_agent_seed.py` is corrected to match.

## 8. Module layout (`Agent Module/00_Router_Agent`)

| Path | Purpose |
|---|---|
| `index.js` | Exports for the `@router-agent` alias in `Main Module/vite.config.js` |
| `components/BrunoPet.jsx` | Pet button; small inline SVG; loads with the app |
| `components/BrunoPanel.jsx` | Chat panel; loaded on first open through `lazy` |
| `components/AgentNameField.jsx` | Rename field for the Profile page |
| `logic/agentName.js` | Name rules |
| `logic/chat.js` | Pure helpers for the panel |
| `supabase/router-agent/index.ts` | Edge Function, JWT verification on |
| `supabase/router-agent/logic.ts` | Pure routing rules: eligibility, ranking output, reply handling, fixed reply |
| `tests/*.test.mjs` | Node tests |
| `README.md`, `CLAUDE.md` | How it works; deployment steps |

The function deploys from this folder with the CLI described in `Database Module/tools/README.md`, never from the removed CEO Agent copy.

## 9. Screens

- **Pet.** Rendered once in `Main Module/src/App.jsx` after a staff sign-in, on every page. Not shown on sign-in screens or in the client portal. It shows the person's agent name.
- **Panel.** Header with pet, name and collapse button; messages with the agent label; input and Send; a Clear button. Send is disabled while waiting. Open or collapsed is remembered per browser. Escape collapses. Full width on a phone. Only the pet button loads with the first download, and the panel loads on first open, so the 454 KB first download grows only by the small pet code.
- **Rename.** `AgentNameField` is one line in `Main Module/src/components/Profile.jsx`, so the merge with branch `profile-menu` stays small.

## 10. Removals

- **Email Agent tab.** Remove the lazy import and route in `App.jsx`, the row in `Sidebar.jsx`, and `Main Module/src/components/EmailAgent.jsx`. `startView` in `tabs.js` must send a saved `email-agent` view to the default page, otherwise an admin with that saved view would see an empty page. Update the comment in `tabs.js` and `tests/tabs.test.mjs`. The `email-agent` function, its schedule, its data and its module folder stay.
- **Support chat.** Remove `SupportChat` from `Hot Alerts Module/components/HotAlerts.jsx`, adjust the page layout, delete the component and update that README. The `support-agent` function stays.
- **Settings > Agents wording.** `Integrations Module/logic/agents.js` says the gateway "will enforce" budgets and credit. Update these lines to say Bruno enforces them for Support, BD and CEO. The Settings > Agents tab itself stays, because it is where access is granted.

## 11. Go-live order

Each live step needs the user's approval. The order matters.

1. Apply `Database Module/Router Base/migrations/001_router.sql`.
2. Deploy `support-agent`, `bd-agent` and `ceo-agent` with the `router` flag, from their module folders.
3. Deploy `router-agent`.
4. In Settings > Agents, switch agents on, tick people and give them credit. Admins need ticks too.
5. Try each agent through Bruno, including a question it cannot answer.
6. Merge to `main`, which deploys the screens and removes the Support chat and Email Agent tab.

If the screens go live before step 4, staff lose the Support chat and Bruno answers `Opps! I dont Know` to everyone.

Other branches that touch the same files and may need a merge: `profile-menu` (Profile, Sidebar), `optimize-core` (`AdminPanels.jsx`).

## 12. Tests

- **Node (`Agent Module/00_Router_Agent/tests/`):** eligibility for each failed condition, ranking output with unknown ids, `NO_INFO` handling, the exact fixed reply text, a two-agent limit, fixed replies left out of agent history, name rules.
- **SQL (`Database Module/Router Base/tests/`):** migration and rollback run twice; a signed-in person cannot read `router` tables directly or call service-only functions; person A cannot see person B's messages; the trim keeps 50; credit, budget, disabled and unticked agents are excluded; `agent_table_allowed` refuses `router`; `audit_trail_attach_all` attaches nothing to `router` tables.
- **Build:** `npm run build` in `Main Module`, checking that the panel is a separate chunk.
- **Existing tests:** `tabs.test.mjs` and the AI Base tests still pass.

## 13. Out of scope

- Connecting Email Agent, CRM Manager or specification-only agents.
- Enforcing ticks and credit on direct calls to agent functions.
- Combining answers from several agents.
- Pet animation beyond a simple hover and open state.
- Streaming replies, attachments or voice.
