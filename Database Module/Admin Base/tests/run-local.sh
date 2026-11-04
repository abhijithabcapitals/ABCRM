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
  for f in "$HERE"/../migrations/001_*.sql "$HERE"/../migrations/002_*.sql "$HERE"/../migrations/003_*.sql "$HERE"/../migrations/004_*.sql "$HERE"/../migrations/005_*.sql "$HERE"/../migrations/008_*.sql; do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migrations pass $pass ok"
done
"${PSQL[@]}" -t -f "$HERE/010_triggers_test.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed'
"${PSQL[@]}" -t -f "$HERE/020_audit_trail_test.sql" 2>&1 | grep -E "ok |FAILED|ERROR|passed|error"
"${PSQL[@]}" -t -f "$HERE/030_audit_all_test.sql" 2>&1 | grep -E "ok |FAILED|ERROR|passed|error"
"${PSQL[@]}" -t -f "$HERE/040_zoho_test.sql" 2>&1 | grep -E "ok |FAILED|ERROR|passed|error"
"${PSQL[@]}" -t -f "$HERE/050_zoho_finance_test.sql" 2>&1 | grep -E "ok |FAILED|ERROR|passed|error"
# Rollback 005 twice, check the tables are gone, then migrate again.
for i in 1 2; do "${PSQL[@]}" -f "$HERE/../migrations/rollback/005_rollback.sql" || { echo "FAILED rollback 005"; exit 1; }; done
"${PSQL[@]}" -t -c "select case when to_regclass('public.zoho_documents') is null and to_regclass('public.zoho_contact_links') is null then 'ok rollback 004 clean' else 'FAILED rollback 005 left tables' end"
"${PSQL[@]}" -f "$HERE/../migrations/005_zoho.sql" && echo "ok 005 reapplies after rollback"
# Rollback 008 twice, check the table is gone, then migrate again.
for i in 1 2; do "${PSQL[@]}" -f "$HERE/../migrations/rollback/008_rollback.sql" || { echo "FAILED rollback 008"; exit 1; }; done
"${PSQL[@]}" -t -c "select case when to_regclass('public.zoho_finance_snapshot') is null then 'ok rollback 008 clean' else 'FAILED rollback 008 left table' end"
"${PSQL[@]}" -f "$HERE/../migrations/008_zoho_finance.sql" && echo "ok 008 reapplies after rollback"
