# HR Base

Employee records for the CRM, kept in the CRM Supabase project; this folder holds what defines them.

| Path | Purpose |
|---|---|
| `migrations/001_hr_employees.sql` | `hr_employees`: employee code, name, contact, department, designation, join date, status and the linked CRM login |
| `migrations/002_hr_access.sql` | HR access list, access helpers, employee policies, audit log, personal details |
| `migrations/003_hr_documents.sql` | `hr_documents`, `hr_documents_expiring()` and the private `hr-documents` bucket (HR/admin, or the employee for their own folder) |
| `migrations/004_hr_dashboard.sql` | `hr_employee_tasks()` (open tasks per employee, access scoped) and `hr_dashboard()` (headcount and document counts) |
| `migrations/005_hr_leave.sql` | `hr_settings`, `hr_holidays`, `hr_leave_types` (starts empty), `hr_leave_balances`, `hr_leave_requests` (function-only writes), leave functions, and `hr_dashboard()` with real `pending_leave` |

Admins add or import employees in Settings > Employees, then onboard a member from one of those rows. Run after the base schema.

Test locally with `bash "Database Module/HR Base/tests/run-local.sh"`; nothing touches Supabase.
