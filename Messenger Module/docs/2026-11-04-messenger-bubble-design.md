# Messenger bubble: in-CRM team chat design

Date: 2026-11-04. Status: awaiting user review. Branch: `messenger-bubble`.

This changes `2026-11-04-messenger-teams-design.md`. The decisions "Chat opens in Teams" and "In-house chat: not built" are replaced by this document. The rest of that spec stands: Teams meetings, channels, notifications and the Microsoft connection remain later phases.

## 1. Purpose

Staff message each other inside the CRM from a floating bubble on the right of every page, in a chat window that looks like WhatsApp or Teams, without leaving what they are doing.

Done means two real staff logins exchange messages live on the deployed CRM, unread badges behave as described in section 3, and a third login cannot read their chat.

## 2. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Where messages live | CRM database | User's choice. Free, works without Microsoft setup |
| Link to Teams chats | None. CRM chats and Teams chats are separate | Follows from the choice above |
| Messenger tab | Removed | User: a bubble, not a tab |
| Who gets the bubble | All logged-in staff, no tab grant | Staff need to reach each other |
| Teams panel on client and lead records | Stays | For opening Teams, and for meetings later |
| Old messages | Deleted after 12 months | Database is above its plan limit. Period can be changed |
| Files | Links only, no uploads | No files in the database |

Not in this version: file uploads, voice or video calls, emoji reactions, editing or deleting sent messages, alerts while the CRM is closed.

## 3. Behaviour

### Bubble

- A round button fixed on the right: `right: 20px`, `bottom: 88px`. This keeps it above the document reading widget (`right: 20px; bottom: 20px`) and the bottom-right Bruno pet planned on branch `router-agent`.
- `z-index: 8900`, below the reading widget at 9000.
- Rendered once in `App.jsx`, so it is on every page and in the desktop app. Not rendered in the client portal, which `Root.jsx` serves separately.
- A badge shows the total unread messages across chats, showing `99+` above 99, and hides at zero.

### Opening and closing

- Clicking the bubble toggles the panel.
- Clicking anywhere outside the panel and the bubble collapses it. So does `Esc`.
- A half-typed message stays when the panel closes and reopens, until the page reloads.

### Panel

- Two panes: chat list on the left, open conversation on the right.
- Size 720 by 620 pixels, limited to the window. Below 768 pixels wide it fills the screen and shows one pane at a time.
- Chat list: search box, New chat, New group, then chats with the latest message first. Each row shows initials, name or group title, a one-line preview, time, and an unread count.
- Conversation: header with name or group title and member count, messages oldest to newest, a box to type in, a send button and a paperclip.
- My messages sit on the right in a coloured bubble; others on the left with the sender's name in groups. Dates separate days.
- `Enter` sends, `Shift+Enter` starts a new line.
- One grey tick means sent. Two blue ticks mean read: in a one-to-one, by the other person; in a group, by every current member.
- Opens at the newest message, loading 50 at a time as the person scrolls up. If they have scrolled up when a message arrives, it does not jump; it shows "New messages".

### Chats

- One-to-one: pick any active staff member. If a chat with them exists, it opens rather than making a second one.
- Group: a title and at least one other member. The creator is the owner.
- Owners add and remove members and rename the group. Any member can leave. If the last owner leaves, the longest-standing member becomes owner. A group with no members left is deleted.
- A removed member loses the whole chat, including earlier messages.

### Reading

- Opening a chat with the panel visible marks it read. A chat that is open while the panel is collapsed, or while the browser tab is hidden, is not marked read until it is visible again.
- The badge and list counts update live without reloading.

### Attachments

The paperclip offers Client, Lead, Task or Web link.

- Client, lead and task pickers use the sender's own access, so they can attach only what they can see.
- The message carries a label such as `Client ABC-001: ABC Trading LLC`, `Lead LD-9` or a task title. Lead labels use the lead number only, as on the Teams panel.
- Web links must start with `https://` and open in a new tab.
- A label is what the sender chose to share. Members without access to that record see the label but cannot open the record. Clicking a record label does nothing beyond showing the text in this version, because the CRM has no address for a single record.

## 4. Architecture

```
App.jsx
  MessengerBubble (small, always loaded)  badge, Realtime subscription
    MessengerPanel (lazy, loads on first open)  lists, conversation, composer
services/chatApi.js  all reads, writes and the Realtime channel
logic/*.js           pure rules, tested
Postgres: messenger_* tables, RPCs, row security; supabase_realtime publication
```

Files in `Messenger Module/`:

| Path | Job |
|---|---|
| `components/MessengerBubble.jsx` | Button, badge, open and close, click outside |
| `components/MessengerPanel.jsx` | Two-pane layout |
| `components/ChatList.jsx`, `Conversation.jsx`, `Composer.jsx`, `NewChat.jsx`, `GroupInfo.jsx`, `AttachPicker.jsx` | One screen part each |
| `components/messenger.css` | All styling, scoped under `.msgr-` |
| `services/chatApi.js` | Data and Realtime |
| `logic/chat.js` | Unread totals, ticks, previews, day separators, link checks |

Removed: the Messenger tab, namely the `tabs.js` entry, `Sidebar.jsx` entry, `App.jsx` view line and `messenger` in `edge-function-admin-users.ts`, plus `Chats.jsx` and `Overview.jsx`. `MessengerModule.jsx` is removed once its Settings and Logs move.

Moved: Microsoft connection `Settings.jsx` and `SyncLogs.jsx` go under the `microsoft` row in Settings > Integrations, as `ZohoConnection` does. `ms365` is not deployed, so nothing live breaks. `MESSENGER_APP_URL` and the sign-in return point to `?view=settings`, which also reads `ms` and `reason`. A member's own Connect button returns with meetings, the first feature that needs it.

Desktop app: `start_url` in the manifest and the Desktop shortcut change from `?view=messenger` to the CRM's normal start page. The `?view=` support in `App.jsx` stays.

## 5. Database

Migration `Database Module/Messanger Base/migrations/003_chat.sql`, with rollback. `001` and `002` are already live and do not change.

| Table | Columns |
|---|---|
| `messenger_conversations` | `id`, `kind` (`direct`, `group`), `title` (groups only), `direct_key` unique (the two profile IDs sorted, directs only), `created_by`, `created_at`, `last_message_at` |
| `messenger_members` | `conversation_id`, `profile_id`, `role` (`owner`, `member`), `last_read_at`, `joined_at`; primary key on both IDs; cascades when the conversation or profile is deleted |
| `messenger_messages` | `id`, `conversation_id` cascading, `sender_id` set null on profile delete, `body` 1 to 4000 characters, `link_type` (`client`, `lead`, `task`, `web`), `link_ref`, `link_label`, `created_at` |

Indexes: `messenger_messages (conversation_id, created_at desc)` and `messenger_members (profile_id)`.

### Access

Row security on all three tables. Policies write `(select auth.uid())`.

- `messenger_is_member(conversation_id)`: `security definer`, pinned `search_path`. Used by policies, because a policy on `messenger_members` reading itself would recurse.
- Select on all three: members of that conversation only. **There is no admin exception**: an admin cannot read a chat they are not in through the CRM.
- Insert on `messenger_messages`: `sender_id` is the caller and the caller is a member. A trigger sets `last_message_at`, and `created_at` cannot be supplied by the caller.
- No update or delete on messages from the browser.
- No direct writes to conversations or members. These go through functions that check the caller:

| Function | Who | Does |
|---|---|---|
| `messenger_start_direct(p_other)` | Staff | Finds or creates the chat, safely if both start at once; refuses self |
| `messenger_create_group(p_title, p_members)` | Staff | Creates the group with the caller as owner |
| `messenger_add_members`, `messenger_remove_member`, `messenger_rename_group` | Owner | Group changes |
| `messenger_leave(p_conversation)` | Member | Leaves, passing on ownership or deleting the group |
| `messenger_mark_read(p_conversation)` | Member | Sets the caller's `last_read_at` |
| `messenger_chat_list()` | Staff | The caller's chats with preview and unread count |
| `messenger_read_state(p_conversation)` | Member | Earliest `last_read_at` of the other members, for the ticks |

`messenger_prune_messages()` removes messages older than 12 months and is service role only. Its daily schedule is in a separate `schedule_chat_prune.sql` that runs only on approval.

The client portal uses a portal token through an Edge Function and has no Supabase login, so `authenticated` here means staff.

### What admins and the system can see

Service role and direct database access can read everything, as with all CRM data. Messages are stored as plain text in the database, not end-to-end encrypted. Staff should be told that this is a work tool. The user decides any policy on this.

## 6. Live delivery

- `messenger_messages` joins the `supabase_realtime` publication. One channel per logged-in staff member, subscribed to inserts. Realtime applies row security, so a person receives only messages from chats they belong to.
- Live events update the open chat, list and badge.
- Realtime can miss events while disconnected, so `messenger_chat_list()` is fetched again on reconnect and when the browser tab regains focus. The database is the truth, not the channel.
- Read ticks update on those fetches and when the chat is opened, not live, to save Realtime traffic.
- Each browser window holds one Realtime connection. Whether the free plan's connection and message limits are enough is checked against Supabase's current limits before going live.

## 7. Errors

- A message appears at once as sending. On failure it shows "Not sent" with Retry; the text is kept. A retry cannot send twice, because the client supplies the message `id`.
- Lost connection shows a thin "Reconnecting" line in the panel. Messages can still be typed and retried.
- If the tables are missing or the list fails, the bubble still renders and the panel shows a plain sentence, never a raw database error.
- A failure in the bubble must not affect the page around it: it has its own error boundary.
- Message text is shown as text only. No HTML is ever rendered from a message.

## 8. Performance

The bubble is small and always loaded. The panel and its styles load on first open. No polling. Member names come with the chat list, not by loading every profile each time.

## 9. Testing

- SQL tests in `Database Module/Messanger Base/tests/` on local Postgres, with Supabase default privileges in the stub:
  - A non-member reads no conversation, member or message, and an admin who is not a member reads none.
  - A person cannot send as someone else, or send to a chat they are not in.
  - A removed member loses access to old messages.
  - Only an owner can change a group.
  - Direct chats are never duplicated; `start_direct` by both sides gives one chat.
  - Last owner leaving passes ownership; last member leaving deletes the group.
  - Unread counts are right; `anon` reaches nothing; prune keeps 364 days and removes 366.
- Node tests in `Messenger Module/tests/` for `logic/chat.js`, including `99+`, tick rules, web link checks, and static checks: no `dangerouslySetInnerHTML`, the tab entries are gone, the panel is lazy.
- `npm run build` passes in `Main Module`.
- `tests/browser-check.md`: the browser steps in section 1, using two real staff logins, which the user or staff run or provide.

## 10. Live steps needing approval, each one

Running `003_chat.sql` and adding the table to Realtime, checking Realtime limits, merging to `main`, which deploys at once, changing the Desktop shortcut, and scheduling `schedule_chat_prune.sql`. Migration runs before merge.

The live database is 1030 MB on a 500 MB plan. A text message is small, but the chat adds to a database already above its limit.
