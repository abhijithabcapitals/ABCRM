# AB Capital Messenger: release checklist

Written 2026-11-04. Nothing here has been run. Each numbered step needs its own approval. Stop at the first failure.

Covers phases 0 to 4 and the Inbox's email step, on branch `messenger-dock`, with `main` merged in at `f910545`.

## Live database, read only, 2026-11-04

| Check | Result | Means |
|---|---|---|
| Messenger tables | `messenger_conversations`, `messenger_members`, `messenger_messages` only | 003 is live; 004, 005 and 006 are not |
| Chat data | 1 conversation, 1 message | Little is at risk |
| Constraint names | `messenger_conversations_check`, `messenger_conversations_kind_check` | Match what 005 replaces |
| Own-row update on `profiles` | Only "Admins can update profiles" | Check B passes |
| Database size | 1034 MB, against the 500 MB plan size noted earlier | Writes still work today, as the transaction setting is not read-only. What the limit does next is still unconfirmed. The migrations add almost nothing, but the chat will grow |
| `pg_cron` | On, with no Messenger jobs | The 365-day prune has never been scheduled, so nothing is deleted yet |
| `email_base.mailbox_access` | Missing | Grants live on the unreleased branch `profile-menu`. Only each mailbox's owner sees its mail |
| Mailboxes | 2, both with an owner | The Inbox shows mail to those owners only |

## Tested before this list

On the merged code: 146 Messenger tests, 15 function tests, all database checks with rollback on a throwaway Postgres, CRM and desktop builds. The old chat checks still pass after 004 to 006, so the live screens should keep working once the migrations run ahead of the merge. Screens have run on fake data only.

## Steps

### 1. Migrations, one at a time

Run in this order. Each is safe to run twice, and removes nothing.

1. Done 2026-11-04: `Database Module/Messanger Base/migrations/004_chat_parity.sql`
2. Done 2026-11-04: `004b_chat_audit_private.sql`. Chat text no longer enters the audit trail, at the user's decision
3. Done 2026-11-04: `Database Module/Messanger Base/migrations/005_teams_channels.sql`
4. Done 2026-11-04: `Database Module/Messanger Base/migrations/006_calls.sql`

After each, confirm the live chat dock still lists chats and sends a message.

Undo: `migrations/rollback/006`, `005`, `004b`, then `004`, newest first. These delete what the new features stored, and cannot restore the text of a deleted message.

### 2. Release the screens

Merging to `main` makes it live on GitHub Pages at once.

1. Fetch `main` again and merge it into `messenger-dock`. Rerun the tests and builds if it moved.
2. Merge to `main` and push.
3. In `Main Module`, from a checkout matching `main`, run `npm run deploy:cloudflare`. This updates `abcrm` and `crm-abcapital`.
4. Confirm both addresses serve the new build.

Every staff member then sees Messenger in the sidebar, with Calls and file sharing saying they are not set up.

Undo: revert the merge on `main`, then run the Cloudflare deployment again.

### 3. Test with two real logins

An admin and a member, in two windows. Use test wording; these are real chats.

- [ ] Sidebar shows Messenger for the member, with no tab granted.
- [ ] Chat: message arrives live. Edit, delete, reply and react all reach the other window.
- [ ] @mention reaches the other person's Activity, and clicking it opens the message's chat.
- [ ] Status: changing it shows on the other side within about 2 minutes. Mute and pin stay per person.
- [ ] Search finds a word in a chat you are in, and not in one you are not in.
- [ ] Teams: create a team. The member sees General and its posts live; a thread reply updates the count.
- [ ] A private channel stays hidden from the member until added, even by direct address.
- [ ] Inbox: a mailbox owner sees real mail, and opening a thread marks it read. The member sees "No mailbox is available to you yet."
- [ ] Inbox reply: send one real test reply to your own address, using the send code. Check it arrives and appears in Sent.
- [ ] The dock, other CRM pages and the phone view still work.

### 4. Optional, each later and separately

- **Calls:** `calls-setup.md`. Needs a LiveKit account. Then test two people, a group, screen share, and a closed-window ring.
- **Files:** `files-setup.md`. Needs an R2 bucket and token.
- **Windows app:** rebuild and reinstall, as the installed copy predates calls and the Inbox. Then test sign-in, the tray, a real notification and the camera. Add `http://tauri.localhost` to the R2 CORS rule.
- **Staff mail access:** release `profile-menu`, which has its own migrations. It will need merging with this work.
- **Clean-up job:** `messenger-close-stale-calls`, once calls are on.

## Known risks

- **Database size.** Above the plan size noted earlier. Decide on a plan or a clean-up before chat volume grows.
- **Load.** Each new message makes every open window reload its chat, team and activity lists. Fine for a small staff; revisit if it grows.
- **Audit trail.** Chat stays private from admins, so the log shows who changed which fields and when, never the text. Rows written before 004b still hold text.
- **Open questions.** Outside guests in meetings, and whether channels follow the 365-day limit. Channels are outside it for now.
- **Public repository.** No keys in code. Migrations and docs are readable by anyone.
