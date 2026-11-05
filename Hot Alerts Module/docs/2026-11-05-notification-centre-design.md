# Notification & Alert Centre: Design Spec and Phased Plan

Date: 2026-11-05. Status: approved by the user 2026-11-05, with the recommended defaults for D1 to D12. Nothing here is built, applied or released. Each live step still needs separate approval.

Checked against `origin/main` at `341a0c2`, branch `business-setup-restructure` at `f12fc2f`, and read-only queries on live project `pnnakrhfzyxudjaghoxx` on 2026-11-05. Counts below are from those queries and will change.

## 1. Purpose

One place that tells each person what action is needed, who is responsible, and by when, for two things: Business Setup and PRO services in progress, and existing clients, who are monitored even with no open service. UAE regulatory updates are a separate centre, where an announcement never becomes a client obligation until a manager has verified it.

The work is done when an employee, a department manager and the CEO each open their own view and see live counts that link to individual clients, and when a licence or visa that crosses a threshold reaches a named person without anyone running a report.

## 2. Main findings

These five facts shape the plan. Please read them before the rest.

1. **The brief's first priority has almost no data.** The task tables on live are empty: `tasks`, `business_setup_tasks`, `banking_tasks` and `accounting_followups` hold 0 rows, and `bd_followups` holds 1. `business_setup_services.due_date` is filled on 0 of 143 rows. `accounting_jobs.due_date` is filled on 6 of 178, and 2 of those are overdue. So "overdue tasks" would show about 2 items today. A zero on that tile would mean "no dates recorded", not "no work overdue".
2. **Licence and visa expiry can run today.** Of 230 Active Business Setup clients, 215 have a licence date. Of 142 visas, 134 have an expiry date, and 12 of those fall inside 90 days. These are the real starting point.
3. **Existing clients have no responsible employee.** No field says who looks after a client. `business_setup_services.owner_id` is filled on 0 of 143, `business_setup_cases` has 1 owner, `banking_cases.assigned_to` has 3 of 970, and `client_master` holds only a free-text Accountant on 62 of 307. Without a fix, every existing-client alert goes to the Unassigned tile. See section 6.
4. **There is no one to escalate to.** `crm_teams` and `crm_team_members` hold 0 rows and no database function uses them. `business_setup_staff` holds 0 rows. `hr_employees.manager_id` is filled on 1 of 17, and department on 3 of 17. The departments and managers model is still a design. Section 7 gives an interim source that can later be swapped.
5. **Switching on would create a large backlog at once.** Today 78 Active clients have a licence date already past, 29 of them by over a year, and 33 visas on Active clients are past, including 6 with status `X`, which stay in as pending follow-up (D9). Some will be true expiries and some will be old data. Sent as Critical alerts on day one, they would bury everything and lose people's trust. Section 11 starts silently.

Other limits:

- `client_master` holds no VAT, Corporate Tax, Ejari, establishment card, UBO, AML, shareholder or contact-date data. Its filled keys are ID, name, licence number and dates, issuing authority, services, accountant, notes and a few others. So `Client Module/crm/taxLogic.js`, which is sound, can only report "missing" for each client.
- `business_activity` is filled on 1 of 252 Business Setup profiles, and `jurisdiction` on 245. Regulatory matching can use jurisdiction and status today, and not activity.
- The live data has 230 Active clients in Business Setup and 307 rows in `client_master`, against the brief's figure of 500. The Centre monitors what is recorded, and the Coverage panel (section 9) shows the gap.

## 3. Reuse

| Exists | Decision |
|---|---|
| `public.notifications` and the bell (`Main Module/src/components/Notifications.jsx`): realtime, per user | **Reuse for delivery.** A new alert writes a bell row with type `alert_centre` and `link_scope = {alert_id}`. It cannot be the record itself: read rows are purged after 30 days by `purge-old-notifications`, users can delete their own, and it has no owner, due date or status |
| Hot Alerts page (`mytasks` tab) | **Extend.** It becomes the Centre's page. The current task list stays inside it as a section. The tab key stays, so `member_tab_access` is unchanged |
| `business_setup_expiries()` | **Reuse its rule**: `coalesce(k.licence_expiry, parsed master date)`. It is gated to a signed-in user, so the scan needs its own version. The Business Setup file is not edited |
| `Client Module/crm/taxLogic.js` | **Reuse unchanged.** An Edge Function imports it for the tax scan, so tax rules live in one place |
| `accounting_job_list` (`balance`, `follow_up_due`, `due_date`, `assignee_ids`) | **Read as a source.** No new Accounting client records |
| Dashboard Module `SummaryBoard`, `summaryApi.js` | **Add one card** using the existing fetcher pattern. The existing Notifications card stays |
| Calendar Module `CalendarPanel` | **Reuse** for a month view of due dates |
| `admin_triggers` catalogue and `pg_cron` | **Reuse.** The scan is a cron job and also a "Run now" entry in Settings, with its last status visible |
| `client_portal_change_requests` | **Read as a source** for employee and client details needing update |
| `SmtpClient` in `ceo-mail-reply` and `ardentax-mail-send` | **Reuse** for email |
| Business Setup service statuses `Waiting on client` and `Waiting on government` | **Read as hold flags**, as the flow spec keeps them |
| Banking dashboard alerts | **Leave in place.** The brief asks for Business Setup and PRO. Banking joins in a later phase if wanted |

Not reused: HR's `hr_documents` and `hr_documents_expiring`. Those are staff records under HR's own access rules, and they do not mix with client alerts.

## 4. Decisions for the user

Each has a recommended default. Approving the spec adopts the defaults unless you say otherwise.

| # | Decision | Recommended default |
|---|---|---|
| D1 | Priority words | Section 5: four levels only, with Urgent kept as a display tag |
| D2 | Who is responsible for an existing client | A new per-department owner, section 6. Bulk-assign before any alert reaches a person |
| D3 | Who are the managers until the department model is decided | Everyone tagged Manager in the CRM, read live, section 7. If nobody is tagged, it goes to CRM admins |
| D4 | Checkpoint due dates, which the Business Setup spec does not have | Section 8: service-level due date first, optional checkpoint date second, standard durations last |
| D5 | The expired backlog | Silent preview, then manager triage, section 11 |
| D6 | "Department head" and "department manager" are both in the brief, but the department model has only Managers and Executives | Both mean everyone tagged Manager |
| D7 | Who is the "compliance manager" | Everyone tagged Manager. No such role exists today |
| D8 | "Overdue 3 days": calendar or working days | Calendar days, since `hr_holidays` is HR's list and a licence expiry does not wait for working days |
| D9 | Visa rows with status `X` (11 rows). The current expiry list does not treat these as cancelled | Not cancelled. They raise expiry alerts as usual, marked "Pending follow-up" |
| D10 | Mailbox for staff email | Decide at Phase 2. Staff only |
| D11 | Tab name | Sidebar label changes to "Notification Centre". Tab key unchanged |
| D12 | The brief says 12 categories and shows 6 tiles | Keep the 6 tiles. Use section 9 of the brief's 12 items as the 12 categories, section 5 below, as a trial to revise later |

### Phase 0 answers

The user's words, 2026-11-05, relayed from session "Business setup service checklist". All other decisions keep their defaults.

| # | Answer | Recorded as |
|---|---|---|
| D2 | "AISWARYA (she can reassign it)" | Aiswarya is first owner of existing Business Setup clients. She can reassign because she is tagged Manager |
| D3, D6, D7 | "ALL TAGGED AS MANAGERS", confirmed as "Everyone tagged Manager" | This replaces the earlier answers naming Garima as Manager and Aiswarya as Head and Compliance Manager. See section 7 |
| D9 | "Keep it Pending for followup a", then "Pending for followup" | See D9. Confirmed |
| D12 | "try we will optimize it later" | See D12 |

To confirm with the user, not blocking the build:

- D2 names no department. It is recorded for Business Setup only. Extending it is an owner change at release.

Further answers from the user, 2026-11-05:

- **New clients:** "if the clients are new somebody has to assign it on their name". The first-owner seed covers existing clients only. A new client gets no automatic owner. Its alerts stay Unassigned, go to all managers, and show in the Unassigned tile until a person assigns an owner.
- **Admin and CEO:** "ADMIN AND CEO should have same access". Management view and Settings stay on `profiles.role = 'admin'`, so a CEO login holds that role.

The Manager tag is read here and never changed. Reading it grants no new permission in other modules.

## 5. Priorities and categories

### Resolving the conflict in the brief

Section 2 of the brief uses Normal, High and Urgent. Section 7 uses Critical, High, Medium and Normal. They also disagree on specific items, including one the brief's note did not name:

| Item | Section 2 | Section 7 | Resolved |
|---|---|---|---|
| Task overdue | Urgent | High | **High**, rising to **Critical** at 3 days overdue, the same point it escalates again to all managers |
| Application rejected | Urgent | Critical | **Critical** |
| Authority clarification received | Urgent | Not listed | **High**, with a due date required when it is logged. It rises to Critical at 3 days overdue |
| Client documents pending | High | Medium | **Medium**, rising to **High** once its due date passes |
| Deadline approaching | High | High | **High** |

Stored priority is one of Critical (red), High (orange), Medium (yellow), Normal (blue). **Urgent is no longer stored.** Section 5 of the brief still uses it as a tag and filter, so: tag **Urgent** means Critical, or High and overdue. **Action required** means other High or Medium items. **Upcoming** means due later than 7 days.

### Expiry steps

| Days to expiry | Licence | Visa (investor, employee) |
|---|---|---|
| 90, 60 | Medium | Medium |
| 30 | High | High |
| 15, 7 | Not in the brief | High |
| Expired | Critical | Critical |

Steps are settings per rule, editable by an admin.

### Categories

Deadlines, Licence, Visa & Emirates ID, Ejari & Establishment Card, Client Documents, Government Applications, Follow-ups, Payments, UBO & AML, Tax, Regulatory, Client Activity.

### Dashboard tiles

Each tile counts open alerts in the viewer's scope, from one table, so tiles and lists always agree. Each opens its list.

| Tile | Counts |
|---|---|
| Overdue Tasks | Open, `due_date` before today |
| Upcoming Deadlines | Open, due within 7 days |
| Documents Pending | Open, category Client Documents |
| Authority Pending | Open, category Government Applications |
| Upcoming Renewals | Open expiry rules not yet expired |
| Unassigned Actions | Open, no assigned employee |

Each tile shows a small "based on" line when its source is thin, for example "2 of 178 jobs have a due date". A zero must not read as all clear.

## 6. Responsible employee

New table `client_owners`: `client_id`, `department`, `owner_id`, `assigned_at`, `assigned_by`, unique on client and department. Departments come from `service_departments`.

An alert picks its assignee in this order:

1. The service or case owner, if the alert is about a service.
2. For a job, `accounting_jobs.assignee_ids`.
3. `client_owners` for the rule's department.
4. Otherwise it stays **Unassigned** and goes to all managers. Nothing is dropped.

A bulk-assign screen sets owners by list and filter. Proposals can be seeded without saving: Accounting from `assignee_ids` and the Accountant text, matched to staff names, for a person to confirm. This gives shared clients a different owner in each department, in line with the 2026-11-05 decision that a shared client appears in both departments.

## 7. Recipients and escalation

**No roster table.** "Manager" means the CRM's existing tag, read live: data role `MANAGER` in `banking_user_roles`, or an Active `hr_employees` row with designation `Manager`. This is the same rule as `hub_is_admin()`. On 2026-11-05 that is Aiswarya, Garima Malik, Geo, Himanshu, Navneet Rathi and Sayyed, plus Abhijith, who is also a CRM admin. Madhvi and Teena Bajaj hold data role `ADMIN` and no Manager tag, so they are not included unless tagged.

All resolution goes through one function, `alert_managers()`, so the future department model replaces one function and no callers. If it finds nobody, it returns CRM admins (`profiles.role = 'admin'`, 2 people today), and the alert records that it fell back.

The tag has no department, so every manager receives manager, head and compliance alerts for every department, and the same item reaches all of them. This is the user's choice, and it may be noisy. Per-department routing arrives with the department model.

| Situation (brief) | Recipients | Runs on |
|---|---|---|
| Task assigned | Assigned employee | Assignment |
| Due tomorrow | Assigned employee | Daily scan |
| Overdue | Employee + manager | Daily scan |
| Overdue 3 days | All managers again (the brief's department head) | Daily scan |
| Critical compliance expiry | Employee + manager | Daily scan |
| Unassigned service | All managers | Daily scan |
| New regulatory update | All managers (the brief's compliance manager) | Update created |
| Update affects clients | Assigned client employees + manager | After verification |
| Service completed | Employee + manager | Status change |

An escalation raises `escalation_level` and adds recipients. It does not remove the employee. Level 2 reaches the same managers as level 1, so it sends them a fresh bell item. A manager can also press Escalate by hand, with a reason.

## 8. Checkpoint due dates and the service trigger design

The session "Client onboarding workflow tabs" owns `022_checkpoints.sql` and its screens. Nothing here edits those files. The 45 lists hold 512 items, with no due date and any-order ticking.

### Choice of due date

| Option | What it needs | Result |
|---|---|---|
| **A. Service due date** (recommended first) | `business_setup_services.due_date` already exists, 0 filled. Ask for it when a service starts. No schema change | Service-level due, overdue and nearing-deadline alerts work |
| **B. Optional checkpoint due date** (recommended second) | One nullable column added by this module's own migration once 022 is live, and a date box in their Pipeline screen | Staff can set a date only on the items that matter, such as a government deadline. It falls back to the service date |
| **C. Standard durations** (later) | `target_days` per step, needing you to supply durations for up to 512 items | Automatic dates |

### Avoiding noise

Items can be ticked in any order, so at the start of a service every item is "pending". If each one raised an alert, one company formation would send 16 alerts on day one. Instead:

- One rolled-up **service alert** per service, naming the open mandatory items.
- A named per-service notification, such as "entry permit pending", fires only when that item has passed its own due date, or has been open longer than a setting (default 7 days) since the service started, or the service is on hold.
- Optional items fire only if staff set a date.

**Service delayed** has a definition with no new table: time used between `start_date` and `due_date`, compared with checkpoint progress. It fires when at least half the time is used and progress trails by 25 points. Both are settings.

### Requests for that session, no edits by this one

1. Keep a `step_id` on `business_setup_service_checkpoints`. Without it, notifications must match on label text, and an edited label breaks them silently. If it cannot be added, the mapping matches by text and reports unmatched labels in the Coverage panel.
2. Allow a date box on a checkpoint row, for option B.
3. Add `hold_reason` next to the hold flags, for example Documents, Approval, Payment, Clarification. One "Waiting on client" flag cannot tell documents pending from approval pending.
4. Add a **Log government response** action on a service: Clarification, Approved or Rejected, with a note and a due date. Checkpoints have Open, Done and Not applicable, so a rejection cannot be recorded in them today. Government responses are never detected automatically. They arrive when a person logs them.

### Mismatches between the brief and the checklists

| Brief asks for | Checklist has | Effect |
|---|---|---|
| Medical appointment pending | Only "Medical fitness completed" | Needs a new item, or drop it |
| Medical result pending, employment visa | "Medical result received" on Investor visa only | Add to list 12, or use medical fitness |
| Trade name approval, mainland | "Trade name selected" (list 1), "Trade name approved" (list 2) | Mainland needs an item |
| Renewal not initiated | No item. It means no renewal service exists | Computed: licence inside threshold with no open renewal service |
| Liquidator report | "Liquidation report received (where required)" | Optional, so it fires only with a date |
| Outstanding clearance | "Government dues cleared" and "Employee / labour obligations cleared" | Maps to both |

## 9. Data model

New folder `Database Module/Notification Base`, each migration re-runnable with a tested rollback, following the existing pattern. No browser writes to these tables. All writes go through functions.

**`alert_rules`:** `code`, `category`, `department`, `title_template`, `action_template`, `steps` (days and priority for each), `enabled`, `source_note`. Admins can edit steps and on/off.

**`alerts`:** one row per matter, not per person and not per threshold.

| Brief field | Column |
|---|---|
| Notification ID | `alert_number` (`ALT-000001`), with `id` uuid |
| Category, Title, Description, Action Required | `category`, `title`, `description`, `action_required` |
| Client ID | `client_id`, text, the existing client code |
| Service Request ID | `service_id`, nullable; `case_id`, nullable |
| Related Compliance ID | `compliance_item_id`, nullable, plus `source_table`, `source_id` for licences, visas and jobs |
| Assigned Employee, Department | `assigned_to`, nullable; `department` |
| Priority | `priority` |
| Trigger, Due, Created dates | `trigger_date`, `due_date`, `created_at` |
| Notification Status | `status`: Open, In progress, Resolved, Dismissed |
| Escalation Status | `escalation_level`, `escalated_at` |
| Resolution Date | `resolved_at`, plus `resolved_by`, `resolution_note` |
| Read/Unread | Per person, in `alert_recipients.read_at`, since each recipient reads separately |

Extra columns: `rule_code`, `dedupe_key` (unique while open), `current_step`, `backlog` (boolean), `regulatory_update_id`.

**`alert_recipients`:** `alert_id`, `user_id`, `reason` (Assigned, Manager), `read_at`.
**`alert_deliveries`:** `alert_id`, `user_id`, `channel`, `status`, `sent_at`, `error`.
**`alert_events`:** append-only history: raised, step changed, assigned, escalated, resolved.
**`alert_preferences`:** `user_id`, `category`, `channel`, `enabled`. Critical alerts always stay on in the bell and dashboard.
**`alert_scan_log`:** each scan's start, end, status, per-rule counts and error.
**`client_owners`:** section 6.

**`client_compliance_items`:** the register for everything with a recorded validity date that has no home today. Licences and visas stay in their existing tables and are not copied.

Columns: `id`, `client_id`, `item_type`, `person_name` (nullable), `reference`, `issue_date`, `expiry_date`, `next_review_date`, `status`, `source`, `notes`, standard stamps.

Types: Establishment card, Immigration file, Ejari, Labour establishment, Office lease, Emirates ID, Passport, Dependent visa, Work permit, UBO verification, AML risk assessment, KYC document, Corporate register review, Regulatory filing, Compliance review, Tax residency certificate.

One table means a new type needs no schema change. When a service with an `expiry_date` is completed, such as Ejari Renewal, a proposed update appears for a person to confirm. A date is never overwritten silently, and the row's history comes from the existing audit trail.

**`regulatory_updates`, `regulatory_update_clients`:** section 12.

Personal data: alerts hold client name and matter, never passport or Emirates ID numbers. Register reference numbers stay on the register and are not copied to `description` or to email.

### Coverage panel

In Management view, for each rule: clients checked, how many have the needed data, how many are missing it, last scan result. This replaces any claim of full coverage. Failed scans show a red band, and a failed scan is never treated as no change.

## 10. How alerts are made

| Kind | How | Used for |
|---|---|---|
| Date-based | `alert_scan()` runs daily at 06:00 Dubai (`0 2 * * *` UTC) through `pg_cron` and "Run now" | Expiries, deadlines, overdue, escalation |
| Event | Thin triggers in this module's migrations call `alert_raise()`. Each catches its own errors and logs them, so an alert failure can never block a business save | Assigned, completed, government response, checkpoint done |
| Tax | Edge Function `alert-tax-scan` imports `taxLogic.js`, called by the scan | VAT and CT dates |
| Manual | Staff log it | Complaints, opportunities, clarifications |

Rules for the scan:

- **One alert per obligation.** A licence moving from 90 to 60 to 30 days updates the same alert and raises its priority. Each step notifies again.
- **`dedupe_key` includes the date**, for example `licence:CL000123:2027-03-01`. If the expiry moves, the old alert closes itself with note "Date changed", and the new date starts a new cycle.
- **Self-closing.** When the source no longer matches, the alert closes as Resolved by System.
- **Resolved stays resolved** for that date. Resolving a Critical alert needs a note.
- **Closed clients are skipped.** `Liquidated`, `Cancelled` and `Rejected` statuses raise no expiry alerts. This also applies to their visas, which the current expiry list does not filter.
- **Imported visa service rows do not raise expiry alerts.** All 142 "Visa Registration" rows in `business_setup_services` (129 historical, 13 open) mirror `business_setup_visas`, which stays the only expiry source. Rows with `historical = true` raise nothing at all.

## 11. Go-live without a flood

Setting `alert_mode` has three values:

1. **Preview:** the scan runs and writes alerts marked `backlog`. Only Management view shows them. No bell, no email, no escalation.
2. **Triage:** managers go through the backlog. For each they correct the date, resolve it, or accept it as a true expiry. Bell turns on for assigned people.
3. **Live:** full escalation. Email follows in Phase 2.

Backlog rows from the first scan never escalate by themselves or send email. Only a threshold crossed afterwards does. Testing uses TEST client `CL000001`, and no client ever receives anything from this module. "Request Documents" and "Contact Client" open a draft for a person to send.

## 12. UAE Regulatory Updates Centre

Separate tab, separate from client alerts. It works with no AI.

**`regulatory_updates`:** `title`, `category` (the 10 in the brief), `issuing_authority`, `document_number`, `publication_date`, `issue_date`, `effective_date`, `official_url`, `summary`, `legal_status`, `evidence_level`, `applicability` (jsonb), `workflow_status`, `source` (Manual, Tax Agent), `verified_by`, `verified_at`.

`legal_status` and `evidence_level` use the vocabulary of the UAE tax monitoring agent (`ENACTED`, `IN FORCE`, `PUBLISHED`, `ANNOUNCED`, `PROPOSED`, `UNDER CONSULTATION`, `SCHEDULED`, `SUPERSEDED`, `REPEALED`, `UNVERIFIED`, `UNCERTAIN`; E1 to E4), so publication, effect and deadlines are never confused.

**`regulatory_update_clients`:** `update_id`, `client_id`, `match_reason`, `decision` (Applies, Does not apply, Check), `decided_by`, `alert_id`.

| Step | Status | Who |
|---|---|---|
| Record the update, choose category | Draft | Anyone with access; alert to managers |
| Confirm effective date, authority, official source | Under review | A manager |
| Set applicability against client profile | Under review | A manager |
| Build impacted list | List proposed | Function, from applicability |
| Manager verifies update and list | Verified | Manager |
| Create employee tasks, notify | Tasks created | Function; one alert per client |
| Client communication | Draft only | Employee sends |
| Track completion | Closed when all are resolved | Automatic |

**The rule is enforced in the database.** `regulatory_create_tasks()` refuses unless the update is Verified with an effective date and applicability, and it creates alerts only for clients marked Applies. Evidence level E4 or status `PROPOSED`, `UNDER CONSULTATION` or `UNVERIFIED` cannot be verified into tasks: it stays information only.

**Matching today:** jurisdiction (245 of 252), client status, visa holder, service history, and the CT text. Activity cannot be matched (1 of 252). The list shows "profile incomplete" clients as Check, never as Does not apply. The Tax Agent's later job of finding affected clients depends on filling these profile fields.

**Connecting the Tax Agent later:** `regulatory_update_intake(payload)` takes a structured record and always creates a Draft. It cannot verify. `Agent Module/03_Tax_Agent` is a specification, not integrated. The working monitor is `D:\Abhijith Projects\Agents\TAX\UAE VAT`, whose alert format matches these fields closely. It has one alert so far, no scheduler, and open coverage gaps, and it covers tax only. The other nine categories are manual.

## 13. Screens

All in `Hot Alerts Module`, reusing the existing table sort and filter, styling and client picker.

| View | Who | Shows |
|---|---|---|
| **My Notifications** | Everyone | Overdue, Due Today, New counts; priority list with client, service, days overdue or remaining, tag; filters All, Urgent, Due Today, Client Pending, Government Pending; my tasks section |
| **Department Notifications** | Everyone tagged Manager, and admins | All matters of a chosen department; six tiles; Unassigned; bulk assign |
| **Management Notifications** | CEO, CRM admins | Critical Alerts, Today's Work, Pending Client Actions, Government Pending, Upcoming Renewals, Unassigned Cases, Delayed Services, Employee Performance, Client Risk, Regulatory Updates needing review, Coverage |
| **Regulatory Updates** | Managers, management; read-only for others | Section 12 |
| **Compliance Register** | Staff with client access | Section 9, also on the client page |
| **Settings** | Everyone for own preferences; admins for rules | Category and channel matrix; steps; list of tagged managers, read-only |

Visibility is enforced on the server in `alert_can_see()`: recipient, or tagged Manager, or admin. Anyone else sees only My Notifications. **Admin and CEO have the same access**, through `profiles.role = 'admin'`. Employee Performance is Management only and counts pending and completed alerts. It is a count, not a judgement, and thin data will distort it at first.

**Action buttons** appear only when they can work. Open Client, Open Service Request, Assign Employee, Escalate and Mark Resolved are available from Phase 1 where the target exists. Complete Task calls the source module's own function, such as `business_setup_checkpoint_set`, and never writes its tables. Request Documents and Contact Client open a draft and log that it happened.

**Channels:**

| Channel | State | Plan |
|---|---|---|
| Dashboard and bell | Exists | Phase 1 |
| Email | SMTP code exists | Phase 2: daily staff digest, immediate for Critical only. A per-alert email would flood people |
| Microsoft Teams | Not integrated: `microsoft_connection` has 0 rows, and AB Capital Messenger replaced the Teams route | Parked. AB Capital Messenger could be a channel if you want one |
| WhatsApp | No approved integration: `messenger_inbox_accounts` has 0 rows | Parked until one is approved, and never automatic to clients |

## 14. Which triggers can run on today's data

**Now:** data is there. **Thin:** code can run, the source is barely filled. **After 022:** needs Task 14 live. **New field:** needs a new field or register entry, then staff must fill it. **Staff log:** cannot be detected, a person records it.

### Section 2: Business Setup and PRO

| Trigger | State | Source or need | Priority |
|---|---|---|---|
| New service assigned | Thin | Case `owner_id` (1) and service `owner_id` (0) | Normal |
| Task due today | Thin | Service `due_date` 0 of 143; jobs 6 of 178; task tables empty | High |
| Task overdue | Thin | Same; 2 overdue today | High, then Critical |
| Client documents pending | Thin, then After 022 | `Waiting on client` flag (0 today); needs `hold_reason` | Medium, then High |
| Client approval pending | Thin | Open quotes; better after the flow spec's acceptances | Normal |
| Government application pending | Thin, then After 022 | `Waiting on government` flag (0 today); needs `hold_reason` | High |
| Authority clarification received | Staff log | Log government response | High |
| Government approval received | Staff log or After 022 | Log, or checkpoint Done | Normal |
| Application rejected | Staff log | Log government response | Critical |
| Payment pending | Thin | Quote balance; government fees After 022 | High |
| License issued | After 022 | "Trade license issued" Done | Normal |
| Visa issued | After 022 | "Residence visa issued" Done | Normal |
| Service nearing deadline | Thin | Service `due_date` | High |
| Service delayed | After 022 | `start_date`, `due_date`, progress | High |
| Service completed | Now, full After 022 | Status Completed; mandatory items after 022 | Normal |
| Service closure pending | After 022 | Completion stage | Normal |

### Section 2: per-service specials

All **After 022**, except where noted. They use the mapping and noise rules in section 8.

| Service | Maps to | Gaps |
|---|---|---|
| Company Formation | Trade name approved, Initial approval, External approvals, MOA signed, Trade license issued, documents delivered | Mainland has no trade-name approval item |
| Visa & Immigration | Entry permit, Medical fitness, Medical result, Biometrics, Emirates ID, Residence visa issued | No medical appointment; medical result only on list 11 |
| License Renewal | Client confirmation, Ejari documents, External approvals, Payment received | **Not initiated** and **overdue** can run **Now**, from licence date and no open renewal service |
| Corporate Amendments | New shareholder KYC, Resolution signed, MOA amended, Regulatory approval, Updated license | Named items differ between lists 24 to 29, so mapping is per list |
| Liquidation | Resolution signed, Liquidation report, dues cleared, Visa cancellations, Cancellation certificate | Report is Optional |

### Section 3A: licence and company

| Trigger | State | Source or need |
|---|---|---|
| Trade license expiring 90, 60, 30 | **Now** | 39 Active clients inside 90 days: 13, 11, 15 by band |
| License expired | **Now** | 78 Active past; 29 by over a year; triage first |
| Establishment card, immigration file, Ejari, labour establishment, office lease | New field | Register. `ejari_provider` 0 filled; `lease_source` 44 with no date |
| Missing company documents | New field | Needs a required list per client type. `business_setup_documents` has 1 row |
| Company information outdated | Thin | `client_master.updated_at`, but imports reset it; needs a review date |
| License activity mismatch | Staff log | Activity is 1 of 252, so nothing to compare |

### Section 3B: visa and employee

| Trigger | State | Source or need |
|---|---|---|
| Investor and employee visa 90, 60, 30, 15, 7 | **Now** | 134 of 142 dated: 6, 2, 3, 0, 1 by band; 33 past on Active clients, 27 leaving out status `X`. No type column: 91 look like investor by occupation text, same steps either way |
| Dependent visa | New field | Register type |
| Emirates ID, passport | New field | Register. `passport_expiry` 0 filled in both shareholder tables |
| Visa cancellation pending, medical pending | After 022 | Lists 15, 11, 12 |
| Work permit renewal | New field | Register |
| New employee visa requirement | Staff log | Client request |
| Employee details need updating | Thin | `client_portal_change_requests` (1 row) |

### Section 3C: tax and financial

| Trigger | State | Source or need |
|---|---|---|
| CT registration pending | Thin | `licence_extras.ct_reg` free text on 97: 5 say to do, 81 Done; needs an applicability field |
| CT return deadline | New field | `taxLogic` needs CT status and FY, empty in master. 35 jobs exist with few dates |
| VAT return due | New field | `taxLogic` needs VAT registered, frequency and period, empty in master |
| VAT payment pending | Staff log | Accounting records it |
| VAT threshold review | New field | Turnover per client; threshold as a setting taken from an official source |
| CT deregistration review | Thin | Closed clients (19) with `ct_reg`; 10 deregistration jobs |
| Tax, audit documents, financial statements pending | Thin | 178 jobs exist, and `work_status` has no reason; needs Accounting's agreement. 99 jobs have no client link |
| E-invoicing applicability review | New field | Client field and a configured phase |
| Tax residency certificate | New field | Register; 5 jobs exist |

### Section 3D: UBO, AML and governance

| Trigger | State | Source or need |
|---|---|---|
| UBO verification due; AML risk review due; KYC documents expiring; regulatory filing deadline; compliance review overdue; corporate register update | New field | Register dates. Lists 30 and 31 can seed them After 022 ("Periodic review date scheduled") |
| Missing UBO declaration; AML documentation incomplete | New field | Register. `is_ubo` is 0 in both shareholder tables |
| Shareholder, director or manager details outdated | Thin | `licence_extras.shareholder` and `manager` are text with no date |

### Section 3E: communication and relationship

| Trigger | State | Source or need |
|---|---|---|
| Client not contacted; client inactive | New field | No contact history reaches clients: `email_base` has no client link, `General Email` is on 1 record, and communication tables are empty. Needs a contact log from the action buttons |
| Follow-up due | Thin | `accounting_followups` 0 rows, `bd_followups` 1, `banking_applications.next_follow_up` 1 |
| Client has not responded; document request unanswered | Staff log | Created by the Request Documents action |
| Complaint; service dissatisfaction; service opportunity | Staff log | No feedback data exists |
| Multiple pending services | **Now** | 2 clients today, both from imported Visa Registration rows (13 open) |
| Payment overdue | Thin | `business_setup_invoices` 0 rows with no due date; `zoho_documents` 0; Zoho snapshot totals only; job balances 0 |
| Company anniversary | **Now**, proxy | License Issue Date on 232. Issue date is not always incorporation date |
| Birthday | New field | No client date of birth |

### Summary

| State | Reading |
|---|---|
| Useful today | Licence expiring and expired, visa expiring and expired, renewal not initiated, multiple pending services, company anniversary |
| Runs, thin results | Overdue and due today, assigned, payments, CT items, follow-ups |
| Waiting on Task 14 | Most of section 2 and all specials |
| Waiting on new fields, then data entry | Most of 3A, 3C, 3D. **This is the largest cost: the code is small, and the data entry is real work for staff** |

## 15. Errors

- A scan error in one rule logs and continues with the others. The red band shows until a clean run.
- An alert trigger's failure never blocks the business save.
- An email failure records in `alert_deliveries` and retries on the next digest. The bell is unaffected.
- Blocked actions return one plain sentence.

## 16. Testing

SQL tests on throwaway Postgres with the `tests/run-local.sh` pattern, running migrations twice:

- Thresholds: one alert per obligation, priority raises, no duplicate on re-scan.
- A date change closes the alert and opens a new cycle. A resolved alert stays resolved for that date.
- Closed clients and historical rows raise nothing.
- Fallback to admins when nobody is tagged Manager.
- Backlog rows send and escalate nothing in Preview and from the first scan.
- Escalation timing at overdue and at 3 days.
- `alert_can_see()`: employee sees only their own, department only theirs, no cross-department reads.
- A failing alert trigger does not block the save.
- Regulatory: tasks refused before verification, refused without effective date, refused for E4 and proposal statuses, none for clients not marked Applies; intake always Draft.
- Rollback restores the prior state.

`node --test` covers tags, filters and tiles. A test checks `taxLogic` gives the same result from the Edge Function. A browser walk uses TEST client `CL000001`.

## 17. Phased plan

Phases follow the brief's section 9, changed where today's data requires it. Item numbers are from that section. Each phase gets its own detailed plan after this spec is approved. **Each live step needs separate approval:** take a backup, apply migrations to `pnnakrhfzyxudjaghoxx`, deploy functions, merge and push `main`, deploy to `abcrm` and `crm-abcapital.pages.dev`.

| Phase | Holds | Brief items | Depends on | Done when |
|---|---|---|---|---|
| **0 Decisions** | Done 2026-11-05, section 4 | | The user | Decisions recorded. No code |
| **1 Foundation and renewals** | Core tables, `alert_scan`, licence and visa rules, overdue from existing due dates, `client_owners` and bulk assign, Manager tag lookup, escalation, three views, tiles, bell, Coverage, Preview and Triage | 1 (thin), 2, 3 | Phase 0 | Managers triaged the backlog; a real threshold crossing reaches a named person |
| **2 Register and email** | `client_compliance_items`, entry and import screens, establishment card, Ejari, immigration, labour, lease, Emirates ID, passport; calendar; preferences; email digest | 4, part of 3 | Phase 1 live | Staff can enter dates and see them alert; digest reaches staff only |
| **3 Service notifications** | Checkpoint mapping, service due dates, specials, delayed, hold reason, government response log, client documents, government pending, action buttons to Pipeline | 1 (full), 5, 6 | Business Setup Phase C live, plus section 8 requests | A TEST client service raises and closes each notification |
| **4 Follow-ups and payments** | Contact log, Request Documents tracking, follow-up rules, invoice due date | 7, 8 | Phase 1; Zoho one-client test for Zoho data | Unanswered requests and overdue invoices appear |
| **5 Compliance and tax** | UBO and AML types, client tax profile fields, `alert-tax-scan`, Accounting reasons | 9, 10 | Phase 2; Accounting's agreement; tax data entered | Tax tile shows real dates for clients with data |
| **6 Regulatory Centre** | Tables, workflow, enforced gate, impacted list, intake function | 11 | Phase 1. **Can run alongside 2 to 5** | One sample update goes from Draft to closed on the TEST client |
| **7 Relationship and channels** | Inactivity, complaints, feedback, anniversaries; any approved channels | 12 | Phase 4's contact log | As specified then |

**Why Phase 1 is not "overdue tasks" alone:** the brief ranks it first, and it is included, but only 2 rows would appear. Value comes first from licence and visa, which are ranked 2 and 3. Overdue tasks fills out in Phase 3, when services have dates.

**Migration numbering:** a new base folder avoids clashes with Business Setup's `015` to `023`.

## 18. Conflicts with other work

- `022_checkpoints.sql`, Business Setup screens and the flow spec belong to "Client onboarding workflow tabs". Section 8 lists requests only.
- The flow spec's section 17 puts "Automatic reminders" out of scope. This module provides them, so nothing clashes.
- The flow spec's section 18 says assigning `MANAGER` on live needs the user's go-ahead. This module only reads the tag. Tagging someone Manager there also adds them here.
- The department model, when decided, replaces `alert_managers()`. `client_owners` remains useful under it.
- `Main Module/src/App.jsx`'s notification click must route `alert_id`, and Sidebar's label changes. Both are small edits to shared files, so they rebase on `main` at release.

## 19. Out of scope

Sending anything to clients automatically. Filing with any authority. Auto-detecting government responses. Scanning government sites from the CRM. AI in the Centre. HR staff document alerts. Banking alerts in the first phases. Replacing per-module permissions.

## 20. Noticed, not changed

- `public.notifications` has an insert policy `with check (true)`: any signed-in user can place a bell item for any other user. Since the bell will carry work alerts, this should be tightened.
- `taxLogic.js` reports "missing" for every client in `client_master` today. The Dashboard Tax card reflects that.
- 33 visas on Active clients and 78 Active licences are past their date. This may be worth reviewing regardless of this project.
