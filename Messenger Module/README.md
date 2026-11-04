# Messenger Module

The CRM's **Messenger** tab and the Teams panel on client and lead records: start a Microsoft Teams chat from the CRM.
Data lives in `Database Module/Messanger Base` (`crm_communication_links`). Design and plan: `docs/`.

## Layout

| Folder | Holds |
|---|---|
| `components/` | `MessengerModule` (shell and tabs), `Overview`, `Chats`, `ChatStarter` (staff picker and open button), `TeamsPanel` (record panel), `Settings` (Microsoft connection), `SyncLogs` (admin log) |
| `logic/` | Pure rules: Teams deep link and message text, staff list, sentences for the Microsoft return and secret expiry |
| `services/messengerApi.js` | The only file that talks to Supabase and the `ms365` function |
| `supabase/ms365/` | The Edge Function: Microsoft sign-in, token storage in Vault, Graph client |
| `docs/` | `entra-setup.md`, `api.md`, `deployment.md`, `testing-report.md`, design and plan |
| `tests/` | `node --test "Messenger Module/tests/"` |

## Rules the screens follow

- The Teams message holds only the record reference: client ID and legal name, lead number, or task title. No KYC data.
- The chat window opens straight from the click. If the browser blocks it, a visible link is shown.
- No tokens or secrets reach the browser. Message-reading scopes are never requested.
- The Chats tab lists only the person's own saved chats (last 20). A chat started there has no record, so it is not saved.
- Settings (everyone: connect, reconnect, disconnect; admins: connection, people review, test, secret expiry) and Logs (admins) are tabs in `MessengerModule.jsx`.
- Microsoft sends the person back with `ms` and `reason` in the address; the module shows a sentence and removes them.
- Nothing is live. Every live step needs separate approval: see `docs/deployment.md`. A feature works only after `tests/browser-check.md` passes on the tenant.
