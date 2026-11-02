# HR Module

The CRM's **HR** tab: employee records, documents with expiry alerts, leave, attendance and payroll with printable payslips, plus each employee's open tasks on the dashboard.
Data lives in `Database Module/HR Base` (tables `public.hr_*` in the CRM Supabase project). Design: `docs/specs/2026-11-01-hr-module-design.md`. Plan: `docs/plans/2026-11-01-hr-module.md`.

## How it is connected

Same pattern as the Banking Module. The Main Module imports this folder directly.

- `Main Module/vite.config.js`: alias `@hr`. `src/App.jsx`: view `hr`. `Sidebar.jsx`: nav item. `src/tabs.js`: tab key `hr`.
- Shared Supabase client and auth through `@app/supabase`, used only by `services/hrApi.js`. Users are `public.profiles`.
- The look comes from the Banking Module (`@banking/components/shared`, `banking.css`), so the two stay alike.
- Opening the tab needs the `hr` tab granted in Settings > Users & Permissions. Tab access only opens the page; row-level security decides what data comes back.
- `Main Module/db/edge-function-admin-users.ts` lists `hr` among the tabs. The deployed `admin-users` Edge Function must be redeployed by hand for that to take effect.

## Who sees what

| Role | Decided by | Tabs | Data |
|---|---|---|---|
| Admin, HR | `profiles.role = 'admin'`, or the HR access list | All seven. Settings is for admin and HR | Everything. Only an admin edits the HR access list and links logins on the employee screen. An HR-list person whose linked employee is Left loses this, unless an admin by role |
| Manager | `hr_employees.manager_id` points at them | Dashboard, Employees, Documents (own only), Leave, Attendance, Payroll (own pay only) | Direct reports' job details, leave and attendance. No salary data, and none of their personal details or documents. A Left manager is treated as an employee |
| Employee | Employee record linked to their login | Dashboard, Employees, Documents, Leave, Attendance, Payroll (own pay only) | Own record, documents, leave, attendance and approved payslips |
| Unlinked member | No linked employee record | None; a message asks them to get linked | Nothing |

**Managers can see the titles of their reports' open tasks** through the dashboard. Those titles come from `public.tasks` and can name clients or work the manager has no other access to. This is deliberate in the design; know it before granting a manager role.

## Folder map

| Path | Purpose |
|---|---|
| `components/HRModule.jsx` | Shell, role lookup, tab list |
| `components/{Dashboard,Employees,Documents,Leave,Attendance,Payroll,Settings}.jsx` | One component per tab |
| `components/hr.css` | HR-only styles on top of the Banking styles |
| `logic/tabs.js` | Which tabs each role sees |
| `logic/{expiry,documentFields,taskView,attendance,payroll,payslip}.js` | Pure rules with tests: expiry bands, autofill field mapping, task grouping, attendance grid, payroll screen helpers, payslip HTML |
| `services/hrApi.js` | The only file that talks to Supabase and storage, plus the local Document Module call |
| `tests/` | `node --test "HR Module/tests/"` |
| `docs/USER_MANUAL.md` | Staff guide |

## Decisions the brief left open

| Decision | Choice | Why |
|---|---|---|
| Where data is saved | Supabase; `HR Base` holds migrations, tests and docs | Browser-hosted CRM, no local program needed for core use |
| Tasks | Read-only view of `public.tasks`, matched by `profiles.full_name = any(tasks.assignees)` | `assignees` stores names as text. Two employees with the same name share tasks; the dashboard warns |
| Pay figures | Worked out only by database functions; the screen and payslip never calculate | One place for the rules, covered by SQL tests |
| Payroll rules | Every pay rule PAYROLL_RULES.md could not source is a null setting that blocks a run until HR confirms it | No invented law. See `Database Module/HR Base/docs/PAYROLL_RULES.md` |
| Payroll approval | Locked on approval. A different person should approve than prepared; the same person needs a recorded acknowledgement | Separation of duties |
| Half-pay leave | Not calculated. Paid leave counts as fully paid and the line says half-pay types need a manual adjustment | Kept the first release small; HR sees the figures |
| Mid-month pay change | Not split. Blocks approval until HR adjusts or acknowledges (audited, no amount, not on the payslip). A later change blocks again | The split rule is an undecided policy |
| Changes after a month is locked | The change is saved and the approved run stays as it was. The screen warns, and the run panel lists the changes for HR to adjust in a later run | An approved run never changes |
| Gratuity | HR panel on the Payroll tab shows the database's breakdown as an estimate needing confirmation. Never added to pay | Statute covers the formula; several inputs are unconfirmed settings |
| Overnight shifts | Not supported: the database refuses a time out earlier than the time in | Attendance is a day record |
| WPS file | Not built. The button is hidden | No bank sample or official specification was available |
| PDF payslip | Browser print dialog (Save as PDF) from an approved run; not stored | No new dependency |
| Document reading | Autofill goes through the local Document Module; if it is not running, type the fields | Uploads always work without it |
| Attendance | Entered by hand; no biometric import | Out of scope |

## Tests

- `Database Module/HR Base/tests/run-local.sh`: business rules and row-level security as signed-in users, on a throwaway Postgres.
- `node --test "HR Module/tests/"`: logic modules, plus `static.test.mjs`: every `hr_*` table enables row-level security and only `services/hrApi.js` imports the Supabase client.
- The screens added by the final review fixes (Link login, entitlement form, gratuity panel, pay-change acknowledgement, changes after approval, locked-month notices) were built and pass `npm run build`, and their pure helpers have tests, but they were not clicked through in a browser. Their database rules are covered by `050_hr_review_fixes_test.sql`.
- The earlier UI has been click-tested only against a stub Supabase client that serves canned rows, not against a real database, and the stub does not run row-level security. Whether salary rows reach a manager's browser is proved by the SQL tests, not by the click-through. Repeat the click-through on a real test database after applying the migrations.
