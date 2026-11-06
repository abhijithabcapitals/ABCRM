#!/usr/bin/env bash
# Runs the Company Library migration (004) twice (idempotence), its tests and its rollback on a throwaway cluster. Nothing touches Supabase.
#   bash "Database Module/Template Hub Base/tests/run-local.sh"
# Git-ignored seeds live in the main checkout: set PRIVATE_ROOT to the folder that holds "Banking Base/private"
# and "Business Setup Base/private". Exits non-zero when a migration or a check fails.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DB="$HERE/../.."
PRIVATE_ROOT="${PRIVATE_ROOT:-/d/Abhijith Projects/CRM/Database Module}"
BIN="${PG_BIN:-/c/Program Files/PostgreSQL/18/bin}"
DATA="$(mktemp -d)/pg"
PORT=55437
"$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null || exit 1
"$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT" -w -l "$DATA/log" start >/dev/null || exit 1
trap '"$BIN/pg_ctl.exe" -D "$DATA" -m immediate stop >/dev/null; rm -rf "$DATA"' EXIT
PSQL=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -v ON_ERROR_STOP=1 -q)
B="$DB/Banking Base/migrations"
"${PSQL[@]}" -f "$DB/Banking Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$DB/Client Login Base/tests/000_stub.sql" >/dev/null || exit 1
"${PSQL[@]}" -f "$DB/Business Setup Base/tests/001_storage_stub.sql" >/dev/null || exit 1

shopt -s nullglob
# Everything the library builds on, in the order Business Setup's runner uses. Business Setup replaces hub_next_number
# and hub_document_create; ArdentTax 001 gives ardentax_can() and Template Hub 003 is the brand name update.
BASE=("$B"/001_*.sql "$PRIVATE_ROOT/Banking Base/private"/002_*.sql "$B"/003_*.sql "$B"/004_*.sql "$B"/005_*.sql "$B"/006_*.sql "$B"/003_*.sql
  "$B"/007_*.sql "$B"/008_*.sql "$B"/009_*.sql "$B"/010_*.sql "$B"/011_*.sql "$B"/012_*.sql "$B"/013_*.sql "$B"/014_*.sql "$B"/015_*.sql "$B"/016_*.sql "$B"/017_*.sql "$B"/018_*.sql
  "$DB/Accounting Base/migrations"/001_*.sql "$DB/Client Base/migrations"/001_*.sql "$DB/Services Base/migrations"/001_*.sql
  "$DB/Template Hub Base/migrations"/001_*.sql "$DB/Template Hub Base/migrations"/002_*.sql
  "$DB/Voucher Base/migrations"/001_*.sql "$DB/Voucher Base/migrations"/002_*.sql "$DB/Client Base/migrations"/002_*.sql
  "$DB/HR Base/migrations"/001_*.sql "$DB/AI Base/migrations"/001_*.sql "$DB/Admin Base/migrations"/001_*.sql
  "$DB/Client Base/migrations"/003_*.sql "$DB/Admin Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/001_*.sql "$DB/Client Login Base/migrations"/002_*.sql
  "$DB/Client Login Base/migrations"/003_*.sql "$DB/Client Login Base/migrations"/004_*.sql "$DB/Client Login Base/migrations"/005_*.sql)   # 003-005 as in Business Setup's runner: 019 reads the client terms (005)
# Business Setup in its own runner's order, through 022 and 024: the proposal tests accept through business_setup_quote_accept_body (016-017, replaced by 022)
# and read the portal view (022, then 024). 023 is kept for bd_transfer; the glob is empty until it exists.
BS=(); for n in 01 02 03 04 05 06 07 08 09 10 11 12 13 14 20 21 15 16 17 18 19 22 23 24; do BS+=("$DB/Business Setup Base/migrations"/0${n}_*.sql); done
SEED7=("$PRIVATE_ROOT/Business Setup Base/private"/007_*.sql)
AFTER=("$DB/ArdentTax Base/migrations/001_ardentax.sql" "$DB/Template Hub Base/migrations/003_brand_name.sql" "$DB/../Template Module/database/01_quotation_maker.sql" "$DB/../Template Module/database/02_quotation_templates_access.sql" "$DB/Template Hub Base/migrations/004_hub_admin.sql")
MINE=("$HERE/../migrations/005_library_fill.sql" "$HERE/../migrations/006_library_letter.sql" "$HERE/../migrations/007_work_types.sql" "$HERE/../migrations/008_accounting_proposals.sql"
  "$HERE/../migrations/009_proposals.sql" "$HERE/../migrations/010_accounting_send_from.sql" "$HERE/../migrations/011_document_signing.sql" "$HERE/../migrations/012_accounting_signing.sql")

run_sql() { "${PSQL[@]}" -f "$1" >/dev/null 2>"$DATA/err" || { echo "FAILED: $1"; cat "$DATA/err"; exit 1; }; }
for f in "${BASE[@]}"; do run_sql "$f"; done
for f in "${BS[@]}"; do
  run_sql "$f"
  case "$(basename "$f")" in 005_*) for s in "${SEED7[@]}"; do run_sql "$s"; done ;; esac
done
for f in "${AFTER[@]}"; do run_sql "$f"; done
echo "base ok"

# What the numbering status returns before the library migration, so the tests can show nothing else changed.
"${PSQL[@]}" -At -c "select hub_numbering_status()::text" >"$DATA/status_before.json" 2>"$DATA/err" || { echo "FAILED: status before"; cat "$DATA/err"; exit 1; }
for pass in 1 2; do for f in "${MINE[@]}"; do run_sql "$f"; done; echo "migration pass $pass ok"; done
{ printf 'create table public.at_status_before(doc jsonb); grant select on public.at_status_before to authenticated;\ninsert into public.at_status_before values ($fx$'; tr -d '\r\n' <"$DATA/status_before.json"; printf '$fx$);\n'; } | "${PSQL[@]}" >/dev/null || exit 1

RC=0
for t in "$HERE"/[01][0-9]0_*; do
  case "$t" in
    *.sql) "${PSQL[@]}" -At -f "$t" >"$DATA/out" 2>&1 || { RC=1; echo "TESTS FAILED: $(basename "$t")"; }
           grep -vE '^\s*$|^(t|f)?$' "$DATA/out" | grep -vE '^[a-z_]*$' | sed -E 's/^psql:.*NOTICE:  //' ;;
    *.sh)  BIN="$BIN" PORT="$PORT" bash "$t" || { RC=1; echo "TESTS FAILED: $(basename "$t")"; } ;;
  esac
done

# Optional, local only: the private proposal authority seed. Runs when PROPOSAL_SEED names an existing file; PROPOSAL_SEED_CHECK names a script that checks it
# (it gets BIN and PORT). Without PROPOSAL_SEED nothing changes, so the committed run never depends on the private files.
if [ -n "${PROPOSAL_SEED:-}" ] && [ -f "$PROPOSAL_SEED" ]; then
  run_sql "$PROPOSAL_SEED"; run_sql "$PROPOSAL_SEED"; echo "ok   private proposal seed applies twice"
  if [ -n "${PROPOSAL_SEED_CHECK:-}" ] && [ -f "$PROPOSAL_SEED_CHECK" ]; then BIN="$BIN" PORT="$PORT" bash "$PROPOSAL_SEED_CHECK" || { RC=1; echo "TESTS FAILED: proposal seed check"; }; fi
fi

# 012 undone first: Accounting goes back to approval before sending an agreement (008), with its own image policies.
"${PSQL[@]}" -f "$HERE/../rollback/012_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL accounting signing rollback: $(cat "$DATA/err")"; RC=1; }
BACK12="$("${PSQL[@]}" -At -c "select (select count(*) from pg_policies where policyname like 'hub\_docs\_accounting\_signature%')
  + (select count(*) from pg_proc where proname = 'hub_acct_can_send' and prosrc like '%approved_at is not null%')
  + (select count(*) from pg_proc where proname = 'hub_acct_attach' and prosrc not like '%doc_sign_supersede%')
  + (select count(*) from pg_proc where proname = 'hub_acct_agreement_update' and prosrc not like '%doc_sign_supersede%' and prosrc like '%approved_at = null%')
  + (select count(*) from pg_proc where proname = 'hub_acct_file_guard' and prosrc not like '%hub_acct.files%')
  + has_function_privilege('authenticated', 'public.hub_acct_approve(uuid, text, text, timestamptz)', 'execute')::int")"
if [ "$BACK12" = "9" ]; then echo "ok   accounting signing rollback restores the 008 approval rules and policies"; else echo "FAIL accounting signing rollback restore score $BACK12 of 9"; RC=1; fi
# 011 undone next. It refuses while signatures or images under signatures/ exist unless forced, and puts the AB Capital approvers and
# image path back into accounting_proposal_defaults. The Accounting copy is blanked first (sync trigger off) so the restore is shown.
SIGS="$("${PSQL[@]}" -At -c "select count(*) from document_signatures")"
if "${PSQL[@]}" -f "$HERE/../rollback/011_rollback.sql" >/dev/null 2>"$DATA/err"; then echo "FAIL signing rollback ran with signatures present ($SIGS)"; RC=1
elif grep -q "Signatures or signature images exist" "$DATA/err"; then echo "ok   signing rollback refuses while signatures exist ($SIGS)"; else echo "FAIL signing rollback: $(cat "$DATA/err")"; RC=1; fi
"${PSQL[@]}" -c "update hub_settings set value = jsonb_set(value, '{companies,ab_capital}', value #> '{companies,ab_capital}' || '{\"signature_path\": \"accounting-signature/rollback-test.png\"}') where key = 'document_signing'" >/dev/null || RC=1
WANT="$("${PSQL[@]}" -At -c "select (value #> '{companies,ab_capital,approvers}')::text || ' ' || (value #>> '{companies,ab_capital,signature_path}') from hub_settings where key = 'document_signing'")"
"${PSQL[@]}" -c "alter table hub_settings disable trigger doc_sign_settings_sync" -c "update hub_settings set value = value || '{\"approvers\": [], \"signature_path\": null}' where key = 'accounting_proposal_defaults'" -c "alter table hub_settings enable trigger doc_sign_settings_sync" >/dev/null || RC=1
"${PSQL[@]}" -c "set doc_sign.rollback_force = 'yes'" -f "$HERE/../rollback/011_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL signing rollback: $(cat "$DATA/err")"; RC=1; }
GOT="$("${PSQL[@]}" -At -c "select (value -> 'approvers')::text || ' ' || (value ->> 'signature_path') from hub_settings where key = 'accounting_proposal_defaults'")"
if [ -n "$WANT" ] && [ "$WANT" = "$GOT" ]; then echo "ok   signing rollback restores the Accounting approvers and path ($GOT)"; else echo "FAIL signing rollback restored '$GOT', wanted '$WANT'"; RC=1; fi
LEFT11="$("${PSQL[@]}" -At -c "select (to_regclass('public.document_signatures') is not null)::int + (select count(*) from pg_proc where proname like 'doc\_sign\_%' or proname in ('doc_company', 'doc_changed_at'))
  + (select count(*) from hub_settings where key = 'document_signing') + (select count(*) from pg_policies where policyname like 'doc\_sign\_%')
  + (select count(*) from information_schema.columns where column_name = 'content_changed_at' and table_name in ('hub_documents','ardentax_documents','banking_quotations','banking_engagement_letters','banking_receipts'))
  + (select count(*) from pg_trigger where tgname like 'doc\_sign\_%')")"
if [ "$LEFT11" = "0" ]; then echo "ok   signing rollback leaves nothing behind"; else echo "FAIL signing rollback left $LEFT11 items"; RC=1; fi
BACK11="$("${PSQL[@]}" -At -c "select count(*) from pg_proc where proname = 'hub_acct_can_approve' and prosrc like '%hub_acct_approvers()%'")"
if [ "$BACK11" = "1" ]; then echo "ok   signing rollback restores hub_acct_can_approve"; else echo "FAIL hub_acct_can_approve not restored"; RC=1; fi
# 010 undone next: it only drops the sent-from column, and applies again with the other migrations at the end.
"${PSQL[@]}" -f "$HERE/../rollback/010_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL send-from rollback: $(cat "$DATA/err")"; RC=1; }
LEFT10="$("${PSQL[@]}" -At -c "select count(*) from information_schema.columns where table_name = 'hub_documents' and column_name = 'mail_sent_from'")"
if [ "$LEFT10" = "0" ]; then echo "ok   send-from rollback leaves nothing behind"; else echo "FAIL send-from rollback left the column"; RC=1; fi
# 009 undone next (rollbacks run newest first): it removes every proposal object, keeps the quotes, and leaves 008's columns, which it does not own.
QBEFORE="$("${PSQL[@]}" -At -c "select count(*) from hub_documents where doc_type = 'quote'")"
"${PSQL[@]}" -f "$HERE/../rollback/009_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL proposals rollback: $(cat "$DATA/err")"; RC=1; }
PLEFT="$("${PSQL[@]}" -At -c "select (to_regclass('public.hub_proposal_authorities') is not null)::int + (select count(*) from pg_proc where proname like 'hub\_proposal\_%')
  + (select count(*) from hub_settings where key = 'proposal_defaults') + (select count(*) from pg_trigger where tgname in ('hub_proposal_letter_guard', 'hub_proposal_accept_guard'))")"
PKEPT="$("${PSQL[@]}" -At -c "select count(*) from information_schema.columns where table_name = 'hub_documents' and column_name in ('word_path','onedrive_path','onedrive_saved_at','mail_sent_at','mail_sent_by','mail_sent_to','mail_claimed_at')")"
QAFTER="$("${PSQL[@]}" -At -c "select count(*) from hub_documents where doc_type = 'quote'")"
if [ "$PLEFT" = "0" ] && [ "$QBEFORE" = "$QAFTER" ]; then echo "ok   proposals rollback leaves nothing and keeps the quotes"; else echo "FAIL proposals rollback left $PLEFT items, quotes $QBEFORE -> $QAFTER"; RC=1; fi
if [ "$PKEPT" = "7" ]; then echo "ok   proposals rollback keeps the 008 columns"; else echo "FAIL proposals rollback removed 008 columns ($PKEPT of 7 left)"; RC=1; fi
# 008 undone next: it refuses while Accounting proposals exist unless forced, removes everything it added, and leaves quotes made the old way.
OLDQ_BEFORE="$("${PSQL[@]}" -At -c "select count(*) from hub_documents where department = 'Accounting' and library_template is null")"
"${PSQL[@]}" -f "$HERE/../rollback/008_rollback.sql" >/dev/null 2>&1 && { echo "FAIL accounting proposals rollback ran with proposals present"; RC=1; } || echo "ok   accounting proposals rollback refuses while proposals exist"
"${PSQL[@]}" -c "set acct_proposal.rollback_force = 'yes'" -f "$HERE/../rollback/008_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL accounting proposals rollback: $(cat "$DATA/err")"; RC=1; }
LEFT8="$("${PSQL[@]}" -At -c "select (to_regclass('public.hub_accounting_packages') is not null)::int + (select count(*) from pg_proc where proname like 'hub\_acct\_%')
  + (select count(*) from information_schema.columns where table_name = 'hub_documents' and column_name in ('word_path','onedrive_path','onedrive_saved_at','mail_sent_at','mail_sent_by','mail_sent_to','approved_by','approved_at','agreement_changed_at'))
  + (select count(*) from hub_settings where key = 'accounting_proposal_defaults') + (select count(*) from pg_trigger where tgname in ('hub_acct_letter_guard', 'hub_acct_file_guard'))
  + (select count(*) from pg_policies where policyname like 'hub\_docs\_accounting\_signature%')")"
if [ "$LEFT8" = "0" ]; then echo "ok   accounting proposals rollback leaves nothing behind"; else echo "FAIL accounting proposals rollback left $LEFT8 items"; RC=1; fi
OLDQ_AFTER="$("${PSQL[@]}" -At -c "select count(*) from hub_documents where department = 'Accounting' and library_template is null")"
if [ "$OLDQ_BEFORE" = "$OLDQ_AFTER" ] && [ "$OLDQ_BEFORE" != "0" ]; then echo "ok   accounting proposals rollback keeps the old quotes and letters ($OLDQ_AFTER)"; else echo "FAIL old quotes before $OLDQ_BEFORE, after $OLDQ_AFTER"; RC=1; fi
# Rollback refuses while library documents exist unless forced, then restores what 004 changed.
"${PSQL[@]}" -f "$HERE/../rollback/007_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL work types rollback: $(cat "$DATA/err")"; RC=1; }
"${PSQL[@]}" -f "$HERE/../rollback/006_rollback.sql" >/dev/null 2>"$DATA/err" || { echo "FAIL letter rollback: $(cat "$DATA/err")"; RC=1; }
ROLL="$HERE/../rollback/005_rollback.sql"
if "${PSQL[@]}" -f "$ROLL" >/dev/null 2>&1; then echo "FAIL rollback ran with library documents present"; RC=1; else echo "ok   rollback refuses while library documents exist"; fi
"${PSQL[@]}" -c "set library.rollback_force = 'yes'" -f "$ROLL" >/dev/null 2>"$DATA/err" || { echo "FAIL rollback: $(cat "$DATA/err")"; RC=1; }
LEFT="$("${PSQL[@]}" -At -c "select (to_regclass('public.hub_library_templates') is not null)::int + (to_regclass('public.hub_library_template_files') is not null)::int
  + (select count(*) from pg_proc where proname like 'hub_library%') + (select count(*) from information_schema.columns where table_name = 'hub_documents' and column_name in ('library_template','library_file_id','field_values'))
  + (select count(*) from service_departments where name = 'Ardentax Documents') + (select count(*) from hub_number_counters where kind = 'document')
  + (select case when value ? 'Ardentax Documents' then 1 else 0 end from hub_settings where key = 'document_numbering')
  + (select count(*) from hub_documents where doc_type = 'library') + (select count(*) from pg_policies where policyname like 'hub_docs_library%')")"
if [ "$LEFT" = "0" ]; then echo "ok   rollback leaves nothing behind"; else echo "FAIL rollback left $LEFT items"; RC=1; fi
# The earlier behaviour is back: same numbering status as before 004 (formats and kinds; the counters have moved on), policy open again, checks as before.
BACK="$("${PSQL[@]}" -At -c "select (regexp_replace(hub_numbering_status()::text, '\"(next_serial\": [0-9]+|preview\": \"[^\"]*\")', '', 'g') = regexp_replace((select doc from at_status_before)::text, '\"(next_serial\": [0-9]+|preview\": \"[^\"]*\")', '', 'g'))::int + (select count(*) from pg_policies where policyname = 'hub_doc_read' and qual = 'true')
  + (select count(*) from pg_constraint where conname = 'hub_documents_doc_type_check' and pg_get_constraintdef(oid) not like '%library%')
  + (select count(*) from pg_constraint where conname = 'hub_number_counters_kind_check' and pg_get_constraintdef(oid) not like '%document%')")"
if [ "$BACK" = "4" ]; then echo "ok   rollback restores numbering status, read policy and checks"; else echo "FAIL rollback restore score $BACK of 4"; RC=1; fi
for f in "${MINE[@]}"; do run_sql "$f"; done; echo "ok   applies again after rollback"
exit $RC
