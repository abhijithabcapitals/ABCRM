# Messenger Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Messenger tab with a floating bubble and a WhatsApp or Teams style team chat stored in the CRM database, with live unread badges.

**Architecture:** `MessengerBubble` is always loaded in `App.jsx` and holds the badge and one Realtime subscription. `MessengerPanel` loads lazily on first open. Chat lives in three `messenger_*` tables; browser writes to conversations and members go through checked functions.

**Tech Stack:** React 19, Vite, Supabase (Postgres, Realtime), `node:test`, local Postgres 18 for SQL tests.

**Spec:** `Messenger Module/docs/2026-11-04-messenger-bubble-design.md`

## Global Constraints

- Work only in worktree `D:\Abhijith Projects\CRM-messenger`, branch `messenger-bubble`. No push, merge, deploy, or live SQL without the user's approval for that step.
- SQL goes in `Database Module/Messanger Base/` (the user's spelling). Every table has row security; policies write `(select auth.uid())`. `001` and `002` are live: do not edit them.
- There is no admin exception: an admin cannot read a chat they are not in through the CRM.
- Message text is shown as text only. `dangerouslySetInnerHTML` is never used.
- All CSS is scoped under `.msgr-`, in `Messenger Module/components/chat.css`. The existing `messenger.css` stays for `TeamsPanel`.
- Bubble: `right: 20px`, `bottom: 88px`, `z-index: 8900`.
- No new npm dependency, no polling, no files in the database.
- Reuse `@app/supabase`. Screen text is plain English. Match existing comment density and naming.
- Keep edits to shared files (`App.jsx`, `tabs.js`, `Sidebar.jsx`, `Settings.jsx`, `IntegrationsPanel.jsx`, `ClientMaster.jsx`) to the few lines named.
- A feature is reported as working only after `tests/browser-check.md` passes with two real staff logins.

Commands, from the worktree root:
- Node tests: `node --test "Messenger Module/tests/"`
- Deno tests: `deno test --allow-env "Messenger Module/supabase/ms365/"`
- SQL tests: `bash "Database Module/Messanger Base/tests/run-local.sh"`
- Build, first running `npm ci` once in `Main Module` if `node_modules` is missing: `npm --prefix "Main Module" run build`

## Review Focus

1. A person's own message returns through Realtime after it was shown as sending: it must appear once, not twice. Pinned in Task 2.
2. A laptop waking from sleep has missed messages: the list, badge and open chat must catch up without a reload. Pinned in Task 3.
3. Pasting more than 4000 characters: a plain sentence and the text kept, not a database error. Pinned in Task 2.
4. A message from a deleted staff member has no sender: it shows "Former staff" rather than a blank or a crash. Pinned in Task 2.
5. Clicking inside the panel, on the bubble, or on a pop-up opened by the panel must not collapse it. Pinned in Task 2.

---

### Task 1: Chat tables, functions and access

**Files:**
- Create: `Database Module/Messanger Base/migrations/003_chat.sql`, `migrations/rollback/003_rollback.sql`, `migrations/schedule_chat_prune.sql`, `tests/030_chat_test.sql`
- Modify: `tests/000_stub.sql` (create publication `supabase_realtime`), `tests/run-local.sh`, `Database Module/Messanger Base/README.md`

**Interfaces:**
- Produces: the tables and functions in spec section 5, with these signatures:
  - `messenger_is_member(p_conversation uuid) returns boolean`
  - `messenger_start_direct(p_other uuid) returns uuid`
  - `messenger_create_group(p_title text, p_members uuid[]) returns uuid`
  - `messenger_add_members(p_conversation uuid, p_members uuid[]) returns void`
  - `messenger_remove_member(p_conversation uuid, p_member uuid) returns void`
  - `messenger_rename_group(p_conversation uuid, p_title text) returns void`
  - `messenger_leave(p_conversation uuid) returns void`
  - `messenger_mark_read(p_conversation uuid) returns void`
  - `messenger_chat_list() returns table(id uuid, kind text, title text, member_count int, other_name text, other_id uuid, last_body text, last_link_label text, last_sender_name text, last_message_at timestamptz, unread int)`
  - `messenger_read_state(p_conversation uuid) returns timestamptz`, the earliest `last_read_at` of the other members
  - `messenger_prune_messages() returns void`, service role only

Decisions:
- `messenger_messages.id` has a default but the browser may supply it. A repeat is refused by the primary key, which is how Retry avoids sending twice.
- A before-insert trigger forces `created_at = now()`. An after-insert trigger sets `last_message_at` through a `security definer` function.
- `link_ref` and `link_label` are null unless `link_type` is set. `web` requires `link_ref` starting `https://`, by a check constraint.
- `messenger_mark_read` uses `greatest(last_read_at, now())`.
- Add `messenger_messages` to `supabase_realtime` inside `do $$ if not exists ... $$`, so a re-run is safe. Rollback removes it first.
- `messenger_create_group`: title 1 to 80 characters, at least one other member, members must exist in `profiles`.
- Default-privilege note: the stub grants ALL by default as Supabase does, so each table and function needs an explicit `revoke` then `grant`.

- [ ] **Step 1: Write `030_chat_test.sql`** with each case printing `ok` or `FAILED`:
  - Non-member reads no conversation, member or message. An admin who is not a member reads none, and `messenger_chat_list()` as that admin omits the chat.
  - A member cannot insert a message as someone else, or into a chat they are not in. A supplied `created_at` is overwritten.
  - `messenger_start_direct` from each side gives one conversation; with self it raises.
  - Direct writes to conversations and members, and update or delete on messages, are refused for `authenticated`.
  - A non-owner cannot add, remove or rename. An owner can.
  - A removed member reads no earlier messages.
  - Last owner leaving passes ownership to the earliest `joined_at`. Last member leaving deletes the group and its messages.
  - Unread: 2 new messages from another person give `unread = 2`; own messages do not count; `messenger_mark_read` gives 0.
  - `messenger_read_state` returns the earliest of the others' times.
  - A profile delete keeps the message with `sender_id` null.
  - `anon` reaches no table or function. `authenticated` cannot run `messenger_prune_messages`.
  - Prune keeps a 364-day-old message and removes a 366-day-old one.
  - A web link not starting `https://` is refused.
- [ ] **Step 2: Run the SQL tests.** Expected: FAIL, migration missing.
- [ ] **Step 3: Write the migration, rollback, and `schedule_chat_prune.sql`**, with a comment that it needs separate approval. The runner runs 003 twice and never runs the schedule file; leftover counts include `messenger_%`.
- [ ] **Step 4: Run the SQL tests.** Expected: all ok, `rollback ok`.
- [ ] **Step 5: Commit** `Add chat tables and access rules`.

### Task 2: Chat rules

**Files:**
- Create: `Messenger Module/logic/chat.js`
- Test: `Messenger Module/tests/chat.test.mjs`

**Interfaces:**
- Produces, all pure with no imports:
  - `MAX_BODY = 4000`
  - `badgeText(total: number): string`, empty at 0 and below, `99+` above 99
  - `totalUnread(rows: {unread: number}[]): number`
  - `checkBody(text: string): string|null`, an error sentence or null
  - `checkWebLink(url: string): string|null`
  - `mergeMessage(list, message)`: inserts by `created_at`, replaces a row with the same `id`, never duplicates
  - `tickState(message, myId, othersReadAt): "sending"|"failed"|"sent"|"read"|null`, null for other people's messages
  - `dayKey(iso: string): string`, the date in Asia/Dubai as `YYYY-MM-DD`
  - `previewText(row, myId): string`
  - `senderName(name: string|null): string`
  - `chatTitle(row): string`
  - `shouldCollapse(target, panelEl, bubbleEl): boolean`

- [ ] **Step 1: Write the failing tests**

```js
test("badge", () => {
  assert.equal(badgeText(0), "");
  assert.equal(badgeText(99), "99");
  assert.equal(badgeText(100), "99+");
});
test("own message returning from Realtime appears once", () => {
  const sending = { id: "m1", created_at: "2026-11-04T10:00:00Z", status: "sending" };
  const out = mergeMessage([sending], { id: "m1", created_at: "2026-11-04T10:00:01Z" });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, undefined);
});
test("messages stay in time order", () => {
  const a = { id: "a", created_at: "2026-11-04T10:00:00Z" }, b = { id: "b", created_at: "2026-11-04T09:00:00Z" };
  assert.deepEqual(mergeMessage([a], b).map((m) => m.id), ["b", "a"]);
});
test("body limits", () => {
  assert.equal(checkBody("x".repeat(4000)), null);
  assert.match(checkBody("x".repeat(4001)), /4000/);
  assert.ok(checkBody("   "));
});
test("web links must be https", () => {
  assert.equal(checkWebLink("https://a.ae/x"), null);
  assert.ok(checkWebLink("http://a.ae"));
  assert.ok(checkWebLink("javascript:alert(1)"));
});
test("ticks", () => {
  const m = { sender_id: "me", created_at: "2026-11-04T10:00:00Z" };
  assert.equal(tickState({ ...m, status: "sending" }, "me", null), "sending");
  assert.equal(tickState({ ...m, status: "failed" }, "me", null), "failed");
  assert.equal(tickState(m, "me", null), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T09:00:00Z"), "sent");
  assert.equal(tickState(m, "me", "2026-11-04T10:00:00Z"), "read");
  assert.equal(tickState({ ...m, sender_id: "other" }, "me", null), null);
});
test("a deleted sender shows Former staff", () => {
  assert.equal(senderName(null), "Former staff");
  assert.equal(senderName("Sara"), "Sara");
});
test("day crosses at Dubai midnight, not UTC", () => {
  assert.equal(dayKey("2026-11-04T19:59:00Z"), "2026-11-04");
  assert.equal(dayKey("2026-11-04T20:01:00Z"), "2026-11-05");
});
test("collapse only on a real outside click", () => {
  const inside = {}, outside = {};
  const panel = { contains: (n) => n === inside }, bubble = { contains: () => false };
  assert.equal(shouldCollapse(outside, panel, bubble), true);
  assert.equal(shouldCollapse(inside, panel, bubble), false);
  assert.equal(shouldCollapse(outside, null, bubble), false);
});
```

Add one `previewText` case each for a text message, a link-only message, a group message with sender name, and a chat with no messages, and one `chatTitle` case each for direct and group.

- [ ] **Step 2: Run the node tests.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement `logic/chat.js`.** `dayKey` uses `Intl.DateTimeFormat` with `timeZone: "Asia/Dubai"`. Pop-ups opened by the panel render inside the panel element, so `shouldCollapse` stays this simple.
- [ ] **Step 4: Run the node tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add chat rules`.

### Task 3: Chat data service

**Files:**
- Create: `Messenger Module/services/chatApi.js`
- Test: `Messenger Module/tests/chatApi.test.mjs`

**Interfaces:**
- Consumes: Task 1 functions and tables.
- Produces: `createChatApi(client)` returning:
  - `chatList()`, `messages(conversationId, { before?, limit = 50 })` newest first, `readState(conversationId)`, `markRead(conversationId)`
  - `send({ id, conversationId, senderId, body, link? })`: a `23505` reply counts as success
  - `startDirect(otherId)`, `createGroup(title, memberIds)`, `addMembers`, `removeMember`, `renameGroup`, `leave`, `members(conversationId)`, `staff()` reading `profiles` for `id, full_name`
  - `searchRecords(type, query)` for the pickers, using the caller's access: `client_lookup` RPC for clients, `bd_leads` by `lead_number`, `tasks` by title; limit 20. Lead results give `lead_number` as the label only.
  - `subscribe(onMessage, onCatchUp): () => void`: one channel, insert events on `messenger_messages`; calls `onCatchUp` on `SUBSCRIBED` after a prior drop, and on `window` `focus` and `online`; the return value removes the channel and listeners.
- Default export: `createChatApi(supabase)` from `@app/supabase`. A second file is not needed; the test imports the named factory. `@app` cannot resolve in node, so the default instance lives in `services/chatClient.js`, which imports both.

- [ ] **Step 1: Write the failing tests** with a fake client recording calls:
  - `send` passes the supplied `id`; a `23505` error resolves; other errors throw a plain `Error` with a sentence, not the database text.
  - `messages` passes `before` and limit 50.
  - `subscribe`: first `SUBSCRIBED` does not call `onCatchUp`; `CHANNEL_ERROR` or `CLOSED` then `SUBSCRIBED` does.
  - A `focus` event calls `onCatchUp`. After unsubscribing it does not, and `removeChannel` was called.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Implement both files.** Provide a small `window` stand-in in the test.
- [ ] **Step 4: Run the node tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add chat data service`.

### Task 4: Bubble and panel shell

**Files:**
- Create: `Messenger Module/components/MessengerBubble.jsx`, `components/MessengerPanel.jsx`, `components/chat.css`, `components/ChatBoundary.jsx`, `components/useChat.js`
- Modify: `Main Module/src/App.jsx` (one lazy import and one line, inside the logged-in layout, after the main `Suspense` near line 559)
- Test: `Messenger Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 2 and Task 3.
- Produces:
  - `<MessengerBubble profile={profile} />`
  - `useChat(profileId)` returning `{ rows, total, error, reload, onMessage(fn) }`, holding the subscription; live inserts update `rows`, and catch-up calls `reload`.
  - `<MessengerPanel profile rows reload onMessage visible />`: two panes, with placeholders that Task 5 fills.

Decisions:
- The panel is `lazy`, loaded on first open, then kept mounted while collapsed, hidden by CSS, so drafts survive.
- Outside clicks: `pointerdown` on `document` using `shouldCollapse`. `Esc` collapses.
- `ChatBoundary` wraps the bubble and panel. On error the bubble shows without a badge and the page is unaffected.
- Panel size 720 by 620, limited to the window. Below 768 pixels wide it fills the screen and shows one pane at a time.
- Colours: `#0F6E56` for the bubble and own messages accent, `#A32D2D` for the badge.

- [ ] **Step 1: Add failing static tests:** `App.jsx` imports `MessengerBubble`; `MessengerBubble.jsx` lazily imports the panel; no `dangerouslySetInnerHTML` under `components/`; `chat.css` holds `right: 20px`, `bottom: 88px` and `z-index: 8900`; every selector in `chat.css` starts `.msgr-` or an `@media` rule.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Build the shell and mount it.**
- [ ] **Step 4: Run node tests and the build.** Expected: PASS; a separate panel chunk appears in the build output.
- [ ] **Step 5: Commit** `Add Messenger bubble and panel shell`.

### Task 5: Chat list and conversation

**Files:**
- Create: `Messenger Module/components/ChatList.jsx`, `components/Conversation.jsx`, `components/Composer.jsx`
- Modify: `components/MessengerPanel.jsx`, `components/chat.css`
- Test: `Messenger Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 2 rules, Task 3 service, Task 4 `onMessage`, `reload`, `visible`.
- Produces: `<Composer conversationId onSend(body, link) attachSlot />`, with `attachSlot` filled by Task 6. Drafts are kept per conversation in the panel's state.

Behaviour to build, from spec section 3:
- List: search filter on the title, latest first, initials, preview, time, unread count. An empty list shows "Start a chat with a colleague".
- Conversation: oldest to newest, day separators by `dayKey`, sender name in groups via `senderName`, ticks via `tickState`, load 50 more on scrolling up keeping the scroll position, "New messages" when scrolled up.
- `Enter` sends, `Shift+Enter` makes a new line.
- Send: create the `id` with `crypto.randomUUID()`, show as `sending`, on failure `failed` with "Not sent" and Retry using the same `id`. `checkBody` errors show under the box and keep the text.
- Mark read only when the chat is open, `visible` is true, and `document.visibilityState` is `visible`. Also on `visibilitychange` and on a new message under those conditions.
- `readState` is fetched on opening and on catch-up.
- A thin "Reconnecting" line while the channel is down.
- A list or message failure shows a plain sentence with Retry.

- [ ] **Step 1: Add failing static tests:** `Conversation.jsx` calls `tickState`, `dayKey`, `senderName`; `Composer.jsx` calls `checkBody`; `Conversation.jsx` checks `visibilityState` before `markRead`; no raw `error.message` is rendered from a database error in these files.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Build the components.** Message text renders as a React text node, with `white-space: pre-wrap`.
- [ ] **Step 4: Run node tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit** `Add chat list and conversation`.

### Task 6: New chats, groups and attachments

**Files:**
- Create: `Messenger Module/components/NewChat.jsx`, `components/GroupInfo.jsx`, `components/AttachPicker.jsx`
- Modify: `components/MessengerPanel.jsx`, `components/ChatList.jsx`, `components/Conversation.jsx`, `components/chat.css`
- Test: `Messenger Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: Task 3 service; `checkWebLink` from Task 2.
- Produces: `attachSlot` for `Composer`: a message link is `{ link_type, link_ref, link_label }`.

Behaviour, from spec section 3:
- New chat: search staff, click to open with `startDirect`. Self is left out.
- New group: title and at least one other person.
- Group info: member list; for owners add, remove and rename; for all, Leave with a confirm step.
- Attach: Client, Lead, Task or Web link. Labels: `Client <id>: <legal name>`, `Lead <number>`, the task title. Web link is checked with `checkWebLink`, and the label is the address.
- In a message: a web link opens in a new tab with `win.opener = null`; a record label is text only.

- [ ] **Step 1: Add failing static tests:** `AttachPicker.jsx` calls `checkWebLink`; lead labels use `lead_number` and never `prospect_name` or `lead.name`; `GroupInfo.jsx` calls `leave`, `removeMember`, `addMembers`, `renameGroup`.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Build the components.**
- [ ] **Step 4: Run node tests and the build.** Expected: PASS.
- [ ] **Step 5: Commit** `Add new chats, groups and attachments`.

### Task 7: Remove the tab and move Microsoft settings

**Files:**
- Delete: `Messenger Module/components/MessengerModule.jsx`, `components/Chats.jsx`, `components/Overview.jsx`
- Modify:
  - `Main Module/src/App.jsx` (remove lines 31 and 549), `Main Module/src/tabs.js:14`, `Main Module/src/components/Sidebar.jsx:864`, `Main Module/db/edge-function-admin-users.ts:34`
  - `Main Module/public/manifest.webmanifest` (`start_url` to `./`)
  - `Integrations Module/components/IntegrationsPanel.jsx` (lazy `MicrosoftConnection` under the `microsoft` row, as `ZohoConnection`)
  - `Main Module/src/components/Settings.jsx` (open the integrations tab when `ms` is in the address)
  - `Messenger Module/index.js` (export `MessengerBubble`)
  - `Messenger Module/components/Settings.jsx`, renamed `MicrosoftConnection.jsx`, which now reads and clears `ms` and `reason`, and shows `SyncLogs` below it; `Messenger Module/logic/connectionText.js` (remove what nothing uses)
  - `Messenger Module/supabase/ms365/handlers.ts` and its test: return to `?view=settings`
  - `Messenger Module/docs/deployment.md`, `docs/entra-setup.md`, `docs/api.md`, `README.md`, `Database Module/Messanger Base/README.md`
  - `Messenger Module/tests/browser-check.md`, `static.test.mjs`, `install.test.mjs`, `connectionText.test.mjs`

Decisions:
- `ChatStarter.jsx` and `TeamsPanel.jsx` stay on client and lead records.
- `?view=` support and `startView` stay in `App.jsx` and `tabs.js`.
- `deployment.md` gets: run `003_chat.sql` before merge; check Realtime limits; the `admin-users` redeploy is no longer needed; change the Desktop shortcut to the plain CRM address; `schedule_chat_prune.sql` needs separate approval.
- `tests/browser-check.md` gets the bubble section: two real logins exchanging messages live; a third login cannot see the chat; badge counts; click outside; `Esc`; two people starting a chat at once; laptop sleep then wake; admin not in a chat cannot read it; mobile width; bubble not covering the reading widget.

- [ ] **Step 1: Update static tests to fail:** no `key: "messenger"` in `tabs.js` or `Sidebar.jsx`; no `"messenger"` in the `admin-users` `TABS`; `@messenger` alias still present; `App.jsx` has no `view === "messenger"`; manifest `start_url` is `./`; `IntegrationsPanel.jsx` mentions `MicrosoftConnection`; `handlers.ts` returns to `view=settings`.
- [ ] **Step 2: Run node tests and Deno tests.** Expected: FAIL.
- [ ] **Step 3: Make the changes and update the documents.**
- [ ] **Step 4: Run all four commands.** Expected: all pass, build succeeds.
- [ ] **Step 5: Commit** `Replace the Messenger tab with the bubble`.

## After the tasks

Stop and report. These are separate user approvals, in this order: run `003_chat.sql` on the live database with Realtime, check Realtime limits, merge to `main`, change the Desktop shortcut, schedule the prune. The browser checklist needs two real staff logins.
