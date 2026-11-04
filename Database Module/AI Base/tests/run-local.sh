#!/usr/bin/env bash
# Runs the agents migration and seed twice (idempotence), the access tests, then the rollback, on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/AI Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55438
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
for pass in 1 2; do
  for f in 002_agents.sql 003_agent_seed.sql; do
    "${PSQL[@]}" -f "$HERE/../migrations/$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migration pass $pass ok"
done
"${PSQL[@]}" -t -f "$HERE/010_agents_test.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed' | sed 's/.*NOTICE:  //'
status=${PIPESTATUS[0]}
"${PSQL[@]}" -f "$HERE/../migrations/rollback/002_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED rollback"; cat "$DATA/err"; exit 1; }
left=$("${PSQL[@]}" -t -A -c "select count(*) from pg_class where relname = 'agents' or relname like 'agent\_%'")
[ "$left" = "0" ] && echo "rollback ok" || { echo "FAILED rollback left $left objects"; exit 1; }
exit $status
