# Notification Centre Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the alert core, licence and visa expiry rules, overdue rules on existing due dates, client owners, the Manager tag lookup, escalation, the three views, tiles, the bell link and the Coverage panel, starting silently in Preview mode.

**Architecture:** One `alerts` row per matter, written only by database functions. A daily `pg_cron` scan runs one read-only function per rule and upserts by `dedupe_key`. The page lives in `Hot Alerts Module` and reads through RPCs. The bell is only a delivery path, through `public.notifications`.

**Tech Stack:** Postgres on Supabase (PL/pgSQL, RLS, `pg_cron`), React through the Main Module's Vite build, `node --test`, throwaway Postgres through `tests/run-local.sh`.

**Spec:** `Hot Alerts Module/docs/2026-11-05-notification-centre-design.md`, approved 2026-11-05 with defaults D1 to D12. Sections cited as "spec §N".

## Global Constraints

- Work in a new worktree `D:\Abhijith Projects\CRM-notify`, branch `notification-centre`, cut from `origin/main`. Local `main` can lag.
- Do not edit any `Business Setup Module` or `Database Module/Business Setup Base` file. That session owns them, and Phase 1 needs nothing from them.
- Do not touch live until Task 9, and there only with the user's approval for each step.
- Never send anything to a client. Testing on live uses only TEST client `CL000001`.
- Every migration is re-runnable, with a rollback tested twice.
- No browser writes to any new table. All writes go through `SECURITY DEFINER` functions with `set search_path = public, pg_temp`. Revoke everything on new tables from `anon` and `authenticated`, then grant only `select` where stated. Revoke `execute` on each function from `public` and `anon`.
- "Today" is always `(now() at time zone 'Asia/Dubai')::date`.
- Stored priority is exactly `Critical`, `High`, `Medium`, `Normal`. `Urgent` is a display tag and is never stored.
- Colours: Critical red, High orange, Medium yellow, Normal blue.
- Alerts never hold passport or Emirates ID numbers.
- `Hot Alerts Module` imports only `react`. Everything else arrives as a prop.
- Deferred to later phases, do not build here: email, `alert_deliveries`, `alert_preferences`, `client_compliance_items`, calendar view, regulatory tables, checkpoint rules, renewal-not-initiated, tax rules.
- Each release deploys to `abcrm` and `crm-abcapital.pages.dev`, as `main` only updates GitHub Pages.

## Review Focus

1. A scan misses several days, so a licence jumps across steps: one row, the highest step reached, one bell item.
2. A manager corrects a past licence date during triage: the old backlog alert closes with "Date changed", and a new alert appears only if the new date is inside a step.
3. A date in `client_master` cannot be parsed, or a visa has no matching Business Setup profile: counts as missing data or an open client, never a scan failure.
4. An assigned employee's profile is deleted: the alert returns to Unassigned rather than vanishing or failing.
5. "Run now" is pressed during the cron run: no duplicate rows and no double bell.

Line 4 has its test in Task 1, and the others in Task 3.

---

## File Structure

| Path | Responsibility |
|---|---|
| `Database Module/Notification Base/migrations/001_alert_core.sql` | Tables, settings, RLS, people and visibility functions, `alert_raise` |
| `.../002_alert_scan.sql` | Step function, rule seed, rule functions, `alert_scan`, cron |
| `.../003_alert_actions.sql` | Assign, resolve, escalate, read, owners, settings RPCs |
| `.../004_alert_reads.sql` | List, tiles, detail, management summary, coverage RPCs |
| `.../rollback/001_004_rollback.sql` | Removes all of the above, including the cron job and `alert_centre` bell rows |
| `Database Module/Notification Base/tests/` | `000_stub.sql`, `010_core_test.sql`, `020_scan_test.sql`, `030_actions_test.sql`, `040_reads_test.sql`, `run-local.sh` |
| `Database Module/Notification Base/README.md` | Run order, modes, how to test |
| `Hot Alerts Module/logic/alertLogic.js` | Tags, filters, labels. Pure |
| `Hot Alerts Module/services/alertsApi.js` | One wrapper per RPC, taking `supabase` |
| `Hot Alerts Module/components/NotificationCentre.jsx` | Page and view tabs |
| `Hot Alerts Module/components/AlertList.jsx`, `AlertDrawer.jsx`, `Tiles.jsx` | Shared list, detail with actions, tile row |
| `Hot Alerts Module/components/DepartmentView.jsx`, `ManagementView.jsx`, `OwnerAssign.jsx`, `CentreSettings.jsx` | One screen each |
| `Hot Alerts Module/tests/logic.test.mjs` | Pure logic tests |

## Task 1: Worktree and alert core

**Files:**
- Create: `migrations/001_alert_core.sql`, `tests/000_stub.sql`, `tests/010_core_test.sql`, `tests/run-local.sh`, `rollback/001_004_rollback.sql`, `README.md`, all under `Database Module/Notification Base`.

**Interfaces:**
- Produces tables:
  - `alert_settings(key text pk, value jsonb)`, seeded `alert_mode = "Preview"`. Reapply keeps a changed value.
  - `alert_rules(code text pk, category, department, title_template, action_template, steps jsonb, enabled boolean, source_note)`.
  - `alerts`, with the columns in spec §9 except `compliance_item_id` and `regulatory_update_id`, which later phases add. `assigned_to references profiles on delete set null`. `client_id` is nullable, since 99 accounting jobs have no client link. Also `subject text`, `escalation_level int default 0`, `current_step int`, `backlog boolean`, `fell_back boolean`, and a `unique(dedupe_key)` index across all statuses.
  - `alert_recipients(alert_id, user_id references profiles on delete cascade, reason, read_at, primary key(alert_id, user_id))`.
  - `alert_events(id, alert_id, event, detail, created_at, created_by)`, append-only.
  - `alert_scan_log(id, started_at, finished_at, status, rule_counts jsonb, error)`.
  - `client_owners`, per spec §6. `alert_number` comes from a sequence, formatted `ALT-000001`.
- Produces functions:
  - `alert_managers() returns table(user_id uuid, fell_back boolean)`: profiles with `banking_user_roles.role = 'MANAGER'`, or an `hr_employees` row with `status = 'Active'` and `designation ilike 'manager'`, the rule in `hub_is_admin()`. No match returns admins with `fell_back = true`.
  - `alert_is_manager() returns boolean`: `auth.uid()` is in that tag rule, with no fallback.
  - `alert_is_admin() returns boolean`.
  - `alert_can_see(p_id uuid) returns boolean`. True for admin. In Preview, false for everyone else. Otherwise true for a recipient or a tagged Manager.
  - `alert_owner(p_client text, p_department text) returns uuid`.
  - `alert_add_recipient(p_id uuid, p_user uuid, p_reason text) returns void`. Writes a bell row only when allowed: never in Preview, never for a `backlog` row, in Triage only for reason `Assigned`.
  - `alert_raise(p_rule text, p_key text, p_client text, p_subject text, p_department text, p_due date, p_step int, p_priority text, p_assigned uuid, p_source_table text, p_source_id text, p_service uuid default null, p_description text default null, p_extra uuid[] default null) returns uuid`.
- `alert_raise` behaviour:
  - No row: insert, `backlog = true` when mode is Preview. Event `raised`. Add recipients: assigned (reason `Assigned`), `p_extra` (reason `Assigned`). If unassigned, add `alert_managers()` (reason `Manager`).
  - Open row at same step: refresh subject and due date only. No bell.
  - Open row at a changed step: set step. Priority only rises, never falls. Set `backlog = false` if mode is not Preview. Event `step changed`. Bell the current recipients once.
  - Resolved or Dismissed by a person: return null, no change.
  - Resolved by System with `resolved_by is null`: reopen, event `reopened`.

- [ ] **Step 1: Create the worktree.** Run `git -C "D:/Abhijith Projects/CRM" worktree add "D:/Abhijith Projects/CRM-notify" -b notification-centre origin/main`. Move both docs from the main checkout's `Hot Alerts Module/docs/` into it, leaving no untracked copy behind.
- [ ] **Step 2: Write `000_stub.sql` and `run-local.sh`.** Copy the pattern of `Database Module/Admin Base/tests/`: port `55447`, migrations run twice, each test stops the run on failure, rollback run twice, then reapply. The stub declares `auth.uid()` from `test.uid`, `profiles`, `notifications` with the live columns (`id, user_id, task_id, type, title, body, link_scope, read, created_at`), `client_master`, `business_setup_kyc_profiles`, `business_setup_visas`, `business_setup_services`, `business_setup_tasks`, `banking_tasks`, `banking_user_roles`, `hr_employees`, `tasks`, `service_departments`, table `accounting_job_list`, `business_setup_parse_date` (copied from `008_workspace.sql:118`), and a `cron` schema whose `schedule` upserts by name.
- [ ] **Step 3: Write `010_core_test.sql`.** Assertions:

```sql
select t.ok('no tagged manager falls back to admins', (select bool_and(fell_back) and count(*) = 2 from alert_managers()));
select t.ok('both tag sources count, inactive HR manager excluded', ...);
select t.ok('preview raise is backlog', (select backlog from alerts where dedupe_key = 'k1'));
select t.ok('preview writes no bell', (select count(*) = 0 from notifications where type = 'alert_centre'));
select t.ok('second raise keeps one row', (select count(*) = 1 from alerts where dedupe_key = 'k1'));
select t.ok('priority never falls', (select priority = 'Critical' from alerts where dedupe_key = 'k2'));
select t.ok('step change clears backlog outside Preview', (select not backlog from alerts where dedupe_key = 'k3'));
select t.ok('step change bells once', (select count(*) = 1 from notifications where link_scope->>'alert_id' = :'k3_id'));
select t.ok('person-resolved stays resolved', alert_raise('r', 'k4', ...) is null);
select t.ok('system-resolved reopens', (select status = 'Open' from alerts where dedupe_key = 'k5'));
select t.ok('deleted owner returns to unassigned', (select assigned_to is null from alerts where dedupe_key = 'k6'));
select t.ok('member sees nothing in Preview', not alert_can_see(:'k1_id'));
select t.ok('untagged member sees only alerts where a recipient', ...);
select t.ok('tagged manager sees every department outside Preview', ...);
select t.fails('browser cannot insert', $q$insert into alerts (title) values ('x')$q$, 'permission denied');
```

- [ ] **Step 4: Run.** `bash "Database Module/Notification Base/tests/run-local.sh"`. Expected: fails with a missing `alerts` table.
- [ ] **Step 5: Write `001_alert_core.sql` and the matching rollback.** RLS on: `alerts` select through `alert_can_see(id)`; `client_owners` select for admin or tagged Manager. Others have no browser access. `notifications` is written directly from the definer function, with `type = 'alert_centre'`, `link_scope = {"alert_id": id}`, `task_id` null, `title`, and `body` holding the action.
- [ ] **Step 6: Run.** Expected: every line `ok`, migrations pass twice, rollback clean.
- [ ] **Step 7: Commit** migration, tests, README and both docs, message `Add notification centre core tables and raise function`.

## Task 2: Step function and rule seed

**Files:** Create `migrations/002_alert_scan.sql`, `tests/020_scan_test.sql`. Modify `tests/run-local.sh`.

**Interfaces:**
- Produces: `alert_step_for(p_steps jsonb, p_days_left int) returns table(step int, priority text)`. Steps sorted descending by `days`. Returns the last step where `p_days_left <= days`, or no row outside the largest.
- Produces seed in `alert_rules`, insert-only, so edited steps survive reapply:

| Code | Category | Department | Steps (days: priority) |
|---|---|---|---|
| `licence_expiry` | Licence | Business Setup | 90 Medium, 60 Medium, 30 High, -1 Critical |
| `visa_expiry` | Visa & Emirates ID | Business Setup | 90 Medium, 60 Medium, 30 High, 15 High, 7 High, -1 Critical |
| `job_due` | Deadlines | Accounting | 1 Medium, 0 High, -1 High, -3 Critical |
| `service_due` | Deadlines | Business Setup | 1 Medium, 0 High, -1 High, -3 Critical |
| `setup_task_due` | Deadlines | Business Setup | Same as above |
| `banking_task_due` | Deadlines | Business Banking | Same as above |
| `crm_task_due` | Deadlines | None (null, so unassigned items go to admins) | Same as above |

- Action text for `licence_expiry`: "Confirm the licence date, then start the renewal." For `visa_expiry`: "Confirm the visa date, then start the renewal or cancellation." For the rest: "Complete this item or update its due date."

- [ ] **Step 1: Write the failing tests:**

```sql
select t.ok('91 days is outside', (select count(*) = 0 from alert_step_for(:'lic', 91)));
select t.ok('90 is Medium', (select priority = 'Medium' from alert_step_for(:'lic', 90)));
select t.ok('30 is High', (select priority = 'High' from alert_step_for(:'lic', 30)));
select t.ok('0 is still High', (select priority = 'High' from alert_step_for(:'lic', 0)));
select t.ok('expired is Critical', (select priority = 'Critical' from alert_step_for(:'lic', -1)));
select t.ok('visa 7 is step 7', (select step = 7 from alert_step_for(:'visa', 5)));
select t.ok('due in 2 days is outside', (select count(*) = 0 from alert_step_for(:'task', 2)));
select t.ok('due tomorrow Medium', (select priority = 'Medium' from alert_step_for(:'task', 1)));
select t.ok('overdue 2 days High', (select priority = 'High' from alert_step_for(:'task', -2)));
select t.ok('overdue 3 days Critical', (select priority = 'Critical' from alert_step_for(:'task', -3)));
select t.ok('reapply keeps edited steps', ...);
```

- [ ] **Step 2: Run.** Expected: fails with missing function.
- [ ] **Step 3: Implement** `alert_step_for` and the seed in `002_alert_scan.sql`.
- [ ] **Step 4: Run.** Expected: all `ok`.
- [ ] **Step 5: Commit** `Add alert rule steps and seed`.

## Task 3: Rule functions and the scan

**Files:** Modify `migrations/002_alert_scan.sql`, `tests/020_scan_test.sql`.

**Interfaces:**
- Consumes: `alert_raise`, `alert_step_for`, `alert_owner`.
- Produces: composite type `alert_candidate(dedupe_key text, client_id text, subject text, department text, due_date date, assigned_to uuid, extra uuid[], source_table text, source_id text, service_id uuid, description text)`.
- Produces one read-only function per rule, each `returns setof alert_candidate`, returning every row checked. A null `due_date` means missing data, so it counts and raises nothing.

| Function | Source and rule |
|---|---|
| `alert_rule_licence_expiry()` | `business_setup_kyc_profiles` join `client_master`. Date is `coalesce(k.licence_expiry, business_setup_parse_date(m.data->>'License Expiry Date'))`. Skip `client_status` matching `liquidated\|cancel\|rejected`, case-insensitive. Key `licence:<client>:<date>` |
| `alert_rule_visa_expiry()` | `business_setup_visas` **left** join profile. Skip visa status matching `cancel\|resign`, and closed clients as above. Status exactly `X`, any case: still raised, description "Pending follow-up" (D9). Key `visa:<id>:<date>`. Subject holds person and client name |
| `alert_rule_job_due()` | `accounting_job_list`, `work_status` not `Completed` or `Client Cancelled`. Assignee first of `assignee_ids`, the rest in `extra`. Department `service_department`, default `Accounting`. Key `job:<id>:<due>` |
| `alert_rule_service_due()` | `business_setup_services` not `historical`, status not `Completed` or `Cancelled`, `name <> 'Visa Registration'`. Assignee `owner_id`. Key `service:<id>:<due>` |
| `alert_rule_setup_task_due()` | `business_setup_tasks`, status `Open` |
| `alert_rule_banking_task_due()` | `banking_tasks`, status `Open` or `In Progress` |
| `alert_rule_crm_task_due()` | `tasks`, `deleted_at is null`, status not `Done`, assignee `assignee_id` |

- Assignee when the rule gives none: `alert_owner(client, department)`.
- Produces `alert_scan() returns jsonb`. Only `postgres` and `service_role` can execute.
  1. `pg_try_advisory_xact_lock`. If not obtained, log status `Skipped` and return.
  2. For each enabled rule, in its own `begin ... exception` block: compute candidates, raise those inside a step, then close open alerts of that rule whose key was not raised as `Resolved`, `resolved_by` null, note "Date changed or no longer applies".
  3. On a rule error, record it in `rule_counts`, skip that rule's close, and continue.
  4. Write counts per rule: `checked`, `with_data`, `raised`, `closed`, `error`.
  5. Run `alert_escalate_due()` (Task 4) only if mode is `Live`.
  6. Status `Failed` if any rule errored, otherwise `Ok`.
- Schedule: `select cron.schedule('alert-scan', '0 2 * * *', 'select public.alert_scan()')`.

- [ ] **Step 1: Write the failing tests.** Insert fixtures dated relative to today, then:

```sql
select t.ok('licence at 30 days is High', (select priority = 'High' from alerts where rule_code = 'licence_expiry' and client_id = 'C30'));
select t.ok('master date used when profile date null', ...);
select t.ok('unparseable master date counts missing, scan Ok', (select status = 'Ok' and (rule_counts->'licence_expiry'->>'with_data')::int < (rule_counts->'licence_expiry'->>'checked')::int from alert_scan_log order by id desc limit 1));
select t.ok('liquidated client raises nothing', ...);
select t.ok('visa of liquidated client raises nothing', ...);
select t.ok('visa with no profile still raises', ...);
select t.ok('visa status X is raised as pending follow-up', (select description = 'Pending follow-up' from alerts where source_id = :'x_visa'));
select t.ok('cancelled visa raises nothing', ...);
select t.ok('imported Visa Registration service raises nothing', ...);
select t.ok('job due 2 days ago is High, 3 days Critical', ...);
select t.ok('re-scan same day: no new rows, no new bell', ...);
select t.ok('three missed steps: one row, top step, one bell', ...);
select t.ok('date moved: old closed with note, new cycle', ...);
select t.ok('date moved beyond 90: no new row', ...);
select t.ok('broken rule logged, other rules still ran, scan Failed', ...);
select t.ok('broken rule closes nothing', ...);
select t.ok('held lock: scan logs Skipped, adds nothing', ...);
```

- [ ] **Step 2: Run.** Expected: fails.
- [ ] **Step 3: Implement** the type, rule functions and scan. Test a broken rule through a stubbed setting read inside a rule, such as `test.break_rule`, only in the stub's overriding function, not in the migration.
- [ ] **Step 4: Run.** Expected: all `ok`.
- [ ] **Step 5: Commit** `Add alert rules and daily scan`.

## Task 4: Actions, escalation and owners

**Files:** Create `migrations/003_alert_actions.sql`, `tests/030_actions_test.sql`.

**Interfaces:**
- Produces, all raising one plain sentence on refusal:
  - `alert_assign(p_id uuid, p_user uuid) returns void`: tagged Manager or admin. Adds recipient, event.
  - `alert_set_status(p_id uuid, p_status text) returns void`: `Open` or `In progress`.
  - `alert_resolve(p_id uuid, p_note text default null, p_dismiss boolean default false) returns void`: assigned, tagged Manager or admin. Sets `resolved_by`. A Critical alert needs a note with text after trimming.
  - `alert_escalate(p_id uuid, p_reason text) returns void`: reason required. Level plus one, adds `alert_managers()`, fresh bell.
  - `alert_mark_read(p_id uuid) returns void`.
  - `alert_escalate_due() returns int`, skipping `backlog` rows, using today:
    - Due date passed, level 0: add `alert_managers()`, level 1.
    - 3 or more days overdue, level below 2: level 2, fresh bell to managers.
    - `licence_expiry` or `visa_expiry` at step -1, level 0: add `alert_managers()`, level 1.
    - Unassigned, no `Manager` recipient yet: add `alert_managers()`.
  - `client_owner_list() returns table(client_id text, legal_name text, client_status text, jurisdiction text, department text, owner_id uuid)`: tagged Manager or admin. Rows from `client_master` left join profile and owners.
  - `client_owner_proposals(p_department text) returns table(client_id text, owner_id uuid, basis text)`: reads only, saves nothing. For `Accounting`: most frequent `assignee_ids` per client, otherwise an exact `Accountant` text match to `profiles.full_name`.
  - `client_owners_set(p_department text, p_clients text[], p_owner uuid) returns int`: tagged Manager or admin. Also assigns open unassigned alerts for those clients in that department.
  - `alert_rule_save(p_code text, p_enabled boolean, p_steps jsonb) returns void`: admin only; refuses a step priority outside the four.
  - `alert_set_mode(p_mode text) returns void`: admin only; `Preview`, `Triage`, `Live`.
  - `alert_scan_now() returns jsonb`: admin only; calls `alert_scan`. This is the spec's "Run now", shown in the Centre's Settings tab. The Admin Base trigger catalogue is not edited, since that would mean copying its functions.

- [ ] **Step 1: Write the failing tests:**

```sql
select t.fails('member cannot assign', ..., 'You do not have');
select t.fails('critical needs a note', $q$select alert_resolve(:'crit', '   ')$q$, 'note');
select t.ok('resolved records person and date', ...);
select t.ok('overdue adds manager at level 1 in Live', ...);
select t.ok('3 days reaches level 2 with a fresh bell to managers, employee stays', ...);
select t.ok('critical expiry adds manager', ...);
select t.ok('unassigned goes to manager', ...);
select t.ok('backlog row never escalates', ...);
select t.ok('nothing escalates in Preview or Triage scan', ...);
select t.ok('no tagged manager falls back and records fell_back', ...);
select t.ok('owners set assigns open unassigned alerts only', ...);
select t.ok('proposals save nothing', ...);
select t.fails('untagged member cannot set owners', ..., 'You do not have');
select t.ok('tagged manager can reassign an owner in any department', ...);
select t.ok('client added after the seed has no owner, its alert is Unassigned and goes to the manager', ...);
select t.fails('bad step priority refused', ..., 'priority');
select t.fails('Urgent refused as a priority', ..., 'priority');
```

- [ ] **Step 2: Run.** Expected: fails.
- [ ] **Step 3: Implement** `003_alert_actions.sql`.
- [ ] **Step 4: Run.** Expected: all `ok`.
- [ ] **Step 5: Commit** `Add alert actions, escalation and owners`.

## Task 5: Read functions

**Files:** Create `migrations/004_alert_reads.sql`, `tests/040_reads_test.sql`.

**Interfaces:**
- Produces:
  - `alert_list(p_scope text, p_filter text default 'All', p_department text default null, p_limit int default 100, p_offset int default 0) returns jsonb`: `{rows, total}`. Scope `My` is `assigned_to = auth.uid()`. `Department` needs the Manager tag or admin. `Management` needs admin. Refuses otherwise. Each row has the spec §9 fields plus `client_name`, `assignee_name`, `read`. Sort: priority, then due date. `p_filter`:
    - `All`: all open.
    - `Urgent`: Critical, or High with due date before today.
    - `Due Today`.
    - `Client Pending`: category Client Documents.
    - `Government Pending`: category Government Applications.
    - `Backlog`: `backlog` true.
  - `alert_tiles(p_scope text, p_department text default null) returns jsonb`: `overdue`, `upcoming`, `documents`, `authority`, `renewals`, `unassigned`, `due_today`, `new_today`, `backlog`, per spec §5. `renewals` means open expiry rules at a step of 0 or more.
  - `alert_detail(p_id uuid) returns jsonb`: alert, recipients, events. Refused when `alert_can_see` is false.
  - `alert_management_summary() returns jsonb`: admin only. `critical`, `today`, `client_pending`, `government_pending`, `renewals`, `unassigned`, `delayed` (0 until Phase 3), `performance` (per person pending and resolved counts), `client_risk` (per client open Critical count).
  - `alert_coverage() returns jsonb`: admin only. Each rule's counts from the latest log, last scan time and status, and `stale: true` when there is no `Ok` scan in the last 26 hours.
  - `alert_my_access() returns jsonb`: `is_admin`, `is_manager`, `mode`.

- [ ] **Step 1: Write the failing tests:**

```sql
select t.ok('My shows only assigned', ...);
select t.fails('member refused Management', ..., 'You do not have');
select t.fails('untagged member refused Department scope', ..., 'You do not have');
select t.ok('Urgent holds Critical and overdue High only', ...);
select t.ok('Normal priority not Urgent', ...);
select t.ok('tiles equal list counts for each tile', ...);
select t.ok('resolved excluded from tiles', ...);
select t.ok('coverage reports missing data and stale scan', ...);
select t.ok('performance counts per person', ...);
select t.ok('member in Preview gets empty My list', ...);
```

- [ ] **Step 2: Run.** Expected: fails.
- [ ] **Step 3: Implement** `004_alert_reads.sql`, and extend the rollback for all four migrations.
- [ ] **Step 4: Run.** Expected: all `ok`, rollback clean twice, reapply clean.
- [ ] **Step 5: Commit** `Add alert list, tiles, summary and coverage reads`.

## Task 6: Page logic and My Notifications

**Files:**
- Create: `Hot Alerts Module/logic/alertLogic.js`, `services/alertsApi.js`, `components/NotificationCentre.jsx`, `AlertList.jsx`, `AlertDrawer.jsx`, `Tiles.jsx`, `tests/logic.test.mjs`.
- Modify: `Hot Alerts Module/index.js`, `README.md`, `Main Module/src/components/MyTasks.jsx`, `Sidebar.jsx`, `tabs.js`, `Notifications.jsx`, `App.jsx`, `Client Module/crm/ClientsHub.jsx`.

**Interfaces:**
- Produces in `alertLogic.js`:
  - `tagFor(alert, today) -> "Urgent" | "Action required" | "Upcoming" | null`
  - `daysLabel(dueDate, today) -> string`, such as "3 days overdue", "Due today", "12 days left", "No date"
  - `PRIORITY_STYLES` for the four colours
  - `FILTERS = ["All", "Urgent", "Due Today", "Client Pending", "Government Pending"]`
- `alertsApi.js` has one function per RPC from Tasks 4 and 5, each `(supabase, ...args)`, throwing on error.
- `NotificationCentre({ profile, supabase, fmtDate, openAlertId, onOpenClient })`. Tabs: My Notifications always; Department for tagged Managers and admins; Management and Settings for admins. Tab choice comes from `alert_my_access`, and the server still refuses on its own.
- `MyTasks.jsx` passes `openAlertId` and `onOpenClient`.
- `App.jsx` holds `openAlertId` and `openClientId` state. `Notifications.jsx` `clickItem` calls `onOpenAlert(n.link_scope.alert_id)` when present, through Sidebar. `ClientsHub` takes `openClientId` and opens that client's existing detail.
- Sidebar and tab label become "Notification Centre". Tab key stays `mytasks` (D11).

- [ ] **Step 1: Write failing tests in `tests/logic.test.mjs`:**

```js
test("Critical is Urgent", () => assert.equal(tagFor({ priority: "Critical", due_date: "2030-01-01" }, "2026-11-05"), "Urgent"));
test("High overdue is Urgent", () => assert.equal(tagFor({ priority: "High", due_date: "2026-11-01" }, "2026-11-05"), "Urgent"));
test("High due today is Action required", () => assert.equal(tagFor({ priority: "High", due_date: "2026-11-05" }, "2026-11-05"), "Action required"));
test("Medium in 30 days is Upcoming", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-12-05" }, "2026-11-05"), "Upcoming"));
test("High in 30 days is Upcoming", () => assert.equal(tagFor({ priority: "High", due_date: "2026-12-05" }, "2026-11-05"), "Upcoming"));
test("Medium in 7 days is Action required", () => assert.equal(tagFor({ priority: "Medium", due_date: "2026-11-12" }, "2026-11-05"), "Action required"));
test("Normal in 3 days has no tag", () => assert.equal(tagFor({ priority: "Normal", due_date: "2026-11-08" }, "2026-11-05"), null));
test("one day overdue is singular", () => assert.equal(daysLabel("2026-11-04", "2026-11-05"), "1 day overdue"));
test("no date", () => assert.equal(daysLabel(null, "2026-11-05"), "No date"));
```

- [ ] **Step 2: Run** `node --test "Hot Alerts Module/tests/"`. Expected: fails.
- [ ] **Step 3: Implement `alertLogic.js`.** Run tests. Expected: pass.
- [ ] **Step 4: Build My Notifications.**
  - Counts: Overdue, Due Today, New Tasks.
  - Quick filters.
  - List with client, service, days label, priority, tag.
  - Below it, the existing `HotAlerts` task list as a "My tasks" section, unchanged.
  - The drawer shows the spec §9 fields, recipients and history, and calls `alert_mark_read` on open.
  - Drawer buttons: Open Client when `client_id` is set, Assign Employee and Escalate for those allowed, Mark Resolved. Open Service Request, Complete Task, Request Documents and Contact Client are not shown in Phase 1.
- [ ] **Step 5: Wire the bell and the labels.** Keep the existing `task_id` path unchanged. Clear `node_modules/.vite` in Main Module after editing `src/jsx`-related files.
- [ ] **Step 6: Verify.** Run `npm run build` in `Main Module`. Expected: build succeeds. Run the preview against a local stub or read-only, and check the empty state says "Nothing assigned to you".
- [ ] **Step 7: Commit** `Add Notification Centre page and My Notifications`.

## Task 7: Department, Management and Settings views

**Files:** Create `components/DepartmentView.jsx`, `ManagementView.jsx`, `OwnerAssign.jsx`, `CentreSettings.jsx`.

**Interfaces:**
- Consumes `alertsApi.js`, `AlertList`, `Tiles`, `AlertDrawer`.
- `DepartmentView`: department picker; six tiles (spec §5); list; link to `OwnerAssign`.
- `OwnerAssign`: table from `client_owner_list`, filtered by department, status, jurisdiction and "No owner", so new clients are easy to find; multi-select and an owner picker calling `client_owners_set`. A **Show proposals** button overlays `client_owner_proposals` for a person to tick. Nothing saves until they press Save.
- `ManagementView`:
  - A red band when `alert_coverage.stale` or the last scan is `Failed`.
  - A mode banner: "Preview: only management can see these alerts."
  - Panels from `alert_management_summary`. Delayed shows "Available in Phase 3", not 0. Regulatory is not shown until Phase 6.
  - A Backlog filter.
  - A Coverage table with rule, checked, with data, missing, raised, closed, last scan.
  - Employee Performance labelled "Counts only. Early data is thin."
- `CentreSettings`: mode switch with a plain confirm stating who starts receiving what; read-only list of tagged managers; rule on/off and steps; **Run now** with last status.
- Each tile shows the "based on" line from Coverage when `with_data` is below half of `checked`, such as "Based on 6 of 178 records with a date". With nothing checked it reads "No records checked".

- [ ] **Step 1: Build `DepartmentView` and `OwnerAssign`.**
- [ ] **Step 2: Build `ManagementView` with Coverage.**
- [ ] **Step 3: Build `CentreSettings`.**
- [ ] **Step 4: Add one test to `tests/logic.test.mjs`** for the "based on" rule as `basedOnNote(rule) -> string | null`, in `alertLogic.js`, with cases `{checked: 178, with_data: 6}` returning "Based on 6 of 178 records with a date", `{checked: 230, with_data: 215}` returning null, and `{checked: 0, with_data: 0}` returning "No records checked".
- [ ] **Step 5: Run** `node --test "Hot Alerts Module/tests/"` and `npm run build`. Expected: pass.
- [ ] **Step 6: Commit** `Add department, management and settings views`.

## Task 8: Dashboard card

**Files:** Modify `Dashboard Module/logic/summaryLayout.js`, `logic/summaryFigures.js`, `services/summaryApi.js`, `components/summaryCards/DepartmentBodies.jsx`, `components/SummaryBoard.jsx`, and `Main Module/tests/summaryFigures.test.mjs`, `summaryLayout.test.mjs`.

**Interfaces:**
- `card("alerts", "Notification Centre", "departments", "mytasks")`. The existing `notifications` card stays. `mergeLayout` puts a new card last, so saved layouts survive.
- `alertFigures(tiles) -> { overdue, upcoming, documents, authority, renewals, unassigned }`, numbers with missing keys as 0.
- The fetcher calls `alert_tiles('My')`. A missing function (migration not applied) reads as the existing `isMissing` state, not an error.

- [ ] **Step 1: Write failing tests:** `alertFigures({ overdue: 2 }).renewals === 0`, `alertFigures(null).overdue === 0`, and saved layouts keep their order with `alerts` last.
- [ ] **Step 2: Run** `node --test "Main Module/tests/summaryFigures.test.mjs" "Main Module/tests/summaryLayout.test.mjs"`. Expected: fail.
- [ ] **Step 3: Implement** the card, body and fetcher.
- [ ] **Step 4: Run** tests and `npm run build`. Expected: pass.
- [ ] **Step 5: Commit** `Add Notification Centre card to the Dashboard`.

## Task 9: Pre-release check and release pack

No live writes until the user approves each numbered step below.

- [ ] **Step 1: Check the stub against live, read-only.** Compare `information_schema.columns` for every table in `000_stub.sql`. Expected: no column named in the rule functions is missing.
- [ ] **Step 2: Preview the counts, read-only.** The functions do not exist on live yet, so run the `select` from each rule function body as an ad-hoc statement, with no writes. Expected, within normal drift from 2026-11-05: 39 Active licences inside 90 days, 78 past; 12 visas inside 90 days, 33 past on Active clients; 2 overdue jobs. Explain any difference before going on.
- [ ] **Step 3: Whole-branch review.** Run `superpowers:requesting-code-review` and fix findings.
- [ ] **Step 4: Finish the README.** Run order, modes, rollback, and how to add a rule.
- [ ] **Step 5: Ask the user to approve release steps one at a time:**
  1. Back up, then apply `001` to `004` to `pnnakrhfzyxudjaghoxx`. Mode stays Preview. Run `alert_scan_now` once.
  2. Merge to `main`, push, and deploy to `abcrm` and `crm-abcapital.pages.dev`. Verify with a real admin login, and a member login showing an empty list.
  3. Seed through `client_owners_set`, matched by `profiles.id`: Aiswarya as owner of existing Business Setup clients not Liquidated, Cancelled or Rejected. Clients added later stay without an owner until someone assigns one. Check the Manager tag list on live still matches spec section 7.
  4. Switch to Triage. Managers work the backlog. Bell goes to assigned people for new crossings.
  5. Switch to Live once the backlog is settled. Escalation starts.

Rollback at any point is `rollback/001_004_rollback.sql`, plus reverting the merge and redeploying.

## Spec coverage notes

| Spec item | Where |
|---|---|
| §5 priorities, tags, tiles | Tasks 2, 5, 6, 7 |
| §6 owners | Tasks 1, 4, 7 |
| §7 escalation: overdue, 3 days, critical expiry, unassigned | Task 4. Task-assigned bell is Task 1's `alert_raise`. Due tomorrow is step 1 in Task 2 |
| §7 regulatory and service-completed rows | Phases 6 and 3 |
| §9 fields, Coverage | Tasks 1, 5, 7 |
| §10 scan rules | Task 3 |
| §11 modes | Tasks 1, 4, 7, 9 |
| §13 three views, Settings, visibility | Tasks 1, 5, 6, 7 |
| §13 Compliance Register, Regulatory tab, preferences, email | Phases 2 and 6 |
