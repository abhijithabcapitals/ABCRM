#!/usr/bin/env bash
# Runs the Admin Base migrations twice (idempotence) and the trigger tests on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Admin Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55434
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
for pass in 1 2; do
  for f in "$HERE"/../migrations/001_*.sql "$HERE"/../migrations/002_*.sql "$HERE"/../migrations/003_*.sql; do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migrations pass $pass ok"
done
"${PSQL[@]}" -t -f "$HERE/010_triggers_test.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed'
"${PSQL[@]}" -t -f "$HERE/020_audit_trail_test.sql" 2>&1 | grep -E "ok |FAILED|ERROR|passed|error"
