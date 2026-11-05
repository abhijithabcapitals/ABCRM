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
| `006_compliance_register.sql` | `client_compliance_items`, its screens' RPCs, expiry rules per item type |
| `007_alert_preferences.sql` | Per-person category and channel choices; `alert_bell` honours them; Critical always bells |
| `008_alert_email.sql` | `alert_deliveries`, `alert_email_build`, `alert_email_record`. Off until `email_enabled` is true. Edge Function `alert-digest` sends; no schedule is created here |
| `009_alert_calendar.sql` | `alert_calendar` |
| `010_regulatory.sql` | Regulatory Updates Centre, its enforced gate, `regulatory_update_intake` for the Tax Agent later |
| `011_followups_payments.sql` | Contact log, document requests, follow-up and payment rules, items logged by hand |
| `012_compliance_tax.sql` | Review-date rules, `alert_tax_items`, `tax_deadline`, off-by-default `ct_dereg_review`. Edge Function `alert-tax-scan` fills the items |
| `013_relationship.sql` | `multiple_services`, plus off-by-default not contacted, inactive and anniversary rules |
| `006_compliance_register.sql` | `client_compliance_items` (RLS, read through `client_compliance_can_read()`), browser functions `client_compliance_save`, `_close`, `_list`, `_import`, `_can_read`, `_can_write` (admin, tagged Manager or the Clients tab), nine `compliance_*` rules (Business Setup), `alert_compliance_candidates(type)` with one `alert_rule_compliance_*` wrapper per type, the renewals tile and management summary now count `compliance_%` rules, and `alert_my_access` returns `can_register`. Types with no rule (UBO, AML, KYC and so on) raise nothing until Phase 5 |

Every migration is re-runnable. Rollback for 001 to 004 is `rollback/001_004_rollback.sql` (safe twice; deletes `alert_centre` bell rows only). Rollback for Phase 2 (006 onward) is `rollback/006_009_rollback.sql`: run it first, then 005, then 001 to 004. It restores 004's read functions and drops what Phase 2 added.

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
- Alerts hold no passport or Emirates ID numbers. The register `reference` column is for the register screen only; the candidate function never selects it.

## Tests
`bash "Database Module/Notification Base/tests/run-local.sh"` starts a throwaway Postgres on port 55447, loads `tests/000_stub.sql`, runs migrations twice, runs every `NNN_*_test.sql`, then the rollback twice and a reapply. Nothing touches Supabase. New migrations and tests are picked up by glob. `SKIP_MIGRATIONS=1` records a RED run.
