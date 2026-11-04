# Claude Subscription Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-only Settings tab where admins generate the MCP token, follow the connector steps, record the Claude plan and see CRM Agent tool usage.

**Architecture:** The browser creates the token and stores only its hash through an admin database function. The `crm-agent` Worker checks incoming tokens against that hash and logs each tool call through a token-gated function. The tab reads everything through one admin overview function.

**Tech Stack:** Postgres 18 (local test cluster), Supabase RPC, Cloudflare Worker with `@modelcontextprotocol/sdk`, React with Vite, `node:test`.

**Spec:** `Agent Module/14_CRM_Agent/docs/2026-11-04-claude-subscription-tab-design.md`

Work in worktree `D:\Abhijith Projects\CRM-agent-mcp`, branch `crm-agent-mcp`. On this laptop use `npx.cmd`, because PowerShell blocks `npx.ps1`.

## Global Constraints

- Plans allowed: `Pro`, `Max`, `Ultra`. Label: "Entered manually. Claude does not share plan or limits with the CRM."
- Usage label: "CRM Agent tool calls only. This is not your total Claude usage." Empty state: "No tool calls yet."
- Usage window on the tab: 30 days. Log retention: 90 days.
- The log stores no lead numbers, tool inputs or results.
- A token or hash is never printed, logged, written to `admin_audit` or returned by an overview.
- Token: 32 random bytes as 64 hex characters. Copy value: `Bearer <token>`.
- Tab definition: `{ key: "claude-subscription", label: "✴️ Claude Subscription" }`, admin only.
- Nothing live happens outside Task 4, and each live step in Task 4 needs the user's approval.

## Review Focus

- Calls late in the UTC day: a call at 21:00 UTC belongs to the next Asia/Dubai day in the usage table.
- Two admins generate tokens close together: the last hash wins, the earlier token is refused, and both changes are audited.
- Double-clicking **Generate new token**: only one token is created and saved.
- Leaving the tab before copying: the token is gone for good, and the tab says a new one must be generated.
- Clearing the plan: an admin can return to no plan, and a renewal date with no plan is refused.

---

### Task 1: Database migration

**Files:**
- Create: `Database Module/Admin Base/migrations/011_crm_agent_subscription.sql`
- Create: `Database Module/Admin Base/migrations/rollback/011_crm_agent_subscription_rollback.sql`
- Create: `Database Module/Admin Base/tests/050_crm_agent_test.sql`
- Modify: `Database Module/Admin Base/tests/000_stub.sql`
- Modify: `Database Module/Admin Base/tests/run-local.sh`

Number 011 is deliberate. Main has `009_zoho_finance.sql` and branch `profile-menu` still has `009_profile_menu.sql`, which must move to 010. Before committing, re-run the number check across branches and take a later number if 011 is used.

**Interfaces:**
- Consumes: `public.crm_agent_access` (`read_token_sha256`, one row, from `Database Module/migrations/bd/011_bd_crm_agent_lead_status.sql`), `public.admin_is()`, `public.admin_audit`, `public.audit_trail_attach_all()`.
- Produces:
  - `crm_agent_check_mcp_token(p_token text) returns text`: `valid`, `invalid` or `unset`. Granted to `anon`.
  - `crm_agent_log_call(p_read_token text, p_tool text, p_ok boolean, p_error_code text, p_duration_ms integer) returns void`. Granted to `anon`.
  - `crm_agent_admin_overview() returns jsonb`: `{ plan, plan_renews_on, plan_updated_at, token_set, mcp_token_changed_at, last_call_at, daily: [{ day, tool, calls, failures }] }`. Granted to `authenticated`.
  - `crm_agent_set_mcp_token_hash(p_hash text) returns timestamptz`. Granted to `authenticated`.
  - `crm_agent_set_plan(p_plan text, p_renews_on date) returns void`. Granted to `authenticated`.

- [ ] **Step 1: Add the stub and runner lines**

In `000_stub.sql`, add `public.crm_agent_access (id boolean primary key default true check (id), read_token_sha256 text not null, updated_at timestamptz not null default now())`, with RLS on and access revoked, as the bd migration creates it. In `run-local.sh`, add 011 to the twice-applied migration list after 005, add `050_crm_agent_test.sql` to the test list, then run the rollback twice and reapply 011, following the existing 005 lines.

- [ ] **Step 2: Write the failing tests in `050_crm_agent_test.sql`**

Use the `t.ok` and `t.fails` helpers from `010_triggers_test.sql`, recreated here because each file creates its own. Switch identity with `set local role` and `set test.uid`. Use real SHA-256 values with `encode(sha256(convert_to(x, 'UTF8')), 'hex')`.

| Check | Expected |
|---|---|
| `check_mcp_token('x')` before any hash | `unset` |
| same, with an empty `crm_agent_access` table | `unset` |
| after setting a hash: right token / wrong token / null | `valid` / `invalid` / `invalid` |
| admin sets hash A then hash B | token A `invalid`, token B `valid`, two `admin_audit` rows |
| `admin_audit.detail` for those rows | contains neither hash |
| `set_mcp_token_hash` with uppercase, short or non-hex value | fails with `invalid token hash` |
| `set_mcp_token_hash` with no access row | fails with `read token is not set` |
| member (non-admin) or anon calls each of the 3 admin functions | fails with `admin only` or permission denied |
| `set_plan('Max', '2027-01-01')`, then overview | plan `Max`, renewal date set, `plan_updated_at` set |
| `set_plan('Free', null)` | fails with `invalid plan` |
| `set_plan(null, '2027-01-01')` | fails with `renewal date needs a plan` |
| `set_plan(null, null)` after a plan was set | plan and renewal date cleared |
| `log_call` with right read token and known tool | one row |
| `log_call` with wrong read token | no row, no error raised |
| `log_call` with unknown tool name | no row, no error raised |
| `log_call` with `p_error_code` of 500 characters | stored at 80 characters |
| row dated 91 days ago, then a `log_call` | old row deleted |
| row dated 89 days ago, then a `log_call` | row kept |
| rows at `2026-11-03 21:00+00` | appear under day `2026-11-04` in overview `daily` |
| row dated 31 days ago | absent from `daily` |
| `failures` in `daily` | counts rows where `ok` is false |
| `last_call_at` | newest row, including failed calls |
| overview text | contains no 64-character hex value |
| overview `token_set` | false before a hash, true after |
| `select` on either table as `anon` and `authenticated` | permission denied |
| `audit_trail_attach_all()`, then triggers on `crm_agent_tool_calls` | none |

- [ ] **Step 3: Run tests to verify they fail**

Run: `bash "Database Module/Admin Base/tests/run-local.sh"`
Expected: `FAILED` for the missing 011 file.

- [ ] **Step 4: Write the migration**

Wrap it in `begin; ... commit;`, and make it idempotent with `add column if not exists`, `create table if not exists` and `create or replace`.

- Columns on `crm_agent_access` per the spec, with `plan` checked against the three plans and `mcp_token_sha256` checked against `^[0-9a-f]{64}$`.
- Table `crm_agent_tool_calls` per the spec, index on `at`, RLS on, revoke all from `public, anon, authenticated`.
- `create or replace` `audit_trail_attach_all` from `003_audit_trail.sql`, unchanged except for `('public', 'crm_agent_tool_calls')` in the exclusion list. This must run in the same transaction as the table, because an hourly cron job attaches triggers to new tables.
- All functions `security definer set search_path = public, pg_temp`. Revoke from `public`, then grant as listed in Interfaces. Each admin function starts with `if not admin_is() then raise exception 'admin only'; end if;`.
- `check_mcp_token`: compare the SHA-256 of `p_token`, as `crm_agent_lead_status` does. No row or a null `mcp_token_sha256` gives `unset`.
- `log_call`: return silently on a bad read token or a tool outside `get_crm_lead_status`, `update_crm_lead`, `trigger_agent_workflow`. Truncate `p_error_code` to 80 characters. Delete rows where `at < now() - interval '90 days'`.
- `set_mcp_token_hash`: update the row and raise `read token is not set` when no row was updated. Audit action `set_mcp_token`, detail null.
- `set_plan`: audit action `set_claude_plan`, detail `{ plan, renews_on }`.
- `daily`: group on `(at at time zone 'Asia/Dubai')::date`, for days within 30 days.

The rollback drops the functions and `crm_agent_tool_calls` and removes the new columns. `audit_trail_attach_all` keeps its extra exclusion, which does no harm.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bash "Database Module/Admin Base/tests/run-local.sh"`
Expected: `ok` lines for every check, including `migrations pass 2 ok`, with no `FAILED` and existing tests still passing.

- [ ] **Step 6: Commit**

```bash
git add "Database Module/Admin Base" "Agent Module/14_CRM_Agent/docs"
git commit -m "Add the Claude Subscription tables and functions"
```

### Task 2: Worker authentication and usage logging

**Files:**
- Modify: `Agent Module/14_CRM_Agent/src/index.ts`
- Modify: `Agent Module/14_CRM_Agent/package.json` (add `"test": "node --test tests/"`)
- Modify: `Agent Module/14_CRM_Agent/README.md`
- Create: `Agent Module/14_CRM_Agent/tests/worker.test.mjs`

**Interfaces:**
- Consumes: `crm_agent_check_mcp_token` and `crm_agent_log_call` from Task 1, called as `POST {SUPABASE_URL}/rest/v1/rpc/<name>` with the `apikey` header only, like `getLeadStatus`.
- Produces: `/mcp` answers per the table below. No later task calls new Worker routes.

- [ ] **Step 1: Write the failing tests**

`worker.test.mjs` starts a mock Supabase HTTP server on port 8799 and `npx.cmd --no-install wrangler dev --port 8798 --local`, with `--var` for `MCP_AUTH_TOKEN`, `CRM_READ_TOKEN` and `SUPABASE_URL`. The mock's reply is switchable per test and it records each request. Stop both in `after`, using `taskkill /T /F` for wrangler.

| Test | Mock state | Request | Expected |
|---|---|---|---|
| `no bearer skips the database` | any | no header | 401, zero mock requests |
| `valid hash token passes` | check returns `valid` | any token, `initialize` | 200 |
| `invalid token refused` | `invalid` | any token | 401 |
| `invalid never uses the secret` | `invalid` | the secret's value | 401 |
| `unset falls back to the secret` | `unset` | the secret's value | 200 |
| `unset refuses other tokens` | `unset` | other token | 401 |
| `database down gives 503 with no fallback` | check returns 500 | the secret's value | 503 |
| `check timeout gives 503` | check never answers | the secret's value | 503, within 11 seconds |
| `tool call is logged` | `valid` | `tools/call get_crm_lead_status` | one `crm_agent_log_call` request with `p_ok: true`, `p_read_token` as the read token, numeric `p_duration_ms` |
| `log holds no inputs` | `valid` | same call with `lead_id` `LD-2026-000002` | logged body does not contain `LD-2026-000002` |
| `failed lead read is logged as failure` | lead RPC returns `not_found` | same | `p_ok: false`, `p_error_code: "not_found"` |
| `placeholder is logged as failure` | `valid` | `update_crm_lead` | `p_ok: false`, `p_error_code: "not_implemented"` |
| `log failure does not change the result` | log RPC returns 500 | `get_crm_lead_status` | same tool result as when logging works |
| `unknown path still 404` | any | `/other` | 404 |

Poll the mock for the log request for up to 3 seconds, because logging runs after the response.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test` in `Agent Module/14_CRM_Agent`
Expected: failures, because `no bearer skips the database` holds but the hash and logging tests do not.

- [ ] **Step 3: Implement in `src/index.ts`**

- `checkMcpToken(env: Env, token: string): Promise<"valid" | "invalid" | "unset" | "unreachable">`. Uses `CRM_READ_TIMEOUT_MS`, and any failure or unexpected value gives `unreachable`.
- Change the auth section of `fetch` to the spec's five steps. Extract the bearer value with the existing regex. Keep `hasValidBearerToken` for the secret comparison. When the check gives `unset` and no valid secret exists, answer 503 with the existing not-configured message.
- `logToolCall(env: Env, ctx: ExecutionContext, tool: string, startedAt: number, result: { isError?: boolean; content: { text: string }[] }): void`. Reads the error code from the JSON text, sends through `ctx.waitUntil`, catches everything and logs only `"Usage log failed"` with the status or error name.
- Wrap the three tool handlers through one helper, `logged(tool, handler)`, inside `createMcpServer(env, ctx)`.
- `fetch(request, env, ctx)` passes `ctx` through.
- Update the file header comment, and the README's MCP endpoint and Deploy sections. `MCP_AUTH_TOKEN` is now only the fallback until a token is generated in Settings.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test`, then `npm run typecheck`
Expected: all tests pass, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add "Agent Module/14_CRM_Agent/src" "Agent Module/14_CRM_Agent/tests" "Agent Module/14_CRM_Agent/package.json" "Agent Module/14_CRM_Agent/README.md"
git commit -m "Check the MCP token against the database and log tool calls"
```

### Task 3: Settings tab

**Files:**
- Create: `Agent Module/14_CRM_Agent/components/mcpToken.js`
- Create: `Agent Module/14_CRM_Agent/components/ClaudeSubscriptionPanel.jsx`
- Create: `Agent Module/14_CRM_Agent/tests/mcpToken.test.mjs`
- Delete: `Agent Module/14_CRM_Agent/components/ClaudeConnectionPanel.jsx`
- Modify: `Agent Module/14_CRM_Agent/index.js`
- Modify: `Agent Module/14_CRM_Agent/README.md` (path table)
- Modify: `Main Module/src/components/Settings.jsx:6,240-253,516-521`

**Interfaces:**
- Consumes: `crm_agent_admin_overview`, `crm_agent_set_mcp_token_hash`, `crm_agent_set_plan` from Task 1; `Panel`, `Button`, `ErrorNote`, `Spinner`, `DataTable`, `Badge`, `fmtDate`, `useLoad` from `@banking/components/shared`.
- Produces: `createMcpToken(): Promise<{ token: string, hash: string, headerValue: string }>` in `mcpToken.js`; `export default function ClaudeSubscriptionPanel({ supabase })`.

- [ ] **Step 1: Write the failing test `mcpToken.test.mjs`**

- `token is 64 lowercase hex`: `token` matches `^[0-9a-f]{64}$`.
- `hash is the SHA-256 of the token`: equal to `createHash("sha256").update(token).digest("hex")` from `node:crypto`.
- `header value`: `headerValue === "Bearer " + token`.
- `tokens differ`: two calls give different tokens.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` in `Agent Module/14_CRM_Agent`
Expected: FAIL, module not found. `worker.test.mjs` still passes.

- [ ] **Step 3: Implement `createMcpToken` with `crypto.getRandomValues` and `crypto.subtle.digest`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Confirm the usage page address**

Check Claude's help articles for the usage page address. Use `https://claude.ai/settings/usage` if confirmed, otherwise `https://claude.ai/settings`.

- [ ] **Step 6: Build `ClaudeSubscriptionPanel.jsx`**

Import `@banking/components/banking.css`. Sections in spec order: Plan, Connection, Token, Connect steps, CRM Agent usage. Fixed values:

- Endpoint: `https://crm-agent.ceo-intelligence-agent.workers.dev/mcp`, header name `Authorization`.
- Steps text:
  1. Generate a new token below and copy it.
  2. In Claude, open Customize > Connectors, click + Add, then Add custom connector.
  3. Name it `CRM Agent`, enter the URL and click Continue.
  4. Set Authentication to No sign in.
  5. Under Request headers, enter `Authorization` as the name and paste the copied value.
  6. Save and click Reconnect. If the connector already exists, replace its header value.
- Confirmation before generating: "Generate a new token? The current token stops working at once, and Claude cannot reach the CRM until you update its connector."
- Token shown once, with: "Shown once. If you leave this tab before copying it, generate a new one."
- Connection line when no call exists: "No tool calls yet."
- Usage table columns: Day, Tool, Calls, Failures. Row id `${day}-${tool}`, newest day first.

Behaviour:

- Hold the token in component state only, so it is cleared on unmount.
- Set a busy flag and `Button busy` before creating the token, and return early when busy, so a double-click creates one token.
- Show the token only after the hash saves. On failure show `ErrorNote` and discard it. On success reload the overview.
- Copy falls back to a message that says to select and copy by hand, with the value still on screen.
- A load failure shows `ErrorNote` with a retry from `useLoad`, inside the tab only.

- [ ] **Step 7: Wire it into Settings**

In `index.js`, export `ClaudeSubscriptionPanel` in place of `ClaudeConnectionPanel`. In `Settings.jsx`, swap the import, add the tab after Agents, add `{activeTab === "claude-subscription" && profile?.role === "admin" && <ClaudeSubscriptionPanel supabase={supabase} />}`, and remove the old card from the Agents block. Grep the repo for `ClaudeConnectionPanel` afterwards and expect no hits.

- [ ] **Step 8: Build and lint**

Run: `npm run build` and `npx.cmd eslint "../Agent Module/14_CRM_Agent/components"` in `Main Module`
Expected: build succeeds with no new lint errors.

- [ ] **Step 9: Check the screen with a throwaway harness**

Mount the panel on a temporary Vite page, with a fake `supabase.rpc`. Keep the harness uncommitted and delete it afterwards. Use the preview browser with no sign-in. Confirm:

- Empty state: no plan, no token, "No tool calls yet."
- Filled state with `daily` rows.
- Plan save, including clearing it.
- Generate with a failing save: no token shown, error shown.
- Generate with a working save: token shown once, Copy gives `Bearer <token>`, and only the hash reached `rpc`.
- Double-click makes one `rpc` call.
- Leaving the tab and returning shows no token.
- Phone width has no sideways scroll.

Hiding the tab from a non-admin, and real data, are checked in Task 4.

- [ ] **Step 10: Commit**

```bash
git add "Agent Module/14_CRM_Agent" "Main Module/src/components/Settings.jsx"
git commit -m "Add the Claude Subscription tab to Settings"
```

### Task 4: Release

Each step is live and needs the user's approval first. Stop and report if a check fails.

Already done before Step 1: `origin/main` merged into `crm-agent-mcp`, with `npm test`, the build and `run-local.sh` re-run.

- [ ] **Step 1: Apply the migration**

First compare the live `audit_trail_attach_all` with the repo (it must exclude `zoho_finance_snapshot` and `crm_agent_tool_calls`). Then apply 011 to `pnnakrhfzyxudjaghoxx` as `admin_011_crm_agent_subscription`. Expected: `crm_agent_check_mcp_token` gives `unset` when called through `/rest/v1/rpc` (not SQL), and the current connector still reads `LD-2026-000002`.

- [ ] **Step 2: Deploy the Worker**

Run: `npm run deploy` in `Agent Module/14_CRM_Agent`, after committing. Expected: the connector still reads the lead, using the secret fallback, and a row appears in `crm_agent_tool_calls`.

- [ ] **Step 3: Merge and release the CRM**

Merge to main, push, then run `npm run deploy:cloudflare` in `Main Module`. Expected: the tab appears for an admin and is hidden for a non-admin. The user signs in for this check, because Claude does not enter real passwords.

- [ ] **Step 4: Switch to a CRM-generated token**

The user generates a token on the tab and updates the connector. Expected: the lead read works, the call appears on the tab, the old token gets 401, and `admin_audit` shows `set_mcp_token` with no hash.

- [ ] **Step 5: Delete the old secret**

Run: `npx.cmd wrangler secret delete MCP_AUTH_TOKEN` in `Agent Module/14_CRM_Agent`. This cannot be undone without setting a new secret, and rollback to `5ee226af` then needs one. Expected: the connector still reads the lead.
