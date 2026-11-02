# HR attendance, dashboard and pay rules: design

Date: 2026-11-02. Status: awaiting the user's review. Nothing here is built.

## Purpose

HR replaces daily use of the e-timeoffice portal for AB Capital Services FZE. Staff see attendance by day, week, month and year, in several layouts. Pay is worked out from attendance by the user's rules, and manual attendance changes need an admin's approval.

Success means:

- The dashboard's daily counts match the portal for the same day. On 2026-11-02 both show 14 active, 11 present, 6 late, 3 absent.
- Every card, sheet view and payroll line gives the same answer for the same person and day.
- No manual change reaches attendance or pay without an admin.

## Rules from the user

### Working time

| Day | Hours | Dates | Mode |
|---|---|---|---|
| Monday to Friday | 09:30 to 18:30 | Always | Office |
| Saturday | 09:30 to 14:00 | Always | Office, unless a WFH Saturday |
| Last Saturday of the month | 09:30 to 14:00 | Up to 2026-12-31 | WFH |
| 2nd and last Saturday of the month | 09:30 to 14:00 | From 2027-01-01 | WFH |
| Sunday | None | Always | Weekly off |

- Late: first punch after 09:30. A punch at exactly 09:30 is not late. There is no grace period.
- Overtime: last punch after the day's end time (18:30, or 14:00 on Saturday).
- A day with one distinct punch has no time out, so no overtime.
- Late and overtime are counted and shown. They do not change pay.

### Pay and leave

- Salary Master starts at 1,000 AED basic with no allowances for each of the 14 employees, effective 2026-01-01, editable per person. The user gave this figure; they should confirm it is a real wage before any payslip goes out.
- Deduction = monthly salary / calendar days in the month x unpaid days. Unpaid days are Absent days and unpaid leave days.
- Annual leave: 30 paid days a year. Unused days carry forward in full, with no cap and no expiry.
- Every employee gets the full 30 days on 1 January, and on joining in a later month. It is not prorated.
- Annual leave beyond the balance is unpaid.
- Leave days count Monday to Saturday, including WFH Saturdays, and exclude Sundays and holidays.
- The 2026 carry-forward starts at zero, and leave taken before this system is not counted. HR enters adjustments for either.

### Approvals

- Only an admin (`profiles.role = 'admin'`) approves.
- An admin's own edit applies at once and is audited.
- Anyone else who may edit (the HR access list, a manager for direct reports) creates a pending request. The cell keeps its old value until an admin approves.
- A request needs a reason. A rejection keeps the old value and records who rejected it and why.

## Status of a day

Late, Overtime, WFH and Absent are worked out when read, not stored. A later rule change therefore applies without rewriting days, and every screen shares one answer.

For one person and one date, the first match wins:

1. Manual attendance row (`hr_attendance.source = 'manual'`, including approved edits): its status and times.
2. Approved leave: On Leave (Annual) or On Leave (Unpaid).
3. Holiday.
4. Punches (`source = 'biometric'`): Present, with late and overtime minutes. On a Sunday it is Present with no late or overtime, because there are no hours.
5. WFH Saturday: WFH.
6. Sunday: Weekly Off.
7. Otherwise Absent.

Outside the range below, the day is blank and counts as nothing:

- The start is `join_date`, or the person's first punch if there is no join date. Someone with neither has no Absent days.
- The end is today (Asia/Dubai) or `exit_date`, whichever is earlier. A Left employee with no exit date has blank days after their last punch.

Today counts as Absent when there is no punch yet, as the portal does.

This replaces the earlier rule that a blank day stays blank. **Blank working days now count as Absent and reduce pay.** Active employees who stop coming, currently ALEX and LAKSHAY BHATIA, keep showing Absent until HR records an exit date.

## Data changes: migration 010

Applied to live after approval, like 001 to 009.

- `hr_settings`: add `shift_start` 09:30, `shift_end` 18:30, `saturday_end` 14:00. Set `weekend_days` to `{0}`, `pay_day_divisor_mode` to `calendar_days` and `pay_unpaid_wage_base` to `total`. Gratuity settings stay null.
- `hr_wfh_saturday_rules`: `effective_from`, `effective_to`, `pattern` (`last` or `second_and_last`). Two seeded rows give the dates above. HR edits them in Settings, so a later change needs no code.
- `hr_attendance`: allow status `WFH`, with times allowed.
- `hr_attendance_edits`: employee, date, proposed status, times and note, the value at request time, reason, requested by and when, status (`pending`, `approved`, `rejected`, `superseded`), decided by, when and why. Function-only writes. One pending request per person and date; a newer one marks the older `superseded`.
- `hr_leave_types`: seed Annual (paid, 30 days) and Unpaid (not paid).
- `hr_pay_details`: seed the 1,000 AED rows.

Functions:

- `hr_day_rule(date)`: internal. Returns start, end and WFH flag for a date.
- `hr_attendance_range(from, to)`: one row per in-scope person per day, with status, times, late and overtime minutes, source and any pending edit. Scoped as today: HR all, manager direct reports, employee own. All sheet views and cards read this.
- `hr_dashboard_period(period, date)`: `day`, `week`, `month` or `year`. Returns card counts and the people behind each. Week runs Monday to Sunday. Longer periods count person-days. Active is the headcount at the period's end.
- `hr_attendance_set`: admin only; applies and audits. `hr_attendance_request` creates a pending edit. `hr_attendance_decide` approves or rejects, admin only.
- `hr_pay_unpaid_days`: counts worked-out Absent days plus unpaid leave, so payroll follows the status rules. WFH days are paid. An Absent day inside approved paid leave stays paid, because leave ranks above it.
- `hr_leave_balance`: adds carry-forward, the previous year's remaining balance, from 2026 onward.
- `hr_leave_decide`: approving Annual leave beyond the balance splits the request into an Annual row up to the balance and an Unpaid row for the rest, and returns a warning naming the split.

Unchanged: the sync and `hr-biometric-sync`. The roll-up still writes Present and never overwrites a manual day.

## Screens

Existing HR tabs change to: Dashboard, All Employees, Attendance Sheet, Salary Master, Leave, Payroll, Documents, Settings. Admins also get Approvals, with a count of pending requests. Role limits stay as they are. Salary Master and Approvals are not shown to managers or employees.

### Dashboard

- Switch: Daily, Weekly, Monthly, Yearly, with previous and next.
- Cards: Active, Present, Absent, Late, Overtime, Work From Home, On Leave (split into Annual and Unpaid). Clicking a card lists its people.
- Quick buttons: Add New Employee, All Employee List, Salary Master, Attendance Sheet.
- Charts: daily share of Present, Absent and Late, and present counts across the period. Drawn with plain SVG, no new library.

### Attendance Sheet

Views, on one tab:

- **Month grid:** people by day. Totals sit next to the name. Name and totals stay frozen when scrolling. Cells shrink so a month fits a normal screen where possible, and all cell letters are centred.
- **Calendar:** one person's month as a wall calendar, showing status and times.
- **Week:** people by day, showing in and out times.
- **Year heatmap:** one person's year, coloured by status.
- **Daily list:** one date, every person, with times and late and overtime minutes.

Clicking a cell opens the edit form: status (including WFH), times, and a reason. An admin's save applies. Anyone else's save creates a request, and the cell shows it as pending.

### Other screens

- **All Employees:** the current list, with Add New Employee.
- **Salary Master:** one row per person with current salary. Editing adds a dated row, so history is kept. The IBAN stays masked in lists.
- **Approvals:** pending requests with old and proposed values, and approve or reject. It also lists recent decisions.
- **Settings:** add shift times and WFH Saturday rules.
- **Biometric panel:** change its text, which says no day is marked Absent.

## Payroll effects

A payroll run still needs a join date and IBAN for each person. Today nobody has an IBAN and 13 of 14 have no join date, so no run can be approved until HR enters them.

These remain open and are not decided by this work:

- `PAYROLL_RULES.md` covers mainland employers, and this company is an FZE. The free-zone question stands.
- That file records that a worker may carry forward at most half of annual leave, or agree otherwise with the employer. Full carry-forward follows the user's instruction, so an adviser should confirm it.
- The other adviser checks in `../../../Database Module/HR Base/README.md` still apply.

## Not included

Late penalties, overtime pay, half-day leave, half-pay sick leave, the WPS file, employee self-service requests for attendance changes, and overnight shifts. Selfie punch, shown on the portal, is not part of the API document.

## Testing

- `Database Module/HR Base/tests/070_hr_day_status_test.sql`:
  - each step of the status order
  - late and overtime edges, including exactly 09:30 and 18:30
  - Saturday hours and WFH patterns on both sides of 2027-01-01
  - start and end of range, including no join date
  - request, approve, reject and supersede, as admin and non-admin
  - no self-approval path for non-admins
  - carry-forward across years
  - the over-balance split
  - deduction arithmetic
- `run-local.sh` adds migration 010 and this test. All existing suites must still pass, and those that assert the old blank-day rule change to the new one.
- Node tests for the new screen helpers, and `npm run build`.
- Browser check of every view on live as admin, without saving.
- Compare dashboard counts with the portal on at least three days, including a Saturday, before relying on them.

## Rollout

1. Build on `hr-module` in `CRM-hr`.
2. Apply migration 010 to live.
3. Merge to `main`, which publishes to GitHub Pages.
4. Update `HR Module/README.md`, `HR Module/docs/USER_MANUAL.md`, `Database Module/HR Base/README.md` and `Biometric Base/README.md`.

`schedule.sql` is separate and can run whenever the user approves it.
