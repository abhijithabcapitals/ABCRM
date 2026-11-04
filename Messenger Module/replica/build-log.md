# Build log

| Screen | Date | Status | Missing | Harder than expected |
|---|---|---|---|---|
| S01 App shell | 2026-11-04 | Partial | Offline and signed-out states; status menu (phase 1); not yet seen after a real login inside the CRM | Existing tests guard the removed "messenger" view, so the page uses the key `team-messenger` |
| S03 Chat list | 2026-11-04 | Partial | Pin and mute (phase 1); search matches names only | None |
| S04 Conversation | 2026-11-04 | Reused | Reuses the dock's screen; phase 1 adds the rest | None |
| S23 Docked panel | 2026-11-04 | Kept | Leaves while the full page is open, so a dock draft is lost on moving to that page | None |
| S02, S06, S10, S16, S19 | 2026-11-04 | Placeholder | Say which phase they arrive in | None |

Checked on `messenger-preview.html` with fake data only, at 800px and 375px wide. Reference comparison was not possible, as no reference screenshots exist.

## Phase 1, 2026-11-04

| Screen | Status | Missing | Harder than expected |
|---|---|---|---|
| S02 Activity | Done on fake data | Missed calls (phase 4) | None |
| S03 Chat list | Done on fake data | None | Search jumps to the chat, not the message |
| S04 Conversation | Done on fake data | Rich text, typing line, read receipts per person | Reactions moved onto the message, as Realtime delete events cannot be filtered by access rules |
| S05 Chat details | Partial | Files tab inside a chat | None |
| S19 Files | Done on fake data | Preview before download | Upload links cannot limit size, so the function measures each stored file |
| S20 Search | Partial | Results sit under the chat list; no page of their own; no jump to the message | None |

Database: real Postgres, all checks and rollback pass. Function: unit tests only; it has never reached real R2. Live realtime for edits and reactions is untested. Nothing is live.

## Phase 2, 2026-11-04

| Screen | Status | Missing | Harder than expected |
|---|---|---|---|
| S06 Teams and channels list | Done on fake data | Team browsing and join requests | None |
| S07 Channel | Done on fake data | Files tab in a channel; @channel mention | Posts reuse the chat screen, so edits, reactions and files needed no new code |
| S08 Thread pane | Done on fake data | The post on top of a thread does not update live | None |
| S09 Manage team | Done on fake data | Team pictures; letting members create channels | Private channels stay hidden even from owners who are not in them, as the brief asked for no admin exception |

Database: real Postgres, all checks and rollback pass. Channels are out of the 365-day limit until the user decides. The dock does not show channels. Nothing is live.

## Phase 3, 2026-11-04

| Screen | Status | Missing | Harder than expected |
|---|---|---|---|
| S21 Settings | Done on fake data | Device choices (phase 4) | None |
| S22 Tray and notifications | Installed and started on this PC | Sign-in, tray clicks, a real notification and links not tried; auto-update; code signing | A missing crate and two wrong build paths on the first attempts |

Installed at D:\\Apps\\AB Capital Messenger. Checked: starts and shows the login, a second launch closes and reopens the first, closing the window keeps it running, the link type is registered. Not checked: anything after sign-in.

## Phase 4, 2026-11-04

| Screen | Status | Missing | Harder than expected |
|---|---|---|---|
| S14 Call screen | Done on a stand-in room | Never run on real LiveKit; raise hand, in-call reactions and chat (phase 5) | Calls must survive moving between CRM pages, so the screen sits above every page, outside the Messenger page |
| S15 Incoming call | Done on fake data | Closed browser tabs cannot ring | Do not disturb is decided in the database |
| S16 Call history | Done on fake data | None | None |
| S12 Pre-join | Not built | Moved to phase 5, with meetings. Calls use the default devices, with a picker in the call | None |

Database: real Postgres, all checks and rollback pass. Function: unit tests only. Real LiveKit, real devices and two real people have not been tried. Nothing is live.
