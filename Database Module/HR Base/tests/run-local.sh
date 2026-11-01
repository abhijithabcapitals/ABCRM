#!/usr/bin/env bash
# Runs the HR migrations twice (idempotence) and the HR tests on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/HR Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BANK="$HERE/../../Banking Base/tests"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55434
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$BANK/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
for pass in 1 2; do
  for f in "$HERE"/../migrations/001_*.sql "$HERE"/../migrations/002_*.sql "$HERE"/../migrations/003_*.sql "$HERE"/../migrations/004_*.sql "$HERE"/../migrations/005_*.sql "$HERE"/../migrations/006_*.sql "$HERE"/../migrations/007_*.sql; do
    [ -e "$f" ] || { echo "MISSING migration: $f"; continue; }
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migrations pass $pass ok"
done
"${PSQL[@]}" -f "$HERE/010_hr_test.sql" 2>&1 | grep -vE '^\s*$|^(t|f)?$'
"${PSQL[@]}" -f "$HERE/020_hr_leave_test.sql" 2>&1 | grep -vE '^\s*$|^(t|f)?$'
"${PSQL[@]}" -f "$HERE/030_hr_attendance_test.sql" 2>&1 | grep -vE '^\s*$|^(t|f)?$'
"${PSQL[@]}" -f "$HERE/040_hr_payroll_test.sql" 2>&1 | grep -vE '^\s*$|^(t|f)?$'
