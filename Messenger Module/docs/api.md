# ms365 Edge Function: API

Source: `supabase/ms365/` (`index.ts` routing, `handlers.ts` actions, `auth.ts` sign-in logic, `graph.ts` Graph client).
Address: `https://pnnakrhfzyxudjaghoxx.supabase.co/functions/v1/ms365`

The function is deployed with JWT verification off, so Microsoft's redirect can arrive. The routing in `index.ts` is the protection:

| Request | JWT | Handling |
|---|---|---|
| `OPTIONS` | none | CORS answer |
| `GET` with `state` or `error` in the query | none; the signed `state` is the proof | `callback`, then a 302 back to `MESSENGER_APP_URL` |
| `GET` without `state` or `error` | none | 405 `Use POST` |
| `POST` | required: the function reads the user from the `Authorization` header | action below. No user gives 401 `Sign in first.` |
| anything else | none | 405 `Use POST` |

`index.ts` has no automated test. Its routing is checked by hand in `tests/browser-check.md`.

Browser calls go through `callMs365(action, body)` in `services/messengerApi.js` (`supabase.functions.invoke("ms365", ...)`). A refusal comes back as HTTP 400 with `{ "error": "<sentence for the person>" }`. An unexpected failure is HTTP 500 with `{ "error": "Something went wrong talking to Microsoft." }`. Responses never carry a token, code, ID token or client secret.

## POST actions

Body is JSON `{ "action": "...", ... }`. The caller's own profile is always used; a profile ID in the body is ignored except in `user_links_review`.

### `connection_status`
Any signed-in staff. No body fields.

```json
{
  "status": "not_connected | active | revoked",
  "link": { "status": "active | review | revoked", "upn": "name@company" } ,
  "needs_connect": true,
  "admin": {
    "tenant_id": "...", "connected_by": "<profile id>", "consented_at": "<timestamp>",
    "credential_expires_on": "YYYY-MM-DD",
    "links": [{ "profile_id": "...", "upn": "...", "status": "...", "updated_at": "..." }]
  }
}
```
- `link` is `null` when the person never connected.
- `needs_connect` is true unless the person has an active link that holds a stored sign-in. An accepted link has no sign-in until the person connects again.
- `admin` is present for admins only.

### `connect_start`
Any signed-in staff. Returns `{ "url": "<Microsoft sign-in address>" }`. The browser opens it in the same tab.
Refused with "An admin must connect Microsoft first." when the connection is not `active` and the caller is not an admin. Uses the Phase 2 scopes `openid profile offline_access User.Read`, PKCE, and a signed state valid for 10 minutes.

### `disconnect`
Any signed-in staff. Deletes the caller's stored sign-in and sets the caller's link to `revoked`. Returns `{ "ok": true }`.

### `admin_test`
Admin only. Asks Microsoft for the admin's own name and email.
- `{ "connected": true, "display_name": "...", "upn": "..." }`
- `{ "connected": false, "message": "Connect your own Microsoft account first." }`
- `{ "connected": false, "message": "Microsoft refused the test.", "code": "..." }`

### `user_links_review`
Admin only. Body: `{ "profile_id": "<uuid>", "decision": "accept" | "reject", "upn": "<upn shown to the admin>" }`.
- The row must be in `review`. `upn` is required for `accept` and must equal the row's current `upn`, so a newer sign-in cannot be accepted unseen.
- Any stored sign-in for that person is deleted first.
- `accept` sets the link to `active` with no sign-in stored. The person then connects again (`needs_connect` stays true until they do).
- `reject` sets the link to `revoked` and clears the Microsoft account ID.
- Returns `{ "ok": true, "status": "active" | "revoked" }`. A stale row gives "That person is not waiting for review. Refresh the list."
- The function does not stop an admin from accepting their own link.

### `secret_expiry_set`
Admin only. Body: `{ "date": "YYYY-MM-DD" | null }`. Saves the client secret expiry date; `null` clears it. A bad date gives "Enter a valid date, or clear it." Returns `{ "ok": true, "credential_expires_on": <date or null> }`. The screen warns from 30 days ahead.

## Callback (GET, no JWT)

`GET .../ms365?code=...&state=...` or `?error=...&state=...`. Always answers 302 to `MESSENGER_APP_URL` with `view=settings` and one of:

| Query on return | Meaning |
|---|---|
| `ms=connected` | Link active, sign-in stored |
| `ms=review` | Microsoft email differs from the CRM email. Nothing stored. An admin must accept; the person connects again |
| `ms=error&reason=...` | See the reasons |

Reasons: `denied` (person cancelled), `microsoft_error`, `expired` (state older than 10 minutes or invalid), `code_used` (`invalid_grant`), `wrong_tenant`, `already_linked` (that Microsoft account belongs to another CRM user), `admin_first` (a member came before any admin connected), `not_configured` (a setting is missing), `failed` (anything else).
The 302 carries `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. If `MESSENGER_APP_URL` is unusable the function answers 500 with plain text, as there is nowhere safe to send the person.

The first successful admin connect also writes the connection row (`status` `active`, tenant ID, who connected).

## Log

Every state change writes `microsoft_sync_log`: `connect_callback`, `disconnect`, `link_revoked`, `user_links_review`, `secret_expiry_set`, plus Graph failures. Entries hold names and codes only; never tokens or message text. Admins read them on the Logs tab (100 newest).

## Settings the function reads

`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_STATE_SECRET`, `MESSENGER_APP_URL` (Settings > Integrations, or Edge Function secrets of the same name). A missing one gives a message naming it.
