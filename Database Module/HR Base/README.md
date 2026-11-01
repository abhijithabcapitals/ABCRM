# HR Base

Employee records for the CRM, kept in the CRM Supabase project; this folder holds what defines them.

| Path | Purpose |
|---|---|
| `migrations/001_hr_employees.sql` | `hr_employees`: employee code, name, contact, department, designation, join date, status and the linked CRM login |
| `migrations/002_hr_access.sql` | HR access list, access helpers, employee policies, audit log, personal details |
| `migrations/003_hr_documents.sql` | `hr_documents`, `hr_documents_expiring()` and the private `hr-documents` bucket (HR/admin, or the employee for their own folder) |
| `migrations/004_hr_dashboard.sql` | `hr_employee_tasks()` (open tasks per employee, access scoped) and `hr_dashboard()` (headcount and document counts) |
| `migrations/005_hr_leave.sql` | `hr_settings`, `hr_holidays`, `hr_leave_types` (starts empty), `hr_leave_balances`, `hr_leave_requests` (function-only writes), leave functions, and `hr_dashboard()` with real `pending_leave` |
| `migrations/006_hr_attendance.sql` | `hr_attendance` (function-only writes via `hr_attendance_set`, audited), `hr_attendance_month` grid (stored row, then leave, holiday, weekend), and `hr_dashboard()` with real `present_today` (Asia/Dubai date) |
| `migrations/007_hr_payroll.sql` | Payroll settings (all null until HR confirms), `hr_pay_details` (HR only, IBAN masked in lists and never audited), `hr_pay_runs` and `hr_pay_lines` (function-only writes, locked by trigger once approved), run functions, `hr_gratuity` |

Admins add or import employees in Settings > Employees, then onboard a member from one of those rows. Run after the base schema.

Test locally with `bash "Database Module/HR Base/tests/run-local.sh"`; nothing touches Supabase.
