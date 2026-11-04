# Messenger Module: Microsoft Teams integration design

Date: 2026-11-04. Status: awaiting user review. Branch: `messenger-module`.

## 1. Purpose

Staff work on clients, leads and tasks in the CRM, and talk and meet in Microsoft Teams. This module joins the two: open a Teams chat from a record, schedule a Teams meeting linked to a record, link channels to clients, and send CRM alerts to Teams. The CRM stays the source of truth. Teams stays the communication platform.

The module is available in two ways with the same code and login: a CRM tab, and an installable desktop app.

Done means each phase below works against the real AB Capital tenant, not only in tests.

## 2. Decisions

| Decision | Choice | Reason |
|---|---|---|
| Cost rule | Free, else in-house | User's rule. All staff already hold Microsoft 365 with Teams |
| Chat | Opens in Teams; not typed or read in the CRM | Avoids duplicating Teams. Database is 972 MB on a 500 MB plan |
| In-house chat | Not built | Same reason |
| Departments | Names from `hr_employees.department` and `service_departments`; no new master | Other modules stay untouched |
| Task statuses | Existing `tasks` statuses are unchanged; records are linked only | Tasks and Hot Alerts stay untouched |
| Desktop app | Installable web app (PWA) | Free, updates with each release, one codebase |
| Other Microsoft services | Shared layer now; Outlook, OneDrive, SharePoint added later | Calendar is used only for meetings. OneDrive is parked |

Not in scope: reading Teams messages, syncing private chats, a separate Team per client, client access to Teams, offline use, packaged `.exe`.

## 3. Microsoft facts this design relies on

Read on Microsoft's documentation on 2026-11-04.

- Teams Graph APIs stopped being metered on 25 Aug 2025.
- `POST /channels/{id}/messages` with application permission is "only supported for migration".
- Activity feed notifications require the Teams app to be installed for the recipient, with the Entra app ID in `webApplicationInfo`.
- `POST /onlineMeetings` meetings do not show on the calendar. Microsoft directs callers wanting transcripts to the calendar-backed Create event API.
- Teams deep links open a draft chat with the given people, topic and text.
- A team holds 1,000 channels, counting channels deleted in the last 30 days.
- Workflows webhook templates need no premium licence. Posting as a flow bot in private channels is "under development".
- Transcripts need `OnlineMeetingTranscript.Read.All` and an application access policy.

To confirm on the tenant: the private channel limit (reports conflict between 30 and 1,000), transcription licence requirements, Teams custom app upload, and each permission name in section 8.

## 4. Architecture

```
CRM tab / installed app (React, GitHub Pages)
  Messenger Module screens; TeamsPanel on client, lead, task records
        | Supabase session JWT
Edge Function ms365: the only Graph caller; checks the caller on every action
        |                              |
Microsoft Graph, Entra ID          Postgres (references only), Vault (tokens, secrets)
        ^                              |
        |                 notifications insert -> rules -> outbox
        +----- pg_cron job ms365-outbox -> ms365 notify
```

### Files

```
Messenger Module/
  index.js                     default export: MessengerModule
  components/                  MessengerModule, Overview, Chats, Meetings, MeetingEditor,
                               MeetingNotes, Channels, Notifications, Settings, SyncLogs, TeamsPanel
  logic/                       deepLink.js, meetings.js, rules.js (pure and tested)
  services/messengerApi.js     all Supabase and Edge Function calls
  supabase/ms365/              index.ts, auth.ts, graph.ts, teams.ts, meet.ts, notify.ts, secrets.ts
  teams-app/                   manifest.json and icons for the Teams app
  tests/                       node tests, browser-check.md
  docs/                        this spec, plans, Entra guide, API, deployment, testing, AI notes
Database Module/Messanger Base/
  migrations/                  001 to 005, rollback/ for each
  tests/                       SQL tests with stubs, as other Bases do
```

"Messanger Base" is the spelling of the folder the user created.

### Small edits to shared files

- `Main Module/vite.config.js`: one `@messenger` alias.
- `Main Module/src/App.jsx`: one lazy import, one view line, and reading `?view=` for the installed app's start page. The value still goes through `resolveView`, so it grants no extra access.
- `Main Module/src/tabs.js`: `{ key: "messenger", label: "Messenger" }`. Members see it once an admin grants it, like other tabs.
- `Main Module/src/components/Sidebar.jsx`: one entry.
- `Integrations Module/registry.json`: extend the `microsoft` entry.

Another session is changing `App.jsx`, `vite.config.js`, `Tasks.jsx` and `Sidebar.jsx` on `optimize-core`, so a merge is expected. The task record panel is added after that branch lands, or by a one-line edit if it has not.

## 5. Phases

Each phase is shippable alone and needs its own live approval. Phases 1 and 2 are planned first; later phases get their plan once the earlier ones have been tested on the tenant.

### Phase 1: chat links and desktop install. No Entra app needed.

- `logic/deepLink.js` builds `https://teams.microsoft.com/l/chat/0/0?users=...&topicName=...&message=...` with encoded values.
- Staff list comes from `profiles`, as `hr_employees` is admin-only. A person with no email cannot be chosen, and the screen says why.
- `TeamsPanel` on client and lead records: pick people, optional group topic, message prefilled with the reference, Open in Teams. A saved reference goes in `crm_communication_links`.
- A prefilled link carries only the client ID and legal name, lead number, or task title. KYC data is never included, because the link is a URL.
- Install: `manifest.webmanifest` scoped to `/ABCRM/`, icons from `Branding`, start page `?view=messenger`, and a small service worker that caches no data, tokens or API responses.

### Phase 2: Microsoft connection

- Single-tenant Entra app, set up by the tenant admin from the guide. Tenant ID, client ID and secret are entered in Settings > Integrations and stored in Vault.
- Sign-in: `connect_start` returns the Microsoft URL; `connect_callback` exchanges the code. PKCE is used. State holds profile ID, expiry (10 minutes) and a nonce, signed by HMAC with `MICROSOFT_STATE_SECRET`. The verifier is derived from the nonce, so no state table is needed.
- Refresh token is stored in Vault as `ms_rt:<profile_id>` through service-role-only functions, replaced at each rotation, deleted on disconnect or a revoked-token error.
- The sign-in must come from the connected tenant. If the Microsoft email differs from `profiles.email`, the link stays `review` until an admin accepts it.
- Settings screen: connection status, connected account, per-person status, reconnect, disconnect. Logs screen reads `microsoft_sync_log`.
- `graph.ts` handles refresh, 429 `Retry-After`, and logs failures without tokens or message bodies.

### Phase 3: meetings

- Create by `POST /me/events` with `isOnlineMeeting: true` and `onlineMeetingProvider: "teamsForBusiness"`, as the signed-in organizer. Reschedule by PATCH, and cancel by the event cancel call.
- Fields: subject, category, time, internal and external participants, client, lead, task. External participants are allowed only when the caller is an admin or a manager under the module rule set in Settings.
- Categories are a fixed list in `logic/meetings.js`: Client, Sales, Internal, Accounting Discussion, Tax Consultation, Audit, Banking Discussion, Management.
- Upcoming meetings are shown on the Messenger tab, the Calendar panel, and the record's TeamsPanel.
- Notes form: summary, discussion points, decisions, follow-ups, next date. "Create task" inserts into the existing `tasks` table with a chosen list, then links it, so there is one task record only.
- If Graph fails, nothing is saved as scheduled. If Graph succeeds and the save fails, the event is cancelled and the error is shown.

### Phase 4: channels and departments

- Lists teams and channels the signed-in admin can see. Admin links a channel to a client or a department name.
- Create on request: one standard channel per client in a chosen department team. Unique rows prevent duplicates, and the screen warns when a team nears 1,000 channels.
- Client records show the links as buttons. Channel access itself stays managed in Teams.

### Phase 5: notifications

- Trigger after insert on `notifications` matches active rules by `type` and adds outbox rows. Errors are caught and logged, so a failure never blocks the original notification.
- A daily job adds deadline reminders from sources that hold real dates, confirmed during the phase plan. Events with no data source today (Audit, Compliance, Ejari, labour card) are listed as unavailable, not simulated.
- Own pg_cron job `ms365-outbox`, every minute, calls the function only when rows are pending, with `MS365_JOB_SECRET`. The `admin_triggers` catalogue is left alone.
- Delivery: personal by activity feed (`TeamsActivity.Send.User`), desktop by web push (`messenger_push_subscriptions`, VAPID keys in Vault), channel by Workflows webhook whose URL is kept in Vault.
- `dedupe_key` is unique: `notif:<id>:<delivery>` and `deadline:<source>:<id>:<days>`. Failed rows retry 3 times with backoff, then show on the Logs screen.
- Admins edit rules, recipients, frequency and priority. An urgent rule goes to all its deliveries at once; others respect the frequency.
- Teams notifications only reflect CRM changes. Nothing in Teams changes a task.

### Phase 6: optional AI

Needs a separate user decision on LLM cost and legal consent to transcription. Transcripts are read only for meetings the module created, and the AI output is a draft in `microsoft_meeting_notes`. Sending, record changes and task assignment require a person's approval. Agent design notes are written as a document only until then.

## 6. Database

Row security on all tables, with policies using `(select auth.uid())`. Rollback beside each migration. Foreign keys to `client_master` are text. No file or message content is stored.

| Migration | Table | Holds |
|---|---|---|
| 001 | `crm_communication_links` | `record_type` (client, lead, task), `record_id` text, `link_type` (chat, meeting, channel), `reference`, `label`, `created_by` |
| 002 | `microsoft_connection` | One row: tenant ID, status, connected by, consent date |
| 002 | `microsoft_user_links` | `profile_id` unique, Microsoft user ID, UPN, scopes, status (`active`, `review`, `revoked`), app-installed flag |
| 002 | `microsoft_sync_log` | Action, status, error code, actor, also admin and permission changes |
| 003 | `microsoft_meetings` | Graph event ID unique, join URL, subject, category, start, end, organizer, participants jsonb, status, `client_id`, `lead_id`, `task_id` |
| 003 | `microsoft_meeting_notes` | `meeting_id`, summary, points, decisions, follow-ups, next date, author, source (`manual`, `ai_draft`) |
| 004 | `microsoft_channel_links` | Team ID, channel ID, web URL, `client_id` or department name, label, type. Unique on team and channel, and on client and label |
| 005 | `microsoft_notification_rules` | Event type, audience, delivery, priority, frequency, active |
| 005 | `microsoft_notification_outbox` | Rule, recipient or channel, payload, `dedupe_key` unique, status, attempts, error, sent at |
| 005 | `messenger_push_subscriptions` | `profile_id`, endpoint unique, keys |

Access:

| Data | Who |
|---|---|
| Links, channel links, meetings tied to a record | Policy checks `exists` on the parent row, so `client_master` (`banking_can('kyc.view')`), `bd_leads` (`bd_can_view_lead`) and `tasks` rules apply unchanged |
| Meetings | Also organizer, participants, admins |
| Meeting notes | Same as the meeting |
| User link, push subscription | Own row, admins |
| Connection, rules, outbox, sync log | Admins, using `admin_is()` |
| Vault token functions | Service role only |

Sync log and sent outbox rows are removed after 90 days by a cron job.

## 7. Edge Function `ms365` actions

| Action | Caller | Phase |
|---|---|---|
| `connection_status`, `connect_start`, `disconnect` | Signed-in staff | 2 |
| `connect_callback` | Microsoft redirect; verified by signed state | 2 |
| `admin_test`, `user_links_review` | Admin | 2 |
| `meeting_create`, `meeting_update`, `meeting_cancel` | Staff with the `messenger` tab; organizer or admin to change | 3 |
| `teams_list`, `channels_list`, `channel_link`, `channel_create` | Admin | 4 |
| `outbox_run` | Job secret | 5 |
| `push_subscribe` | Signed-in staff | 5 |

The function is deployed with JWT verification off so the callback can reach it. Every other action verifies the JWT itself, and role checks run in the function, not the browser. Responses never include tokens or secrets.

## 8. Entra permissions

| Permission | Type | Phase |
|---|---|---|
| `openid`, `profile`, `offline_access`, `User.Read` | Delegated | 2 |
| `Calendars.ReadWrite` | Delegated | 3 |
| `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `Channel.Create` | Delegated | 4 |
| `TeamsActivity.Send.User` | Application | 5 |
| `OnlineMeetingTranscript.Read.All`, with application access policy | Application | 6, if approved |

Scopes are requested per phase, so consent stays as narrow as possible. Message-reading scopes are never requested.

## 9. Security

- Tokens and secrets stay in Vault and Edge Functions; never in the browser, browser storage, logs or the service worker.
- Client secret expiry is recorded in Settings, which warns 30 days ahead.
- Workflows webhook URLs act as secrets and live in Vault. Channel posts carry a reference and a short title, not KYC or financial detail.
- Personal notifications carry a title and a reference only.
- UAE data-protection review of Microsoft data location and transcripts is a business and legal check, not something this build can establish. It is noted for the user before Phase 6.

## 10. Errors

- A person with no link gets a Connect prompt; other features keep working.
- Revoked or expired consent sets the status to `revoked`, removes the token, and asks to reconnect.
- If Microsoft is down, CRM screens still load from stored references, and the action shows a clear failure. Outbox rows wait and retry.
- A missing setting names what to add, using `MissingSecretError`.

## 11. Testing

- Node tests in `Messenger Module/tests/`: deep link encoding, rule matching, dedupe keys, meeting validation, and a static check that browser code holds no token words and uses no message-reading scope.
- Deno tests for `auth.ts` (state tamper, expiry, wrong tenant), `graph.ts` (refresh, 429), `notify.ts`, as `zoho-books` does.
- SQL tests in `Database Module/Messanger Base/tests/` proving row security: a person without client access sees no links or meetings for that client, and members cannot read tokens, rules or logs.
- `npm run build` passes in `Main Module`, and the module loads lazily.
- `tests/browser-check.md`: live tenant checklist per phase, including install on Windows. A feature is reported as working only after this passes, and the testing report states what was and was not tested.

## 12. Live steps needing approval, each one

Merging to `main`, running each migration, deploying `ms365`, enabling each cron job, and uploading the Teams app. Entra setup and consent are done by the tenant admin.

The live database is above its 500 MB plan limit. Migrations add small tables only, but the limit's effect on writes should be checked before the first migration.

## 13. Brief deliverables

| Deliverable | Where | When |
|---|---|---|
| Architecture, schema, workflows, security | This spec | Now |
| Entra setup guide, Graph permission list | `docs/entra-setup.md` | Phase 2 |
| Backend API | `docs/api.md` | Phases 2 to 5 |
| Frontend UI | `components/` | Phases 1 to 5 |
| Notification configuration | `docs/notifications.md` | Phase 5 |
| Testing report | `docs/testing-report.md` | Each phase |
| Deployment guide, environment examples | `docs/deployment.md`, `supabase/ms365/.env.example` | Phase 2 |
| AI-agent notes | `docs/ai-agents.md` | Phase 6 decision |
