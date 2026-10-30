#!/usr/bin/env bash
# Installs Email Base in the CRM Supabase project (pnnakrhfzyxudjaghoxx) and
# deploys the full-capture ceo-mail-sync function there. Run from Git Bash:
#   bash "D:/Abhijith Projects/CRM/Database Module/Email Base/deploy_to_crm.sh"
# Stops at the first error. The old ceo.mail_* tables are left untouched.
set -euo pipefail

REF=pnnakrhfzyxudjaghoxx
HERE="$(cd "$(dirname "$0")" && pwd)"
CRM="$(cd "$HERE/../.." && pwd)"
AGENT="$CRM/Agent Module/11_Personal_Agent/CEO Agent"
cd "$AGENT"

run_sql() {
  echo "== $1"
  out=$(npx --no-install supabase db query --linked --project-ref "$REF" "${@:2}" 2>&1) || true
  if echo "$out" | grep -q '"_tag":"Error"'; then echo "$out"; exit 1; fi
  echo "ok"
}

run_sql "001 Email Base"            -f "$HERE/migrations/001_email_base.sql"
run_sql "002 full message history"  -f "$HERE/migrations/002_full_message_history.sql"
run_sql "003 body search"           -f "$HERE/migrations/003_body_search.sql"
run_sql "004 BD drafts"             -f "$HERE/migrations/004_business_development_drafts.sql"
run_sql "CEO inbox assistant"       -f "$CRM/CEO Agent Module/supabase/migrations/202610300003_email_base_mail_assistant.sql"
run_sql "005 full capture"          -f "$HERE/migrations/005_full_capture.sql"
# The old schedule calls the function with a secret the new version does not accept.
run_sql "retire old cron job"       "select cron.unschedule(jobid) from cron.job where jobname = 'ceo-mail-sync'"

echo "== deploy ceo-mail-sync"
npx --no-install supabase functions deploy ceo-mail-sync --project-ref "$REF" --no-verify-jwt

echo
echo "Done. Add the info@abcapital.ae password as Edge Function secret"
echo "MAIL_PASSWORD_INFO_ABCAPITAL_AE in the CRM project (Dashboard > Edge Functions > Secrets)."
echo "bharat@ardentaxit.tax logs in with the existing MAIL_IMAP_USER / MAIL_IMAP_PASSWORD pair."
