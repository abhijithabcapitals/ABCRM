#!/usr/bin/env bash
# Runs migrations twice (idempotence) and the module's tests on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Business Setup Base/tests/run-local.sh"
# Git-ignored seeds live in the main checkout: set PRIVATE_ROOT to the folder that holds "Banking Base/private"
# and "Business Setup Base/private". Exits non-zero when a migration or a check fails.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="$HERE/../.."
PRIVATE_ROOT="${PRIVATE_ROOT:-/d/Abhijith Projects/CRM/Database Module}"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55434
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
B="$DB/Banking Base/migrations"
"${PSQL[@]}" -f "$DB/Banking Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$HERE/001_storage_stub.sql" >/dev/null || exit 1

shopt -s nullglob
# Everything this module builds on, in dependency order.
BASE=("$B"/001_*.sql "$PRIVATE_ROOT/Banking Base/private"/002_*.sql "$B"/003_*.sql "$B"/004_*.sql "$B"/005_*.sql "$B"/006_*.sql "$B"/003_*.sql
  "$B"/007_*.sql "$B"/008_*.sql "$B"/009_*.sql "$B"/010_*.sql "$B"/011_*.sql
  "$DB/Accounting Base/migrations"/001_*.sql "$DB/Client Base/migrations"/001_*.sql "$DB/Services Base/migrations"/001_*.sql
  "$DB/Template Hub Base/migrations"/001_*.sql "$DB/Template Hub Base/migrations"/002_*.sql
  "$DB/Voucher Base/migrations"/001_*.sql "$DB/Voucher Base/migrations"/002_*.sql "$DB/Client Base/migrations"/002_*.sql
  "$DB/HR Base/migrations"/001_*.sql "$DB/AI Base/migrations"/001_*.sql "$DB/Admin Base/migrations"/001_*.sql
  "$DB/Client Base/migrations"/003_*.sql)
# This module's migrations 001-012 in number order. The git-ignored fee seed (private/007) runs after 005,
# and only once business_setup_fee_items exists.
MINE=()
for n in 01 02 03 04 05 06 07 08 09 10 11 12; do MINE+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
SEED7=("$PRIVATE_ROOT/Business Setup Base/private"/007_*.sql)

run_sql() {
  "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $1"; cat "$DATA/err"; exit 1; }
}
for pass in 1 2; do
  for f in "${BASE[@]}"; do run_sql "$f"; done
  for f in "${MINE[@]}"; do
    run_sql "$f"
    case "$(basename "$f")" in 005_*)
      if [ ${#SEED7[@]} -gt 0 ] && [ -n "$("${PSQL[@]}" -At -c "select to_regclass('public.business_setup_fee_items')")" ]; then run_sql "${SEED7[0]}"; fi ;;
    esac
  done
  echo "migrations pass $pass ok"
done

# Test files in number order: 010 (SQL), 020 (concurrency script), 030-060 when they exist.
RC=0
for t in "$HERE"/0[1-6]0_*; do
  case "$t" in
    *.sql) "${PSQL[@]}" -f "$t" >"$DATA/out" 2>&1 || { RC=1; echo "TESTS FAILED: $(basename "$t")"; }
           grep -vE '^\s*$|^(t|f)?$|NOTICE:  ok ' "$DATA/out" ;;
    *.sh)  BIN="$BIN" PORT="$PORT" bash "$t" || { RC=1; echo "TESTS FAILED: $(basename "$t")"; } ;;
  esac
done
exit $RC
