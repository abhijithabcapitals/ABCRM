# Claude Subscription tab: design

Date: 2026-11-04. Status: awaiting review. Branch: `crm-agent-mcp`.

## Goal

Admins manage the Claude connection from CRM Settings, without PowerShell, and see the Claude plan and how much the
CRM Agent is used. The account is on a Pro, Max or Ultra plan.

Success means an admin can:

1. Generate a new MCP token in the CRM and connect Claude using only the tab's steps.
2. See whether a token is set, when it last changed and when the last tool call happened.
3. See the plan they entered and reach Claude's own usage page in one click.
4. See real CRM Agent tool calls per day for the last 30 days.

## Limits

- No public API was found for a Pro, Max or Ultra account's plan or remaining limits. The tab does not show those
  numbers and does not estimate them. The plan is typed in by an admin and labelled as entered manually.
- The connector can only be added inside Claude. The CRM gives steps and copy buttons, and cannot do it for the user.
- Usage counts cover CRM Agent tool calls only, not overall Claude usage.
- Each new token requires updating the connector in Claude, because the old token stops working at once.

## Decision: store a hash of the MCP token in the database

The browser creates the token and sends only its SHA-256 hash. The Worker checks incoming tokens against that hash, so
the CRM needs no Cloudflare access. The alternative, storing a Cloudflare API key so the CRM can set the Worker secret,
was rejected: it puts a powerful credential in the CRM for the sake of one button.

## Database

One new migration in `Database Module/Admin Base/migrations`. It takes the next free number, checked against open
branches when it is built, because other branches also add migrations there.

### `public.crm_agent_access` (existing single-row table, new columns)

| Column | Type | Purpose |
|---|---|---|
| `mcp_token_sha256` | text, nullable, 64 hex characters | Hash of the MCP token. Null until first generated in the CRM |
| `mcp_token_changed_at` | timestamptz, nullable | Shown on the tab |
| `plan` | text, nullable, one of `Pro`, `Max`, `Ultra` | Entered by an admin |
| `plan_renews_on` | date, nullable | Optional, entered by an admin |
| `plan_updated_at` | timestamptz, nullable | Shown beside the plan |

The audit trail already hides these token columns, because `audit_trail_clean` hides column names containing `token`.

### `public.crm_agent_tool_calls` (new table)

Columns: `id` (bigint identity), `at` (timestamptz, default now), `tool` (text), `ok` (boolean), `error_code` (text,
nullable), `duration_ms` (integer).

- No lead numbers, tool inputs or results are stored.
- RLS is on with no policies, and all access from `anon` and `authenticated` is revoked. Only the functions below use it.
- Rows older than 90 days are deleted by `crm_agent_log_call` when it runs.
- The table is added to the exclusion list in `audit_trail_attach_all`, like `ai_usage`, so the log is not logged again.

### Functions

All are `security definer` with a fixed `search_path`.

| Function | Callable by | Behaviour |
|---|---|---|
| `crm_agent_check_mcp_token(p_token)` | `anon` | Returns `valid`, `invalid` or `unset`. `unset` means no hash is stored yet |
| `crm_agent_log_call(p_read_token, p_tool, p_ok, p_error_code, p_duration_ms)` | `anon` | Requires a valid read token and a known tool name. Inserts one row and deletes rows older than 90 days |
| `crm_agent_admin_overview()` | `authenticated`, requires `admin_is()` | Returns plan fields, whether a token is set, `mcp_token_changed_at`, last call time, and daily counts per tool with failures for 30 days. Never returns a hash |
| `crm_agent_set_mcp_token_hash(p_hash)` | `authenticated`, requires `admin_is()` | Validates the hash format, stores it, sets the time and writes to `admin_audit`. The hash is not written to the audit record |
| `crm_agent_set_plan(p_plan, p_renews_on)` | `authenticated`, requires `admin_is()` | Validates, stores and writes to `admin_audit` |

## Worker (`src/index.ts`)

### Authentication

For each `/mcp` request:

1. A request with no bearer token gets 401, with no database call.
2. Otherwise the Worker calls `crm_agent_check_mcp_token`.
3. `valid` proceeds. `invalid` gets 401.
4. `unset` falls back to comparing against the existing `MCP_AUTH_TOKEN` secret, so the current connector keeps working
   until the first token is generated in the CRM.
5. If the database cannot be reached, the Worker answers 503. It does not fall back to the secret, because that could
   revive a replaced token during an outage.

After the first CRM-generated token works, the `MCP_AUTH_TOKEN` secret is deleted. That deletion is a separate live
step.

### Usage logging

Each tool call records tool name, result, error code and duration through `crm_agent_log_call`, using `ctx.waitUntil`.
A logging failure is written to the Worker log only and never changes the tool result. The two placeholder tools are
logged too, as failures with `not_implemented`.

## Screen

New file `Agent Module/14_CRM_Agent/components/ClaudeSubscriptionPanel.jsx`, exported from `index.js`. It replaces
`ClaudeConnectionPanel`, which is deleted.

In `Main Module/src/components/Settings.jsx`, add the tab `{ key: "claude-subscription", label: "✴️ Claude Subscription" }`
with the same admin gating as Agents, and remove the old card from the Agents tab.

Sections, top to bottom:

1. **Plan.** Dropdown for Pro, Max or Ultra, optional renewal date and a Save button. Labelled "Entered manually. Claude
   does not share plan or limits with the CRM." Includes a link to Claude's usage page. The address is confirmed during
   the build.
2. **Connection.** Token set or not set, when it was last changed and the last tool call time. If no call has been made,
   it says so. This is not a live check, so an outage shows only as no recent calls.
3. **Token.** A **Generate new token** button, with a confirmation that the old token stops working at once and Claude
   must be updated.
4. **Connect steps.** The numbered connector steps, with copy buttons for the URL and header name.
5. **CRM Agent usage.** Table of calls per day per tool for 30 days, with failures. Empty state: "No tool calls yet."
   Labelled "CRM Agent tool calls only. This is not your total Claude usage."

### Token flow

1. The browser creates 32 random bytes with `crypto.getRandomValues` and encodes them as hex.
2. It hashes the token with `crypto.subtle.digest` and calls `crm_agent_set_mcp_token_hash` with the hash only.
3. Only after that succeeds, it shows the token once, with a copy button that copies `Bearer <token>`.
4. The token lives only in component state. It is cleared when the admin leaves the tab, and it cannot be shown again.

If saving fails, the token is discarded, an error is shown and the old token keeps working.

## Errors

| Situation | Result |
|---|---|
| Overview fails to load | The section shows an error with a retry. The rest of the Settings page is unaffected |
| Non-admin calls an admin function | The function refuses. The tab is also hidden |
| Clipboard copy fails | The value stays selectable on screen, with a message to copy by hand |
| Database unreachable from the Worker | `/mcp` answers 503 |
| Logging fails | Tool result unchanged, Worker log entry only |

## Testing

- **SQL tests**, following `Database Module/migrations/bd/tests`:
  - Each `crm_agent_check_mcp_token` result.
  - Non-admins refused by all three admin functions.
  - Bad hash, plan and tool values refused.
  - `anon` and `authenticated` cannot read either table directly.
  - 90-day deletion.
  - No hash in `crm_agent_admin_overview`.
- **Worker tests**, against a mock database under `wrangler dev`:
  - All authentication branches, including the secret fallback only on `unset`, and 503 with no fallback.
  - A failed log call does not change a tool result.
- **Screen check** in the browser preview:
  - Token flow, including failed saves.
  - Plan save.
  - Empty and filled usage table.
  - Tab hidden for a non-admin.
- **Live check**, after release: generate a token in the CRM, update the connector, read a lead through it, and confirm
  the call appears on the tab and the old token gets 401.

## Release order

Each live step needs approval.

1. Apply the migration. The Worker and the live CRM are unaffected, because `crm_agent_access` only gains columns.
2. Deploy the Worker. The hash is still unset, so the current connector keeps working through the secret.
3. Merge `crm-agent-mcp` to main, bringing it up to date with main first, and run `npm run deploy:cloudflare`.
4. Generate the first token in the CRM, update the connector and run the live check.
5. Delete the `MCP_AUTH_TOKEN` secret from `crm-agent`.

Rollback: redeploy the previous Worker version `5ee226af`. It uses only the secret, so step 5 must not have happened,
and the connector must hold the secret's token.

## Out of scope

- Claude's own limits or overall usage.
- Non-admin access to the tab.
- Live Worker health checks.
- Real handlers for `update_crm_lead` and `trigger_agent_workflow`.
- Removing `/api/mcp` from the CEO Worker, which stays a separate open step.
