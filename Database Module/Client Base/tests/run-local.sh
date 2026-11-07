#!/usr/bin/env bash
# Runs Client Base 007 (OneDrive folder map) twice (idempotence), the tests, then the rollback and 007 again, on a throwaway
# cluster. Nothing touches Supabase. Exits non-zero on any FAILED or ERROR line.
#   bash "Database Module/Client Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55437
export PGCLIENTENCODING=UTF8
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
M="$HERE/../migrations/007_storage_folders.sql"
M8="$HERE/../migrations/008_storage_name_order.sql"
for pass in 1 2; do
  for f in "$M" "$M8"; do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migration pass $pass ok"
done
status=0
for t in "$HERE"/[0-9][0-9][0-9]_*_test.sql; do
  "${PSQL[@]}" -t -f "$t" >"$DATA/out" 2>&1 || status=1
  grep -E 'ok |FAILED|ERROR' "$DATA/out"
  grep -qE 'FAILED|ERROR' "$DATA/out" && status=1
done
"${PSQL[@]}" -f "$HERE/../migrations/rollback/007_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED rollback"; cat "$DATA/err"; exit 1; }
"${PSQL[@]}" -f "$M" >/dev/null 2>"$DATA/err" || { echo "FAILED 007 after rollback"; cat "$DATA/err"; exit 1; }
echo "rollback and reapply ok"
exit $status
