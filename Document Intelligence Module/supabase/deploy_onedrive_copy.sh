#!/usr/bin/env bash
# Applies Document Base migrations 001 and 002 (od_copy schema) to the CRM project and deploys the
# onedrive-copy Edge Function. It does NOT schedule anything: the cron statement is only printed at the end.
# The job stays idle until a person presses "Start listing" in the panel. Read the module README first;
# every step here needs the user's approval. Run from Git Bash:
#   bash "D:/Abhijith Projects/CRM/Document Intelligence Module/supabase/deploy_onedrive_copy.sh"
set -euo pipefail

REF=pnnakrhfzyxudjaghoxx
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
DBMIG="$ROOT/Database Module/Document Base/migrations"
TOOLS="$ROOT/Database Module/tools"
cd "$TOOLS"

# Re-run 002 whenever 001 is re-run: 001 resets the client_folders policy.
for m in 001_od_copy 002_od_copy_plan; do
  echo "== $m"
  out=$(npx --no-install supabase db query --linked --project-ref "$REF" -f "$DBMIG/$m.sql" 2>&1) || true
  if echo "$out" | grep -q '"_tag":"Error"'; then echo "$out"; exit 1; fi
  echo "ok"
done

# The CLI deploys from <workdir>/supabase/functions/<name>, so stage a copy there.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/supabase/functions"
cp -r "$HERE/onedrive-copy" "$STAGE/supabase/functions/onedrive-copy"
rm -f "$STAGE/supabase/functions/onedrive-copy/"*_test.ts

echo "== deploy onedrive-copy"
npx --no-install supabase functions deploy onedrive-copy --project-ref "$REF" --no-verify-jwt --workdir "$STAGE"

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
