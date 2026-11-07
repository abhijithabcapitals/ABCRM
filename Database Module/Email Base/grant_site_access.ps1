# Gives the CRM-Email-Archive app write access to the MailArchive SharePoint site only
# (Graph permission Sites.Selected). Replaces the Graph Explorer steps in ARCHIVE.md, step 4.
# Run in Windows PowerShell as yourself; a Microsoft sign-in window opens for an admin account.
#   powershell -ExecutionPolicy Bypass -File "D:\Abhijith Projects\CRM-email-archive\Database Module\Email Base\grant_site_access.ps1"
param(
  [string]$SitePath = "abcapitaluae.sharepoint.com:/sites/MailArchive",
  [string]$ClientId = ""
)
$ErrorActionPreference = "Stop"

if (-not $ClientId) { $ClientId = Read-Host "Paste the Application (client) ID of CRM-Email-Archive" }
if ($ClientId -notmatch '^[0-9a-fA-F-]{36}$') { throw "That does not look like a client ID (36 characters, e.g. 0aeaddbf-...)." }

if (-not (Get-Module -ListAvailable Microsoft.Graph.Sites)) {
  Write-Host "Installing the Microsoft Graph PowerShell module for your user (one time)..."
  Install-Module Microsoft.Graph.Sites -Scope CurrentUser -Force -AllowClobber
}
Import-Module Microsoft.Graph.Sites

Write-Host "Sign in with your admin account in the window that opens..."
Connect-MgGraph -Scopes "Sites.FullControl.All" -NoWelcome

$site = Get-MgSite -SiteId $SitePath
Write-Host "Site found: $($site.WebUrl)"
Write-Host "Site id:    $($site.Id)"

$existing = Get-MgSitePermission -SiteId $site.Id -All | Where-Object {
  $_.GrantedToIdentitiesV2.Application.Id -contains $ClientId -or $_.GrantedToIdentities.Application.Id -contains $ClientId
}
if ($existing) {
  Write-Host "The app already has access: roles = $($existing.Roles -join ', ')"
} else {
  $perm = New-MgSitePermission -SiteId $site.Id -BodyParameter @{
    roles = @("write")
    grantedToIdentities = @(@{ application = @{ id = $ClientId; displayName = "CRM-Email-Archive" } })
  }
  Write-Host "Granted: roles = $($perm.Roles -join ', ') on $($site.WebUrl)"
}
Disconnect-MgGraph | Out-Null
Write-Host "Done. Next: run set_archive_secrets.sh (ARCHIVE.md step 5)."
