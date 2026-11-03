#!/usr/bin/env bash
# Two real psql sessions against a database copy made by run-local.sh (needs BIN, PORT and DBN).
# Session 1 holds its transaction open with pg_sleep; session 2 starts 1 second later and must wait, then get a clean refusal.
# Any failed check exits non-zero. Nothing touches Supabase.
set -u
: "${BIN:?}" "${PORT:?}" "${DBN:?}"
PS=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d "$DBN" -q -At)
S1U='00000000-0000-0000-0000-000000000001'
S2U='00000000-0000-0000-0000-000000000002'
ACC='aa000000-0000-0000-0000-0000000000aa'
HOLD=3
FAILS=0; TOTAL=0
chk() { TOTAL=$((TOTAL+1)); if [ "$2" = "1" ]; then echo "ok   $1"; else echo "FAIL $1 ${3:-}"; FAILS=$((FAILS+1)); fi; }
one() { "${PS[@]}" -v ON_ERROR_STOP=1 -c "$1" | tail -1; }

# seed: two staff with the Clients tab, one client with a Client Master row and an account
"${PS[@]}" -v ON_ERROR_STOP=1 -c "
insert into public.profiles (id, full_name, role) values ('$S1U', 'Staff One', 'member'), ('$S2U', 'Staff Two', 'member');
insert into public.member_tab_access (profile_id, tab_key) values ('$S1U', 'clients'), ('$S2U', 'clients');
insert into public.client_master (client_id, legal_name, data) values ('CL000901', 'Alpha LLC', '{\"Client Legal Name\": \"Alpha LLC\", \"Trade Name\": \"Alpha\"}');
insert into public.client_portal_accounts (id, display_name, username, password_hash, client_master_id) values ('$ACC', 'Alpha LLC', 'alpha.user', 'x', 'CL000901');" >/dev/null || { echo "FAIL seed"; exit 1; }

# a fresh pending request on a field; prints its id
mk() { one "select public.client_change_submit('$ACC', '$1', '$2');"; }
status_of() { one "select status from public.client_portal_change_requests where id = '$1'"; }
holder_of() { one "select coalesce(assigned_to::text, '') from public.client_portal_change_requests where id = '$1'"; }
open_count() { one "select count(*) from public.client_portal_change_requests where account_id = '$ACC' and field_key = '$1' and status in ('pending', 'in_review')"; }
as() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; }

# Session 1 (holds $HOLD seconds) in the background, session 2 one second later in the foreground.
# $1 = session 1 SQL (ends with the sleep), $2 = session 2 SQL. Sets S1RC, S1OUT, S2RC, S2OUT, S2MS.
race() {
  local t0 t1
  S1F=$(mktemp); ( "${PS[@]}" -v ON_ERROR_STOP=1 -c "$1" >"$S1F" 2>&1; echo $? >"$S1F.rc" ) &
  local pid=$!
  sleep 1
  t0=$(date +%s%N)
  S2OUT=$("${PS[@]}" -v ON_ERROR_STOP=1 -c "$2" 2>&1); S2RC=$?
  t1=$(date +%s%N); S2MS=$(( (t1 - t0) / 1000000 ))
  wait $pid
  S1OUT=$(cat "$S1F"); S1RC=$(cat "$S1F.rc"); rm -f "$S1F" "$S1F.rc"
}

# 1. Take vs take: both sessions take the same pending request; exactly one succeeds.
R1=$(mk trade_name 'Alpha One')
race "$(as $S1U) select public.client_changes_take('$R1'); select pg_sleep($HOLD);" "$(as $S2U) select public.client_changes_take('$R1');"
chk "take/take: session 1 took it" "$([ "$S1RC" = 0 ] && echo 1 || echo 0)" "$S1OUT"
chk "take/take: session 2 waited for session 1" "$([ "$S2MS" -ge 1200 ] && echo 1 || echo 0)" "${S2MS}ms"
chk "take/take: session 2 refused as already taken" "$([ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'already taken' && echo 1 || echo 0)" "$S2OUT"
chk "take/take: no deadlock" "$(echo "$S1OUT$S2OUT" | grep -qi deadlock && echo 0 || echo 1)"
chk "take/take: exactly one holder, session 1" "$([ "$(status_of "$R1")" = in_review ] && [ "$(holder_of "$R1")" = "$S1U" ] && echo 1 || echo 0)"

# 2. Take vs take with the other session first (no reliance on who starts): session 2 holds, session 1 is refused.
R2=$(mk website 'a.test')
race "$(as $S2U) select public.client_changes_take('$R2'); select pg_sleep($HOLD);" "$(as $S1U) select public.client_changes_take('$R2');"
chk "take/take reversed: second session refused, first holds it" "$([ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'already taken' && [ "$(holder_of "$R2")" = "$S2U" ] && echo 1 || echo 0)" "$S2OUT"

# 3. Take (session 1) vs client submit on the same field (session 2): the submit must be refused, not replace a request staff hold.
R3=$(mk company_phone '0501')
race "$(as $S1U) select public.client_changes_take('$R3'); select pg_sleep($HOLD);" "select public.client_change_submit('$ACC', 'company_phone', '0502');"
chk "take then submit: submit waited and was refused as under review" "$([ "$S2RC" != 0 ] && [ "$S2MS" -ge 1200 ] && echo "$S2OUT" | grep -qi 'reviewing' && echo 1 || echo 0)" "${S2MS}ms $S2OUT"
chk "take then submit: the request stays in_review, no second open request" "$([ "$(status_of "$R3")" = in_review ] && [ "$(open_count company_phone)" = 1 ] && echo 1 || echo 0)"

# 4. Submit (session 1) vs take of the request it replaces (session 2): the take must be refused.
R4=$(mk office_address 'Office A')
race "select public.client_change_submit('$ACC', 'office_address', 'Office B'); select pg_sleep($HOLD);" "$(as $S2U) select public.client_changes_take('$R4');"
chk "submit then take: take waited and was refused" "$([ "$S2RC" != 0 ] && [ "$S2MS" -ge 1200 ] && echo "$S2OUT" | grep -qi 'already taken' && echo 1 || echo 0)" "${S2MS}ms $S2OUT"
chk "submit then take: old request superseded, one new pending, nobody holds it" "$([ "$(status_of "$R4")" = superseded ] && [ "$(open_count office_address)" = 1 ] && [ "$(one "select count(*) from public.client_portal_change_requests where field_key = 'office_address' and status = 'pending' and assigned_to is null")" = 1 ] && echo 1 || echo 0)"

# 5. Decide vs decide on one request held by session 1 (admin-style double click): only one decision lands.
R5=$(mk legal_structure 'LLC')
one "$(as $S1U) select public.client_changes_take('$R5');" >/dev/null
race "$(as $S1U) select public.client_changes_decide('$R5', 'validated', null); select pg_sleep($HOLD);" "$(as $S1U) select public.client_changes_decide('$R5', 'rejected', 'late');"
chk "decide/decide: second decision refused as already decided" "$([ "$S2RC" != 0 ] && [ "$S2MS" -ge 1200 ] && echo "$S2OUT" | grep -qi 'already been decided' && echo 1 || echo 0)" "${S2MS}ms $S2OUT"
chk "decide/decide: one decision kept, one audit row, one master history row" "$([ "$(status_of "$R5")" = validated ] && [ "$(one "select count(*) from public.admin_audit where target = '$R5'")" = 1 ] && [ "$(one "select count(*) from public.client_master_history where field = 'Entity Type'")" = 1 ] && echo 1 || echo 0)"

echo "concurrency: $TOTAL checks, $FAILS failed"
[ "$FAILS" -eq 0 ]
