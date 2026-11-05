# Notification Centre Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the compliance register with its expiry alerts, personal notification preferences, a staff email digest that stays off until approved, and a calendar of due dates.

**Architecture:** One new register table feeds the existing daily scan through one thin rule function per item type. Preferences are checked inside the existing bell function. Email is a separate Edge Function that reads a build function and records deliveries, and it stays off by a setting.

**Tech Stack:** Postgres on Supabase, Deno Edge Function using the existing `SmtpClient`, React through the Main Module build, `node --test`, `deno test`, throwaway Postgres through `tests/run-local.sh`.

**Spec:** `Hot Alerts Module/docs/2026-11-05-notification-centre-design.md`, sections 9, 13 and 17.

## Global Constraints

- Work on branch `notification-centre` in `D:\Abhijith Projects\CRM-notify`. Never touch live, push or merge. Never send a real email from a test.
- Do not edit `Business Setup Module` or `Database Module/Business Setup Base`.
- Migrations 001 to 005 are live, so never edit them. New work goes in `006` onward, each re-runnable, with `rollback/006_009_rollback.sql` that is safe twice and runs before the `005` and `001_004` rollbacks. Functions already live are changed by `create or replace` in a new migration, keeping their signature, and the rollback restores the earlier body.
- `SECURITY DEFINER` with `set search_path = public, pg_temp`. Revoke from `public` and `anon`. No browser writes to tables. Keep the exact-grant test in `tests/010_core_test.sql` accurate.
- Register `reference` values, such as passport numbers, never reach alerts, bells, email or logs.
- Priorities stay `Critical`, `High`, `Medium`, `Normal`. "Today" is the Asia/Dubai date.
- `Hot Alerts Module` imports only `react`. Everything else arrives as a prop.
- Nothing may reach a client. Email goes only to staff in `profiles`.
- Preview silence, backlog silence and Triage rules must hold on every new path.

## Review Focus

1. A register date in the past with status Closed: no alert, and an open alert for it closes.
2. Reference number present: absent from alert title, description, `alert_list`, `alert_detail` and email body.
3. A user turns off a category: no bell for it, but Critical still bells and the alert still lists.
4. Digest run twice in a day: no second email for the same alert and person.
5. Email setting off, or mode Preview, or a backlog row: no email, no delivery row.

---

## Task 1: Compliance register and its alerts

**Files:** Create `migrations/006_compliance_register.sql`, `rollback/006_009_rollback.sql`, `tests/060_register_test.sql`. Modify `tests/run-local.sh` (rollback order), `tests/000_stub.sql` if needed, `README.md`.

**Interfaces:**
- Table `client_compliance_items`: `id uuid pk`, `client_id text not null references client_master`, `item_type text not null`, `person_name text`, `reference text`, `issue_date date`, `expiry_date date`, `next_review_date date`, `status text not null default 'Active'` in `Active`, `Closed`, `source text`, `notes text`, `created_at`, `created_by`, `updated_at`, `updated_by`. RLS on, select through `client_compliance_can_read()`.
- `item_type` values: `Establishment card`, `Immigration file`, `Ejari`, `Labour establishment`, `Office lease`, `Emirates ID`, `Passport`, `Dependent visa`, `Work permit`, `UBO verification`, `AML risk assessment`, `KYC document`, `Corporate register review`, `Regulatory filing`, `Compliance review`, `Tax residency certificate`.
- `client_compliance_can_read() returns boolean`: admin, tagged Manager, or `'clients' = any(my_tabs())`. `client_compliance_can_write()`: same rule.
- `client_compliance_save(p jsonb) returns uuid`: insert or update by `p.id`. Refuses unknown client, unknown type, and an expiry before issue.
- `client_compliance_close(p_id uuid, p_reason text) returns void`: status Closed, reason required, appended to notes.
- `client_compliance_list(p_client text default null, p_type text default null, p_status text default 'Active', p_limit int default 100, p_offset int default 0) returns jsonb`: `{rows, total}`, limit capped at 500, rows include `client_name`.
- `client_compliance_import(p_rows jsonb) returns jsonb`: up to 500 rows, `{saved, errors: [{row, error}]}`. Good rows save even if others fail. Saves nothing on a call over 500.
- Rules, insert-only seed, department `Business Setup`:

| Code | Type | Category | Steps |
|---|---|---|---|
| `compliance_establishment_card` | Establishment card | Ejari & Establishment Card | 90 Medium, 60 Medium, 30 High, -1 Critical |
| `compliance_ejari` | Ejari | Ejari & Establishment Card | Same |
| `compliance_office_lease` | Office lease | Ejari & Establishment Card | Same |
| `compliance_immigration_file` | Immigration file | Ejari & Establishment Card | Same |
| `compliance_labour_establishment` | Labour establishment | Ejari & Establishment Card | Same |
| `compliance_emirates_id` | Emirates ID | Visa & Emirates ID | 90 Medium, 60 Medium, 30 High, 15 High, 7 High, -1 Critical |
| `compliance_passport` | Passport | Visa & Emirates ID | Same |
| `compliance_dependent_visa` | Dependent visa | Visa & Emirates ID | Same |
| `compliance_work_permit` | Work permit | Visa & Emirates ID | Same |

- `alert_compliance_candidates(p_type text) returns setof alert_candidate`: Active items of that type; skip closed clients with the licence rule's filter. Key `compliance:<id>:<date>`. Subject is the type, the person when present, and the client name. `source_table` is `client_compliance_items`, `source_id` the id. Assignee is `alert_owner(client, 'Business Setup')`. One wrapper `alert_rule_<code>()` per row above, because `alert_scan` calls rules by code. Other types raise nothing until Phase 5.
- `alert_tiles` and `alert_management_summary`: the renewals count also includes `rule_code like 'compliance\_%'`, by a new migration replacing those functions with the rest unchanged. `alert_my_access` also returns `can_register`.

- [ ] **Step 1:** Write `060_register_test.sql`: save, refuse unknown client and type, list paging and cap, import partial success, 501 rows refused, close needs a reason, untagged member with no clients tab refused both ways, anon refused.
- [ ] **Step 2:** Add scan tests: 30 days High, past Critical, Closed raises nothing and closes an open alert, closed client raises nothing, date change opens a new cycle, a reference value appears in no `alerts` column, Preview writes no bell, UBO type raises nothing, renewals tile counts a register alert.
- [ ] **Step 3:** Run `bash "Database Module/Notification Base/tests/run-local.sh"`. Expected: fails.
- [ ] **Step 4:** Implement. Run again. Expected: all `ok`.
- [ ] **Step 5:** Commit `Add compliance register and its expiry alerts`.

## Task 2: Register screens

**Files:** Create `Hot Alerts Module/components/ComplianceRegister.jsx`, `Hot Alerts Module/logic/registerLogic.js`. Modify `components/NotificationCentre.jsx`, `services/alertsApi.js`, `logic/alertLogic.js`, `tests/logic.test.mjs`, `Client Module/crm/ClientsHub.jsx`, `README.md`.

**Interfaces:**
- `ITEM_TYPES` matching the SQL list. `parseRegisterCsv(text) -> { rows, errors }` with header `client_id,item_type,person_name,reference,issue_date,expiry_date,next_review_date,notes`, dates `YYYY-MM-DD` or `DD/MM/YYYY`, quoted commas handled. `validateItem(item) -> string | null`.
- `DUE_DATE_CATEGORIES` gains `Ejari & Establishment Card`.
- Tab "Compliance Register" when `access.can_register`: filter by client, type and status; add and edit form using the client code; Close with a reason; **Import** pastes CSV, shows a preview with errors, saves only on pressing Save, and reports `saved` and `errors`.
- In `ClientsHub` client detail, a small read-only "Compliance items" list when the viewer can read, through a prop or the same RPC. An empty or refused result shows nothing and never breaks the panel.

- [ ] **Step 1:** Write failing tests for `parseRegisterCsv` (quotes, both date forms, bad date, missing client) and `validateItem`.
- [ ] **Step 2:** Run `node --test "Hot Alerts Module/tests/"`. Expected: fails.
- [ ] **Step 3:** Implement logic, then screens.
- [ ] **Step 4:** Run tests and, in Main Module, `npm run build`. Expected: pass.
- [ ] **Step 5:** Commit `Add compliance register screens`.

## Task 3: Notification preferences

**Files:** Create `migrations/007_alert_preferences.sql`, `tests/070_preferences_test.sql`, `Hot Alerts Module/components/MyPreferences.jsx`. Modify `components/NotificationCentre.jsx`, `logic/alertLogic.js`, `services/alertsApi.js`, `tests/logic.test.mjs`.

**Interfaces:**
- Table `alert_preferences(user_id references profiles on delete cascade, category text, channel text in ('Bell','Email'), enabled boolean, primary key(user_id, category, channel))`. No row means on.
- `alert_preferences_get() returns jsonb`, `alert_preferences_save(p_category text, p_channel text, p_enabled boolean) returns void`: own rows only. Refuses an unknown category or channel. Categories are the 12 in spec section 5.
- `alert_channel_on(p_user uuid, p_category text, p_channel text, p_priority text) returns boolean`: internal. Critical is always on for `Bell`.
- `alert_bell` replaced to also check `alert_channel_on`, all other rules unchanged.
- Settings tab for everyone. `tabsFor` shows it to all; `MyPreferences` shows the matrix for all, and the admin parts stay admin-only.

- [ ] **Step 1:** Write tests: off stops a bell, Critical still bells, the alert still lists and the recipient row exists, another user's rows unreachable, unknown category refused, Preview and backlog rules still hold.
- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement, including `tabsFor` test updates.
- [ ] **Step 4:** Run SQL tests, JS tests and build. Expected: pass.
- [ ] **Step 5:** Commit `Add notification preferences`.

## Task 4: Staff email digest, off by default

**Files:** Create `migrations/008_alert_email.sql`, `tests/080_email_test.sql`, `Hot Alerts Module/supabase/alert-digest/index.ts`, `rules.ts`, `rules_test.ts`. Modify `README.md`.

**Interfaces:**
- Settings seeded insert-only: `email_enabled` false, `email_sender` `"info@abcapital.ae"`, `digest_hour` 7.
- Table `alert_deliveries(id, alert_id, user_id, channel, kind in ('Digest','Critical'), status in ('Sent','Failed'), sent_at, error, unique (alert_id, user_id, channel, kind, sent_on))`, with `sent_on date` Dubai.
- `alert_email_build(p_kind text) returns jsonb`, for `service_role` only: `[{user_id, name, email, alerts: [{id, number, title, due_date, priority, action}]}]`. Empty unless `email_enabled` is true and mode is Triage or Live. `Critical`: open Critical alerts of recipients with no `Critical` delivery yet. `Digest`: open alerts assigned to that person, or managers' unassigned ones, with no `Digest` delivery today. Skips `backlog`, `alert_channel_on` false and profiles with no email. Selects only the listed fields, so `reference` cannot appear.
- `alert_email_record(p_items jsonb) returns void`, for `service_role` only.
- Edge Function `alert-digest`, `POST { kind }` with header `x-alert-secret` compared to env `ALERT_DIGEST_SECRET`, verify_jwt off. Reads `alert_email_build`, sends one mail per person from `email_sender` with `SmtpClient` and `mailboxLogin` as `ardentax-mail-send` does, and records each result. A failed send records `Failed` and continues. Refuses without the secret.
- `rules.ts`: `digestSubject(kind, count)`, `digestText(name, alerts, siteUrl)`, plain text, escapes nothing into HTML, tested. The link is `https://crm-abcapital.pages.dev/`.
- No cron job in the migration. The schedule is a release step.

- [ ] **Step 1:** Write `080_email_test.sql`: off gives empty, Preview empty, backlog skipped, preference off skipped, second build after recording gives nothing for that alert, no `reference` in output, browser role refused. Write `rules_test.ts` for subject and text.
- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement. Do not call the function against anything real.
- [ ] **Step 4:** Run SQL tests and `deno test "Hot Alerts Module/supabase/alert-digest/rules_test.ts"`. Expected: pass.
- [ ] **Step 5:** Commit `Add staff email digest, off by default`.

## Task 5: Calendar of due dates

**Files:** Create `migrations/009_alert_calendar.sql`, `tests/090_calendar_test.sql`, `Hot Alerts Module/components/AlertCalendar.jsx`. Modify `Main Module/src/components/MyTasks.jsx`, `components/NotificationCentre.jsx`, `services/alertsApi.js`, `logic/alertLogic.js`, `tests/logic.test.mjs`.

**Interfaces:**
- `alert_calendar(p_from date, p_to date) returns jsonb`: open alerts with a due date in range that the caller can see, capped at 500: `id, title, due_date, priority`. Assigned ones for non-managers, all for managers and admins, nothing for others in Preview.
- `alertsToEvents(rows) -> [{ id, title, start, allDay: true, kind }]`, with `kind` the priority.
- `MyTasks` imports `CalendarPanel` from `@calendar` and passes it to `NotificationCentre` as prop `CalendarPanel`. Tab "Calendar" for everyone. Event click opens the drawer.

- [ ] **Step 1:** Write failing SQL and JS tests.
- [ ] **Step 2:** Run. Expected: fails.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run all suites and build. Expected: pass.
- [ ] **Step 5:** Commit `Add calendar of due dates`.
