#!/usr/bin/env bash
# Builds Document Base 001 (and 002 when present) on a throwaway local cluster, applies each migration twice
# (idempotence) and runs the tests. Nothing touches Supabase or the PostgreSQL service on 5432.
#   bash "Database Module/Document Base/tests/run-local.sh"
# Exits non-zero when a migration or a check fails.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
M="$HERE/../migrations"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT="${PG_PORT:-55437}"
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)

run_sql() {
  "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED: $1"; cat "$DATA/err"; exit 1; }
}
run_sql "$HERE/000_stub.sql"
for f in "$M"/00[1-9]_*.sql; do
  [ -e "$f" ] || { echo "FAILED: no migration found in $M"; exit 1; }
  for pass in 1 2; do run_sql "$f"; echo "$(basename "$f") pass $pass ok"; done
done
for t in "$HERE"/0[1-9]0_*_test.sql; do
  OUT="$("${PSQL[@]}" -t -f "$t" 2>&1)"; RC=$?
  echo "$OUT" | grep -E "ok |FAIL|ERROR|passed|error"
  [ "$RC" -eq 0 ] || { echo "FAILED $(basename "$t") exit $RC"; exit 1; }
done
echo "all tests passed"
