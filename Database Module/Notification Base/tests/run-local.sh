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

# Rollback twice. A notification of another type must survive; alert_centre bell rows must go.
"${PSQL[@]}" -c "insert into public.notifications (user_id, type, title) select id, 'other', 'keep me' from public.profiles limit 1" || exit 1
BEFORE="$("${PSQL[@]}" -t -A -c "select count(*) from public.notifications where type = 'alert_centre'")"
[ "$BEFORE" -gt 0 ] || { echo "FAILED no alert_centre bell rows to roll back"; exit 1; }
for i in 1 2; do "${PSQL[@]}" -f "$HERE/../rollback/001_004_rollback.sql" || { echo "FAILED rollback pass $i"; exit 1; }; done
OUT="$("${PSQL[@]}" -t -A -c "select case
  when (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and (c.relname like 'alert\_%' or c.relname = 'alerts' or c.relname = 'client_owners')) > 0 then 'FAILED rollback left relations'
  when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'alert\_%') > 0 then 'FAILED rollback left functions'
  when (select count(*) from public.notifications where type = 'alert_centre') > 0 then 'FAILED rollback left alert_centre bell rows'
  when (select count(*) from public.notifications where type = 'other') = 0 then 'FAILED rollback removed other notifications'
  else 'ok rollback clean, twice, other notifications kept' end")"
echo "$OUT"
case "$OUT" in "ok "*) ;; *) exit 1 ;; esac
migrate "reapply"
echo "ok migrations reapply after rollback"
