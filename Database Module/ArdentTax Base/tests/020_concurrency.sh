#!/usr/bin/env bash
# Twenty real psql sessions create quotes at once against the throwaway cluster from run-local.sh (needs BIN and PORT).
# Every number must be different and the serials must run on with no gap. Nothing touches Supabase.
set -u
: "${BIN:?}" "${PORT:?}"
PS=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -q -At)
MEMBER='00000000-0000-0000-0000-0000000000a2'
CR=$(printf '\r')
START="$("${PS[@]}" -c "select coalesce(max(document_serial), 0) from public.ardentax_documents where doc_type = 'quote'")"
START="${START%$CR}"
OUT="$(mktemp -d)"
for i in $(seq 1 20); do
  ( "${PS[@]}" -c "select public.at_as('$MEMBER'); select document_serial from public.ardentax_document_create(public.at_req('quote'))" 2>&1 | tail -1 >"$OUT/$i" ) &
done
wait
SERIALS="$(cat "$OUT"/* | sed "s/$CR//" | sort -n | tr '\n' ' ')"
EXPECT="$(seq $((START + 1)) $((START + 20)) | tr '\n' ' ')"
rm -rf "$OUT"
if [ "$SERIALS" = "$EXPECT" ]; then echo "ok   20 parallel creates give 20 consecutive serials"; else echo "FAIL parallel serials: got [$SERIALS] expected [$EXPECT]"; exit 1; fi
