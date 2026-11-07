# Messenger Module

The CRM's docked chat **panel** and the Messenger panel on client and lead records: start or reopen a CRM Messenger group about the record. The Microsoft connection screens are in Settings > Integrations.
Data lives in `Database Module/Messanger Base` (`crm_communication_links`). Design and plan: `docs/`.

The docked panel (`MessengerDock`, `DockSections`) shows the full page's own sections, one column at a time: Chats, Activity, Teams, Calls, Files and Inbox. The two share the same components and data.

Chats show one grey tick when sent, two grey when received, and two blue when read. A group needs every member for each step, and channels have no ticks. The header shows who is typing, in chats and channels; this is sent privately to members and never stored. Recording is not shown, as voice messages are not built yet.

The full page (`MessengerApp`, view `team-messenger`) has Chats, Activity and Files; Teams, Calendar and Calls say which phase they arrive in. The plan is in `replica/`, file setup in `docs/files-setup.md`. To see the page without a login, run the dev server and open `/messenger-preview.html`, which uses fake data.

## Layout

| Folder | Holds |
|---|---|
| `components/` | `MessengerDock`, `ChatRail` and the chat screens, `RecordChatPanel` (record panel: picks staff, then creates or reopens a Messenger group for the record and opens it in the dock; saved chats show archived or gone groups), `MicrosoftConnection` (admin: connection, people review, test, secret expiry; shown under the microsoft row in Settings > Integrations), `SyncLogs` (admin log, shown below it) |
| `logic/` | Pure rules: Teams deep link and message text, staff list, sentences for the Microsoft return and secret expiry |
| `services/messengerApi.js` | The only file that talks to Supabase and the `ms365` function |
| `supabase/ms365/` | The Edge Function: Microsoft sign-in, token storage in Vault, Graph client |
| `supabase/messenger-files/` | The Edge Function: short-lived links for chat files in private R2 storage |
| `docs/` | `entra-setup.md`, `api.md`, `deployment.md`, `testing-report.md`, design and plan |
| `tests/` | `node --test "Messenger Module/tests/"` |

## Rules the screens follow

- A record group is named after the record (for example `Lead LD-2026-000005 · Al Noor Trading`) and starts with the record reference. No KYC data. The same record with the same people reopens the same group: `crm_communication_links` keeps `messenger:<conversation id>:<member ids>` as the reference.
- The chat window opens straight from the click. If the browser blocks it, a visible link is shown.
- No tokens or secrets reach the browser. Message-reading scopes are never requested.
- Only admins open Settings > Integrations, so the Microsoft screens are admin-facing.
- Microsoft sends the person back with `ms` and `reason` in the address; `MicrosoftConnection` shows a sentence and removes them (the return goes to `?view=settings`).
- Nothing is live. Every live step needs separate approval: see `docs/deployment.md`. A feature works only after `tests/browser-check.md` passes on the tenant.
