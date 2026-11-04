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
