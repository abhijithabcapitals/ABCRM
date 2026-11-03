# HR Attendance, Dashboard and Pay Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Work out each day's status from punches and rules, use it for pay and for new dashboard and sheet views, and put manual attendance edits behind admin approval.

**Architecture:** Migration 010 adds one internal day-status function. A scoped wrapper feeds every screen, and payroll reads the internal one, so all share one answer. Company values (salary, shift settings, WFH rules, leave types) go in a live-only seed file, like `schedule.sql`, so existing test fixtures keep working.

**Tech Stack:** PostgreSQL 18 locally and Supabase live, plpgsql, React with the Banking shared components, plain SVG and CSS, `node --test`.

**Spec:** `HR Module/docs/specs/2026-11-02-hr-attendance-dashboard-design.md`

All paths are relative to `D:\Abhijith Projects\CRM-hr`, branch `hr-module`.

## Global Constraints

- Hours: Monday to Friday 09:30 to 18:30, Saturday 09:30 to 14:00, Sunday off.
- Late is strictly after 09:30. Overtime is strictly after the day's end. There is no grace period. Neither changes pay.
- WFH Saturdays: `last` up to 2026-12-31, `second_and_last` from 2027-01-01.
- Deduction = monthly salary / calendar days in the month x unpaid days.
- Annual leave is 30 days, not prorated, carried forward in full, and beyond the balance it is unpaid.
- Only `profiles.role = 'admin'` approves. An admin's own edit applies at once and is audited.
- "Today" is the Asia/Dubai date.
- No new npm dependency. Charts are plain SVG. Only `services/hrApi.js` imports the Supabase client (`static.test.mjs` enforces this).
- Migrations are idempotent. New `hr_*` tables enable RLS. Functions revoke from `public, anon, authenticated`, then grant only what the screens call. On Supabase, default privileges grant new functions to `anon`, so the revoke must name each function.
- Nothing touches live or `main` until Task 8, and Task 8 needs the user's go-ahead.

## Review Focus

1. A person with no join date and no punches: no Absent days and no deduction, never a full year of Absent. Pinned in Task 1.
2. A month where every working day is Absent: pay is the Sundays' share, never negative. Pinned in Task 3.
3. An edit approved for a month whose payroll run is approved: it saves, warns, and the run is unchanged. Pinned in Task 2.
4. A biometric sync updates a day after an edit request was raised: approval still wins, and later syncs leave the day alone. Pinned in Task 2.
5. The Yearly dashboard for 14 people: one set-based query with a usable response, no per-day function loop. Pinned in Task 1.

---

### Task 1: Day status and period counts

**Files:**
- Create: `Database Module/HR Base/migrations/010_hr_day_status.sql`
- Create: `Database Module/HR Base/tests/070_hr_day_status_test.sql`
- Modify: `Database Module/HR Base/tests/run-local.sh`

**Interfaces:**
- Consumes: `hr_attendance`, `hr_holidays`, `hr_leave_requests`, `hr_leave_types`, `hr_biometric_punches`, `hr_biometric_employee(text)`, access helpers.
- Produces:
  - `hr_settings` columns: `shift_start time default '09:30'`, `shift_end time default '18:30'`, `saturday_end time default '14:00'`, `absent_from_blank_days boolean not null default false`.
  - Table `hr_wfh_saturday_rules(id, effective_from date not null, effective_to date, pattern text check in ('last','second_and_last'))`. HR writes, anyone linked reads.
  - `hr_attendance.status` also allows `WFH`. The times check becomes `status in ('Present','WFH') or both null`.
  - `hr_is_wfh_saturday(p_date date) returns boolean`: internal.
  - `hr_attendance_days(p_from date, p_to date, p_employee uuid default null)`: internal, no caller check. Returns `(employee_id, employee_code, full_name, employee_status, exit_date, work_date, status, leave_kind, time_in, time_out, late_minutes int, overtime_minutes int, source, note)`. `status` is one of `Present, Absent, WFH, Leave, Holiday, Weekend`, or null for blank. `leave_kind` is `Annual` for paid leave and `Unpaid` for unpaid.
  - `hr_attendance_range(p_from date, p_to date)`: same columns plus `pending_edit_id uuid`, scoped HR all, manager direct reports, employee own. The table for pending edits comes in Task 2, so this function is redefined there. Here it returns null for that column. Granted to `authenticated`.
  - `hr_dashboard_period(p_period text, p_date date) returns jsonb`: `{from, to, active, counts:{present,absent,late,overtime,wfh,leave_annual,leave_unpaid}, people:{present:[{employee_id,full_name,days}],...}, series:[{date,present,absent,late}]}`. `p_period` is `day`, `week`, `month` or `year`. Week is Monday to Sunday. Refuses an unknown period. Granted to `authenticated`, using the same scope.

`absent_from_blank_days` keeps existing fixtures valid: it stays false in tests 010 to 060 and is set true by the live seed and by test 070. With it false, a blank day stays null.

Status order is exactly the spec's: manual row, approved leave, holiday, biometric row, WFH Saturday, weekly off (`extract(dow) = any(weekend_days)`), Absent. Range start is `join_date`, else the person's first punch via `hr_biometric_employee`. Range end is the earlier of today and `exit_date`. A Left person with no exit date ends at their last punch.

Write `hr_attendance_days` as one query over `generate_series` with joins and aggregates, not a per-day function call.

- [ ] **Step 1: Write failing tests in `070_hr_day_status_test.sql`**, using the helpers from `050` (`public.as_user`, `public.must_fail`, `t_result`). It sets `absent_from_blank_days = true`, `weekend_days = '{0}'`, and the two WFH rule rows. Assertions:
  - Each step of the order wins over the next: manual Absent over punches, leave over punches, holiday over punches, punches over WFH Saturday.
  - `2026-11-28` (last Saturday) with no punch is WFH. `2026-11-14` (2nd Saturday) with no punch is Absent. `2027-01-09` (2nd Saturday) is WFH. `2027-01-30` (last Saturday) is WFH. `2027-01-16` is Absent.
  - First punch `09:30:00` gives `late_minutes = 0`. `09:31:00` gives 1.
  - Weekday last punch `18:30:00` gives overtime 0. `18:45:00` gives 15. Saturday `14:10:00` gives 10.
  - One distinct punch: `time_out` null and overtime 0. Sunday punch: Present, late 0, overtime 0.
  - No join date and no punches: no `Absent` rows at all. No join date with first punch `2026-10-01`: nothing before that date.
  - Exit date `2026-10-15`: blank after it. Future date: blank. Today with no punch: Absent.
  - With `absent_from_blank_days = false`, a blank working day has null status.
  - Scope: employee sees own rows, manager sees reports, HR sees all, unlinked sees none. `anon` cannot execute.
  - `hr_dashboard_period('day', d)` gives exact counts for a fixture day. `'week'` for a Wednesday runs Monday to Sunday. `'bad'` fails with `%period%`.
  - Performance guard: `hr_dashboard_period('year', ...)` on 14 fixture people and 300 days finishes under 2000 ms, measured with `clock_timestamp()`.

- [ ] **Step 2: Add migration 010 and the test to `run-local.sh`. Run it and see 070 fail**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: FAIL lines in the 070 block, for missing functions.

- [ ] **Step 3: Implement the columns, table and functions above in `010_hr_day_status.sql`**

- [ ] **Step 4: Run the suite**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: `0 failed` in every block, and existing counts unchanged (98, 71, 63, 202, 83, 44).

- [ ] **Step 5: Commit**

```bash
git add "Database Module/HR Base"
git commit -m "Work out each day's attendance status from punches and rules"
```

### Task 2: Edit requests and approval

**Files:**
- Modify: `Database Module/HR Base/migrations/010_hr_day_status.sql`
- Modify: `Database Module/HR Base/tests/070_hr_day_status_test.sql`
- Modify: `Database Module/HR Base/tests/030_hr_attendance_test.sql`, plus any other suite that sets a day as a non-admin

**Interfaces:**
- Consumes: `hr_attendance_set` (008, returns `{warning}`), `hr_locked_month_warning`, `hr_audit`, `hr_manages`.
- Produces:
  - Table `hr_attendance_edits(id, employee_id, work_date, status, time_in, time_out, note, old_values jsonb, reason text not null, requested_by uuid, requested_at, state text check in ('pending','approved','rejected','superseded'), decided_by uuid, decided_at, decision_note)`. Partial unique index on `(employee_id, work_date) where state = 'pending'`. Select only, by RLS: HR all, a manager for direct reports and own requests. Function-only writes.
  - `hr_attendance_set(...)`: same signature and return, but raises `Only an administrator can change attendance directly. Send it for approval` unless `admin_is()`.
  - `hr_attendance_request(p_employee uuid, p_date date, p_status text, p_in time, p_out time, p_note text, p_reason text) returns uuid`: HR list or the person's manager. Same validation as `hr_attendance_set`, plus a required reason. Nobody but HR requests for themselves. Marks an older pending request `superseded`.
  - `hr_attendance_decide(p_edit uuid, p_approve boolean, p_note text) returns jsonb`: `admin_is()` only. Approve applies through the same write as `hr_attendance_set` and returns `{warning}`. Reject needs a note.
  - `hr_attendance_edits_pending() returns int`: for the tab count.
  - `hr_attendance_range`: redefined so `pending_edit_id` is real.

- [ ] **Step 1: Add failing tests to 070**
  - Admin set applies at once and writes an audit row.
  - HR-list non-admin and manager `hr_attendance_set` fail with `%administrator%`.
  - Manager request for a report: returns an id and the cell is unchanged. `hr_attendance_range` shows `pending_edit_id`.
  - Blank reason fails. Request for self as manager fails.
  - Second request supersedes the first. Only one row is pending.
  - Non-admin `hr_attendance_decide` fails, including the HR list.
  - Approve changes the cell with `source = 'manual'` and writes an audit row.
  - Reject without a note fails. Reject with a note leaves the cell alone.
  - Deciding a decided edit fails.
  - Biometric roll-up between request and approval: approval wins, and a later `hr_biometric_ingest` reports `manual`.
  - Approving in a month with an approved run returns a `warning` containing `locked`, and the run's lines are unchanged.

- [ ] **Step 2: Run and see them fail**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: FAIL lines in the 070 block.

- [ ] **Step 3: Implement the table and functions in 010.** Move the shared write into an internal `hr_attendance_write(...)`, called by both set and decide.

- [ ] **Step 4: Change suites that set days as a non-admin** to run as the admin fixture, or to assert the refusal. Keep the intent of each test.

- [ ] **Step 5: Run the suite**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: `0 failed` in every block.

- [ ] **Step 6: Commit**

```bash
git add "Database Module/HR Base"
git commit -m "Put manual attendance changes behind admin approval"
```

### Task 3: Pay and leave rules, and the live seed

**Files:**
- Modify: `Database Module/HR Base/migrations/010_hr_day_status.sql`
- Modify: `Database Module/HR Base/tests/070_hr_day_status_test.sql`
- Create: `Database Module/HR Base/seed_ab_capital.sql`

**Interfaces:**
- Consumes: `hr_attendance_days`, `hr_pay_compute` (008), `hr_leave_balance`, `hr_leave_decide`.
- Produces:
  - `hr_pay_unpaid_days`: same signature. Days from `hr_attendance_days` with status `Absent` or `leave_kind = 'Unpaid'`. `why` is `Absent` or `Unpaid leave`.
  - `hr_pay_compute`: same signature. Add the WFH rules and `absent_from_blank_days` to `inputs`, so a rule change stops approval.
  - `hr_leave_types.carry_forward boolean not null default false`. `hr_settings.leave_carry_start_year int not null default 2026`.
  - `hr_leave_balance`: same columns plus `carried numeric`. For a carry-forward type, `carried` is the previous year's remaining, from the start year onward, never below 0. It is 0 for years before the person's join year. `remaining` includes it.
  - `hr_leave_decide`: same signature. Approving a carry-forward paid type beyond the balance splits the row into one for the balance and one under the type `Unpaid`, returning a warning that names both counts. If no balance is left, the whole row moves to `Unpaid`. If no `Unpaid` type exists, it raises `Add an Unpaid leave type first`.

`seed_ab_capital.sql` is live only and is run once, after 010:
- Settings: `weekend_days = '{0}'`, `absent_from_blank_days = true`, `pay_day_divisor_mode = 'calendar_days'`, `pay_unpaid_wage_base = 'total'`. Gratuity settings stay null.
- WFH rules: `last`, effective up to 2026-12-31, and `second_and_last`, effective from 2027-01-01.
- Leave types: `Annual` (paid, 30, carry forward) and `Unpaid` (not paid).
- `hr_pay_details`: 1,000 basic, `{}` allowances, effective 2026-01-01, for each employee with no pay row.

- [ ] **Step 1: Add failing tests to 070**, with those settings:
  - 1,000 salary, 30-day month, one Absent: deduction `33.33`, net `966.67`.
  - 31-day month, two unpaid leave days: deduction `64.52`, net `935.48`.
  - WFH Saturday and Annual leave: no deduction.
  - Every working day of the month Absent: net is 1000 x Sundays / days in the month, and not negative.
  - Late and overtime days: no deduction.
  - Annual balance: 30 in 2026. 5 taken in 2026 gives 2027 `carried = 25` and `remaining = 55`. No cap across 2028.
  - Joined 2027-06-01: 2026 gives no carry into 2027, and 2027 entitlement is 30.
  - Over balance: 32 days requested with 30 left splits into 30 Annual and 2 Unpaid, with a warning, and the 2 days are deducted.
  - Holiday and Sunday are not counted as leave days. A WFH Saturday is.
  - Changing a WFH rule after a run is reviewed stops `hr_payrun_approve` with `%Recalculate%`.

- [ ] **Step 2: Run and see them fail**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: FAIL lines in the 070 block.

- [ ] **Step 3: Implement in 010, and write `seed_ab_capital.sql`**

- [ ] **Step 4: Run the suite, then test the seed.** Add a line to the end of `070` that applies the seed in a rolled-back transaction with two fixture employees, and asserts one pay row each and that a second run adds none.

Run: `bash "Database Module/HR Base/tests/run-local.sh"`
Expected: `0 failed` in every block.

- [ ] **Step 5: Commit**

```bash
git add "Database Module/HR Base"
git commit -m "Apply the attendance, deduction and carry-forward rules to pay"
```

### Task 4: Screen helpers and API

**Files:**
- Modify: `HR Module/logic/attendance.js`, `HR Module/services/hrApi.js`, `HR Module/logic/tabs.js`
- Test: `HR Module/tests/attendance.test.mjs`, `HR Module/tests/tabs.test.mjs`

**Interfaces:**
- Produces, in `logic/attendance.js`:
  - `STATUSES` includes `WFH`. `SHORT` map moves here: `{Present:"P",Absent:"A",WFH:"WH",Leave:"L",Holiday:"H",Weekend:"W"}`.
  - `groupRange(rows)`: replaces `groupMonth`. Same shape, with `counts` also holding `Late` and `Overtime`.
  - `weekDays(date) -> string[7]`: Monday to Sunday. `yearDays(year) -> string[]`.
  - `periodRange(period, date) -> {from, to}`. `shiftPeriod(period, date, by) -> date`.
  - `editFormNote(isAdmin) -> string`: says it applies now, or goes for approval.
- Produces, in `hrApi.js`: `attendanceRange(from, to)`, `attendanceRequest(employee, date, status, in, out, note, reason)`, `attendanceDecide(edit, approve, note)`, `attendanceEdits(state)`, `attendanceEditsPending()`, `dashboardPeriod(period, date)`, `wfhRules()`, `saveWfhRule(id, values)`. Remove `attendanceMonth`.
- Produces, in `tabs.js`, in this order:
  - `dashboard`: all roles
  - `employees`, labelled `All Employees`: all roles
  - `attendance`, labelled `Attendance Sheet`: all roles
  - `salary`, labelled `Salary Master`: `hr` only
  - `leave`, `payroll`, `documents`: all roles
  - `approvals`, labelled `Approvals`: `hr` only, shown by `HRModule` only when `profile.role === 'admin'`
  - `settings`: `hr` only

- [ ] **Step 1: Write failing tests:** `weekDays('2026-11-04')` starts `2026-11-02` and ends `2026-11-08`. `periodRange('month','2026-02-10')` ends `2026-02-28`. `periodRange('year','2026-02-10')` runs `2026-01-01` to `2026-12-31`. `shiftPeriod('month','2026-01-31',1)` is in February. `groupRange` counts a Present-and-late row in both `Present` and `Late`. Tab order and role lists as above.

- [ ] **Step 2: Run and see them fail**

Run: `node --test "HR Module/tests/"`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement**

- [ ] **Step 4: Run tests**

Run: `node --test "HR Module/tests/"`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add "HR Module"
git commit -m "Add screen helpers and calls for the new attendance views"
```

### Task 5: Attendance Sheet views

**Files:**
- Modify: `HR Module/components/Attendance.jsx` (becomes the view switch)
- Create: `HR Module/components/attendance/MonthGrid.jsx`, `CalendarView.jsx`, `WeekView.jsx`, `YearHeatmap.jsx`, `DailyList.jsx`, `EditDayModal.jsx`
- Modify: `HR Module/components/hr.css`

**Interfaces:**
- Consumes: Task 4 helpers and API.
- Produces: `<Attendance role employeeId profile />`. `HRModule` passes `profile`, which it already has.

Requirements:
- Views: Month grid (default), Calendar, Week, Year, Daily. The chosen view is kept in component state. Calendar and Year have a person picker. A non-HR employee sees only themselves.
- Month grid: Present and Absent totals sit next to the name, and Late and Overtime sit beside them. Name and totals are frozen with `position: sticky` when scrolling. Cells use `minmax(0, 1fr)`-style sizing so a month fits about 1200 px without scrolling. All cell letters are centred. Fix the top-aligned `W`.
- A cell with a pending edit shows a marker and the tooltip `Pending approval`.
- `EditDayModal`: status (including WFH), time in, time out, note. A reason is required unless the user is an admin. An admin's save calls `attendanceSet`; anyone else's calls `attendanceRequest`. Show any returned warning.
- `BiometricPanel` stays under the sheet for HR. Replace its sub text: `e-timeoffice. A day with punches becomes Present. A day edited by hand is never overwritten. A working day with no punches counts as Absent.`

- [ ] **Step 1: Build the views**

- [ ] **Step 2: Build**

Run: `cd "Main Module" && npm run build`
Expected: `built in`, with no errors.

- [ ] **Step 3: Check in the browser against a throwaway local database or the dev server, without saving.** At 1200 px and at phone width, for each view: a full month is visible, totals stay put when scrolling, and there is no page-level sideways scroll.

- [ ] **Step 4: Commit**

```bash
git add "HR Module"
git commit -m "Add calendar, week, year and daily views to the Attendance Sheet"
```

### Task 6: Dashboard

**Files:**
- Modify: `HR Module/components/Dashboard.jsx`
- Create: `HR Module/components/dashboard/PeriodCards.jsx`, `Charts.jsx`
- Modify: `HR Module/components/HRModule.jsx`, `HR Module/components/hr.css`

**Interfaces:**
- Consumes: `dashboardPeriod`, `periodRange`, `shiftPeriod`.
- Produces: `<Dashboard onOpenTask onGo role />`. `onGo(tabKey)` comes from `HRModule` and drives the quick buttons.

Requirements:
- Daily, Weekly, Monthly and Yearly switch, with previous and next.
- Cards: Active, Present, Absent, Late, Overtime, Work From Home, On Leave showing Annual and Unpaid. Clicking one opens a modal listing its people and day counts.
- Quick buttons for HR only: Add New Employee (opens All Employees with its add form), All Employee List, Salary Master, Attendance Sheet.
- Charts in plain SVG with text labels: a daily share chart of Present, Absent and Late, and a present-per-day chart for the period. They read from `series`, and use theme colours from `hr.css`. An empty period shows a plain message.
- The existing document and task blocks stay below.

- [ ] **Step 1: Build it**

- [ ] **Step 2: Build**

Run: `cd "Main Module" && npm run build`
Expected: `built in`, with no errors.

- [ ] **Step 3: Check in the browser, without saving:** each period loads, card totals match the listed people, and the screen works at phone width.

- [ ] **Step 4: Commit**

```bash
git add "HR Module"
git commit -m "Add the period dashboard with cards and charts"
```

### Task 7: Salary Master, Approvals, Settings

**Files:**
- Create: `HR Module/components/SalaryMaster.jsx`, `HR Module/components/Approvals.jsx`
- Modify: `HR Module/components/Payroll.jsx` (remove the `PayDetails` panel), `HR Module/components/Settings.jsx`, `HR Module/components/HRModule.jsx`, `HR Module/components/Employees.jsx`

**Interfaces:**
- Consumes: `payDetailsList`, `savePayDetail`, `payDetailFull`, `attendanceEdits`, `attendanceDecide`, `attendanceEditsPending`, `wfhRules`, `saveWfhRule`.
- Produces: `SCREENS` gains `salary` and `approvals`. The Approvals tab label shows the pending count. `Employees` accepts `startAdding` so the dashboard button opens its form.

Requirements:
- Salary Master: one row per person with the latest salary and effective date, with history on expand. Editing moves the existing `PayDetails` form here, and an edit adds a dated row. The IBAN stays masked in lists.
- Approvals: pending list with person, date, old value, proposed value, reason and requester, with Approve and Reject (a note is required to reject). Below it, recent decisions. Show any warning.
- Settings: shift start, shift end, Saturday end, and the WFH Saturday rules. The leave type form gains the carry-forward box.

- [ ] **Step 1: Build it**

- [ ] **Step 2: Test and build**

Run: `node --test "HR Module/tests/"`, then `cd "Main Module" && npm run build`
Expected: all pass, and `built in`.

- [ ] **Step 3: Commit**

```bash
git add "HR Module"
git commit -m "Add Salary Master and Approvals, and the shift settings"
```

### Task 8: Docs and rollout

**Files:**
- Modify: `HR Module/README.md`, `HR Module/docs/USER_MANUAL.md`, `Database Module/HR Base/README.md`, `Database Module/HR Base/Biometric Base/README.md`, `Database Module/HR Base/tests/run-local.sh`'s description in the README

- [ ] **Step 1: Update the docs.** List migration 010 and `seed_ab_capital.sql`. Replace "a blank day stays blank" and "the sync never marks Absent". Describe the approval rule and new tabs.

- [ ] **Step 2: Run everything**

Run: `bash "Database Module/HR Base/tests/run-local.sh"`, `node --test "HR Module/tests/"`, `cd "Main Module" && npm run build`
Expected: `0 failed` in every block, all pass, `built in`.

- [ ] **Step 3: Commit, then ask the user before anything live.** The remaining steps change live data and production.

- [ ] **Step 4: After the user's yes, apply `010` to live, then `seed_ab_capital.sql`.** Compare each `hr_*` function's hash with a local copy built from the files, as was done for 001 to 009. Check the security advisor.

- [ ] **Step 5: Check on live:** `hr_dashboard_period('day','2026-11-02')` gives 14 active, 11 present, 6 late, 3 absent.

- [ ] **Step 6: After the user's yes, merge `origin/main` into `hr-module`, rerun Step 2, and push to `main`.** Confirm the GitHub Pages run succeeds.

- [ ] **Step 7: Compare with the portal on at least three days, including a Saturday.** Record any mismatch for the user.
