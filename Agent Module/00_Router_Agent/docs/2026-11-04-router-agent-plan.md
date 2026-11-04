# Router Agent ("Bruno") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every CRM staff user a pet chat panel, Bruno, that returns only what the agents they were granted reply, and otherwise exactly `Opps! I dont Know`.

**Architecture:** A new Edge Function `router-agent` enforces Settings > Agents, picks an agent, and calls that agent's existing function with the person's own login. Support, BD and CEO gain a `router: true` mode. Private data lives in a new `router` schema, reached only through `security definer` functions.

**Tech Stack:** React 19 and Vite (`Main Module`), Supabase Postgres and Edge Functions (Deno), OpenRouter, `node --test`, local Postgres 18 through `run-local.sh`.

**Spec:** `Agent Module/00_Router_Agent/docs/2026-11-04-router-agent-design.md`

**Where to work:** worktree `D:\Abhijith Projects\CRM-router`, branch `router-agent`. All paths are relative to it.

**Changes from the spec, decided here:**
- Pure routing rules are in `supabase/router-agent/logic.js`, not `logic.ts`, so node tests and Deno import the same file.
- One more service-only function, `router_record_usage`, because the `agent_usage` write should go through the same locked path as the others.
- The check that the audit job ignores `router` is a static node test on the job's schema list, because the job needs `cron`, which the local test database lacks.

## Global Constraints

- The fixed reply is exactly `Opps! I dont Know`. Keep the spelling.
- Default name is `Bruno`; a name is 1 to 30 characters after trimming, counted in code points.
- Message limit is 4,000 characters; stored content limit is 8,000; history keeps the newest 50 per person; agents get the last 6 messages.
- Never more than two agents per message. Whole request deadline 140 seconds, ranking 15, each agent up to 70.
- Ranking model: `deepseek/deepseek-v4.1-flash` through OpenRouter.
- Replies are shown as plain text, word for word. Bruno adds no words; the agent name is a separate label.
- Requests without `router: true` must behave exactly as they do today.
- No merge, push, deploy or live database change without the user's approval for each step. This plan's tasks do none of them.
- Commit only files this plan names. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Heavy screens load lazily. Do not add a dependency.
- Do not delete agent functions, data, the Email Agent module folder or the `@email-agent` alias.

## Review Focus

- A second person signs in on the same browser: they must not see the first person's chat or agent name. Pinned in Task 5.
- The session expires during a chat: the person sees the connection error, and their typed question stays in the box. Pinned in Task 5.
- Pressing Enter twice quickly: only one request goes out. Pinned in Task 5.
- The ranking model replies with prose, code fences or an injected agent id: only ids on the eligible list are used, and prose means no agent. Pinned in Task 2.
- An agent reply longer than 8,000 characters: the person still sees it all now, and saving cuts it without failing. Pinned in Task 1.

---

### Task 1: Router Base database

**Files:**
- Create: `Database Module/Router Base/migrations/001_router.sql`
- Create: `Database Module/Router Base/migrations/rollback/001_rollback.sql`
- Create: `Database Module/Router Base/tests/run-local.sh`, `tests/010_router_test.sql`
- Modify: `Database Module/AI Base/migrations/002_agents.sql` (schema regex in `agent_table_allowed`)
- Modify: `Database Module/AI Base/build_agent_seed.py`, `migrations/003_agent_seed.sql` (add `AGT-05-BIZDEV` to `OWN_CODE` with `("openrouter", "deepseek/deepseek-v4.1-flash")`, then regenerate)

**Interfaces:**
- Produces, callable by a signed-in person:
  - `router_my_agent_name() returns text`
  - `router_set_agent_name(p_name text) returns text`
  - `router_history() returns table (id bigint, role text, content text, from_name text, created_at timestamptz)`, oldest first
  - `router_clear() returns void`
- Produces, `service_role` only:
  - `router_context(p_profile uuid) returns jsonb` shaped `{ agent_name, ceo_thread_id, credit_left, agents: [{ id, name, role, budget_left }], recent: [{ role, content }] }`, with `budget_left` null when the agent has no cap
  - `router_save_message(p_profile uuid, p_role text, p_content text, p_agent_id text) returns void`
  - `router_set_ceo_thread(p_profile uuid, p_thread uuid) returns void`
  - `router_record_usage(p_agent_id text, p_profile uuid, p_cost numeric) returns void`

- [ ] **Step 1: Write `tests/run-local.sh`, copying `Database Module/AI Base/tests/run-local.sh`**

Use port 55439. Load `AI Base/tests/000_stub.sql`, create role `service_role`, then `AI Base/migrations/002_agents.sql` and `003_agent_seed.sql`. Apply `001_router.sql` twice, run `010_router_test.sql`, apply the rollback, and check that schema `router` is gone.

- [ ] **Step 2: Write `tests/010_router_test.sql`, with the `t.is_true` and `t.fails` helpers from `AI Base/tests/010_agents_test.sql`**

Each check by label:
- as `authenticated`: `select * from router.messages` and `router.settings` fail with `permission denied`
- as `authenticated`: `router_context`, `router_save_message`, `router_set_ceo_thread` and `router_record_usage` each fail with `permission denied`
- no row means `router_my_agent_name() = 'Bruno'`
- `router_set_agent_name('  Rex  ') = 'Rex'`; blank and a 31-character name both raise; a 30-character name passes
- `router_set_agent_name` with no signed-in person raises
- person A's `router_history()` shows none of person B's messages; `router_clear()` removes only A's
- after 55 saves for one person, 50 rows remain and they are the newest
- saving 9,000 characters succeeds and stores 8,000
- context agents: a disabled agent, an unticked agent, a person with no credit row, a person whose usage reached their credit, and an agent whose usage reached its budget are each absent; an enabled, ticked, funded agent is present with correct `credit_left` and `budget_left`
- usage from last month does not count (Dubai month, as in `admin_agent_usage_this_month`)
- context `recent` has at most 6 rows, oldest first, and leaves out assistant rows whose `agent_id` is null
- `agent_table_allowed('router', 'messages')` is false, after creating the table
- `AGT-05-BIZDEV` runtime is `own_code` after the migration when it started as `not_connected`, and a saved `gateway` value is not changed

- [ ] **Step 3: Run it to verify it fails**

Run: `bash "Database Module/Router Base/tests/run-local.sh"`
Expected: FAILED, because `001_router.sql` does not exist.

- [ ] **Step 4: Write `001_router.sql` and the rollback**

Tables as in spec section 7. `router.messages.profile_id` and `router.settings.profile_id` reference `public.profiles` on delete cascade; `router.messages.agent_id` references `public.agents` on delete set null. Row security on, no policies, no grants to `anon`, `authenticated` or `public`. All functions are `security definer` with `set search_path = public, router, pg_temp`, revoked from `public, anon`, and granted per the Interfaces block. Idempotent throughout.

The trim is an after-insert row trigger deleting that person's rows outside the newest 50. `router_save_message` stores `left(p_content, 8000)`.

Re-create `agent_table_allowed` with `router` in the schema regex, matching the edit in `002_agents.sql`. Set the BD runtime with `update public.agents set runtime = 'own_code' where id = 'AGT-05-BIZDEV' and runtime = 'not_connected'`.

The rollback drops the functions and `router` schema, and states in a comment that it removes all saved names and chats and leaves the stricter `agent_table_allowed` in place.

- [ ] **Step 5: Run Router and AI Base tests**

Run: `bash "Database Module/Router Base/tests/run-local.sh"` and `bash "Database Module/AI Base/tests/run-local.sh"`
Expected: no `FAILED` line in either, ending with `rollback ok`.

- [ ] **Step 6: Commit** `Add Router Base with private chats and agent checks`

### Task 2: Routing rules

**Files:**
- Create: `Agent Module/00_Router_Agent/supabase/router-agent/logic.js`
- Test: `Agent Module/00_Router_Agent/tests/logic.test.mjs`

**Interfaces:**
- Produces from `logic.js`, with no imports:
  - `FIXED_REPLY`, `NO_INFO` (`"NO_INFO"`), `MAX_MESSAGE` (4000), `ROUTES` (agent id to `{ fn }`)
  - `eligibleAgents(agents, routes = ROUTES) -> agents[]`: those with a route, order kept
  - `canAfford(agent, creditLeft, spent) -> boolean`: credit and any budget are still above what this request spent
  - `parseRanking(text, eligibleIds) -> string[]`: at most 2
  - `rankingPrompt(question, agents) -> messages[]`
  - `agentRequest(id, messages, { threadId, idempotencyKey }) -> body`
  - `readAgentReply(status, body) -> { answer: string } | { code: string }`
  - `agentHistory(recent, question) -> messages[]`

- [ ] **Step 1: Write the failing tests**

```js
test("the fixed reply keeps the user's spelling", () => assert.equal(FIXED_REPLY, "Opps! I dont Know"));
test("only agents with a route", () => assert.deepEqual(eligibleAgents([{ id: "AGT-13-EMAIL" }, { id: "AGT-08-SUPPORT" }]).map((a) => a.id), ["AGT-08-SUPPORT"]));
test("ranking keeps at most two", () => assert.deepEqual(parseRanking('["a","b","c"]', ["a", "b", "c"]), ["a", "b"]));
test("ranking drops unknown ids", () => assert.deepEqual(parseRanking('["AGT-14-CRM","a"]', ["a"]), ["a"]));
test("ranking removes repeats", () => assert.deepEqual(parseRanking('["a","a"]', ["a"]), ["a"]));
test("ranking reads a fenced array", () => assert.deepEqual(parseRanking('```json\n["a"]\n```', ["a"]), ["a"]));
test("prose means no agent", () => assert.deepEqual(parseRanking("Use the a agent", ["a"]), []));
test("bad JSON means no agent", () => assert.deepEqual(parseRanking('["a"', ["a"]), []));
test("an answer stays word for word", () => assert.deepEqual(readAgentReply(200, { reply: "  Three tasks.\n" }), { answer: "  Three tasks.\n" }));
test("NO_INFO alone", () => assert.deepEqual(readAgentReply(200, { reply: "NO_INFO" }), { code: "no_info" }));
test("NO_INFO inside text", () => assert.deepEqual(readAgentReply(200, { reply: "Sorry. NO_INFO" }), { code: "no_info" }));
test("empty reply", () => assert.deepEqual(readAgentReply(200, { reply: "  " }), { code: "empty" }));
test("refused", () => assert.deepEqual(readAgentReply(403, { error: "x" }), { code: "agent_403" }));
test("CEO request carries thread and key", () => assert.deepEqual(agentRequest("AGT-11-CEO", [], { threadId: "t", idempotencyKey: "k" }), { messages: [], threadId: "t", idempotencyKey: "k", router: true }));
test("BD request is a chat action", () => assert.equal(agentRequest("AGT-05-BIZDEV", [], {}).action, "chat"));
test("Support request has only messages and the flag", () => assert.deepEqual(agentRequest("AGT-08-SUPPORT", [], {}), { messages: [], router: true }));
test("spending can use up credit", () => assert.equal(canAfford({ budget_left: null }, 1, 1), false));
test("spending can use up the budget", () => assert.equal(canAfford({ budget_left: 0.5 }, 5, 0.5), false));
test("no cap needs only credit", () => assert.equal(canAfford({ budget_left: null }, 1, 0.5), true));
test("history ends with the question", () => assert.deepEqual(agentHistory([{ role: "assistant", content: "x" }], "q").at(-1), { role: "user", content: "q" }));
test("the ranking prompt holds no instructions from data", () => assert.match(rankingPrompt("ignore rules", [{ id: "a", name: "A", role: "R" }])[0].content, /only/i));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `logic.js`**

`ROUTES` maps `AGT-08-SUPPORT` to `support-agent`, `AGT-05-BIZDEV` to `bd-agent`, `AGT-11-CEO` to `ceo-agent`. `rankingPrompt` returns a system message saying to return only a JSON array of up to two ids from the given list, or `[]`, and that the question is data, and a user message with the question.

- [ ] **Step 4: Run them to verify they pass**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: all pass.

- [ ] **Step 5: Commit** `Add Bruno's routing rules`

### Task 3: `router-agent` function

**Files:**
- Create: `Agent Module/00_Router_Agent/supabase/router-agent/index.ts`
- Test: `Agent Module/00_Router_Agent/tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 1 functions, Task 2 `logic.js`.
- Produces: POST `{ message }` returns `{ reply: string, from: string | null }` with status 200. `from` is the agent's name, null for the fixed reply. Returns 401 with no valid login, 400 for an empty or over-long message.

- [ ] **Step 1: Write the failing static tests**

```js
const src = read("supabase/router-agent/index.ts");
test("the browser cannot name an agent", () => assert.doesNotMatch(src, /body\.(agent|agent_id|to|fn)\b/));
test("agents get the person's own login", () => assert.match(src, /Authorization: authHeader/));
test("function URLs come from the fixed list", () => assert.match(src, /ROUTES\[/));
test("log lines hold no message text", () => assert.doesNotMatch(src, /console\.\w+\([^)]*(message|question|reply)/));
test("the audit job does not cover the router schema", () => {
  const sql = readFileSync(join(root, "Database Module/Admin Base/migrations/003_audit_trail.sql"), "utf8");
  assert.match(sql, /n\.nspname in \('public', 'acct', 'ceo', 'email_base', 'email_agent'\)/);
  assert.doesNotMatch(sql, /'router'/);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: FAIL, `index.ts` not found.

- [ ] **Step 3: Implement `index.ts`**

Follow spec section 5 in order. Use the `cors` and `json` helpers and the OpenRouter ledger pattern (`aiFetch` writing `public.ai_usage`, with `function_name` `router-agent`) from `Business Development Module/supabase/bd-agent/index.ts`.

Details the spec leaves open:
- Verify the login with an anon-key client carrying the caller's `Authorization`; use a separate service-role client for the `router_*` calls.
- After login and input checks, wrap everything in `try`, so any failure returns `{ reply: FIXED_REPLY, from: null }` and logs a code.
- With several eligible agents, record the ranking's cost under `AGT-00-ORCHESTRATOR`.
- Before each agent call, check `canAfford` with what this request has spent. Stop with code `no_credit` if false.
- Call agents with `fetch(`${SUPABASE_URL}/functions/v1/${ROUTES[id].fn}`)`, `AbortSignal.timeout(min(70000, time left))` and the caller's `Authorization` and anon `apikey`.
- Record `body.cost_usd` when it is a number, and log `no_cost` if not.
- Generate the CEO `idempotencyKey` with `crypto.randomUUID()`, and store a new `threadId` through `router_set_ceo_thread`.
- Save the question and reply after answering; a failed save is logged and never changes the reply.

- [ ] **Step 4: Run tests and type check**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: all pass.

Run: `deno check "Agent Module/00_Router_Agent/supabase/router-agent/index.ts"`, if Deno is installed. If not, say so in the task report.

- [ ] **Step 5: Commit** `Add the router-agent function`

### Task 4: `router` mode in Support, BD and CEO

**Files:**
- Modify: `Hot Alerts Module/supabase/support-agent/index.ts`
- Modify: `Business Development Module/supabase/bd-agent/index.ts`
- Modify: `CEO Agent Module/supabase/ceo-agent/index.ts`
- Test: `Agent Module/00_Router_Agent/tests/agents.test.mjs`

**Interfaces:**
- Consumes: the request bodies from Task 2 `agentRequest`.
- Produces: with `router: true`, responses are `{ reply, cost_usd, ...existing fields }`, and "no information" is `reply: "NO_INFO"`. Without the flag, responses are byte for byte what they are today.

- [ ] **Step 1: Write the failing static tests**

For each of the three files: it contains `body.router === true`, contains `NO_INFO`, and contains `cost_usd`. For Support, the literal `"I don't have an answer for that."` remains for requests without the flag. For CEO, `"That took too many steps. Try splitting the request."` remains likewise.

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: FAIL on the three files.

- [ ] **Step 3: Implement**

All three add this system rule in router mode, as a `ROUTER_RULE` constant in each file because each deploys alone: "Answer only from what your tools and data return. If they do not give the answer, reply with exactly NO_INFO and nothing else."

- **Support:** extend the body type with `router?: boolean`. Add the rule to `system`. Sum `response.usage` across rounds. Return `NO_INFO` for the refusal, empty and too-many-steps replies. Compute `cost_usd` from tokens with a small price table for `claude-opus-5-5`. Take the prices from the `claude-api` skill at build time, not from memory.
- **BD:** add the rule to the `system` array. Return `modelBody.usage?.cost` as `cost_usd`. Its empty answer stays a 502, which Bruno already treats as no answer.
- **CEO:** add the rule to `system`. Add a `spend: { usd: number }` parameter to `chat()` that sums `data.usage?.cost`. Return `cost_usd` from `finish`. Return `NO_INFO` for the too-many-steps reply. Keep `"Done."`, because it confirms a saved item.

- [ ] **Step 4: Run tests and type check**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: all pass.

Run `deno check` on the three files if Deno is installed. Run `deno test` on any existing `*_test.ts` beside them.

- [ ] **Step 5: Commit** `Add router mode to Support, BD and CEO agents`

### Task 5: Pet, panel and rename field

**Files:**
- Create: `Agent Module/00_Router_Agent/index.js`, `logic/agentName.js`, `logic/chat.js`
- Create: `Agent Module/00_Router_Agent/components/BrunoPet.jsx`, `BrunoPanel.jsx`, `AgentNameField.jsx`, `Bruno.css`
- Modify: `Main Module/vite.config.js` (alias `@router-agent`)
- Modify: `Main Module/src/App.jsx` (render beside `<ReadingWidget />`, around line 456)
- Modify: `Main Module/src/components/Profile.jsx` (one line)
- Test: `Agent Module/00_Router_Agent/tests/ui.test.mjs`

**Interfaces:**
- Consumes: Task 1 person-level functions; `router-agent` response from Task 3.
- Produces:
  - `cleanAgentName(raw) -> string | null`, with `DEFAULT_NAME`
  - `canSend(text, busy) -> boolean`
  - `CONNECTION_ERROR`, the only message the panel writes itself
  - `<BrunoPet supabase profile />`, `<AgentNameField supabase />`

- [ ] **Step 1: Write the failing tests**

```js
test("trims a name", () => assert.equal(cleanAgentName("  Rex "), "Rex"));
test("blank is refused", () => assert.equal(cleanAgentName("   "), null));
test("30 emoji fit, 31 do not", () => {
  assert.equal(cleanAgentName("🐶".repeat(30)), "🐶".repeat(30));
  assert.equal(cleanAgentName("🐶".repeat(31)), null);
});
test("cannot send blank", () => assert.equal(canSend("  ", false), false));
test("cannot send while waiting", () => assert.equal(canSend("hi", true), false));
test("cannot send over the limit", () => assert.equal(canSend("x".repeat(4001), false), false));
test("the panel never renders HTML", () => assert.doesNotMatch(read("components/BrunoPanel.jsx"), /dangerouslySetInnerHTML/));
test("the panel loads on demand", () => assert.match(read("components/BrunoPet.jsx"), /lazy\(\(\) => import\("\.\/BrunoPanel/));
test("a new person gets a fresh pet", () => assert.match(mainApp, /<BrunoPet[^>]*key=\{profile\.id\}/));
test("a failed send keeps the question", () => assert.match(read("components/BrunoPanel.jsx"), /CONNECTION_ERROR/));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`index.js` must export only `BrunoPet` and `AgentNameField`, with `BrunoPanel` imported lazily inside `BrunoPet`. The pet is an inline SVG dog with the person's name, a real `button` with `aria-label` "Open {name}", fixed to the bottom right. It reads the name once through `router_my_agent_name`. Open or collapsed is kept in `localStorage` as `bruno_open`, in `try`/`catch`. Render only when `profile` is set, after the `if (!user)` return, with `key={profile.id}`.

The panel follows spec section 9. On first open it loads `router_history()`. Each send calls `supabase.functions.invoke("router-agent", { body: { message } })`. Clear the input only after a successful response. On an `error`, show `CONNECTION_ERROR` and keep the typed text. Render with `white-space: pre-wrap`. Clear calls `router_clear()`. `AgentNameField` shows `cleanAgentName` errors and calls `router_set_agent_name`.

Check the pet does not sit on `ReadingWidget` or `GlobalAttention` at their positions; move the pet up if it does.

- [ ] **Step 4: Run tests and build**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`
Expected: all pass.

Run: `npm run build` in `Main Module`
Expected: success, with `BrunoPanel` in its own chunk in the output. Compare the main entry size with `origin/main`, and report it.

- [ ] **Step 5: Commit** `Add Bruno's pet, chat panel and rename field`

### Task 6: Remove the tab and the chat box

**Files:**
- Modify: `Main Module/src/App.jsx` (lines 33 and 551), `Main Module/src/components/Sidebar.jsx` (line 868)
- Delete: `Main Module/src/components/EmailAgent.jsx`
- Modify: `Main Module/src/tabs.js`, `Main Module/tests/tabs.test.mjs`
- Modify: `Hot Alerts Module/components/HotAlerts.jsx`, `Hot Alerts Module/README.md`
- Delete: `Hot Alerts Module/components/SupportChat.jsx`
- Modify: `Integrations Module/logic/agents.js` (`HELP.budget`, `HELP.credit` wording)

**Interfaces:**
- Produces: `startView(search, saved)` returns null in place of a retired view, so App falls back to its default page.

- [ ] **Step 1: Write the failing tests in `Main Module/tests/tabs.test.mjs`**

```js
test("a saved Email Agent page is retired", () => assert.equal(startView("", "email-agent"), null));
test("an Email Agent address is retired", () => assert.equal(startView("?view=email-agent", "hr"), null));
test("other saved pages still open", () => assert.equal(startView("", "hr"), "hr"));
test("the address still wins", () => assert.equal(startView("?view=messenger", "hr"), "messenger"));
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test "Main Module/tests/tabs.test.mjs"`
Expected: FAIL on the first two.

- [ ] **Step 3: Implement**

Remove the listed lines and files. Keep `"email-agent"` in `ADMIN_ONLY`, so a member can never land on it. Correct the comment at the top of `tabs.js`. Confirm App's line 44 handles a null `saved`, and adjust it if it does not. Check that the Hot Alerts layout fills the width without the chat column. Budget and credit help must say Bruno enforces these for Support, BD and CEO; do not change other help text.

- [ ] **Step 4: Run tests and build**

Run: `node --test "Main Module/tests/"`
Expected: all pass, or only failures also present on `origin/main`.

Run: `git grep -n "SupportChat\|components/EmailAgent" -- "Main Module/src" "Hot Alerts Module"`
Expected: no output.

Run: `npm run build` in `Main Module`
Expected: success.

- [ ] **Step 5: Commit** `Remove the Email Agent tab and Hot Alerts chat box`

### Task 7: Docs and browser check

**Files:**
- Create: `Agent Module/00_Router_Agent/README.md`, `Agent Module/00_Router_Agent/CLAUDE.md`
- Modify: `Agent Module/README.md`, `Database Module/README.md` (one line each)

- [ ] **Step 1: Write the docs**

The README holds spec section 11's go-live order with the exact commands, using `Database Module/tools/README.md`, including the warning about removing the Support chat before access is granted. `router-agent` deploys with JWT verification on, and needs `OPENROUTER_API_KEY`, which the project already has. `CLAUDE.md` states the module's rules: answers only from sub agents, the exact fixed reply, the fixed list in `ROUTES`.

- [ ] **Step 2: Browser check against a local dev server**

Run `Main Module` locally. Without the live function and tables deployed, chat cannot complete, so check only: the pet appears after sign-in on several pages; it opens and collapses; the panel chunk loads only on first open; a failed send shows `CONNECTION_ERROR` and keeps the text; the Email Agent row is gone; Hot Alerts has no chat box. A real end-to-end chat waits for go-live step 5, and the task report must say so.

- [ ] **Step 3: Full verification**

Run: `node --test "Agent Module/00_Router_Agent/tests/"`, `node --test "Main Module/tests/"`, both `run-local.sh` scripts and `npm run build` in `Main Module`.
Expected: all pass, with any failure also shown on `origin/main` reported as such.

- [ ] **Step 4: Commit** `Document the router agent and its go-live order`
