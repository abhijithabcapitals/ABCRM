#!/usr/bin/env bash
# Runs the Router Base migration twice (idempotence), the access tests, then the rollback, on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Router Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
AI="$HERE/../../AI Base"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55439
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
runtime() { "${PSQL[@]}" -t -A -c "select runtime from public.agents where id = 'AGT-05-BIZDEV'"; }
apply() { "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED: $2"; cat "$DATA/err"; exit 1; }; }

"${PSQL[@]}" -f "$AI/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -c "create role service_role" >/dev/null || exit 1
apply "$AI/migrations/002_agents.sql" "002_agents.sql"
apply "$AI/migrations/003_agent_seed.sql" "003_agent_seed.sql"

# The seed now marks Business Development own_code. Put it back to the old state, as on a database seeded before.
"${PSQL[@]}" -c "update public.agents set runtime = 'not_connected' where id = 'AGT-05-BIZDEV'" >/dev/null || exit 1
apply "$HERE/../migrations/001_router.sql" "001_router.sql pass 1"
echo "migration pass 1 ok"
[ "$(runtime)" = "own_code" ] && echo "ok BD moved from not_connected to own_code" || { echo "FAILED BD runtime is $(runtime), expected own_code"; exit 1; }
"${PSQL[@]}" -c "update public.agents set runtime = 'gateway' where id = 'AGT-05-BIZDEV'" >/dev/null || exit 1
apply "$HERE/../migrations/001_router.sql" "001_router.sql pass 2"
echo "migration pass 2 ok"
[ "$(runtime)" = "gateway" ] && echo "ok BD gateway left unchanged" || { echo "FAILED BD runtime is $(runtime), expected gateway"; exit 1; }

apply "$HERE/../migrations/002_recent_agent.sql" "002_recent_agent.sql pass 1"
apply "$HERE/../migrations/002_recent_agent.sql" "002_recent_agent.sql pass 2"
"${PSQL[@]}" -t -f "$HERE/010_router_test.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed' | sed 's/.*NOTICE:  //'
status=${PIPESTATUS[0]}
apply "$HERE/../migrations/rollback/002_rollback.sql" "rollback 002"
out002="$("${PSQL[@]}" -t -A -c "select case when pg_get_functiondef('public.router_context(uuid)'::regprocedure) !~ 'agent_id.,\s*r\.agent_id' then 'ok rollback 002 removes agent_id' else 'FAILED rollback 002 left agent_id' end")"
echo "$out002"
case "$out002" in "ok "*) ;; *) exit 1 ;; esac
apply "$HERE/../migrations/rollback/001_rollback.sql" "rollback"
left=$("${PSQL[@]}" -t -A -c "select (select count(*) from pg_namespace where nspname = 'router') + (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'router\_%')")
[ "$left" = "0" ] && echo "rollback ok" || { echo "FAILED rollback left $left objects"; exit 1; }
exit $status
