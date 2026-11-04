# Recon map: Microsoft Teams, for AB Capital Messenger

Written 2026-11-04. Status: first pass from public sources. Clean-room rules apply.

## Scope

| Question | Answer |
|---|---|
| App and platform | Microsoft Teams desktop app on Windows, plus the web CRM |
| Slice | Chat, teams and channels, calls, meetings, calendar (user's choice, 2026-11-04) |
| For whom | AB Capital staff only, not a product for sale |
| Name | AB Capital Messenger, using the company's own branding |
| Delivery | Full page in the CRM, the existing docked panel kept, and a native Windows app (Tauri) |

## What was and was not read

Read on this PC: the Teams package file list and `AppxManifest.xml` (display name, declared capabilities). Nothing more.

Not read, on purpose: `ms-teams.exe`, the DLLs, web bundles, images, audio and locale files. Microsoft's Services Agreement and Product Terms bar reverse engineering, and the replica rules forbid it. Nothing in this project may be copied from the install folder.

Gap: no reference screenshots yet. `replica/screens/` is empty. Screens below come from public help pages, so layout details and states are lower confidence until the user captures their own Teams screens. Those screenshots must never ship, and this repository is public, so they must not be committed.

Open check: the terms were seen as search extracts, not read in full. This is not legal advice.

## Sources

| Source | Gives |
|---|---|
| https://support.microsoft.com/en-US/teams/meetings-events/first-things-to-know-about-meetings-in-microsoft-teams | Ways to join and schedule, Meet now, recaps |
| https://support.microsoft.com/en-us/teams/meetings/chat-in-microsoft-teams-meetings | Meeting chat before, during and after |
| https://support.microsoft.com/en-us/teams/meetings/see-all-your-meetings-in-microsoft-teams | Meetings list |
| https://support.microsoft.com/en-us/office/first-things-to-know-about-teams-in-microsoft-teams-5e4fd702-85f5-48d7-ae14-98821a1f90d3 | Teams |
| https://support.microsoft.com/en-us/office/first-things-to-know-about-channels-in-microsoft-teams-8e7b8f6f-0f0d-41c2-9883-3dc0bd5d4cda | Standard, private and shared channels |
| https://learn.microsoft.com/en-us/microsoftteams/teams-channels-overview | Teams and channels model |
| https://support.microsoft.com/en-us/teams/meetings/roles-in-microsoft-teams-meetings | Organizer, co-organizer, presenter, attendee |
| https://support.microsoft.com/en-us/teams/meetings/start-stop-and-find-meeting-recordings-in-microsoft-teams | Recording rules |
| https://support.microsoft.com/en-us/teams/meetings/start-stop-and-download-live-transcripts-in-microsoft-teams-meetings | Live transcript |
| https://support.microsoft.com/en-us/teams/personal/get-started/getting-to-know-microsoft-teams-personal | Activity feed (personal version) |
| https://learn.microsoft.com/en-us/answers/questions/5527984/how-to-create-a-break-out-room-while-using-microso | Breakout rooms (community answer, low confidence) |
| `AppxManifest.xml` on this PC | Native needs: microphone, webcam, screen capture, tray start, protocol links, toast notifications, share target |

## Screens

| ID | Screen | Reached by | Purpose | Key components | States to build |
|---|---|---|---|---|---|
| S01 | App shell | Open app | Left app bar, top search, profile and status | App bar, search box, status menu | Loading, offline, signed out |
| S02 | Activity | App bar | Mentions, replies, reactions, missed calls | Feed row, filter | Empty, unread, error |
| S03 | Chat list | App bar | Recent direct and group chats | Chat row, unread badge, pin, mute | Empty, unread, long names |
| S04 | Conversation | Pick a chat | Read and send | Message, reply, reactions, composer, typing line | Empty, sending, failed, long text, deleted message |
| S05 | Chat details | Chat header | Members, files, rename, leave | Member list, tabs | Owner, member, no permission |
| S06 | Teams and channels list | App bar | Browse teams and their channels | Tree, team menu | Empty, no teams, hidden channel |
| S07 | Channel | Pick a channel | Threaded posts, Files tab | Post card, thread, tabs | Empty, private, read-only |
| S08 | Thread pane | Open replies | Follow one post's replies | Reply list, composer | Empty, long |
| S09 | Manage team | Team menu | Members, roles, channels | Tables, role picker | Owner, member |
| S10 | Calendar | App bar | Day, week, work week views | Grid, event card, Meet now | Empty, overlap, other time zone |
| S11 | Schedule meeting | Calendar | Create or edit a meeting | Form, people picker, repeat rule | Conflict, validation |
| S12 | Pre-join | Open a meeting | Check camera and mic before joining | Preview, device pickers | Permission denied, no device |
| S13 | Lobby | Join when held | Wait for admission | Waiting view; admit list for hosts | Waiting, denied, timed out |
| S14 | Meeting stage | Join | Video grid, share, controls | Tiles, control bar, people pane, chat pane | One person, many people, sharing, poor network, reconnecting |
| S15 | Incoming call | Someone calls | Accept or decline | Call toast, ring | Missed, busy |
| S16 | Call history | Calls in app bar | Recent calls, redial | Call row | Empty, missed |
| S17 | Breakout rooms | Meeting control | Split into rooms | Room list, assign | Open, closed |
| S18 | Recap | After a meeting | Recording, transcript, chat | Player, transcript list | Processing, no recording, no access |
| S19 | Files | App bar or tab | Files shared in chats and channels | File list, preview | Empty, uploading, too large |
| S20 | Search results | Top search | Messages, people, files | Result tabs | No results |
| S21 | Settings | Profile menu | Devices, notifications, theme | Forms | Permission denied |
| S22 | Desktop tray and notifications | Native app | Run closed, alerts, unread count | Tray menu, Windows notification | Quiet hours, signed out |
| S23 | Docked panel | Any CRM page | Quick chat beside work (already live) | `MessengerDock`, `ChatRail` | Existing |

## Flows

```
F01 Send a chat message
    S03 -> S04 -> sent. Happy path: 2 clicks plus typing.
    edge: offline, send retried, member removed while typing
F02 Post in a channel and reply
    S06 -> S07 -> post -> S08 -> reply. edge: private channel, @channel mention
F03 Mention someone and they see it
    S04 or S07 -> S02 -> jumps to the message. edge: muted chat, person not a member
F04 Share a file
    S04 -> upload -> preview -> S19. edge: too large, upload stopped, blocked type
F05 One-to-one call
    S04 -> call -> S15 on the other side -> S14 -> end -> S16.
    edge: no answer, busy, browser closed, mic denied
F06 Meet now from a chat or channel
    S04 or S07 -> S12 -> S14.
F07 Schedule and join a meeting
    S10 -> S11 -> invite -> S12 -> S13 -> S14 -> S18.
    edge: daylight saving of a foreign invitee, repeat series edited, guest with no login
F08 Share the screen
    S14 -> pick window -> everyone sees it. edge: permission denied, presenter leaves
F09 Record and review
    S14 -> record (everyone told) -> S18. edge: recorder leaves, processing fails
F10 Run breakout rooms
    S14 -> S17 -> rooms -> close -> back to S14.
F11 Install and use desktop app
    Install -> sign in -> S01 -> close to tray -> S22 notification -> reopen on the chat.
```

## Components

App bar, list row with badge, message bubble, post card, reaction bar, composer (rich text, mention, attach), people picker, presence dot, avatar, tabs, tree, modal, toast, menu, calendar grid, event card, video tile, control bar, device picker, side pane, skeleton, empty state.

The CRM already has TipTap for rich text, `@calendar` for the small month view, and the chat components in `Messenger Module/components`. Reuse them first.

## Inferred data model

| Entity | Fields | Evidence | Confidence |
|---|---|---|---|
| Team | name, description, owner | Help: teams | High |
| TeamMember | team, person, role owner or member | Help: teams | High |
| Channel | team, name, type standard or private | Help: channels | High |
| Conversation | direct, group, channel or meeting | Existing CRM table, meeting chat help | High |
| Message | body, sender, parent for threads, edited, deleted | Help, and common behaviour | High |
| Reaction, Mention, Attachment | message, person, type, file | Common behaviour | High |
| Meeting | title, start, end, time zone, repeat rule, organizer, lobby rule, recording rule | Help: meetings and roles | Medium |
| MeetingParticipant | person or guest, role, response | Help: roles | High |
| Call | kind, started, ended, status, people | Help: calls (guess on fields) | Medium |
| Recording, Transcript | meeting, file, expiry | Help: recording, transcript | Medium |
| Presence | person, status, until | Common behaviour | Medium |

## What cannot or will not be cloned

| Item | Reason |
|---|---|
| Teams name, logo, icons, sounds, wording | Microsoft's property |
| Compatibility with real Teams calls and chats | Would be a different service; the existing Teams deep link stays for that |
| Phone network calling | Needs a licensed carrier |
| Copilot and AI recap | Licensed; could be built separately later |
| Shared channels with outside organisations, large webinars and town halls | Not needed for one company |
| Teams app store and live Office co-editing | Very large, and not part of the core loop |

## Size and hard parts

23 screens, 11 flows, 13 new tables. Size: **XL**, which the method says to rescope. It is therefore split into six phases that each ship alone (see `architecture.md`). Expect months of work, not one session.

Hardest parts:
1. Calls and meetings reliability: office networks, NAT, reconnects, device quirks, and server cost.
2. Incoming calls when the app is closed: only the tray app can ring; a closed browser tab cannot without extra push work.
3. Database growth: the Supabase database is already above the free plan limit, and chat and channels add volume. Files and recordings must live outside it.
