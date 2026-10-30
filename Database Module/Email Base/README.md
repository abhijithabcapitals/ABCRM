# Email Base

The shared CRM email store. For now it syncs `info@abcapital.ae` and
`bharat@ardentaxit.tax` into the CRM Supabase project's `email_base` schema.

- `mailboxes` tracks each IMAP account and its sync cursor.
- `messages` stores message headers and extracted plain-text email bodies.
- `threads` stores conversation summaries, labels, key points and actions.
- `bd_reply_drafts` stores unsent Business Development replies to Explee prospects. Drafts remain in the CRM Email Base when the mailbox pane is closed and are restored when the conversation is opened again.

The `ceo-mail-sync` Edge Function reads IMAP in read-only mode and processes up
to 30 messages per mailbox per run. Its first sync starts at the oldest
available message and continues in ascending UID batches until the mailbox is
caught up; the scheduled job runs every 15 minutes. Email bodies are retained
in the CRM database and are also sent to the configured summarization provider.
Attachments and original MIME files are not stored. Each fetched message is
capped at 1 MiB; if a message reaches that limit, sync reports an error and
does not advance the mailbox cursor, rather than storing a partial body.

Apply migrations in order to the CRM Supabase project. Migration 002 adds
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
