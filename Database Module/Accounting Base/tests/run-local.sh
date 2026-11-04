#!/usr/bin/env bash
# Runs the Accounting Base migrations from 002 on, twice (idempotence), then every test file, on a throwaway cluster.
# Nothing touches Supabase. Exits non-zero on any FAILED or ERROR line.
#   bash "Database Module/Accounting Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55435
# psql on Windows treats the null device as a console and would read the files in the console code page.
export PGCLIENTENCODING=UTF8
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
# Migration 001 needs the Banking tables, so it is not run here.
for pass in 1 2; do
  ran=0
  for f in "$HERE"/../migrations/[0-9][0-9][0-9]_*.sql; do
    case "$f" in */001_*) continue;; esac
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
    ran=$((ran + 1))
  done
  [ "$ran" -gt 0 ] || { echo "FAILED pass $pass: no migration 002 or later found"; exit 1; }
  echo "migrations pass $pass ok"
done
# Each test file's output goes to a file, so a failing psql cannot be hidden by a pipe.
status=0
for t in "$HERE"/[0-9][0-9][0-9]_*_test.sql; do
  "${PSQL[@]}" -t -f "$t" >"$DATA/out" 2>&1 || status=1
  grep -E 'ok |FAILED|ERROR' "$DATA/out"
  grep -qE 'FAILED|ERROR' "$DATA/out" && status=1
  [ "$status" -eq 0 ] || grep -vE 'NOTICE:  ok ' "$DATA/out" | tail -5
done
[ "$status" -eq 0 ] && echo "ALL PASSED" || echo "TESTS FAILED"
exit "$status"
