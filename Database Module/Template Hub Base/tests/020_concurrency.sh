#!/usr/bin/env bash
# Twenty real psql sessions create Ardentax library documents at once against the throwaway cluster from run-local.sh (needs BIN and PORT).
# Every number must be different and the serials must run on with no gap. Nothing touches Supabase.
set -u
: "${BIN:?}" "${PORT:?}"
PS=("$BIN/psql.exe" -U postgres -p "$PORT" -h 127.0.0.1 -d postgres -q -At)
ARDENT='00000000-0000-0000-0000-0000000000b3'
CR=$(printf '\r')
FILE="$("${PS[@]}" -c "select max(id) from public.hub_library_template_files where template_key = 'Ardentax/Test/Doc'")"
FILE="${FILE%$CR}"
START="$("${PS[@]}" -c "select coalesce(max(document_serial), 0) from public.hub_documents where doc_type = 'library'")"
START="${START%$CR}"
OUT="$(mktemp -d)"
for i in $(seq 1 20); do
  ( "${PS[@]}" -c "select public.at_as('$ARDENT'); select document_serial from public.hub_library_create(public.at_lib('Ardentax/Test/Doc', $FILE))" 2>&1 | tail -1 >"$OUT/$i" ) &
done
wait
SERIALS="$(cat "$OUT"/* | sed "s/$CR//" | sort -n | tr '\n' ' ')"
EXPECT="$(seq $((START + 1)) $((START + 20)) | tr '\n' ' ')"
rm -rf "$OUT"
if [ "$SERIALS" = "$EXPECT" ]; then echo "ok   20 parallel library creates give 20 consecutive serials"; else echo "FAIL parallel serials: got [$SERIALS] expected [$EXPECT]"; exit 1; fi
