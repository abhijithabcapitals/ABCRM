# HR Module: Design

Date: 2026-11-01
Status: awaiting review

## Purpose

Give the CRM one place to track employees and everything related to HR: records, documents, leave, attendance and payroll, with each employee's tasks visible on the dashboard. It is an HR tab in the CRM, available from any PC with no local program required for core use.

## Decisions

| Topic | Decision |
|---|---|
| Storage | Rows and files in the CRM Supabase project. `Database Module/HR Base` holds migrations, tests and docs |
| Release | All features ship in one release. Payroll is built last because it depends on employee and attendance data |
| Tasks | Read-only view on the HR Dashboard tab, from the existing `public.tasks`. No HR task tables and no task editing in this module |
| Access | Admin and HR list, managers, and employee self-service, enforced by RLS |
| Attendance | Entered by hand. Biometric device import is out of scope |
| Payment | The module produces payslips and a WPS file only. It never sends money or submits to a bank |

The access model was recommended by Claude and not explicitly chosen by the user. It is open to change in this review.

## Structure

`HR Module/` follows the Banking Module layout:

| Path | Purpose |
|---|---|
| `index.js` | Module entry |
| `components/` | `HRModule.jsx` shell and one component per tab |
| `logic/` | Pure rules with tests: leave days, expiry bands, pay preview, WPS file output |
| `services/hrApi.js` | All Supabase and storage access |
| `tests/` | `node --test "HR Module/tests/"` |
| `docs/` | This spec and `USER_MANUAL.md` |

`Database Module/HR Base/` holds `README.md`, `migrations/` and `tests/`.

Main Module changes are limited to wiring: the `@hr` alias in `vite.config.js`, the `hr` view in `src/App.jsx`, and the nav item in `Sidebar.jsx`. The module uses `@app/supabase` for its client and auth.

## Tabs

| Tab | Contents |
|---|---|
| Dashboard | Task view, headcount, today's attendance, pending leave, documents expiring |
| Employees | Employee list and profile |
| Documents | Visa, passport, Emirates ID, labour card and other types, with expiry bands |
| Leave | Requests, approvals, balances |
| Attendance | Daily entry and monthly view |
| Payroll | Pay details, monthly runs, payslips, WPS file |
| Settings | HR access list, leave types, holidays, payroll settings |

Users see only the tabs and rows their access allows.

### Dashboard task view

- Shows open and overdue tasks per employee, matched through `hr_employees.profile_id` to the task assignee.
- Admin and HR see all employees. A manager sees direct reports. An employee sees their own.
- Clicking a task opens the existing CRM task screen.
- An employee with no linked profile is shown as "no CRM login" and has no tasks.
- The view reads tasks through a function that returns only these fields and applies the rules above. `tasks.assignees` stores names as text, so the match is `profiles.full_name = any(tasks.assignees)`. Two people with the same name would share tasks, and the view warns when that happens.

### Document alerts

Bands are expired, within 30 days, within 60 days and within 90 days. Alerts appear on the HR Dashboard. Linking them to the CRM's existing attention banner is decided during planning, after reading how Banking does it.

### Reading documents

Uploads always save to private storage and work with no local program. Autofill from a document goes through `docai` through the same local service Banking uses (`VITE_CLIENT_MODULE_URL`). If that service is not running, the user types the fields by hand and the upload still succeeds. Autofilled values are shown for a person to check before saving.

## Data

All tables are `public.hr_*`, with `created_at`, `created_by`, `updated_at` and `updated_by`. Migrations can run more than once safely.

| Table | Holds |
|---|---|
| `hr_employees` | Already exists (`HR Base/migrations/001_hr_employees.sql`, used by Settings > Employees and member onboarding): `employee_code`, name, contact, department, designation, join date, status, `profile_id`. This module adds `manager_id` and `exit_date` |
| `hr_employee_personal` | Date of birth, nationality, address, emergency contact. Separate table because RLS works per row and managers must not see these |
| `hr_access` | Profiles on the HR access list |
| `hr_documents` | Employee, type, number, issue and expiry dates, storage path |
| `hr_leave_types` | Name, paid or unpaid, annual entitlement |
| `hr_leave_balances` | Employee, type, year, entitlement, adjustment |
| `hr_leave_requests` | Employee, type, dates, days, status, approver, decision time |
| `hr_holidays` | Date and name |
| `hr_attendance` | Employee, date, status, in and out times. Unique per employee and date |
| `hr_pay_details` | Salary components with effective dates, IBAN, bank routing code, WPS labour-card details |
| `hr_pay_runs` | Month, status (`draft`, `approved`), prepared by, approved by |
| `hr_pay_lines` | Run, employee, earnings and deductions, net pay, calculation notes |
| `hr_audit_log` | Who changed pay details, leave decisions or run status, with old and new values |

Employee and pay records are never hard deleted. A leaver's status changes, and history remains.

Documents use a new private bucket, opened only through short-lived signed links.

## Permissions

RLS is enforced on every `hr_*` table and on the bucket. Helper functions: `hr_is_admin_or_hr()` and `hr_manages(employee_id)`.

| Role | Access |
|---|---|
| Admin (`profiles.role = 'admin'`) and HR list | Everything |
| Manager (`hr_employees.manager_id`) | Direct reports' job details, leave and attendance; approves their leave. No pay data and no personal documents |
| Employee (linked `profile_id`) | Own record, documents, leave and attendance. Can request leave. Own payslips from approved runs only |
| Anyone else | No access |

Opening the tab also needs the `hr` tab granted in Settings, through the existing tab access (`Main Module/src/tabs.js`). Tab access only controls the page; RLS controls the data. An employee with no CRM login has no self-service, and HR enters leave for them. Nobody can approve their own leave. If an employee has no manager, HR approves.

## Payroll flow

1. **Draft.** HR creates the month's run. It loads pay details, attendance and unpaid leave into one line per employee.
2. **Review.** HR adds adjustments. Each line shows how its figure was worked out.
3. **Approve.** A database function recalculates the run, checks it against what HR reviewed and locks it. Only one run can exist per month.
4. **Output.** Payslips and the WPS file are generated from the locked run.

Approved runs cannot be edited. Corrections go in as an adjustment in a later run.

Separation of roles: a different admin should approve than the person who prepared the run. If they are the same person, approval needs an explicit acknowledgement, recorded in `hr_audit_log`.

## Rules that must come from official sources

These are not assumed. Each needs a recorded source before payroll is released:

- WPS file format: official specification, or a sample from the user's bank or exchange house.
- Daily rate and unpaid-leave deduction.
- Gratuity and final settlement.
- Statutory leave entitlements used as defaults in `hr_leave_types`.

The calculation inputs live in payroll settings, so a rule change does not need a code change where that is practical. Gratuity and final settlement are calculated in a separate function with its own tests.

## Error handling

- Saves show the database's error in plain words, and entered data stays on screen.
- Overlapping leave for one employee is rejected by the database.
- A run with missing pay details or missing IBAN cannot be approved, and the affected employees are listed.
- Editing attendance or leave after a month's run is approved does not change that run.
- If a document upload fails, no document row is saved.

## Testing

- Unit tests for everything in `logic/`, including month and year boundaries, using `node --test`.
- SQL tests on a throwaway database in `HR Base/tests`, following `Banking Base/tests`: each role's RLS access, locked runs, leave overlap and no self-approval.
- Click-through in the browser with test data and each role.
- First real payroll runs alongside the user's current method, and figures are compared before it is relied on.

## Rollout

1. Build on a new git branch in its own worktree, cut from `ai-usage-optimize`, which holds the existing `hr_employees` work and is not yet in `main`. No live changes.
2. Apply migrations to live Supabase only after the user approves them.
3. Merge and deploy only after the user approves.

## Out of scope

Biometric device import, recruitment, performance reviews, staff expense claims, HR-specific task creation, bank submission, and filing HR documents into local folders.
