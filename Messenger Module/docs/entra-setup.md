# Entra app setup (Phase 2)

For the tenant admin. This creates the Microsoft app the CRM signs people in with. Nothing here is done by the CRM build; each step is yours.
Phase 2 asks for sign-in and the person's basic profile only. It never asks to read chats, channel messages or mail.

## 1. Register the app

1. Open the Microsoft Entra admin center (entra.microsoft.com) and sign in as an admin of the AB Capital tenant.
2. Go to **Identity > Applications > App registrations > New registration**.
3. Name: `AB Capital CRM Messenger`.
4. **Supported account types**: choose **Accounts in this organizational directory only (single tenant)**. Do not choose multitenant or personal accounts: the CRM refuses any other tenant, and a single-tenant app enforces it on Microsoft's side too.
5. Redirect URI: platform **Web**, and exactly this address:
   `https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ms365`
   It must match character for character. The function builds the same address from `SUPABASE_URL`.
6. Click **Register**.
7. On the **Overview** page, copy **Application (client) ID** and **Directory (tenant) ID**.

## 2. Create a client secret

1. **Certificates & secrets > Client secrets > New client secret**.
2. Pick a description and an expiry (shorter than 24 months). Write the expiry date down.
3. Copy the secret **Value** now. Microsoft shows it once.
4. Enter the expiry date in the CRM: Settings > Integrations > the Microsoft row > "Client secret expiry date". The screen warns from 30 days before it.

## 3. Add the permissions (Phase 2)

**API permissions > Add a permission > Microsoft Graph > Delegated permissions**, add:

| Permission | Why |
|---|---|
| `openid` | Sign in |
| `profile` | Name and email in the sign-in |
| `offline_access` | Lets the CRM keep the person signed in without asking again |
| `User.Read` | Reads the person's own name and email address |

None of these needs admin consent on its own. Click **Grant admin consent for AB Capital** anyway if you want people never to see a consent screen.
Do not add any other permission for Phase 2. The CRM asks for exactly these four.

### Later phases (do not add yet)

| Permission | Type | Phase |
|---|---|---|
| `Calendars.ReadWrite` | Delegated | 3 |
| `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Channel.Create` | Delegated | 4 |
| `TeamsActivity.Send.User` | Application (see the note below) | 5 |
| `OnlineMeetingTranscript.Read.All` | Application, with an application access policy | 6, only if approved |

### What was checked against Microsoft's permissions reference

Page: https://learn.microsoft.com/en-us/graph/permissions-reference, read on 2026-11-04. The page is very large, and the fetch tool read it in pieces.

Seen on the page:
- `User.Read`: delegated, admin consent not required.
- `Calendars.ReadWrite`: exists as both application and delegated. Delegated needs no admin consent.
- `Channel.ReadBasic.All`: exists as both. Delegated needs no admin consent.
- `Channel.Create`: exists as both. Admin consent is required for both.
- `Team.ReadBasic.All`: exists as both.
- `OnlineMeetingTranscript.Read.All`: exists as both. Admin consent is required for both.
- `openid` and `profile`: the page describes them only in text about OpenID Connect. They are standard sign-in scopes, not Graph resource permissions.

Not confirmed:
- `offline_access`: not seen as a separate entry on the pieces read. It is a standard OpenID Connect scope, but this was not confirmed on that page.
- `TeamsActivity.Send.User`: the exact name was **not found** on the page. The page lists `TeamsActivity.Send` (application and delegated; admin consent required for the application type). `TeamsActivity.Send.User` may be a resource-specific permission documented elsewhere. Check the name again before Phase 5. Phase 5 has no plan yet, so nothing depends on it today.
- Part of the page (the final 78,000 characters at one point) was cut off in one read, so a name reported "not found" means not found in the pieces read.

Nothing above was tested on the tenant.

## 4. Save the values in the CRM

In the CRM: **Settings > Integrations > Teams, OneDrive, Outlook and SharePoint (Microsoft Graph)**. Save:

| Name | Value |
|---|---|
| `MICROSOFT_TENANT_ID` | Directory (tenant) ID |
| `MICROSOFT_CLIENT_ID` | Application (client) ID |
| `MICROSOFT_CLIENT_SECRET` | The secret **Value**, not the secret ID |
| `MICROSOFT_STATE_SECRET` | A long random value you make up (at least 32 characters). Not from Microsoft |
| `MESSENGER_APP_URL` | The address of the live CRM, for example the GitHub Pages address ending in `/ABCRM/` |

Saved values go to Supabase Vault and are never shown again. The tenant ID must be the Directory (tenant) ID, the GUID, not a domain name: the function compares the GUID Microsoft returns, so a domain would always give `wrong_tenant`. The words `common`, `organizations` and `consumers` are refused.

## 5. First connection

1. An admin opens Settings > Integrations, opens the Microsoft row and presses **Connect Microsoft**, signing in with the work account.
2. Members can connect only after an admin has. Before that they see "An admin must connect Microsoft first."

### When the Microsoft email differs from the CRM email

The person's link is held for review. **No sign-in is stored at that point.** An admin sees the person under People (Settings > Integrations > Microsoft) and presses **Accept** or **Reject**. Accepting does not store a sign-in either: the person must press **Connect** again, and only then is a sign-in stored. If the account or email differs again on that second sign-in, the link goes back to review.
This also applies to the first admin: if the admin's Microsoft email differs from their CRM email, the link waits in review. The function does not stop an admin from accepting their own link, so with one admin the admin can accept it themselves. Preferably have a second admin accept it, or correct the profile email first. After accepting, the admin presses Connect again.

## 6. Renewing the secret

Create a new secret in Entra before the old one expires, save the new value in Settings > Integrations, then record the new expiry date in Settings > Integrations > Microsoft. Delete the old secret in Entra afterwards.

## 7. Removing access

- A person: Settings > Integrations > Microsoft > **Disconnect**, or an admin removes the person's consent in Entra. The next Microsoft call sees the refused token, clears it, and the person sees Connect again.
- Everyone: delete the app registration or the secret in Entra.
