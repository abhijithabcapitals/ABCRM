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
"${PSQL[@]}" -f "$DB/Client Login Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$HERE/001_storage_stub.sql" >/dev/null || exit 1

shopt -s nullglob
# Everything this module builds on, in dependency order.
BASE=("$B"/001_*.sql "$PRIVATE_ROOT/Banking Base/private"/002_*.sql "$B"/003_*.sql "$B"/004_*.sql "$B"/005_*.sql "$B"/006_*.sql "$B"/003_*.sql
  "$B"/007_*.sql "$B"/008_*.sql "$B"/009_*.sql "$B"/010_*.sql "$B"/011_*.sql "$B"/012_*.sql "$B"/013_*.sql "$B"/014_*.sql "$B"/015_*.sql "$B"/016_*.sql "$B"/017_*.sql "$B"/018_*.sql
  "$DB/Accounting Base/migrations"/001_*.sql "$DB/Client Base/migrations"/001_*.sql "$DB/Services Base/migrations"/001_*.sql
  "$DB/Template Hub Base/migrations"/001_*.sql "$DB/Template Hub Base/migrations"/002_*.sql
  "$DB/Voucher Base/migrations"/001_*.sql "$DB/Voucher Base/migrations"/002_*.sql "$DB/Client Base/migrations"/002_*.sql
  "$DB/HR Base/migrations"/001_*.sql "$DB/AI Base/migrations"/001_*.sql "$DB/Admin Base/migrations"/001_*.sql
  "$DB/Client Base/migrations"/003_*.sql "$DB/Admin Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/001_*.sql "$DB/Client Login Base/migrations"/002_*.sql)
# This module's migrations 001-012 in number order. The git-ignored fee seed (private/007) runs after 005,
# and only once business_setup_fee_items exists.
MINE=()
for n in 01 02 03 04 05 06 07 08 09 10 11 12; do MINE+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
SEED7=("$PRIVATE_ROOT/Business Setup Base/private"/007_*.sql)

run_sql() {
  "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED pass $pass: $1"; cat "$DATA/err"; exit 1; }
}
# With ROLLBACK_TEST=1: snapshot, apply, add a row of data, roll back, check, and apply again. Used before a live apply.
if [ -n "${ROLLBACK_TEST:-}" ]; then
  pass=base; for f in "${BASE[@]}"; do run_sql "$f"; done
  "${PSQL[@]}" -c "insert into public.hub_documents (doc_type, department, client_name, document_number, document_serial) values ('quote', 'Accounting', 'Keep me', 'KEEP-1', 1)" >/dev/null || exit 1
  "${PSQL[@]}" -f "$HERE/../rollback/000_snapshot.sql" >/dev/null || exit 1
  "${PSQL[@]}" -c "select proname, md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and proname in ('client_base_list','client_inputs_assign','client_inputs_file','client_inputs_release','client_lookup','client_master_save','hub_document_create','hub_next_number','hub_numbering_save','hub_numbering_status','voucher_set_local') order by 1" -At || exit 1
  for f in "${MINE[@]}" "${SEED7[@]}"; do pass=mine; run_sql "$f"; done
  "${PSQL[@]}" -c "insert into public.client_master (client_id, legal_name, data) values ('CL990001', 'R', '{}'); insert into public.business_setup_services (client_id, name) values ('CL990001', 'x')" >/dev/null || exit 1
  "${PSQL[@]}" -f "$HERE/../rollback/001_012_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/rollback-check.sql" 2>&1 | grep -E "ok|ERROR" ; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
  for f in "${MINE[@]}" "${SEED7[@]}"; do pass=again; run_sql "$f"; done
  echo "applied again after rollback ok"
  exit 0
fi

for pass in 1 2; do
  for f in "${BASE[@]}"; do run_sql "$f"; done
  for f in "${MINE[@]}"; do
    run_sql "$f"
    case "$(basename "$f")" in 005_*)
      if [ ${#SEED7[@]} -gt 0 ] && [ -n "$("${PSQL[@]}" -At -c "select to_regclass('public.business_setup_fee_items')")" ]; then run_sql "${SEED7[0]}"; fi ;;
    esac
  done
  # Admin Base 010 adds the unique index on this module's invoices table.
  run_sql "$DB/Admin Base/migrations/010_zoho_invoices.sql"
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
