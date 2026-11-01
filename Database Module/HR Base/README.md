# HR Base

Employee records for the CRM, kept in the CRM Supabase project; this folder holds what defines them.

| Path | Purpose |
|---|---|
| `migrations/001_hr_employees.sql` | `hr_employees`: employee code, name, contact, department, designation, join date, status and the linked CRM login |

Admins add or import employees in Settings > Employees, then onboard a member from one of those rows. Run after the base schema.
