# Database migrations

SQL you run manually in the **Supabase SQL editor** (Dashboard → SQL Editor → New query → paste → Run). Each file is idempotent — safe to re-run.

## Files

### `phase3_automations_engine.sql` — Automations execution engine (Phase 3)

Makes the automation rules built in the app UI actually fire. Runs entirely
inside Postgres (triggers + functions + pg_cron), so **no service key ever
touches the browser**.

**What it installs**
- `automation_runs` — audit log of every automation that fired.
- `automation_email_queue` — outbox for the `email` notification channel;
  drained later by the Phase 4 email sender.
- Trigger functions on `tasks`, `task_field_values`, and `task_comments`
  that dispatch matching automations in real time.
- `run_date_based_automations()` + a daily `pg_cron` job (06:00 UTC) for
  "N days before/after a date" rules.

**Prerequisites**
- The `automations` table (created during Phase 2).
- For date-based rules: enable **pg_cron** (Dashboard → Database → Extensions).
  If it isn't enabled when you run the file, everything else still installs —
  just re-run the final `pg_cron` block after enabling it.

**Triggers supported**
`task_created`, `assigned`, `status_changed`, `field_changed`
(any field / any type, optional "changes to value"), `comment_mention`,
and `date_based`.

**Actions supported**
`notify` (in-app now; email queued for Phase 4), `change_status`, `assign`,
`set_field`.

**Notes**
- Re-entrancy guard: an action that updates a task will *not* recursively
  re-trigger automations within the same transaction (prevents loops). A rule
  therefore reacts to *user* changes, not to another rule's changes in the
  same commit.
- Functions are `SECURITY DEFINER` so the engine can create notifications for
  other users without relying on permissive RLS.
