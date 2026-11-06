#!/usr/bin/env bash
# Applies migration 009 (SharePoint archive queue, settings, report, cron job) to the CRM project
# and deploys the email-archive Edge Function. The job stays idle until
# email_base.archive_settings.enabled is set to true, and deletes nothing until
# delete_after_verify is set to true. Read ARCHIVE.md first. Run from Git Bash:
#   bash "D:/Abhijith Projects/CRM/Database Module/Email Base/deploy_archive.sh"
set -euo pipefail

REF=pnnakrhfzyxudjaghoxx
HERE="$(cd "$(dirname "$0")" && pwd)"
TOOLS="$HERE/../tools"
cd "$TOOLS"

for m in 009_onedrive_archive 010_archive_retention; do
  echo "== $m"
  out=$(npx --no-install supabase db query --linked --project-ref "$REF" -f "$HERE/migrations/$m.sql" 2>&1) || true
  if echo "$out" | grep -q '"_tag":"Error"'; then echo "$out"; exit 1; fi
  echo "ok"
done

# The CLI deploys from <workdir>/supabase/functions/<name>, so stage a copy there.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/supabase/functions"
cp -r "$HERE/supabase/email-archive" "$STAGE/supabase/functions/email-archive"
rm -f "$STAGE/supabase/functions/email-archive/archive.test.ts"

echo "== deploy email-archive"
npx --no-install supabase functions deploy email-archive --project-ref "$REF" --no-verify-jwt --workdir "$STAGE"

echo
echo "Done. Next: set the MS_* and ARCHIVE_SECRET secrets, the vault secret email_base_archive_secret,"
echo "then archive_settings.site_ref and enabled = true (ARCHIVE.md, steps 5, 6 and 9)."
