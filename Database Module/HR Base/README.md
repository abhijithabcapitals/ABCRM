# HR Base

Employee, leave, attendance and payroll data for the CRM, kept in the CRM Supabase project; this folder holds what defines it. The screens are in `HR Module/`.

## Migrations, in order

Apply in this order, after the CRM base schema. Each can run more than once safely, but always run the whole sequence, in order. Later files redefine functions from earlier ones, so re-running 004 or 005 alone resets `hr_dashboard` until 006 to 009 run, and re-running any file alone can undo what 008 fixed.

| Path | Purpose |
|---|---|
| `migrations/001_hr_employees.sql` | `hr_employees`: employee code, name, contact, department, designation, join date, status and the linked CRM login |
| `migrations/002_hr_access.sql` | HR access list, access helpers (`hr_is_admin_or_hr`, `hr_manages`, `hr_my_access`), employee policies, audit log, personal details, manager and exit date |
| `migrations/003_hr_documents.sql` | `hr_documents`, `hr_documents_expiring()` and the private `hr-documents` bucket (HR/admin, or the employee for their own folder) |
| `migrations/004_hr_dashboard.sql` | `hr_employee_tasks()` (open tasks per employee, access scoped) and `hr_dashboard()` (headcount and document counts) |
| `migrations/005_hr_leave.sql` | `hr_settings`, `hr_holidays`, `hr_leave_types` (starts empty), `hr_leave_balances`, `hr_leave_requests` (function-only writes), leave functions, and `hr_dashboard()` with real `pending_leave` |
| `migrations/006_hr_attendance.sql` | `hr_attendance` (function-only writes via `hr_attendance_set`, audited), `hr_attendance_month` grid (stored row, then leave, holiday, weekend), and `hr_dashboard()` with real `present_today` (Asia/Dubai date) |
| `migrations/007_hr_payroll.sql` | Payroll settings (all null until HR confirms), `hr_pay_details` (HR only, IBAN masked in lists and never audited), `hr_pay_runs` and `hr_pay_lines` (function-only writes, locked by trigger once approved), run functions, `hr_gratuity` |
| `migrations/008_hr_review_fixes.sql` | Final review fixes: `hr_employee_link` and the `profile_id` guard, no hard delete of employees or pay details through the API, audit of employee fields and of the HR access list, Left removes HR and manager power, Absent inside paid leave costs nothing, cancel rule, locked-month warnings (`{warning}` return) and `hr_payrun_changes_after`, no run for a future month, `hr_payrun_ack_pay_change`, `on_payroll`, Asia/Dubai expiry date |

| `migrations/009_hr_biometric.sql` | Biometric punches, sync status, `hr_employees.biometric_code`, `hr_attendance.source`, roll-up into attendance. See `Biometric Base/README.md` |
| `migrations/010_hr_day_status.sql` | `hr_attendance_days` (every day's status, worked out when read), `hr_attendance_range`, `hr_dashboard_period`, WFH Saturday rules, admin approval of attendance edits (`hr_attendance_edits`), Absent in pay, carry-forward and the over-balance split of leave |
| `migrations/011_hr_calendar_marks.sql` | `hr_calendar_marks` (names on the calendar with no effect on attendance, pay or leave) and `hr_calendar_mark_confirm`, which turns a UAE mark into a holiday on the announced date |
| `migrations/012_hr_profile_fields.sql` | Photo path, visa status and permanent address on `hr_employee_personal` |
| `migrations/013_hr_pay_rules.sql` | 9-hour late rule, Annual leave accrual and ledger, pay deduction from the ledger, gratuity from unpaid days only, `hr_salary_payments` and its functions |
| `migrations/014_hr_requests.sql` | `hr_insurance`, `hr_mobile_plans`, `hr_assets`, `hr_finance_managers`, `hr_requests` and its functions (half day, work from home, late concession, overtime, expense claims, other), and what approved requests do to days, leave and pay |
| `migrations/015_hr_attendance_hr_power.sql` | The HR list changes attendance directly and decides approvals, except for their own day |
| `migrations/016_hr_self_corrections.sql` | Employees ask to use Annual leave, work from home or correct the times on their own day, HR validates, and `hr_attendance_history` shows the trail |
| `seed_ab_capital.sql` | Company values, run once on live after 014: hours, Sunday off, WFH Saturdays, Absent from blank days, deduction settings, Annual and Unpaid leave, 1,000 AED salaries. Not numbered, so test fixtures stay their own |
| `seed_holidays.sql` | Holidays and marks for 2026 to 2036, run once on live after 011. Its header says where each date comes from |
| `seed_leave_balances_2026.sql` | Opening Annual leave balances and join dates, run once on live after `seed_ab_capital.sql` |

Admins add or import employees in Settings > Employees, then onboard a member from one of those rows.

`docs/PAYROLL_RULES.md` records the UAE labour-law rules the payroll uses, with a source or an UNVERIFIED mark on each, and in section H the decisions still needed from the user.

## Tests

Run `bash "Database Module/HR Base/tests/run-local.sh"`. It starts a throwaway Postgres, applies 001 to 016 twice (idempotence), then runs the twelve test files (`010_hr_test.sql` access and employees, `020_hr_leave_test.sql`, `030_hr_attendance_test.sql`, `040_hr_payroll_test.sql`, `050_hr_review_fixes_test.sql`, `060_hr_biometric_test.sql`, `070_hr_day_status_test.sql`, `080_hr_calendar_profile_test.sql`, `090_hr_pay_rules_test.sql`, `100_hr_requests_test.sql`, `110_hr_attendance_power_test.sql`, `120_hr_self_corrections_test.sql`) and prints a passed/failed count for each. Nothing touches Supabase. It needs PostgreSQL 18 under `C:\Program Files\PostgreSQL\18\bin` (or `PG_BIN`), and it reuses `Banking Base/tests/000_stub.sql`.

The server sometimes fails to start with `pg_ctl: could not start server`. Run the script again.

The script's exit code comes from the last command, so a failed check does not give a non-zero exit. Read the output for `FAIL` and for `failed` counts above zero.

The tests use fixed fixture values for the payroll settings. They show the arithmetic behaves as designed for those values, not that those values are right.

## Who sees what

Enforced by row-level security on every `hr_*` table and on the `hr-documents` bucket.

- Admin and the HR access list: everything. Only an admin edits the HR access list and links logins to employees. Someone on the list whose linked employee is Left loses this, unless an admin by role.
- Nobody deletes an employee or pay details through the app or API. End a record with status and exit date.
- Manager: direct reports' job details, leave and attendance, and approval of their leave. No salary data, and none of their personal details or documents. A manager has their own record, documents and pay like any employee. A manager who is Left stops managing.
- Employee: own record, documents, leave, attendance, and own payslips from approved runs.
- **Managers can see task titles of their reports through the dashboard** (`hr_employee_tasks()`). The titles come from `public.tasks`, including tasks in spaces the manager has no access to.

## Before go-live

Migrations 001 to 009 are on live Supabase (2026-11-02). The rest needs the user's decision or approval first.

1. **Apply migrations 001 to 009 in order.** Done 2026-11-02. Function bodies, columns, policies and triggers were compared with a copy built from these files and match. A later change to a migration needs its own live step.
2. **Redeploy the `admin-users` Edge Function, then deploy the frontend.** Redeploy from `Main Module/db/edge-function-admin-users.ts` (the `hr` tab was added to its tab list) before the frontend goes out, so the HR tab can be granted when the screens arrive. The redeploy is a manual step in Supabase.
3. **Own-profile update policies are dropped on live.** Checked 2026-11-02: `profiles` has only the admin update policy and two read policies.
4. **Free-zone question.** The company is AB Capital Services FZE. `docs/PAYROLL_RULES.md` covers mainland employers only and says not to apply it to free-zone employers. The user must say which free zone applies and whether these rules apply to it. Until then payroll and gratuity must not be relied on.
5. **Fill every null setting** in HR Settings. A run or gratuity calculation is blocked until each is set: pay day divisor mode, pay days basis (when the mode is fixed), unpaid leave wage base, gratuity fraction method, gratuity cap base, gratuity daily divisor, and whether service counts the end date. Leave types start empty, and the weekend days and holidays need entering.
6. **WPS.** No bank or MOHRE sample or specification exists, so the WPS file is not built and its button is hidden. Obtain a sample from the bank or exchange house before building it.
7. **Adviser confirmation.** A qualified UAE labour adviser must confirm the rules in `docs/PAYROLL_RULES.md` and the settings chosen. The open decisions are in section H of that file.
8. **Run the first real payroll in parallel with the current method** and compare every figure before relying on it.
9. **Amendment history unchecked.** The legislation portal (uaelegislation.gov.ae) returns 403 to automated access, so the amendment history was not read. Decree-Law 20/2023 and any amendments to Cabinet Resolution 1/2022 were not checked. Someone must check them by hand.
10. **Known limits to tell staff**: half-pay leave needs a manual adjustment on the line; overnight shifts are not supported; a mid-month pay change blocks approval until HR adjusts or acknowledges it, and a later change blocks again; changes to a month after its run is approved do not change that run, so HR adds an adjustment in a later run; overtime and public-holiday pay are not built; in fixed divisor mode with a small basis a line can pay 0 for worked days, so choose that setting with the adviser.
11. **Repeat the browser click-through on a real test database**, including whether a manager's network responses contain no salary rows. The click-through done so far used a stub that does not run row-level security.
