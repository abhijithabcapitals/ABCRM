#!/usr/bin/env bash
# Runs rollback/001_002_rollback.sql (twice) on a database copy made by run-local.sh (needs BIN, PORT and DBN), then checks:
# client_portal_me returns the old keys only, every new function and the new table are gone, and Client Base 003 still works.
# Any failed check exits non-zero. Nothing touches Supabase.
set -u
: "${BIN:?}" "${PORT:?}" "${DBN:?}"
HERE="$(cd "$(dirname "$0")" && pwd)"
PS=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d "$DBN" -q -At)
FAILS=0; TOTAL=0
chk() { TOTAL=$((TOTAL+1)); if [ "$2" = "1" ]; then echo "ok   $1"; else echo "FAIL $1 ${3:-}"; FAILS=$((FAILS+1)); fi; }
one() { "${PS[@]}" -v ON_ERROR_STOP=1 -c "$1" | tail -1; }
ADM='00000000-0000-0000-0000-0000000000a1'
ACC='aa000000-0000-0000-0000-0000000000bb'

"${PS[@]}" -v ON_ERROR_STOP=1 -c "
insert into public.profiles (id, full_name, role) values ('$ADM', 'Admin One', 'admin');
insert into public.client_master (client_id, legal_name, data) values ('CL000902', 'Beta LLC', '{\"Trade Name\": \"Beta\"}');" >/dev/null || { echo "FAIL seed"; exit 1; }

# before: the new shape is in place
chk "before: me has the new 'changes' key" "$(one "select (public.client_portal_me('$ACC') ? 'changes')::int")"
chk "before: client_change_submit exists" "$(one "select (to_regprocedure('public.client_change_submit(uuid,text,text)') is not null)::int")"

for pass in 1 2; do
  "${PS[@]}" -v ON_ERROR_STOP=1 -f "$HERE/../rollback/001_002_rollback.sql" >/dev/null 2>"$HERE/.rb_err" || { echo "FAIL rollback pass $pass"; cat "$HERE/.rb_err"; rm -f "$HERE/.rb_err"; exit 1; }
done
rm -f "$HERE/.rb_err"
chk "rollback ran twice without error" 1

chk "me returns the old top-level keys only" "$([ "$(one "select string_agg(k, ',' order by k) from jsonb_object_keys(public.client_portal_me('$ACC')) k")" = "display_name,documents,master_services,record,services,username" ] && echo 1 || echo 0)"
REC=$(one "select (select count(*) from jsonb_object_keys(public.client_portal_me('$ACC')->'record'))")
chk "me record has the old 14 keys" "$([ "$REC" = "14" ] && echo 1 || echo 0)" "(got $REC)"
LEFT=$(one "select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'client\_change\_%' or p.proname like 'client\_changes\_%' or p.proname in ('client_portal_gallery_path', 'client_portal_generated_visible'))")
chk "no new function remains" "$([ "$LEFT" = "0" ] && echo 1 || echo 0)" "(left $LEFT)"
chk "change requests table is gone" "$(one "select (to_regclass('public.client_portal_change_requests') is null)::int")"
chk "client_portal_documents kept" "$(one "select (to_regclass('public.client_portal_documents') is not null)::int")"

# rights as 003 sets them
chk "me: service_role may execute" "$(one "select has_function_privilege('service_role', 'public.client_portal_me(uuid)', 'execute')::int")"
chk "me: authenticated may not execute" "$(one "select (not has_function_privilege('authenticated', 'public.client_portal_me(uuid)', 'execute'))::int")"
chk "admin_clients: authenticated may execute" "$(one "select has_function_privilege('authenticated', 'public.client_portal_admin_clients()', 'execute')::int")"
chk "admin_clients: anon may not execute" "$(one "select (not has_function_privilege('anon', 'public.client_portal_admin_clients()', 'execute'))::int")"

# 003 still works: admin lists clients, creates an account, the client logs in and reads its record
LISTED=$("${PS[@]}" -v ON_ERROR_STOP=1 -c "set role authenticated; select set_config('request.jwt.claim.sub', '$ADM', false); select (jsonb_array_length(public.client_portal_admin_clients()) >= 1 and public.client_portal_admin_clients()::text like '%Beta LLC%')::int;" | tail -1)
chk "003: admin_clients lists the Client Master row" "$([ "$LISTED" = "1" ] && echo 1 || echo 0)" "(got $LISTED)"
LOGIN=$("${PS[@]}" -v ON_ERROR_STOP=1 -c "
set role authenticated; select set_config('request.jwt.claim.sub', '$ADM', false);
select public.client_portal_admin_save(null, 'CL000902', 'beta.user', 'a-long-password-1');
reset role;
select (public.client_portal_me((select id from public.client_portal_accounts where username = 'beta.user'))->'record'->>'legal_name' = 'Beta LLC')::int;" | tail -1)
chk "003: admin_save, then me returns the legal name" "$([ "$LOGIN" = "1" ] && echo 1 || echo 0)" "(got $LOGIN)"

echo "$((TOTAL-FAILS)) passed, $FAILS failed"
[ $FAILS -eq 0 ]
