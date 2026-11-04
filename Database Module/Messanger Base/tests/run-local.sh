#!/usr/bin/env bash
# Runs the Messenger migrations twice (idempotence), the access test files, then the rollbacks in reverse order, on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Messanger Base/tests/run-local.sh"
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55438
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c wal_level=logical" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
for m in 001_communication_links 002_microsoft_connection 003_chat 004_chat_parity 004b_chat_audit_private 005_teams_channels 006_calls 007_inbox_channels 008_receipts_typing; do
  for pass in 1 2; do
    "${PSQL[@]}" -f "$HERE/../migrations/$m.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $m.sql"; cat "$DATA/err"; exit 1; }
    echo "migration $m pass $pass ok"
  done
done
status=0
for tf in 010_links_test 020_connection_test 030_chat_test 040_chat_parity_test 045_chat_audit_test 050_teams_test 060_calls_test 070_inbox_test 080_receipts_test; do
  "${PSQL[@]}" -t -f "$HERE/$tf.sql" 2>&1 | grep -E 'ok |FAILED|ERROR|passed' | sed 's/.*NOTICE:  //' | tee "$DATA/out"
  if grep -qE 'FAILED|ERROR' "$DATA/out" || ! grep -q 'passed' "$DATA/out"; then status=1; fi
done
for r in 008 007 006 005 004b 004 003 002 001; do
  "${PSQL[@]}" -f "$HERE/../migrations/rollback/${r}_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAILED rollback $r"; cat "$DATA/err"; exit 1; }
done
left=$("${PSQL[@]}" -t -A -c "select count(*) from pg_class where relname like 'crm\_communication\_links%' or relname like 'microsoft\_%' or relname like 'messenger\_%'")
funcs=$("${PSQL[@]}" -t -A -c "select count(*) from pg_proc where proname like 'crm\_link\_%' or proname like 'ms\_token\_%' or proname like 'ms365\_%' or proname like 'messenger\_%'")
pubs=$("${PSQL[@]}" -t -A -c "select count(*) from pg_publication_tables where tablename like 'messenger\_%'")
secrets=$("${PSQL[@]}" -t -A -c "select count(*) from vault.secrets where name like 'ms\_rt:%'")
[ "$funcs" = "0" ] || { echo "FAILED rollback left $funcs functions"; exit 1; }
[ "$pubs" = "0" ] || { echo "FAILED rollback left $pubs realtime tables"; exit 1; }
[ "$secrets" = "0" ] || { echo "FAILED rollback left $secrets Vault secrets"; exit 1; }
[ "$left" = "0" ] && echo "rollback ok" || { echo "FAILED rollback left $left objects"; exit 1; }
exit $status
