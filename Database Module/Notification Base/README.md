# Notification Base

Database layer of the Notification and Alert Centre. Spec: `Hot Alerts Module/docs/2026-11-05-notification-centre-design.md`.

## Migrations
| File | What it does |
|---|---|
| `001_alert_core.sql` | `alert_settings` (mode, seeded `Preview`), `alert_rules`, `alerts`, `alert_recipients`, `alert_events` (append-only), `alert_scan_log`, `client_owners`; manager rule, visibility, bell and `alert_raise` |
| `002_alert_scan.sql` | `alert_step_for`, seeded rules, `alert_candidate`, one `alert_rule_*` function per rule, `alert_scan()` (advisory lock, per-rule error isolation, system close) and the `alert-scan` cron job at 02:00 |
| `003_alert_actions.sql` | Browser actions (`alert_assign`, `alert_set_status`, `alert_resolve`, `alert_escalate`, `alert_mark_read`), `alert_escalate_due()` (Live scan only), client owner functions, and admin-only `alert_rule_save`, `alert_set_mode`, `alert_scan_now` |
| `004_alert_reads.sql` | Browser reads behind the page, each checking the caller: `alert_list`, `alert_tiles`, `alert_detail`, `alert_management_summary`, `alert_coverage`, `alert_my_access`, `alert_rule_list`, `alert_manager_list` |
| `005_centre_tab_for_all.sql` | `my_tabs()` also returns `mytasks` for every signed-in user, so everyone has the Notification Centre tab. Unticking it in Settings has no effect. Rollback: `rollback/005_rollback.sql` |

Every migration is re-runnable. Rollback for 001 to 004 is `rollback/001_004_rollback.sql` (safe twice; deletes `alert_centre` bell rows only).

- Rollback cannot remove locked audit rows. Where the Admin Base audit trail is attached, `audit_trail` keeps what it recorded about these tables, and its lock refuses any delete. Rollback drops the alert tables themselves, including `alert_events`.
- Reapplying re-enables a paused cron job: `002` calls `cron.schedule('alert-scan', ...)`, which replaces the job as active. After a reapply, pause it again if it should stay off.

## Adding a rule
1. In `002_alert_scan.sql`, write `alert_rule_<code>()` returning `setof alert_candidate`. It only reads, and returns every row it checked. A null `due_date` counts as missing data.
2. In the same file, add the rule to the seed insert (category, department, title and action templates, steps), and revoke `execute` on the function from `public, anon, authenticated`.
3. Add `drop function if exists` for it to the rollback, and a test to `tests/020_scan_test.sql`. The count in the "rule functions are not browser-callable" test goes up by one.

`alert_scan()` finds the function by name from the rule's code, so it needs no change. An enabled rule must have at least one step.

## Rules
- No browser writes to any table here. Writes go through `SECURITY DEFINER` functions with `search_path = public, pg_temp`. Browser reads: `alerts` (through `alert_can_see`) and `client_owners` (admin or tagged Manager).
- "Manager" is the live tag (`banking_user_roles.role = 'MANAGER'`, or an Active `hr_employees` row with designation `Manager`). `alert_managers()` is the only lookup; nobody tagged returns admins with `fell_back = true`.
- Mode `Preview`: alerts are made as backlog, no bell, only admins see them. `Triage`: bell only for reason `Assigned`. `Live`: all bells. Backlog rows never bell.
- Priorities stored: `Critical`, `High`, `Medium`, `Normal`. "Today" is the Asia/Dubai date.
- Alerts hold no passport or Emirates ID numbers.

## Tests
`bash "Database Module/Notification Base/tests/run-local.sh"` starts a throwaway Postgres on port 55447, loads `tests/000_stub.sql`, runs migrations twice, runs every `NNN_*_test.sql`, then the rollback twice and a reapply. Nothing touches Supabase. New migrations and tests are picked up by glob. `SKIP_MIGRATIONS=1` records a RED run.
