# Browser check, Phase 1

Run on the real tenant. A feature counts as working only after every step passes.

## Open a chat
1. From a client page, open a chat with one person. Teams desktop opens on that person.
2. From a lead page, repeat with one person.
3. Repeat both with a group. The group name and message show spaces, not literal `+` signs. Use a multi-word message and a multi-word group name.
4. Use a client name with symbols (`&`, `'`, `/`, `#`). The chat opens and the name is intact.
5. Teams desktop opens. No KYC data appears in the message or link.
5a. Links use `%20` for spaces and literal commas between people; check the address Teams receives.
5b. The `users` part supports the Microsoft sign-in name (UPN) only. A person whose CRM profile email differs from their UPN will miss: Teams opens without them or shows no match. Record any such person.
5c. A lead page's link and message hold the lead number only, no prospect name.

## Blocked pop-up
6. Block pop-ups for the site, then open a chat. A visible link appears and opens Teams when clicked.
7. With pop-ups allowed, no blocked notice shows (no false blocked notice) even when Teams takes a few seconds to open.

## Chats tab limit
8. A chat started from the Chats tab is not saved in the CRM. Confirm the tab says so.
8a. On a client page, a member who did not save a chat presses Remove on it: a plain sentence says it was not removed. The person who saved it, and an admin, can remove it.
8b. The staff picker scrolls inside its own box and the Teams panel inputs look the same on client and lead pages.

## Install
9. Edge on Windows: install the app from the address bar. It opens in its own window on Messenger.
10. Chrome on Windows: repeat step 9.
11. Reload (F5) inside the installed app after moving to another page, and after the Microsoft return. It stays on that page; `view` is gone from the address, other params stay.
12. Run the app from the installed icon with a saved page of Hr in the browser. It still opens on Messenger.

## Member without the grant
13. Sign in as a member without the Messenger grant. The installed app opens on their first allowed page, not a blank screen.

# Browser check, Phase 2: Microsoft connection

Run on the real tenant, after the migrations are applied, `ms365` is deployed with `--no-verify-jwt`, the Entra app exists and the five settings are saved. Use an admin, a member whose Microsoft email equals the CRM email, and a member whose Microsoft email differs. Every step must pass.

## Routing of the function (`index.ts` has no automated test)
14. Open the function address `https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ms365` in a browser (a GET with no `state`). It answers 405 `Use POST`, not a sign-in error.
15. In the browser developer tools, send a POST to the function with no `Authorization` header. It answers 401 `Sign in first.`
16. Send a POST with a member's token and `{"action":"admin_test"}`. It answers 400 `Only a CRM admin can do this.`
17. Open the function address with `?state=garbage`. It answers 302 back to the CRM with `ms=error&reason=expired`, with no JWT needed. The response has `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.

## Connect
18. Member opens Messenger > Settings before any admin has connected. They see "An admin must connect Microsoft first." and no Connect button.
19. Admin presses Connect Microsoft, signs in with the work account. They land back in Messenger > Settings with "Microsoft is connected." The Connection panel shows the tenant ID, who connected, the time and the account. `ms` and `reason` are gone from the address.
20. Reload the page. The message does not return.
21. Press the browser back button after returning. It does not repeat the sign-in or show a stale message.
22. Admin presses Test connection. It names the admin's own account.
23. Member whose email matches presses Connect. They return as connected and the Overview tab shows "Connected as ...".

## Failures
24. Cancel at the Microsoft screen. The CRM says the sign-in was cancelled, nothing is connected.
25. Sign in with an account from another company. The CRM says it belongs to a different company, nothing is stored. The Logs tab shows a `wrong_tenant` entry.
26. Start a connect, wait over 10 minutes, then finish. The CRM says the sign-in took too long.
27. Sign in as a second CRM user with a Microsoft account already linked to someone else. The CRM says the account is already linked to another user.

## Email mismatch and review
28. First admin whose Microsoft email differs from the CRM email connects. They land with the review message, "Nothing is stored yet". Nothing is connected, and no Vault entry `ms_rt:<id>` exists for them.
29. Member whose email differs connects. Same message. Settings shows "Waiting for admin review".
30. Admin sees the member under People with Accept and Reject. Reject: the member shows Disconnected and can press Connect again.
31. Accept (after a new attempt): the member shows "Accepted. Connect again to finish". Still no sign-in stored (Overview shows not connected).
32. Self-accept: with a single admin whose email differs, press Accept on their own row. Record whether it is allowed (the function does not forbid it). The admin must still press Connect again.
33. Sign in again after acceptance. The member returns as connected. Signing in with a different Microsoft account under that name goes back to review.

## Disconnect and revoke
34. Member presses Disconnect and confirms. Status shows Not connected, and the Logs tab has a `disconnect` entry.
35. Connect again. Then, in Entra, remove the member's consent or revoke their sessions. Use a feature that calls Microsoft (an admin runs Test connection). The screen then offers Connect again, and Logs has a `link_revoked` entry.

## Settings and Logs
36. Admin saves a secret expiry date 20 days ahead. The warning shows on Settings. Set a date 60 days ahead: no warning. Clear the date: it saves.
37. The Logs tab is visible to the admin only. A member sees no Logs tab.
38. Logs filter by action and by status. The list shows at most 100 newest.

## No secrets in the browser
39. After steps 19 to 35, search `localStorage`, `sessionStorage`, IndexedDB and cookies for `refresh`, `token`, `secret`: no Microsoft token or secret appears (the Supabase sign-in session is expected).
40. In the Network tab, no response from `ms365` or Supabase contains a refresh token, ID token, authorization code or client secret. The authorization code appears only in the Microsoft redirect to the function, and is gone from the address after the 302.
