#!/usr/bin/env bash
# Two real psql sessions against the throwaway cluster started by run-local.sh (needs BIN and PORT).
# Session 1 holds its transaction open with pg_sleep; session 2 starts 1 second later and must wait, then get a clean refusal.
# Any failed check exits non-zero. Nothing touches Supabase.
set -u
: "${BIN:?}" "${PORT:?}"
PS=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -q -At)
SALES='00000000-0000-0000-0000-00000000000c'
HOLD=3
FAILS=0; TOTAL=0
chk() { TOTAL=$((TOTAL+1)); if [ "$2" = "1" ]; then echo "ok   $1"; else echo "FAIL $1 ${3:-}"; FAILS=$((FAILS+1)); fi; }
one() { "${PS[@]}" -c "$1" | tail -1; }

# New Business Setup quote for CL900002 as a signed-in sales user; $1 = optional revises_id.
mk() {
  local rev="${1:-}" extra=''
  [ -n "$rev" ] && extra=",\"revises_id\":\"$rev\""
  one "select public.bs_as('$SALES'); select (public.hub_document_create('{\"doc_type\":\"quote\",\"department\":\"Business Setup\",\"client_name\":\"Test Client LLC\",\"contact_name\":\"C\",\"contact_email\":\"c@x.ae\",\"contact_phone\":\"1\",\"client_address\":\"Dubai\",\"client_id\":\"CL900002\",\"lines\":[{\"description\":\"Concurrency line\",\"amount\":10}]$extra}'::jsonb)).id;"
}
status_of() { one "select status from public.hub_documents where id = '$1'"; }
lines_of()  { one "select count(*) from public.business_setup_services where quote_id = '$1'"; }

# Run session 1 (holds $HOLD seconds) in the background and session 2 one second later in the foreground.
# $1 = session 1 SQL (ends with the sleep), $2 = session 2 SQL. Sets S1RC, S1OUT, S2RC, S2OUT, S2MS.
race() {
  local t0 t1
  S1F=$(mktemp); ( "${PS[@]}" -v ON_ERROR_STOP=1 -c "select public.bs_as('$SALES'); $1" >"$S1F" 2>&1; echo $? >"$S1F.rc" ) &
  local pid=$!
  sleep 1
  t0=$(date +%s%N)
  S2OUT=$("${PS[@]}" -v ON_ERROR_STOP=1 -c "select public.bs_as('$SALES'); $2" 2>&1); S2RC=$?
  t1=$(date +%s%N); S2MS=$(( (t1 - t0) / 1000000 ))
  wait $pid
  S1OUT=$(cat "$S1F"); S1RC=$(cat "$S1F.rc"); rm -f "$S1F" "$S1F.rc"
}

# 1. Accept vs accept in one chain: B2 (revision of B1) is accepted by session 1; session 2 tries the root B1.
B1=$(mk); B2=$(mk "$B1")
race "select public.bs_accept('$B2'); select pg_sleep($HOLD);" "select public.bs_accept('$B1');"
chk "accept/accept: session 1 commits" "$([ "$S1RC" = 0 ] && echo 1 || echo 0)" "$S1OUT"
chk "accept/accept: session 2 waited for session 1" "$([ "$S2MS" -ge 1200 ] && echo 1 || echo 0)" "${S2MS}ms"
chk "accept/accept: session 2 refused as already accepted" "$([ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'already accepted' && echo 1 || echo 0)" "$S2OUT"
chk "accept/accept: no deadlock" "$(echo "$S1OUT$S2OUT" | grep -qi deadlock && echo 0 || echo 1)"
chk "accept/accept: member accepted, root not" "$([ "$(status_of "$B2")" = accepted ] && [ "$(status_of "$B1")" = superseded ] && echo 1 || echo 0)"
chk "accept/accept: tracker lines created once" "$([ "$(lines_of "$B2")" = 1 ] && [ "$(lines_of "$B1")" = 0 ] && echo 1 || echo 0)"

# 2. Same quote twice: both sessions accept Q; the second must fail, lines created once.
Q=$(mk)
race "select public.bs_accept('$Q'); select pg_sleep($HOLD);" "select public.bs_accept('$Q');"
chk "same quote twice: session 2 waited and was refused" "$([ "$S2RC" != 0 ] && [ "$S2MS" -ge 1200 ] && echo "$S2OUT" | grep -qi 'already accepted' && echo 1 || echo 0)" "${S2MS}ms $S2OUT"
chk "same quote twice: tracker lines created once" "$([ "$(lines_of "$Q")" = 1 ] && echo 1 || echo 0)"

# 3. Accept (session 1) vs revise (session 2) on a non-root member C2 of chain C1 -> C2.
C1=$(mk); C2=$(mk "$C1")
race "select public.bs_accept('$C2'); select pg_sleep($HOLD);" "select (public.hub_document_create('{\"doc_type\":\"quote\",\"department\":\"Business Setup\",\"client_name\":\"Test Client LLC\",\"contact_name\":\"C\",\"contact_email\":\"c@x.ae\",\"contact_phone\":\"1\",\"client_address\":\"Dubai\",\"client_id\":\"CL900002\",\"lines\":[{\"description\":\"Concurrency line\",\"amount\":10}],\"revises_id\":\"$C2\"}'::jsonb)).id;"
chk "accept then revise (non-root): no deadlock" "$(echo "$S1OUT$S2OUT" | grep -qi deadlock && echo 0 || echo 1)" "$S1OUT $S2OUT"
chk "accept then revise (non-root): accept commits, revise refused" "$([ "$S1RC" = 0 ] && [ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'only an issued quote can be revised' && echo 1 || echo 0)" "$S2OUT"
chk "accept then revise (non-root): one clean outcome" "$([ "$(status_of "$C2")" = accepted ] && [ "$(one "select count(*) from public.hub_documents where revises_id = '$C2'")" = 0 ] && [ "$(lines_of "$C2")" = 1 ] && echo 1 || echo 0)"

# 4. Revise (session 1) vs accept (session 2) on a non-root member D2 of chain D1 -> D2.
D1=$(mk); D2=$(mk "$D1")
race "select (public.hub_document_create('{\"doc_type\":\"quote\",\"department\":\"Business Setup\",\"client_name\":\"Test Client LLC\",\"contact_name\":\"C\",\"contact_email\":\"c@x.ae\",\"contact_phone\":\"1\",\"client_address\":\"Dubai\",\"client_id\":\"CL900002\",\"lines\":[{\"description\":\"Concurrency line\",\"amount\":10}],\"revises_id\":\"$D2\"}'::jsonb)).id; select pg_sleep($HOLD);" "select public.bs_accept('$D2');"
chk "revise then accept (non-root): no deadlock" "$(echo "$S1OUT$S2OUT" | grep -qi deadlock && echo 0 || echo 1)" "$S1OUT $S2OUT"
chk "revise then accept (non-root): revise commits, accept refused" "$([ "$S1RC" = 0 ] && [ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'only an issued quote can be accepted' && echo 1 || echo 0)" "$S2OUT"
chk "revise then accept (non-root): one clean outcome" "$([ "$(status_of "$D2")" = superseded ] && [ "$(one "select count(*) from public.hub_documents where revises_id = '$D2'")" = 1 ] && [ "$(lines_of "$D2")" = 0 ] && echo 1 || echo 0)"

# 5. Take vs take on one form: session 1 holds it, session 2 is told who has it.
mkform() {
  local cl="$1"
  "${PS[@]}" -c "insert into public.client_master (client_id, legal_name, data) values ('$cl', '$cl LLC', '{}'); insert into public.client_portal_accounts (client_master_id, display_name, username, password_hash) values ('$cl', '$cl', lower('$cl'), 'x'); select public.business_setup_form_create('$cl', (select id from public.client_portal_accounts where client_master_id = '$cl')); update public.business_setup_onboarding_forms set status = 'Submitted', answers = '{\"client_name\":\"Asha\",\"phone\":\"1\",\"email\":\"a@b.test\",\"services\":[\"Visa\"],\"company_status\":\"New\",\"activity\":\"Trading\",\"partners\":[{\"name\":\"Asha\",\"nationality\":\"Indian\"}]}' where client_id = '$cl'; insert into public.client_portal_documents (account_id, form_id, doc_type, file_name, storage_path, upload_complete, status) select account_id, id, t, t, gen_random_uuid()::text, true, 'validated' from public.business_setup_onboarding_forms, unnest(array['Passport','Ejari']) t where client_id = '$cl';" >/dev/null
  one "select id from public.business_setup_onboarding_forms where client_id = '$cl'"
}
F1=$(mkform CL900070)
race "select public.business_setup_form_take('$F1'); select pg_sleep($HOLD);" "select public.business_setup_form_take('$F1');"
chk "take vs take: first commits" "$([ "$S1RC" = 0 ] && echo 1 || echo 0)" "$S1OUT"
chk "take vs take: second is told it is taken" "$([ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'already taken' && echo 1 || echo 0)" "$S2OUT"

# 6. Validate vs validate on one form: one wins, the other is told, Client Master changes once.
F2=$(mkform CL900071)
race "select public.business_setup_form_validate('$F2','{}',null); select pg_sleep($HOLD);" "select public.business_setup_form_validate('$F2','{}',null);"
chk "validate vs validate: first commits" "$([ "$S1RC" = 0 ] && echo 1 || echo 0)" "$S1OUT"
chk "validate vs validate: second is told" "$([ "$S2RC" != 0 ] && echo "$S2OUT" | grep -qi 'already validated' && echo 1 || echo 0)" "$S2OUT"
chk "validate vs validate: one partner row" "$([ "$(one "select count(*) from public.business_setup_kyc_partners p join public.business_setup_kyc_profiles k on k.id = p.kyc_id where k.client_id = 'CL900071'")" = 1 ] && echo 1 || echo 0)"

echo "concurrency: $TOTAL checks, $FAILS failed"
[ "$FAILS" -eq 0 ]
