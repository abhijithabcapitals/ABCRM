# Email Base

The shared CRM email store. For now it syncs `info@abcapital.ae` and
`bharat@ardentaxit.tax` into the CRM Supabase project's `email_base` schema.

- `mailboxes` tracks each IMAP account and its sync lock and status.
- `mailbox_folders` lists every IMAP folder of each mailbox (INBOX, Sent, Archive, custom), its role, whether it is synced, and its own UID cursor. Drafts, Junk and Trash are recorded but disabled by default; set `enabled = true` to include them.
- `messages` stores one row per message per folder: From/To/Cc/Bcc/Reply-To, Message-ID, In-Reply-To, References, all headers, plain-text and HTML bodies, IMAP flags, size, direction (inbound/outbound) and `raw_path` to the original .eml.
- `attachments` lists each attachment (name, type, size, SHA-256, Storage path).
- Storage bucket `email-base` (private) holds `<mailbox_id>/<folder>/<uidvalidity>/<uid>/message.eml` and `.../attachments/<n>-<name>`.
- `threads` stores conversation summaries, labels, key points and actions.
- `reply_drafts` stores replies written in the CEO Inbox (recipients, subject, text, signature, status). `reply_send_confirmations` holds the hashed one-time send codes and is readable by the server only. Migration 006 also adds `display_name`, `smtp_host` and `smtp_port` to `mailboxes`.
- `bd_reply_drafts` stores unsent Business Development replies to Explee prospects. Drafts remain in the CRM Email Base when the mailbox pane is closed and are restored when the conversation is opened again.

The `ceo-mail-sync` Edge Function reads IMAP in read-only mode. Each run (every
5 minutes, job `email-base-sync`) walks the enabled folders of each mailbox,
INBOX first, oldest UID first. A run stores up to 25 messages / 12 MB / 45 s,
split evenly between the mailboxes, because Edge Functions have a small CPU
allowance. It then summarizes up to 24 conversations per mailbox marked
`needs_summary` from the stored rows. The folder position is saved after every
message. A message larger than 10 MB, or one that stopped an earlier run, is
stored with its headers only (`body_complete = false`, reason in
`parse_error`) and no longer stops the mailbox. A failing folder is recorded in `mailbox_folders.last_error` while the
other folders continue. Messages from `excluded_senders` are stored but not
summarized. Email bodies are also sent to the configured summarization provider.

Apply migrations in order to the CRM Supabase project. Migration 005 adds full capture (folders, all headers, HTML, attachments, .eml) and resets each INBOX cursor so the existing history is re-read and completed; existing summaries are kept. Migration 002 adds
message-body storage, assigns the provisioned CEO owner, resets the mailbox
cursors for the historical backfill, and redirects the schedule to the CRM
function. Expose the `email_base` schema through the Data API, and deploy `ceo-mail-sync` from
`CEO Agent Module/supabase/ceo-mail-sync`. Configure each mailbox password as
an Edge Function secret named `MAIL_PASSWORD_INFO_ABCAPITAL_AE` or
`MAIL_PASSWORD_BHARAT_ARDENTAXIT_TAX`, plus `OPENROUTER_API_KEY`.

For Business Development reply drafts, apply BD migrations 005 and 007 before
Email Base migration 004, then BD migrations 008 and 009. Migration 004 creates
the shared Email Base draft table and copies any existing drafts from the legacy
`public.bd_reply_drafts` table. Saving a draft does not send mail; sending still
requires the separate one-time human confirmation.
