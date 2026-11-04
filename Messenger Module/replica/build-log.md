# Build log

| Screen | Date | Status | Missing | Harder than expected |
|---|---|---|---|---|
| S01 App shell | 2026-11-04 | Partial | Offline and signed-out states; status menu (phase 1); not yet seen after a real login inside the CRM | Existing tests guard the removed "messenger" view, so the page uses the key `team-messenger` |
| S03 Chat list | 2026-11-04 | Partial | Pin and mute (phase 1); search matches names only | None |
| S04 Conversation | 2026-11-04 | Reused | Reuses the dock's screen; phase 1 adds the rest | None |
| S23 Docked panel | 2026-11-04 | Kept | Leaves while the full page is open, so a dock draft is lost on moving to that page | None |
| S02, S06, S10, S16, S19 | 2026-11-04 | Placeholder | Say which phase they arrive in | None |

Checked on `messenger-preview.html` with fake data only, at 800px and 375px wide. Reference comparison was not possible, as no reference screenshots exist.
