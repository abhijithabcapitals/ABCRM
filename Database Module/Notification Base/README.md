# Notification Base

Database layer of the Notification and Alert Centre. Spec: `Hot Alerts Module/docs/2026-11-05-notification-centre-design.md`.

## Migrations
| File | What it does |
|---|---|
| `001_alert_core.sql` | `alert_settings` (mode, seeded `Preview`), `alert_rules`, `alerts`, `alert_recipients`, `alert_events` (append-only), `alert_scan_log`, `client_owners`; manager rule, visibility, bell and `alert_raise` |
| `002_alert_scan.sql` | `alert_step_for`, seeded rules, `alert_candidate`, one `alert_rule_*` function per rule, `alert_scan()` (advisory lock, per-rule error isolation, system close) and the `alert-scan` cron job at 02:00 |
| `003_alert_actions.sql` | Browser actions (`alert_assign`, `alert_set_status`, `alert_resolve`, `alert_escalate`, `alert_mark_read`), `alert_escalate_due()` (Live scan only), client owner functions, and admin-only `alert_rule_save`, `alert_set_mode`, `alert_scan_now` |

Every migration is re-runnable. Rollback for 001 to 004 is `rollback/001_004_rollback.sql` (safe twice; deletes `alert_centre` bell rows only).

## Rules
- No browser writes to any table here. Writes go through `SECURITY DEFINER` functions with `search_path = public, pg_temp`. Browser reads: `alerts` (through `alert_can_see`) and `client_owners` (admin or tagged Manager).
- "Manager" is the live tag (`banking_user_roles.role = 'MANAGER'`, or an Active `hr_employees` row with designation `Manager`). `alert_managers()` is the only lookup; nobody tagged returns admins with `fell_back = true`.
- Mode `Preview`: alerts are made as backlog, no bell, only admins see them. `Triage`: bell only for reason `Assigned`. `Live`: all bells. Backlog rows never bell.
- Priorities stored: `Critical`, `High`, `Medium`, `Normal`. "Today" is the Asia/Dubai date.
- Alerts hold no passport or Emirates ID numbers.

## Tests
`bash "Database Module/Notification Base/tests/run-local.sh"` starts a throwaway Postgres on port 55447, loads `tests/000_stub.sql`, runs migrations twice, runs every `NNN_*_test.sql`, then the rollback twice and a reapply. Nothing touches Supabase. New migrations and tests are picked up by glob. `SKIP_MIGRATIONS=1` records a RED run.
