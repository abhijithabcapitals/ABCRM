#!/usr/bin/env bash
# Runs the Knowledge migration twice (idempotence), the access tests, then the rollback, on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Knowledge Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55437
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
for pass in 1 2; do
  "${PSQL[@]}" -f "$HERE/../migrations/001_knowledge.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: 001_knowledge.sql"; cat "$DATA/err"; exit 1; }
  echo "migration pass $pass ok"
done
# A database that already holds the earlier table-wide read must lose it when the migration runs again.
"${PSQL[@]}" -c "grant select on public.knowledge_price_lines to authenticated; grant select (basis) on public.knowledge_price_lines to authenticated" >/dev/null || exit 1
"${PSQL[@]}" -f "$HERE/../migrations/001_knowledge.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED re-run over an old grant"; cat "$DATA/err"; exit 1; }
echo "migration re-run over an old grant ok"
"${PSQL[@]}" -t -f "$HERE/010_knowledge_test.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed' | sed 's/.*NOTICE:  //'
status=${PIPESTATUS[0]}
"${PSQL[@]}" -f "$HERE/../migrations/rollback/001_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED rollback"; cat "$DATA/err"; exit 1; }
left=$("${PSQL[@]}" -t -A -c "select count(*) from pg_class where relname like 'knowledge\_%' or relname = 'v_knowledge_search'")
funcs=$("${PSQL[@]}" -t -A -c "select count(*) from pg_proc where proname like 'knowledge\_%'")
[ "$funcs" = "0" ] || { echo "FAILED rollback left $funcs functions"; exit 1; }
[ "$left" = "0" ] && echo "rollback ok" || { echo "FAILED rollback left $left objects"; exit 1; }
exit $status
