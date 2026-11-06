#!/usr/bin/env bash
# Applies Document Base migrations 001 and 002 (od_copy schema) to the CRM project and deploys the
# onedrive-copy Edge Function. It does NOT schedule anything: the cron statement is only printed at the end.
# The job stays idle until a person presses "Start listing" in the panel. Read the module README first;
# every step here needs the user's approval. Run from Git Bash:
#   bash "D:/Abhijith Projects/CRM/Document Intelligence Module/supabase/deploy_onedrive_copy.sh"
set -euo pipefail

# Every failure stops the script with a clear message; nothing is ignored.
fail() { echo "FAILED: $*" >&2; exit 1; }

REF=pnnakrhfzyxudjaghoxx
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DBMIG="$ROOT/Database Module/Document Base/migrations"
TOOLS="$ROOT/Database Module/tools"
cd "$TOOLS" || fail "folder $TOOLS not found (it holds the Supabase CLI)"

# Re-run 002 whenever 001 is re-run: 001 resets the client_folders policy.
for m in 001_od_copy 002_od_copy_plan; do
  echo "== $m"
  [ -f "$DBMIG/$m.sql" ] || fail "migration file $DBMIG/$m.sql not found"
  # Both the CLI exit code and its output are checked: the CLI can print an error and still exit 0.
  rc=0
  out=$(npx --no-install supabase db query --linked --project-ref "$REF" -f "$DBMIG/$m.sql" 2>&1) || rc=$?
  if [ "$rc" -ne 0 ] || echo "$out" | grep -qiE '"_tag":"Error"|(^|[^a-z_])error:'; then
    echo "$out" >&2
    fail "migration $m (exit code $rc). Nothing after it was applied; fix the error and run the script again."
  fi
  echo "ok"
done

# The CLI deploys from <workdir>/supabase/functions/<name>, so stage a copy there.
STAGE="$(mktemp -d)" || fail "cannot create a temporary folder"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/supabase/functions" || fail "cannot create the staging folder"
cp -r "$HERE/onedrive-copy" "$STAGE/supabase/functions/onedrive-copy" || fail "cannot copy the function source"
rm -f "$STAGE/supabase/functions/onedrive-copy/"*_test.ts

echo "== deploy onedrive-copy"
rc=0
npx --no-install supabase functions deploy onedrive-copy --project-ref "$REF" --no-verify-jwt --workdir "$STAGE" || rc=$?
[ "$rc" -eq 0 ] || fail "Edge Function deploy (exit code $rc). The migrations were applied; the function was not deployed."

cat <<SQL

Done. Not scheduled yet. Before scheduling: set the secrets and settings (README steps 3-5), then run
this in the Supabase SQL editor (it is only printed here, never run by this script):

select cron.unschedule('od-copy') where exists (select 1 from cron.job where jobname = 'od-copy');
select cron.schedule(
  'od-copy',
  '* * * * *',
  \$\$
  select net.http_post(
    url := 'https://$REF.supabase.co/functions/v1/onedrive-copy',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-od-copy-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'od_copy_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  \$\$
);
SQL
