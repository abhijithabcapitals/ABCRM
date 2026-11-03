# Messenger Module Phases 1 and 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Open Teams chats from client and lead records, install the CRM as a desktop app, and connect staff to Microsoft through a secure sign-in.

**Architecture:** React module `Messenger Module` under alias `@messenger`, using Teams deep links (no Microsoft token) for chat. Edge Function `ms365` is the only Graph caller; refresh tokens stay in Vault. Installed app is a PWA over the same build.

**Tech Stack:** React 19, Vite, Supabase (Postgres, Edge Functions on Deno, Vault), Microsoft Entra ID OAuth 2.0, Microsoft Graph, `node:test`, `deno test`, local Postgres 18 for SQL tests.

**Spec:** `Messenger Module/docs/2026-11-04-messenger-teams-design.md`

Phases 3 to 6 get their own plans after these phases are tested on the tenant.

## Global Constraints

- Work only in worktree `D:\Abhijith Projects\CRM-messenger`, branch `messenger-module`. No push, merge, deploy, or live SQL without the user's approval for that step.
- SQL goes in `Database Module/Messanger Base/` (the user's spelling). Every table has row security; policies write `(select auth.uid())`. Rollback sits in `migrations/rollback/`.
- Tokens and secrets never reach the browser, browser storage, logs, or the service worker. Message-reading scopes are never requested.
- Deep links carry only client ID and legal name, lead number, or task title. KYC data is never included.
- Reuse `@banking/components/shared` (`Button`, `Spinner`, `ErrorNote`, `Empty`, `useLoad`), `banking.css`, `@app/supabase`. No new npm dependency.
- Edits to `App.jsx`, `vite.config.js`, `Sidebar.jsx` stay to a few lines: `optimize-core` is changing them. Do not touch `Tasks.jsx` in this plan.
- Match existing comment density and naming. Screen text is plain English.
- A feature is reported as working only after `tests/browser-check.md` passes on the real tenant.

Commands, from the worktree root:
- Node tests: `node --test "Messenger Module/tests/"`
- Deno tests: `deno test --allow-env "Messenger Module/supabase/ms365/"`
- SQL tests: `bash "Database Module/Messanger Base/tests/run-local.sh"`
- Build, first running `npm ci` once in `Main Module`: `npm --prefix "Main Module" run build`

## Review Focus

1. A client or lead name with `&`, `#`, a comma, or Arabic text must arrive in Teams intact, not cut at the symbol. Pinned in Task 1.
2. A very long message must not produce a link too long to open; it is shortened. Pinned in Task 1.
3. A blocked pop-up must still leave the person a working link on screen. Pinned in Task 3.
4. Going back to, or reloading, the Microsoft return page must show a clear message and must not overwrite a good token. Pinned in Task 7 and Task 9.
5. A member without the Messenger grant who opens the installed app must land on a page they may see, not an error. Pinned in Task 5.

---

## Phase 1: chat links and desktop install

### Task 1: Deep link logic

**Files:**
- Create: `Messenger Module/logic/deepLink.js`
- Test: `Messenger Module/tests/deepLink.test.mjs`

**Interfaces:**
- Produces: `buildChatLink({ emails: string[], topic?: string, message?: string }): string`, `referenceText({ recordType: "client"|"lead"|"task", id: string, label: string }): string`, `participantsKey(emails: string[]): string`, `MAX_MESSAGE = 800`.

- [ ] **Step 1: Write the failing tests**

```js
test("one person: no topic even if given", () => {
  const url = new URL(buildChatLink({ emails: ["a@abcapital.ae"], topic: "T" }));
  assert.equal(url.origin + url.pathname, "https://teams.microsoft.com/l/chat/0/0");
  assert.equal(url.searchParams.get("users"), "a@abcapital.ae");
  assert.equal(url.searchParams.get("topicName"), null);
});
test("group: emails trimmed, lowercased, deduped, comma-joined, topic kept", () => {
  const url = new URL(buildChatLink({ emails: [" B@x.ae", "a@x.ae", "b@x.ae"], topic: "VAT" }));
  assert.equal(url.searchParams.get("users"), "b@x.ae,a@x.ae");
  assert.equal(url.searchParams.get("topicName"), "VAT");
});
test("symbols and Arabic survive", () => {
  const msg = "Al Noor & Sons, #12 شركة";
  assert.equal(new URL(buildChatLink({ emails: ["a@x.ae"], message: msg })).searchParams.get("message"), msg);
});
test("long message is cut to MAX_MESSAGE", () => {
  const got = new URL(buildChatLink({ emails: ["a@x.ae"], message: "x".repeat(5000) })).searchParams.get("message");
  assert.equal(got.length, MAX_MESSAGE);
});
test("no usable email throws", () => {
  assert.throws(() => buildChatLink({ emails: ["", "  "] }), /at least one person/i);
});
test("referenceText", () => {
  assert.equal(referenceText({ recordType: "client", id: "ABC-001", label: "ABC Trading LLC" }), "Client ABC-001: ABC Trading LLC");
  assert.equal(referenceText({ recordType: "lead", id: "LD-9", label: "Noor" }), "Lead LD-9: Noor");
});
test("participantsKey ignores order and case", () => {
  assert.equal(participantsKey(["B@x.ae", "a@x.ae"]), participantsKey(["a@x.ae", "b@x.ae"]));
});
```

- [ ] **Step 2: Run the node tests.** Expected: FAIL, module not found.
- [ ] **Step 3: Implement the three functions in `logic/deepLink.js`** using `URLSearchParams` for encoding. Pure, with no imports.
- [ ] **Step 4: Run the node tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Teams deep link builder`.

### Task 2: Communication links table

**Files:**
- Create: `Database Module/Messanger Base/migrations/001_communication_links.sql`, `migrations/rollback/001_rollback.sql`, `tests/000_stub.sql`, `tests/010_links_test.sql`, `tests/run-local.sh`, `README.md`

**Interfaces:**
- Produces: table `public.crm_communication_links(id uuid pk, record_type text check in ('client','lead','task'), record_id text not null, link_type text check in ('chat','meeting','channel'), reference text not null, label text, created_by uuid default auth.uid() references profiles, created_at timestamptz default now())`, unique on `(record_type, record_id, link_type, reference)`, index on `(record_type, record_id)`.

Copy the shape of `Database Module/Knowledge Base/tests/run-local.sh` (two migration passes, tests, rollback, leftover count). The stub holds `profiles`, `client_master`, `bd_leads`, `tasks`, each with row security and a stub rule, so parent access can be tested.

Policies:
- select: parent row is visible to the caller, by `exists` on `client_master.client_id`, `bd_leads.id::text`, or `tasks.id::text`, so the parent's own row security applies.
- insert: `created_by = (select auth.uid())` and the same parent check.
- delete: own row or `admin_is()`.
- No update. No access for `anon`.

- [ ] **Step 1: Write `010_links_test.sql` and the stub** with these cases, each printing `ok` or `FAILED`: a person with client access sees that client's link; a person without it sees none and cannot insert one; a person cannot insert with another `created_by`; a person cannot delete another's row; an admin can; a repeat insert of the same reference is refused by the unique rule; `anon` reads nothing.
- [ ] **Step 2: Run the SQL tests.** Expected: FAIL, migration missing.
- [ ] **Step 3: Write the migration and rollback.** Idempotent, as other Bases are.
- [ ] **Step 4: Run the SQL tests.** Expected: both passes ok, all cases ok, `rollback ok`.
- [ ] **Step 5: Commit** `Add communication links table`.

### Task 3: TeamsPanel on client and lead records

**Files:**
- Create: `Messenger Module/services/messengerApi.js`, `Messenger Module/components/TeamsPanel.jsx`, `Messenger Module/logic/people.js`
- Modify: `Client Module/crm/ClientMaster.jsx` (one import, one line before `ClientAccess`, near line 138), `Business Development Module/components/BusinessDevelopment.jsx` (one import, one line in `LeadWorkspace`, from line 690)
- Test: `Messenger Module/tests/people.test.mjs`, `Messenger Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: `buildChatLink`, `referenceText`, `participantsKey` from Task 1; `crm_communication_links` from Task 2.
- Produces: `<TeamsPanel recordType recordId displayId label currentUserId />`, where `recordId` is what is stored and `displayId` is what the message shows; `listStaff(): Promise<{id, full_name, email}[]>`, `listLinks(recordType, recordId)`, `saveChatLink({recordType, recordId, reference, label})`, `deleteLink(id)`; `splitStaff(rows, currentUserId): { available, noEmail }`.

- [ ] **Step 1: Write the failing tests**

```js
test("splitStaff leaves out self and separates people with no email", () => {
  const { available, noEmail } = splitStaff([
    { id: "1", full_name: "Me", email: "me@x.ae" },
    { id: "2", full_name: "A", email: "a@x.ae" },
    { id: "3", full_name: "B", email: " " },
  ], "1");
  assert.deepEqual(available.map((p) => p.id), ["2"]);
  assert.deepEqual(noEmail.map((p) => p.id), ["3"]);
});
test("browser code holds no token words", () => {
  const src = readAll("components", "services", "logic");
  assert.doesNotMatch(src, /refresh_token|client_secret|MICROSOFT_CLIENT_SECRET/);
});
test("panel falls back to a visible link when the pop-up is blocked", () => {
  const src = read("components/TeamsPanel.jsx");
  assert.match(src, /window\.open\(/);
  assert.match(src, /blocked/i);
});
```

`readAll` and `read` follow `Knowledge Module/tests/static.test.mjs`.

- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Implement `logic/people.js` and `services/messengerApi.js`.** `listStaff` reads `id, full_name, email` from `profiles`.
- [ ] **Step 4: Implement `TeamsPanel.jsx`.**

Screen: a "Teams" panel with a searchable staff picker, a topic box shown when two or more people are chosen, a message box prefilled with `referenceText`, an **Open in Teams** button, and a list of saved chats with **Open again** and remove. People with no email appear greyed with "No email on file".

On click, call `window.open` first, in the click handler, so browsers allow it. If it returns null, show the link with "Your browser blocked the new window. Open it here." Then save the reference: `participantsKey` as `reference`, the topic or names as `label`. A failed save shows a note and never stops the chat, and a unique-rule refusal is ignored.

- [ ] **Step 5: Add the panel** to `ClientForm` when `row.client_id` is set: `recordId` and `displayId` are `row.client_id`, `label` is `plain(rec["Client Legal Name"])`. Add it to `LeadWorkspace`: `recordId` is `lead.id`, `displayId` is `lead.lead_number`, `label` is `lead.prospect_name`.
- [ ] **Step 6: Run node tests and the build.** Expected: PASS, build succeeds.
- [ ] **Step 7: Commit** `Add Teams panel to client and lead records`.

### Task 4: Module shell and tab

**Files:**
- Create: `Messenger Module/index.js`, `components/MessengerModule.jsx`, `components/Overview.jsx`, `components/Chats.jsx`, `Messenger Module/README.md`
- Modify: `Main Module/vite.config.js`, `Main Module/src/App.jsx`, `Main Module/src/tabs.js`, `Main Module/src/components/Sidebar.jsx`
- Test: `Messenger Module/tests/static.test.mjs`

**Interfaces:**
- Consumes: `TeamsPanel`'s picker. Extract `components/ChatStarter.jsx` from it (props: `message`, `onOpened`) and reuse it in `Chats.jsx`.
- Produces: default export `MessengerModule({ profile })`; tabs Overview, Chats. Phase 2 adds Settings and Logs through the `TABS` list in that file.

- [ ] **Step 1: Add failing static tests:** `vite.config.js` has `@messenger`; `App.jsx` has `lazy(() => import("@messenger"))`; `tabs.js` has key `messenger`; `Sidebar.jsx` has key `messenger`.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Build the shell.** Overview shows a short status: chats ready, Microsoft connection "Not connected" until Phase 2. Chats shows `ChatStarter` with no record, and the person's last 20 saved chats.
- [ ] **Step 4: Make the four shared-file edits.** Sidebar uses `IconMail`, placed after Knowledge. `view === "messenger" && <Messenger profile={profile} />`.
- [ ] **Step 5: Run node tests and the build.** Expected: PASS. A separate `MessengerModule` chunk appears in the build output.
- [ ] **Step 6: Commit** `Add Messenger tab`.

### Task 5: Desktop install

**Files:**
- Create: `Main Module/public/manifest.webmanifest`, `Main Module/public/sw.js`, `Main Module/public/icons/app-192.png`, `app-512.png`, `Messenger Module/tests/browser-check.md`
- Modify: `Main Module/index.html` (manifest and theme-color tags), `Main Module/src/main.jsx` (register in production only), `Main Module/src/tabs.js`, `Main Module/src/App.jsx` (view initial value)
- Test: `Messenger Module/tests/install.test.mjs`

**Interfaces:**
- Produces: `startView(search: string, saved: string|null): string|null` in `tabs.js`, returning the `view` query value when present, otherwise `saved`.

- [ ] **Step 1: Write the failing tests**

```js
test("startView prefers the query, then the saved view", () => {
  assert.equal(startView("?view=messenger", "hr"), "messenger");
  assert.equal(startView("", "hr"), "hr");
  assert.equal(startView("?x=1", null), null);
});
test("a member without the grant does not land on messenger", () => {
  assert.equal(resolveView("messenger", false, ["hr"]), "hr");
});
test("manifest is scoped relatively and opens Messenger", () => {
  const m = JSON.parse(read("../Main Module/public/manifest.webmanifest"));
  assert.equal(m.scope, "./");
  assert.equal(m.start_url, "./?view=messenger");
  assert.equal(m.display, "standalone");
  assert.deepEqual(m.icons.map((i) => i.sizes), ["192x192", "512x512"]);
});
test("service worker never caches", () => {
  assert.doesNotMatch(read("../Main Module/public/sw.js"), /caches\.|respondWith/);
});
```

- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Icons are resized and padded square from `Branding/AB Capital/AB Capital Logo.webp` with Pillow. `sw.js` holds install and activate listeners only, in this phase. In `App.jsx`, use `startView` in the initial state, keeping the existing legacy-name handling, then remove `view` from the address with `history.replaceState` so a later reload honours the person's own navigation. Register with `import.meta.env.BASE_URL + "sw.js"`.
- [ ] **Step 4: Run node tests and the build with `GITHUB_PAGES=true`.** Expected: PASS; `dist/index.html` links `/ABCRM/manifest.webmanifest`; `dist/sw.js` exists.
- [ ] **Step 5: Write `tests/browser-check.md`** for Phase 1: open a chat from a client and a lead, with one person and a group, name with symbols; Teams desktop opens; blocked pop-up; install in Edge and Chrome on Windows; app opens on Messenger; member without the grant.
- [ ] **Step 6: Commit** `Add installable desktop app`.

## Phase 2: Microsoft connection

### Task 6: Connection tables and token storage

**Files:**
- Create: `Database Module/Messanger Base/migrations/002_microsoft_connection.sql`, `migrations/rollback/002_rollback.sql`, `tests/020_connection_test.sql`, `migrations/schedule_prune.sql`
- Modify: `tests/000_stub.sql` (add `vault` stub), `tests/run-local.sh`, `README.md`

**Interfaces:**
- Produces:
  - `microsoft_connection(id boolean primary key default true check (id), tenant_id text, status text check in ('not_connected','active','revoked'), connected_by uuid, consented_at timestamptz, updated_at timestamptz)`
  - `microsoft_user_links(profile_id uuid primary key references profiles on delete cascade, microsoft_user_id text unique, upn text, scopes text[], status text check in ('active','review','revoked'), teams_app_installed boolean default false, updated_at timestamptz)`
  - `microsoft_sync_log(id bigint identity pk, action text not null, status text not null, error_code text, actor uuid, detail jsonb, created_at timestamptz default now())`, indexed on `created_at`
  - `ms_token_set(p_profile uuid, p_token text)`, `ms_token_get(p_profile uuid) returns text`, `ms_token_delete(p_profile uuid)`, security definer, Vault name `ms_rt:<profile_id>`, execute for `service_role` only
  - `ms365_prune_logs()`: removes `microsoft_sync_log` rows older than 90 days

`schedule_prune.sql` holds the cron schedule and is not part of the migration: it runs only on separate approval.

- [ ] **Step 1: Write `020_connection_test.sql`:** a member reads their own link only; a member cannot change `status` on their own link; a member cannot read `microsoft_connection` tenant data or the log; an admin reads all; `authenticated` cannot execute `ms_token_get` or `ms_token_set`; only one connection row can exist; prune removes a 91-day-old row and keeps an 89-day-old one.
- [ ] **Step 2: Run the SQL tests.** Expected: FAIL.
- [ ] **Step 3: Write the migration and rollback.** Writes to all three tables happen through the service role. Rollback also deletes `ms_rt:%` secrets from Vault.
- [ ] **Step 4: Run the SQL tests.** Expected: all ok, `rollback ok`.
- [ ] **Step 5: Commit** `Add Microsoft connection tables and token storage`.

### Task 7: Sign-in logic

**Files:**
- Create: `Messenger Module/supabase/ms365/auth.ts`, `auth.test.ts`

**Interfaces:**
- Produces:
  - `PHASE2_SCOPES = ["openid", "profile", "offline_access", "User.Read"]`
  - `signState(key: string, profileId: string, now: number): Promise<string>`
  - `verifyState(key: string, state: string, now: number): Promise<{ profileId: string; nonce: string }>`, throwing `StateError`
  - `pkceFrom(key: string, nonce: string): Promise<{ verifier: string; challenge: string }>`
  - `authorizeUrl(cfg: { tenantId, clientId, redirectUri }, state: string, challenge: string, scopes: string[]): string`
  - `readIdToken(idToken: string): { tid: string; oid: string; email: string }`
  - `linkStatus(microsoftEmail: string, profileEmail: string|null): "active"|"review"`

- [ ] **Step 1: Write the failing tests**

```ts
Deno.test("state round trips", async () => {
  const s = await signState("k", "user-1", 1000);
  assertEquals((await verifyState("k", s, 1000 + 60_000)).profileId, "user-1");
});
Deno.test("tampered state, wrong key, and 10 minutes expiry are refused", async () => {
  const s = await signState("k", "user-1", 1000);
  await assertRejects(() => verifyState("k", s.replace("user", "x"), 1000), StateError);
  await assertRejects(() => verifyState("other", s, 1000), StateError);
  await assertRejects(() => verifyState("k", s, 1000 + 601_000), StateError);
});
Deno.test("pkce is stable per nonce and S256", async () => {
  const a = await pkceFrom("k", "n");
  assertEquals(a, await pkceFrom("k", "n"));
  assertEquals(a.challenge, await s256(a.verifier));
});
Deno.test("authorize URL uses the tenant authority, never common", () => {
  const u = new URL(authorizeUrl({ tenantId: "T", clientId: "C", redirectUri: "https://r" }, "st", "ch", PHASE2_SCOPES));
  assertEquals(u.pathname, "/T/oauth2/v2.0/authorize");
  assertEquals(u.searchParams.get("code_challenge_method"), "S256");
});
Deno.test("linkStatus compares without case or spaces", () => {
  assertEquals(linkStatus(" A@X.ae", "a@x.ae"), "active");
  assertEquals(linkStatus("a@x.ae", "b@x.ae"), "review");
  assertEquals(linkStatus("a@x.ae", null), "review");
});
```

- [ ] **Step 2: Run the Deno tests.** Expected: FAIL.
- [ ] **Step 3: Implement with WebCrypto:** HMAC-SHA-256, constant-time compare with `crypto.subtle.verify`, base64url. `readIdToken` decodes without a signature check, because the token comes directly from Microsoft's token endpoint over TLS; it takes `preferred_username` as the email.
- [ ] **Step 4: Run the Deno tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Microsoft sign-in logic`.

### Task 8: Graph client

**Files:**
- Create: `Messenger Module/supabase/ms365/graph.ts`, `graph.test.ts`

**Interfaces:**
- Produces: `createGraph(deps: { tokenUrl: string; clientId: string; clientSecret: string; loadToken(): Promise<string|null>; saveToken(t: string): Promise<void>; onRevoked(): Promise<void>; log(e: { action: string; status: string; error_code?: string }): Promise<void>; fetch: typeof fetch; sleep(ms: number): Promise<void> })` returning `{ request(method: string, path: string, body?: unknown): Promise<any> }`; `class NotConnectedError`, `class GraphError { status; code }`.

- [ ] **Step 1: Write the failing tests** with a fake `fetch`:
  - The first call refreshes once; the second call reuses the access token.
  - A rotated refresh token goes to `saveToken`.
  - No stored token throws `NotConnectedError`, with no network call.
  - `invalid_grant` calls `onRevoked` and throws `NotConnectedError`.
  - A 429 with `Retry-After: 2` sleeps 2000 ms, retries once, and returns the result; a second 429 throws `GraphError` with status 429.
  - `Retry-After: 999` sleeps at most 10000 ms.
  - A 401 refreshes once and retries once.
  - `JSON.stringify` of every `log` call contains neither the access token, refresh token, nor client secret.
- [ ] **Step 2: Run the Deno tests.** Expected: FAIL.
- [ ] **Step 3: Implement.** Only paths starting with `/` go to `https://graph.microsoft.com/v1.0`. Full URLs are refused, so a token can never go to another host.
- [ ] **Step 4: Run the Deno tests.** Expected: PASS.
- [ ] **Step 5: Commit** `Add Graph client`.

### Task 9: Edge Function actions

**Files:**
- Create: `Messenger Module/supabase/ms365/handlers.ts`, `handlers.test.ts`, `index.ts`, `secrets.ts` (copy of `Integrations Module/supabase/_shared/secrets.ts`), `.env.example`
- Modify: `Integrations Module/registry.json` (`microsoft` entry)

**Interfaces:**
- Consumes: Tasks 6, 7, 8.
- Produces: `handle(action: string, body: unknown, deps): Promise<unknown>`, `callback(params: URLSearchParams, deps): Promise<{ redirect: string }>`, `class UserError`. Actions: `connection_status`, `connect_start`, `disconnect`, `admin_test`, `user_links_review`.

Route in `index.ts`: GET with a `state` or `error` query goes to `callback`, without a JWT. POST follows `Integrations Module/supabase/zoho-books/index.ts`: CORS, JWT, then `handle`. Deploy needs `--no-verify-jwt`, recorded in the file header.

The return address comes only from setting `MESSENGER_APP_URL`, never from the request. It adds `?view=messenger&ms=connected`, `ms=review`, or `ms=error&reason=<code>`.

- [ ] **Step 1: Write the failing tests** with fake deps:
  - `connect_start` returns a URL for the caller's own profile and ignores any `profile_id` in the body.
  - `connect_start` by a member refuses with "An admin must connect Microsoft first" while the connection is not active.
  - The first admin connect sets `microsoft_connection` to active with `tid`, and a later member callback with another `tid` redirects `reason=wrong_tenant` and stores nothing.
  - An email mismatch stores the token, sets the link to `review`, and redirects `ms=review`.
  - Bad or expired state redirects `reason=expired`, makes no token exchange, and leaves the stored token unchanged.
  - A reused code (token endpoint `invalid_grant`) redirects `reason=code_used` and leaves the stored token unchanged.
  - Microsoft's `error=access_denied` redirects `reason=denied`.
  - A second person signing in with a Microsoft account already linked elsewhere redirects `reason=already_linked`.
  - `disconnect` deletes the token, sets `revoked`, logs. A failure in Vault shows an error and keeps status unchanged.
  - `admin_test` and `user_links_review` refuse a member.
  - `user_links_review` accepting a row sets `active`, and it is written to the log with the admin as actor.
  - `connection_status` output contains no field named like `token` or `secret`.
- [ ] **Step 2: Run the Deno tests.** Expected: FAIL.
- [ ] **Step 3: Implement `handlers.ts`, then `index.ts`.** `MissingSecretError` messages pass to the browser; other errors become a general message with detail in the log only.
- [ ] **Step 4: Update `registry.json`:** status `in_progress`, usedBy `Messenger Module`, secrets add `MICROSOFT_STATE_SECRET` and `MESSENGER_APP_URL`, and keep `ONEDRIVE_DRIVE_ID`. Write `.env.example` with names only.
- [ ] **Step 5: Run Deno tests, node tests and the `Integrations Module` tests.** Expected: PASS.
- [ ] **Step 6: Commit** `Add ms365 sign-in function`.

### Task 10: Connection screens and documents

**Files:**
- Create: `Messenger Module/components/Settings.jsx`, `components/SyncLogs.jsx`, `docs/entra-setup.md`, `docs/api.md`, `docs/deployment.md`, `docs/testing-report.md`
- Modify: `Messenger Module/components/MessengerModule.jsx`, `components/Overview.jsx`, `services/messengerApi.js`, `Main Module/src/App.jsx` (keep `ms` and `reason` for the module), `tests/browser-check.md`, `README.md`
- Test: `Messenger Module/tests/static.test.mjs`, `Messenger Module/tests/connectionText.test.mjs`
- Create: `Messenger Module/logic/connectionText.js`

**Interfaces:**
- Consumes: `ms365` actions from Task 9.
- Produces: `connectionMessage(ms: string|null, reason: string|null): { tone: "ok"|"warn"|"error", text: string }|null`.

- [ ] **Step 1: Write the failing tests:** `connectionMessage` returns a plain sentence for `connected`, `review`, and each of `wrong_tenant`, `expired`, `code_used`, `denied`, `already_linked`; an unknown reason gets a general sentence; none returns null. Static test: `Settings.jsx` and `SyncLogs.jsx` are lazy or inside the lazy module, and browser code still holds no token words.
- [ ] **Step 2: Run the node tests.** Expected: FAIL.
- [ ] **Step 3: Implement the screens.** Every staff member sees their own Connect, Reconnect, or Disconnect. Admins also see connection status, connected account, people list with review accept, and a Test connection button. Logs tab is admin-only: filter by action and status, 100 newest. Client secret expiry date is saved in Settings, with a warning shown from 30 days ahead.
- [ ] **Step 4: Write the documents.** `entra-setup.md`: step-by-step single-tenant app registration, redirect URI, secret, scopes per phase from the spec section 8, each scope name checked against Microsoft's permissions reference while writing. `api.md`: Task 9 actions. `deployment.md`: migration order, `--no-verify-jwt` deploy, settings, rollback, and the check of the database size limit before the first migration. `testing-report.md`: results so far, with live tests marked not run.
- [ ] **Step 5: Extend `tests/browser-check.md`** for Phase 2: admin connects, member connects, wrong tenant, email mismatch review, back button on return, disconnect, revoke in Entra then see Reconnect, confirm no token in browser storage or network responses.
- [ ] **Step 6: Run all four test commands.** Expected: all pass, build succeeds.
- [ ] **Step 7: Commit** `Add Microsoft connection screens and guides`.

## After the tasks

Stop and report. These are separate user approvals, in this order: push and merge, each migration on the live database, deploying `ms365`, Entra setup by the tenant admin, then running `tests/browser-check.md` on the tenant. The task record panel waits for `optimize-core`.
