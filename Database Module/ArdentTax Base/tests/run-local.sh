#!/usr/bin/env bash
# Runs the ArdentTax migration twice (idempotence), its tests and its rollback on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/ArdentTax Base/tests/run-local.sh"
# Git-ignored seeds live in the main checkout: set PRIVATE_ROOT to the folder that holds "Banking Base/private"
# and "Business Setup Base/private". Exits non-zero when a migration or a check fails.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="$HERE/../.."
PRIVATE_ROOT="${PRIVATE_ROOT:-/d/Abhijith Projects/CRM/Database Module}"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55436
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
B="$DB/Banking Base/migrations"
"${PSQL[@]}" -f "$DB/Banking Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$DB/Client Login Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$DB/Business Setup Base/tests/001_storage_stub.sql" >/dev/null || exit 1

shopt -s nullglob
# Everything ArdentTax builds on, in the order Business Setup's runner uses. Business Setup replaces hub_next_number.
BASE=("$B"/001_*.sql "$PRIVATE_ROOT/Banking Base/private"/002_*.sql "$B"/003_*.sql "$B"/004_*.sql "$B"/005_*.sql "$B"/006_*.sql "$B"/003_*.sql
  "$B"/007_*.sql "$B"/008_*.sql "$B"/009_*.sql "$B"/010_*.sql "$B"/011_*.sql "$B"/012_*.sql "$B"/013_*.sql "$B"/014_*.sql "$B"/015_*.sql "$B"/016_*.sql "$B"/017_*.sql "$B"/018_*.sql
  "$DB/Accounting Base/migrations"/001_*.sql "$DB/Client Base/migrations"/001_*.sql "$DB/Services Base/migrations"/001_*.sql
  "$DB/Template Hub Base/migrations"/001_*.sql "$DB/Template Hub Base/migrations"/002_*.sql
  "$DB/Voucher Base/migrations"/001_*.sql "$DB/Voucher Base/migrations"/002_*.sql "$DB/Client Base/migrations"/002_*.sql
  "$DB/HR Base/migrations"/001_*.sql "$DB/AI Base/migrations"/001_*.sql "$DB/Admin Base/migrations"/001_*.sql
  "$DB/Client Base/migrations"/003_*.sql "$DB/Admin Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/001_*.sql "$DB/Client Login Base/migrations"/002_*.sql)
BS=(); for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14; do BS+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
SEED7=("$PRIVATE_ROOT/Business Setup Base/private"/007_*.sql)
MINE=("$HERE/../migrations/001_ardentax.sql")

run_sql() { "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED: $1"; cat "$DATA/err"; exit 1; }; }
for f in "${BASE[@]}"; do run_sql "$f"; done
for f in "${BS[@]}"; do
  run_sql "$f"
  case "$(basename "$f")" in 005_*) for s in "${SEED7[@]}"; do run_sql "$s"; done ;; esac
done
echo "base ok"
for pass in 1 2; do for f in "${MINE[@]}"; do run_sql "$f"; done; echo "migration pass $pass ok"; done

# The screen's test fixtures, so the database and the screen are held to the same totals.
FIX="$HERE/../../../Template Module/ardentax/tests/fixtures/totals.json"
{ printf 'create table public.at_fixtures(doc jsonb); insert into public.at_fixtures values ($fx$'; cat "$FIX"; printf '$fx$);\n'; } | "${PSQL[@]}" >/dev/null || exit 1
"${PSQL[@]}" -c "grant select on public.at_fixtures to authenticated" >/dev/null || exit 1

RC=0
for t in "$HERE"/[01][0-9]0_*; do
  case "$t" in
    *.sql) "${PSQL[@]}" -At -f "$t" >"$DATA/out" 2>&1 || { RC=1; echo "TESTS FAILED: $(basename "$t")"; }
           grep -vE '^\s*$|^(t|f)?$' "$DATA/out" | grep -vE '^[a-z_]*$' | sed -E 's/^psql:.*NOTICE:  //' ;;
    *.sh)  BIN="$BIN" PORT="$PORT" bash "$t" || { RC=1; echo "TESTS FAILED: $(basename "$t")"; } ;;
  esac
done

# Rollback leaves nothing behind and refuses while documents exist, unless forced.
if "${PSQL[@]}" -f "$HERE/../rollback/001_rollback.sql" >/dev/null 2>&1; then echo "FAIL rollback ran with documents present"; RC=1; else echo "ok   rollback refuses while documents exist"; fi
"${PSQL[@]}" -c "set ardentax.rollback_force = 'yes'" -f "$HERE/../rollback/001_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL rollback: $(cat "$DATA/err")"; RC=1; }
LEFT="$("${PSQL[@]}" -At -c "select (to_regclass('public.ardentax_documents') is not null)::int + (select count(*) from service_departments where name = 'ArdentTax (ASP)') + (select count(*) from pg_proc where proname like 'ardentax%') + (select count(*) from hub_number_counters where department = 'ArdentTax (ASP)') + (select count(*) from hub_settings where key = 'ardentax_mail') + (select case when value ? 'ArdentTax (ASP)' then 1 else 0 end from hub_settings where key = 'document_numbering') + (select count(*) from voucher_register where source = 'ardentax')")"
if [ "$LEFT" = "0" ]; then echo "ok   rollback leaves nothing behind"; else echo "FAIL rollback left $LEFT items"; RC=1; fi
for f in "${MINE[@]}"; do run_sql "$f"; done; echo "ok   applies again after rollback"
exit $RC
