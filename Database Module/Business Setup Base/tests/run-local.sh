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
PORT="${PG_PORT:-55434}"
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
  "$DB/Client Base/migrations"/003_*.sql "$DB/Admin Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/001_*.sql "$DB/Client Login Base/migrations"/002_*.sql
  "$DB/Client Login Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/004_*.sql "$DB/Client Login Base/migrations"/005_*.sql)   # 003 and 004: the login email and the vault copy of its password (business_setup_login_grant)
# This module's migrations in number order. 001-012 are the first release (MINE_OLD); 013 onward are the case restructure (MINE_NEW),
# which rollback/013_019_rollback.sql undoes on its own. The git-ignored fee seed (private/007) runs after 005,
# and only once business_setup_fee_items exists.
MINE_OLD=(); MINE_NEW=()
for n in 01 02 03 04 05 06 07 08 09 10 11 12; do MINE_OLD+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
# Run order 13 14 20 21 15 16 17 18 19 22, then 23 (bd_transfer, not written yet: its glob is empty until then), 24 (portal file names, on top of 022) and 25 (fee categories).
for n in 13 14 20 21 15 16 17 18 19 22 23 24 25; do MINE_NEW+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
MINE=("${MINE_OLD[@]}" "${MINE_NEW[@]}")
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
  for f in "${MINE_OLD[@]}" "${SEED7[@]}"; do pass=mine; run_sql "$f"; done
  # Remember the functions 013 replaces, to prove rollback/013_019_rollback.sql puts them back exactly.
  "${PSQL[@]}" -c "create table public.bs_pre013 as select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('hub_document_create', 'business_setup_permissions', 'business_setup_dashboard', 'business_setup_net_paid', 'business_setup_quote_accept', 'business_setup_fee_item_save', 'business_setup_payment_add', 'business_setup_payment_reverse', 'business_setup_portal_view', 'client_master_can', 'business_setup_child_lock', 'business_setup_accounts_queue', 'business_setup_quote_reject', 'business_setup_refund_add', 'business_setup_client_list')" >/dev/null || exit 1
  # Phase 2 alone: snapshot at 014, apply 015, 016 and 018, add data, roll back with rollback/015_018_rollback.sql, compare, and apply again.
  for f in "$DB/Business Setup Base/migrations"/013_*.sql "$DB/Business Setup Base/migrations"/014_*.sql; do pass=new; run_sql "$f"; done
  "${PSQL[@]}" -f "$HERE/rollback-snapshot-015.sql" >/dev/null || exit 1
  P2=("$DB/Business Setup Base/migrations"/015_*.sql "$DB/Business Setup Base/migrations"/016_*.sql "$DB/Business Setup Base/migrations"/017_*.sql "$DB/Business Setup Base/migrations"/018_*.sql)
  for f in "${P2[@]}"; do pass=phase2; run_sql "$f"; done
  # Every fee item that existed before 015 is not a service (the column is added on the first run only).
  "${PSQL[@]}" -c "do \$\$ begin if exists (select 1 from public.business_setup_fee_items where is_service) or not exists (select 1 from public.business_setup_fee_items) then raise exception 'fee items that existed before 015 must all have is_service false'; end if; end \$\$" >/dev/null 2>"$DATA/err" || { echo "IS_SERVICE CHECK FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/rollback-data-015.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK DATA FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/../rollback/015_018_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 015-018 FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/rollback-check-015.sql" 2>&1 | grep -E "ok|ERROR" ; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
  for f in "${P2[@]}"; do pass=phase2-again; run_sql "$f"; done
  "${PSQL[@]}" -c "drop table public.bs_pre015_fn, public.bs_pre015_col, public.bs_pre015_trg, public.bs_pre015_pol, public.bs_pre015_idx, public.bs_pre015_kept" >/dev/null || exit 1
  # Payments are append-only, so this cleanup runs with triggers off (test only).
  "${PSQL[@]}" -c "set session_replication_role = replica; delete from public.business_setup_payments where note = 'rollback-015-advance'; delete from public.business_setup_invoices where invoice_number = 'RB-015'; delete from public.business_setup_signed_quotes where quote_id in (select id from public.hub_documents where document_number = 'RB-015-Q'); delete from public.hub_documents where document_number = 'RB-015-Q'; delete from public.business_setup_cases where lead_name = 'rollback-015' or lead_name like 'rollback-016%'; delete from public.client_portal_accounts where username = 'rb.portal015'; delete from public.client_master where client_id = 'CL990015'; delete from public.business_setup_fee_items where grp = 'RB015'; set session_replication_role = origin" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 015 CLEANUP FAILED"; cat "$DATA/err"; exit 1; }
  # Cases data to remove, and a quote that must survive with its case_id gone.
  "${PSQL[@]}" -c "insert into public.client_master (client_id, legal_name, data) values ('CL990002', 'R2', '{}') on conflict do nothing; insert into public.business_setup_cases (client_id, stage) values ('CL990002', 'Onboarding'); insert into public.hub_documents (doc_type, department, client_name, document_number, document_serial, case_id) select 'quote', 'Business Setup', 'Case quote', 'CASE-1', 1, id from public.business_setup_cases limit 1" >/dev/null || exit 1
  "${PSQL[@]}" -c "create table public.bs_pre013_docs as select count(*) as n from public.hub_documents" >/dev/null || exit 1
  "${PSQL[@]}" -f "$HERE/../rollback/013_019_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 013-019 FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/rollback-check-013.sql" 2>&1 | grep -E "ok|ERROR" ; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
  for f in "${MINE_NEW[@]}"; do pass=new-again; run_sql "$f"; done
  # The two rollbacks also work one after the other.
  "${PSQL[@]}" -f "$HERE/../rollback/015_018_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 015-018 (second) FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/../rollback/013_019_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 013-019 after 015-018 FAILED"; cat "$DATA/err"; exit 1; }
  "${PSQL[@]}" -f "$HERE/rollback-check-013.sql" 2>&1 | grep -E "ok|ERROR" ; [ "${PIPESTATUS[0]}" -eq 0 ] || exit 1
  # 024 alone, on top of 022: record the two functions just before 024 replaces them (010's file function, 022's view), apply it,
  # roll it back with rollback/024_rollback.sql, compare text and grants, and apply it again.
  FN024="select string_agg(p.proname || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(p.proacl::text, ''), ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('business_setup_portal_file', 'business_setup_portal_view')"
  PRE024=""
  for f in "${MINE_NEW[@]}"; do
    case "$(basename "$f")" in 024_*) PRE024="$("${PSQL[@]}" -At -c "$FN024")" || exit 1 ;; esac
    pass=new-again-2; run_sql "$f"
  done
  [ -n "$PRE024" ] || { echo "024 CHECK FAILED: 024 did not run"; exit 1; }
  [ "$("${PSQL[@]}" -At -c "$FN024")" != "$PRE024" ] || { echo "024 CHECK FAILED: 024 changed nothing"; exit 1; }
  "${PSQL[@]}" -f "$HERE/../rollback/024_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "ROLLBACK 024 FAILED"; cat "$DATA/err"; exit 1; }
  [ "$("${PSQL[@]}" -At -c "$FN024")" = "$PRE024" ] || { echo "ROLLBACK 024 CHECK FAILED: the functions differ from 010 and 022"; exit 1; }
  echo "rollback 024 restores 010's file function and 022's view with their grants ok"
  pass=024-again; run_sql "$DB/Business Setup Base/migrations/024_portal_file_names.sql"
  "${PSQL[@]}" -c "drop table public.bs_pre013, public.bs_pre013_docs; delete from public.hub_documents where document_number = 'CASE-1'" >/dev/null || exit 1
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
  # Client Base 004 and 006 read this module and Accounting, so they run after them.
  "${PSQL[@]}" -c "create table if not exists public.accounting_jobs (id uuid primary key default gen_random_uuid(), client_id text)" >/dev/null || exit 1
  run_sql "$DB/Client Base/migrations/004_accounting_line.sql"; run_sql "$DB/Client Base/migrations/006_client_lines.sql"
  # Template Hub 003-007 and ArdentTax 001 are live too: Company Templates quotes reach hub_document_create through hub_library_create.
  run_sql "$HERE/002_template_hub_stub.sql"
  for f in "$DB/Template Hub Base/migrations"/003_*.sql "$DB/Template Hub Base/migrations"/004_*.sql "$DB/ArdentTax Base/migrations"/001_*.sql "$DB/Template Hub Base/migrations"/005_*.sql "$DB/Template Hub Base/migrations"/006_*.sql "$DB/Template Hub Base/migrations"/007_*.sql; do run_sql "$f"; done
  echo "migrations pass $pass ok"
done

# Test files in number order, 010 to 200: SQL files and shell scripts.
RC=0
for t in "$HERE"/[012][0-9]0_*; do
  case "$t" in
    *.sql) "${PSQL[@]}" -f "$t" >"$DATA/out" 2>&1 || { RC=1; echo "TESTS FAILED: $(basename "$t")"; }
           grep -vE '^\s*$|^(t|f)?$|NOTICE:  ok ' "$DATA/out" ;;
    *.sh)  BIN="$BIN" PORT="$PORT" bash "$t" || { RC=1; echo "TESTS FAILED: $(basename "$t")"; } ;;
  esac
done
exit $RC
