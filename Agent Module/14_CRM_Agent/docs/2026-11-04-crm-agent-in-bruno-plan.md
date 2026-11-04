# CRM Agent in Bruno Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff read a Business Development lead's status through Bruno, and release Bruno.

**Architecture:** A new `crm-agent` Edge Function, called by Bruno with the person's own login, finds lead numbers with a pattern and fills in a fixed reply with no AI model. A new database function applies `bd_can_view_lead` and logs each lookup. Bruno gets one new route.

**Tech Stack:** Postgres 18 (local test cluster), Supabase Edge Functions (Deno), React with Vite, `node:test`.

**Spec:** `Agent Module/14_CRM_Agent/docs/2026-11-04-crm-agent-in-bruno-design.md`

Work in worktree `D:\Abhijith Projects\CRM-router`, branch `router-agent`. On this laptop use `npx.cmd`, because PowerShell blocks `npx.ps1`.

## Global Constraints

- Fixed reply text is `Opps! I dont Know`, in Bruno, unchanged. This agent returns `NO_INFO` and never that text.
- Returned fields: `lead_id`, `lead_number`, `name`, `stage`, `status`, `priority`, `assigned_to`, `onboarding_status`, `last_activity_at`, `next_followup_at`, `updated_at`. No contact, tax, budget or note fields.
- A lead that does not exist, is archived or fails `bd_can_view_lead` gives the same `{"error":"not_found"}`.
- Lead numbers, message text and tokens never go in logs or `crm_agent_tool_calls`.
- The agent uses no AI model, no service role and no secrets. `cost_usd` is always 0.
- Nothing live happens outside Task 4, and each live step in Task 4 needs the user's approval.

## Review Focus

- A number followed by punctuation or inside a sentence, such as `LD-2026-000002?` or `(ld-2026-000002),`: it is still found.
- A malformed `messages` value, such as a non-array or non-string content: the agent answers `NO_INFO` and does not crash.
- An empty or invalid date, or a null owner, in a lead: that part is left out and the line stays readable.
- A database error on one of several numbers: that number gets the `no information.` line and the others still answer.
- A lead number that only appears in an earlier assistant reply: it is not used as the follow-up source.

---

### Task 1: Bring the branch up to date

**Files:**
- Modify: `Main Module/src/App.jsx`, `Main Module/src/components/Profile.jsx`, `Main Module/src/tabs.js` (conflicts)
- Modify: `Agent Module/00_Router_Agent/README.md` (paths and removal list)
- Modify as needed: `Agent Module/00_Router_Agent/components/Bruno.css`

**Interfaces:**
- Produces: `router-agent` containing `origin/main`, with Bruno's pet mounted, `AgentNameField` on Profile, and Bruno's tab removal applied.

- [ ] **Step 1: Merge**

Run `git fetch origin` then `git merge origin/main`. Expected conflicts: the three files above. Keep everything main added (Messenger, Claude Subscription, Profile changes) and add Bruno's changes. If `tabs.js` or `App.jsx` on main no longer has a screen Bruno removes, keep it removed. Report BLOCKED on any other conflict that is not mechanical.

- [ ] **Step 2: Fix moved paths**

The CEO function moved to `Agent Module/11_Personal_Agent/CEO Agent Module`. Grep the router code, tests and README for `CEO Agent Module` and fix any path the merge did not follow. Confirm the three router-mode edits survived: `ROUTER_RULE` exists in the support, BD and CEO functions.

- [ ] **Step 3: Run the suites**

Run `npm ci` in `Main Module`, then:
- `node --test "Agent Module/00_Router_Agent/tests/"`
- `bash "Database Module/Router Base/tests/run-local.sh"`
- `bash "Database Module/Admin Base/tests/run-local.sh"`
- `npm run build` in `Main Module`

Expected: all pass, or a failure caused by the merge, which you fix. Report any failure you did not cause. Do not run `Agent Module/14_CRM_Agent/tests/worker.test.mjs` for this task: this work does not change the Worker and it is unreliable here.

- [ ] **Step 4: Check the corner**

With a throwaway uncommitted harness page using fake data, or the Vite app's components directly, check Bruno's pet and panel beside the Messenger dock and rail at desktop and 375px width. If they overlap, change only `Bruno.css`, keeping the pet at the bottom right, and raise its position above the Messenger's controls. Delete the harness. Record what you saw in your report, with no sign-in.

- [ ] **Step 5: Commit**

Commit the merge. Commit the README and CSS changes separately, along with `Agent Module/14_CRM_Agent/docs`. Do not push.

### Task 2: Database function

**Files:**
- Create: `Database Module/Admin Base/migrations/013_crm_agent_chat.sql`
- Create: `Database Module/Admin Base/migrations/rollback/013_crm_agent_chat_rollback.sql`
- Create: `Database Module/Admin Base/tests/080_crm_agent_chat_test.sql`
- Modify: `Database Module/Admin Base/tests/000_stub.sql`, `Database Module/Admin Base/tests/run-local.sh`

**Interfaces:**
- Consumes: `public.crm_agent_tool_calls`, `public.bd_can_view_lead(uuid)`, `public.bd_leads`, `public.bd_pipeline_stages`, `public.profiles`, `public.agents`.
- Produces: `public.crm_agent_lead_status_for_me(p_lead text) returns jsonb`, granted to `authenticated` only.

Before committing, re-check migration numbers across all branches and origin refs, and take a later number if 013 is used.

- [ ] **Step 1: Add the stub and runner lines**

In `000_stub.sql`, add minimal `public.bd_pipeline_stages (id uuid pk, stage_name text)`, `public.bd_leads` with the columns the function reads plus `mobile_number`, `email`, `vat_trn`, `estimated_budget`, `internal_notes`, `assigned_to_user_id`, `acquired_by_user_id`, `archived_at`, `public.bd_current_role()`, and `public.bd_can_view_lead(uuid)` with the live body (the roles list is in the spec's Limits section). Add `public.agents (id text pk, name text, role text)` with row `AGT-14-CRM`, name `CRM Manager`, role `Manages the CRM by chat: settings, integrations, database, UI and code changes, each approved by an admin.` In `run-local.sh`, add 013 to the migration loop after 012, run 080 with the same stop-on-failure capture as 070, then run the rollback twice and reapply, stopping if objects remain.

- [ ] **Step 2: Write the failing tests in `080_crm_agent_chat_test.sql`**

Use the `t.ok` / `t.fails` helper pattern from `070_crm_agent_plan_usage_test.sql`, in schema `t8`. Identity through `set role` and `test.uid`.

| Check | Expected |
|---|---|
| assigned person reads their lead | `lead_number` and `stage` returned |
| acquiring person reads the lead | returned |
| `bd_manager` role reads a lead not theirs | returned |
| unconnected person reads a lead | `{"error":"not_found"}` |
| unknown number, as any person | exactly the same value as the row above |
| archived lead, as the assigned person | same `not_found` |
| `' ld-2026-000002 '` | found, trimmed and uppercased |
| null lead | `not_found` |
| returned keys | exactly the 11 in Global Constraints |
| returned text | contains none of the seeded mobile, email, VAT, budget or note values |
| `anon` or `service_role` calls | permission denied |
| no `test.uid` as `authenticated` | fails with `sign in first` |
| found call | adds a log row: tool `get_crm_lead_status`, `ok` true, null duration |
| not-found call | adds a log row: `ok` false, `error_code` `not_found` |
| log rows | contain no lead number in any column |
| row dated 91 days ago, then a call | row deleted |
| after migration | agent name `CRM Agent`, role as in the spec |
| agent role changed by hand, then 013 reapplied (runner) | hand-edited role kept |
| hand-edited role, then rollback (runner) | hand-edited role kept |
| new role, then rollback (runner) | seeded name and role restored |

- [ ] **Step 3: Run tests to verify they fail**

Run: `bash "Database Module/Admin Base/tests/run-local.sh"`
Expected: `FAILED` for the missing 013 file.

- [ ] **Step 4: Write the migration and rollback**

In `begin; ... commit;`, idempotent. The function is `security definer set search_path = public, pg_temp`. Revoke from `public, anon, authenticated, service_role`, then grant to `authenticated`. The body is otherwise the select in `Database Module/migrations/bd/011_bd_crm_agent_lead_status.sql` with a `bd_can_view_lead` check. Update the agent `where id = 'AGT-14-CRM' and role = '<seeded text>'`. End with `notify pgrst, 'reload schema';`. Do not touch `audit_trail_attach_all`. In a header comment, note the seed `Database Module/AI Base/migrations/003_agent_seed.sql`: read how it handles an existing row, and if a re-run overwrites the role, say to re-apply 013 after it.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash "Database Module/Admin Base/tests/run-local.sh"`; `echo $?`
Expected: exit 0, `ok` lines for each check, no `FAILED`.

- [ ] **Step 6: Commit**

```bash
git add "Database Module/Admin Base"
git commit -m "Add a per-person lead status function for the CRM Agent chat"
```

### Task 3: `crm-agent` function and Bruno route

**Files:**
- Create: `Agent Module/14_CRM_Agent/supabase/crm-agent/logic.js`
- Create: `Agent Module/14_CRM_Agent/supabase/crm-agent/index.ts`
- Create: `Agent Module/14_CRM_Agent/tests/crmAgentChat.test.mjs`
- Modify: `Agent Module/00_Router_Agent/supabase/router-agent/logic.js`
- Modify: `Agent Module/00_Router_Agent/tests/logic.test.mjs`, `Agent Module/00_Router_Agent/README.md`, `Agent Module/14_CRM_Agent/README.md`

**Interfaces:**
- Consumes: `crm_agent_lead_status_for_me(p_lead)` from Task 2.
- Produces, in `logic.js`, importable by plain Node:
  - `NO_INFO = "NO_INFO"`, `MAX_NUMBERS = 5`
  - `findLeadNumbers(messages: unknown) -> string[]`
  - `formatLead(lead: object) -> string`
  - `buildReply(numbers: string[], results: Array<object|null>) -> string`, where `results[i]` is the lead or null

- [ ] **Step 1: Write the failing tests in `crmAgentChat.test.mjs`**

```js
const user = (content) => ({ role: "user", content });
const assistant = (content) => ({ role: "assistant", content });
const lead = { lead_number: "LD-2026-000002", name: "HMR Konsultan", stage: "New Lead", status: "Open", priority: "Normal", assigned_to: "Abhijith", onboarding_status: "Not Started", last_activity_at: "2026-10-30T08:44:41Z", next_followup_at: "2026-10-31T08:44:00Z" };
```

- `finds a number in a sentence`: `[user("What's the status of LD-2026-000002?")]` gives `["LD-2026-000002"]`.
- `finds lowercase and punctuated`: `[user("(ld-2026-000002), please")]` gives `["LD-2026-000002"]`.
- `drops repeats`: the same number twice gives one.
- `keeps at most 5`: 6 numbers give the first 5.
- `follow-up uses the earlier user message`: `[user("LD-2026-000002"), assistant("x"), user("who owns it?")]` gives the number.
- `the newest message wins`: `[user("LD-2026-000001"), user("LD-2026-000002")]` gives only the second.
- `ignores assistant text`: `[assistant("LD-2026-000002"), user("who owns it?")]` gives `[]`.
- `malformed input`: `null`, `"x"`, `[null]`, `[{ role: "user", content: 5 }]` each give `[]`.
- `formats a lead`: `formatLead(lead)` equals `LD-2026-000002, HMR Konsultan: New Lead, Open, Normal priority, assigned to Abhijith. Onboarding Not Started. Last activity 30 Oct 2026. Next follow-up 31 Oct 2026.`
- `date uses Dubai`: `next_followup_at: "2026-10-30T21:00:00Z"` gives `Next follow-up 31 Oct 2026.`
- `leaves out empty values`: null `assigned_to`, `next_followup_at` and `last_activity_at` give `LD-2026-000002, HMR Konsultan: New Lead, Open, Normal priority. Onboarding Not Started.`
- `leaves out a bad date`: `last_activity_at: "soon"` has no `Last activity` part and no `Invalid`.
- `no numbers`: `buildReply([], [])` is `NO_INFO`.
- `no visible lead`: `buildReply(["LD-2026-000002"], [null])` is `NO_INFO`.
- `mixed reply`: two numbers, `[lead, null]`, gives the formatted line, a newline, then `LD-2026-000099: no information.`
- `index has no service role or message logging`: read `index.ts` as text; assert it has no `SERVICE_ROLE` and that its `console.log` calls use fixed codes only (no `message`, `messages`, `content`, `lead`).

In `logic.test.mjs` add: `ROUTES["AGT-14-CRM"].fn === "crm-agent"`, `eligibleAgents` keeps `AGT-14-CRM`, and `agentRequest("AGT-14-CRM", m)` deep-equals `{ messages: m, router: true }`. Update any test that fixes the route count.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test "Agent Module/14_CRM_Agent/tests/crmAgentChat.test.mjs" "Agent Module/00_Router_Agent/tests/logic.test.mjs"`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `logic.js`, then `index.ts`, then the route**

`logic.js` has no imports. Match `/LD-\d{4}-\d+/gi`.

`index.ts`, following the shape of `router-agent/index.ts` (same CORS and `json` helpers, `createClient` with the anon key and the caller's `Authorization`):
- OPTIONS gives `ok`; other methods than POST give 405; `auth.getUser()` failing gives 401; a body that fails `req.json()` gives 400.
- Look up each number in parallel with `crm_agent_lead_status_for_me`. An rpc error, or a result with `error`, becomes null. An rpc error logs the code `lookup_failed`.
- Respond `{ reply: buildReply(numbers, results), cost_usd: 0 }`.
- Header comment: copy `logic.js` with this file, deploy as `crm-agent` with JWT verification on, no secrets.

Add `"AGT-14-CRM": { fn: "crm-agent" }` to `ROUTES`. Add the agent to both READMEs, and add `crm-agent` to Bruno's go-live deploy step, using the same copy and deploy commands as the others, from `Agent Module/14_CRM_Agent/supabase/crm-agent/`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test "Agent Module/14_CRM_Agent/tests/crmAgentChat.test.mjs"` and `node --test "Agent Module/00_Router_Agent/tests/"`; then `npm run build` in `Main Module`.
Expected: all pass. If `deno` is installed, also run `deno check` on `index.ts`; otherwise say it was not run.

- [ ] **Step 5: Commit**

```bash
git add "Agent Module/14_CRM_Agent" "Agent Module/00_Router_Agent"
git commit -m "Add the CRM Agent to Bruno"
```

### Task 4: Release

Each step is live and needs the user's approval first. Stop and report if a check fails. Before starting, re-fetch `origin/main`, and merge and re-run the suites if it moved.

- [ ] **Step 1: Apply the migrations**

Compare the live `audit_trail_attach_all` with the repo first. Apply `Database Module/Router Base/migrations/001_router.sql` and `Admin Base` 013 to `pnnakrhfzyxudjaghoxx`. Expected: `anon` is refused by `crm_agent_lead_status_for_me` through `/rest/v1/rpc`, and `AGT-14-CRM` has the new name and role.

- [ ] **Step 2: Deploy the functions**

Following the Bruno README: `support-agent`, `bd-agent`, `ceo-agent` with their router mode, then `crm-agent` and `router-agent`, all with JWT verification on. Expected: a call without a login gets 401, and the existing CEO tab, BD panel and Support chat still answer, because requests without `router: true` behave as before.

- [ ] **Step 3: The user grants access**

The user switches agents on in Settings > Agents, ticks people and gives them credit, with admins included.

- [ ] **Step 4: Live test**

Run a local build, signed in by the user, because Claude does not enter real passwords. With an admin and a non-admin login, try a permitted lead, a lead outside their access, a question with no number, and each other agent, including a question it cannot answer. Expected: per the spec's Success list, with lookups appearing in the tab's usage table. Record which agent answers a lead question when the BD Agent is also available, and report it to the user.

- [ ] **Step 5: Release the screens**

This removes the Email Agent tab and the Support chat from Hot Alerts. Push `router-agent` to `main`, copy `Main Module/.env` from `D:\Abhijith Projects\CRM-optimize\Main Module` if absent, and run `npm run deploy:cloudflare` in `Main Module`. Expected: `abcrm` and `crm-abcapital` serve the new build. The user confirms Bruno on the live site.
