# Messenger Module

The CRM's **Messenger** tab and the Teams panel on client and lead records: start a Microsoft Teams chat from the CRM.
Data lives in `Database Module/Messanger Base` (`crm_communication_links`). Design and plan: `docs/`.

## Layout

| Folder | Holds |
|---|---|
| `components/` | `MessengerModule` (shell and tabs), `Overview`, `Chats`, `ChatStarter` (staff picker and open button), `TeamsPanel` (record panel) |
| `logic/` | Pure rules: Teams deep link and message text, staff list |
| `services/messengerApi.js` | The only file that talks to Supabase |
| `tests/` | `node --test "Messenger Module/tests/"` |

## Rules the screens follow

- The Teams message holds only the record reference: client ID and legal name, lead number, or task title. No KYC data.
- The chat window opens straight from the click. If the browser blocks it, a visible link is shown.
- No tokens or secrets reach the browser. Message-reading scopes are never requested.
- The Chats tab lists only the person's own saved chats (last 20). A chat started there has no record, so it is not saved.
- Phase 2 adds Settings and Logs through the `TABS` list in `MessengerModule.jsx`.
