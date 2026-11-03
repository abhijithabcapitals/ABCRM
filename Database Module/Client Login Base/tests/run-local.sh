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
  "$HERE"/../migrations/*.sql)
for pass in 1 2; do
  for f in "${FILES[@]}"; do
    "${PSQL[@]}" -f "$f" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $f"; cat "$DATA/err"; exit 1; }
  done
  echo "migrations pass $pass ok"
done
for t in "$HERE"/0*_test.sql; do
  "${PSQL[@]}" -f "$t" 2>&1 | grep -vE '^\s*$|^(t|f)?$'
done
