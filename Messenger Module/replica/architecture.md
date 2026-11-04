# Architecture: AB Capital Messenger

Written 2026-11-04. Draft for approval. Nothing here has been built or run. Reads with `recon.md` and `features.csv`.

## Stack

Keep the CRM's stack. One database, no new web framework.

| Layer | Choice | Why |
|---|---|---|
| Web app | React 19 and Vite, in `Messenger Module`, mounted by `Main Module` | Already in use |
| Database and auth | Existing Supabase project and logins | Same people, same row security |
| Realtime | Supabase Realtime, as chat uses now; Broadcast and Presence for typing and status | Already in use |
| Rich text | TipTap | Already a dependency |
| Files and recordings | Cloudflare R2 through short-lived signed links | The database is above its free limit; the CRM already deploys to Cloudflare |
| Calls and meetings | LiveKit, open source (recommended; see below) | Rooms, screen share, recording and React SDK are ready-made |
| Desktop | Tauri 2 on WebView2, in `Messenger Module/desktop` | Small installer, free, native tray and notifications |
| Server logic | Supabase Edge Functions | Pattern already used by `ms365` |

## Decision needed: call server

| Option | Cost | Trade-off |
|---|---|---|
| LiveKit on a small VPS (recommended for production) | The server itself; price to confirm against the chosen host | Fixed cost and our own data. We run and patch it |
| LiveKit Cloud free plan (recommended to start) | Free, reportedly 5,000 minutes a month | No server to run. One 10-person hour uses 600 participant-minutes, so about 8 such meetings. Limits come from third-party listings; confirm on livekit.io/pricing |
| Cloudflare Realtime | First 1,000 GB a month free, then $0.05 per GB (official docs) | Cheapest, but low level: rooms, recording and call logic would all be ours, adding weeks |

Plan: start on LiveKit Cloud's free plan, move to a VPS if usage passes the limit. The same SDK works on both, so only a URL and keys change.

## Schema

Draft in `schema.sql`. It extends the three live `messenger_` tables and adds new ones. Rules: row security on every table, no admin read exception (as today), and writes that need checks go through functions.

Existing chat prunes messages older than 365 days, once its schedule is approved. Channels and meeting chats will need the user's decision on keeping that limit.

## API

| Method | Name | Does | Who | Phase |
|---|---|---|---|---|
| RPC | `messenger_edit_message`, `messenger_delete_message` | Edit or soft delete own message | Sender | 1 |
| RPC | `messenger_toggle_reaction` | Add or remove a reaction | Conversation member | 1 |
| RPC | `messenger_search` | Full-text search limited to the person's conversations | Staff | 1 |
| RPC | `messenger_activity`, `messenger_activity_read` | Read feed, mark read | Owner | 1 |
| Edge | `messenger-files` | Check membership, return signed upload or download link | Member | 1 |
| RPC | `messenger_create_team`, `messenger_add_team_members`, `messenger_create_channel` | Manage teams and channels | Team owner | 2 |
| Edge | `messenger-calls` `/token` | Check rights, mint a short-lived LiveKit token | Participant | 4 |
| Edge | `messenger-calls` `/webhook` | Record call and room events; verify signature; safe if delivered twice | LiveKit | 4 |
| RPC | `messenger_start_call`, `messenger_answer_call` | Ring, accept, decline | Member | 4 |
| RPC | `messenger_schedule_meeting`, `messenger_update_meeting`, `messenger_respond_meeting` | Calendar | Organizer, invitee | 5 |
| Edge | `messenger-calls` `/lobby`, `/record` | Admit people, start and stop recording | Organizer, co-organizer | 5, 6 |

Jobs: expire presence, mark unanswered calls missed, send meeting reminders, delete expired recordings. Each schedule needs the user's approval before it goes live.

Only official public APIs with our own keys. No Teams endpoints.

## The parts that bite

- **Time zones:** store UTC plus the organizer's zone; expand repeats in that zone, so meetings hold across a foreign daylight saving change. The default view stays `Asia/Dubai`.
- **Duplicate sends:** the browser supplies the message ID, as now. Webhook handling must also tolerate repeats.
- **Race conditions:** two people answering a call, or a direct call both ways at once; settle in a database function.
- **Security:** this repository is public, so no keys in code. LiveKit tokens only from the Edge Function, for one room, short-lived. Signed file links expire quickly. Filter message HTML with DOMPurify. Do not open guest join until reviewed.
- **Desktop security:** the Tauri app gets the smallest permission set, and only our bundled pages can call native features.
- **Recording consent:** tell everyone when recording starts, and show it throughout. Staff policy for recordings and UAE privacy rules should be checked with a qualified adviser before phase 6.
- **File limits:** decide maximum size and blocked types in phase 1.
- **Realtime load:** subscribe per conversation rather than to all messages as the dock does now, before channels add traffic.
- **Installer trust:** without a paid code-signing certificate, Windows SmartScreen warns staff at install.
- **Local tools:** Rust is not installed on this PC; it is needed to build the desktop app.

## Build order

Each phase ships alone. Each live step (migration, function, deployment) needs the user's approval, then `npm run deploy:cloudflare` with the release to `main`.

| Phase | Delivers | Screens | Tables | Rough size |
|---|---|---|---|---|
| 0 | Full-page shell, tokens, AB Capital branding, dock kept | S01, S23 | none | Days |
| 1 | Chat parity: edit, delete, reply, reactions, mentions, files, search, activity, presence | S02 to S05, S19, S20 | reactions, mentions, attachments, activity, presence | 2 to 3 weeks |
| 2 | Teams, channels, threads | S06 to S09 | teams, team_members, channels | 1 to 2 weeks |
| 3 | Windows app: installer, tray, notifications, links, updates | S21, S22 | none | 1 week |
| 4 | Calls: one-to-one and group, ring, history, screen share | S12, S14 to S16 | calls, call_participants | 2 to 4 weeks |
| 5 | Calendar and meetings: schedule, repeat, roles, lobby, Meet now, meeting chat | S10, S11, S13 | meetings, meeting_participants | 3 to 4 weeks |
| 6 | Recording, transcript, recap, breakout rooms | S17, S18 | recordings | 3 to 4 weeks |

Sizes are estimates, and calling depends on real office-network tests that cannot be done from a developer machine alone.

## Open questions for the user

1. How many staff, and how many are in a call at once? This sets the call server size.
2. Should all chat stay private to members with no admin access, as now? Some firms need compliance access.
3. Do guests outside the company need to join meetings?
4. Does the 365-day message limit also apply to channels?
