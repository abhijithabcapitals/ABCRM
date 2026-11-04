# Browser check, Phase 1

Run on the real tenant. A feature counts as working only after every step passes.

## Open a chat
1. From a client page, open a chat with one person. Teams desktop opens on that person.
2. From a lead page, repeat with one person.
3. Repeat both with a group. The group name and link show spaces, not literal `+` signs (URLSearchParams encodes spaces as `+`). Use a multi-word message and a multi-word group name.
4. Use a client name with symbols (`&`, `'`, `/`, `#`). The chat opens and the name is intact.
5. Teams desktop opens. No KYC data appears in the message or link.

## Blocked pop-up
6. Block pop-ups for the site, then open a chat. A visible link appears and opens Teams when clicked.
7. With pop-ups allowed, no blocked notice shows (no false blocked notice) even when Teams takes a few seconds to open.

## Chats tab limit
8. A chat started from the Chats tab is not saved in the CRM. Confirm the tab says so.

## Install
9. Edge on Windows: install the app from the address bar. It opens in its own window on Messenger.
10. Chrome on Windows: repeat step 9.
11. Reload inside the installed app after moving to another page. It stays on that page; `view` is gone from the address, other params stay.
12. Run the app from the installed icon with a saved page of Hr in the browser. It still opens on Messenger.

## Member without the grant
13. Sign in as a member without the Messenger grant. The installed app opens on their first allowed page, not a blank screen.
