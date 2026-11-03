#!/usr/bin/env bash
# Loads the chain the client portal needs on a throwaway cluster, runs the migrations twice (idempotence), then the tests.
# Nothing touches Supabase.   bash "Database Module/Client Login Base/tests/run-local.sh"
# PRIVATE_ROOT is the Database Module folder holding the git-ignored private seeds (read only).
set -u
export PGCLIENTENCODING=UTF8
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="$HERE/../.."
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
PRIVATE_ROOT="${PRIVATE_ROOT:-/d/Abhijith Projects/CRM/Database Module}"
DATA="$(mktemp -d)/pg"
PORT=55437
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$DB/Banking Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$HERE/000_stub.sql" >/dev/null || exit 1
B="$DB/Banking Base/migrations"
FILES=("$B"/001_*.sql "$PRIVATE_ROOT/Banking Base/private"/002_*.sql "$B"/003_*.sql "$B"/004_*.sql "$B"/005_*.sql "$B"/006_*.sql "$B"/007_*.sql
  "$B"/008_*.sql "$B"/009_*.sql "$B"/010_*.sql "$B"/011_*.sql "$B"/012_*.sql "$B"/013_*.sql "$B"/014_*.sql "$B"/015_*.sql "$B"/016_*.sql
  "$B"/017_*.sql "$B"/018_*.sql
  "$DB/Accounting Base"/migrations/001_*.sql "$DB/Client Base"/migrations/001_*.sql "$DB/Services Base"/migrations/001_*.sql
  "$DB/Template Hub Base"/migrations/001_*.sql "$DB/Template Hub Base"/migrations/002_*.sql "$DB/Voucher Base"/migrations/001_*.sql
  "$DB/Voucher Base"/migrations/002_*.sql "$DB/Client Base"/migrations/002_*.sql "$DB/HR Base"/migrations/001_*.sql
  "$DB/AI Base"/migrations/001_*.sql "$DB/Admin Base"/migrations/001_*.sql "$DB/Client Base"/migrations/003_*.sql
  "$DB/Admin Base"/migrations/003_*.sql
  "$HERE"/../migrations/*.sql)
for pass in 1 2; do
  for f in "${FILES[@]}"; do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  # as in the release order: the new table gets its audit trigger straight after the migrations
  BAD=$("${PSQL[@]}" -At -c "select coalesce(array_length(failed, 1), 0) from public.audit_trail_attach_all()" | tr -d '\r')
  [ "$BAD" = "0" ] || { echo "FAILED pass $pass: audit_trail_attach_all ($BAD tables)"; exit 1; }
  echo "migrations pass $pass ok"
done
# Each test file and the concurrency script get their own copy of the migrated database, so they cannot disturb each other.
# Exit status is non-zero on any failed check, an aborted test file (psql error) or a failed concurrency script.
RC=0
N=0
for t in "$HERE"/0*_test.sql; do
  N=$((N+1)); DBN="t$N"
  "${PSQL[@]}" -d template1 -c "create database $DBN template postgres" >/dev/null || exit 1
  "${PSQL[@]}" -d "$DBN" -f "$t" >"$DATA/out" 2>&1
  PRC=$?
  grep -vE '^\s*$|^(t|f)?$' "$DATA/out"
  if [ $PRC -ne 0 ]; then echo "TEST FILE ABORTED (psql exit $PRC): $(basename "$t")"; RC=1; continue; fi
  SUMMARY=$(grep -E '^[0-9]+ passed, [0-9]+ failed$' "$DATA/out" | tail -1)
  if [ -z "$SUMMARY" ]; then echo "TEST FILE HAS NO SUMMARY: $(basename "$t")"; RC=1
  elif [ "${SUMMARY##*passed, }" != "0 failed" ]; then echo "TEST CHECKS FAILED: $(basename "$t") ($SUMMARY)"; RC=1; fi
done
for c in "$HERE"/0*.sh; do
  N=$((N+1)); DBN="t$N"
  "${PSQL[@]}" -d template1 -c "create database $DBN template postgres" >/dev/null || exit 1
  BIN="$BIN" PORT="$PORT" DBN="$DBN" bash "$c"
  CRC=$?
  if [ $CRC -ne 0 ]; then echo "CONCURRENCY SCRIPT FAILED (exit $CRC): $(basename "$c")"; RC=1; fi
done
[ $RC -eq 0 ] && echo "ALL OK" || echo "RUN FAILED"
exit $RC
