#!/usr/bin/env bash
# Runs the Notification Base migrations twice (idempotence), every test file, then the rollback twice and a reapply, on a throwaway cluster.
# Nothing touches Supabase.
#   bash "Database Module/Notification Base/tests/run-local.sh"
# To add a migration or a test, drop NNN_*.sql into migrations/ or NNN0_*_test.sql into tests/: both are picked up by glob, in order.
# SKIP_MIGRATIONS=1 runs the tests with no migrations (to record RED).
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55447
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
MIGS=("$HERE"/../migrations/[0-9][0-9][0-9]_*.sql)

migrate() {
  for pass in "$@"; do
    for f in "${MIGS[@]}"; do
      "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
    done
    echo "migrations pass $pass ok"
  done
}

"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
[ "${SKIP_MIGRATIONS:-}" = 1 ] || migrate 1 2

# Each test stops the whole run on failure: grep alone would hide psql's status.
for f in "$HERE"/[0-9][0-9][0-9]_*_test.sql; do
  OUT="$("${PSQL[@]}" -t -f "$f" 2>&1)"; RC=$?
  echo "$OUT" | grep -E "ok |FAILED|ERROR|passed|error"
  [ "$RC" -eq 0 ] || { echo "FAILED $(basename "$f") exit $RC"; exit 1; }
done

# A reapply keeps a changed alert mode (the tests leave it on Live).
for f in "${MIGS[@]}"; do "${PSQL[@]}" -f "$f" >/dev/null 2>&1 || { echo "FAILED reapply of $f"; exit 1; }; done
OUT="$("${PSQL[@]}" -t -A -c "select case when value = '\"Live\"' then 'ok reapply keeps a changed alert_mode' else 'FAILED reapply reset alert_mode' end from public.alert_settings where key = 'alert_mode'")"
echo "$OUT"
case "$OUT" in "ok "*) ;; *) exit 1 ;; esac

# Held lock: a second psql holds the scan's advisory lock, so a single session cannot fake it.
# A new job is due today; a scan that ran would raise an alert for it, a skipped one adds nothing.
"${PSQL[@]}" -c "insert into public.accounting_job_list (client_id, client_name, service_name, service_department, due_date, work_status) values ('CS', 'Service LLC', 'Job added under lock', 'Accounting', (now() at time zone 'Asia/Dubai')::date, 'In progress')" || exit 1
LOGS_BEFORE="$("${PSQL[@]}" -t -A -c "select count(*) from public.alert_scan_log where status = 'Skipped'")"
ALERTS_BEFORE="$("${PSQL[@]}" -t -A -c "select count(*) from public.alerts")"
"${PSQL[@]}" -c "select pg_advisory_lock(hashtextextended('alert_scan', 0)); select pg_sleep(60)" >/dev/null 2>&1 &
HOLDER=$!
HELD=0
for i in $(seq 1 50); do
  HELD="$("${PSQL[@]}" -t -A -c "select count(*) from pg_locks where locktype = 'advisory' and granted and mode = 'ExclusiveLock'")"
  [ "$HELD" -ge 1 ] && break
  sleep 0.2
done
[ "$HELD" -ge 1 ] || { echo "FAILED held-lock test: the second session never took the lock"; kill $HOLDER 2>/dev/null; exit 1; }
SKIP_RESULT="$("${PSQL[@]}" -t -A -c "select alert_scan()->>'status'")"
"${PSQL[@]}" -q -c "select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(60)%' and pid <> pg_backend_pid()" >/dev/null
wait $HOLDER 2>/dev/null
LOGS_AFTER="$("${PSQL[@]}" -t -A -c "select count(*) from public.alert_scan_log where status = 'Skipped'")"
ALERTS_AFTER="$("${PSQL[@]}" -t -A -c "select count(*) from public.alerts")"
if [ "$SKIP_RESULT" = "Skipped" ] && [ "$LOGS_AFTER" -eq $((LOGS_BEFORE + 1)) ] && [ "$ALERTS_AFTER" -eq "$ALERTS_BEFORE" ]; then
  echo "ok held lock: scan logs Skipped, adds nothing"
else
  echo "FAILED held lock: result=$SKIP_RESULT skipped_logs $LOGS_BEFORE->$LOGS_AFTER alerts $ALERTS_BEFORE->$ALERTS_AFTER"; exit 1
fi
# Triage here: Live would call alert_escalate_due(), which Task 4 defines.
"${PSQL[@]}" -c "update public.alert_settings set value = '\"Triage\"' where key = 'alert_mode'" || exit 1
SCAN_RESULT="$("${PSQL[@]}" -t -A -c "select alert_scan()->>'status'")"
ALERTS_RERUN="$("${PSQL[@]}" -t -A -c "select count(*) from public.alerts")"
if [ "$SCAN_RESULT" = "Ok" ] && [ "$ALERTS_RERUN" -eq $((ALERTS_BEFORE + 1)) ]; then OUT="ok scan runs again once the lock is free and raises the new job"; else OUT="FAILED scan after lock release: $SCAN_RESULT alerts $ALERTS_BEFORE->$ALERTS_RERUN"; fi
echo "$OUT"
case "$OUT" in "ok "*) ;; *) exit 1 ;; esac

# Rollback twice. A notification of another type must survive; alert_centre bell rows must go.
"${PSQL[@]}" -c "insert into public.notifications (user_id, type, title) select id, 'other', 'keep me' from public.profiles limit 1" || exit 1
BEFORE="$("${PSQL[@]}" -t -A -c "select count(*) from public.notifications where type = 'alert_centre'")"
[ "$BEFORE" -gt 0 ] || { echo "FAILED no alert_centre bell rows to roll back"; exit 1; }
for i in 1 2; do "${PSQL[@]}" -f "$HERE/../rollback/001_004_rollback.sql" || { echo "FAILED rollback pass $i"; exit 1; }; done
OUT="$("${PSQL[@]}" -t -A -c "select case
  when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and (c.relname like 'alert\_%' or c.relname = 'alerts' or c.relname = 'client_owners')) > 0 then 'FAILED rollback left relations'
  when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'alert\_%') > 0 then 'FAILED rollback left functions'
  when (select count(*) from cron.job where jobname = 'alert-scan') > 0 then 'FAILED rollback left the alert-scan job'
  when exists (select 1 from pg_type where typname = 'alert_candidate') then 'FAILED rollback left alert_candidate'
  when (select count(*) from public.notifications where type = 'alert_centre') > 0 then 'FAILED rollback left alert_centre bell rows'
  when (select count(*) from public.notifications where type = 'other') = 0 then 'FAILED rollback removed other notifications'
  else 'ok rollback clean, twice, other notifications kept' end")"
echo "$OUT"
case "$OUT" in "ok "*) ;; *) exit 1 ;; esac
migrate "reapply"
OUT="$("${PSQL[@]}" -t -A -c "select case when (select count(*) from cron.job where jobname = 'alert-scan') = 1 then 'ok alert-scan scheduled again after reapply' else 'FAILED alert-scan not scheduled' end")"
echo "$OUT"; case "$OUT" in "ok "*) ;; *) exit 1 ;; esac
echo "ok migrations reapply after rollback"
