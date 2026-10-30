# CEO Agent Module

The CRM's **CEO Agent** tab (admins only). It is the user interface of the CEO Intelligence Agent in
`Agent Module/11_Personal_Agent/CEO Agent`, ported into the CRM so it opens inside the CRM shell.

| Path | Purpose |
|---|---|
| `components/CeoAgent.jsx` | Sign-in and TOTP MFA, then a chat with the agent on the left and the dashboard on the right |
| `supabase/ceo-agent/index.ts` | Edge Function `ceo-agent`: DeepSeek (`deepseek/deepseek-v4.1-flash`) via OpenRouter, with tools that save and look up CEO items and synced email summaries |
| `supabase/ceo-agent/playbooks.ts` | 14 CEO playbooks (decisions, reviews, delegation, pricing, finance, risk and more) served by the read-only `get_playbook` tool; adapted from the open skills in `Agent Module/11_Personal_Agent/CEO Agent/.claude/skills` |
| `components/InboxPanel.jsx` | **Inbox** tab: full message text, AI summaries, importance markers, saved facts, reply-draft review and alerts |
| `supabase/ceo-mail-sync/index.ts` | Edge Function `ceo-mail-sync`: read-only IMAP sync, full text retention and conversation summaries |
| `supabase/ceo-mail-sync/imap.ts` | Minimal read-only IMAP client on `Deno.connectTls` |
| `../Database Module/Email Base/migrations/` | Shared mailbox, message and conversation schema, CRM access policies and sync schedule |
| `supabase/migrations/202610300003_email_base_mail_assistant.sql` | Connects CEO saved facts and unsent drafts to shared Email Base threads |
| `index.js` | Default export of the page |

## Chat and dashboard

Every chat message is saved to `ceo.captures`. The agent then saves what it hears as structured items:
meetings, reminders, tasks, decisions, ideas, risks, people, projects and notes (`ceo.records` plus the
matching table), and can mark items done or cancelled. It answers questions from `get_overview` and
`search_memory`. It can search synced email summaries and key points with `search_emails`; full plain-text
email bodies are retained in Email Base and are available in the Inbox. Selected
email key points can be saved to private CEO memory and searched later. It asks for an exact date before
saving a meeting or reminder, and never sends anything outside the CRM.

The dashboard reads the same tables directly: this week's meetings, open and overdue tasks (tick to complete),
reminders, recent decisions, ideas and open risks. It refreshes after each reply that saved something.
The chat itself is kept for the browser session only; the CEO's own messages stay in `ceo.captures`.

The function runs with the caller's token, so row-level security limits it to the caller's own rows, and it
refuses callers without a `ceo.profiles` row or, when `require_mfa` is true, without an `aal2` session.
Needs the `OPENROUTER_API_KEY` Edge Function secret (optional `OPENROUTER_MODEL` overrides the model). Only providers that support tools and do not retain prompts are used. Redeploy after editing `index.ts` as `ceo-agent`.

The **Talk** button uses the browser's speech recognition (Chrome, Edge, Safari) to dictate a message, sends it when you stop speaking, and reads the reply aloud. It is hidden in browsers without speech recognition.

## Inbox (email summaries)

`ceo-mail-sync` connects to the enabled CRM Email Base mailboxes `bharat@ardentaxit.tax` and
`info@abcapital.ae` (Hostinger Email at `imap.hostinger.com:993`) **read-only**: it never sends, moves,
deletes or flags mail. Every 5 minutes it reads every enabled folder (INBOX, Sent, Archive, custom folders)
and stores each message completely in Email Base: recipients, headers, text and HTML bodies, flags,
attachments and the original .eml (see `Database Module/Email Base/README.md`). Conversations are then
summarized by DeepSeek from the stored rows. Email text is untrusted data and is sent to the configured
OpenRouter provider for summarization. A message above 10 MB is kept with headers only and flagged, without
blocking the rest of the mailbox.

The **Inbox** tab lists every stored conversation (newest first, each with a coloured bubble naming its mailbox, 50 per page with **Show more**), with search across message text, subjects, senders and summaries, filters (including Sent and Archived), attachment and original .eml download, **Sync now**, mark read/unread,
archive, and buttons that turn a suggested action into a task or reminder. Marking a thread important changes
only its CRM record, not an IMAP flag. Key points can be saved individually to CEO memory. When explicitly
asked, chat can create an unsent reply draft using the latest external sender address in the selected thread.
Drafts appear in Inbox for editing, approval or cancellation; approval only marks the draft approved and never
sends it. The agent itself never sends. The tab badge counts unread conversations;
**Enable alerts** shows a browser notification for new urgent or needs-reply conversations while the CRM is open.

**Reply** (`components/ReplyComposer.jsx`) works like the Business Development reply mailer. To is prefilled
with the latest external sender (Reply-To first), **Reply all** adds the other recipients to Cc, and the subject
gets "Re:". A CEO Agent draft for the conversation, if any, is loaded for review. The composer saves drafts,
rewrites them with **Redraft with AI** (optional instructions, **Undo**), and keeps the chosen Profile › Mail
signature as the last block of the text; its logo is added below the text in the HTML part. **Send** saves the
draft and shows a one-time six-digit code (5 minutes, 5 attempts); the email goes out only after the code is
typed and **Send reply** is clicked, and a changed text, subject, signature or recipient invalidates the code.
The `ceo-mail-reply` Edge Function sends through the mailbox's own SMTP server (`smtp.hostinger.com:465`) with
the same password secret as the sync, stores a copy in the mailbox's Sent folder (the next sync adds it to
Email Base), and clears the conversation's needs-reply flag. Drafts are in `email_base.reply_drafts`; only the
server can mark one sending, sent or failed.

Apply `Database Module/Email Base/migrations/001_email_base.sql` and
`002_full_message_history.sql`, then
`supabase/migrations/202610290002_mail_assistant.sql` and
`supabase/migrations/202610300003_email_base_mail_assistant.sql`, then Email Base `005_full_capture.sql` and,
after `Main Module/db/email_signatures.sql`, `006_reply_drafts.sql`, to the CRM Supabase project. Expose the
`email_base` schema through the Data API and deploy the functions in this module (`ceo-mail-reply` with JWT
verification on). The migrations grant the provisioned CEO owner access to the two mailboxes and keep browser
writes limited to Inbox status, importance, saved facts and drafts. Mail is sent only by `ceo-mail-reply` after
the confirmation code.

Edge Function secrets: `MAIL_PASSWORD_INFO_ABCAPITAL_AE`,
`MAIL_PASSWORD_BHARAT_ARDENTAXIT_TAX`, and `OPENROUTER_API_KEY`.
`OPENROUTER_MAIL_MODEL` optionally overrides the summarization model. Deploy `ceo-mail-sync` with JWT
verification **off**: the scheduler uses the `email_base_sync_secret` Vault secret, while **Sync now**
authenticates the CEO's CRM session and MFA. Mailbox sync status and errors are in `email_base.mailboxes`.

## Where the data lives

The `ceo` and `email_base` schemas are in the CRM Supabase project (`pnnakrhfzyxudjaghoxx`). The `ceo`
schema was applied as migration `initial_ceo_schema` on 29/10/2026. It is kept apart from the CRM tables
by schema and row-level security: CEO memory is scoped to the signed-in user, while Email Base mailbox
access is scoped to its provisioned owner. Anonymous users have no access. The tab reuses the CRM sign-in.

The same rules as the original apply: owner provisioned in `ceo.profiles` (done for
abhijith.abcapitals@gmail.com, role `owner`), an authenticator app (TOTP) is required when `require_mfa` is
true, voice upload stays locked until audio retention and a cleanup worker exist, and there is no AI
extraction, CRM sync, reminders or external actions yet.

To give another person a CEO workspace, insert their row in `ceo.profiles` (see
`Agent Module/11_Personal_Agent/CEO Agent/CONFIGURATION.md`). Without a row the tab says the account is not
provisioned.

Email Base is the CRM-wide source for connected mailboxes, message headers and bodies, and conversation
summaries. The current mailboxes are the two listed above; add future CRM mailboxes in `email_base.mailboxes`
and provide a matching Edge Function password secret.

## How it is connected

`Main Module/vite.config.js` maps `@ceo-agent` to this folder and resolves `react` and
`@supabase/supabase-js` from the Main Module. `Main Module/src/components/CeoAgent.jsx` adds the page header
and passes the CRM Supabase client; the sidebar shows **CEO Agent** to admins only.

The standalone Next.js app in `Agent Module/11_Personal_Agent/CEO Agent` is unchanged and can still run on
its own. Port later features (extraction, reminders, approvals) here as they are built there.
