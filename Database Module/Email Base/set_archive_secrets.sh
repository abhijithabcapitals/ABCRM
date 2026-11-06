#!/usr/bin/env bash
# Sets the secrets the email-archive job needs, from the files in "Api Secrets/CRM-Email-Archive"
# (archive.pk8.pem, archive-secret.txt), which stay outside Git. Run it yourself from Git Bash after
# the Entra app exists (ARCHIVE.md, steps 2 to 4):
#   bash "D:/Abhijith Projects/CRM/Database Module/Email Base/set_archive_secrets.sh" <tenant-id> <client-id> <thumbprint>
# It prints no secret values. It does not enable the job.
set -euo pipefail

REF=pnnakrhfzyxudjaghoxx
TENANT="${1:?tenant id (Entra > Overview > Directory (tenant) ID)}"
CLIENT="${2:?client id (App registration > Application (client) ID)}"
THUMB="${3:?certificate thumbprint as shown in Entra}"
HERE="$(cd "$(dirname "$0")" && pwd)"
KEYS="${ARCHIVE_KEYS:-D:/Abhijith Projects/CRM/Api Secrets/CRM-Email-Archive}"
TOOLS="${SUPABASE_TOOLS:-D:/Abhijith Projects/CRM/Database Module/tools}"

[ -f "$KEYS/archive.pk8.pem" ] || { echo "missing $KEYS/archive.pk8.pem"; exit 1; }
[ -f "$KEYS/archive-secret.txt" ] || { echo "missing $KEYS/archive-secret.txt"; exit 1; }
SECRET="$(tr -d '\r\n' < "$KEYS/archive-secret.txt")"

cd "$TOOLS"
npx --no-install supabase secrets set --project-ref "$REF" \
  MS_TENANT_ID="$TENANT" MS_CLIENT_ID="$CLIENT" MS_CERT_THUMBPRINT="$THUMB" \
  ARCHIVE_SECRET="$SECRET" MS_CERT_PRIVATE_KEY="$(cat "$KEYS/archive.pk8.pem")"

# The cron job reads the same shared secret from Vault.
npx --no-install supabase db query --linked --project-ref "$REF" "
  do \$\$ begin
    if exists (select 1 from vault.secrets where name = 'email_base_archive_secret') then
      perform vault.update_secret((select id from vault.secrets where name = 'email_base_archive_secret'), '$SECRET');
    else
      perform vault.create_secret('$SECRET', 'email_base_archive_secret');
    end if;
  end \$\$;" > /dev/null
echo "Secrets set. Next: ARCHIVE.md step 9 (site_ref and enabled = true)."
